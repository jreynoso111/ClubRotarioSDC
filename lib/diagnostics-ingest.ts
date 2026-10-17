import { browserFamily, diagnosticCode, diagnosticPath, diagnosticScope, diagnosticStatus, type DiagnosticEvent } from "./diagnostics";

const windows = new Map<string, { start: number; count: number }>();
export function allowDiagnostic(key: string, now = Date.now(), limit = 20) {
  for (const [id, item] of windows) if (now - item.start > 60000) windows.delete(id);
  if (!windows.has(key) && windows.size >= 2000) return false;
  const item = windows.get(key) || { start: now, count: 0 };
  windows.set(key, item);
  return ++item.count <= limit;
}
export function sameDiagnosticOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const canonical = process.env.NEXT_PUBLIC_SITE_URL || "https://www.clubrotariosdcolonial.org";
  const own = new URL(request.url);
  // Accept the configured public origin behind the tunnel; loopback is dev-only.
  return origin === new URL(canonical).origin || (process.env.NODE_ENV !== "production" && origin === own.origin);
}
export async function ingestDiagnostic(request: Request, key: string, save: (input: Partial<DiagnosticEvent>) => Promise<string | null>) {
  const reply = (status: number, data: object) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!sameDiagnosticOrigin(request)) return reply(403, { error: "origin_rejected" });
  if (!allowDiagnostic("global", Date.now(), 300)) return reply(429, { error: "rate_limited" });
  if (!allowDiagnostic(key)) return reply(429, { error: "rate_limited" });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, { error: "json_required" });
  if (Number(request.headers.get("content-length")) > 2048) return reply(413, { error: "payload_limit" });
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: "invalid_event" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2048) { await reader.cancel(); return reply(413, { error: "payload_limit" }); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || body.code === "test_event" || !["login", "recovery", "password", "signup", "confirmation", "mfa", "browser"].includes(body.scope)) return reply(400, { error: "invalid_event" });
    const id = await save({ source: "client", scope: diagnosticScope(body.scope), code: diagnosticCode(body.code),
      path: diagnosticPath(body.path), status: diagnosticStatus(body.status), browser: browserFamily(request.headers.get("user-agent") || ""),
      reactCode: typeof body.reactCode === "string" && /^\d{1,4}$/.test(body.reactCode) ? body.reactCode : undefined });
    return id ? reply(201, { id }) : reply(503, { error: "storage_unavailable" });
  } catch { return reply(400, { error: "invalid_event" }); }
}
