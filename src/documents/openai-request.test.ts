import { describe, expect, it } from "vitest";
import {
  buildOpenAIResponseBody,
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
        message: "Sensitive compiler text that matches no approved classifier"
      }
    })).toBe("schema_invalid_unclassified");
    expect(safeOpenAIInvalidSchemaReason({
      error: { code: "invalid_request_error", message: "too many object properties" }
    })).toBeNull();
  });
});
