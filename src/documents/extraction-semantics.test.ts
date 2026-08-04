import { describe, expect, it } from "vitest";
import { validateAndAdapt } from "../../supabase/functions/_shared/extraction-semantics";

type FieldShell = {
  value: unknown;
  provenance: string;
  confidence: number | null;
  evidence: Array<{ page_number: number; source_hint: string }>;
};

type TimeShell = {
  local_date: FieldShell;
  local_time: FieldShell;
  precision: FieldShell;
  iana_time_zone: FieldShell;
  utc_offset: FieldShell;
  instant_utc: FieldShell;
  resolution_status: FieldShell;
};

type TestEvent = {
  event_index: number;
  event_type: FieldShell;
  title: FieldShell;
  start: TimeShell;
  end: TimeShell;
  cancellation_deadline: TimeShell;
  booking_reference: FieldShell;
  details: Record<string, unknown>;
  notes?: FieldShell;
  provider_name?: FieldShell;
};

function known(value: unknown): FieldShell {
  return { value, provenance: "explicit", confidence: 0.9, evidence: [{ page_number: 1, source_hint: "Bestätigung" }] };
}

function unknown(): FieldShell {
  return { value: null, provenance: "unknown", confidence: null, evidence: [] };
}

function dateOnly(date: string | null = null): TimeShell {
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

function event(eventIndex: number, eventType: string, title = `${eventType} Buchung`): TestEvent {
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
    invalidTime.start.local_date = known("not-a-date");
    expect(validateAndAdapt({ result: "completed", events: [invalidTime], warnings: [] })).toEqual({ error: "semantics_time" });

    const secret = { ...event(0, "flight"), booking_reference: known("4111 1111 1111 1111") };
    expect(validateAndAdapt({ result: "completed", events: [secret], warnings: [] })).toEqual({ error: "semantics_secret" });
  });

  it("erlaubt realistische Hotelzeiten inklusive unvollständiger oder fehlmarkierter Zeitfelder", () => {
    const hotel = event(0, "accommodation", "Testhotel Berlin");
    hotel.start = {
      local_date: known("2026-08-15"),
      local_time: known("15:00"),
      precision: known("date_only"), // model mislabel
      iana_time_zone: known(""),
      utc_offset: known(""),
      instant_utc: unknown(),
      resolution_status: known("resolved") // incomplete but still reviewable
    };
    hotel.end = {
      local_date: known("2026-08-17"),
      local_time: known("11:00:00"),
      precision: known("exact_time"),
      iana_time_zone: known("Europe/Berlin"),
      utc_offset: known("+02:00"),
      instant_utc: known("2026-08-17T09:00:00+00:00"),
      resolution_status: known("unresolved")
    };
    hotel.cancellation_deadline = {
      local_date: unknown(),
      local_time: unknown(),
      precision: unknown(),
      iana_time_zone: unknown(),
      utc_offset: unknown(),
      instant_utc: unknown(),
      resolution_status: unknown()
    };

    const result = validateAndAdapt({ result: "completed", events: [hotel], warnings: [] });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].proposed_event_type_code).toBe("accommodation");
    expect(result.candidates[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_path: "title", original_value: "Testhotel Berlin" }),
      expect.objectContaining({ field_path: "start.local_date", original_value: "2026-08-15" }),
      expect.objectContaining({ field_path: "start.local_time", original_value: "15:00" })
    ]));
  });

  it("bewahrt den Nullfall ohne Kandidaten", () => {
    expect(validateAndAdapt({ result: "no_relevant_events", events: [], warnings: [] })).toEqual({ candidates: [], warnings: [] });
  });

  it("normalisiert unvollständige Feldhüllen statt den gesamten Lauf zu verwerfen", () => {
    const hotel = event(0, "accommodation", "Testhotel Berlin");
    // explicit without evidence / confidence — common model drift
    hotel.title = { value: "Testhotel Berlin", provenance: "explicit", confidence: null, evidence: [] };
    // blank string marked explicit → unknown
    hotel.notes = { value: "   ", provenance: "explicit", confidence: 0.4, evidence: [] };
    // value present but provenance unknown → inferred
    hotel.provider_name = { value: "Booking Test", provenance: "unknown", confidence: null, evidence: [] };

    const result = validateAndAdapt({ result: "completed", events: [hotel], warnings: [] });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.candidates[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_path: "title", original_value: "Testhotel Berlin", provenance: "explicit", confidence: null }),
      expect.objectContaining({ field_path: "notes", original_value: null, provenance: "unknown", confidence: null }),
      expect.objectContaining({ field_path: "provider_name", original_value: "Booking Test", provenance: "inferred" })
    ]));
  });

  it("normalisiert 1-basierte event_index-Werte in stabile Kandidatenreihenfolge", () => {
    const first = event(1, "accommodation", "Hotel A");
    const second = event(2, "flight", "Flug B");
    const result = validateAndAdapt({
      result: "partial",
      events: [second, first],
      warnings: [{ code: "ambiguous_information", severity: "review", event_index: 1, field_path: null, message: "Bitte prüfen", evidence: [] }]
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.candidates.map((candidate) => ({
      index: candidate.candidate_index,
      type: candidate.proposed_event_type_code,
      title: candidate.fields.find((field) => field.field_path === "title")?.original_value
    }))).toEqual([
      { index: 0, type: "accommodation", title: "Hotel A" },
      { index: 1, type: "flight", title: "Flug B" }
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ambiguous_information", event_index: 0 })
    ]));
  });
});
