import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const nativeRequire = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name), exports);
  return exports;
}
const origin = "https://www.clubrotariosdcolonial.org";
const authRequest = load("../lib/auth-request.ts", { "../utils/site-url": { getPublicSiteOrigin: () => origin } });
const request = (body, ip = "test") => new Request(origin + "/api/auth/recovery-email", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });

test("recovery email validation rejects malformed, oversized and cross-origin input", async () => {
  assert.equal(await authRequest.readRecoveryEmail(request({ email: "  TEST@Example.invalid  " })), "test@example.invalid");
  for (const body of [{ email: "bad" }, { email: "x".repeat(700) }, { password: "never-log-this" }, { email: ["person@example.invalid"] }]) assert.equal(await authRequest.readRecoveryEmail(request(body)), null);
  assert.equal(authRequest.isAuthRequest(new Request(origin)), false);
  assert.equal(authRequest.isAuthRequest(new Request(origin, { headers: { origin: "https://attacker.invalid" } })), false);
  const now = Date.now();
  for (let i = 0; i < 5; i++) assert.equal(authRequest.allowRecoveryLookup("limited", now), true);
  assert.equal(authRequest.allowRecoveryLookup("limited", now), false);
  assert.equal(authRequest.allowRecoveryLookup("limited", now + 600001), true);
});

test("email lookup returns only existence and does not pretend backend errors mean missing accounts", async () => {
  for (const [exists, error, expected] of [[true, null, 200], [false, null, 200], [null, { code: "offline" }, 503]]) {
    const calls = [];
    const route = load("../app/api/auth/recovery-email/route.ts", {
      "@/lib/auth-request": { ...authRequest, allowRecoveryLookup: () => true },
      ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => ({ rpc: async (...args) => { calls.push(args); return { data: exists, error }; } }) },
    });
    const response = await route.POST(request({ email: " person@example.invalid " }));
    assert.equal(response.status, expected);
    assert.deepEqual(calls, [["auth_recovery_email_exists", { email_address: "person@example.invalid" }]]);
    const data = await response.json();
    assert.deepEqual(data, expected === 200 ? { exists } : { error: "lookup_unavailable" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("access requires an authenticated account with active database membership", async () => {
  for (const [state, signedIn, queryError, expected] of [["pending", true, false, 403], ["suspended", true, false, 403], [null, true, false, 403], ["active", true, false, 200], ["active", false, false, 401], ["active", true, true, 503]]) {
    const client = { rpc: async name => { if (name === "account_password_state") return { data: "ready", error: null }; assert.equal(name, "has_privileged_session"); return { data: true, error: null }; }, auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: signedIn ? { id: "actor", user_metadata: { membership_status: "active", role: "admin" } } : null }, error: null }) }, from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: state ? { membership_status: state } : null, error: queryError ? {} : null }) }) };
    const route = load("../app/api/auth/access/route.ts", { "@/lib/auth-request": authRequest, ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client } });
    assert.equal((await route.POST(request({}))).status, expected);
  }
});

test("leaving recovery revokes the requested session scope and always expires only Auth cookies", async () => {
  for (const unavailable of [false, true]) {
    const removed = [], scopes = [], reports = [];
    const jar = { getAll: () => [{ name: "sb-api-auth-token.0" }, { name: "sb-api-auth-token.1" }, { name: "sb-api-auth-token-code-verifier" }, { name: "preferences" }], set: (...args) => removed.push(args) };
    const end = load("../utils/supabase/end-session.ts", {
      "server-only": {}, "next/headers": { cookies: async () => jar }, "./config": { getSupabaseConfig: () => ({ cookieName: "sb-api-auth-token" }) },
      "./server": { createClient: async () => ({ auth: { signOut: async input => { scopes.push(input.scope); if (unavailable) throw new Error("offline"); return { error: null }; } } }) },
      "@/lib/diagnostics-store": { recordDiagnostic: async input => { reports.push(input); } },
    });
    await end.endServerSession(true);
    assert.deepEqual(scopes, ["global"]);
    assert.deepEqual(removed.map(item => item[0]), ["sb-api-auth-token.0", "sb-api-auth-token.1", "sb-api-auth-token-code-verifier"]);
    assert.ok(removed.every(item => item[1] === "" && item[2].maxAge === 0));
    assert.equal(reports.length, unavailable ? 1 : 0);
  }
});
