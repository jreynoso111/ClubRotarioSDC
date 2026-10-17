import { NextResponse } from "next/server";
import { confirmEmail } from "@/lib/auth-confirmation";
import { createClient } from "@/utils/supabase/server";
import { getPublicSiteOrigin } from "@/utils/site-url";
import { endServerSession } from "@/utils/supabase/end-session";

export async function GET(request: Request) {
  const destination = await confirmEmail(new URL(request.url).searchParams, await createClient());
  if (destination === "/auth/sign-in?notice=confirmed") await endServerSession();
  const response = NextResponse.redirect(new URL(destination, getPublicSiteOrigin()));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
