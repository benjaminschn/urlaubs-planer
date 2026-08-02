import { createClient } from "@supabase/supabase-js";
import { createSupabaseAuthGateway } from "./supabase-gateway";
import { readPublicRuntimeConfig } from "./runtime-config";
import type { AuthGateway } from "./types";

export function createRuntimeAuthGateway(): AuthGateway | null {
  const config = readPublicRuntimeConfig();
  if (!config) {
    return null;
  }

  const storage = typeof window === "undefined" ? undefined : window.sessionStorage;
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage,
      storageKey: "gemeinsamer-reiseplaner-auth"
    }
  });
  return createSupabaseAuthGateway(client);
}
