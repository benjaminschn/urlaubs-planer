import type { Trip, TripGateway } from "./types";

const storageKey = "gemeinsamer-reiseplaner-e2e-trip";
const channelName = "gemeinsamer-reiseplaner-e2e-realtime";

const initialTrip: Trip = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Testreise",
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  lifecycleStatus: "active",
  version: 1,
  updatedAt: "2026-08-02T00:00:00.000Z"
};

function readTrip(): Trip {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    window.localStorage.setItem(storageKey, JSON.stringify(initialTrip));
    return initialTrip;
  }
  try {
    return JSON.parse(stored) as Trip;
  } catch {
    window.localStorage.setItem(storageKey, JSON.stringify(initialTrip));
    return initialTrip;
  }
}

export function createRuntimeTripGateway(): TripGateway {
  return {
    async getActiveTrip() {
      return { kind: "ready", trip: readTrip() };
    },
    async updateTrip(input) {
      const current = readTrip();
      if (current.version !== input.expectedVersion) {
        return { kind: "conflict" };
      }
      const updated: Trip = {
        ...current,
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        version: current.version + 1,
        updatedAt: new Date().toISOString()
      };
      window.localStorage.setItem(storageKey, JSON.stringify(updated));
      const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
      channel?.postMessage({ type: "trip-updated" });
      channel?.close();
      return { kind: "updated", trip: updated };
    },
    subscribeToTrip({ onSignal, onStatus }) {
      const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) {
          onSignal();
        }
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
