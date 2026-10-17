import { type NextRequest, NextResponse } from "next/server";

import { buildContentSecurityPolicy, createNonce } from "@/lib/csp";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { updateSession } from "@/utils/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrls: [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL],
    reportUri: "/api/csp-report",
  });
  // Next.js extracts the nonce from this request header during rendering.
  const forwardedHeaders = { "x-nonce": nonce, "content-security-policy": policy };

  const response = isSupabaseConfigured()
    ? await updateSession(request, forwardedHeaders)
    : NextResponse.next({ request: { headers: withHeaders(request.headers, forwardedHeaders) } });
  // Report-Only while violations are reviewed in Diagnóstico; switch the
  // header name to Content-Security-Policy to enforce it (H10).
  response.headers.set(process.env.CLUB_CSP_ENFORCE === "true"
    ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", policy);
  return response;
}

function withHeaders(source: Headers, extra: Record<string, string>) {
  const headers = new Headers(source);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
