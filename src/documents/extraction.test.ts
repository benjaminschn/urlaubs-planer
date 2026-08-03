import { describe, expect, it } from "vitest";
import schema from "../../schemas/extraction.schema.json";
import { candidateStartDate, candidateTitle, extractionErrorMessage } from "./extraction";
import type { ExtractionCandidate } from "./types";

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertStrictObjects);
    return;
  }
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (row.type === "object" && row.properties && typeof row.properties === "object") {
    expect(row.additionalProperties).toBe(false);
    expect(new Set(row.required as string[])).toEqual(new Set(Object.keys(row.properties as Record<string, unknown>)));
  }
  Object.values(row).forEach(assertStrictObjects);
}

describe("Extraktionsvertrag", () => {
  it("bleibt strikt, vollständig erforderlich und auf Schema 1.0.0 begrenzt", () => {
    const root = schema as unknown as Record<string, unknown>;
    expect((root.properties as Record<string, Record<string, unknown>>).schema_version.enum).toEqual(["1.0.0"]);
    expect(((root.properties as Record<string, Record<string, unknown>>).events.maxItems)).toBe(12);
    expect(((root.$defs as Record<string, Record<string, unknown>>).evidence_list.maxItems)).toBe(5);
    assertStrictObjects(schema);
  });

  it("zeigt Herkunftsfelder unverändert und neutral an", () => {
    const candidate: ExtractionCandidate = {
      id: "candidate", candidateIndex: 0, proposedEventTypeCode: "flight", status: "draft", version: 1, canonicalPayload: null, confirmedTravelItemId: null, warnings: [],
      fields: [
        { fieldPath: "title", occurrenceKey: "", originalValue: "Berlin → Paris", value: "Berlin → Paris", provenance: "explicit", confidence: 0.98, sourceLocator: [{ pageNumber: 1, sourceHint: "Flight" }] },
        { fieldPath: "start.local_date", occurrenceKey: "", originalValue: "2026-10-04", value: "2026-10-04", provenance: "explicit", confidence: 0.98, sourceLocator: [{ pageNumber: 1, sourceHint: "Departure" }] }
      ]
    };
    expect(candidateTitle(candidate)).toBe("Berlin → Paris");
    expect(candidateStartDate(candidate)).toBe("2026-10-04");
    expect(extractionErrorMessage("invalid_structured_output")).not.toMatch(/OpenAI|Prompt|JSON/i);
  });
});
