export type PublicRuntimeConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

type RuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export function readPublicRuntimeConfig(
  env: RuntimeEnv = import.meta.env
): PublicRuntimeConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  try {
    const parsed = new URL(supabaseUrl);
    const localDevelopment =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(localDevelopment && parsed.protocol === "http:")) {
      return null;
    }
  } catch {
    return null;
  }

  return { supabaseUrl, supabasePublishableKey };
}
