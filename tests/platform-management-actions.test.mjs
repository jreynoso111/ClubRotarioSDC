import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { randomUUID } from "node:crypto";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const activityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const taskId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const joinedAt = "2025-02-01T14:00:00Z";
const sources = {
  auth: compile("../app/plataforma/module-auth.ts"),
  members: compile("../app/plataforma/members-actions.ts"),
  modules: compile("../app/plataforma/module-actions.ts"),
  legacy: compile("../app/plataforma/actions.ts"),
};

function setup({ role = "admin", membershipStatus = "active", targetRole = "member", targetStatus = "active", existingJoinedAt = joinedAt, activityStatus = "active", currentLeadId = null, currentAssigneeId = null, signedIn = true, catalogSize = 0 } = {}) {
  const writes = [];
  const invalidations = [];
  const pages = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: actorId, user_metadata: { role: "admin" } } : null }, error: null }) },
    from(table) {
      const filters = [];
      let writing = false;
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        order() { return query; }, limit() { return query; },
        async range(first, last) {
          pages.push({ table, first, last });
          if (table === "activities" || table === "tasks") return { data: Array.from({ length: Math.max(0, Math.min(last + 1, catalogSize) - first) }, (_, index) => table === "activities" ? {
            id: `${first + index}`, title: "Jornada de servicio", description: null, activity_status: "planned", starts_at: null, ends_at: null, location: null, lead_id: null,
          } : {
            id: `${first + index}`, title: "Preparar materiales", description: null, task_status: first + index === 0 ? "done" : "todo", priority: "normal", due_at: null, activity_id: activityId, proposal_id: null, assignee_id: memberId,
          }), error: null };
          if (table === "profiles") return { data: [{ id: memberId, display_name: "Ana" }, { id: actorId, display_name: "Administrador" }], error: null };
          if (table === "memberships") return { data: [{ user_id: memberId }], error: null };
          return { data: [], error: null };
        },
        update(value) { writing = true; writes.push({ table, value, filters, operation: "update" }); return query; },
        insert(value) { writing = true; writes.push({ table, value, filters, operation: "insert" }); return query; },
        async maybeSingle() {
          if (writing) return { data: { id: table === "tasks" ? taskId : activityId, user_id: memberId }, error: null };
          if (table === "memberships") {
            if (filters.some(([column, value]) => column === "user_id" && value === actorId)) return { data: { membership_role: role, membership_status: membershipStatus }, error: null };
            if (filters.some(([column, value]) => column === "membership_status" && value === "active")) return { data: targetStatus === "active" ? { user_id: memberId } : null, error: null };
            return { data: { membership_role: targetRole, membership_status: targetStatus, joined_at: existingJoinedAt, approved_at: existingJoinedAt, approved_by: actorId, updated_at: "2026-09-30T15:00:00Z", notes: "Notas existentes" }, error: null };
          }
          if (table === "profiles") return { data: targetStatus === "active" ? { id: memberId } : null, error: null };
          if (table === "activities") return { data: { id: activityId, activity_status: activityStatus, lead_id: currentLeadId }, error: null };
          if (table === "tasks") return { data: { id: taskId, assignee_id: currentAssigneeId }, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    "server-only": {},
    "node:crypto": { randomUUID },
    "next/cache": { revalidatePath: path => invalidations.push(path) },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  };
  const auth = {};
  new Function("require", "exports", sources.auth)(name => dependencies[name], auth);
  dependencies["./module-auth"] = auth;
  const members = {};
  const modules = {};
  new Function("require", "exports", sources.members)(name => dependencies[name], members);
  new Function("require", "exports", sources.modules)(name => dependencies[name], modules);
  dependencies["./members-actions"] = members;
  dependencies["@/lib/platform"] = { isMissingSchemaError: () => false };
  dependencies["@/lib/audit"] = {};
  dependencies["@/lib/editorial-content"] = {};
  const legacy = {};
  new Function("require", "exports", sources.legacy)(name => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, legacy);
  return { members, modules, legacy, writes, invalidations, pages };
}

test("management actions authorize from active memberships and ignore editable metadata", async () => {
  for (const options of [{ role: "member" }, { membershipStatus: "suspended" }, { signedIn: false }]) {
    const { members, modules, writes } = setup(options);
    assert.equal((await members.updateMemberAccessAction({ userId: memberId, status: "active", role: "member" })).ok, false);
    assert.equal((await modules.createTaskAction({ activityId, title: "Confirmar materiales", priority: "normal" })).ok, false);
    assert.deepEqual(writes, []);
  }
});

test("a club manager cannot grant admin or management access or edit administrators", async () => {
  for (const [targetRole, requestedRole] of [["member", "admin"], ["member", "club_manager"], ["admin", "member"]]) {
    const { members, writes } = setup({ role: "club_manager", targetRole });
    assert.equal((await members.updateMemberAccessAction({ userId: memberId, status: "active", role: requestedRole })).code, "forbidden");
    assert.deepEqual(writes, []);
  }
});

test("the existing membership action enforces the same role and self-access restrictions", async () => {
  for (const [setupOptions, input] of [
    [{ role: "club_manager" }, { userId: memberId, status: "active", role: "admin" }],
    [{ role: "club_manager", targetRole: "admin" }, { userId: memberId, status: "suspended", role: "member" }],
    [{ role: "admin" }, { userId: actorId, status: "suspended", role: "member" }],
  ]) {
    const { legacy, writes } = setup(setupOptions);
    assert.equal((await legacy.updateMembershipAction(input)).code, "forbidden");
    assert.deepEqual(writes, []);
  }
});

test("the existing membership action preserves original dates and notes while changing an ordinary member", async () => {
  const { legacy, writes, invalidations } = setup({ role: "club_manager" });
  assert.equal((await legacy.updateMembershipAction({ userId: memberId, status: "suspended", role: "coordinator" })).ok, true);
  assert.equal(writes[0].value.joined_at, joinedAt);
  assert.equal(writes[0].value.approved_at, joinedAt);
  assert.equal(writes[0].value.notes, "Notas existentes");
  assert.equal(writes[0].value.membership_status, "suspended");
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("an administrator cannot change their own membership access", async () => {
  const { members, writes } = setup();
  assert.equal((await members.updateMemberAccessAction({ userId: actorId, status: "suspended", role: "member" })).code, "forbidden");
  assert.deepEqual(writes, []);
});

test("suspending and reactivating retain the member's original entry and approval dates", async () => {
  for (const status of ["suspended", "active"]) {
    const { members, writes, invalidations } = setup({ role: "club_manager", targetStatus: "suspended" });
    const result = await members.updateMemberAccessAction({ userId: memberId, status, role: "coordinator" });
    assert.equal(result.ok, true);
    assert.equal(writes[0].value.joined_at, joinedAt);
    assert.equal(writes[0].value.approved_at, joinedAt);
    assert.equal(writes[0].value.notes, "Notas existentes");
    assert.ok(writes[0].filters.some(([column, value]) => column === "updated_at" && value === "2026-09-30T15:00:00Z"));
    assert.deepEqual(invalidations, ["/plataforma"]);
  }
});

test("first activation records an entry date, while the actor stays server controlled", async () => {
  const { members, writes } = setup({ targetStatus: "pending", existingJoinedAt: null });
  assert.equal((await members.updateMemberAccessAction({ userId: memberId, status: "active", role: "member", notes: "Aprobación revisada" })).ok, true);
  assert.ok(!Number.isNaN(new Date(writes[0].value.joined_at).getTime()));
  assert.equal(writes[0].value.notes, "Aprobación revisada");
  assert.equal(writes[0].value.approved_by, actorId);
});

test("tasks and activity responsibilities cannot be assigned to suspended members", async () => {
  for (const role of ["admin", "coordinator"]) {
    const { modules, writes } = setup({ role, targetStatus: "suspended" });
    assert.equal((await modules.createTaskAction({ activityId, title: "Confirmar materiales", priority: "normal", assigneeId: memberId })).code, "invalid");
    assert.equal((await modules.updateActivityAction({ activityId, title: "Jornada comunitaria", status: "active", leadId: memberId })).code, "invalid");
    assert.deepEqual(writes, []);
  }
});

test("coordinators create assigned tasks under an open activity with authenticated authorship", async () => {
  const { modules, writes, invalidations } = setup({ role: "coordinator" });
  assert.equal((await modules.createTaskAction({ activityId, title: "Confirmar materiales", priority: "high", assigneeId: memberId, dueAt: "2040-10-09T18:30:00-04:00" })).ok, true);
  assert.equal(writes[0].value.activity_id, activityId);
  assert.equal(writes[0].value.assignee_id, memberId);
  assert.equal(writes[0].value.created_by, actorId);
  assert.equal(writes[0].value.due_at, "2040-10-09T22:30:00.000Z");
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("closed activities reject new tasks and invalid dates never reach a write", async () => {
  const closed = setup({ activityStatus: "completed" });
  assert.equal((await closed.modules.createTaskAction({ activityId, title: "Confirmar materiales", priority: "normal" })).code, "invalid");
  assert.deepEqual(closed.writes, []);
  const invalid = setup();
  assert.equal((await invalid.modules.updateActivityAction({ activityId, title: "Jornada comunitaria", status: "active", startsAt: "2040-10-09T18:30:00-04:00", endsAt: "2040-10-09T17:30:00-04:00" })).code, "invalid");
  assert.deepEqual(invalid.writes, []);
});

test("task editing stays within its activity and does not reassign its parent", async () => {
  const { modules, writes } = setup();
  assert.equal((await modules.updateTaskAction({ taskId, activityId, title: "Recoger materiales", priority: "urgent", assigneeId: memberId })).ok, true);
  assert.equal(writes[0].value.activity_id, undefined);
  assert.ok(writes[0].filters.some(([column, value]) => column === "id" && value === taskId));
  assert.ok(writes[0].filters.some(([column, value]) => column === "activity_id" && value === activityId));
});

test("recurring activities can share a title while their identifiers remain unique", async () => {
  const { modules, writes } = setup({ role: "coordinator" });
  const input = { title: "Jornada de servicio", startsAt: "2040-10-09T18:30:00-04:00" };
  assert.equal((await modules.createManagedActivityAction(input)).ok, true);
  assert.equal((await modules.createManagedActivityAction(input)).ok, true);
  assert.notEqual(writes[0].value.slug, writes[1].value.slug);
  assert.match(writes[0].value.slug, /^jornada-de-servicio-[a-f0-9-]+$/);
  assert.equal(writes[0].value.created_by, actorId);
  assert.equal(writes[0].value.activity_status, "planned");
});

test("editing keeps an existing inactive assignee, while newly assigning an inactive member remains forbidden", async () => {
  const { modules, writes } = setup({ targetStatus: "suspended", currentLeadId: memberId, currentAssigneeId: memberId });
  assert.equal((await modules.updateActivityAction({ activityId, title: "Jornada actualizada", status: "planned", leadId: memberId })).ok, true);
  assert.equal((await modules.updateTaskAction({ taskId, activityId, title: "Preparar materiales", priority: "normal", assigneeId: memberId })).ok, true);
  assert.equal(writes[0].value.lead_id, memberId);
  assert.equal(writes[1].value.assignee_id, memberId);
  const reassignment = setup({ targetStatus: "suspended", currentAssigneeId: null });
  assert.equal((await reassignment.modules.updateTaskAction({ taskId, activityId, title: "Preparar materiales", priority: "normal", assigneeId: memberId })).code, "invalid");
  assert.deepEqual(reassignment.writes, []);
});

test("the activity workspace reads every page and includes completed tasks and only active management candidates", async () => {
  const { modules, pages } = setup({ catalogSize: 405 });
  const result = await modules.getActivityWorkspaceAction();
  assert.equal(result.ok, true);
  assert.equal(result.workspace.activities.length, 405);
  assert.equal(result.workspace.tasks.length, 405);
  assert.equal(result.workspace.tasks[0].status, "done");
  assert.deepEqual(result.workspace.members, [{ userId: memberId, name: "Ana" }]);
  for (const table of ["activities", "tasks"]) assert.deepEqual(pages.filter(page => page.table === table).map(page => page.first), [0, 200, 400]);
});
