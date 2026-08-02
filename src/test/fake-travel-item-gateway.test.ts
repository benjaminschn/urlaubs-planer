import { describe, expect, it } from "vitest";
import { createFakeTravelItemGateway } from "./fake-travel-item-gateway";
import { makeDateOnlyTime } from "../travel/validation";
import type { EventTypeCode, TravelItemPayload } from "../travel/types";

function payload(eventTypeCode: EventTypeCode, title: string = eventTypeCode): TravelItemPayload {
  return {
    eventTypeCode,
    title,
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

describe("TravelItem-Aggregat", () => {
  it("legt ein Ereignis idempotent an, aktualisiert es versionsgeprüft und löscht fachlich", async () => {
    const fake = createFakeTravelItemGateway();
    const created = await fake.gateway.createTravelItem({ tripId: fake.gateway ? "22222222-2222-4222-8222-222222222222" : "", payload: payload("activity"), idempotencyKey: "create-1" });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const replay = await fake.gateway.createTravelItem({ tripId: created.item.tripId, payload: payload("activity"), idempotencyKey: "create-1" });
    expect(replay.kind).toBe("created");
    expect(fake.calls.create).toBe(2);

    const conflict = await fake.gateway.updateTravelItem({
      tripId: created.item.tripId,
      travelItemId: created.item.id,
      expectedVersion: 0,
      payload: payload("activity", "Konflikt"),
      idempotencyKey: "update-conflict"
    });
    expect(conflict.kind).toBe("conflict");

    const updated = await fake.gateway.updateTravelItem({
      tripId: created.item.tripId,
      travelItemId: created.item.id,
      expectedVersion: created.item.version,
      payload: payload("activity", "Geändert"),
      idempotencyKey: "update-1"
    });
    expect(updated.kind).toBe("updated");
    if (updated.kind !== "updated") return;
    expect(updated.item.version).toBe(2);

    const deleted = await fake.gateway.deleteTravelItem({
      tripId: created.item.tripId,
      travelItemId: created.item.id,
      expectedVersion: updated.item.version,
      idempotencyKey: "delete-1"
    });
    expect(deleted).toEqual({ kind: "deleted", itemId: created.item.id });
    const loaded = await fake.gateway.getTravelItems(created.item.tripId);
    expect(loaded).toEqual({ kind: "ready", items: [] });
  });

  it("weist das 31. aktive Ereignis serverähnlich über das Gateway zurück", async () => {
    const fake = createFakeTravelItemGateway();
    const tripId = "22222222-2222-4222-8222-222222222222";
    for (let index = 0; index < 30; index += 1) {
      const result = await fake.gateway.createTravelItem({ tripId, payload: payload("activity", `Ereignis ${index}`), idempotencyKey: `create-${index}` });
      expect(result.kind).toBe("created");
    }
    const result = await fake.gateway.createTravelItem({ tripId, payload: payload("activity", "Zu viel"), idempotencyKey: "create-31" });
    expect(result.kind).toBe("limit");
  });
});
