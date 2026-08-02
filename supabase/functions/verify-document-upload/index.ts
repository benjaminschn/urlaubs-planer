import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const bucket = "travel-documents";
const documentColumns = "id,trip_id,uploaded_by_user_id,original_file_name,reported_content_type,detected_content_type,byte_size,checksum,storage_object_key,status,error_code,version,created_at,updated_at,uploaded_at";

type Verification = { ok: true; detectedContentType: string } | { ok: false; status: "unsupported" | "invalid"; code: string };

function corsHeaders(request: Request): HeadersInit {
  const configuredOrigin = Deno.env.get("APP_ORIGIN") ?? request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": configuredOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "private, no-store",
    Vary: "Origin"
  };
}

function hasBytes(bytes: Uint8Array, offset: number, values: number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function containsBytes(bytes: Uint8Array, values: number[]): boolean {
  for (let offset = 0; offset <= bytes.length - values.length; offset += 1) {
    if (hasBytes(bytes, offset, values)) return true;
  }
  return false;
}

function text(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function dimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } | null {
  if (contentType === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType === "image/gif" && bytes.length >= 10) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (contentType === "image/webp" && hasBytes(bytes, 12, [86, 80, 56, 88]) && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    };
  }
  if (contentType !== "image/jpeg") return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const startOfFrame = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
    if (startOfFrame && offset + 7 < bytes.length) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      };
    }
    offset += segmentLength;
  }
  return null;
}

function verify(bytes: Uint8Array, document: { original_file_name: string; reported_content_type: string | null }): Verification {
  if (bytes.byteLength > MAX_BYTES) return { ok: false, status: "invalid", code: "file_too_large" };
  let detectedContentType: string | null = null;
  if (hasBytes(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) detectedContentType = "application/pdf";
  else if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) detectedContentType = "image/jpeg";
  else if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detectedContentType = "image/png";
  else if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) detectedContentType = "image/webp";
  else if (hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) detectedContentType = "image/gif";
  else {
    const name = document.original_file_name.toLowerCase();
    const textLike = name.endsWith(".eml") || name.endsWith(".txt") || name.endsWith(".text") || name.endsWith(".csv") || document.reported_content_type === "message/rfc822" || document.reported_content_type === "text/plain" || document.reported_content_type === "text/csv";
    if (textLike && !bytes.includes(0)) detectedContentType = name.endsWith(".csv") || document.reported_content_type === "text/csv" ? "text/csv" : name.endsWith(".eml") || document.reported_content_type === "message/rfc822" ? "message/rfc822" : "text/plain";
  }
  if (!detectedContentType) {
    const declared = document.reported_content_type?.toLowerCase().split(";", 1)[0].trim() ?? "";
    const knownExtensions = ["pdf", "jpg", "jpeg", "png", "webp", "gif", "eml", "txt", "text", "csv"];
    return knownExtensions.includes(document.original_file_name.toLowerCase().split(".").pop() ?? "") || ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "message/rfc822", "text/plain", "text/csv"].includes(declared)
      ? { ok: false, status: "invalid", code: "signature_conflict" }
      : { ok: false, status: "unsupported", code: "unsupported_type" };
  }
  const declaredType = document.reported_content_type?.toLowerCase().split(";", 1)[0].trim() ?? "";
  if (declaredType && declaredType !== "application/octet-stream" && declaredType !== detectedContentType) return { ok: false, status: "invalid", code: "signature_conflict" };
  const extension = document.original_file_name.toLowerCase().split(".").pop() ?? "";
  const expectedExtensions: Record<string, string[]> = {
    "application/pdf": ["pdf"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
    "message/rfc822": ["eml"],
    "text/plain": ["txt", "text"],
    "text/csv": ["csv"]
  };
  if (expectedExtensions[detectedContentType] && !expectedExtensions[detectedContentType].includes(extension)) return { ok: false, status: "invalid", code: "signature_conflict" };
  const content = text(bytes);
  if (detectedContentType === "application/pdf") {
    if (!content.includes("%%EOF")) return { ok: false, status: "invalid", code: "invalid_file" };
    if (/\/(?:Encrypt)\b/.test(content)) return { ok: false, status: "invalid", code: "password_protected" };
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(content)) return { ok: false, status: "invalid", code: "active_content" };
  }
  if (detectedContentType.startsWith("image/") && containsBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) return { ok: false, status: "invalid", code: "signature_conflict" };
  if (detectedContentType === "image/gif") {
    const frameCount = bytes.reduce((count, value) => count + (value === 0x2c ? 1 : 0), 0);
    if (frameCount !== 1) return { ok: false, status: "invalid", code: "animated_image" };
  }
  if (detectedContentType.startsWith("image/")) {
    const imageSize = dimensions(bytes, detectedContentType);
    if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) return { ok: false, status: "invalid", code: "invalid_file" };
    if (imageSize.width * imageSize.height > MAX_PIXELS) return { ok: false, status: "invalid", code: "image_too_large" };
  }
  return { ok: true, detectedContentType };
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
    const { data: document, error: documentError } = await userClient
      .from("documents")
      .select(documentColumns)
      .eq("id", body.document_id)
      .maybeSingle();
    if (documentError || !document || !["uploading", "uploaded"].includes(document.status) || document.uploaded_by_user_id !== userData.user.id) return response({ code: "forbidden" }, 403, headers);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: file, error: downloadError } = await serviceClient.storage.from(bucket).download(document.storage_object_key);
    if (downloadError || !file) {
      await serviceClient.from("documents").update({ status: "upload_failed", error_code: "upload_failed", version: document.version + 1, updated_at: new Date().toISOString() }).eq("id", document.id).eq("version", document.version);
      return response({ code: "upload_failed" }, 422, headers);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = verify(bytes, document);
    if (!result.ok) {
      await serviceClient.storage.from(bucket).remove([document.storage_object_key]);
      await serviceClient.from("documents").update({ status: result.status, error_code: result.code, version: document.version + 1, updated_at: new Date().toISOString() }).eq("id", document.id).eq("version", document.version);
      return response({ code: result.code }, 422, headers);
    }
    const digest = await checksum(bytes);
    const { error: updateError } = await serviceClient.from("documents").update({
      status: "available",
      detected_content_type: result.detectedContentType,
      byte_size: bytes.byteLength,
      checksum: digest,
      uploaded_at: new Date().toISOString(),
      error_code: null,
      version: document.version + 1,
      updated_at: new Date().toISOString()
    }).eq("id", document.id).eq("version", document.version).in("status", ["uploading", "uploaded"]);
    if (updateError) return response({ code: "verification_unavailable" }, 503, headers);
    return response({ status: "available" }, 200, headers);
  } catch {
    return response({ code: "verification_unavailable" }, 503, headers);
  }
});
