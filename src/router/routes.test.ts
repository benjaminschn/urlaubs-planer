import { describe, expect, it } from "vitest";
import {
  currentPathFromLocation,
  hashForPath,
  normalizePath,
  routeFromHash,
  safeRedirectTarget
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
});
