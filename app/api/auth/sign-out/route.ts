import { isAuthRequest } from "@/lib/auth-request";
import { endServerSession } from "@/utils/supabase/end-session";

export async function POST(request: Request) {
  if (!isAuthRequest(request)) return new Response(null, { status: 403 });
  await endServerSession(new URL(request.url).searchParams.get("all") === "1");
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
