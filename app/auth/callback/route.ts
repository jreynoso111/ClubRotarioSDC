import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { safeAuthNext } from "@/lib/auth-navigation";
import { getPublicSiteOrigin } from "@/utils/site-url";
import { endServerSession } from "@/utils/supabase/end-session";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        const destination = safeAuthNext(requestUrl.searchParams.get("next"));
        if (destination === "/auth/reset-password") return NextResponse.redirect(new URL(destination, getPublicSiteOrigin()));
        await endServerSession();
        return NextResponse.redirect(new URL("/auth/sign-in?notice=confirmed", getPublicSiteOrigin()));
      }
    } catch {
      // Failed confirmation must never be reported as a successful sign-in.
    }
  }

  return NextResponse.redirect(
    new URL("/auth/sign-in?error=confirmation", getPublicSiteOrigin()),
  );
}
