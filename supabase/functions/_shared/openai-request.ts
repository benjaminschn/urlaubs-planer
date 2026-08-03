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
