// H10: nonce-based Content-Security-Policy, published as Report-Only first.
// Next.js reads the nonce from the request's Content-Security-Policy header
// and applies it to its own scripts on dynamically rendered pages.
const turnstileOrigin = "https://challenges.cloudflare.com";

function origins(values: Array<string | undefined>) {
  const result = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try { result.add(new URL(value).origin); } catch { /* ignore malformed configuration */ }
  }
  return [...result];
}

export function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildContentSecurityPolicy(nonce: string, options: { dev?: boolean; supabaseUrls?: Array<string | undefined>; reportUri?: string } = {}) {
  if (!/^[A-Za-z0-9+/=]{16,64}$/.test(nonce)) throw new Error("invalid_nonce");
  const api = origins(options.supabaseUrls ?? []);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", turnstileOrigin, ...(options.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...api]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...api, turnstileOrigin, ...(options.dev ? ["ws:"] : [])]],
    ["frame-src", [turnstileOrigin]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  if (options.reportUri) directives.push(["report-uri", [options.reportUri]]);
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

// CSP violation reports use a fixed vocabulary; URLs and samples are never stored.
export function cspViolationCode(directive: unknown) {
  const value = typeof directive === "string" ? directive.toLowerCase() : "";
  if (value.startsWith("script-src")) return "csp_script" as const;
  if (value.startsWith("style-src")) return "csp_style" as const;
  if (value.startsWith("connect-src")) return "csp_connect" as const;
  return "csp_other" as const;
}
