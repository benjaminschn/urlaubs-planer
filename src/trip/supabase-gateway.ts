import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Trip,
  TripGateway,
  TripLoadResult,
  TripRealtimeStatus,
  TripUpdateInput,
  TripUpdateResult
} from "./types";

const tripColumns = "id,title,start_date,end_date,lifecycle_status,version,updated_at";

function mapTrip(row: unknown): Trip | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const candidate = row as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.start_date !== "string" ||
    typeof candidate.end_date !== "string" ||
    candidate.lifecycle_status !== "active" ||
    typeof candidate.version !== "number" ||
    typeof candidate.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    startDate: candidate.start_date,
    endDate: candidate.end_date,
    lifecycleStatus: "active",
    version: candidate.version,
    updatedAt: candidate.updated_at
  };
}

function mapLoadResult(data: unknown, error: unknown): TripLoadResult {
  if (error) {
    return { kind: "unavailable" };
  }
  const trip = mapTrip(data);
  return trip ? { kind: "ready", trip } : { kind: "missing" };
}

function mapUpdateResult(data: unknown, error: unknown): TripUpdateResult {
  if (error) {
    return { kind: "unavailable" };
  }
  const trip = mapTrip(data);
  return trip ? { kind: "updated", trip } : { kind: "conflict" };
}

function mapRealtimeStatus(status: string): TripRealtimeStatus {
  return status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "disconnected" : "connecting";
}

export function createSupabaseTripGateway(client: SupabaseClient): TripGateway {
  return {
    async getActiveTrip() {
      const { data, error } = await client
        .from("trips")
        .select(tripColumns)
        .eq("lifecycle_status", "active")
        .limit(1)
        .maybeSingle();
      return mapLoadResult(data, error);
    },

    async updateTrip(input: TripUpdateInput) {
      const { data, error } = await client.rpc("update_trip", {
        p_trip_id: input.tripId,
        p_expected_version: input.expectedVersion,
        p_title: input.title,
        p_start_date: input.startDate,
        p_end_date: input.endDate
      });
      const updatedRow = Array.isArray(data) ? data[0] : data;
      return mapUpdateResult(updatedRow, error);
    },

    subscribeToTrip({ tripId, onSignal, onStatus }) {
      let disposed = false;
      let reconnectTimer: number | null = null;
      let channel: ReturnType<SupabaseClient["channel"]> | null = null;

      const scheduleReconnect = () => {
        if (disposed || reconnectTimer !== null) {
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          subscribe();
        }, 1000);
      };

      const subscribe = () => {
        if (disposed) {
          return;
        }
        onStatus("connecting");
        channel = client
          .channel(`trip:${tripId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "trips",
              filter: `id=eq.${tripId}`
            },
            () => {
              // Realtime is intentionally only an invalidation signal. The
              // provider reloads the complete row under RLS.
              onSignal();
            }
          )
          .subscribe((status: string) => {
            const mappedStatus = mapRealtimeStatus(status);
            onStatus(mappedStatus);
            if (mappedStatus === "disconnected") {
              scheduleReconnect();
            }
          });
      };

      subscribe();

      return () => {
        disposed = true;
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
        }
        if (channel) {
          void client.removeChannel(channel);
        }
      };
    }
  };
}
