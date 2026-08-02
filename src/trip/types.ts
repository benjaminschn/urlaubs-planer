export type Trip = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: "active";
  version: number;
  updatedAt: string;
};

export type TripLoadResult =
  | { kind: "ready"; trip: Trip }
  | { kind: "missing" }
  | { kind: "unavailable" };

export type TripUpdateInput = {
  tripId: string;
  expectedVersion: number;
  title: string;
  startDate: string;
  endDate: string;
};

export type TripUpdateResult =
  | { kind: "updated"; trip: Trip }
  | { kind: "conflict"; trip?: Trip }
  | { kind: "unavailable" };

export type TripRealtimeStatus = "connecting" | "connected" | "disconnected";

export type TripGateway = {
  getActiveTrip: () => Promise<TripLoadResult>;
  updateTrip: (input: TripUpdateInput) => Promise<TripUpdateResult>;
  subscribeToTrip: (options: {
    tripId: string;
    onSignal: () => void;
    onStatus: (status: TripRealtimeStatus) => void;
  }) => () => void;
};
