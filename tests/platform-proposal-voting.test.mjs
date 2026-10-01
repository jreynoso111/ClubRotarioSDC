import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const forgedAuthorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const actionsSource = ts.transpileModule(readFileSync(new URL("../app/plataforma/actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({
  role = "member",
  status = "active",
  signedIn = true,
  proposalStatus = "submitted",
  votingOpen = false,
  proposalMissing = false,
  voteError = null,
} = {}) {
  const writes = [];
  const invalidations = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: actorId } : null }, error: null }) },
    from(table) {
      let operation = null;
      let value = null;
      const query = {
        select() { return query; },
        eq() { return query; },
        insert(input) { operation = "insert"; value = input; writes.push({ table, operation, value }); return query; },
        update(input) { operation = "update"; value = input; writes.push({ table, operation, value }); return query; },
        maybeSingle: async () => {
          if (table === "memberships") {
            return { data: { membership_role: role, membership_status: status }, error: null };
          }
          if (table === "proposals" && operation === "insert") return { data: { id: proposalId }, error: null };
          if (table === "proposals" && operation === "update") return { data: proposalMissing ? null : { id: proposalId }, error: null };
          if (table === "proposals") {
            return { data: proposalMissing ? null : { id: proposalId, status: proposalStatus, voting_open: votingOpen }, error: null };
          }
          return { data: null, error: null };
        },
        async upsert(input, options) {
          writes.push({ table, operation: "upsert", value: input, options });
          return { error: voteError };
        },
      };
      return query;
    },
  };

  const dependencies = {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
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
  return { actions, writes, invalidations };
}

test("a proposal stores the authenticated creator, ignoring any submitted author id", async () => {
  const { actions, writes, invalidations } = setup();
  const result = await actions.createProposalAction({
    title: "Recuperar una plaza",
    summary: "Organizar una jornada de servicio con los vecinos.",
    details: "Convocar aliados locales.",
    created_by: forgedAuthorId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, proposalId);
  assert.deepEqual(writes, [{
    table: "proposals",
    operation: "insert",
    value: {
      title: "Recuperar una plaza",
      summary: "Organizar una jornada de servicio con los vecinos.",
      details: "Convocar aliados locales.",
      created_by: actorId,
    },
  }]);
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("only active coordinators and club managers can open or close a proposal ballot", async () => {
  for (const role of ["coordinator", "club_manager", "admin"]) {
    const { actions, writes } = setup({ role });
    const result = await actions.setProposalVotingAction(proposalId, true);
    assert.equal(result.ok, true);
    assert.deepEqual(writes.map(({ table, operation, value }) => ({ table, operation, value })), [
      { table: "proposals", operation: "update", value: { voting_open: true } },
    ]);
  }

  const { actions, writes } = setup({ role: "member" });
  assert.equal((await actions.setProposalVotingAction(proposalId, true)).code, "forbidden");
  assert.equal(writes.length, 0);
});

test("a ballot cannot be opened for a draft, invalid proposal, or invalid toggle", async () => {
  for (const options of [
    { proposalStatus: "draft" },
    { proposalMissing: true },
  ]) {
    const { actions, writes } = setup({ role: "coordinator", ...options });
    assert.equal((await actions.setProposalVotingAction(proposalId, true)).ok, false);
    assert.equal(writes.length, 0);
  }

  const { actions, writes } = setup({ role: "coordinator" });
  assert.equal((await actions.setProposalVotingAction("bad-id", true)).code, "invalid");
  assert.equal((await actions.setProposalVotingAction(proposalId, "yes")).code, "invalid");
  assert.equal(writes.length, 0);
});

test("an active member can cast one ballot tied to their authenticated account", async () => {
  const { actions, writes, invalidations } = setup();
  const result = await actions.castProposalVoteAction(proposalId, "against");

  assert.equal(result.ok, true);
  assert.deepEqual(writes, [{
    table: "proposal_votes",
    operation: "upsert",
    value: { proposal_id: proposalId, user_id: actorId, vote_choice: "against" },
    options: { onConflict: "proposal_id,user_id" },
  }]);
  assert.deepEqual(invalidations, ["/plataforma"]);
});

test("pending and suspended accounts cannot vote, and invalid choices never reach Supabase", async () => {
  for (const status of ["pending", "suspended"]) {
    const { actions, writes } = setup({ status });
    assert.notEqual((await actions.castProposalVoteAction(proposalId, "for")).ok, true);
    assert.equal(writes.length, 0);
  }

  const { actions, writes } = setup();
  assert.equal((await actions.castProposalVoteAction("bad-id", "for")).code, "invalid");
  assert.equal((await actions.castProposalVoteAction(proposalId, "maybe")).code, "invalid");
  assert.equal(writes.length, 0);
});
