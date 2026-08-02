import { describe, expect, it, vi } from "vitest";
import { createSupabaseTripGateway } from "./supabase-gateway";

const row = {
  id: "trip-1",
  title: "Testreise",
  start_date: "2026-09-01",
  end_date: "2026-09-07",
  lifecycle_status: "active",
  version: 3,
  updated_at: "2026-08-02T00:00:00.000Z"
};

function createQuery(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    rpc: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error })
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.update.mockReturnValue(query);
  return query;
}

describe("Supabase-Reiseadapter", () => {
  it("lädt nur die aktive Reise und legt niemals eine Reise an", async () => {
    const query = createQuery(row);
    const client = { from: vi.fn().mockReturnValue(query) };
    const gateway = createSupabaseTripGateway(client as never);

    const result = await gateway.getActiveTrip();

    expect(result).toEqual({
      kind: "ready",
      trip: {
        id: "trip-1",
        title: "Testreise",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        lifecycleStatus: "active",
        version: 3,
        updatedAt: "2026-08-02T00:00:00.000Z"
      }
    });
    expect(client.from).toHaveBeenCalledWith("trips");
    expect(query.eq).toHaveBeenCalledWith("lifecycle_status", "active");
    expect(query).not.toHaveProperty("insert");
  });

  it("bindet die gelesene Version an die Mutation und ordnet eine leere Antwort als Konflikt zu", async () => {
    const query = createQuery(null);
    const client = { from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    const gateway = createSupabaseTripGateway(client as never);

    const result = await gateway.updateTrip({
      tripId: "trip-1",
      expectedVersion: 3,
      title: "Neue Testreise",
      startDate: "2026-09-02",
      endDate: "2026-09-08"
    });

    expect(result).toEqual({ kind: "conflict" });
    expect(client.rpc).toHaveBeenCalledWith("update_trip", {
      p_trip_id: "trip-1",
      p_expected_version: 3,
      p_title: "Neue Testreise",
      p_start_date: "2026-09-02",
      p_end_date: "2026-09-08"
    });
    expect(query.update).not.toHaveBeenCalled();
  });

  it("verwendet Realtime-Payloads nicht als Zustand, sondern meldet nur eine Invalidierung", () => {
    let payloadHandler: ((payload: unknown) => void) | undefined;
    const channel = {
      on: vi.fn((_event, _config, handler) => {
        payloadHandler = handler;
        return channel;
      }),
      subscribe: vi.fn((handler) => {
        handler("SUBSCRIBED");
        return channel;
      })
    };
    const client = {
      channel: vi.fn().mockReturnValue(channel),
      removeChannel: vi.fn()
    };
    const onSignal = vi.fn();
    const statuses: string[] = [];
    const gateway = createSupabaseTripGateway(client as never);

    const unsubscribe = gateway.subscribeToTrip({
      tripId: "trip-1",
      onSignal,
      onStatus: (status) => statuses.push(status)
    });
    payloadHandler?.({ new: { title: "Nicht kanonisch" } });

    expect(statuses).toEqual(["connecting", "connected"]);
    expect(onSignal).toHaveBeenCalledOnce();
    unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
