import { getAuthCookieName } from "./session-options";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const localSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseConfig() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const url =
    typeof window !== "undefined" && loopbackHosts.has(window.location.hostname)
      ? localSupabaseUrl || supabaseUrl
      : supabaseUrl;

  return { url, publishableKey: supabasePublishableKey, cookieName: getAuthCookieName(supabaseUrl) };
}
