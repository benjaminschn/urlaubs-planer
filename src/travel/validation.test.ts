import { describe, expect, it } from "vitest";
import { makeDateOnlyTime, resolveExactLocalTime, validateLocalTime, validateTravelItemPayload } from "./validation";
import type { EventTypeCode, TravelItemPayload } from "./types";

function minimalPayload(eventTypeCode: EventTypeCode): TravelItemPayload {
  return {
    eventTypeCode,
    title: `${eventTypeCode} test`,
    bookingStatus: "confirmed",
    startTime: makeDateOnlyTime("2026-09-01", "date_only"),
    endTime: null,
    locations: { main: null, start: null, end: null },
    commonDetails: {
      providerName: "",
      bookingPlatformName: "",
      managementUrl: "",
      bookingDate: "",
      notes: "",
      references: [],
      travelers: [],
      providerContacts: [],
      price: { total: "", currency: "", paid: "", outstanding: "", taxesAndFees: "", paymentStatus: "", paymentMethodMasked: "" },
      cancellationDeadline: null,
      cancellationConditions: "",
      additionalAttributes: []
    },
    typeDetails: {},
    segments: []
  };
}

describe("Reiseereignis-Zeitwerte", () => {
  it("lässt alle fünf Minimalereignisse ohne erfundene Uhrzeit zu", () => {
    for (const eventType of ["accommodation", "flight", "rail", "bus", "activity"] as const) {
      expect(validateTravelItemPayload(minimalPayload(eventType))).toEqual({});
    }
  });

  it("löst eine exakte Ortszeit mit IANA-Zone, Offset und UTC-Instant konsistent auf", () => {
    const result = resolveExactLocalTime("2026-09-01", "10:00", "Europe/Berlin");

    expect(result.error).toBeNull();
    expect(result.value.utcOffsetMinutes).toBe(120);
    expect(result.value.instantUtc).toBe("2026-09-01T08:00:00.000Z");
    expect(validateLocalTime(result.value, "Beginn")).toBeNull();
  });

  it("blockiert nicht existente und mehrdeutige DST-Ortszeiten", () => {
    const nonexistent = resolveExactLocalTime("2026-03-29", "02:30", "Europe/Berlin");
    const ambiguous = resolveExactLocalTime("2026-10-25", "02:30", "Europe/Berlin");

    expect(nonexistent.error).toBe("nonexistent");
    expect(ambiguous.error).toBe("ambiguous");
  });

  it("weist ein Ende und eine Segmentankunft vor dem Beginn zurück", () => {
    const payload = minimalPayload("rail");
    payload.endTime = makeDateOnlyTime("2026-08-31", "date_only");
    expect(validateTravelItemPayload(payload).endTime).toContain("vor dem Beginn");
    payload.endTime = null;
    payload.segments = [
      {
        sequenceNumber: 1,
        startLocation: { name: "Berlin", fullAddress: null, street: null, houseNumber: null, postalCode: null, city: null, region: null, countryCode: null, locationCodeType: null, locationCode: null, latitude: null, longitude: null, ianaTimeZone: null },
        endLocation: { name: "Hamburg", fullAddress: null, street: null, houseNumber: null, postalCode: null, city: null, region: null, countryCode: null, locationCodeType: null, locationCode: null, latitude: null, longitude: null, ianaTimeZone: null },
        departureTime: makeDateOnlyTime("2026-09-02", "date_only"),
        arrivalTime: makeDateOnlyTime("2026-09-01", "date_only"),
        details: {}
      },
      {
        sequenceNumber: 2,
        startLocation: { name: "Hamburg", fullAddress: null, street: null, houseNumber: null, postalCode: null, city: null, region: null, countryCode: null, locationCodeType: null, locationCode: null, latitude: null, longitude: null, ianaTimeZone: null },
        endLocation: { name: "Kiel", fullAddress: null, street: null, houseNumber: null, postalCode: null, city: null, region: null, countryCode: null, locationCodeType: null, locationCode: null, latitude: null, longitude: null, ianaTimeZone: null },
        departureTime: makeDateOnlyTime("2026-09-02", "date_only"),
        arrivalTime: makeDateOnlyTime("2026-09-02", "date_only"),
        details: {}
      }
    ];
    expect(Object.values(validateTravelItemPayload(payload)).some((message) => message.includes("Ankunft darf nicht"))).toBe(true);
  });
});
