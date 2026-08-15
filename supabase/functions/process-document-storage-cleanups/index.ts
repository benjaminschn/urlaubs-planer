import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

type RecordLike = Record<string, unknown>;
const WORKER_NAME = "document_storage_cleanup";

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

function isMissingObjectError(error: { message?: string; status?: number; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const status = Number(error.status ?? error.statusCode);
  return status === 404 || message.includes("not found") || message.includes("no such file") || message.includes("object not found");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ code: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerToken = Deno.env.get("EXTRACTION_WORKER_TOKEN");
  const suppliedWorkerToken = request.headers.get("X-Extraction-Worker-Token") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !workerToken
    || !securelyEqual(suppliedWorkerToken, workerToken)) return jsonResponse({ code: "forbidden" }, 403);

  let requestBody: RecordLike | null;
  try { requestBody = asRecord(await request.json()); } catch { requestBody = null; }
  if (!requestBody) return jsonResponse({ code: "invalid_worker_request" }, 400);
  if (requestBody.health_check === true && Object.keys(requestBody).length === 1) {
    return jsonResponse({ worker: WORKER_NAME, healthy: true });
  }
  if (Object.keys(requestBody).length !== 0) return jsonResponse({ code: "invalid_worker_request" }, 400);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await serviceClient.rpc("reap_expired_document_verifications");
  await serviceClient.rpc("reconcile_rejected_document_storage");

  const leaseOwner = crypto.randomUUID();
  const { data: claimed, error: claimError } = await serviceClient.rpc("claim_next_document_storage_cleanup", {
    p_lease_owner: leaseOwner,
    p_lease_seconds: 60
  });
  const cleanup = asRecord(Array.isArray(claimed) ? claimed[0] : claimed);
  if (claimError) return jsonResponse({ code: "worker_unavailable" }, 503);
  if (!cleanup) return jsonResponse({ worker: WORKER_NAME, processed: false });

  const cleanupId = typeof cleanup.id === "number" ? cleanup.id : Number(cleanup.id);
  const objectKey = typeof cleanup.storage_object_key === "string" ? cleanup.storage_object_key : "";
  const attemptCount = typeof cleanup.attempt_count === "number" ? cleanup.attempt_count : 0;
  if (!Number.isSafeInteger(cleanupId) || objectKey.length === 0) {
    await serviceClient.rpc("retry_document_storage_cleanup", {
      p_id: cleanupId,
      p_lease_owner: leaseOwner,
      p_error_code: "cleanup_invalid_claim",
      p_retry_delay_seconds: 60
    });
    return jsonResponse({ worker: WORKER_NAME, processed: true });
  }

  try {
    const { error: removeError } = await serviceClient.storage.from("travel-documents").remove([objectKey]);
    if (removeError && !isMissingObjectError(removeError)) {
      await serviceClient.rpc("retry_document_storage_cleanup", {
        p_id: cleanupId,
        p_lease_owner: leaseOwner,
        p_error_code: "storage_unavailable",
        p_retry_delay_seconds: Math.min(60, 5 * 2 ** Math.max(attemptCount - 1, 0))
      });
      return jsonResponse({ worker: WORKER_NAME, processed: true });
    }
    const { error: completeError } = await serviceClient.rpc("complete_document_storage_cleanup", {
      p_id: cleanupId,
      p_lease_owner: leaseOwner
    });
    if (completeError) return jsonResponse({ code: "completion_unavailable" }, 503);
    return jsonResponse({ worker: WORKER_NAME, processed: true });
  } catch {
    return jsonResponse({ code: "worker_unavailable" }, 503);
  }
});
