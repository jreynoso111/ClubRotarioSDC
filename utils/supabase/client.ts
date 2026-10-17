"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/utils/supabase/config";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (!browserClient) {
    const { url, publishableKey, cookieName } = getSupabaseConfig();
    browserClient = createBrowserClient(url, publishableKey, {
      cookieOptions: { name: cookieName, secure: window.location.protocol === "https:" },
    });
  }

  return browserClient;
}
