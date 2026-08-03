import { describe, expect, it } from "vitest";
import { candidateToCanonicalPayload, validateCanonicalPayload } from "./candidate-review";
import type { ExtractionCandidate } from "./types";

function candidate(type: ExtractionCandidate["proposedEventTypeCode"]): ExtractionCandidate {
  return {
    id: "candidate-1",
    candidateIndex: 0,
    proposedEventTypeCode: type,
    status: "draft",
    version: 1,
    canonicalPayload: null,
    confirmedTravelItemId: null,
    warnings: [],
    fields: [
      { fieldPath: "title", occurrenceKey: "", originalValue: "Buchung", value: "Buchung", provenance: "explicit", confidence: 0.9, sourceLocator: [{ pageNumber: 1, sourceHint: "Titel" }] },
      { fieldPath: "start.local_date", occurrenceKey: "", originalValue: "2026-09-01", value: "2026-09-01", provenance: "explicit", confidence: 0.9, sourceLocator: [{ pageNumber: 1, sourceHint: "Datum" }] },
      { fieldPath: "start.precision", occurrenceKey: "", originalValue: "date_only", value: "date_only", provenance: "explicit", confidence: 0.9, sourceLocator: [{ pageNumber: 1, sourceHint: "Datum" }] }
    ]
  };
}

describe("Candidate-Prüfstand", () => {
  it.each(["accommodation", "flight", "rail", "bus", "activity"] as const)("erstellt einen validierbaren %s-Entwurf", (type) => {
    const payload = candidateToCanonicalPayload(candidate(type));
    expect(payload.event_type_code).toBe(type);
    expect(payload.start_time).toEqual(expect.objectContaining({ local_date: "2026-09-01", precision: "date_only", local_time: null }));
    expect(validateCanonicalPayload(payload)).toEqual([]);
  });

  it("bewahrt einen bereits gespeicherten kanonischen Prüfstand unverändert", () => {
    const value = candidate("activity");
    value.canonicalPayload = { event_type_code: "activity", title: "Korrigiert", start_time: { local_date: "2026-09-02" }, segments: [] };
    expect(candidateToCanonicalPayload(value).title).toBe("Korrigiert");
  });

  it("blockiert Bestätigung ohne Pflichtkern", () => {
    expect(validateCanonicalPayload({ event_type_code: "activity", title: "", start_time: null, segments: [] })).toHaveLength(2);
  });
});
