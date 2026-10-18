import "server-only";
import { createClient } from "@supabase/supabase-js";

// Never use this client for ordinary reads or accept its target identity from
// an unverified request. Provisioning authorizes the administrator first.
export function createAdminClient() {
  const url = process.env.SUPABASE_ADMIN_URL || process.env.SUPABASE_SERVER_URL;
  const key = process.env.SUPABASE_ADMIN_SERVICE_KEY;
  if (!url || !key) throw new Error("Administrative account creation is not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: process.env.SUPABASE_ADMIN_API_KEY ? { apikey: process.env.SUPABASE_ADMIN_API_KEY } : {} },
  });
}
