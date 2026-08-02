import { createClient } from "@supabase/supabase-js";
import { readPublicRuntimeConfig } from "../auth/runtime-config";
import { createSupabaseAuthGateway } from "../auth/supabase-gateway";
import { createSupabaseTripGateway } from "../trip/supabase-gateway";
import { createSupabaseTravelItemGateway } from "../travel/supabase-gateway";
import { createSupabaseDocumentGateway } from "../documents/supabase-gateway";
import type { AuthGateway } from "../auth/types";
import type { DocumentGateway } from "../documents/types";
import type { TripGateway } from "../trip/types";
import type { TravelItemGateway } from "../travel/types";

export type RuntimeServices = {
  authGateway: AuthGateway;
  tripGateway: TripGateway;
  travelItemGateway: TravelItemGateway;
  documentGateway: DocumentGateway;
};

export function createRuntimeServices(): RuntimeServices | null {
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
  return {
    authGateway: createSupabaseAuthGateway(client),
    tripGateway: createSupabaseTripGateway(client),
    travelItemGateway: createSupabaseTravelItemGateway(client),
    documentGateway: createSupabaseDocumentGateway(client)
  };
}
