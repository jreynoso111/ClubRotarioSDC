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
  const metadata = claims?.app_metadata as Record<string, unknown> | undefined;
  const protectedPath = request.nextUrl.pathname.startsWith("/plataforma")
    || request.nextUrl.pathname === "/auth/mfa" || request.nextUrl.pathname === "/auth/reset-password";
  if (claims && protectedPath && (metadata?.require_password_change === true || typeof metadata?.admin_created_by === "string")) {
    const state = await supabase.rpc("account_password_state");
    if (state.error) return new NextResponse("No se pudo verificar el acceso. Inténtalo de nuevo.", { status: 503 });
    if (state.data !== "ready") {
      const target = request.nextUrl.clone();
      target.pathname = state.data === "sign_in_again" ? "/auth/sign-in" : "/auth/first-password";
      target.search = state.data === "sign_in_again" ? "?notice=password-updated" : "";
      const response = NextResponse.redirect(target);
      supabaseResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie));
      return response;
    }
  }

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
