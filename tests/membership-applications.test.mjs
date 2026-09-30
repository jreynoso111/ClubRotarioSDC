import assert from "node:assert/strict";
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

function setupPublicAction({ insertError = null, configured = true } = {}) {
  const writes = [];
  const invalidations = [];
  const client = {
    from(table) {
      return {
        insert: async (value) => {
          writes.push({ table, value });
          return { error: insertError };
        },
      };
    },
  };
  const actionModule = loadTypeScript("../app/solicitar-membresia/actions.ts", {
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/membership-applications": helpers,
    "@/lib/platform": { isMissingSchemaError: (error) => ["42P01", "PGRST205"].includes(error?.code) },
    "@/utils/supabase/config": { isSupabaseConfigured: () => configured },
    "@/utils/supabase/server": { createClient: async () => client },
  });
  return { action: actionModule.submitMembershipApplicationAction, writes, invalidations };
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

test("the public form stores only validated applicant details and revalidates the platform", async () => {
  const { action, writes, invalidations } = setupPublicAction();
  const result = await action({ ok: false, message: "" }, formData());

  assert.equal(result.ok, true);
  assert.deepEqual(writes, [{
    table: "membership_applications",
    value: {
      full_name: "María Pérez",
      email: "maria@example.org",
      phone: "+1 (809) 555-0199",
      occupation: "Educadora",
      motivation: "Quiero aportar a proyectos de educación y servicio local.",
      referral_source: "Ana",
      consented_to_member_sharing: true,
    },
  }]);
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("invalid data and missing consent never reach the database", async () => {
  const { action, writes } = setupPublicAction();
  const invalid = await action({ ok: false, message: "" }, formData({ ...baseApplication, email: "invalid" }));
  const noConsent = await action({ ok: false, message: "" }, formData({ ...baseApplication, consent: "" }));

  assert.equal(invalid.ok, false);
  assert.equal(noConsent.ok, false);
  assert.equal(writes.length, 0);
});

test("the honeypot absorbs automated submissions without storing personal data", async () => {
  const { action, writes, invalidations } = setupPublicAction();
  const data = formData();
  data.set("website", "automated.example");
  const result = await action({ ok: false, message: "" }, data);

  assert.equal(result.ok, true);
  assert.equal(writes.length, 0);
  assert.equal(invalidations.length, 0);
});

function setupPlatformActions({ role = "member", status = "active", signedIn = true } = {}) {
  const writes = [];
  const invalidations = [];
  const applicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const applications = [{
    id: applicationId,
    full_name: "María Pérez",
    email: "maria@example.org",
    phone: "+1 809 555 0199",
    occupation: null,
    motivation: "Quiero aportar a proyectos locales de servicio.",
    referral_source: null,
    status: "new",
    submitted_at: "2026-09-30T12:00:00Z",
    updated_at: "2026-09-30T12:00:00Z",
  }];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null }) },
    from(table) {
      if (table === "memberships") {
        const query = {
          select() { return query; },
          eq() { return query; },
          maybeSingle: async () => ({ data: { membership_role: role, membership_status: status }, error: null }),
        };
        return query;
      }

      let operation = null;
      let value = null;
      const query = {
        select(fields) { writes.push({ table, operation: "select", fields }); return query; },
        order(column, options) { writes.push({ table, operation: "order", column, options }); return query; },
        limit(count) { writes.push({ table, operation: "limit", count }); return query; },
        update(input) { operation = "update"; value = input; writes.push({ table, operation, value }); return query; },
        eq(column, target) { writes.push({ table, operation: "filter", column, target }); return query; },
        maybeSingle: async () => ({ data: { id: applicationId }, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: applications, error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
  const source = loadTypeScript("../app/plataforma/actions.ts", {
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: (error) => ["42P01", "42703", "PGRST202", "PGRST205"].includes(error?.code) },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  });
  return { actions: source, writes, invalidations, applicationId, userId };
}

test("active members can load applications while pending and suspended accounts cannot", async () => {
  const active = setupPlatformActions({ role: "member" });
  const result = await active.actions.getMembershipApplicationsAction();
  assert.equal(result.ok, true);
  assert.equal(result.applications[0].full_name, "María Pérez");
  assert.ok(active.writes.some(write => write.table === "membership_applications" && write.operation === "select"));

  for (const status of ["pending", "suspended"]) {
    const restricted = setupPlatformActions({ status });
    const denied = await restricted.actions.getMembershipApplicationsAction();
    assert.equal(denied.ok, false);
    assert.equal(restricted.writes.length, 0);
  }
});

test("only active club managers and admins can change application status, attributed to themselves", async () => {
  for (const role of ["club_manager", "admin"]) {
    const manager = setupPlatformActions({ role });
    const result = await manager.actions.updateMembershipApplicationStatusAction(manager.applicationId, "contacted");
    assert.equal(result.ok, true);
    assert.ok(manager.writes.some(write => write.table === "membership_applications" && write.value?.reviewed_by === manager.userId));
    assert.deepEqual(manager.invalidations, ["/plataforma"]);
  }

  const member = setupPlatformActions({ role: "member" });
  assert.equal((await member.actions.updateMembershipApplicationStatusAction(member.applicationId, "invited")).code, "forbidden");
  assert.equal(member.writes.some(write => write.operation === "update"), false);
  assert.equal((await member.actions.updateMembershipApplicationStatusAction("bad-id", "unknown")).code, "forbidden");
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
