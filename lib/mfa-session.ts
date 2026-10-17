import "server-only";

import { hasRecentSecondFactor } from "./mfa-policy";

type ClaimsClient = {
  auth: { getClaims: () => Promise<{ data: { claims?: unknown } | null; error: unknown }> };
  rpc: (name: "has_privileged_session") => PromiseLike<{ data: unknown; error: unknown }>;
};

// getClaims() validates the access token before returning its claims.
export async function sessionHasRecentSecondFactor(supabase: ClaimsClient) {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !hasRecentSecondFactor(data?.claims)) return false;
    const live = await supabase.rpc("has_privileged_session");
    return !live.error && live.data === true;
  } catch {
    return false;
  }
}
