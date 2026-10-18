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
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const finance = {};
new Function("exports", compile("../lib/finance.ts"))(finance);

function setup({ role = "club_manager", entries = [] } = {}) {
  const rpcs = [];
  const filters = [];
  const client = {
    rpc: async (name, args) => {
      if (name === "has_privileged_session") return { data: true, error: null };
      rpcs.push({ name, args });
      if (name === "get_finance_month_dues") return { data: [], error: null };
      return { data: null, error: null };
    },
    auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    from(table) {
      const query = {
        select() { return query; }, gte() { return query; }, lt() { return query; }, order() { return query; },
        eq(column, value) { filters.push([table, column, value]); return query; },
        limit() { return Promise.resolve({ data: table === "finance_entries" ? entries : [], error: null }); },
        then(resolve) { return resolve({ data: [], error: null }); },
        async maybeSingle() {
          if (table === "memberships") return { data: { membership_role: role, membership_status: "active" }, error: null };
          if (table === "profiles") return { data: { display_name: "Ana" }, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    "server-only": {}, "next/cache": { revalidatePath() {} },
    "@/utils/supabase/public-url": { toPublicSupabaseUrl: url => url },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true }, "@/lib/email": {}, "@/lib/membership-applications": {}, "@/utils/site-url": {},
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
    "@/lib/finance": finance,
  };
  const auth = {};
  new Function("require", "exports", compile("../app/plataforma/module-auth.ts"))(name => dependencies[name], auth);
  dependencies["./module-auth"] = auth;
  const actions = {};
  new Function("require", "exports", compile("../app/plataforma/finance-actions.ts"))(name => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, actions);
  return { actions, rpcs, filters };
}

test("only management voids entries, and always with a reason", async () => {
  for (const role of ["member", "coordinator", "editor"]) {
    const { actions, rpcs } = setup({ role });
    assert.equal((await actions.voidFinanceEntryAction(entryId, "Registro duplicado")).code, "forbidden");
    assert.equal(rpcs.length, 0);
  }
  const { actions, rpcs } = setup();
  assert.equal((await actions.voidFinanceEntryAction(entryId, "mal")).code, "invalid");
  assert.equal(rpcs.length, 0);
  assert.equal((await actions.voidFinanceEntryAction(entryId, "Registro duplicado")).ok, true);
  assert.deepEqual(rpcs[0], { name: "void_finance_entry", args: { _entry_id: entryId, _reason: "Registro duplicado" } });
});

test("a member's statement is always their own; management may choose", async () => {
  const member = setup({ role: "member" });
  await member.actions.getFinanceStatementAction(2026, otherId);
  assert.ok(member.filters.some(([table, column, value]) => table === "finance_entries" && column === "member_id" && value === actorId));
  assert.ok(!member.filters.some(([, , value]) => value === otherId));
  const manager = setup();
  await manager.actions.getFinanceStatementAction(2026, otherId);
  assert.ok(manager.filters.some(([table, column, value]) => table === "finance_entries" && column === "member_id" && value === otherId));
});

test("CSV export is for management and neutralises spreadsheet formulas", async () => {
  assert.equal((await setup({ role: "member" }).actions.exportFinanceCsvAction({ month: "2026-10" })).code, "forbidden");
  const { actions } = setup({ entries: [{
    id: entryId, direction: "income", category: "donation", amount: "100.00", occurred_on: "2026-10-18", description: "=HYPERLINK(\"x\")",
    member_id: null, member_name_snapshot: null, counterparty_name: "Aliado, SRL", activity_id: null, activity_name_snapshot: null, monthly_due_id: null,
    payment_method: "cash", receipt_reference: null, voided_at: null, void_reason: null, receipt_number: 7, attachment_path: null,
  }] });
  const result = await actions.exportFinanceCsvAction({ month: "2026-10" });
  assert.equal(result.ok, true);
  assert.equal(result.fileName, "finanzas-club-2026-10.csv");
  assert.match(result.csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(result.csv, /"Aliado, SRL"/);
  assert.match(result.csv, /"7","2026-10-18","Ingreso"/);
});

test("attachments must live under their own entry", async () => {
  const { actions, rpcs } = setup();
  assert.equal((await actions.attachFinanceReceiptAction(entryId, "otra/recibo.pdf")).code, "invalid");
  assert.equal((await actions.attachFinanceReceiptAction(entryId, `${entryId}/recibo.pdf`)).ok, true);
  assert.equal(rpcs.at(-1).name, "set_finance_entry_attachment");
});

test("receipts stream through the platform with the visitor's session", async () => {
  const load = ({ user = { id: actorId }, path = `${entryId}/abc.png` } = {}) => {
    const downloads = [];
    const client = {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from() { const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: path ? { attachment_path: path } : null, error: null }) }; return query; },
      storage: { from(bucket) { return { download: async name => { downloads.push([bucket, name]); return { data: new Blob(["png"]), error: null }; } }; } },
    };
    const route = {};
    new Function("require", "exports", compile("../app/plataforma/comprobante/[id]/route.ts"))(name => ({ "@/utils/supabase/server": { createClient: async () => client } })[name], route);
    return { get: id => route.GET(new Request("http://x"), { params: Promise.resolve({ id }) }), downloads };
  };
  assert.equal((await load().get("../etc")).status, 404);
  assert.equal((await load({ user: null }).get(entryId)).status, 401);
  assert.equal((await load({ path: `${otherId}/abc.png` }).get(entryId)).status, 404);
  assert.equal((await load({ path: `${entryId}/abc.html` }).get(entryId)).status, 404);
  const ok = load();
  const response = await ok.get(entryId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(ok.downloads, [["club-finance-receipts", `${entryId}/abc.png`]]);
});
