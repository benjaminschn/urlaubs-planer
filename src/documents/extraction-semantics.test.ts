import { describe, expect, it } from "vitest";
import { validateAndAdapt } from "../../supabase/functions/_shared/extraction-semantics";

function known(value: unknown) {
  return { value, provenance: "explicit", confidence: 0.9, evidence: [{ page_number: 1, source_hint: "Bestätigung" }] };
}

function unknown() {
  return { value: null, provenance: "unknown", confidence: null, evidence: [] };
}

function dateOnly(date: string | null = null) {
  return {
    local_date: date ? known(date) : unknown(),
    local_time: unknown(),
    precision: date ? known("date_only") : unknown(),
    iana_time_zone: unknown(),
    utc_offset: unknown(),
    instant_utc: unknown(),
    resolution_status: unknown()
  };
}

function event(eventIndex: number, eventType: string, title = `${eventType} Buchung`) {
  return {
    event_index: eventIndex,
    event_type: known(eventType),
    title: known(title),
    start: dateOnly("2026-09-01"),
    end: dateOnly(),
    cancellation_deadline: dateOnly(),
    booking_reference: unknown(),
    details: eventType === "generic" ? { generic: { category: known("bus") } } : {}
  };
}

describe("Extraktionssemantik", () => {
  it("mappt die erlaubten Typen deterministisch und bewahrt unbekannte Feldwerte", () => {
    const events = [
      event(0, "accommodation"),
      event(1, "flight"),
      event(2, "train"),
      event(3, "generic"),
      { ...event(4, "generic"), details: { generic: { category: known("museum") } } },
      { ...event(5, "generic"), details: { generic: { category: known("ferry") } } }
    ];
    const result = validateAndAdapt({ result: "partial", events, warnings: [{ code: "ambiguous_information", severity: "review", event_index: 0, field_path: null, message: "Bitte prüfen", evidence: [] }] });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.candidates.map((candidate) => candidate.proposed_event_type_code)).toEqual(["accommodation", "flight", "rail", "bus", "activity"]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsupported_event_kind", event_index: 5 })]));
    expect(result.candidates[0].fields).toEqual(expect.arrayContaining([expect.objectContaining({ field_path: "booking_reference", original_value: null, provenance: "unknown", confidence: null, source_locator: [] })]));
  });

  it("lehnt ungültige Zeiten und geheime Werte vor jeder Persistenz ab", () => {
    const invalidTime = event(0, "flight");
    invalidTime.start.precision = known("exact_time");
    expect(validateAndAdapt({ result: "completed", events: [invalidTime], warnings: [] })).toEqual({ error: "invalid_extraction_semantics" });

    const secret = { ...event(0, "flight"), booking_reference: known("4111 1111 1111 1111") };
    expect(validateAndAdapt({ result: "completed", events: [secret], warnings: [] })).toEqual({ error: "invalid_extraction_semantics" });
  });

  it("bewahrt den Nullfall ohne Kandidaten", () => {
    expect(validateAndAdapt({ result: "no_relevant_events", events: [], warnings: [] })).toEqual({ candidates: [], warnings: [] });
  });
});
