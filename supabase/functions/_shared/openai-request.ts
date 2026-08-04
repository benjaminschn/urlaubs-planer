export type OpenAIInputKind = "file" | "image";

const imageContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function openAIInputKind(contentType: string): OpenAIInputKind {
  return imageContentTypes.has(contentType) ? "image" : "file";
}

export function openAIFilePurpose(contentType: string): "user_data" | "vision" {
  return openAIInputKind(contentType) === "image" ? "vision" : "user_data";
}

export function safeOpenAIErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const record = error as Record<string, unknown>;
  const value = typeof record.code === "string"
    ? record.code
    : typeof record.type === "string"
      ? record.type
      : null;
  return value && /^[a-z0-9_]{1,60}$/.test(value) ? value : null;
}

export function safeOpenAIInvalidSchemaReason(body: unknown): string | null {
  if (safeOpenAIErrorCode(body) !== "invalid_json_schema") return null;
  const error = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).error
    : null;
  const message = error && typeof error === "object" && !Array.isArray(error)
    ? (error as Record<string, unknown>).message
    : null;
  if (typeof message !== "string") return null;

  const classifiers: Array<[RegExp, string]> = [
    [/too many (?:object )?properties|exceeds?.*propert(?:y|ies).*limit/i, "schema_property_limit"],
    [/nesting depth|too many levels|exceeds?.*depth/i, "schema_depth_limit"],
    [/total string|string.*(?:size|length).*limit/i, "schema_string_limit"],
    [/too many enum|enum.*(?:size|length).*limit/i, "schema_enum_limit"],
    [/additionalProperties/i, "schema_additional_properties"],
    [/(?:missing|required).*['"]required['"]|['"]required['"].*(?:missing|required)/i, "schema_required_fields"],
    [/(?:unsupported|not permitted|not supported).*keyword|keyword.*(?:unsupported|not permitted|not supported)/i, "schema_unsupported_keyword"],
    [/array schema.*items|items.*(?:missing|required)/i, "schema_array_items"],
    [/invalid.*\$ref|reference.*(?:invalid|unresolved)|unresolved.*reference/i, "schema_reference"],
    [/root.*(?:object|anyOf)|(?:object|anyOf).*root/i, "schema_root"],
    [/invalid.*type|type.*(?:invalid|unsupported|not permitted)/i, "schema_type"]
  ];
  return classifiers.find(([pattern]) => pattern.test(message))?.[1] ?? "schema_invalid_unclassified";
}

export function buildOpenAIResponseBody(options: {
  model: string;
  maxOutputTokens: number;
  instructions: string;
  prompt: string;
  providerFileId: string;
  contentType: string;
  schema: unknown;
}): Record<string, unknown> {
  const media = openAIInputKind(options.contentType) === "image"
    ? { type: "input_image", file_id: options.providerFileId, detail: "auto" }
    : { type: "input_file", file_id: options.providerFileId, detail: "auto" };

  return {
    model: options.model,
    store: false,
    max_output_tokens: options.maxOutputTokens,
    instructions: options.instructions,
    input: [{
      role: "user",
      content: [media, { type: "input_text", text: options.prompt }]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "travel_document_extraction",
        strict: true,
        schema: options.schema
      }
    }
  };
}
