import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const originalUpdatedAt = "2026-09-30T14:30:00.123456Z";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function setup({ role = "member", membershipStatus = "active", proposalStatus = "draft", ownerId = actorId, votingOpen = false, race = false } = {}) {
  let record = { id: proposalId, created_by: ownerId, title: "Propuesta inicial", summary: "Una propuesta inicial para el servicio del club.", details: "Detalles iniciales.", status: proposalStatus, voting_open: votingOpen, updated_at: originalUpdatedAt, submitted_at: "2026-09-20T12:00:00Z", reviewed_at: "2026-09-29T12:00:00Z", reviewed_by: otherId, review_notes: "Agrega un presupuesto claro para revisar la iniciativa." };
  const attempts = [];
  const committed = [];
  const invalidations = [];
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    from(table) {
      let update = null;
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        update(value) { update = value; return query; },
        async maybeSingle() {
          if (table === "memberships") return { data: { membership_role: role, membership_status: membershipStatus }, error: null };
          assert.equal(table, "proposals");
          if (update && race) record = { ...record, updated_at: "2026-09-30T14:30:00.123457Z" };
          const matches = filters.every(([column, value]) => record[column] === value);
          if (update) {
            attempts.push({ value: update, filters });
            if (matches) { record = { ...record, ...update }; committed.push(update); }
          }
          return { data: matches ? { ...record } : null, error: null };
        },
      };
      return query;
    },
    async rpc(name, input) {
      calls.push({ name, input });
      assert.equal(name, "submit_proposal");
      if (input._proposal_id === record.id && record.created_by === actorId && ["draft", "rejected"].includes(record.status)) {
        record = { ...record, status: "submitted", submitted_at: record.submitted_at ?? new Date().toISOString() };
        return { data: record, error: null };
      }
      return { data: null, error: { code: "P0001" } };
    },
  };
  const dependencies = {
    "server-only": {},
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": {},
    "@/lib/editorial-content": {},
    "@/lib/finance": {},
    "./members-actions": {},
  };
  const load = (path) => {
    const exports = {};
    new Function("require", "exports", compile(path))((name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    }, exports);
    return exports;
  };
  dependencies["./module-auth"] = load("../app/plataforma/module-auth.ts");
  return { actions: load("../app/plataforma/proposal-management-actions.ts"), submission: load("../app/plataforma/actions.ts"), attempts, committed, calls, invalidations, getRecord: () => record };
}

const correction = { proposalId, title: "Propuesta corregida", summary: "Un resumen corregido con alcance y presupuesto claros.", details: "Presupuesto y equipo propuesto." };

test("an author corrects a rejected proposal into a draft and can submit that correction again", async () => {
  const context = setup({ proposalStatus: "rejected" });
  const result = await context.actions.editProposalDraftAction(correction);
  assert.equal(result.ok, true);
  assert.equal(context.getRecord().status, "draft");
  assert.equal(context.getRecord().title, correction.title);
  assert.equal(context.getRecord().created_by, actorId);
  assert.equal(context.getRecord().reviewed_at, null);
  assert.equal(context.getRecord().reviewed_by, null);
  assert.equal(context.getRecord().submitted_at, null);
  assert.equal(context.getRecord().review_notes, "Agrega un presupuesto claro para revisar la iniciativa.");
  assert.deepEqual(context.attempts[0].filters, [["id", proposalId], ["created_by", actorId], ["status", "rejected"], ["updated_at", originalUpdatedAt], ["voting_open", false]]);
  assert.equal((await context.submission.submitProposalAction(proposalId)).ok, true);
  assert.equal(context.getRecord().status, "submitted");
  assert.ok(context.getRecord().submitted_at);
  assert.deepEqual(context.calls, [{ name: "submit_proposal", input: { _proposal_id: proposalId } }]);
});

test("editing never changes another author's proposal or a proposal already under review", async () => {
  for (const options of [{ ownerId: otherId }, { proposalStatus: "submitted" }, { proposalStatus: "approved" }, { membershipStatus: "suspended" }]) {
    const context = setup(options);
    assert.equal((await context.actions.editProposalDraftAction(correction)).ok, false);
    assert.equal(context.committed.length, 0);
  }
});

test("decisions record the authenticated reviewer and server date with exact version checks", async () => {
  const context = setup({ role: "coordinator", proposalStatus: "in_review" });
  const before = Date.now();
  const result = await context.actions.reviewProposalAction({ proposalId, status: "approved", notes: "El alcance y presupuesto están completos.", reviewed_at: "2000-01-01T00:00:00Z", reviewed_by: otherId });
  const after = Date.now();
  assert.equal(result.ok, true);
  assert.equal(context.committed[0].reviewed_by, actorId);
  assert.ok(Date.parse(context.committed[0].reviewed_at) >= before && Date.parse(context.committed[0].reviewed_at) <= after);
  assert.deepEqual(context.attempts[0].filters, [["id", proposalId], ["status", "in_review"], ["updated_at", originalUpdatedAt], ["voting_open", false]]);
  assert.deepEqual(context.invalidations, ["/plataforma"]);
});

test("a competing update with the same status prevents both stale corrections and stale decisions", async () => {
  for (const mode of ["edit", "review"]) {
    const context = setup({ role: "coordinator", proposalStatus: mode === "edit" ? "rejected" : "in_review", race: true });
    const result = mode === "edit" ? await context.actions.editProposalDraftAction(correction) : await context.actions.reviewProposalAction({ proposalId, status: "approved", notes: "Decisión propuesta." });
    assert.equal(result.ok, false);
    assert.match(result.message, /cambió/);
    assert.equal(context.committed.length, 0);
    assert.deepEqual(context.invalidations, []);
  }
});

test("review permissions, closed-ballot requirements and rejection reasons are enforced before writing", async () => {
  for (const options of [{ role: "member" }, { votingOpen: true }, { proposalStatus: "draft" }, { proposalStatus: "archived" }]) {
    const context = setup({ role: "coordinator", proposalStatus: "in_review", ...options });
    assert.equal((await context.actions.reviewProposalAction({ proposalId, status: "approved", notes: "Motivo completo." })).ok, false);
    assert.equal(context.attempts.length, 0);
  }
  const context = setup({ role: "coordinator", proposalStatus: "in_review" });
  assert.equal((await context.actions.reviewProposalAction({ proposalId, status: "rejected", notes: "" })).code, "invalid");
  assert.equal(context.attempts.length, 0);
});

function renderCard({ status = "rejected", ownerId = actorId, manager = false, startedAt = null, isOpen = false } = {}) {
  const exports = {};
  new Function("require", "exports", compile("../app/plataforma/ProposalCard.tsx"))((name) => name.endsWith(".css") ? new Proxy({}, { get: (_, key) => key }) : require(name), exports);
  return renderToStaticMarkup(createElement(exports.ProposalCard, {
    proposal: { id: proposalId, title: "Idea del club", summary: "Resumen de la propuesta.", details: "", status, createdBy: ownerId, reviewNotes: "Completa el presupuesto.", voting: { isOpen, startedAt, myVote: null, votesFor: 3, votesAgainst: 1, votesAbstaining: 0 } },
    metadata: "Una propuesta del club", currentUserId: actorId, canManageVoting: manager, pending: false,
    onSubmit() {}, onToggleVoting() {}, onVote() {}, onEdit() {}, onReview() {},
  }));
}

test("proposal controls offer corrections only to authors and explain that reopening retains existing votes", () => {
  assert.match(renderCard(), /Corregir propuesta/);
  assert.doesNotMatch(renderCard({ ownerId: otherId }), /Corregir propuesta/);
  assert.doesNotMatch(renderCard({ status: "in_review" }), /Corregir propuesta/);
  const closedBallot = renderCard({ status: "in_review", manager: true, startedAt: "2026-09-30T12:00:00Z" });
  assert.match(closedBallot, /Reabrir votación · conservar votos/);
  assert.match(closedBallot, /se conservarán los votos registrados/);
  assert.match(renderCard({ status: "submitted", manager: true }), /Activar votación/);
});
