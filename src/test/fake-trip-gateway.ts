import type { Trip, TripGateway, TripRealtimeStatus } from "../trip/types";

export const defaultTestTrip: Trip = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Testreise",
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  lifecycleStatus: "active",
  version: 1,
  updatedAt: "2026-08-02T00:00:00.000Z"
};

type FakeTripGatewayOptions = {
  trip?: Partial<Trip>;
  loadResult?: "ready" | "missing" | "unavailable";
  updateDelay?: number;
};

export function createFakeTripGateway(options: FakeTripGatewayOptions = {}) {
  let trip: Trip = { ...defaultTestTrip, ...options.trip };
  const listeners = new Set<() => void>();
  const statusListeners = new Set<(status: TripRealtimeStatus) => void>();
  const calls = { load: 0, update: 0, subscribe: 0 };
  let loadResult = options.loadResult ?? "ready";

  const gateway: TripGateway = {
    async getActiveTrip() {
      calls.load += 1;
      if (loadResult === "missing") {
        return { kind: "missing" };
      }
      if (loadResult === "unavailable") {
        return { kind: "unavailable" };
      }
      return { kind: "ready", trip };
    },
    async updateTrip(input) {
      calls.update += 1;
      if (options.updateDelay) {
        await new Promise((resolve) => window.setTimeout(resolve, options.updateDelay));
      }
      if (input.expectedVersion !== trip.version) {
        return { kind: "conflict" };
      }
      trip = {
        ...trip,
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        version: trip.version + 1,
        updatedAt: new Date().toISOString()
      };
      for (const listener of listeners) {
        listener();
      }
      return { kind: "updated", trip };
    },
    subscribeToTrip({ onSignal, onStatus }) {
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
    getTrip: () => trip,
    mutateExternally: (title: string) => {
      trip = {
        ...trip,
        title,
        version: trip.version + 1,
        updatedAt: new Date().toISOString()
      };
    },
    setLoadResult: (next: "ready" | "missing" | "unavailable") => {
      loadResult = next;
    },
    emitSignal: (payload?: unknown) => {
      void payload;
      for (const listener of listeners) {
        listener();
      }
    },
    setRealtimeStatus: (status: TripRealtimeStatus) => {
      for (const listener of statusListeners) {
        listener(status);
      }
    }
  };
}
