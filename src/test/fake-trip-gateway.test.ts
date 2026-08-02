import { describe, expect, it } from "vitest";
import { createFakeTripGateway } from "./fake-trip-gateway";

describe("optimistische Reiseversion", () => {
  it("lässt bei parallelen Änderungen auf derselben Version genau eine Mutation gewinnen", async () => {
    const fake = createFakeTripGateway();
    const [first, second] = await Promise.all([
      fake.gateway.updateTrip({
        tripId: fake.getTrip().id,
        expectedVersion: 1,
        title: "Änderung A",
        startDate: "2026-09-01",
        endDate: "2026-09-07"
      }),
      fake.gateway.updateTrip({
        tripId: fake.getTrip().id,
        expectedVersion: 1,
        title: "Änderung B",
        startDate: "2026-09-01",
        endDate: "2026-09-07"
      })
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["conflict", "updated"]);
    expect(fake.getTrip().version).toBe(2);
  });
});
