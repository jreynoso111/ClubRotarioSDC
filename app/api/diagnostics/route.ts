import { createHash } from "node:crypto";
import { createClient } from "@/utils/supabase/server";
import { canReadDiagnostics } from "@/lib/diagnostics";
import { ingestDiagnostic, sameDiagnosticOrigin } from "@/lib/diagnostics-ingest";
import { readDiagnostics, recordDiagnostic } from "@/lib/diagnostics-store";
import { sessionHasRecentSecondFactor } from "@/lib/mfa-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });

export async function POST(request: Request) {
  const identity = request.headers.get("cf-connecting-ip") || "unknown";
  const key = createHash("sha256").update(identity).digest("hex");
  // This endpoint only accepts fixed, untrusted browser reports; it grants no read access.
  return ingestDiagnostic(request, key, recordDiagnostic);
}

export async function GET() {
  try {
    const started = Date.now();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return reply({ error: "unauthenticated" }, 401);
    const authMs = Date.now() - started;
    const dbStarted = Date.now();
    const membership = await supabase.from("memberships").select("membership_role,membership_status").eq("user_id", data.user.id).maybeSingle();
    if (membership.error) return reply({ error: "membership_unavailable" }, 503);
    if (!canReadDiagnostics(membership.data)) return reply({ error: "forbidden" }, 403);
    if (!(await sessionHasRecentSecondFactor(supabase))) return reply({ error: "mfa_required" }, 403);
    const databaseMs = Date.now() - dbStarted;
    const events = await readDiagnostics();
    return reply({ events, checkedAt: new Date().toISOString(), health: { authMs, databaseMs, storage: "ready" }, retentionDays: 7, maxEvents: 1000 });
  } catch { return reply({ error: "diagnostics_unavailable" }, 503); }
}

export async function PUT(request: Request) {
  if (!sameDiagnosticOrigin(request)) return reply({ error: "origin_rejected" }, 403);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return reply({ error: "unauthenticated" }, 401);
    const membership = await supabase.from("memberships").select("membership_role,membership_status").eq("user_id", data.user.id).maybeSingle();
    if (membership.error) return reply({ error: "membership_unavailable" }, 503);
    if (!canReadDiagnostics(membership.data)) return reply({ error: "forbidden" }, 403);
    if (!(await sessionHasRecentSecondFactor(supabase))) return reply({ error: "mfa_required" }, 403);
    const id = await recordDiagnostic({ source: "server", scope: "test", code: "test_event", path: "/plataforma" });
    return id ? reply({ id }, 201) : reply({ error: "storage_unavailable" }, 503);
  } catch { return reply({ error: "diagnostics_unavailable" }, 503); }
}
