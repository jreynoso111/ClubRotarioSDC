import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTypeScript(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency ${name} from ${relativePath}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const helpers = loadTypeScript("../lib/membership-applications.ts");
// The real builders run in the tests; only the network call is replaced by each harness.
const emailBuilders = loadTypeScript("../lib/email.ts", { "server-only": {} });
const siteOrigin = "https://www.clubrotariosdcolonial.org";
const receivedMessage = "Recibimos tu solicitud. La gestión del club la revisará y te escribirá a tu correo.";
const baseApplication = {
  fullName: "  María  Pérez  ",
  email: "MARIA@example.org ",
  phone: "+1 (809) 555-0199",
  occupation: "  Educadora  ",
  motivation: "Quiero aportar a proyectos de educación y servicio local.",
  referralSource: "Ana",
  consent: "yes",
};

test("membership applications normalize names and emails and preserve optional details", () => {
  const result = helpers.parseMembershipApplication(baseApplication);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    fullName: "María Pérez",
    email: "maria@example.org",
    phone: "+1 (809) 555-0199",
    occupation: "Educadora",
    motivation: "Quiero aportar a proyectos de educación y servicio local.",
    referralSource: "Ana",
  });
});

test("invalid email, phone, motivation, optional-field length and missing consent are rejected", () => {
  for (const input of [
    { ...baseApplication, email: "no-es-correo" },
    { ...baseApplication, phone: "123" },
    { ...baseApplication, motivation: "Me interesa." },
    { ...baseApplication, occupation: "x".repeat(121) },
    { ...baseApplication, referralSource: "x".repeat(121) },
    { ...baseApplication, consent: "no" },
  ]) {
    assert.equal(helpers.parseMembershipApplication(input).ok, false);
  }
});

test("decline reasons need 5 to 500 characters and optional comments stop at 500", () => {
  assert.match(helpers.membershipDecisionReasonError("declined", "no") ?? "", /motivo del cierre \(5 a 500 caracteres\)/);
  assert.equal(helpers.membershipDecisionReasonError("declined", "Sin cupo este año."), null);
  assert.equal(helpers.membershipDecisionReasonError("contacted", ""), null);
  assert.match(helpers.membershipDecisionReasonError("contacted", "x".repeat(501)) ?? "", /hasta 500/);
});

function setupPublicAction({ rpcError = null, configured = true, captcha = true, allowed = true, emailSent = true } = {}) {
  const writes = [];
  const invalidations = [];
  const captchaChecks = [];
  const rateLimitChecks = [];
  const emails = [];
  const client = {
    from() { throw new Error("Direct table inserts are no longer allowed."); },
    rpc: async (name, value) => {
      writes.push({ rpc: name, value });
      return { error: rpcError };
    },
  };
  const actionModule = loadTypeScript("../app/solicitar-membresia/actions.ts", {
    "node:crypto": { createHash },
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "next/headers": { headers: async () => new Headers({ "cf-connecting-ip": "192.0.2.10" }) },
    "next/server": { after: task => { void task(); } },
    "@/lib/email": { ...emailBuilders, sendClubEmail: async (message) => { emails.push(message); return emailSent; } },
    "@/lib/membership-applications": helpers,
    "@/lib/platform": { isMissingSchemaError: (error) => ["42P01", "PGRST205"].includes(error?.code) },
    "@/lib/rate-limit": { allowRequest: (...args) => { rateLimitChecks.push(args); return allowed; } },
    "@/lib/turnstile-server": { verifyTurnstileToken: async (token, ip) => { captchaChecks.push([token, ip]); return captcha; } },
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => configured },
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  });
  return { action: actionModule.submitMembershipApplicationAction, writes, invalidations, captchaChecks, rateLimitChecks, emails };
}

function formData(input = baseApplication) {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    occupation: input.occupation,
    motivation: input.motivation,
    referralSource: input.referralSource,
    consent: input.consent,
  })) {
    if (value !== undefined && value !== null) data.set(name, String(value));
  }
  return data;
}

const initialState = { ok: false, message: "" };

test("the public form submits only validated applicant details through the throttled RPC", async () => {
  const { action, writes, invalidations, captchaChecks, emails } = setupPublicAction();
  const data = formData();
  data.set("cf-turnstile-response", "token-1");
  const result = await action(initialState, data);

  assert.equal(result.ok, true);
  assert.deepEqual(writes, [{
    rpc: "submit_membership_application",
    value: {
      _full_name: "María Pérez",
      _email: "maria@example.org",
      _phone: "+1 (809) 555-0199",
      _occupation: "Educadora",
      _motivation: "Quiero aportar a proyectos de educación y servicio local.",
      _referral_source: "Ana",
      _consent: true,
    },
  }]);
  assert.deepEqual(captchaChecks, [["token-1", "192.0.2.10"]]);
  assert.deepEqual(invalidations, ["/plataforma"]);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, "maria@example.org");
  assert.equal(emails[0].subject, emailBuilders.applicationReceivedEmail("María Pérez").subject);
});

test("a new application sends exactly one acknowledgement and still succeeds when the email fails", async () => {
  const delivered = setupPublicAction();
  assert.equal((await delivered.action(initialState, formData())).ok, true);
  assert.equal(delivered.emails.length, 1);

  const undelivered = setupPublicAction({ emailSent: false });
  const result = await undelivered.action(initialState, formData());
  assert.equal(result.ok, true);
  assert.equal(result.message, receivedMessage);
});

test("a duplicate open request gets the same confirmation and sends no email", async () => {
  const fresh = setupPublicAction();
  const duplicate = setupPublicAction({ rpcError: { code: "23505" } });
  const freshResult = await fresh.action(initialState, formData());
  const duplicateResult = await duplicate.action(initialState, formData());

  assert.deepEqual(duplicateResult, freshResult);
  assert.equal(duplicateResult.message, receivedMessage);
  assert.equal(duplicate.emails.length, 0);
  assert.deepEqual(duplicate.invalidations, []);
});

test("a failing CAPTCHA is rejected before the rate limits, so it never uses their quota", async () => {
  const captcha = setupPublicAction({ captcha: false });
  const data = formData();
  data.set("cf-turnstile-response", "bad-token");
  assert.equal((await captcha.action(initialState, data)).ok, false);
  assert.deepEqual(captcha.captchaChecks, [["bad-token", "192.0.2.10"]]);
  assert.equal(captcha.rateLimitChecks.length, 0);
  assert.equal(captcha.writes.length, 0);
  assert.equal(captcha.emails.length, 0);

  const verified = setupPublicAction();
  assert.equal((await verified.action(initialState, formData())).ok, true);
  assert.equal(verified.rateLimitChecks.length, 2);
});

test("local limits and the database throttle stop submissions", async () => {
  const limited = setupPublicAction({ allowed: false });
  assert.equal((await limited.action(initialState, formData())).ok, false);
  assert.equal(limited.writes.length, 0);

  const throttled = setupPublicAction({ rpcError: { code: "PT429" } });
  const result = await throttled.action(initialState, formData());
  assert.equal(result.ok, false);
  assert.match(result.message, /muchas solicitudes/);
  assert.deepEqual(throttled.invalidations, []);
  assert.equal(throttled.emails.length, 0);
});

test("invalid data and missing consent never reach the database", async () => {
  const { action, writes } = setupPublicAction();
  const invalid = await action(initialState, formData({ ...baseApplication, email: "invalid" }));
  const noConsent = await action(initialState, formData({ ...baseApplication, consent: "" }));

  assert.equal(invalid.ok, false);
  assert.equal(noConsent.ok, false);
  assert.equal(writes.length, 0);
});

test("the honeypot absorbs automated submissions without storing personal data", async () => {
  const { action, writes, invalidations, emails } = setupPublicAction();
  const data = formData();
  data.set("website", "automated.example");
  const result = await action(initialState, data);

  assert.equal(result.ok, true);
  assert.equal(writes.length, 0);
  assert.equal(invalidations.length, 0);
  assert.equal(emails.length, 0);
});

const applicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const updatedAt = "2026-10-18T12:00:00.123456+00:00";

function applicationRow(overrides = {}) {
  return {
    id: applicationId,
    full_name: "María Pérez",
    occupation: null,
    status: "new",
    submitted_at: "2026-09-30T12:00:00Z",
    updated_at: updatedAt,
    email: null,
    phone: null,
    motivation: null,
    referral_source: null,
    decision_reason: null,
    invited_at: null,
    account_created: false,
    total_count: 1,
    ...overrides,
  };
}

// Every query is recorded so tests can check filters, ordering and the exact write payloads.
function setupPlatformActions({ role = "member", status = "active", signedIn = true, rpc = {}, tables = {}, emailSent = true } = {}) {
  const calls = { rpc: [], queries: [], inserts: [] };
  const invalidations = [];
  const emails = [];
  const emailSender = async (message) => { emails.push(message); return emailSent; };
  const rpcResult = (name, args) => {
    if (name === "has_privileged_session") return { data: true, error: null };
    const configured = rpc[name];
    if (typeof configured === "function") return configured(args);
    return configured ?? { data: null, error: null };
  };
  const client = {
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      return rpcResult(name, args);
    },
    auth: {
      getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }),
      mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) },
      getUser: async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null }),
    },
    from(table) {
      const config = tables[table] ?? {};
      if (table === "memberships") {
        const query = {
          select() { return query; },
          eq() { return query; },
          maybeSingle: async () => ({ data: { membership_role: role, membership_status: status }, error: null }),
        };
        return query;
      }
      return {
        select(columns) {
          calls.queries.push({ table, operation: "select", columns });
          return queryFor(table, config);
        },
        insert(payload) {
          calls.inserts.push({ table, payload });
          return Promise.resolve({ error: config.insertError ?? null });
        },
      };
    },
  };
  function queryFor(table, config) {
    const query = {
      eq(column, value) { calls.queries.push({ table, operation: "eq", column, value }); return query; },
      in(column, values) { calls.queries.push({ table, operation: "in", column, values }); return query; },
      order(column, options) { calls.queries.push({ table, operation: "order", column, options }); return query; },
      limit(count) { calls.queries.push({ table, operation: "limit", count }); return query; },
      maybeSingle: async () => ({ data: config.single ?? null, error: config.error ?? null }),
      then(resolve, reject) { return Promise.resolve({ data: config.rows ?? [], error: config.error ?? null }).then(resolve, reject); },
    };
    return query;
  }
  const actions = loadTypeScript("../app/plataforma/actions.ts", {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: (error) => ["42P01", "42703", "PGRST202", "PGRST205"].includes(error?.code) },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/lib/email": { ...emailBuilders, sendClubEmail: emailSender },
    "@/lib/membership-applications": helpers,
    "@/utils/site-url": { getPublicSiteOrigin: () => siteOrigin },
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  });
  return { actions, calls, invalidations, emails };
}

test("active members load a restricted list through the RPC, while pending and suspended accounts cannot", async () => {
  const active = setupPlatformActions({ rpc: { list_membership_applications: { data: [applicationRow()], error: null } } });
  const result = await active.actions.getMembershipApplicationsAction();
  assert.equal(result.ok, true);
  assert.equal(result.canManage, false);
  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.applications[0].fullName, "María Pérez");
  assert.equal(result.applications[0].email, null);
  assert.deepEqual(active.calls.rpc.filter(call => call.name === "list_membership_applications"), [{
    name: "list_membership_applications",
    args: { _status: null, _search: null, _limit: 20, _offset: 0 },
  }]);

  for (const blocked of ["pending", "suspended"]) {
    const restricted = setupPlatformActions({ status: blocked });
    const denied = await restricted.actions.getMembershipApplicationsAction();
    assert.equal(denied.ok, false);
    assert.equal(restricted.calls.rpc.length, 0);
  }
});

test("club managers see the full record and the list passes filters, trimmed search and the page offset", async () => {
  const manager = setupPlatformActions({
    role: "club_manager",
    rpc: { list_membership_applications: { data: [applicationRow({ email: "maria@example.org", phone: "+1 809 555 0199", motivation: "Quiero servir.", account_created: true, total_count: 45 })], error: null } },
  });
  const result = await manager.actions.getMembershipApplicationsAction({ status: "new", search: "  María  ", page: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.canManage, true);
  assert.equal(result.total, 45);
  assert.equal(result.page, 2);
  assert.equal(result.applications[0].email, "maria@example.org");
  assert.equal(result.applications[0].accountCreated, true);
  assert.deepEqual(manager.calls.rpc.at(-1).args, { _status: "new", _search: "María", _limit: 20, _offset: 20 });
});

test("list input is validated before the database, and the page is clamped to 1..500", async () => {
  const { actions, calls } = setupPlatformActions({ rpc: { list_membership_applications: { data: [applicationRow()], error: null } } });
  assert.equal((await actions.getMembershipApplicationsAction({ status: "unknown" })).ok, false);
  assert.equal((await actions.getMembershipApplicationsAction({ search: "x".repeat(121) })).ok, false);
  assert.equal(calls.rpc.length, 0);

  assert.equal((await actions.getMembershipApplicationsAction({ page: 0 })).page, 1);
  assert.equal((await actions.getMembershipApplicationsAction({ page: 9999 })).page, 500);
  assert.equal((await actions.getMembershipApplicationsAction({ page: 2.9 })).page, 2);
  assert.deepEqual(calls.rpc.map(call => call.args._offset), [0, 9980, 20]);
});

test("a page emptied by a status change falls back to the first page with the real total", async () => {
  const { actions, calls } = setupPlatformActions({
    rpc: {
      list_membership_applications: (args) => args._offset > 0
        ? { data: [], error: null }
        : { data: [applicationRow({ total_count: 25 })], error: null },
    },
  });
  const result = await actions.getMembershipApplicationsAction({ page: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.page, 1);
  assert.equal(result.total, 25);
  assert.deepEqual(calls.rpc.map(call => call.args._offset), [60, 0]);
});

test("only active club managers and admins can review, and the stored timestamp is sent unchanged", async () => {
  const member = setupPlatformActions({ role: "member" });
  assert.equal((await member.actions.reviewMembershipApplicationAction(applicationId, "contacted", null, updatedAt)).code, "forbidden");
  assert.equal(member.calls.rpc.length, 0);

  for (const role of ["club_manager", "admin"]) {
    const manager = setupPlatformActions({ role, rpc: { review_membership_application: { data: "2026-10-18T12:05:00.000001+00:00", error: null } } });
    const result = await manager.actions.reviewMembershipApplicationAction(applicationId, "contacted", "   ", updatedAt);
    assert.equal(result.ok, true);
    assert.deepEqual(manager.calls.rpc.at(-1), {
      name: "review_membership_application",
      args: { _application_id: applicationId, _status: "contacted", _reason: null, _expected_updated_at: updatedAt },
    });
    assert.deepEqual(manager.invalidations, ["/plataforma"]);
    assert.equal(manager.emails.length, 0);
  }
});

test("closing an application needs a reason, and malformed input never reaches the database", async () => {
  const manager = setupPlatformActions({ role: "club_manager" });
  const reviewCalls = () => manager.calls.rpc.filter(call => call.name === "review_membership_application").length;
  for (const reason of ["", "no", "   "]) {
    const result = await manager.actions.reviewMembershipApplicationAction(applicationId, "declined", reason, updatedAt);
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid");
    assert.match(result.message, /motivo del cierre/);
  }
  assert.equal((await manager.actions.reviewMembershipApplicationAction(applicationId, "contacted", null, "ayer")).code, "invalid");
  assert.equal((await manager.actions.reviewMembershipApplicationAction("bad-id", "contacted", null, updatedAt)).code, "invalid");
  assert.equal(reviewCalls(), 0);

  const closed = await manager.actions.reviewMembershipApplicationAction(applicationId, "declined", "Sin cupo este año.", updatedAt);
  assert.equal(closed.ok, true);
  assert.equal(manager.calls.rpc.at(-1).args._reason, "Sin cupo este año.");
});

test("database errors map to clear messages: stale state, duplicate email and a missing reason", async () => {
  const stale = setupPlatformActions({ role: "club_manager", rpc: { review_membership_application: { data: null, error: { code: "P0409", message: "stale_application" } } } });
  const conflict = await stale.actions.reviewMembershipApplicationAction(applicationId, "contacted", null, updatedAt);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "conflict");
  assert.equal(conflict.message, "Otra persona actualizó esta solicitud. Recarga para ver los cambios.");

  const duplicate = setupPlatformActions({
    role: "club_manager",
    tables: { membership_applications: { single: { status: "contacted", email: "maria@example.org", full_name: "María Pérez" } } },
    rpc: { review_membership_application: { data: null, error: { code: "23505", message: "duplicate" } } },
  });
  const sameEmail = await duplicate.actions.reviewMembershipApplicationAction(applicationId, "invited", null, updatedAt);
  assert.equal(sameEmail.message, "Ya hay otra solicitud abierta con ese correo.");

  const missingReason = setupPlatformActions({ role: "club_manager", rpc: { review_membership_application: { data: null, error: { code: "22023", message: "decline_reason_required" } } } });
  const reasonResult = await missingReason.actions.reviewMembershipApplicationAction(applicationId, "contacted", null, updatedAt);
  assert.equal(reasonResult.code, "invalid");
  assert.match(reasonResult.message, /motivo del cierre/);
});

test("moving an application to invited sends one invitation with the sign-up link", async () => {
  const invite = setupPlatformActions({
    role: "club_manager",
    tables: { membership_applications: { single: { status: "contacted", email: "maria@example.org", full_name: "María Pérez" } } },
    rpc: { review_membership_application: { data: "2026-10-18T12:05:00.000001+00:00", error: null } },
  });
  const result = await invite.actions.reviewMembershipApplicationAction(applicationId, "invited", null, updatedAt);
  assert.equal(result.ok, true);
  assert.match(result.message, /Se envió la invitación por correo\./);
  assert.equal(invite.emails.length, 1);
  assert.equal(invite.emails[0].to, "maria@example.org");
  assert.match(invite.emails[0].text, /https:\/\/www\.clubrotariosdcolonial\.org\/auth\/sign-up/);
  assert.match(invite.emails[0].text, /este mismo correo electrónico/);
  assert.match(invite.emails[0].html, /Crear mi cuenta/);
});

test("an invitation whose email cannot be sent says so, and a repeated invitation sends nothing", async () => {
  const failed = setupPlatformActions({
    role: "club_manager",
    tables: { membership_applications: { single: { status: "new", email: "maria@example.org", full_name: "María Pérez" } } },
    emailSent: false,
    rpc: { review_membership_application: { data: "2026-10-18T12:05:00.000001+00:00", error: null } },
  });
  const result = await failed.actions.reviewMembershipApplicationAction(applicationId, "invited", null, updatedAt);
  assert.equal(result.ok, true);
  assert.match(result.message, /No se pudo enviar el correo; comunícate con la persona\./);

  const repeated = setupPlatformActions({
    role: "club_manager",
    tables: { membership_applications: { single: { status: "invited", email: "maria@example.org", full_name: "María Pérez" } } },
    rpc: { review_membership_application: { data: "2026-10-18T12:05:00.000001+00:00", error: null } },
  });
  const again = await repeated.actions.reviewMembershipApplicationAction(applicationId, "invited", null, updatedAt);
  assert.equal(again.ok, true);
  assert.equal(repeated.emails.length, 0);
});

test("only management reads notes and history, which arrive in creation order with author names", async () => {
  const tables = {
    membership_application_notes: { rows: [{ id: "note-1", body: "Llamé a la persona.", author_id: userId, created_at: "2026-10-01T10:00:00Z" }] },
    membership_application_history: { rows: [{ id: "h-1", from_status: null, to_status: "new", reason: null, actor_id: null, created_at: "2026-09-30T12:00:00Z" }, { id: "h-2", from_status: "new", to_status: "declined", reason: "Sin cupo este año.", actor_id: userId, created_at: "2026-10-02T09:00:00Z" }] },
    profiles: { rows: [{ id: userId, display_name: "Ana Rivera" }] },
  };
  const denied = setupPlatformActions({ role: "member", tables });
  assert.equal((await denied.actions.getMembershipApplicationDetailAction(applicationId)).code, "forbidden");
  assert.equal(denied.calls.queries.length, 0);

  const manager = setupPlatformActions({ role: "club_manager", tables });
  const detail = await manager.actions.getMembershipApplicationDetailAction(applicationId);
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.notes, [{ id: "note-1", body: "Llamé a la persona.", createdAt: "2026-10-01T10:00:00Z", author: "Ana Rivera" }]);
  assert.deepEqual(detail.history, [
    { id: "h-1", fromStatus: null, toStatus: "new", reason: null, actor: "Miembro del club", createdAt: "2026-09-30T12:00:00Z" },
    { id: "h-2", fromStatus: "new", toStatus: "declined", reason: "Sin cupo este año.", actor: "Ana Rivera", createdAt: "2026-10-02T09:00:00Z" },
  ]);
  const ordered = manager.calls.queries.filter(query => query.operation === "order");
  assert.ok(ordered.length >= 2);
  assert.ok(ordered.every(query => query.column === "created_at" && query.options.ascending === true));
});

test("note bodies are trimmed, limited to 2000 characters and inserted with only the allowed columns", async () => {
  const manager = setupPlatformActions({ role: "club_manager" });
  assert.equal((await manager.actions.addMembershipApplicationNoteAction(applicationId, "   ")).code, "invalid");
  assert.equal((await manager.actions.addMembershipApplicationNoteAction(applicationId, "x".repeat(2001))).code, "invalid");
  assert.equal(manager.calls.inserts.length, 0);

  const saved = await manager.actions.addMembershipApplicationNoteAction(applicationId, "  Llamé a la persona.  ");
  assert.equal(saved.ok, true);
  assert.deepEqual(manager.calls.inserts, [{
    table: "membership_application_notes",
    payload: { application_id: applicationId, body: "Llamé a la persona." },
  }]);

  const member = setupPlatformActions({ role: "member" });
  assert.equal((await member.actions.addMembershipApplicationNoteAction(applicationId, "Nota")).code, "forbidden");
  assert.equal(member.calls.inserts.length, 0);
});

test("home join calls open the application form and member access still opens sign-in", () => {
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../components/public/PublicChrome.tsx", import.meta.url), "utf8");
  assert.match(home, /href="\/solicitar-membresia">\s*Quiero ser miembro/);
  assert.match(home, /href="\/solicitar-membresia">Ser miembro/);
  assert.match(header, /href="\/auth\/sign-in\?next=\/plataforma">\s*Acceso miembros/);
  assert.match(header, /brandTagline}>Generar un impacto duradero/);
  assert.doesNotMatch(header, /brandTagline}>Crear un impacto duradero/);
});

test("database grants and policies share application data only with active members", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260930163901_public_membership_applications.sql", import.meta.url), "utf8");
  assert.match(migration, /alter table public\.membership_applications enable row level security/i);
  assert.match(migration, /grant insert \(full_name, email, phone, occupation, motivation, referral_source, consented_to_member_sharing\)\s+on public\.membership_applications to anon, authenticated/i);
  assert.match(migration, /to authenticated\s+using \(\(select private\.is_active_member\(\)\)\)/i);
  assert.match(migration, /private\.has_any_role\(array\['club_manager', 'admin'\]\)/i);
  assert.match(migration, /reviewed_by is null\s+and consented_to_member_sharing/i);
});
