import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || request.path.startsWith("/api/diagnostics")) return;
  const { recordDiagnostic } = await import("./lib/diagnostics-store");
  const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : undefined;
  const frames = error instanceof Error ? [...(error.stack || "").matchAll(/:(\d+):(\d+)\)?$/gm)].map(match => `${match[1]}:${match[2]}`) : undefined;
  await recordDiagnostic({ source: "server", scope: "server", code: "unexpected_error", path: request.path, digest, frames, operation: context.routeType });
};
