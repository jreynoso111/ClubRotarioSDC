import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { getSupabaseConfig } from "@/utils/supabase/config";
import { diagnosticFetch } from "@/lib/diagnostics-store";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey, cookieName } = getSupabaseConfig();
  const serverUrl = process.env.SUPABASE_SERVER_URL?.trim() || url;
  const secure = (await headers()).get("x-forwarded-proto") === "https";

  return createServerClient(serverUrl, publishableKey, {
    global: { fetch: diagnosticFetch },
    cookieOptions: { name: cookieName, secure },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components can read cookies but cannot always write them.
          // The Proxy refreshes the session when a response can set cookies.
        }
      },
    },
  });
}
