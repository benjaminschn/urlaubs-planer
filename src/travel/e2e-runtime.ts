import { validateTravelItemPayload } from "./validation";
import type { Location, TravelItem, TravelItemGateway, TravelItemPayload } from "./types";

const storageKey = "gemeinsamer-reiseplaner-e2e-travel-items";
const channelName = "gemeinsamer-reiseplaner-e2e-travel-items-realtime";
const tripId = "11111111-1111-4111-8111-111111111111";

function readItems(): TravelItem[] {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TravelItem[]) : [];
  } catch {
    return [];
  }
}

function writeItems(items: TravelItem[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(items));
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  channel?.postMessage({ type: "travel-items-updated" });
  channel?.close();
}

function locationFromInput(value: TravelItemPayload["locations"]["main"], id: string): Location | null {
  return value ? { ...value, id } : null;
}

function itemFromPayload(payload: TravelItemPayload, id: string, version = 1, createdAt = new Date().toISOString()): TravelItem {
  const updatedAt = new Date().toISOString();
  return {
    id,
    tripId,
    eventTypeCode: payload.eventTypeCode,
    title: payload.title.trim(),
    bookingStatus: payload.bookingStatus,
    lifecycleStatus: "active",
    creationSource: "manual",
    startTime: payload.startTime,
    endTime: payload.endTime,
    locations: {
      main: locationFromInput(payload.locations.main, `${id}-main`),
      start: locationFromInput(payload.locations.start, `${id}-start`),
      end: locationFromInput(payload.locations.end, `${id}-end`)
    },
    commonDetails: payload.commonDetails,
    typeDetails: payload.typeDetails,
    segments: payload.segments.map((segment, index) => ({
      ...segment,
      id: segment.id ?? `${id}-segment-${index + 1}`,
      sequenceNumber: index + 1,
      startLocation: locationFromInput(segment.startLocation, `${id}-segment-${index + 1}-start`)!,
      endLocation: locationFromInput(segment.endLocation, `${id}-segment-${index + 1}-end`)!
    })),
    stableSortKey: id,
    version,
    createdAt,
    updatedAt
  };
}

export function createRuntimeTravelItemGateway(): TravelItemGateway {
  const idempotency = new Map<string, string>();
  return {
    async getTravelItems(requestTripId) {
      return { kind: "ready", items: requestTripId === tripId ? readItems().filter((item) => item.lifecycleStatus === "active") : [] };
    },
    async createTravelItem(input) {
      const existingId = idempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = readItems().find((item) => item.id === existingId);
        return existing ? { kind: "created", item: existing } : { kind: "unavailable", message: "Wiederholung konnte nicht geladen werden." };
      }
      const errors = validateTravelItemPayload(input.payload);
      if (Object.keys(errors).length > 0) return { kind: "validation", message: Object.values(errors)[0] };
      const items = readItems();
      if (items.filter((item) => item.lifecycleStatus !== "deleted").length >= 30) {
        return { kind: "limit", message: "Es können höchstens 30 aktive Reiseereignisse gespeichert werden." };
      }
      const item = itemFromPayload(input.payload, crypto.randomUUID());
      writeItems([...items, item]);
      idempotency.set(input.idempotencyKey, item.id);
      return { kind: "created", item };
    },
    async updateTravelItem(input) {
      const existingId = idempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = readItems().find((item) => item.id === existingId);
        return existing ? { kind: "updated", item: existing } : { kind: "unavailable", message: "Wiederholung konnte nicht geladen werden." };
      }
      const items = readItems();
      const current = items.find((item) => item.id === input.travelItemId && item.lifecycleStatus === "active");
      if (!current) return { kind: "forbidden", message: "Das Ereignis ist nicht verfügbar." };
      if (current.version !== input.expectedVersion) return { kind: "conflict", item: current };
      const errors = validateTravelItemPayload(input.payload);
      if (Object.keys(errors).length > 0) return { kind: "validation", message: Object.values(errors)[0] };
      const updated = itemFromPayload(input.payload, current.id, current.version + 1, current.createdAt);
      writeItems(items.map((item) => item.id === current.id ? updated : item));
      idempotency.set(input.idempotencyKey, current.id);
      return { kind: "updated", item: updated };
    },
    async deleteTravelItem(input) {
      const existingId = idempotency.get(input.idempotencyKey);
      if (existingId) return { kind: "deleted", itemId: existingId };
      const items = readItems();
      const current = items.find((item) => item.id === input.travelItemId && item.lifecycleStatus === "active");
      if (!current) return { kind: "forbidden", message: "Das Ereignis ist nicht verfügbar." };
      if (current.version !== input.expectedVersion) return { kind: "conflict", item: current };
      writeItems(items.map((item) => item.id === current.id ? { ...item, lifecycleStatus: "deleted", version: item.version + 1 } : item));
      idempotency.set(input.idempotencyKey, current.id);
      return { kind: "deleted", itemId: current.id };
    },
    subscribeToTravelItems({ onSignal, onStatus }) {
      const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) onSignal();
      };
      const onMessage = () => onSignal();
      window.addEventListener("storage", onStorage);
      channel?.addEventListener("message", onMessage);
      onStatus("connected");
      return () => {
        window.removeEventListener("storage", onStorage);
        channel?.removeEventListener("message", onMessage);
        channel?.close();
      };
    }
  };
}
