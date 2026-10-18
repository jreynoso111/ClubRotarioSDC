import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadTypeScript(path, dependencies = {}) {
  const exports = {};
  new Function("require", "exports", compile(path))(name => {
    assert.ok(dependencies[name], `Unexpected dependency ${name} from ${path}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberCount = 259;
const memberIds = Array.from({ length: memberCount }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const allIds = [actorId, ...memberIds];

// Applies the equality and membership filters the snapshot uses; other query shapes return every row.
function applyFilters(rows, filters) {
  return rows.filter(row => filters.every(([column, value, kind]) => kind === "in" ? value.includes(row[column]) : row[column] === value));
}

function fakeClient(recorded) {
  const tables = {
    memberships: [
      { user_id: actorId, membership_role: "club_manager", membership_status: "active", joined_at: "2025-02-01T14:00:00Z", notes: "Nota privada de la gestión" },
      ...memberIds.map(user_id => ({ user_id, membership_role: "member", membership_status: "active", joined_at: "2025-03-01T14:00:00Z", notes: "Nota privada" })),
    ],
    profiles: allIds.map((id, index) => ({ id, display_name: index === 0 ? "Gestión" : `Miembro ${index}`, bio: null })),
    committees: [{ id: "committee-1", name: "Comité de prueba", slug: "comite-de-prueba", description: null, is_active: true }],
    committee_members: allIds.map(user_id => ({ committee_id: "committee-1", user_id, committee_role: "member" })),
  };
  const claims = { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] };
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: actorId, email: "gestion@example.org", user_metadata: { display_name: "Gestión" } } }, error: null }),
      getClaims: async () => ({ data: { claims }, error: null }),
      mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) },
    },
    rpc: async name => (name === "has_privileged_session" ? { data: true, error: null } : { data: [], error: null }),
    from(table) {
      const filters = [];
      const state = { columns: "", single: false };
      const rowsNow = () => applyFilters(tables[table] ?? [], filters);
      const query = {
        select(columns = "") { state.columns = columns; recorded.selects.push({ table, columns }); return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        in(column, values) { filters.push([column, values, "in"]); return query; },
        or() { return query; }, order() { return query; }, limit() { return query; }, lt() { return query; }, not() { return query; },
        async range(first, last) {
          recorded.ranges.push({ table, first, last });
          return { data: rowsNow().slice(first, last + 1), error: null };
        },
        maybeSingle() { state.single = true; return query; },
        then(resolve, reject) {
          const rows = rowsNow();
          return Promise.resolve({ data: state.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("the platform snapshot keeps notes out of the own membership, pages the directory and drops the pending list", async () => {
  const recorded = { selects: [], ranges: [] };
  const client = fakeClient(recorded);
  const platform = loadTypeScript("../lib/platform.ts", {
    "server-only": {},
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
    "@/lib/mfa-policy": mfaDependencies["@/lib/mfa-policy"],
    "@/lib/mfa-session": mfaDependencies["@/lib/mfa-session"],
    "@/lib/proposal-limits": loadTypeScript("../lib/proposal-limits.ts"),
    "@/lib/read-every-page": loadTypeScript("../lib/read-every-page.ts"),
  });

  const snapshot = await platform.getPlatformSnapshot();
  assert.equal(snapshot.access, "active");
  assert.equal(snapshot.membership.role, "club_manager");
  assert.equal("notes" in snapshot.membership, false);
  assert.equal("pendingMembers" in snapshot, false);
  assert.ok(recorded.selects.filter(select => select.table === "memberships").every(select => !select.columns.split(",").includes("notes")));

  assert.equal(snapshot.memberDirectory.length, allIds.length);
  assert.equal(snapshot.committeeCandidates.length, allIds.length);
  assert.equal(snapshot.committees[0].members.length, allIds.length);
  assert.deepEqual(recorded.ranges.filter(range => range.table === "committee_members").map(range => range.first), [0, 200]);
  assert.deepEqual(recorded.ranges.filter(range => range.table === "profiles").map(range => range.first), [0, 200]);
});
