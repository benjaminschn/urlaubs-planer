import { describe, expect, it } from "vitest";
import { formatLocalTime, sortTravelItems } from "./format";
import { makeDateOnlyTime } from "./validation";
import type { TravelItem } from "./types";

function item(id: string, localDate: string, stableSortKey: string, instantUtc: string | null = null): TravelItem {
  const startTime = instantUtc
    ? {
        localDate,
        localTime: "10:00:00",
        precision: "exact_time" as const,
        ianaTimeZone: "Europe/Berlin",
        utcOffsetMinutes: 120,
        instantUtc,
        resolutionStatus: "resolved" as const
      }
    : makeDateOnlyTime(localDate, "date_only");
  return {
    id,
    tripId: "trip",
    eventTypeCode: "activity",
    title: id,
    bookingStatus: "confirmed",
    lifecycleStatus: "active",
    creationSource: "manual",
    startTime,
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
    segments: [],
    stableSortKey,
    version: 1,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  };
}

describe("Timeline-Formatierung", () => {
  it("sortiert Datum-only-Ereignisse bei gleichem Tag stabil nach dem Tie-Breaker", () => {
    const sorted = sortTravelItems([
      item("b", "2026-09-01", "b"),
      item("a", "2026-09-01", "a"),
      item("c", "2026-09-02", "c")
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("sortiert exakte Zeiten innerhalb eines lokalen Reisetags chronologisch", () => {
    const sorted = sortTravelItems([
      item("late", "2026-09-01", "late", "2026-09-01T09:00:00.000Z"),
      item("early", "2026-09-01", "early", "2026-09-01T07:00:00.000Z")
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["early", "late"]);
  });

  it("stellt Datum-only und unbekannte Uhrzeit ohne Standarduhrzeit dar", () => {
    expect(formatLocalTime(makeDateOnlyTime("2026-09-01", "date_only"))).toContain("ganztägig");
    expect(formatLocalTime(makeDateOnlyTime("2026-09-01", "unknown_time"))).toContain("Uhrzeit nicht angegeben");
  });
});
