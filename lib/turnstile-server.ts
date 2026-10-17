import "server-only";

const verifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim() || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
}

// When TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY are unset the
// check is disabled; once configured, any missing or invalid token fails closed.
export async function verifyTurnstileToken(token: unknown, remoteIp?: string | null) {
  if (!isTurnstileEnabled()) return true;
  const hostnames = new Set((process.env.TURNSTILE_HOSTNAMES ?? '').split(',').map(hostname => hostname.trim()).filter(Boolean));
  if (!process.env.TURNSTILE_SECRET_KEY?.trim() || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || !hostnames.size) return false;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!.trim(), response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
  try {
    const response = await fetch(verifyUrl, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const result = await response.json() as { success?: unknown; hostname?: string; action?: string };
    return result.success === true && result.action === 'membership_application'
      && typeof result.hostname === 'string' && hostnames.has(result.hostname);
  } catch {
    return false;
  }
}
