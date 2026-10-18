import { createClient } from "@/utils/supabase/server";
import { isAuthRequest } from "@/lib/auth-request";
import { privilegedSecurityState } from "@/lib/mfa-policy";
import { sessionHasRecentSecondFactor } from "@/lib/mfa-session";

const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  if (!isAuthRequest(request)) return reply({ error: "origin_rejected" }, 403);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return reply({ state: "signed_out" }, 401);
    const passwordState = await supabase.rpc("account_password_state");
    if (passwordState.error) return reply({ state: "unavailable" }, 503);
    if (passwordState.data === "required") return reply({ state: "password_change_required", passwordChangeRequired: true });
    if (passwordState.data === "sign_in_again") return reply({ state: "signed_out" }, 401);
    const membership = await supabase.from("memberships").select("membership_status,membership_role").eq("user_id", data.user.id).maybeSingle();
    if (membership.error) return reply({ state: "unavailable" }, 503);
    const state = membership.data?.membership_status;
    if (state !== "active") return reply({ state: state === "suspended" ? "suspended" : "pending" }, 403);
    const role = membership.data?.membership_role;
    if (role !== "admin" && role !== "club_manager") return reply({ state, mfa: "not_required" });
    const [claims, factors] = await Promise.all([supabase.auth.getClaims(), supabase.auth.mfa.listFactors()]);
    const hasVerifiedFactor = !factors.error && (factors.data?.totp?.length ?? 0) > 0;
    const security = privilegedSecurityState(role, claims.error ? null : claims.data?.claims, hasVerifiedFactor);
    const mfa = security === "verified" && !(await sessionHasRecentSecondFactor(supabase)) ? "verify" : security;
    return reply({ state, mfa });
  } catch { return reply({ state: "unavailable" }, 503); }
}
