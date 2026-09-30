import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const activityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const dueId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const entryId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const actionsSource = ts.transpileModule(readFileSync(new URL("../app/plataforma/actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ role = "admin", status = "active", signedIn = true, rpcError = null } = {}) {
  const calls = [];
  const invalidations = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: actorId } : null }, error: null }) },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle: async () => table === "memberships"
          ? { data: { membership_role: role, membership_status: status }, error: null }
          : { data: null, error: null },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      return { data: name === "create_finance_monthly_dues" ? 7 : entryId, error: null };
    },
  };

  const dependencies = {
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: (error) => ["42P01", "42703", "PGRST202", "PGRST205"].includes(error?.code) },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", actionsSource)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, actions);
  return { actions, calls, invalidations };
}

test("an authorized manager generates one idempotent monthly quota batch", async () => {
  const { actions, calls, invalidations } = setup({ role: "club_manager" });
  const result = await actions.createFinanceMonthlyDuesAction({ month: "2026-09", amountDue: "450.00" });

  assert.equal(result.ok, true);
  assert.match(result.message, /7 aportes mensuales/);
  assert.deepEqual(calls, [{
    name: "create_finance_monthly_dues",
    args: { _due_month: "2026-09-01", _amount_due: "450.00" },
  }]);
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("only active club managers and admins can write financial records", async () => {
  for (const role of ["member", "coordinator", "editor"]) {
    const { actions, calls } = setup({ role });
    const result = await actions.createFinanceMonthlyDuesAction({ month: "2026-09", amountDue: "450" });
    assert.equal(result.code, "forbidden");
    assert.equal(calls.length, 0);
  }

  for (const status of ["pending", "suspended"]) {
    const { actions, calls } = setup({ status });
    assert.notEqual((await actions.createFinanceMonthlyDuesAction({ month: "2026-09", amountDue: "450" })).ok, true);
    assert.equal(calls.length, 0);
  }
});

test("monthly quotas reject invalid periods and non-cent or non-positive amounts", async () => {
  const { actions, calls } = setup();
  for (const input of [
    { month: "2026-13", amountDue: "450" },
    { month: "2026-09", amountDue: "0" },
    { month: "2026-09", amountDue: "450.001" },
    { month: "2026-09", amountDue: "1e3" },
  ]) {
    assert.equal((await actions.createFinanceMonthlyDuesAction(input)).code, "invalid");
  }
  assert.equal(calls.length, 0);
});

test("manager entries derive income or expense direction and never accept monthly dues directly", async () => {
  const { actions, calls } = setup();
  const base = {
    amount: "250.00",
    occurredOn: "2026-09-30",
    description: "Materiales para el servicio",
    paymentMethod: "bank_transfer",
  };

  assert.equal((await actions.createFinanceEntryAction({
    ...base, category: "activity_contribution", activityId,
    memberId,
  })).ok, true);
  assert.equal((await actions.createFinanceEntryAction({
    ...base, category: "activity_expense", activityId,
  })).ok, true);
  assert.deepEqual(calls.map((call) => [call.name, call.args._direction, call.args._category]), [
    ["create_finance_entry", "income", "activity_contribution"],
    ["create_finance_entry", "expense", "activity_expense"],
  ]);
  assert.equal(calls[0].args._member_id, memberId);
});

test("bad references, dates, categories and amounts never reach the finance RPC", async () => {
  const { actions, calls } = setup();
  const base = {
    category: "activity_contribution",
    amount: "250.00",
    occurredOn: "2026-09-30",
    description: "Aporte de actividad",
    paymentMethod: "cash",
    activityId,
  };
  for (const input of [
    { ...base, amount: "0" },
    { ...base, amount: "250.001" },
    { ...base, occurredOn: "2026-02-30" },
    { ...base, category: "monthly_dues" },
    { ...base, activityId: undefined },
    { ...base, memberId: "invalid" },
  ]) {
    assert.equal((await actions.createFinanceEntryAction(input)).code, "invalid");
  }

  assert.equal((await actions.recordFinanceMonthlyPaymentAction({
    dueId: "invalid", amount: "100", occurredOn: "2026-09-30", paymentMethod: "cash",
  })).code, "invalid");
  assert.equal(calls.length, 0);
});

test("monthly payments use the atomic dues RPC and preserve the receipt reference", async () => {
  const { actions, calls } = setup();
  const result = await actions.recordFinanceMonthlyPaymentAction({
    dueId,
    amount: "125.50",
    occurredOn: "2026-09-30",
    paymentMethod: "cash",
    receiptReference: "REC-309",
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, entryId);
  assert.deepEqual(calls, [{
    name: "record_finance_monthly_payment",
    args: {
      _due_id: dueId,
      _amount: "125.50",
      _occurred_on: "2026-09-30",
      _payment_method: "cash",
      _receipt_reference: "REC-309",
    },
  }]);
});
