import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { safeAuthNext } from "@/lib/auth-navigation";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeAuthNext(requestUrl.searchParams.get("next")), requestUrl.origin));
    } catch {
      // Failed confirmation must never be reported as a successful sign-in.
    }
  }

  return NextResponse.redirect(
    new URL("/auth/sign-in?error=confirmation", requestUrl.origin),
  );
}
