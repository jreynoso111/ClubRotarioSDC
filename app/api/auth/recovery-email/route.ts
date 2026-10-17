import { createHash } from "node:crypto";
import { createClient } from "@/utils/supabase/server";
import { allowRecoveryLookup, isAuthRequest, readRecoveryEmail } from "@/lib/auth-request";

export const dynamic = "force-dynamic";
const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
export async function POST(request: Request) {
  if (!isAuthRequest(request)) return reply({ error: "origin_rejected" }, 403);
  const key = createHash("sha256").update(request.headers.get("cf-connecting-ip") || "unknown").digest("hex");
  if (!allowRecoveryLookup("global") || !allowRecoveryLookup(key)) return reply({ error: "rate_limited" }, 429);
  const email = await readRecoveryEmail(request);
  if (!email) return reply({ error: "invalid_email" }, 400);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("auth_recovery_email_exists", { email_address: email });
    if (error || typeof data !== "boolean") return reply({ error: "lookup_unavailable" }, 503);
    return reply({ exists: data });
  } catch { return reply({ error: "lookup_unavailable" }, 503); }
}
