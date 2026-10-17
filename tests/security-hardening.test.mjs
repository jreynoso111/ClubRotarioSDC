import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { mfaDependencies, mfaPolicy } from "./helpers/mfa-deps.mjs";

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const now = Date.UTC(2026, 9, 17, 12, 0, 0);
const seconds = value => Math.floor(value / 1000);
const claims = (aal, method, ageSeconds) => ({ aal, amr: [{ method: "password", timestamp: seconds(now) - 7200 }, { method, timestamp: seconds(now) - ageSeconds }] });
const liveClaims = () => ({ aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) - 60 }] });

test("privileged access needs aal2 and a second factor verified in the last 12 hours", () => {
  assert.equal(mfaPolicy.hasRecentSecondFactor(claims("aal2", "totp", 60), now), true);
  assert.equal(mfaPolicy.hasRecentSecondFactor(claims("aal2", "totp", 12 * 3600), now), true);
  assert.equal(mfaPolicy.hasRecentSecondFactor(claims("aal2", "totp", 12 * 3600 + 1), now), false);
  assert.equal(mfaPolicy.hasRecentSecondFactor(claims("aal1", "totp", 60), now), false);
  assert.equal(mfaPolicy.hasRecentSecondFactor(claims("aal2", "password", 60), now), false);
  assert.equal(mfaPolicy.hasRecentSecondFactor(claims("aal2", "totp", -120), now), false);
  for (const malformed of [null, "aal2", { aal: "aal2", amr: "totp" }, { aal: "aal2", amr: [null, { method: "totp", timestamp: "now" }] }]) {
    assert.equal(mfaPolicy.hasRecentSecondFactor(malformed, now), false);
  }
  assert.equal(mfaPolicy.privilegedSecurityState("member", null, false, now), "not_required");
  assert.equal(mfaPolicy.privilegedSecurityState("editor", null, false, now), "not_required");
  assert.equal(mfaPolicy.privilegedSecurityState("admin", null, false, now), "enroll");
  assert.equal(mfaPolicy.privilegedSecurityState("club_manager", claims("aal2", "totp", 13 * 3600), true, now), "verify");
  assert.equal(mfaPolicy.privilegedSecurityState("admin", claims("aal2", "totp", 60), true, now), "verified");
});

test("SQL and TypeScript share the same 12-hour window and privileged roles", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261017013000_privileged_roles_require_recent_mfa.sql", import.meta.url), "utf8");
  assert.match(sql, new RegExp(`- ${mfaPolicy.secondFactorMaxAgeSeconds}\\b`));
  assert.match(sql, /membership_role not in \('admin', 'club_manager'\)/);
  assert.deepEqual([...mfaPolicy.privilegedRoles].sort(), ["admin", "club_manager"]);
});

function moduleAuth({ role, fresh }) {
  const client = {
    rpc: async name => { assert.equal(name, "has_privileged_session"); return { data: fresh, error: null }; },
    auth: {
      getUser: async () => ({ data: { user: { id: "actor" } }, error: null }),
      getClaims: async () => ({ data: { claims: fresh ? liveClaims() : { aal: "aal1", amr: [] } }, error: null }),
    },
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { membership_role: role, membership_status: "active" }, error: null }) }),
  };
  return load("../app/plataforma/module-auth.ts", {
    "server-only": {}, "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  });
}

test("without a recent second factor an admin is denied privileged actions and acts as a member elsewhere", async () => {
  const stale = moduleAuth({ role: "admin", fresh: false });
  const denied = await stale.requireModuleActor(["admin"]);
  assert.equal(denied.error?.code, "forbidden");
  assert.match(denied.error.message, /verificación en dos pasos/);
  const general = await stale.requireModuleActor(["member", "coordinator", "editor", "club_manager", "admin"]);
  assert.equal(general.actor.role, "member");

  const verified = moduleAuth({ role: "admin", fresh: true });
  assert.equal((await verified.requireModuleActor(["admin"])).actor.role, "admin");
  const editor = moduleAuth({ role: "editor", fresh: false });
  assert.equal((await editor.requireModuleActor(["editor", "admin"])).actor.role, "editor");
});

test("the access check tells privileged sign-ins whether to enroll or verify a second factor", async () => {
  const origin = "https://www.clubrotariosdcolonial.org";
  const authRequest = load("../lib/auth-request.ts", { "../utils/site-url": { getPublicSiteOrigin: () => origin } });
  const cases = [["member", false, [], "not_required"], ["admin", false, [], "enroll"], ["admin", false, [{ id: "f" }], "verify"], ["club_manager", true, [{ id: "f" }], "verified"]];
  for (const [role, fresh, totp, expected] of cases) {
    const client = {
      rpc: async name => { assert.equal(name, "has_privileged_session"); return { data: fresh, error: null }; },
      auth: {
        getUser: async () => ({ data: { user: { id: "actor" } }, error: null }),
        getClaims: async () => ({ data: { claims: fresh ? liveClaims() : { aal: "aal1" } }, error: null }),
        mfa: { listFactors: async () => ({ data: { all: totp, totp }, error: null }) },
      },
      from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { membership_status: "active", membership_role: role }, error: null }) }),
    };
    const route = load("../app/api/auth/access/route.ts", { "@/lib/auth-request": authRequest, ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client } });
    const response = await route.POST(new Request(origin + "/api/auth/access", { method: "POST", headers: { origin } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state: "active", mfa: expected });
  }
});

test("the CSP uses a fresh nonce, strict-dynamic and only the configured API origins", () => {
  const csp = load("../lib/csp.ts");
  const first = csp.createNonce(), second = csp.createNonce();
  assert.notEqual(first, second);
  const policy = csp.buildContentSecurityPolicy(first, { supabaseUrls: ["https://api.clubrotariosdcolonial.org/", "not a url"], reportUri: "/api/csp-report" });
  assert.match(policy, new RegExp(`script-src 'self' 'nonce-${first.replace(/[+/=]/g, "\\$&")}' 'strict-dynamic' https://challenges.cloudflare.com;`));
  assert.ok(!policy.includes("unsafe-eval"));
  assert.match(policy, /connect-src 'self' https:\/\/api\.clubrotariosdcolonial\.org https:\/\/challenges\.cloudflare\.com;/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /report-uri \/api\/csp-report$/);
  assert.match(csp.buildContentSecurityPolicy(first, { dev: true }), /'unsafe-eval'/);
  assert.throws(() => csp.buildContentSecurityPolicy("bad'; script-src *"));
  assert.equal(csp.cspViolationCode("script-src-elem"), "csp_script");
  assert.equal(csp.cspViolationCode(undefined), "csp_other");
});

test("CSP reports store only a fixed code and a known route", async () => {
  const saved = [];
  const route = load("../app/api/csp-report/route.ts", {
    "node:crypto": await import("node:crypto"),
    "@/lib/csp": load("../lib/csp.ts"),
    "@/lib/diagnostics": load("../lib/diagnostics.ts"),
    "@/lib/diagnostics-ingest": { allowDiagnostic: () => true },
    "@/lib/diagnostics-store": { recordDiagnostic: async input => { saved.push(input); return "id"; } },
  });
  const body = JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem", "document-uri": "https://www.clubrotariosdcolonial.org/revista?email=private@example.org", "blocked-uri": "https://evil.example/x.js", "script-sample": "secret" } });
  const response = await route.POST(new Request("https://www.clubrotariosdcolonial.org/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body }));
  assert.equal(response.status, 204);
  assert.equal(saved.length, 1);
  assert.deepEqual(Object.keys(saved[0]).sort(), ["browser", "code", "path", "scope", "source"]);
  assert.deepEqual([saved[0].scope, saved[0].code, saved[0].path], ["browser", "csp_script", "/revista"]);
  assert.ok(!JSON.stringify(saved).includes("evil") && !JSON.stringify(saved).includes("secret") && !JSON.stringify(saved).includes("private"));
  const rejected = await route.POST(new Request("https://www.clubrotariosdcolonial.org/api/csp-report", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(rejected.status, 415);
});

test("the in-memory limiter enforces per-key windows and a bounded key table", () => {
  const { allowRequest } = load("../lib/rate-limit.ts");
  for (let i = 0; i < 3; i++) assert.equal(allowRequest("t", "a", 3, 1000, now), true);
  assert.equal(allowRequest("t", "a", 3, 1000, now), false);
  assert.equal(allowRequest("t", "b", 3, 1000, now), true);
  assert.equal(allowRequest("t", "a", 3, 1000, now + 1001), true);
});

test("Turnstile verification is off without keys and fails closed once configured", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  try {
    delete process.env.TURNSTILE_SECRET_KEY; delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const turnstile = load("../lib/turnstile-server.ts", { "server-only": {} });
    assert.equal(await turnstile.verifyTurnstileToken(undefined), true);
    process.env.TURNSTILE_SECRET_KEY = "test-secret"; process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site";
    process.env.TURNSTILE_HOSTNAMES = 'www.clubrotariosdcolonial.org';
    const sent = [];
    globalThis.fetch = async (url, init) => { sent.push([url, String(init.body)]); return Response.json({ success: init.body.get("response") === "good", hostname: 'www.clubrotariosdcolonial.org', action: 'membership_application' }); };
    assert.equal(await turnstile.verifyTurnstileToken(""), false);
    assert.equal(await turnstile.verifyTurnstileToken("x".repeat(3000)), false);
    assert.equal(await turnstile.verifyTurnstileToken("bad", "192.0.2.1"), false);
    assert.equal(await turnstile.verifyTurnstileToken("good", "192.0.2.1"), true);
    for (const result of [{ success: true, hostname: 'localhost', action: 'membership_application' }, { success: true, hostname: 'www.clubrotariosdcolonial.org', action: 'login' }]) {
      globalThis.fetch = async () => Response.json(result);
      assert.equal(await turnstile.verifyTurnstileToken('good'), false);
    }
    assert.ok(sent.every(([url]) => url === "https://challenges.cloudflare.com/turnstile/v0/siteverify"));
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await turnstile.verifyTurnstileToken("good"), false);
  } finally {
    process.env = saved;
    globalThis.fetch = realFetch;
  }
});
