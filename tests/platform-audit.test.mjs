import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const audit = {};
new Function("exports", compile("../lib/audit.ts"))(audit);
const editorialContent = {};
new Function("exports", compile("../lib/editorial-content.ts"))(editorialContent);
const auditTable = {};
new Function("exports", compile("../lib/audit-table.ts"))(auditTable);
const compiledActions = compile("../app/plataforma/actions.ts");
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const time = "2026-09-30T04:45:20.123456+00:00";

function setup({ role = "admin", status = "active", signedIn = true, rows = [] } = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id } : null }, error: null }) },
    from(table) {
      const query = {};
      for (const method of ["select", "eq", "order", "limit", "in", "gte", "lt", "or", "textSearch"]) {
        query[method] = (...args) => { calls.push({ table, method, args }); return query; };
      }
      query.maybeSingle = async () => ({ error: null, data: table === "memberships"
        ? { membership_role: role, membership_status: status } : rows[0] ?? null });
      query.then = (resolve, reject) => Promise.resolve({ error: null, data: rows }).then(resolve, reject);
      return query;
    },
  };
  const dependencies = {
    "next/cache": { revalidatePath: () => {} }, "@/lib/audit": audit,
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/editorial-content": editorialContent,
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", compiledActions)(name => dependencies[name], actions);
  return { actions, calls };
}

test("audit queries reject every non-admin role and inactive or expired admin sessions", async () => {
  const cases = [
    ...["member", "coordinator", "editor", "club_manager"].map(role => ({ role })),
    { status: "suspended" }, { status: "pending" }, { signedIn: false },
  ];
  for (const settings of cases) {
    const { actions, calls } = setup(settings);
    assert.equal((await actions.getAuditPageAction(audit.defaultAuditFilters)).ok, false);
    assert.equal((await actions.getAuditDetailAction(id)).ok, false);
    assert.equal(calls.some(call => call.table === "audit_log"), false);
  }
});

test("the list fetches only summaries and keyset pagination preserves PostgreSQL microseconds", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ id, occurred_at: time, entity_label: `Record ${index}` }));
  const { actions, calls } = setup({ rows });
  const result = await actions.getAuditPageAction(audit.defaultAuditFilters, { id, time });
  assert.equal(result.page.entries.length, 50);
  assert.deepEqual(result.page.nextCursor, { id, time });
  const selected = calls.find(call => call.table === "audit_log" && call.method === "select").args[0];
  assert.equal(/before_data|after_data|context/.test(selected), false);
  assert.ok(calls.find(call => call.method === "or").args[0].includes(time));
  assert.deepEqual(calls.find(call => call.method === "limit").args, [51]);
});

test("module, search and inclusive Santo Domingo dates become safe server filters", async () => {
  const { actions, calls } = setup();
  const filters = { ...audit.defaultAuditFilters, module: "events", operation: "UPDATE", search: "  Juan  ", from: "2026-09-30", until: "2026-09-30" };
  assert.equal((await actions.getAuditPageAction(filters)).ok, true);
  assert.deepEqual(calls.find(call => call.method === "in").args, ["table_name", ["events", "event_rsvps"]]);
  assert.deepEqual(calls.find(call => call.method === "gte").args, ["occurred_at", "2026-09-30T04:00:00.000Z"]);
  assert.deepEqual(calls.find(call => call.method === "lt").args, ["occurred_at", "2026-10-01T04:00:00.000Z"]);
  assert.deepEqual(calls.find(call => call.method === "textSearch").args, ["search_document", "Juan", { type: "websearch", config: "simple" }]);
});

test("invalid filter or cursor input never reaches the audit query", async () => {
  for (const invalid of [
    { module: "__proto__" }, { operation: "TRUNCATE" }, { search: "x".repeat(121) },
    { from: "2026-02-30" }, { from: "2026-10-01", until: "2026-09-30" }, { until: null },
  ]) {
    const { actions, calls } = setup();
    assert.equal((await actions.getAuditPageAction({ ...audit.defaultAuditFilters, ...invalid })).ok, false);
    assert.equal(calls.some(call => call.table === "audit_log"), false);
  }
  for (const cursor of [{ id: "x", time }, { id, time: `${time},actor_id.not.is.null` }]) {
    assert.ok("error" in audit.normalizeAuditQuery(audit.defaultAuditFilters, cursor));
  }
});

test("details require an explicit valid record id and have separate snapshot loading", async () => {
  const { actions, calls } = setup({ rows: [{ id, before_data: { title: "Before" }, after_data: { title: "After" } }] });
  assert.equal((await actions.getAuditDetailAction("not-a-uuid")).ok, false);
  assert.equal(calls.some(call => call.table === "audit_log"), false);
  assert.equal((await actions.getAuditDetailAction(id)).detail.after_data.title, "After");
  assert.ok(calls.find(call => call.table === "audit_log" && call.method === "select").args[0].includes("before_data,after_data"));
});

test("dates use day/month/two-digit year and a 24-hour Santo Domingo clock, including midnight", () => {
  assert.equal(audit.formatAuditDate("2026-09-30T04:00:00Z"), "30/09/26 00:00:00");
  assert.equal(audit.formatAuditDate("2026-10-01T03:59:59Z"), "30/09/26 23:59:59");
  assert.equal(audit.formatAuditDate("invalid"), "—");
  assert.equal(audit.parseAuditDateInput("30/09/26"), "2026-09-30");
  assert.equal(audit.parseAuditDateInput("29/02/28"), "2028-02-29");
  assert.equal(audit.parseAuditDateInput(""), "");
  for (const invalid of ["29/02/26", "31/04/26", "09/30/26", "30/09/2026"]) {
    assert.equal(audit.parseAuditDateInput(invalid), null);
  }
});

test("sorting is applied in the database and ascending date pagination keeps deterministic ties", async () => {
  const sort = { column: "occurred_at", direction: "asc" };
  const rows = Array.from({ length: 51 }, () => ({ id, occurred_at: time }));
  const { actions, calls } = setup({ rows });
  const result = await actions.getAuditPageAction(audit.defaultAuditFilters, { id, time, ...sort }, sort);
  assert.deepEqual(calls.filter(call => call.method === "order").map(call => call.args), [
    ["occurred_at", { ascending: true }], ["id", { ascending: false }],
  ]);
  assert.equal(calls.find(call => call.method === "or").args[0],
    `occurred_at.gt.${time},and(occurred_at.eq.${time},id.lt.${id})`);
  assert.deepEqual(result.page.nextCursor, { id, time, ...sort });
});

test("text sorting quotes reserved cursor characters and retains time/id tie breakers across pages", async () => {
  const sort = { column: "actor_name", direction: "asc" };
  const value = 'Ana, "Club" \\ Administración';
  const rows = Array.from({ length: 51 }, () => ({ id, occurred_at: time, actor_name: value }));
  const { actions, calls } = setup({ rows });
  const cursor = { id, time, ...sort, value };
  const result = await actions.getAuditPageAction(audit.defaultAuditFilters, cursor, sort);
  assert.deepEqual(calls.filter(call => call.method === "order").map(call => call.args), [
    ["actor_name", { ascending: true }], ["occurred_at", { ascending: false }], ["id", { ascending: false }],
  ]);
  const filter = calls.find(call => call.method === "or").args[0];
  const quoted = '"Ana, \\"Club\\" \\\\ Administración"';
  assert.equal(filter, `actor_name.gt.${quoted},and(actor_name.eq.${quoted},occurred_at.lt.${time}),and(actor_name.eq.${quoted},occurred_at.eq.${time},id.lt.${id})`);
  assert.deepEqual(result.page.nextCursor, cursor);
});

test("array sorting carries the complete field list in the cursor", async () => {
  const sort = { column: "changed_fields", direction: "desc" };
  const value = ["title", "updated_at"];
  const { actions, calls } = setup({ rows: Array.from({ length: 51 }, () => ({ id, occurred_at: time, changed_fields: value })) });
  const result = await actions.getAuditPageAction(audit.defaultAuditFilters, { id, time, ...sort, value }, sort);
  assert.deepEqual(result.page.nextCursor.value, value);
  assert.ok(calls.find(call => call.method === "or").args[0].startsWith('changed_fields.lt."{\\"title\\",\\"updated_at\\"}"'));
});

test("invalid sort columns, unbound cursors and invalid sort values never query the audit table", async () => {
  const invalidCases = [
    { sort: { column: "actor_name,actor_id", direction: "asc" } },
    { sort: { column: "__proto__", direction: "desc" } },
    { sort: { column: "actor_name", direction: "sideways" } },
    { sort: { column: "actor_name", direction: "asc" }, cursor: { id, time } },
    { sort: { column: "actor_name", direction: "asc" }, cursor: { id, time, column: "actor_name", direction: "asc", value: {} } },
    { sort: { column: "changed_fields", direction: "desc" }, cursor: { id, time, column: "changed_fields", direction: "desc", value: [null] } },
  ];
  for (const { sort, cursor } of invalidCases) {
    const { actions, calls } = setup();
    assert.equal((await actions.getAuditPageAction(audit.defaultAuditFilters, cursor, sort)).ok, false);
    assert.equal(calls.some(call => call.table === "audit_log"), false);
  }
});

test("saved column layouts recover from corruption, remove duplicates and never hide every column", () => {
  assert.deepEqual(auditTable.readAuditLayout("{broken"), auditTable.defaultAuditLayout);
  const reordered = auditTable.moveAuditColumn(auditTable.defaultAuditLayout, "actor_name", -1);
  assert.equal(reordered.order[0], "actor_name");
  assert.equal(auditTable.defaultAuditLayout.order[0], "occurred_at");
  const restored = auditTable.readAuditLayout(JSON.stringify({
    order: ["actor_name", "actor_name", "obsolete"], hidden: ["source", "source", "obsolete"],
  }));
  assert.equal(restored.order.length, auditTable.auditColumns.length);
  assert.equal(restored.order[0], "actor_name");
  assert.deepEqual(restored.hidden, ["source"]);
  const allHidden = auditTable.readAuditLayout(JSON.stringify({ order: restored.order, hidden: restored.order }));
  assert.ok(allHidden.hidden.length < allHidden.order.length);
});
