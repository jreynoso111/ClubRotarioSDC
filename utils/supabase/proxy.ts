import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabaseConfig } from "@/utils/supabase/config";

export async function updateSession(request: NextRequest, extraRequestHeaders: Record<string, string> = {}) {
  // Rebuild from request.headers each time so refreshed cookies are forwarded too.
  const forwarded = () => {
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(extraRequestHeaders)) headers.set(name, value);
    return { headers };
  };
  let supabaseResponse = NextResponse.next({ request: forwarded() });
  const { url, publishableKey, cookieName } = getSupabaseConfig();
  const serverUrl = process.env.SUPABASE_SERVER_URL?.trim() || url;

  const supabase = createServerClient(serverUrl, publishableKey, {
    cookieOptions: {
      name: cookieName,
      secure: request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request: forwarded() });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims && request.nextUrl.pathname.startsWith("/plataforma")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    const response = NextResponse.redirect(redirectUrl);
    supabaseResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie));
    return response;
  }

  return supabaseResponse;
}
