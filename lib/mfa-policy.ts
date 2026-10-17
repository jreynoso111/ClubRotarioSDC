// Mirrors private.has_recent_second_factor() and private.has_any_role() in
// supabase/migrations/20261017013000_privileged_roles_require_recent_mfa.sql.
// The database is the authority; this copy only shapes the interface.
export const privilegedRoles = ["club_manager", "admin"] as const;
export const secondFactorMaxAgeSeconds = 12 * 60 * 60;
const secondFactorMethods = new Set(["totp", "mfa/totp", "mfa/phone", "mfa/webauthn"]);

export type PrivilegedSecurityState = "not_required" | "verified" | "enroll" | "verify";

export function isPrivilegedRole(role: unknown) {
  return privilegedRoles.includes(role as (typeof privilegedRoles)[number]);
}

export function hasRecentSecondFactor(claims: unknown, nowMs = Date.now()) {
  if (!claims || typeof claims !== "object") return false;
  const { aal, amr } = claims as { aal?: unknown; amr?: unknown };
  if (aal !== "aal2" || !Array.isArray(amr)) return false;
  const now = Math.floor(nowMs / 1000);
  const oldest = now - secondFactorMaxAgeSeconds;
  return amr.some(entry => {
    if (!entry || typeof entry !== "object") return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return typeof method === "string" && secondFactorMethods.has(method)
      && typeof timestamp === "number" && Number.isInteger(timestamp) && timestamp >= oldest && timestamp <= now + 60;
  });
}

export function privilegedSecurityState(role: unknown, claims: unknown, hasVerifiedFactor: boolean, nowMs = Date.now()): PrivilegedSecurityState {
  if (!isPrivilegedRole(role)) return "not_required";
  if (hasRecentSecondFactor(claims, nowMs)) return "verified";
  return hasVerifiedFactor ? "verify" : "enroll";
}

export const secondFactorRequiredMessage =
  "Confirma tu verificación en dos pasos para usar funciones de administración o finanzas. Ve a «Seguridad de la cuenta».";
