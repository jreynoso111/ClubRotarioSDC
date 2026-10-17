import { createHash } from "node:crypto";

import { cspViolationCode } from "@/lib/csp";
import { browserFamily, diagnosticPath } from "@/lib/diagnostics";
import { allowDiagnostic } from "@/lib/diagnostics-ingest";
import { recordDiagnostic } from "@/lib/diagnostics-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const done = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });

// Receives browser CSP reports (report-uri). Only a fixed code and a known
// route are stored; blocked URLs, samples and query strings are discarded.
export async function POST(request: Request) {
  const type = request.headers.get("content-type") || "";
  if (!/^application\/(csp-report|reports\+json|json)/.test(type)) return done(415);
  if (Number(request.headers.get("content-length")) > 8192) return done(413);
  const key = createHash("sha256").update(request.headers.get("cf-connecting-ip") || "unknown").digest("hex");
  if (!allowDiagnostic("csp-global", Date.now(), 120) || !allowDiagnostic(`csp-${key}`, Date.now(), 10)) return done(429);
  try {
    const text = await request.text();
    if (text.length > 8192) return done(413);
    const body = JSON.parse(text);
    const report = Array.isArray(body) ? body[0]?.body : body?.["csp-report"] ?? body;
    const directive = report?.["effective-directive"] ?? report?.effectiveDirective ?? report?.["violated-directive"];
    const documentUri = report?.["document-uri"] ?? report?.documentURL;
    let path = "/[otra-ruta]";
    try { path = diagnosticPath(new URL(String(documentUri)).pathname); } catch { /* keep generic path */ }
    await recordDiagnostic({ source: "client", scope: "browser", code: cspViolationCode(directive), path, browser: browserFamily(request.headers.get("user-agent") || "") });
    return done();
  } catch { return done(400); }
}
