import { describe, expect, it, vi } from "vitest";
import { createSupabaseDocumentGateway } from "./supabase-gateway";

describe("Supabase-Dokumentadapter", () => {
  it("liest einen sicheren Fehlercode aus einer nicht erfolgreichen Edge-Function-Antwort", async () => {
    const client = {
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: {
              clone: () => ({ json: async () => ({ code: "extraction_disabled" }) })
            }
          }
        })
      }
    };
    const gateway = createSupabaseDocumentGateway(client as never);

    const result = await gateway.startExtraction({ documentId: "document-1", idempotencyKey: "request-1" });

    expect(result).toEqual({
      kind: "unavailable",
      code: "extraction_disabled",
      message: "Die Verarbeitung ist derzeit nicht verfügbar."
    });
  });
});
