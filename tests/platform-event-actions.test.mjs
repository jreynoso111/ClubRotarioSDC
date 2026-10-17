import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const source = readFileSync(new URL("../app/plataforma/actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const auditModel = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../lib/audit.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(auditModel);
const editorialContent = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../lib/editorial-content.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(editorialContent);
const input = { title: "Encuentro del club", kind: "encuentro", startsAt: "2040-10-09T18:30:00-04:00", status: "draft" };

// Substitute only the request context and database transport; exercise the actual server actions.
function setup({ role = "admin", status = "active", signedIn = true, eventStatus = "published", past = false, missing = false, storedRsvp = "going", duplicateSlugs = 0 } = {}) {
  const writes = [];
  const invalidations = [];
  const client = {
    rpc: async name => {
      if (name === "get_event_attendance") return { data: [{ user_id: actorId, display_name: "Ana", rsvp_status: "going" }], error: null };
      if (name === "get_event_attendance_summary") return { data: [{ event_id: eventId, going: 1, maybe: 0, waitlisted: 0, declined: 2, unanswered: 5, attended: null }], error: null };
      assert.equal(name, "has_privileged_session"); return { data: true, error: null };
    },
    auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: signedIn ? { id: actorId } : null }, error: null }) },
    from(table) {
      let write = false;
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; },
        insert(value) { write = true; writes.push({ table, operation: "insert", value }); return query; },
        update(value) { write = true; writes.push({ table, operation: "update", value }); return query; },
        delete() { write = true; writes.push({ table, operation: "delete" }); return query; },
        async upsert(value, options) { writes.push({ table, operation: "upsert", value, options }); return { error: null }; },
        async range() { return { data: [], error: null }; },
        async maybeSingle() {
          if (table === "memberships") return { data: { membership_role: role, membership_status: status }, error: null };
          if (table === "event_rsvps") return { data: { rsvp_status: storedRsvp }, error: null };
          if (table === "events" && write && writes.at(-1)?.operation === "insert" && duplicateSlugs > 0) {
            duplicateSlugs -= 1; return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          assert.equal(table, "events");
          return { data: missing ? null : write ? { id: eventId } : {
            id: eventId, status: eventStatus, starts_at: past ? "2000-01-01T00:00:00Z" : "2040-10-09T22:30:00Z", ends_at: null,
          }, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
    "next/cache": { revalidatePath: (...args) => invalidations.push(args) },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": auditModel,
    "@/lib/editorial-content": editorialContent,
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, actions);
  return { actions, writes, invalidations };
}

test("a member can RSVP but cannot create, modify, delete events or read other members' attendance", async () => {
  const { actions, writes } = setup({ role: "member" });
  for (const result of [
    await actions.createEventAction(input), await actions.updateEventAction(eventId, input),
    await actions.deleteEventAction(eventId), await actions.getEventAttendeesAction(eventId),
  ]) assert.equal(result.code, "forbidden");
  assert.equal(writes.length, 0);
  assert.equal((await actions.rsvpEventAction(eventId, "going")).ok, true);
  assert.deepEqual(writes[0], {
    table: "event_rsvps", operation: "upsert", value: { event_id: eventId, user_id: actorId, rsvp_status: "going" },
    options: { onConflict: "event_id,user_id" },
  });
});

test("signed-out and inactive users cannot submit an RSVP or change events", async () => {
  for (const [settings, code] of [[{ signedIn: false }, "unauthenticated"], [{ status: "pending" }, "pending"], [{ status: "suspended" }, "suspended"]]) {
    const { actions, writes } = setup(settings);
    assert.equal((await actions.rsvpEventAction(eventId, "going")).code, code);
    assert.equal((await actions.deleteEventAction(eventId)).code, code);
    assert.equal(writes.length, 0);
  }
});

test("coordination and management run the agenda; editors run the magazine", async () => {
  for (const role of ["coordinator", "club_manager", "admin"]) {
    const { actions } = setup({ role });
    assert.equal((await actions.createEventAction(input)).ok, true);
    assert.equal((await actions.updateEventAction(eventId, input)).ok, true);
    const canDelete = role === "club_manager" || role === "admin";
    assert.equal((await actions.deleteEventAction(eventId)).ok, canDelete);
    const attendees = await actions.getEventAttendeesAction(eventId);
    assert.equal(attendees.ok, true);
    assert.deepEqual(attendees.counts && [attendees.counts.declined, attendees.counts.unanswered], [2, 5]);
  }
  const { actions, writes } = setup({ role: "editor" });
  assert.equal((await actions.createEventAction(input)).code, "forbidden");
  assert.equal((await actions.updateEventAction(eventId, input)).code, "forbidden");
  assert.equal(writes.length, 0);
});

test("a coordinator can publish a new event and promote a draft", async () => {
  const { actions } = setup({ role: "coordinator", eventStatus: "draft" });
  assert.equal((await actions.createEventAction({ ...input, status: "published" })).ok, true);
  assert.equal((await actions.updateEventAction(eventId, { ...input, status: "published" })).ok, true);
});

test("a full event places the confirmation on the waitlist and says so", async () => {
  const { actions } = setup({ role: "member", storedRsvp: "waitlisted" });
  assert.match((await actions.rsvpEventAction(eventId, "going")).message, /lista de espera/);
});

test("a repeated title gets the date in its link instead of failing", async () => {
  const { actions, writes } = setup({ duplicateSlugs: 1 });
  assert.equal((await actions.createEventAction(input)).ok, true);
  const slugs = writes.filter(write => write.operation === "insert").map(write => write.value.slug);
  assert.deepEqual(slugs, ["encuentro-del-club", "encuentro-del-club-2040-10-09"]);
});

test("invalid dates, titles, capacity and location URLs never reach a write", async () => {
  for (const invalid of [
    { title: "ab" }, { startsAt: "not-a-date" }, { endsAt: "2000-01-01T00:00:00Z" },
    { capacity: -1 }, { capacity: "2.5" }, { locationUrl: "javascript:alert(1)" }, { status: "unknown" },
  ]) {
    const { actions, writes } = setup();
    assert.equal((await actions.createEventAction({ ...input, ...invalid })).code, "invalid");
    assert.equal(writes.length, 0);
  }
});

test("draft, cancelled, archived, past and missing events reject attendance", async () => {
  for (const settings of [{ eventStatus: "draft" }, { eventStatus: "cancelled" }, { eventStatus: "archived" }, { past: true }, { missing: true }]) {
    const { actions, writes } = setup({ role: "member", ...settings });
    assert.equal((await actions.rsvpEventAction(eventId, "going")).code, "invalid");
    assert.equal(writes.length, 0);
  }
});

test("updating an event preserves its URL and invalidates the public agenda and detail pages", async () => {
  const { actions, writes, invalidations } = setup();
  assert.equal((await actions.updateEventAction(eventId, { ...input, title: "Nuevo título" })).ok, true);
  assert.equal(Object.hasOwn(writes[0].value, "slug"), false);
  assert.ok(invalidations.some(([path]) => path === "/eventos"));
  assert.ok(invalidations.some(([path, type]) => path === "/eventos/[slug]" && type === "page"));
});

test("an unmatched update or delete cannot report success", async () => {
  const { actions } = setup({ missing: true });
  assert.equal((await actions.updateEventAction(eventId, input)).ok, false);
  assert.equal((await actions.deleteEventAction(eventId)).ok, false);
});
