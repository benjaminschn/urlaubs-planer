import { describe, expect, it } from "vitest";
import {
  currentPathFromLocation,
  candidateRouteFromPath,
  hashForPath,
  normalizePath,
  routeFromHash,
  safeRedirectTarget,
  travelItemRouteFromPath
} from "./routes";

describe("Hash-Routing und Redirect-Merker", () => {
  it("behält einen erlaubten Deep Link ohne externe Zieladresse", () => {
    expect(routeFromHash("#/documents")).toEqual({
      kind: "protected",
      path: "/documents",
      known: true
    });
    expect(safeRedirectTarget("#/documents")).toBe("/documents");
    expect(hashForPath("/documents")).toBe("#/documents");
  });

  it("verwirft externe, unbekannte und einladungsbezogene Ziele neutral", () => {
    expect(safeRedirectTarget("https://example.invalid/private")).toBe("/app");
    expect(safeRedirectTarget("/does-not-exist")).toBe("/app");
    expect(routeFromHash("#/invite")).toEqual({ kind: "invite_disabled", path: "/invite" });
  });

  it("normalisiert Hash-Pfade ohne Query- oder Slash-Varianten", () => {
    expect(normalizePath("#/timeline/?from=deep-link")).toBe("/timeline");
    expect(currentPathFromLocation({ hash: "" })).toBe("/app");
  });

  it("erlaubt nur interne TravelItem-Detail- und Bearbeitungspfade", () => {
    expect(travelItemRouteFromPath("/events/11111111-1111-4111-8111-111111111111")).toEqual({
      kind: "detail",
      path: "/events/11111111-1111-4111-8111-111111111111",
      itemId: "11111111-1111-4111-8111-111111111111"
    });
    expect(travelItemRouteFromPath("/events/new")).toEqual({ kind: "create", path: "/events/new" });
    expect(routeFromHash("#/events/foreign/edit")).toMatchObject({ kind: "protected", known: true });
    expect(safeRedirectTarget("javascript:alert(1)")).toBe("/app");
  });

  it("erkennt genau einen internen Candidate-Prüfpfad", () => {
    expect(candidateRouteFromPath("/candidates/66666666-6666-4666-8666-000000000002")).toEqual({
      kind: "review",
      path: "/candidates/66666666-6666-4666-8666-000000000002",
      candidateId: "66666666-6666-4666-8666-000000000002"
    });
    expect(candidateRouteFromPath("/candidates/one/more")).toBeNull();
  });
});
