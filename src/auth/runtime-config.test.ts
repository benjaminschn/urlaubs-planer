import { describe, expect, it } from "vitest";
import { readPublicRuntimeConfig } from "./runtime-config";

describe("öffentliche Laufzeitkonfiguration", () => {
  it("akzeptiert nur HTTPS-Supabase-Konfiguration oder lokale Entwicklung", () => {
    expect(
      readPublicRuntimeConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "publishable"
      })
    ).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "publishable"
    });
    expect(
      readPublicRuntimeConfig({
        VITE_SUPABASE_URL: "http://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "publishable"
      })
    ).toBeNull();
  });

  it("akzeptiert den rückwärtskompatiblen öffentlichen Anon-Key, aber keine fehlende Konfiguration", () => {
    expect(
      readPublicRuntimeConfig({
        VITE_SUPABASE_URL: "http://localhost:54321",
        VITE_SUPABASE_ANON_KEY: "public-anon"
      })?.supabasePublishableKey
    ).toBe("public-anon");
    expect(readPublicRuntimeConfig({})).toBeNull();
  });
});
