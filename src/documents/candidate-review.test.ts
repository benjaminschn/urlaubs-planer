import { describe, expect, it } from "vitest";
import {
  candidateCorrections,
  candidateToCanonicalPayload,
  canonicalPayloadToTravelItemPayload,
  travelItemPayloadToCanonicalPayload,
  validateCanonicalPayload
} from "./candidate-review";
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

  it("bewahrt lokale Uhrzeit ohne erfundene Zeitzone als unresolved exact_time", () => {
    const value = candidate("accommodation");
    value.fields.push(
      { fieldPath: "start.local_time", occurrenceKey: "", originalValue: "15:00", value: "15:00", provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "start.precision", occurrenceKey: "", originalValue: "exact_time", value: "exact_time", provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "start.resolution_status", occurrenceKey: "", originalValue: "unresolved", value: "unresolved", provenance: "inferred", confidence: 0.5, sourceLocator: [] }
    );
    expect(candidateToCanonicalPayload(value).start_time).toEqual({
      local_date: "2026-09-01",
      local_time: "15:00",
      precision: "exact_time",
      iana_time_zone: null,
      utc_offset_minutes: null,
      instant_utc: null,
      resolution_status: "unresolved"
    });
  });

  it("übersetzt den strukturierten Prüfstand verlustarm zwischen API- und Formularmodell", () => {
    const canonical = candidateToCanonicalPayload(candidate("flight"));
    canonical.locations = { main: { name: "BER", city: "Berlin", country_code: "DE" }, start: null, end: null };
    canonical.common_details = {
      provider_name: "Beispiel Air",
      notes: "Fensterplatz",
      references: [{ kind: "booking", value: "ABC123" }],
      travelers: ["Ada"],
      provider_contacts: [],
      price: { total: "120.00", currency: "EUR" },
      additional_attributes: []
    };
    const structured = canonicalPayloadToTravelItemPayload(canonical);
    expect(structured.locations.main).toMatchObject({ name: "BER", city: "Berlin", countryCode: "DE" });
    expect(structured.commonDetails.references).toEqual([{ kind: "booking", value: "ABC123" }]);
    expect(travelItemPayloadToCanonicalPayload(structured)).toMatchObject({
      event_type_code: "flight",
      locations: { main: { name: "BER", city: "Berlin", country_code: "DE" } },
      common_details: { provider_name: "Beispiel Air", notes: "Fensterplatz" }
    });
  });

  it("erzeugt nachvollziehbare Feldkorrekturen zusätzlich zum kanonischen Snapshot", () => {
    const previous = { title: "Alt", common_details: { notes: "" }, segments: [] };
    const next = { title: "Neu", common_details: { notes: "Prüfen" }, segments: [{ sequence_number: 1 }] };
    expect(candidateCorrections(previous, next)).toEqual([
      expect.objectContaining({ fieldPath: "title", operation: "set", newValue: "Neu" }),
      expect.objectContaining({ fieldPath: "common_details.notes", operation: "set", newValue: "Prüfen" }),
      expect.objectContaining({ fieldPath: "segments", operation: "reorder" })
    ]);
  });

  it("hydratisiert Orte, gemeinsame Details, Preise, Zusatzangaben und Verkehrssegmente aus Evidenz", () => {
    const value = candidate("flight");
    value.fields.push(
      { fieldPath: "main_location.name", occurrenceKey: "", originalValue: "BER", value: "BER", provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "main_location.city", occurrenceKey: "", originalValue: "Berlin", value: "Berlin", provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "booking_references", occurrenceKey: "", originalValue: [{ kind: "other", value: "X-1" }], value: [{ kind: "other", value: "X-1" }], provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "travelers", occurrenceKey: "", originalValue: ["Ada", "Lin"], value: ["Ada", "Lin"], provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "provider_contacts", occurrenceKey: "", originalValue: [{ role: "Airline", phone: "+49", email: "", website: "" }], value: [{ role: "Airline", phone: "+49", email: "", website: "" }], provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "pricing.total_amount", occurrenceKey: "", originalValue: "199.00", value: "199.00", provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "pricing.currency", occurrenceKey: "", originalValue: "EUR", value: "EUR", provenance: "explicit", confidence: 0.9, sourceLocator: [] },
      { fieldPath: "additional_attributes", occurrenceKey: "", originalValue: [{ label: "Tarif", value: "Flex", unit: null }], value: [{ label: "Tarif", value: "Flex", unit: null }], provenance: "explicit", confidence: 0.9, sourceLocator: [] }
    );
    for (const [index, date, from, to] of [[0, "2026-09-01", "BER", "MUC"], [1, "2026-09-02", "MUC", "FCO"]] as const) {
      const occurrenceKey = `details.flight.segments:${index}`;
      value.fields.push(
        { fieldPath: "details.flight.segments.departure_location.name", occurrenceKey, originalValue: from, value: from, provenance: "explicit", confidence: 0.9, sourceLocator: [] },
        { fieldPath: "details.flight.segments.arrival_location.name", occurrenceKey, originalValue: to, value: to, provenance: "explicit", confidence: 0.9, sourceLocator: [] },
        { fieldPath: "details.flight.segments.departure.local_date", occurrenceKey, originalValue: date, value: date, provenance: "explicit", confidence: 0.9, sourceLocator: [] },
        { fieldPath: "details.flight.segments.arrival.local_date", occurrenceKey, originalValue: date, value: date, provenance: "explicit", confidence: 0.9, sourceLocator: [] },
        { fieldPath: "details.flight.segments.flight_number", occurrenceKey, originalValue: `XY${index + 1}`, value: `XY${index + 1}`, provenance: "explicit", confidence: 0.9, sourceLocator: [] }
      );
    }
    const payload = candidateToCanonicalPayload(value);
    expect(payload).toMatchObject({
      locations: { main: { name: "BER", city: "Berlin" } },
      common_details: { references: [{ kind: "other", value: "X-1" }], travelers: ["Ada", "Lin"], price: { total: "199.00", currency: "EUR" }, additional_attributes: [{ label: "Tarif", value: "Flex", unit: "" }] }
    });
    expect(payload.segments).toHaveLength(2);
    expect((payload.segments as Record<string, unknown>[])[1]).toMatchObject({ start_location: { name: "MUC" }, end_location: { name: "FCO" }, details: { number: "XY2" } });
  });
});
