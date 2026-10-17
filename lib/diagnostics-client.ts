"use client";

import { diagnosticCode, diagnosticPath, type DiagnosticScope } from "./diagnostics";

let sent = 0;
let windowStart = 0;
export async function reportClientDiagnostic(scope: DiagnosticScope, error?: { code?: string; status?: number }, code?: string, reactCode?: string) {
  if (Date.now() - windowStart > 60000) { sent = 0; windowStart = Date.now(); }
  if (++sent > 10) return null;
  try {
    const response = await fetch("/api/diagnostics", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, code: diagnosticCode(code || error?.code), status: error?.status, path: diagnosticPath(window.location.pathname), reactCode: reactCode && /^\d{1,4}$/.test(reactCode) ? reactCode : undefined }),
      credentials: "same-origin", keepalive: true, signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.id === "string" ? data.id as string : null;
  } catch { return null; } // Reporting must never interrupt the original operation.
}

export async function diagnosticFeedback(scope: DiagnosticScope, error: { code?: string; status?: number } | undefined, message: string) {
  const fallback = error?.status === 429 ? "over_request_rate_limit" : error?.status && error.status >= 500 ? "backend_error" : undefined;
  const id = await reportClientDiagnostic(scope, error, error?.code || fallback);
  return `${message} ${id ? `Referencia: ${id}` : "Referencia no disponible en este momento."}`;
}
