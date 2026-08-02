import { validateTravelItemPayload } from "../travel/validation";
import type {
  Location,
  TravelItem,
  TravelItemGateway,
  TravelItemPayload,
  TravelItemRealtimeStatus
} from "../travel/types";

const defaultLocation = (id: string, name: string): Location => ({
  id,
  name,
  fullAddress: null,
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  region: null,
  countryCode: null,
  locationCodeType: null,
  locationCode: null,
  latitude: null,
  longitude: null,
  ianaTimeZone: null
});

function mapLocation(value: TravelItemPayload["locations"]["main"], id: string): Location | null {
  return value
    ? {
        ...defaultLocation(id, value.name),
        ...value,
        id
      }
    : null;
}

function mapSegment(itemId: string, segment: TravelItemPayload["segments"][number], index: number) {
  return {
    ...segment,
    id: segment.id ?? `${itemId}-segment-${index + 1}`,
    sequenceNumber: index + 1,
    startLocation: mapLocation(segment.startLocation, `${itemId}-segment-${index + 1}-start`)!,
    endLocation: mapLocation(segment.endLocation, `${itemId}-segment-${index + 1}-end`)!
  };
}

function itemFromPayload(tripId: string, payload: TravelItemPayload, id: string, version = 1): TravelItem {
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
      main: mapLocation(payload.locations.main, `${id}-main`),
      start: mapLocation(payload.locations.start, `${id}-start`),
      end: mapLocation(payload.locations.end, `${id}-end`)
    },
    commonDetails: payload.commonDetails,
    typeDetails: payload.typeDetails,
    segments: payload.segments.map((segment, index) => mapSegment(id, segment, index)),
    stableSortKey: id,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createFakeTravelItemGateway(options: { tripId?: string; items?: TravelItem[] } = {}) {
  const tripId = options.tripId ?? "22222222-2222-4222-8222-222222222222";
  let items = [...(options.items ?? [])];
  let counter = 1;
  let pendingLoadFailures = 0;
  const listeners = new Set<() => void>();
  const statusListeners = new Set<(status: TravelItemRealtimeStatus) => void>();
  const idempotency = new Map<string, string>();
  const calls = { load: 0, create: 0, update: 0, remove: 0, subscribe: 0 };

  function find(itemId: string): TravelItem | undefined {
    return items.find((item) => item.id === itemId);
  }

  function signal() {
    for (const listener of listeners) listener();
  }

  const gateway: TravelItemGateway = {
    async getTravelItems(requestTripId) {
      calls.load += 1;
      if (pendingLoadFailures > 0) {
        pendingLoadFailures -= 1;
        return { kind: "unavailable" };
      }
      if (requestTripId !== tripId) return { kind: "ready", items: [] };
      return { kind: "ready", items: items.filter((item) => item.lifecycleStatus === "active") };
    },
    async createTravelItem(input) {
      calls.create += 1;
      const replay = idempotency.get(input.idempotencyKey);
      if (replay) {
        const replayed = find(replay);
        return replayed ? { kind: "created", item: replayed } : { kind: "unavailable", message: "Wiederholung konnte nicht geladen werden." };
      }
      const errors = validateTravelItemPayload(input.payload);
      if (Object.keys(errors).length > 0) return { kind: "validation", message: Object.values(errors)[0] };
      if (items.filter((item) => item.lifecycleStatus !== "deleted").length >= 30) {
        return { kind: "limit", message: "Es können höchstens 30 aktive Reiseereignisse gespeichert werden." };
      }
      const id = `33333333-3333-4333-8333-${String(counter++).padStart(12, "0")}`;
      const item = itemFromPayload(tripId, input.payload, id);
      items = [...items, item];
      idempotency.set(input.idempotencyKey, id);
      signal();
      return { kind: "created", item };
    },
    async updateTravelItem(input) {
      calls.update += 1;
      const replay = idempotency.get(input.idempotencyKey);
      if (replay) {
        const replayed = find(replay);
        return replayed ? { kind: "updated", item: replayed } : { kind: "unavailable", message: "Wiederholung konnte nicht geladen werden." };
      }
      const current = find(input.travelItemId);
      if (!current) return { kind: "forbidden", message: "Das Ereignis ist nicht verfügbar." };
      if (current.version !== input.expectedVersion) return { kind: "conflict", item: current };
      const errors = validateTravelItemPayload(input.payload);
      if (Object.keys(errors).length > 0) return { kind: "validation", message: Object.values(errors)[0] };
      const updated = itemFromPayload(tripId, input.payload, current.id, current.version + 1);
      updated.createdAt = current.createdAt;
      items = items.map((item) => (item.id === current.id ? updated : item));
      idempotency.set(input.idempotencyKey, current.id);
      signal();
      return { kind: "updated", item: updated };
    },
    async deleteTravelItem(input) {
      calls.remove += 1;
      const replay = idempotency.get(input.idempotencyKey);
      if (replay) return { kind: "deleted", itemId: replay };
      const current = find(input.travelItemId);
      if (!current) return { kind: "forbidden", message: "Das Ereignis ist nicht verfügbar." };
      if (current.version !== input.expectedVersion) return { kind: "conflict", item: current };
      items = items.map((item) => item.id === current.id ? { ...item, lifecycleStatus: "deleted", version: item.version + 1 } : item);
      idempotency.set(input.idempotencyKey, current.id);
      signal();
      return { kind: "deleted", itemId: current.id };
    },
    subscribeToTravelItems({ onSignal, onStatus }) {
      calls.subscribe += 1;
      listeners.add(onSignal);
      statusListeners.add(onStatus);
      onStatus("connected");
      return () => {
        listeners.delete(onSignal);
        statusListeners.delete(onStatus);
      };
    }
  };

  return {
    gateway,
    calls,
    getItems: () => items,
    emitSignal: () => signal(),
    failNextLoad: () => {
      pendingLoadFailures += 1;
    },
    setRealtimeStatus: (status: TravelItemRealtimeStatus) => {
      for (const listener of statusListeners) listener(status);
    },
    mutateExternally: (itemId: string, title: string) => {
      const current = find(itemId);
      if (!current) return;
      items = items.map((item) => item.id === itemId ? { ...item, title, version: item.version + 1 } : item);
    }
  };
}
