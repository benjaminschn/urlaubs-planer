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

  it("speichert Feldkorrekturen append-only vor dem bestätigbaren kanonischen Snapshot", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ operation_status: "updated", candidate_id: "candidate-1", version: 5 }], error: null });
    const gateway = createSupabaseDocumentGateway({ rpc } as never);
    const payload = { event_type_code: "activity", title: "Neu" };

    const result = await gateway.saveCandidateReview({
      candidateId: "candidate-1",
      expectedVersion: 3,
      payload,
      corrections: [{ fieldPath: "title", occurrenceKey: "", operation: "set", newValue: "Neu" }]
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_candidate_review", expect.objectContaining({
      p_expected_version: 3,
      p_corrections: [{ field_path: "title", occurrence_key: "", operation: "set", new_value: "Neu" }],
      p_canonical_payload: payload
    }));
    expect(result).toEqual({ kind: "updated", candidateId: "candidate-1", version: 5 });
  });
});
