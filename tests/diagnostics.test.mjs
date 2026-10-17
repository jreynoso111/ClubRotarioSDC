import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name), exports);
  return exports;
}
const model = load("../lib/diagnostics.ts");
const ingestion = load("../lib/diagnostics-ingest.ts", { "./diagnostics": model });
const origin = "https://www.clubrotariosdcolonial.org";
test("browser classification identifies React and JavaScript errors without retaining their messages", () => {
  const secret = "private-email@example.invalid secret-token";
  assert.deepEqual(model.browserDiagnosticDetails({ message: `Minified React error #418; ${secret}` }), { code: "hydration_error", reactCode: "418" });
  assert.deepEqual(model.browserDiagnosticDetails({ message: `Minified React error #423; ${secret}` }), { code: "react_error", reactCode: "423" });
  assert.deepEqual(model.browserDiagnosticDetails(new TypeError(secret)), { code: "type_error" });
  assert.deepEqual(model.browserDiagnosticDetails(new ReferenceError(secret)), { code: "reference_error" });
  assert.deepEqual(model.browserDiagnosticDetails({ message: secret }), { code: "unexpected_error" });
});
function request(body, headers = {}) {
  return new Request(`${origin}/api/diagnostics`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("public reports cannot write secrets, forge server events, or choose their reference", async () => {
  let captured;
  const secret = "private-secret-do-not-store";
  const response = await ingestion.ingestDiagnostic(request({ scope: "login", code: "invalid_credentials", status: 400, path: "/auth/sign-in?token=" + secret,
    source: "server", id: secret, frames: [secret], message: secret, email: "private@example.invalid", password: secret, cookie: secret }), "safe-public", async event => { captured = event; return "generated-reference"; });
  assert.equal(response.status, 201);
  assert.equal(captured.source, "client");
  assert.equal(captured.path, "/auth/sign-in");
  assert.equal(JSON.stringify(captured).includes(secret), false);
  assert.equal(JSON.stringify(captured).includes("private@example.invalid"), false);
  assert.equal((await response.json()).id, "generated-reference");
  assert.equal((await ingestion.ingestDiagnostic(request({ scope: "server", code: "test_event" }), "forged", async () => assert.fail())).status, 400);
  assert.equal(model.diagnosticPath("/revista/private-person-name"), "/[otra-ruta]");
});

test("ingestion rejects cross-origin, missing origin, oversized and malformed payloads", async () => {
  for (const input of [request({}, { origin: "https://attacker.invalid" }), request({}, { origin: "null" })]) {
    assert.equal((await ingestion.ingestDiagnostic(input, "bad-origin", async () => assert.fail())).status, 403);
  }
  assert.equal((await ingestion.ingestDiagnostic(request({ scope: "login", text: "x".repeat(3000) }), "oversized", async () => assert.fail())).status, 413);
  const malformed = new Request(`${origin}/api/diagnostics`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" });
  assert.equal((await ingestion.ingestDiagnostic(malformed, "malformed", async () => assert.fail())).status, 400);
  assert.equal((await ingestion.ingestDiagnostic(request({ scope: "login" }), "unwritable", async () => null)).status, 503);
});

test("rate limiting expires and bounds repeated reports", () => {
  const now = Date.now();
  for (let i = 0; i < 20; i++) assert.equal(ingestion.allowDiagnostic("limited", now), true);
  assert.equal(ingestion.allowDiagnostic("limited", now), false);
  assert.equal(ingestion.allowDiagnostic("limited", now + 60001), true);
});

test("diagnostic API enforces real user and active admin membership on reads and tests", async () => {
  for (const [role, status, signedIn, expected] of [["admin", "active", false, 401], ["member", "active", true, 403], ["club_manager", "active", true, 403], ["admin", "pending", true, 403], ["admin", "suspended", true, 403], ["admin", "active", true, 200]]) {
    let reads = 0, writes = 0;
    const client = { rpc: async name => { assert.equal(name, "has_privileged_session"); return { data: true, error: null }; }, auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: signedIn ? { id: "actor", user_metadata: { role: "admin" } } : null }, error: null }) }, from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { membership_role: role, membership_status: status }, error: null }) }) };
    const route = load("../app/api/diagnostics/route.ts", {
      ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client }, "@/lib/diagnostics": model,
      "@/lib/diagnostics-ingest": ingestion, "@/lib/diagnostics-store": { readDiagnostics: async () => { reads++; return []; }, recordDiagnostic: async () => { writes++; return "test-id"; } },
    });
    const get = await route.GET();
    assert.equal(get.status, expected);
    assert.equal(get.headers.get("cache-control"), "private, no-store");
    const put = await route.PUT(new Request(`${origin}/api/diagnostics`, { method: "PUT", headers: { origin } }));
    assert.equal(put.status, expected === 200 ? 201 : expected);
    assert.equal(reads, expected === 200 ? 1 : 0);
    assert.equal(writes, expected === 200 ? 1 : 0);
  }
});

test("durable storage survives reload, strips secrets, expires old entries and rotates bounded files", async () => {
  const root = await mkdtemp(join(tmpdir(), "club-diag-test-"));
  const previous = process.env.CLUB_DIAGNOSTICS_DIR;
  process.env.CLUB_DIAGNOSTICS_DIR = root;
  const store = () => load("../lib/diagnostics-store.ts", { "./diagnostics": model });
  try {
    const old = { id: "expired", createdAt: "2000-01-01T00:00:00.000Z" };
    await writeFile(join(root, "events.jsonl"), JSON.stringify(old) + "\n");
    const first = store();
    const id = await first.recordDiagnostic({ code: "invalid_credentials", scope: "login", source: "client", path: "/auth/sign-in?password=secret", serviceCode: "private-secret", frames: ["private-secret", "22:33"], digest: "private-secret", message: "private-secret" });
    const persisted = await readFile(join(root, "events.jsonl"), "utf8");
    assert.equal(persisted.includes("private-secret"), false);
    assert.equal(persisted.includes("expired"), false);
    const second = store();
    const entries = await second.readDiagnostics();
    assert.equal(entries[0].id, id);
    assert.equal(entries[0].source, "client");
    assert.equal(entries[0].path, "/auth/sign-in");
    assert.deepEqual(entries[0].frames, ["22:33"]);
    const line = JSON.stringify(entries[0]) + "\n";
    await writeFile(join(root, "events.jsonl"), line.repeat(Math.ceil(524288 / line.length)));
    await second.recordDiagnostic({ scope: "test", code: "test_event" });
    assert.ok((await readdir(root)).includes("events.1.jsonl"));
    assert.ok((await second.readDiagnostics()).length <= 1000);
    await Promise.all(Array.from({ length: 10 }, () => second.recordDiagnostic({ scope: "test", code: "test_event" })));
    const tail = (await readFile(join(root, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(tail.length, 11);
    assert.equal(new Set(tail.map(item => item.id)).size, 11);
  } finally { if (previous === undefined) delete process.env.CLUB_DIAGNOSTICS_DIR; else process.env.CLUB_DIAGNOSTICS_DIR = previous; await rm(root, { recursive: true }); }
});
