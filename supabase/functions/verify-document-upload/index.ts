import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import { validateDocumentBytes } from "../_shared/document-verification.ts";

const bucket = "travel-documents";

function requestOriginAllowed(request: Request): boolean {
  const requestOrigin = request.headers.get("origin");
  const configuredOrigin = Deno.env.get("APP_ORIGIN");
  return requestOrigin === null || (configuredOrigin !== undefined && requestOrigin === configuredOrigin);
}

function corsHeaders(request: Request): HeadersInit {
  const requestOrigin = request.headers.get("origin");
  const configuredOrigin = Deno.env.get("APP_ORIGIN");
  return {
    ...(requestOrigin && configuredOrigin === requestOrigin ? { "Access-Control-Allow-Origin": configuredOrigin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "private, no-store",
    Vary: "Origin"
  };
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function response(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!requestOriginAllowed(request)) return response({ code: "forbidden" }, 403, headers);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return response({ code: "method_not_allowed" }, 405, headers);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response({ code: "forbidden" }, 401, headers);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ code: "verification_unavailable" }, 503, headers);

  try {
    const body = await request.json() as { document_id?: unknown };
    if (typeof body.document_id !== "string" || !/^[0-9a-f-]{36}$/.test(body.document_id)) return response({ code: "invalid_file" }, 400, headers);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return response({ code: "forbidden" }, 401, headers);
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const leaseOwner = crypto.randomUUID();
    const { data: claimData, error: claimError } = await userClient.rpc("claim_document_verification", {
      p_document_id: body.document_id,
      p_lease_owner: leaseOwner,
      p_lease_seconds: 60
    });
    const document = Array.isArray(claimData) ? claimData[0] : claimData;
    if (claimError || !document || document.uploaded_by_user_id !== userData.user.id) {
      return response({ code: "verification_unavailable" }, 409, headers);
    }
    const { data: file, error: downloadError } = await serviceClient.storage.from(bucket).download(document.storage_object_key);
    if (downloadError || !file) {
      await serviceClient.rpc("defer_document_verification", {
        p_document_id: document.id,
        p_lease_owner: leaseOwner,
        p_expected_version: document.version,
        p_detected_content_type: null,
        p_byte_size: null,
        p_checksum: null,
        p_error_code: "verification_unavailable"
      });
      return response({ code: "verification_unavailable" }, 503, headers);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateDocumentBytes(bytes, document.original_file_name, document.reported_content_type);
    if (validation.kind === "invalid") {
      const status = validation.code === "unsupported_type" ? "unsupported" : "invalid";
      const { data: rejected } = await serviceClient.rpc("reject_document_verification", {
        p_document_id: document.id,
        p_lease_owner: leaseOwner,
        p_expected_version: document.version,
        p_status: status,
        p_error_code: validation.code
      });
      if (rejected !== true) return response({ code: "verification_unavailable" }, 409, headers);
      const { error: removeError } = await serviceClient.storage.from(bucket).remove([document.storage_object_key]);
      if (removeError) return response({ code: "verification_cleanup_pending" }, 503, headers);
      await serviceClient.rpc("complete_document_storage_cleanup_for_document", {
        p_document_id: document.id
      });
      return response({ code: validation.code }, 422, headers);
    }

    const digest = await checksum(bytes);
    const { data: published, error: publishError } = await serviceClient.rpc("publish_document_verification", {
      p_document_id: document.id,
      p_lease_owner: leaseOwner,
      p_expected_version: document.version,
      p_detected_content_type: validation.detectedContentType,
      p_byte_size: bytes.byteLength,
      p_checksum: digest
    });
    if (publishError || published !== true) return response({ code: "verification_unavailable" }, 409, headers);
    return response({ status: "available" }, 200, headers);
  } catch {
    return response({ code: "verification_unavailable" }, 503, headers);
  }
});
