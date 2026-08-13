export type OpenAIInputKind = "file" | "image";
type RecordLike = Record<string, unknown>;

export type OpenAIResponseAccounting = {
  requestId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usage: RecordLike;
};

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
  const classified = classifiers.find(([pattern]) => pattern.test(message))?.[1];
  if (classified) return classified;

  const safeWords = new Set([
    "properties", "items", "type", "object", "array", "string", "number",
    "integer", "boolean", "null", "anyof", "ref", "defs", "enum", "required",
    "additionalproperties", "must", "be", "is", "are", "missing", "provided",
    "supplied", "false", "true", "unsupported", "supported", "keyword",
    "permitted", "expected", "limit", "maximum", "minimum", "exceeds", "too",
    "many", "depth", "levels", "length", "size", "title", "description",
    "minlength", "maxlength", "minitems", "maxitems", "pattern", "format",
    "multipleof", "exclusiveminimum", "exclusivemaximum", "oneof", "allof",
    "patternproperties", "minproperties", "maxproperties", "uniqueitems",
    "dependentrequired", "dependentschemas", "const", "default", "examples",
    "not", "allowed", "valid", "under", "any", "given", "schemas", "does",
    "match", "one", "with", "without", "cannot", "can", "used", "when",
    "value", "values", "should", "only", "at", "least", "exactly", "greater",
    "less", "than", "equal", "zero", "positive", "negative", "long", "shorter",
    "have", "has", "contain", "contains", "include", "includes", "exclusive",
    "branch", "branches", "definition", "definitions", "reference", "references",
    "recursive", "recursion", "sibling", "siblings", "constraint", "constraints",
    "field", "fields", "key", "keys"
  ]);
  const shape = (message.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((word, index, words) => safeWords.has(word) && word !== words[index - 1]
      && !(word === "format" && words[index - 1] === "response"))
    .slice(0, 20)
    .join("_");
  if (shape && shape !== "is" && shape !== "is_valid") return `schema_shape_${shape}`;

  const withoutIdentifiers = message.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, " ");
  const firstSeparator = withoutIdentifiers.indexOf(":");
  const finalClause = firstSeparator >= 0 ? withoutIdentifiers.slice(firstSeparator + 1) : withoutIdentifiers;
  const ignoredWords = new Set(["invalid", "schema", "for", "response", "format", "in", "context"]);
  const template = (finalClause.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((word) => !ignoredWords.has(word))
    .slice(0, 12)
    .join("_");
  return template ? `schema_template_${template}` : "schema_invalid_unclassified";
}

export function dereferenceJsonSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const root = schema as Record<string, unknown>;
  const definitions = root.$defs && typeof root.$defs === "object" && !Array.isArray(root.$defs)
    ? root.$defs as Record<string, unknown>
    : {};

  const expand = (value: unknown, stack: Set<string>): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => expand(item, stack));
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string" && record.$ref.startsWith("#/$defs/")) {
      const name = record.$ref.slice(8);
      if (!(name in definitions) || stack.has(name)) throw new Error("Unsupported JSON Schema reference");
      return expand(definitions[name], new Set([...stack, name]));
    }
    return Object.fromEntries(Object.entries(record)
      .filter(([key]) => key !== "$defs")
      .map(([key, child]) => [key, expand(child, stack)]));
  };

  return expand(root, new Set());
}

export function extractOpenAIStructuredText(body: unknown): { text: string; requestId: string | null; usage: RecordLike | null } | null {
  const response = body && typeof body === "object" && !Array.isArray(body) ? body as RecordLike : null;
  if (!response) return null;
  const output = Array.isArray(response.output) ? response.output : null;
  if (!output) return null;
  const items = output.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as RecordLike : null);
  if (items.some((item) => !item || item.type !== "reasoning" && item.type !== "message")) return null;
  const messages = items.filter((item): item is RecordLike => item?.type === "message");
  if (messages.length !== 1) return null;
  const content = Array.isArray(messages[0].content) ? messages[0].content : null;
  if (!content || content.length !== 1) return null;
  const part = content[0] && typeof content[0] === "object" && !Array.isArray(content[0]) ? content[0] as RecordLike : null;
  if (part?.type !== "output_text" || typeof part.text !== "string") return null;
  const usage = response.usage && typeof response.usage === "object" && !Array.isArray(response.usage) ? response.usage as RecordLike : null;
  return { text: part.text, requestId: typeof response.id === "string" ? response.id : null, usage };
}

export function extractOpenAIResponseAccounting(body: unknown): OpenAIResponseAccounting | null {
  const response = body && typeof body === "object" && !Array.isArray(body) ? body as RecordLike : null;
  const usage = response?.usage && typeof response.usage === "object" && !Array.isArray(response.usage)
    ? response.usage as RecordLike
    : null;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const inputDetails = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" && !Array.isArray(usage.input_tokens_details)
    ? usage.input_tokens_details as RecordLike : null;
  const cachedInputTokens = inputDetails?.cached_tokens ?? 0;
  if (!response || typeof response.id !== "string" || response.id.length < 1
    || !Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0
    || !Number.isSafeInteger(cachedInputTokens) || (cachedInputTokens as number) < 0 || (cachedInputTokens as number) > (inputTokens as number)
    || !Number.isSafeInteger(outputTokens) || (outputTokens as number) < 0) return null;
  return { requestId: response.id, inputTokens: inputTokens as number, cachedInputTokens: cachedInputTokens as number, outputTokens: outputTokens as number, usage: usage as RecordLike };
}

export function calculateOpenAICostMicroEur(
  accounting: Pick<OpenAIResponseAccounting, "inputTokens" | "cachedInputTokens" | "outputTokens">,
  inputMicroEurPerToken: number,
  cachedInputMicroEurPerToken: number,
  outputMicroEurPerToken: number
): number | null {
  if (!Number.isFinite(inputMicroEurPerToken) || inputMicroEurPerToken < 0
    || !Number.isFinite(cachedInputMicroEurPerToken) || cachedInputMicroEurPerToken < 0
    || !Number.isFinite(outputMicroEurPerToken) || outputMicroEurPerToken < 0
    || accounting.cachedInputTokens < 0 || accounting.cachedInputTokens > accounting.inputTokens) return null;
  const cost = (accounting.inputTokens - accounting.cachedInputTokens) * inputMicroEurPerToken
    + accounting.cachedInputTokens * cachedInputMicroEurPerToken
    + accounting.outputTokens * outputMicroEurPerToken;
  return Number.isSafeInteger(Math.ceil(cost)) ? Math.ceil(cost) : null;
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
        schema: dereferenceJsonSchema(options.schema)
      }
    }
  };
}
