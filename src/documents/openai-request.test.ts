import { describe, expect, it } from "vitest";
import {
  buildOpenAIResponseBody,
  dereferenceJsonSchema,
  extractOpenAIStructuredText,
  openAIFilePurpose,
  openAIInputKind,
  safeOpenAIErrorCode,
  safeOpenAIInvalidSchemaReason
} from "../../supabase/functions/_shared/openai-request";

describe("OpenAI document input adapter", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/gif"])(
    "uses the vision contract for %s",
    (contentType) => {
      expect(openAIFilePurpose(contentType)).toBe("vision");
      expect(openAIInputKind(contentType)).toBe("image");
      const body = buildOpenAIResponseBody({
        model: "test-model",
        maxOutputTokens: 512,
        instructions: "system",
        prompt: "extract",
        providerFileId: "file_test",
        contentType,
        schema: { type: "object" }
      });
      expect(body.input).toEqual([{
        role: "user",
        content: [
          { type: "input_image", file_id: "file_test", detail: "auto" },
          { type: "input_text", text: "extract" }
        ]
      }]);
    }
  );

  it.each(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "message/rfc822"])(
    "uses the file-input contract for %s",
    (contentType) => {
      expect(openAIFilePurpose(contentType)).toBe("user_data");
      expect(openAIInputKind(contentType)).toBe("file");
      const body = buildOpenAIResponseBody({
        model: "test-model",
        maxOutputTokens: 512,
        instructions: "system",
        prompt: "extract",
        providerFileId: "file_test",
        contentType,
        schema: { type: "object" }
      });
      expect(body.input).toEqual([{
        role: "user",
        content: [
          { type: "input_file", file_id: "file_test", detail: "auto" },
          { type: "input_text", text: "extract" }
        ]
      }]);
    }
  );

  it("keeps only a bounded provider error code and never the provider message", () => {
    expect(safeOpenAIErrorCode({
      error: {
        code: "invalid_json_schema",
        message: "sensitive provider detail"
      }
    })).toBe("invalid_json_schema");
    expect(safeOpenAIErrorCode({ error: { code: "unsafe-code/with-details" } })).toBeNull();
    expect(safeOpenAIErrorCode({ error: { type: "invalid_request_error" } })).toBe("invalid_request_error");
  });

  it("classifies invalid schema messages without retaining their text", () => {
    expect(safeOpenAIInvalidSchemaReason({
      error: {
        code: "invalid_json_schema",
        message: "Invalid schema: too many object properties in a sensitive.path"
      }
    })).toBe("schema_property_limit");
    expect(safeOpenAIInvalidSchemaReason({
      error: {
        code: "invalid_json_schema",
        message: "Invalid schema: additionalProperties must be false at a sensitive.path"
      }
    })).toBe("schema_additional_properties");
    expect(safeOpenAIInvalidSchemaReason({
      error: {
        code: "invalid_json_schema",
        message: "Invalid schema for response_format 'secret_field': In context=('secret_path'), '$defs' is not permitted."
      }
    })).toBe("schema_shape_field_defs_is_not_permitted");
    expect(safeOpenAIInvalidSchemaReason({
      error: {
        code: "invalid_json_schema",
        message: "Invalid schema for response_format 'secretPath': 'sensitive.path' is valid although composite nodes disagree."
      }
    })).toBe("schema_template_is_valid_although_composite_nodes_disagree");
    expect(safeOpenAIInvalidSchemaReason({
      error: { code: "invalid_request_error", message: "too many object properties" }
    })).toBeNull();
  });

  it("expands local definitions for the provider without mutating the canonical schema", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["item"],
      properties: { item: { $ref: "#/$defs/item" } },
      $defs: {
        item: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: { type: "string" } }
        }
      }
    };

    expect(dereferenceJsonSchema(schema)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["item"],
      properties: {
        item: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: { type: "string" } }
        }
      }
    });
    expect(schema.properties.item).toEqual({ $ref: "#/$defs/item" });
  });

  it("selects one message while allowing reasoning output items", () => {
    expect(extractOpenAIStructuredText({
      id: "resp_test",
      usage: { input_tokens: 10, output_tokens: 20 },
      output: [
        { type: "reasoning", encrypted_content: "opaque" },
        { type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }
      ]
    })).toEqual({
      text: "{\"ok\":true}",
      requestId: "resp_test",
      usage: { input_tokens: 10, output_tokens: 20 }
    });
    expect(extractOpenAIStructuredText({ output: [
      { type: "message", content: [{ type: "output_text", text: "one" }] },
      { type: "message", content: [{ type: "output_text", text: "two" }] }
    ] })).toBeNull();
    expect(extractOpenAIStructuredText({ output: [
      { type: "function_call" },
      { type: "message", content: [{ type: "output_text", text: "one" }] }
    ] })).toBeNull();
  });
});
