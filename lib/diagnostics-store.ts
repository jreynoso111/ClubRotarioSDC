import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { diagnosticCode, diagnosticOperation, diagnosticPath, diagnosticScope, diagnosticStatus, type DiagnosticEvent } from "./diagnostics";

const maxFileBytes = 512 * 1024;
const retentionDays = 7;
// Instrumentation and routes may be separate bundles in the same Next process.
// Share only the writer queue, never request identities or sessions.
const loggerProcess = globalThis as typeof globalThis & { __clubDiagnostics?: { writes: Promise<unknown>; cleanup: Map<string, number> } };
const state = loggerProcess.__clubDiagnostics ??= { writes: Promise.resolve(), cleanup: new Map() };
const directory = () => process.env.CLUB_DIAGNOSTICS_DIR || join(process.cwd(), ".diagnostics");

export async function readDiagnostics(): Promise<DiagnosticEvent[]> {
  await state.writes;
  const root = directory();
  const cutoff = Date.now() - retentionDays * 86400000;
  const rows: DiagnosticEvent[] = [];
  for (const name of ["events.jsonl", "events.1.jsonl"]) {
    const path = join(/* turbopackIgnore: true */ root, name);
    const info = await stat(/* turbopackIgnore: true */ path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) continue;
    if (info.size > maxFileBytes + 8192) throw new Error("diagnostic_file_limit");
    const content = await readFile(/* turbopackIgnore: true */ path, "utf8");
    for (const line of content.split("\n")) {
      try {
        const entry = JSON.parse(line) as DiagnosticEvent;
        if (Date.parse(entry.createdAt) >= cutoff) rows.push(entry);
      } catch { /* Ignore incomplete lines after an interrupted write. */ }
    }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1000);
}

export function recordDiagnostic(input: Partial<DiagnosticEvent>): Promise<string | null> {
  const entry: DiagnosticEvent = {
    id: randomUUID(), createdAt: new Date().toISOString(),
    source: input.source === "client" ? "client" : "server",
    scope: diagnosticScope(input.scope), code: diagnosticCode(input.code), path: diagnosticPath(input.path),
    status: diagnosticStatus(input.status),
    serviceCode: typeof input.serviceCode === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(input.serviceCode) ? input.serviceCode : undefined,
    browser: ["Edge", "Chrome", "Firefox", "Safari", "Otro"].includes(input.browser || "") ? input.browser : undefined,
    digest: input.digest && /^\d{1,20}$/.test(input.digest) ? input.digest : undefined,
    reactCode: input.reactCode && /^\d{1,4}$/.test(input.reactCode) ? input.reactCode : undefined,
    // Only numerical coordinates in compiled code, never error messages, source literals or paths.
    frames: input.frames?.filter(frame => /^\d{1,7}:\d{1,7}$/.test(frame)).slice(0, 6),
    operation: input.source === "client" ? undefined : diagnosticOperation(input.operation),
    release: /^\.next-releases\/[0-9-]+$/.test(process.env.NEXT_BUILD_DIR || "") ? process.env.NEXT_BUILD_DIR : "desarrollo",
  };
  const write = state.writes.then(async () => {
    const root = directory();
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (Date.now() - (state.cleanup.get(root) || 0) > 3600000) {
      for (const name of ["events.jsonl", "events.1.jsonl"]) {
        const path = join(/* turbopackIgnore: true */ root, name);
        const content = await readFile(/* turbopackIgnore: true */ path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
        if (!content) continue;
        const lines = content.split("\n").filter(line => {
          try { return Date.parse(JSON.parse(line).createdAt) >= Date.now() - retentionDays * 86400000; } catch { return false; }
        });
        await writeFile(path, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
      }
      state.cleanup.set(root, Date.now());
    }
    const file = join(root, "events.jsonl");
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info && (info.size >= maxFileBytes || info.mtimeMs < Date.now() - retentionDays * 86400000)) {
      await unlink(join(root, "events.1.jsonl")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await rename(file, join(root, "events.1.jsonl"));
    }
    const archive = join(root, "events.1.jsonl");
    const old = await stat(archive).catch(() => null);
    if (old && old.mtimeMs < Date.now() - retentionDays * 86400000) await unlink(archive);
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry.id;
  }).catch(() => {
    console.error("[diagnostics] No se pudo escribir el registro técnico.");
    return null;
  });
  state.writes = write;
  return write;
}

export async function diagnosticFetch(input: RequestInfo | URL, init?: RequestInit) {
  let path = "/plataforma";
  try { path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname; } catch { /* Keep generic scope. */ }
  const scope = path.startsWith("/auth/") ? "server" : "backend";
  const operation = path.startsWith("/auth/") ? "auth" : path.startsWith("/rest/v1/rpc/") ? "rpc" : path.startsWith("/storage/") ? "storage" : path.split("/")[3];
  try {
    const response = await fetch(input, init);
    // A missing session is routine; actual failed requests are still captured.
    if (!response.ok) {
      let serviceCode: string | undefined;
      try { const body = await response.clone().json(); serviceCode = body?.code; } catch { /* No response body is stored. */ }
      await recordDiagnostic({ scope, code: "backend_error", path: "/plataforma", status: response.status, serviceCode, operation });
    }
    return response;
  } catch (error) {
    await recordDiagnostic({ scope, code: "network_error", path: "/plataforma", operation });
    throw error;
  }
}
