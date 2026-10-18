import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import { accountDependencies } from "./helpers/account-deps.mjs";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";
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

// Evaluates a pure module the way the app bundles it; dependencies must be listed explicitly.
function loadTypeScript(path, dependencies = {}) {
  const exports = {};
  new Function("require", "exports", compile(path))(name => {
    assert.ok(dependencies[name], `Unexpected dependency ${name} from ${path}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const activityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const taskId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const joinedAt = "2025-02-01T14:00:00Z";
const updatedAt = "2026-09-30T15:00:00Z";
const siteOrigin = "https://www.clubrotariosdcolonial.org";
const platformUrl = `${siteOrigin}/plataforma`;

test("administrators are system accounts and never members in the managed roster", async () => {
  for (const role of ["admin", "club_manager"]) {
    const { members } = setup({ role, targetRole: "admin" });
    const result = await members.listManagedMembersAction();
    assert.equal(result.ok, true);
    assert.deepEqual(result.members, []);
    assert.equal(result.administrativeAccounts.length, role === "admin" ? 1 : 0);
  }
});

const emailModule = loadTypeScript("../lib/email.ts", { "server-only": {} });
const memberAccess = loadTypeScript("../lib/member-access.ts");
const readEveryPageModule = loadTypeScript("../lib/read-every-page.ts");
const sources = {
  auth: compile("../app/plataforma/module-auth.ts"),
  members: compile("../app/plataforma/members-actions.ts"),
  modules: compile("../app/plataforma/module-actions.ts"),
};

function applyFilters(rows, filters) {
  // Filters are [column, value] for equality and [column, values, "in"] for membership in a list.
  return rows.filter(row => filters.every(([column, value, kind]) => kind === "in" ? value.includes(row[column]) : row[column] === value));
}

function setup({
  role = "admin", membershipStatus = "active", targetRole = "member", targetStatus = "active", targetName = "Ana", targetEmail = "ana@example.org",
  existingJoinedAt = joinedAt, activityStatus = "active", currentLeadId = null, currentAssigneeId = null, signedIn = true, catalogSize = 0,
  taskActivityId = activityId, memberCount = 0, storedNotes = "Notas existentes", rpcError = null, rpcRow = null, pendingRows = [],
  rejectError = null, history = [], emailSent = true,
} = {}) {
  const writes = [];
  const invalidations = [];
  const pages = [];
  const rpcCalls = [];
  const emails = [];
  const generatedMembers = Array.from({ length: memberCount }, (_, index) => ({
    user_id: `member-${index}`, membership_role: "member", membership_status: "active", joined_at: joinedAt, approved_at: joinedAt,
    created_at: "2026-01-10T10:00:00Z", updated_at: updatedAt,
  }));
  const generatedProfiles = generatedMembers.map(row => ({ id: row.user_id, display_name: `Miembro ${row.user_id.slice(7)}`, bio: null }));
  const actorRow = { user_id: actorId, membership_role: role, membership_status: membershipStatus, joined_at: joinedAt };
  const targetRow = { user_id: memberId, membership_role: targetRole, membership_status: targetStatus, joined_at: existingJoinedAt, approved_at: existingJoinedAt, approved_by: actorId, updated_at: updatedAt };
  const managedRows = memberCount > 0 ? generatedMembers : [{ ...targetRow, created_at: "2025-01-10T10:00:00Z" }];
  // Like the directory policy, a suspended or pending member's profile is not visible to ordinary members.
  const memberProfiles = targetStatus === "active" ? [{ id: memberId, display_name: targetName, bio: null }] : [];
  const profileRows = memberCount > 0 ? generatedProfiles : [...memberProfiles, { id: actorId, display_name: "Administrador", bio: null }];

  function rowsFor(table, columns, single, filters) {
    if (table === "activities") {
      if (single) return [{ id: activityId, activity_status: activityStatus, lead_id: currentLeadId }];
      return Array.from({ length: catalogSize }, (_, index) => ({
        id: `${index}`, title: "Jornada de servicio", description: null, activity_status: "planned", starts_at: null, ends_at: null, location: null, lead_id: null,
      }));
    }
    if (table === "tasks") {
      if (single) return [{ id: taskId, assignee_id: currentAssigneeId, activity_id: taskActivityId }];
      return Array.from({ length: catalogSize }, (_, index) => ({
        id: `${index}`, title: "Preparar materiales", description: null, task_status: index === 0 ? "done" : "todo", priority: "normal", due_at: null,
        activity_id: activityId, proposal_id: null, assignee_id: memberId,
      }));
    }
    if (table === "profiles") return profileRows;
    if (table === "membership_access_history") return history.map(entry => ({ user_id: memberId, ...entry }));
    if (table === "memberships") {
      // The signed-in actor's own row is read by module-auth; any other single lookup targets the member.
      if (filters.some(([column, value]) => column === "user_id" && value === actorId)) return [actorRow];
      if (single) return [targetRow];
      if (columns.includes("membership_role")) return managedRows;
      return [{ user_id: memberId, membership_status: "active" }];
    }
    return [];
  }

  const client = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "has_privileged_session") return { data: true, error: null };
      if (name === "get_membership_notes") {
        return { data: args._user_ids.map(user_id => ({ user_id, notes: user_id === memberId ? storedNotes : `Nota ${user_id}` })), error: null };
      }
      if (name === "update_member_access") {
        if (rpcError) return { data: null, error: rpcError };
        return { data: [rpcRow ?? { email: targetEmail, display_name: targetName, previous_role: targetRole, previous_status: targetStatus }], error: null };
      }
      if (name === "list_pending_members") return { data: pendingRows, error: null };
      if (name === "reject_pending_member") return { data: null, error: rejectError };
      throw new Error(`Unexpected RPC ${name}`);
    },
    auth: {
      getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }),
      mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) },
      getUser: async () => ({ data: { user: signedIn ? { id: actorId, user_metadata: { role: "admin" } } : null }, error: null }),
    },
    from(table) {
      const filters = [];
      const state = { columns: "", single: false, writing: false };
      function execute() {
        if (state.writing) return { data: { id: table === "tasks" ? taskId : activityId, user_id: memberId }, error: null };
        const rows = applyFilters(rowsFor(table, state.columns, state.single, filters), filters);
        return { data: state.single ? rows[0] ?? null : rows, error: null };
      }
      const query = {
        select(columns = "") { state.columns = columns; return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        in(column, values) { filters.push([column, values, "in"]); return query; },
        order() { return query; }, limit() { return query; }, not() { return query; },
        async range(first, last) {
          pages.push({ table, columns: state.columns, first, last });
          return { data: applyFilters(rowsFor(table, state.columns, false, filters), filters).slice(first, last + 1), error: null };
        },
        update(value) { state.writing = true; writes.push({ table, value, filters, operation: "update" }); return query; },
        insert(value) { state.writing = true; writes.push({ table, value, filters, operation: "insert" }); return query; },
        delete() { state.writing = true; writes.push({ table, filters, operation: "delete" }); return query; },
        maybeSingle() { state.single = true; return query; },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  const dependencies = {
    "server-only": {},
    "node:crypto": { randomUUID },
    "next/cache": { revalidatePath: path => invalidations.push(path) },
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/lib/email": { ...emailModule, sendClubEmail: async message => { emails.push(message); return emailSent; } },
    "@/lib/member-access": memberAccess,
    "@/lib/read-every-page": readEveryPageModule,
    "@/lib/membership-applications": {},
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": {},
    "@/lib/editorial-content": {},
    "@/utils/site-url": { getPublicSiteOrigin: () => siteOrigin },
    ...mfaDependencies,
    ...accountDependencies,
    "@/utils/supabase/server": { createClient: async () => client },
  };
  const auth = {};
  new Function("require", "exports", sources.auth)(name => dependencies[name], auth);
  dependencies["./module-auth"] = auth;
  const members = {};
  const modules = {};
  new Function("require", "exports", sources.members)(name => dependencies[name], members);
  new Function("require", "exports", sources.modules)(name => dependencies[name], modules);
  return { members, modules, writes, invalidations, pages, rpcCalls, emails };
}

function access(overrides = {}) {
  return { userId: memberId, status: "active", role: "member", notes: "Notas existentes", expectedUpdatedAt: updatedAt, ...overrides };
}

test("management actions authorize from active memberships and ignore editable metadata", async () => {
  for (const options of [{ role: "member" }, { membershipStatus: "suspended" }, { signedIn: false }]) {
    const { members, modules, writes, rpcCalls } = setup(options);
    assert.equal((await members.updateMemberAccessAction(access())).ok, false);
    assert.equal((await modules.createTaskAction({ activityId, title: "Confirmar materiales", priority: "normal" })).ok, false);
    assert.deepEqual(writes, []);
    assert.deepEqual(rpcCalls, []);
  }
});

test("a club manager cannot grant admin or management access or change administrator accounts, whatever the database returns", async () => {
  for (const [targetRole, requestedRole] of [["member", "admin"], ["member", "club_manager"], ["admin", "member"]]) {
    const { members, rpcCalls, emails } = setup({ role: "club_manager", targetRole, rpcError: { code: "42501", message: "forbidden" } });
    const result = await members.updateMemberAccessAction(access({ role: requestedRole }));
    assert.equal(result.code, "forbidden");
    assert.match(result.message, /Solo un administrador puede modificar cuentas administradoras|Solo un administrador puede asignar roles/);
    assert.equal(rpcCalls.at(-1).name, "update_member_access");
    assert.equal(rpcCalls.at(-1).args._role, requestedRole);
    assert.deepEqual(emails, []);
  }
});

test("nobody changes their own access; the action stops before calling the database", async () => {
  const { members, rpcCalls, emails } = setup();
  const result = await members.updateMemberAccessAction(access({ userId: actorId, status: "suspended", role: "member", reason: "Revisión interna" }));
  assert.equal(result.code, "forbidden");
  assert.equal(rpcCalls.some(call => call.name === "update_member_access"), false);
  assert.deepEqual(emails, []);
});

test("a suspension or a role change without a reason shows the reason message, and valid reasons are trimmed", async () => {
  const missing = setup({ rpcError: { code: "22023", message: "reason_required" } });
  const result = await missing.members.updateMemberAccessAction(access({ status: "suspended" }));
  assert.equal(result.code, "invalid");
  assert.equal(result.message, "Indica el motivo (5 a 500 caracteres) para suspender o cambiar el rol.");
  assert.equal(missing.rpcCalls.at(-1).args._reason, null);
  assert.deepEqual(missing.emails, []);

  const valid = setup({ targetStatus: "active" });
  assert.equal((await valid.members.updateMemberAccessAction(access({ status: "suspended", reason: "  Incumplimiento de pagos  " }))).ok, true);
  assert.equal(valid.rpcCalls.at(-1).args._reason, "Incumplimiento de pagos");
  assert.equal(valid.rpcCalls.at(-1).args._expected_updated_at, updatedAt);
});

test("stale and last-administrator errors keep their Spanish messages and reload codes", async () => {
  const stale = await setup({ rpcError: { code: "P0409", message: "stale_member" } }).members.updateMemberAccessAction(access({ notes: "Nuevo" }));
  assert.equal(stale.code, "conflict");
  assert.equal(stale.message, "Otra persona cambió este miembro. Recarga para ver los cambios.");

  const lastAdmin = await setup({ targetRole: "admin", rpcError: { code: "P0410", message: "last_admin" } }).members.updateMemberAccessAction(access({ status: "suspended", reason: "Cambio de administración" }));
  assert.equal(lastAdmin.ok, false);
  assert.equal(lastAdmin.message, "El club debe conservar al menos un administrador activo.");
});

test("approving a pending account sends the approval notice with the platform link and the typed notes", async () => {
  const { members, emails, rpcCalls, invalidations } = setup({ targetStatus: "pending", existingJoinedAt: null, targetName: "Ana Rivera" });
  const result = await members.updateMemberAccessAction(access({ status: "active", role: "member", notes: "Aprobación revisada" }));
  assert.equal(result.ok, true);
  assert.equal(result.message, "El acceso y las notas del miembro quedaron guardados. Se envió un correo al miembro.");
  assert.equal(rpcCalls.at(-1).args._notes, "Aprobación revisada");
  assert.equal(rpcCalls.at(-1).args._status, "active");
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, "ana@example.org");
  assert.equal(emails[0].subject, "Tu membresía fue aprobada");
  assert.match(emails[0].text, /Hola Ana Rivera:/);
  assert.match(emails[0].text, new RegExp(platformUrl.replaceAll(".", "\\.")));
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("a suspension notice carries the reason, and a failed delivery is reported after the saved change", async () => {
  const { members, emails } = setup({ targetStatus: "active", emailSent: false });
  const result = await members.updateMemberAccessAction(access({ status: "suspended", reason: "Incumplimiento de pagos" }));
  assert.equal(result.ok, true);
  assert.equal(result.message, "El acceso y las notas del miembro quedaron guardados. No se pudo enviar el correo al miembro; el cambio sí quedó guardado.");
  assert.equal(emails[0].subject, "Tu acceso a la plataforma fue suspendido");
  assert.match(emails[0].text, /Motivo: Incumplimiento de pagos/);
});

test("reactivating a suspended member sends the reactivation notice", async () => {
  const { members, emails } = setup({ targetStatus: "suspended" });
  assert.equal((await members.updateMemberAccessAction(access({ status: "active" }))).ok, true);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Tu acceso a la plataforma fue reactivado");
});

test("a role change notifies the member once with the new role's label", async () => {
  const { members, emails } = setup({ targetStatus: "active", targetRole: "member" });
  assert.equal((await members.updateMemberAccessAction(access({ role: "coordinator", reason: "Nuevo encargo de coordinación" }))).ok, true);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Actualizamos tu rol en la plataforma");
  assert.match(emails[0].text, /a Coordinación\./);
});

test("notes-only edits send no e-mail, and omitted notes keep the stored text", async () => {
  const edited = setup();
  assert.equal((await edited.members.updateMemberAccessAction(access({ notes: "Seguimiento revisado" }))).ok, true);
  assert.deepEqual(edited.emails, []);
  assert.equal(edited.rpcCalls.at(-1).args._notes, "Seguimiento revisado");

  const omitted = setup();
  const withoutNotes = access();
  delete withoutNotes.notes;
  assert.equal((await omitted.members.updateMemberAccessAction(withoutNotes)).ok, true);
  assert.deepEqual(omitted.rpcCalls.map(call => call.name), ["has_privileged_session", "get_membership_notes", "update_member_access"]);
  assert.equal(omitted.rpcCalls.at(-1).args._notes, "Notas existentes");
});

test("a member without an e-mail address is saved and the message says no notice was sent", async () => {
  const { members, emails } = setup({ targetStatus: "pending", rpcRow: { email: null, display_name: "Ana", previous_role: "member", previous_status: "pending" } });
  const result = await members.updateMemberAccessAction(access({ status: "active" }));
  assert.equal(result.ok, true);
  assert.equal(result.message, "El acceso y las notas del miembro quedaron guardados. No se envió correo porque la cuenta no tiene un correo registrado.");
  assert.deepEqual(emails, []);
});

test("invalid access inputs never reach the database", async () => {
  for (const input of [
    access({ expectedUpdatedAt: undefined }),
    access({ expectedUpdatedAt: "no es una fecha" }),
    access({ notes: "x".repeat(4001) }),
    access({ reason: "x".repeat(501), status: "suspended" }),
    access({ status: "retired" }),
  ]) {
    const { members, rpcCalls } = setup();
    assert.equal((await members.updateMemberAccessAction(input)).code, "invalid");
    assert.equal(rpcCalls.some(call => call.name === "update_member_access" || call.name === "get_membership_notes"), false);
  }
});

test("suspending and reactivating send the expected timestamp to the database", async () => {
  for (const [status, targetStatus] of [["suspended", "active"], ["active", "suspended"]]) {
    const { members, rpcCalls, invalidations } = setup({ role: "club_manager", targetStatus });
    const result = await members.updateMemberAccessAction(access({ status, role: "coordinator", reason: "Revisión del comité" }));
    assert.equal(result.ok, true);
    assert.equal(rpcCalls.at(-1).args._expected_updated_at, updatedAt);
    assert.deepEqual(invalidations, ["/plataforma"]);
  }
});

test("the pending list is management-only and maps the database rows", async () => {
  const row = {
    user_id: memberId, display_name: "Ana", email: "ana@example.org", email_confirmed: false, registered_at: "2026-10-01T12:00:00Z",
    application_id: "app-1", application_status: "contacted", application_full_name: "Ana Rivera",
  };
  const member = setup({ role: "member", pendingRows: [row] });
  assert.equal((await member.members.listPendingMembersAction()).code, "forbidden");
  assert.equal(member.rpcCalls.some(call => call.name === "list_pending_members"), false);

  const admin = setup({ pendingRows: [row] });
  const result = await admin.members.listPendingMembersAction();
  assert.equal(result.ok, true);
  assert.deepEqual(result.members, [{
    userId: memberId, name: "Ana", email: "ana@example.org", emailConfirmed: false, registeredAt: "2026-10-01T12:00:00Z",
    applicationId: "app-1", applicationStatus: "contacted", applicationFullName: "Ana Rivera",
  }]);
});

test("rejecting requires a 5 to 500 character reason, maps database refusals and keeps the rejection record", async () => {
  const short = setup();
  assert.equal((await short.members.rejectPendingMemberAction(memberId, "no")).code, "invalid");
  assert.equal(short.rpcCalls.some(call => call.name === "reject_pending_member"), false);

  const forbidden = setup({ role: "member" });
  assert.equal((await forbidden.members.rejectPendingMemberAction(memberId, "Solicitud duplicada")).ok, false);
  assert.equal(forbidden.rpcCalls.length, 0);

  const notPending = await setup({ rejectError: { code: "22023", message: "not_pending" } }).members.rejectPendingMemberAction(memberId, "Solicitud duplicada");
  assert.equal(notPending.code, "conflict");
  assert.equal(notPending.message, "Esta cuenta ya no está pendiente de aprobación. Recarga la lista.");

  const withActivity = await setup({ rejectError: { code: "22023", message: "member_has_activity" } }).members.rejectPendingMemberAction(memberId, "Solicitud duplicada");
  assert.equal(withActivity.code, "invalid");
  assert.match(withActivity.message, /actividad en la plataforma/);

  const accepted = setup();
  const result = await accepted.members.rejectPendingMemberAction(memberId, "  Solicitud duplicada  ");
  assert.equal(result.ok, true);
  assert.match(result.message, /quedó un registro del rechazo/);
  assert.equal(accepted.rpcCalls.at(-1).args._reason, "Solicitud duplicada");
  assert.deepEqual(accepted.invalidations, ["/plataforma"]);
});

test("the members list reads every page, loads notes through the management RPC and never selects notes from memberships", async () => {
  const { members, pages, rpcCalls } = setup({ role: "admin", memberCount: 450 });
  const result = await members.listManagedMembersAction();
  assert.equal(result.ok, true);
  assert.equal(result.members.length, 450);
  const membershipPages = pages.filter(page => page.columns.includes("membership_role"));
  assert.deepEqual(membershipPages.map(page => page.first), [0, 200, 400]);
  assert.ok(membershipPages.every(page => !page.columns.split(",").includes("notes")));
  assert.deepEqual(pages.filter(page => page.table === "profiles").map(page => page.first), [0, 200, 400]);
  assert.deepEqual(rpcCalls.filter(call => call.name === "get_membership_notes").map(call => call.args._user_ids.length), [200, 200, 50]);
  assert.equal(result.members[300].notes, "Nota member-300");
});

test("the access history is management-only and names the administrator behind each change", async () => {
  const history = [{ from_role: "member", to_role: "coordinator", from_status: "active", to_status: "active", reason: "Nuevo encargo", actor_id: actorId, created_at: "2026-10-01T12:00:00Z" }];
  const admin = setup({ history });
  const result = await admin.members.getMemberAccessHistoryAction(memberId);
  assert.equal(result.ok, true);
  assert.deepEqual(result.history, [{
    fromRole: "member", toRole: "coordinator", fromStatus: "active", toStatus: "active", reason: "Nuevo encargo",
    actorName: "Administrador", createdAt: "2026-10-01T12:00:00Z",
  }]);
  const member = setup({ role: "member", history });
  assert.equal((await member.members.getMemberAccessHistoryAction(memberId)).ok, false);
});

test("club managers edit their own profile and ordinary accounts, but not administrator accounts", async () => {
  const blocked = setup({ role: "club_manager", targetRole: "admin" });
  const forbidden = await blocked.members.updateMemberProfileAction({ userId: memberId, name: "Ana Rivera", bio: "" });
  assert.equal(forbidden.code, "forbidden");
  assert.equal(forbidden.message, "Solo un administrador puede modificar esta cuenta.");
  assert.deepEqual(blocked.writes, []);

  const own = setup({ role: "club_manager", targetRole: "club_manager" });
  assert.equal((await own.members.updateMemberProfileAction({ userId: actorId, name: "Gestión del Club" })).ok, true);

  const ordinary = setup({ role: "club_manager", targetRole: "member" });
  assert.equal((await ordinary.members.updateMemberProfileAction({ userId: memberId, name: "Ana Rivera" })).ok, true);
});

test("membership notices escape names and reasons in HTML while the plain text stays readable", () => {
  const suspended = emailModule.memberSuspendedEmail(`<b>Ana</b> & "Luis"`, "Pagos <pendientes>");
  assert.doesNotMatch(suspended.html, /<b>/);
  assert.match(suspended.html, /Hola &lt;b&gt;Ana&lt;\/b&gt; &amp; &quot;Luis&quot;:/);
  assert.match(suspended.html, /Motivo: Pagos &lt;pendientes&gt;/);
  assert.match(suspended.text, /Motivo: Pagos <pendientes>/);

  const approved = emailModule.memberApprovedEmail("Ana", platformUrl);
  assert.equal(approved.subject, "Tu membresía fue aprobada");
  assert.match(approved.html, /href="https:\/\/www\.clubrotariosdcolonial\.org\/plataforma"/);
  assert.match(approved.text, /Entrar a la plataforma: https:\/\/www\.clubrotariosdcolonial\.org\/plataforma/);
  assert.equal(emailModule.memberReactivatedEmail("Ana", platformUrl).subject, "Tu acceso a la plataforma fue reactivado");
  assert.match(emailModule.memberRoleChangedEmail("Ana", "Coordinación").text, /a Coordinación\./);
});

test("the access rules ask for reasons and confirmations exactly where the database requires them", () => {
  const active = { role: "member", status: "active" };
  assert.equal(memberAccess.accessChangeNeedsReason(active, { role: "member", status: "active" }), false);
  assert.equal(memberAccess.accessChangeNeedsReason(active, { role: "member", status: "suspended" }), true);
  assert.equal(memberAccess.accessChangeNeedsReason(active, { role: "coordinator", status: "active" }), true);
  assert.equal(memberAccess.accessChangeNeedsReason({ role: "admin", status: "suspended" }, { role: "admin", status: "active" }), false);
  assert.equal(memberAccess.accessChangeNeedsConfirmation(active, { role: "member", status: "suspended" }), true);
  assert.equal(memberAccess.accessChangeNeedsConfirmation({ role: "club_manager", status: "active" }, { role: "coordinator", status: "active" }), true);
  assert.equal(memberAccess.accessChangeNeedsConfirmation(active, { role: "coordinator", status: "active" }), false);
  assert.deepEqual(memberAccess.assignableRoles("club_manager"), ["member", "coordinator", "editor"]);
  assert.equal(memberAccess.assignableRoles("admin").length, 5);
  assert.equal(memberAccess.actorCanModifyAccount("club_manager", "admin"), false);
  assert.equal(memberAccess.actorCanModifyAccount("club_manager", "club_manager"), false);
  assert.equal(memberAccess.actorCanModifyAccount("club_manager", "editor"), true);
  assert.equal(memberAccess.actorCanModifyAccount("admin", "admin"), true);
  assert.equal(memberAccess.normalizeSearchText("Coordinación"), "coordinacion");
});

test("the existing membership action wrapper is gone; approvals and edits use updateMemberAccessAction", async () => {
  const { members } = setup();
  assert.equal(typeof members.updateMemberAccessAction, "function");
  assert.equal("updateMembershipAction" in members, false);
});

test("activity workspace reads every page and includes completed tasks and only active management candidates", async () => {
  const { modules, pages } = setup({ catalogSize: 405 });
  const result = await modules.getActivityWorkspaceAction();
  assert.equal(result.ok, true);
  assert.equal(result.workspace.activities.length, 405);
  assert.equal(result.workspace.tasks.length, 405);
  assert.equal(result.workspace.tasks[0].status, "done");
  assert.deepEqual(result.workspace.members, [{ userId: memberId, name: "Ana" }]);
  for (const table of ["activities", "tasks"]) assert.deepEqual(pages.filter(page => page.table === table).map(page => page.first), [0, 200, 400]);
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

test("task editing never reassigns its parent, and proposal tasks can be edited by coordination", async () => {
  const { modules, writes } = setup();
  assert.equal((await modules.updateTaskAction({ taskId, activityId, title: "Recoger materiales", priority: "urgent", assigneeId: memberId })).ok, true);
  assert.equal(writes[0].value.activity_id, undefined);
  assert.equal(writes[0].value.proposal_id, undefined);
  assert.ok(writes[0].filters.some(([column, value]) => column === "id" && value === taskId));
  const proposalTask = setup({ role: "coordinator", taskActivityId: null });
  assert.equal((await proposalTask.modules.updateTaskAction({ taskId, title: "Pedir permisos", priority: "normal" })).ok, true);
});

test("the lead of an activity manages its tasks; other members cannot", async () => {
  const lead = setup({ role: "member", currentLeadId: actorId });
  assert.equal((await lead.modules.createTaskAction({ activityId, title: "Comprar guantes", priority: "normal" })).ok, true);
  assert.equal((await lead.modules.updateTaskAction({ taskId, title: "Comprar guantes y bolsas", priority: "high" })).ok, true);
  const other = setup({ role: "member", currentLeadId: memberId });
  assert.equal((await other.modules.createTaskAction({ activityId, title: "Comprar guantes", priority: "normal" })).code, "forbidden");
  assert.equal((await other.modules.updateTaskAction({ taskId, title: "Otra cosa", priority: "high" })).code, "forbidden");
  assert.equal(other.writes.length, 0);
});

test("only management deletes activities and tasks", async () => {
  for (const [role, allowed] of [["coordinator", false], ["club_manager", true], ["admin", true]]) {
    const { modules, writes } = setup({ role });
    assert.equal((await modules.deleteTaskAction(taskId)).ok, allowed);
    assert.equal((await modules.deleteActivityAction(activityId)).ok, allowed);
    assert.equal(writes.filter(write => write.operation === "delete").length, allowed ? 2 : 0);
  }
});

test("an activity creates a draft Agenda event linked to it", async () => {
  const { modules, writes } = setup({ role: "coordinator" });
  const result = await modules.createEventFromActivityAction(activityId);
  assert.equal(result.code, "invalid", "an activity without a start date cannot create its event");
  assert.equal(writes.length, 0);
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
