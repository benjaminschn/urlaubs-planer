import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import {
  candidateAdapterVersion,
  extractionPromptVersion,
  extractionSchemaVersion
} from "../_shared/extraction-contract.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}

function corsHeaders(request: Request): HeadersInit {
  const allowedOrigin = Deno.env.get("APP_ORIGIN") ?? "";
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "private, no-store",
    Vary: "Origin"
  };
}

function response(body: Record<string, unknown>, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function decodeJwtPayload(token: string): RecordLike | null {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    return asRecord(JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return null;
  }
}

async function kickWorker(supabaseUrl: string, workerToken: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/process-document-extractions`, {
      method: "POST",
      headers: {
        "X-Extraction-Worker-Token": workerToken,
        "Content-Type": "application/json"
      },
      body: "{}",
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // The committed queue row is authoritative. A scheduled worker invocation
    // will recover a missed best-effort kick.
  }
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  const configuredOrigin = Deno.env.get("APP_ORIGIN") ?? "";
  if (request.method === "OPTIONS") return request.headers.get("origin") === configuredOrigin ? new Response("ok", { headers }) : response({ code: "forbidden" }, 403, headers);
  if (request.method !== "POST" || request.headers.get("origin") !== configuredOrigin) return response({ code: "forbidden" }, 403, headers);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerToken = Deno.env.get("EXTRACTION_WORKER_TOKEN");
  const model = Deno.env.get("OPENAI_EXTRACTION_MODEL");
  const reservation = Number(Deno.env.get("OPENAI_MAX_RUN_COST_MICRO_EUR"));
  const inputPrice = Number(Deno.env.get("OPENAI_INPUT_MICRO_EUR_PER_TOKEN"));
  const cachedRaw = Deno.env.get("OPENAI_CACHED_INPUT_MICRO_EUR_PER_TOKEN");
  const cachedInputPrice = cachedRaw === undefined || cachedRaw === "" ? inputPrice : Number(cachedRaw);
  const outputPrice = Number(Deno.env.get("OPENAI_OUTPUT_MICRO_EUR_PER_TOKEN"));
  const pricingVersion = Deno.env.get("OPENAI_PRICING_VERSION");
  if (!token || !supabaseUrl || !anonKey || !serviceRoleKey || !workerToken || !model || !pricingVersion
    || !Number.isSafeInteger(reservation) || reservation <= 0
    || !Number.isFinite(inputPrice) || inputPrice < 0
    || !Number.isFinite(cachedInputPrice) || cachedInputPrice < 0
    || !Number.isFinite(outputPrice) || outputPrice < 0) return response({ code: "extraction_disabled" }, 503, headers);

  try {
    const body = asRecord(await request.json());
    if (!body || Object.keys(body).length !== 2 || typeof body.document_id !== "string"
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.document_id)
      || typeof body.idempotency_key !== "string" || body.idempotency_key.trim().length < 1
      || body.idempotency_key.length > 200) return response({ code: "invalid_extraction_request" }, 400, headers);

    const claims = decodeJwtPayload(token);
    if (!claims || claims.aud !== "authenticated" || claims.iss !== `${supabaseUrl}/auth/v1`
      || claims.aal !== "aal2") return response({ code: "forbidden" }, 401, headers);
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization ?? "" } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user || userData.user.id !== claims.sub) return response({ code: "forbidden" }, 401, headers);
    const { data: document, error: documentError } = await userClient.from("documents")
      .select("id,version,status").eq("id", body.document_id).eq("status", "available").maybeSingle();
    if (documentError || !document || typeof document.version !== "number") return response({ code: "forbidden" }, 403, headers);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: reserved, error: reserveError } = await serviceClient.rpc("reserve_priced_extraction_run", {
      p_document_id: document.id,
      p_document_version: document.version,
      p_requested_by_user_id: userData.user.id,
      p_idempotency_key: body.idempotency_key,
      p_model_identifier: model,
      p_extraction_schema_version: extractionSchemaVersion,
      p_prompt_version: extractionPromptVersion,
      p_candidate_adapter_version: candidateAdapterVersion,
      p_pricing_version: pricingVersion,
      p_budget_reservation_micro_eur: reservation,
      p_input_micro_eur_per_token: inputPrice,
      p_cached_input_micro_eur_per_token: cachedInputPrice,
      p_output_micro_eur_per_token: outputPrice
    });
    const run = Array.isArray(reserved) ? reserved[0] : reserved;
    const reserveCode = reserveError?.message.match(/\[([a-z_]+)\]/)?.[1] ?? "extraction_disabled";
    if (reserveError || !asRecord(run)) return response({ code: reserveCode }, reserveCode === "forbidden" ? 403 : 429, headers);

    if (asRecord(run)?.status === "queued") EdgeRuntime.waitUntil(kickWorker(supabaseUrl, workerToken));
    return response({ run }, 202, headers);
  } catch {
    return response({ code: "provider_unavailable" }, 503, headers);
  }
});
