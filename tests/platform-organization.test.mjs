import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", source)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const organization = compile("../lib/organization.ts");
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const termId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const positionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const updatedAt = "2026-09-30T12:00:00.123456Z";
const input = { termId, title: "Contabilidad", responsibilities: "Registros del club", parentId: null,
  memberId, sortOrder: 10, active: true, accessRole: "member", applyAccess: false };

function setup({ role = "admin", status = "active", signedIn = true, rpcError = null, size = 3 } = {}) {
  const calls = [];
  const pages = [];
  const invalidations = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: actorId, user_metadata: { role: "admin" } } : null }, error: null }) },
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
        maybeSingle: async () => ({ data: { membership_role: role, membership_status: status }, error: null }),
        async range(first, last) {
          pages.push({ table, first, last });
          const data = Array.from({ length: Math.max(0, Math.min(last + 1, size) - first) }, (_, index) => table === "profiles" ?
            { id: `member-${first + index}`, display_name: `Miembro ${first + index}`, bio: null } :
            { user_id: `member-${first + index}`, membership_role: "member" });
          return { data, error: null };
        },
        then(resolve, reject) { return Promise.resolve({ data: table === "club_leadership_terms" ? [{ id: termId, start_year: organization.currentRotaryYear(), label: "", is_locked: false, updated_at: updatedAt }] : [{ id: positionId, term_id: termId, title: "Presidencia", responsibilities: "", parent_id: null, member_id: "member-0", member_name_snapshot: "Nombre histórico", sort_order: 0, is_active: true, access_role: "member", updated_at: updatedAt }], error: null }).then(resolve, reject); },
      };
      return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { data: name === "create_club_leadership_term" ? termId : positionId, error: rpcError }; },
  };
  const dependencies = { "server-only": {}, "next/cache": { revalidatePath: path => invalidations.push(path) },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true }, "@/utils/supabase/server": { createClient: async () => client },
    "@/lib/organization": organization };
  dependencies["./module-auth"] = compile("../app/plataforma/module-auth.ts", dependencies);
  return { actions: compile("../app/plataforma/organization-actions.ts", dependencies), calls, pages, invalidations };
}

test("Rotary year changes at midnight in Santo Domingo on July 1", () => {
  assert.equal(organization.currentRotaryYear(new Date("2026-07-01T03:59:59Z")), 2025);
  assert.equal(organization.currentRotaryYear(new Date("2026-07-01T04:00:00Z")), 2026);
  assert.equal(organization.currentRotaryYear(new Date("2027-01-01T04:00:00Z")), 2026);
});

test("hierarchy sorts siblings, hides retired positions and handles incomplete or cyclic records", () => {
  const position = (id, parentId, sortOrder = 0, active = true) => ({ id, parentId, sortOrder, active, title: id });
  const source = [position("secretary", "president", 20), position("president", null), position("vice", "president", 10), position("retired", "president", 0, false), position("orphan", "missing", 30)];
  const roots = organization.buildLeadershipTree(source);
  assert.deepEqual(roots.map(row => row.id), ["president", "orphan"]);
  assert.deepEqual(roots[0].children.map(row => row.id), ["vice", "secretary"]);
  assert.equal(source[0].id, "secretary");
  assert.deepEqual(organization.buildLeadershipTree([position("a", "b"), position("b", "a")]).map(row => row.id), ["a", "b"]);
  assert.deepEqual([...organization.leadershipDescendants([position("a", "b"), position("b", "a"), position("c", "b")], "a")], ["a", "b", "c"]);
});

test("only active administrators can configure cargos, despite admin metadata", async () => {
  for (const options of [{ role: "member" }, { role: "coordinator" }, { role: "editor" }, { role: "club_manager" }, { status: "suspended" }, { signedIn: false }]) {
    const fixture = setup(options);
    assert.equal((await fixture.actions.saveLeadershipPositionAction(input)).ok, false);
    assert.equal((await fixture.actions.createLeadershipTermAction({ startYear: 2026 })).ok, false);
    assert.deepEqual(fixture.calls, []);
  }
});

test("assigning a title preserves access unless the administrator explicitly applies the level", async () => {
  const fixture = setup();
  assert.equal((await fixture.actions.saveLeadershipPositionAction({ ...input, accessRole: "admin" })).ok, true);
  assert.equal(fixture.calls[0].args._apply_access, false);
  assert.equal(fixture.calls[0].args._access_role, "admin");
  assert.equal((await fixture.actions.saveLeadershipPositionAction({ ...input, accessRole: "coordinator", applyAccess: true })).ok, true);
  assert.equal(fixture.calls[1].name, "save_club_leadership_position");
  assert.equal(fixture.calls[1].args._apply_access, true);
  assert.equal(fixture.calls[1].args._access_role, "coordinator");
  assert.deepEqual(fixture.invalidations, ["/plataforma", "/plataforma"]);
});

test("invalid assignments and stale edit tokens are rejected before RPC", async () => {
  for (const values of [{ accessRole: "owner" }, { applyAccess: true, memberId: null }, { applyAccess: true, active: false }, { id: positionId, parentId: positionId, updatedAt }, { id: positionId }, { sortOrder: -1 }, { termId: "invalid" }]) {
    const fixture = setup();
    assert.equal((await fixture.actions.saveLeadershipPositionAction({ ...input, ...values })).code, "invalid");
    assert.deepEqual(fixture.calls, []);
  }
  const edit = setup();
  await edit.actions.saveLeadershipPositionAction({ ...input, id: positionId, updatedAt });
  assert.equal(edit.calls[0].args._expected_updated_at, updatedAt);
});

test("backend permission and optimistic conflict failures retain useful messages", async () => {
  for (const [rpcError, expected] of [[{ code: "40001" }, /cambió/], [{ code: "42501", message: "An administrator cannot change their own access." }, /conserva su acceso/], [{ code: "22023", message: "The hierarchy cannot contain a cycle." }, /subordinados/]]) {
    const fixture = setup({ rpcError });
    const result = await fixture.actions.saveLeadershipPositionAction(input);
    assert.equal(result.ok, false);
    assert.match(result.message, expected);
    assert.deepEqual(fixture.invalidations, []);
  }
});

test("members can read the organigrama, while suspended accounts cannot", async () => {
  const fixture = setup({ role: "member" });
  const result = await fixture.actions.getOrganizationAction();
  assert.equal(result.ok, true);
  assert.equal(result.organization.positions[0].memberName, "Miembro 0");
  assert.equal(result.organization.members[0].accessRole, undefined);
  assert.ok(fixture.pages.every(page => page.table === "profiles"));
  assert.equal((await setup({ status: "suspended" }).actions.getOrganizationAction()).ok, false);
});

test("administrator assignment lists paginate profiles and active memberships", async () => {
  const fixture = setup({ size: 405 });
  const result = await fixture.actions.getOrganizationAction();
  assert.equal(result.ok, true);
  assert.equal(result.organization.members.length, 405);
  assert.equal(result.organization.members[404].accessRole, "member");
  assert.deepEqual(fixture.pages.filter(page => page.table === "profiles").map(page => page.first), [0, 200, 400]);
  assert.deepEqual(fixture.pages.filter(page => page.table === "memberships").map(page => page.first), [0, 200, 400]);
});
