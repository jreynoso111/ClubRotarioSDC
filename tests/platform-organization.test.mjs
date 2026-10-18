import { mfaDependencies } from "./helpers/mfa-deps.mjs";
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

// Mirrors the table shapes the action reads. Memberships are returned for every
// status, as management can read them; `suspended` lists member ids to mark suspended.
function rowsBetween(total, first, last, make) {
  return Array.from({ length: Math.max(0, Math.min(last + 1, total) - first) }, (_, index) => make(first + index));
}

function setup({ role = "admin", status = "active", signedIn = true, rpcError = null, size = 3, suspended = [],
  holders = ["member-0"], positionCount = 1, termCount = 1, failOn = null, administratorIds = [] } = {}) {
  const calls = [];
  const pages = [];
  const invalidations = [];
  const rows = (table, first, last) => {
    if (table === "club_leadership_terms") return rowsBetween(termCount, first, last, index => ({
      id: index === 0 ? termId : `term-${index}`, start_year: organization.currentRotaryYear() - index, label: "", is_locked: false, updated_at: updatedAt }));
    if (table === "club_leadership_positions") return rowsBetween(positionCount, first, last, index => ({
      id: index === 0 ? positionId : `position-${index}`, term_id: termId, title: index === 0 ? "Presidencia" : `Cargo ${index}`, responsibilities: "",
      parent_id: null, member_id: holders[index] ?? null, member_name_snapshot: "Nombre histórico", sort_order: index, is_active: true, access_role: "member", updated_at: updatedAt }));
    if (table === "profiles") return rowsBetween(size, first, last, index => ({ id: `member-${index}`, display_name: `Miembro ${index}`, bio: null }))
      .filter(row => !administratorIds.includes(row.id));
    return rowsBetween(size, first, last, index => ({ user_id: `member-${index}`, membership_role: administratorIds.includes(`member-${index}`) ? "admin" : "member",
      membership_status: suspended.includes(`member-${index}`) ? "suspended" : "active" }));
  };
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: signedIn ? { id: actorId, user_metadata: { role: "admin" } } : null }, error: null }) },
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; },
        maybeSingle: async () => ({ data: { membership_role: role, membership_status: status }, error: null }),
        async range(first, last) {
          pages.push({ table, first, last });
          if (failOn === table) return { data: null, error: { code: "XX000", message: "read failed" } };
          return { data: rows(table, first, last), error: null };
        },
      };
      return query;
    },
    rpc(name, args) {
      if (name === "list_club_member_profiles") return this.from("profiles");
      if (name === "has_privileged_session") return Promise.resolve({ data: true, error: null });
      calls.push({ name, args }); return Promise.resolve({ data: name === "create_club_leadership_term" ? termId : positionId, error: rpcError });
    },
  };
  const dependencies = { "server-only": {}, "next/cache": { revalidatePath: path => invalidations.push(path) },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true }, "@/lib/email": {}, "@/lib/membership-applications": {}, "@/utils/site-url": {}, ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
    "@/lib/organization": organization };
  dependencies["./module-auth"] = compile("../app/plataforma/module-auth.ts", dependencies);
  return { actions: compile("../app/plataforma/organization-actions.ts", dependencies), calls, pages, invalidations };
}

const pagesFor = (fixture, table) => fixture.pages.filter(page => page.table === table).map(page => page.first);

test("system administrators are absent from the club directory for every role", async () => {
  for (const role of ["member", "club_manager", "admin"]) {
    const fixture = setup({ role, administratorIds: ["member-0"] });
    const result = await fixture.actions.getOrganizationAction();
    assert.equal(result.ok, true);
    assert.deepEqual(result.organization.members.map(member => member.userId), ["member-1", "member-2"]);
  }
});

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

test("suspended holders stay visible but do not count as assigned positions", () => {
  assert.equal(organization.isCountedAsAssigned({ memberId: memberId, holderStatus: "active" }), true);
  assert.equal(organization.isCountedAsAssigned({ memberId: memberId, holderStatus: null }), true);
  assert.equal(organization.isCountedAsAssigned({ memberId: memberId, holderStatus: "suspended" }), false);
  assert.equal(organization.isCountedAsAssigned({ memberId: null, holderStatus: null }), false);
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

test("members can read the organigrama without management-only status, while suspended accounts cannot", async () => {
  const fixture = setup({ role: "member" });
  const result = await fixture.actions.getOrganizationAction();
  assert.equal(result.ok, true);
  assert.equal(result.organization.positions[0].memberName, "Miembro 0");
  assert.equal(result.organization.positions[0].holderStatus, null);
  assert.equal(result.organization.members[0].accessRole, undefined);
  assert.ok(fixture.pages.every(page => page.table !== "memberships"));
  assert.equal((await setup({ status: "suspended" }).actions.getOrganizationAction()).ok, false);
});

test("administrator assignment lists page through every profile, membership, term and position", async () => {
  const fixture = setup({ size: 405, termCount: 205, positionCount: 230 });
  const result = await fixture.actions.getOrganizationAction();
  assert.equal(result.ok, true);
  assert.equal(result.organization.members.length, 405);
  assert.equal(result.organization.members[404].accessRole, "member");
  assert.equal(result.organization.terms.length, 205);
  assert.equal(result.organization.positions.length, 230);
  assert.deepEqual(pagesFor(fixture, "profiles"), [0, 200, 400]);
  assert.deepEqual(pagesFor(fixture, "memberships"), [0, 200, 400]);
  assert.deepEqual(pagesFor(fixture, "club_leadership_terms"), [0, 200]);
  assert.deepEqual(pagesFor(fixture, "club_leadership_positions"), [0, 200]);
});

test("club managers and admins see only active members, with the holder status of each position", async () => {
  for (const role of ["club_manager", "admin"]) {
    const fixture = setup({ role, size: 3, suspended: ["member-1"], holders: ["member-0", "member-1"], positionCount: 2 });
    const result = await fixture.actions.getOrganizationAction();
    assert.equal(result.ok, true, role);
    assert.deepEqual(result.organization.members.map(member => member.userId), ["member-0", "member-2"], role);
    assert.equal(result.organization.members[0].accessRole, "member");

    const [president, suspendedHolder] = result.organization.positions;
    assert.equal(president.holderStatus, "active");
    assert.equal(suspendedHolder.holderStatus, "suspended");
    assert.equal(suspendedHolder.memberName, "Nombre histórico");
    assert.equal(organization.isCountedAsAssigned(president), true);
    assert.equal(organization.isCountedAsAssigned(suspendedHolder), false);
  }
});

test("a failed page stops the read instead of returning a partial organigrama", async () => {
  for (const failOn of ["club_leadership_terms", "club_leadership_positions", "profiles", "memberships"]) {
    const fixture = setup({ failOn, size: 3 });
    const result = await fixture.actions.getOrganizationAction();
    assert.equal(result.ok, false, failOn);
    assert.equal(result.organization, undefined, failOn);
  }
});
