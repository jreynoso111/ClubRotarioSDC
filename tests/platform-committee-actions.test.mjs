import { mfaDependencies, mfaPolicy } from "./helpers/mfa-deps.mjs";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const actionsSource = compile("../app/plataforma/actions.ts");
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondMemberId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const committeeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const duplicateNameError = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "committees_slug_key"',
  details: "Key (slug)=(servicio) already exists.",
};
const oneChairError = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "committee_members_one_chair_idx"',
  details: "Key (committee_id)=(cccccccc-cccc-4ccc-8ccc-cccccccccccc) already exists.",
};

// options.mfa: false simulates a session without a recent second factor.
// options.failures: { rpc, "<table>.<operation>" } returns that database error.
// options.missing: ["<table>.<operation>"] returns no row (already finished, active, or hidden).
function setup(role = "admin", activeMemberIds = [memberId], membershipStatus = "active", options = {}) {
  const writes = [];
  const calls = [];
  const invalidations = [];
  const failures = options.failures ?? {};
  const missing = new Set(options.missing ?? []);
  const now = Math.floor(Date.now() / 1000);
  const claims = options.mfa === false
    ? { aal: "aal1", amr: [{ method: "password", timestamp: now }] }
    : { aal: "aal2", amr: [{ method: "totp", timestamp: now }] };

  const client = {
    auth: { getClaims: async () => ({ data: { claims }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    from(table) {
      const filters = [];
      let operation = "select";
      const writeError = () => (operation === "select" ? null : failures[`${table}.${operation}`] ?? null);
      const query = {
        select(columns) { query.selected = columns; return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        in(column, values) { filters.push([column, values]); return query; },
        order() { return query; },
        insert(value) { operation = "insert"; writes.push({ table, operation, value }); return query; },
        update(value) { operation = "update"; writes.push({ table, operation, value, filters }); return query; },
        upsert(value, upsertOptions) { operation = "upsert"; writes.push({ table, operation, value, options: upsertOptions, filters }); return query; },
        delete() { operation = "delete"; writes.push({ table, operation, filters }); return query; },
        async maybeSingle() {
          const error = writeError();
          if (error) return { data: null, error };
          if (missing.has(`${table}.${operation}`)) return { data: null, error: null };
          if (table === "memberships" && !filters.some(([column]) => column === "membership_status")) {
            return { data: { membership_role: role, membership_status: membershipStatus }, error: null };
          }
          if (table === "memberships" && filters.some(([column, value]) => column === "user_id" && value === memberId)) {
            return { data: activeMemberIds.includes(memberId) ? { user_id: memberId } : null, error: null };
          }
          if (table === "committees") return { data: { id: committeeId }, error: null };
          return { data: { id: committeeId, user_id: memberId }, error: null };
        },
        then(resolve, reject) {
          const error = writeError();
          const inFilter = filters.find(([column, value]) => column === "user_id" && Array.isArray(value));
          const requestedIds = inFilter?.[1] ?? [];
          return Promise.resolve({
            data: activeMemberIds.filter((id) => requestedIds.includes(id)).map((user_id) => ({ user_id })),
            error,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      if (name === "has_privileged_session") return { data: true, error: null };
      calls.push({ name, args });
      return failures.rpc ? { data: null, error: failures.rpc } : { data: committeeId, error: null };
    },
  };

  const dependencies = {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true }, "@/lib/email": {}, "@/lib/membership-applications": {}, "@/utils/site-url": {},
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", actionsSource)((name) => dependencies[name], actions);
  return { actions, calls, invalidations, writes };
}

test("an admin creates a committee and its initial roster in one database function call", async () => {
  const { actions, calls, invalidations } = setup();
  const result = await actions.createCommitteeAction({
    name: "Servicio a la comunidad",
    description: "Coordina proyectos locales.",
    members: [{ userId: memberId, committeeRole: "chair" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, committeeId);
  assert.deepEqual(calls, [{
    name: "create_committee_with_members",
    args: {
      _name: "Servicio a la comunidad",
      _slug: "servicio-a-la-comunidad",
      _description: "Coordina proyectos locales.",
      _member_ids: [memberId],
      _member_roles: ["chair"],
    },
  }]);
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("club managers manage committees exactly like admins, including reopening a finished one", async () => {
  const { actions, writes, calls, invalidations } = setup("club_manager");
  assert.equal((await actions.createCommitteeAction({ name: "Servicio", members: [{ userId: memberId, committeeRole: "chair" }] })).ok, true);
  assert.equal((await actions.updateCommitteeAction({ committeeId, name: "Servicio local", description: "Nueva." })).ok, true);
  assert.equal((await actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "secretary" })).ok, true);
  assert.equal((await actions.removeCommitteeMemberAction({ committeeId, userId: memberId })).ok, true);
  assert.equal((await actions.completeCommitteeAction(committeeId)).ok, true);
  assert.equal((await actions.reopenCommitteeAction(committeeId)).ok, true);

  assert.equal(calls[0].name, "create_committee_with_members");
  const committeeUpdates = writes.filter(({ table, operation }) => table === "committees" && operation === "update");
  assert.deepEqual(committeeUpdates.map(({ value }) => value), [
    { name: "Servicio local", description: "Nueva.", updated_by: actorId },
    { is_active: false, updated_by: actorId },
    { is_active: true, updated_by: actorId },
  ]);
  assert.deepEqual(committeeUpdates[2].filters, [["id", committeeId], ["is_active", false]]);
  assert.equal(invalidations.length, 6);
});

test("reopening only applies to a finished committee and reports one that is already active", async () => {
  const finished = setup("club_manager");
  assert.equal((await finished.actions.reopenCommitteeAction(committeeId)).message, "El comité volvió a estar activo con su lista anterior.");
  assert.deepEqual(finished.writes[0].filters, [["id", committeeId], ["is_active", false]]);

  const active = setup("club_manager", [memberId], "active", { missing: ["committees.update"] });
  assert.deepEqual(await active.actions.reopenCommitteeAction(committeeId), {
    ok: false,
    message: "El comité ya está activo o no está disponible.",
    code: "invalid",
  });
  assert.equal((await setup().actions.reopenCommitteeAction("not-a-uuid")).code, "invalid");
});

test("coordinators and editors cannot create, edit, finish, reopen or change a committee roster", async () => {
  for (const role of ["coordinator", "editor", "member"]) {
    const { actions, writes, calls } = setup(role);
    const results = await Promise.all([
      actions.createCommitteeAction({ name: "Servicio" }),
      actions.updateCommitteeAction({ committeeId, name: "Servicio local" }),
      actions.completeCommitteeAction(committeeId),
      actions.reopenCommitteeAction(committeeId),
      actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "secretary" }),
      actions.removeCommitteeMemberAction({ committeeId, userId: memberId }),
    ]);

    assert.ok(results.every((result) => result.code === "forbidden"), role);
    assert.deepEqual(writes, []);
    assert.deepEqual(calls, []);
  }
});

test("a suspended administrator or club manager cannot manage committees", async () => {
  for (const role of ["admin", "club_manager"]) {
    const { actions, writes, calls } = setup(role, [memberId], "suspended");
    const results = await Promise.all([
      actions.createCommitteeAction({ name: "Servicio" }),
      actions.updateCommitteeAction({ committeeId, name: "Servicio local" }),
      actions.completeCommitteeAction(committeeId),
      actions.reopenCommitteeAction(committeeId),
      actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "secretary" }),
      actions.removeCommitteeMemberAction({ committeeId, userId: memberId }),
    ]);

    assert.ok(results.every((result) => result.code === "suspended"), role);
    assert.deepEqual(writes, []);
    assert.deepEqual(calls, []);
  }
});

test("club managers and admins without a recent second factor are refused before any write", async () => {
  for (const role of ["club_manager", "admin"]) {
    const { actions, writes, calls } = setup(role, [memberId], "active", { mfa: false });
    const results = await Promise.all([
      actions.createCommitteeAction({ name: "Servicio" }),
      actions.updateCommitteeAction({ committeeId, name: "Servicio local" }),
      actions.completeCommitteeAction(committeeId),
      actions.reopenCommitteeAction(committeeId),
      actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "secretary" }),
      actions.removeCommitteeMemberAction({ committeeId, userId: memberId }),
    ]);

    assert.ok(results.every((result) => result.ok === false && result.code === "forbidden" && result.message === mfaPolicy.secondFactorRequiredMessage), role);
    assert.deepEqual(writes, []);
    assert.deepEqual(calls, []);
  }
});

test("a duplicate committee name is reported as a name conflict on create, edit and reopen", async () => {
  const expected = { ok: false, message: "Ya existe un comité con ese nombre.", code: "conflict" };
  const creating = setup("club_manager", [memberId], "active", { failures: { rpc: duplicateNameError } });
  assert.deepEqual(await creating.actions.createCommitteeAction({ name: "Servicio" }), expected);

  // Editing keeps the slug, so the collision comes from a case-insensitive name index.
  const nameIndexError = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "committees_name_active_idx"',
    details: "Key (lower(name))=(servicio) already exists.",
  };
  const editing = setup("club_manager", [memberId], "active", { failures: { "committees.update": nameIndexError } });
  assert.deepEqual(await editing.actions.updateCommitteeAction({ committeeId, name: "Servicio" }), expected);

  const reopening = setup("club_manager", [memberId], "active", { failures: { "committees.update": duplicateNameError } });
  assert.deepEqual(await reopening.actions.reopenCommitteeAction(committeeId), expected);
});

test("a second chair is reported as an existing presidency, without being mistaken for a duplicate name", async () => {
  const expected = { ok: false, message: "Este comité ya tiene presidencia. Cambia primero a la persona actual.", code: "conflict" };
  const assigning = setup("club_manager", [memberId, secondMemberId], "active", { failures: { "committee_members.upsert": oneChairError } });
  assert.deepEqual(await assigning.actions.assignCommitteeMemberAction({ committeeId, userId: secondMemberId, committeeRole: "chair" }), expected);

  const roster = setup("club_manager", [memberId], "active", { failures: { "committee_members.upsert": {
    code: "23505",
    message: 'duplicate key value violates unique constraint "committee_members_pkey"',
    details: "Key (committee_id, user_id)=(cccccccc-cccc-4ccc-8ccc-cccccccccccc, bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb) already exists.",
  } } });
  const generic = await roster.actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "member" });
  assert.equal(generic.ok, false);
  assert.equal(generic.message, "No se pudo guardar el cambio. Revisa los datos e inténtalo de nuevo.");
});

test("a creation with two chairs is rejected before the database function runs", async () => {
  const { actions, calls } = setup("club_manager", [memberId, secondMemberId]);
  const result = await actions.createCommitteeAction({ name: "Servicio", members: [
    { userId: memberId, committeeRole: "chair" },
    { userId: secondMemberId, committeeRole: "chair" },
  ] });

  assert.deepEqual(result, {
    ok: false,
    message: "Este comité ya tiene presidencia. Cambia primero a la persona actual.",
    code: "conflict",
  });
  assert.deepEqual(calls, []);
});

test("creation rejects duplicate, invalid, and inactive roster selections before writing", async () => {
  const { actions, calls } = setup();
  const duplicate = await actions.createCommitteeAction({ name: "Servicio", members: [
    { userId: memberId, committeeRole: "member" },
    { userId: memberId, committeeRole: "chair" },
  ] });
  const invalidRole = await actions.createCommitteeAction({ name: "Servicio", members: [
    { userId: memberId, committeeRole: "observer" },
  ] });
  const inactive = setup("admin", []);
  const inactiveResult = await inactive.actions.createCommitteeAction({ name: "Servicio", members: [
    { userId: memberId, committeeRole: "member" },
  ] });

  assert.equal(duplicate.code, "invalid");
  assert.equal(invalidRole.code, "invalid");
  assert.equal(inactiveResult.code, "invalid");
  assert.deepEqual(calls, []);
  assert.deepEqual(inactive.calls, []);
});

test("editing keeps the committee record and completion changes its active state", async () => {
  const { actions, writes } = setup();

  assert.equal((await actions.updateCommitteeAction({ committeeId, name: "Servicio local", description: "Nueva descripción." })).ok, true);
  assert.equal((await actions.completeCommitteeAction(committeeId)).ok, true);

  assert.deepEqual(writes.map(({ table, operation, value }) => ({ table, operation, value })), [
    { table: "committees", operation: "update", value: { name: "Servicio local", description: "Nueva descripción.", updated_by: actorId } },
    { table: "committees", operation: "update", value: { is_active: false, updated_by: actorId } },
  ]);
  assert.deepEqual(writes[0].filters, [["id", committeeId], ["is_active", true]]);
  assert.ok(writes.every((write) => write.operation !== "delete"));
});

test("an admin can assign, change, and remove an active member from an active committee", async () => {
  const { actions, writes } = setup();
  assert.equal((await actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "treasurer" })).ok, true);
  assert.equal((await actions.removeCommitteeMemberAction({ committeeId, userId: memberId })).ok, true);

  assert.equal(writes[0].table, "committee_members");
  assert.equal(writes[0].operation, "upsert");
  assert.equal(writes[0].value.committee_role, "treasurer");
  assert.equal(writes[1].operation, "delete");
});
