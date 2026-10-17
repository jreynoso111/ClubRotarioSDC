"use client";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/utils/supabase/config";

// The managed local stack cannot serve custom TokenHash email templates.
// Use Supabase's supported email flow so links also work on another device.
// This request-only client never stores a second session or PKCE verifier.
export function createEmailClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
