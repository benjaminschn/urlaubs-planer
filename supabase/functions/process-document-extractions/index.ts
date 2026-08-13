import Ajv from "https://esm.sh/ajv@8.17.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import extractionSchema from "../../../schemas/extraction.schema.json" with { type: "json" };
import {
  extractionBucket,
  extractionDeveloperPrompt,
  extractionSystemPrompt
} from "../_shared/extraction-contract.ts";
import { validateAndAdapt } from "../_shared/extraction-semantics.ts";
import {
  buildOpenAIResponseBody,
  calculateOpenAICostMicroEur,
  extractOpenAIResponseAccounting,
  extractOpenAIStructuredText,
  openAIFilePurpose,
  safeOpenAIErrorCode,
  safeOpenAIInvalidSchemaReason
} from "../_shared/openai-request.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordLike = Record<string, unknown>;
const validateSchema = new Ajv({ allErrors: true, strict: true }).compile(extractionSchema);

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" }
  });
}

function securelyEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function providerHttpError(stage: "file_upload" | "response", status: number, providerBody?: unknown) {
  const retryable = status === 408 || status === 429 || status >= 500;
  const code = retryable ? "provider_unavailable" : "provider_rejected";
  const providerCode = safeOpenAIErrorCode(providerBody);
  const schemaReason = safeOpenAIInvalidSchemaReason(providerBody);
  const errorCode = providerCode === "invalid_json_schema" && schemaReason
    ? `provider_schema_${schemaReason}`
    : `${code}_${stage}_${status}${providerCode ? `_${providerCode}` : ""}`;
  return { kind: "error" as const, retryable, outcomeUncertain: false, errorCode };
}

async function providerErrorBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

async function deleteProviderFile(fileId: string | null, apiKey: string): Promise<void> {
  if (!fileId) return;
  try {
    await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // Files expire after one hour; deletion is an additional best-effort guard.
  }
}

async function providerExtraction(options: {
  bytes: Uint8Array;
  contentType: string;
  documentId: string;
  correlationId: string;
  providerAttempt: number;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  beforeResponse: () => Promise<void>;
}) {
  let providerFileId: string | null = null;
  let responseStarted = false;
  try {
    const extension = options.contentType === "application/pdf" ? ".pdf"
      : options.contentType === "image/jpeg" ? ".jpg"
        : options.contentType === "image/png" ? ".png"
          : options.contentType === "image/webp" ? ".webp"
            : options.contentType === "image/gif" ? ".gif" : ".bin";
    const form = new FormData();
    form.append("purpose", openAIFilePurpose(options.contentType));
    form.append("expires_after[anchor]", "created_at");
    form.append("expires_after[seconds]", "3600");
    form.append("file", new File([options.bytes], `extraction-${options.documentId}${extension}`, { type: options.contentType }));
    const uploaded = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(25000)
    });
    if (!uploaded.ok) return providerHttpError("file_upload", uploaded.status, await providerErrorBody(uploaded));
    const file = asRecord(await uploaded.json());
    if (!file || typeof file.id !== "string") return { kind: "error" as const, retryable: true, outcomeUncertain: false, errorCode: "provider_unavailable_file_upload_invalid_response" };
    providerFileId = file.id;
    await options.beforeResponse();
    responseStarted = true;
    const providerResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": `${options.correlationId}:${options.providerAttempt}`
      },
      body: JSON.stringify(buildOpenAIResponseBody({
        model: options.model,
        maxOutputTokens: options.maxOutputTokens,
        instructions: extractionSystemPrompt,
        prompt: extractionDeveloperPrompt,
        providerFileId,
        contentType: options.contentType,
        schema: extractionSchema
      })),
      signal: AbortSignal.timeout(70000)
    });
    if (!providerResponse.ok) return providerHttpError("response", providerResponse.status, await providerErrorBody(providerResponse));
    return { kind: "ok" as const, body: await providerResponse.json() };
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
    return { kind: "error" as const, retryable: true, outcomeUncertain: responseStarted, errorCode: timedOut ? "provider_timeout" : "provider_unavailable" };
  } finally {
    await deleteProviderFile(providerFileId, options.apiKey);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ code: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerToken = Deno.env.get("EXTRACTION_WORKER_TOKEN");
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const maxOutputTokens = Number(Deno.env.get("OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS"));
  const suppliedWorkerToken = request.headers.get("X-Extraction-Worker-Token") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !apiKey || !workerToken
    || !securelyEqual(suppliedWorkerToken, workerToken)
    || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256) return jsonResponse({ code: "forbidden" }, 403);

  let requestBody: RecordLike | null;
  try { requestBody = asRecord(await request.json()); } catch { requestBody = null; }
  if (!requestBody) return jsonResponse({ code: "invalid_worker_request" }, 400);
  if (requestBody.health_check === true && Object.keys(requestBody).length === 1) return jsonResponse({ healthy: true });
  if (Object.keys(requestBody).length !== 0) return jsonResponse({ code: "invalid_worker_request" }, 400);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const leaseOwner = crypto.randomUUID();
  const { data: claimed, error: claimError } = await serviceClient.rpc("claim_next_extraction_run", {
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120
  });
  const run = asRecord(Array.isArray(claimed) ? claimed[0] : claimed);
  if (claimError) return jsonResponse({ code: "worker_unavailable" }, 503);
  if (!run) return jsonResponse({ processed: false }, 200);

  const runId = typeof run.id === "string" ? run.id : "";
  const requestedBy = typeof run.requested_by_user_id === "string" ? run.requested_by_user_id : "";
  const documentId = typeof run.document_id === "string" ? run.document_id : "";
  const correlationId = typeof run.correlation_id === "string" ? run.correlation_id : runId;
  const providerAttempt = typeof run.provider_attempt_count === "number" ? run.provider_attempt_count : 0;
  const modelIdentifier = typeof run.model_identifier === "string" ? run.model_identifier : "";
  const inputPrice = typeof run.input_micro_eur_per_token === "number" ? run.input_micro_eur_per_token : Number.NaN;
  const cachedInputPrice = typeof run.cached_input_micro_eur_per_token === "number" ? run.cached_input_micro_eur_per_token : Number.NaN;
  const outputPrice = typeof run.output_micro_eur_per_token === "number" ? run.output_micro_eur_per_token : Number.NaN;
  const finishFailure = async (errorCode: string, retryable: boolean) => {
    await serviceClient.rpc("retry_or_fail_extraction_run", {
      p_run_id: runId,
      p_lease_owner: leaseOwner,
      p_error_code: errorCode,
      p_retryable: retryable,
      p_retry_delay_seconds: retryable ? Math.min(60, 5 * 2 ** Math.max(providerAttempt - 1, 0)) : 0
    });
  };

  try {
    const { data: document, error: documentError } = await serviceClient.from("documents")
      .select("id,detected_content_type,storage_object_key,status")
      .eq("id", documentId).eq("status", "available").maybeSingle();
    if (documentError || !document || typeof document.detected_content_type !== "string"
      || typeof document.storage_object_key !== "string") {
      await finishFailure("document_unavailable", false);
      return jsonResponse({ processed: true });
    }
    const { data: blob, error: downloadError } = await serviceClient.storage.from(extractionBucket).download(document.storage_object_key);
    if (downloadError || !blob) {
      await finishFailure("storage_unavailable", true);
      return jsonResponse({ processed: true });
    }

    const providerResult = await providerExtraction({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      contentType: document.detected_content_type,
      documentId,
      correlationId,
      providerAttempt,
      apiKey,
      model: modelIdentifier,
      maxOutputTokens,
      beforeResponse: async () => {
        const { error } = await serviceClient.rpc("begin_extraction_provider_call", { p_run_id: runId, p_lease_owner: leaseOwner });
        if (error) throw new Error("provider fence unavailable");
      }
    });
    if (providerResult.kind === "error") {
      if (providerResult.outcomeUncertain) return jsonResponse({ code: "provider_outcome_uncertain" }, 503);
      await finishFailure(providerResult.errorCode, providerResult.retryable);
      return jsonResponse({ processed: true });
    }

    const accounting = extractOpenAIResponseAccounting(providerResult.body);
    const cost = accounting ? calculateOpenAICostMicroEur(accounting, inputPrice, cachedInputPrice, outputPrice) : null;
    if (!accounting || cost === null) {
      // A malformed HTTP-200 response may still be billable. With no usable
      // usage object, consume the remaining reservation rather than silently
      // undercounting the provider charge.
      const reservation = typeof run.budget_reservation_micro_eur === "number" ? run.budget_reservation_micro_eur : 0;
      const alreadySpent = typeof run.actual_cost_micro_eur === "number" ? run.actual_cost_micro_eur : 0;
      const { error: fallbackChargeError } = await serviceClient.rpc("record_extraction_provider_charge_v2", {
        p_run_id: runId,
        p_lease_owner: leaseOwner,
        p_provider_request_id: `unaccounted_${correlationId}_${providerAttempt}`,
        p_input_tokens: 0,
        p_cached_input_tokens: 0,
        p_output_tokens: 0,
        p_cost_micro_eur: Math.max(0, reservation - alreadySpent)
      });
      if (fallbackChargeError) return jsonResponse({ code: "accounting_unavailable" }, 503);
      await finishFailure("provider_accounting_missing", false);
      return jsonResponse({ processed: true });
    }
    const { error: chargeError } = await serviceClient.rpc("record_extraction_provider_charge_v2", {
      p_run_id: runId,
      p_lease_owner: leaseOwner,
      p_provider_request_id: accounting.requestId,
      p_input_tokens: accounting.inputTokens,
      p_cached_input_tokens: accounting.cachedInputTokens,
      p_output_tokens: accounting.outputTokens,
      p_cost_micro_eur: cost
    });
    if (chargeError) return jsonResponse({ code: "accounting_unavailable" }, 503);

    const structured = extractOpenAIStructuredText(providerResult.body);
    if (!structured) {
      await finishFailure("invalid_structured_output", false);
      return jsonResponse({ processed: true });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(structured.text) as Json; } catch {
      await finishFailure("invalid_structured_output", false);
      return jsonResponse({ processed: true });
    }
    if (!validateSchema(parsed)) {
      await finishFailure("invalid_structured_output", false);
      return jsonResponse({ processed: true });
    }
    const adapted = validateAndAdapt(parsed);
    if ("error" in adapted) {
      await finishFailure(adapted.error, false);
      return jsonResponse({ processed: true });
    }
    const { error: completeError } = await serviceClient.rpc("complete_extraction_run", {
      p_run_id: runId,
      p_requested_by_user_id: requestedBy,
      p_lease_owner: leaseOwner,
      p_provider_request_id: accounting.requestId,
      p_actual_cost_micro_eur: 0,
      p_provider_attempt_count: providerAttempt,
      p_candidates: adapted.candidates,
      p_warnings: adapted.warnings
    });
    if (completeError) return jsonResponse({ code: "completion_unavailable" }, 503);
    return jsonResponse({ processed: true });
  } catch {
    // Leave the lease intact. A later invocation deterministically recovers it.
    return jsonResponse({ code: "worker_unavailable" }, 503);
  }
});
