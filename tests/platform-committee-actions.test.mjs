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
const committeeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function setup(role = "admin", activeMemberIds = [memberId], membershipStatus = "active") {
  const writes = [];
  const calls = [];
  const invalidations = [];

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    from(table) {
      const filters = [];
      const query = {
        select(columns) { query.selected = columns; return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        in(column, values) { filters.push([column, values]); return query; },
        order() { return query; },
        insert(value) { writes.push({ table, operation: "insert", value }); return query; },
        update(value) { writes.push({ table, operation: "update", value, filters }); return query; },
        upsert(value, options) { writes.push({ table, operation: "upsert", value, options, filters }); return query; },
        delete() { writes.push({ table, operation: "delete", filters }); return query; },
        async maybeSingle() {
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
          const inFilter = filters.find(([column, value]) => column === "user_id" && Array.isArray(value));
          const requestedIds = inFilter?.[1] ?? [];
          return Promise.resolve({
            data: activeMemberIds.filter((id) => requestedIds.includes(id)).map((user_id) => ({ user_id })),
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: committeeId, error: null };
    },
  };

  const dependencies = {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
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

test("only active administrators can create, edit, finish, or change a committee roster", async () => {
  const { actions, writes, calls } = setup("coordinator");
  const results = await Promise.all([
    actions.createCommitteeAction({ name: "Servicio" }),
    actions.updateCommitteeAction({ committeeId, name: "Servicio local" }),
    actions.completeCommitteeAction(committeeId),
    actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "secretary" }),
    actions.removeCommitteeMemberAction({ committeeId, userId: memberId }),
  ]);

  assert.ok(results.every((result) => result.code === "forbidden"));
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test("a suspended administrator cannot manage committees", async () => {
  const { actions, writes, calls } = setup("admin", [memberId], "suspended");
  const results = await Promise.all([
    actions.createCommitteeAction({ name: "Servicio" }),
    actions.updateCommitteeAction({ committeeId, name: "Servicio local" }),
    actions.completeCommitteeAction(committeeId),
    actions.assignCommitteeMemberAction({ committeeId, userId: memberId, committeeRole: "secretary" }),
    actions.removeCommitteeMemberAction({ committeeId, userId: memberId }),
  ]);

  assert.ok(results.every((result) => result.code === "suspended"));
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test("committee creation rejects duplicate, invalid, and inactive roster selections before writing", async () => {
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
