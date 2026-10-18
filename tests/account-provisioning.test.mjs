import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", source)(name => name === "server-only" ? {} : name in dependencies ? dependencies[name] : nativeRequire(name), exports);
  return exports;
}
const cryptography = load("../lib/initial-password.ts");
const temporary = "TemporaryExample9!";
const chosen = "PersonalExample8!";
const initial = await cryptography.temporaryPasswordDigest(temporary);

test("temporary passwords use random salted digests and can be compared without storing plaintext", async () => {
  const second = await cryptography.temporaryPasswordDigest(temporary);
  assert.notEqual(second.salt, initial.salt);
  assert.notEqual(second.digest, initial.digest);
  assert.equal(await cryptography.isTemporaryPassword(temporary, initial.salt, initial.digest), true);
  assert.equal(await cryptography.isTemporaryPassword(chosen, initial.salt, initial.digest), false);
  await assert.rejects(() => cryptography.isTemporaryPassword(chosen, "bad", "bad"));
});

function provisioning({ authorized = true, duplicate = false, failSetup = false, failActivation = false, emailSent = true } = {}) {
  const calls = [];
  const emails = [];
  const admin = { auth: { admin: {
    createUser: async input => { calls.push(["create", input]); return duplicate ? { error: { code: "email_exists" }, data: {} } : { data: { user: { id: "new-member" } } }; },
    deleteUser: async id => { calls.push(["delete", id]); return {}; },
  } }, from: () => ({ insert: async input => { calls.push(["setup", input]); return { error: failSetup ? {} : null }; } }) };
  const actor = { userId: "verified-admin", supabase: {
    from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: { updated_at: "2026-10-18T00:00:00.123456Z" } }) }),
    rpc: async (name, input) => { calls.push([name, input]); return { error: failActivation ? {} : null }; },
  } };
  const action = load("../app/plataforma/member-provisioning-actions.ts", {
    "next/cache": { revalidatePath: () => {} },
    "@/utils/supabase/admin": { createAdminClient: () => { calls.push(["admin-client"]); return admin; } },
    "@/lib/initial-password": cryptography, "@/lib/temporary-password": { TEMPORARY_PASSWORD_MIN_LENGTH: 8 },
    "@/utils/site-url": { getPublicSiteOrigin: () => "https://club.example" },
    "@/lib/email": { memberCredentialsEmail: (name, email, password, url) => ({ subject: "acceso", text: [name, email, password, url].join("|"), html: "" }),
      sendClubEmail: async message => { emails.push(message); return emailSent; } },
    "./module-auth": { moduleFailure: message => ({ ok: false, message }), requireModuleActor: async roles => {
      assert.deepEqual(roles, ["admin"]); return authorized ? { actor } : { error: { ok: false, message: "forbidden" } };
    } },
  });
  return { calls, emails, action: action.createMemberAccountAction };
}
const input = { name: "Nuevo Miembro", email: " NUEVO@example.invalid ", temporaryPassword: temporary, role: "admin" };

test("creating a member authorizes the administrator before opening a privileged client", async () => {
  const fixture = provisioning({ authorized: false });
  assert.equal((await fixture.action(input)).ok, false);
  assert.deepEqual(fixture.calls, []);
});
test("the admin creates only a member and installs the password gate before approving access", async () => {
  const fixture = provisioning();
  assert.equal((await fixture.action(input)).ok, true);
  const create = fixture.calls.find(call => call[0] === "create")[1];
  assert.equal(create.email, "nuevo@example.invalid");
  assert.equal(create.app_metadata.require_password_change, true);
  assert.equal(create.app_metadata.admin_created_by, "verified-admin");
  const setup = fixture.calls.find(call => call[0] === "setup")[1];
  assert.equal(JSON.stringify(setup).includes(temporary), false);
  const activation = fixture.calls.find(call => call[0] === "update_member_access")[1];
  assert.equal(activation._role, "member");
  assert.equal(activation._status, "active");
  assert.equal(fixture.calls.findIndex(call => call[0] === "setup") < fixture.calls.findIndex(call => call[0] === "update_member_access"), true);
});
test("a duplicate email never modifies or deletes an existing identity", async () => {
  const fixture = provisioning({ duplicate: true });
  assert.equal((await fixture.action(input)).ok, false);
  assert.equal(fixture.calls.some(call => ["setup", "delete", "update_member_access"].includes(call[0])), false);
});
test("partial provisioning compensates only for the newly created identity", async () => {
  for (const options of [{ failSetup: true }, { failActivation: true }]) {
    const fixture = provisioning(options);
    assert.equal((await fixture.action(input)).ok, false);
    assert.deepEqual(fixture.calls.at(-1), ["delete", "new-member"]);
  }
});

function completion({ state = "required", authError = false } = {}) {
  const calls = [];
  const admin = { auth: { admin: { updateUserById: async (...args) => { calls.push(["metadata", ...args]); return {}; } } },
    from: () => {
      let write;
      const query = { select() { return this; }, eq(column, id) { if (column === "user_id") assert.equal(id, "signed-in-user"); return this; },
        is() { return this; }, update(value) { write = value; return this; },
        single: async () => {
          if (write) { calls.push(["completed", write]); return { data: { user_id: "signed-in-user" } }; }
          return { data: { password_salt: initial.salt, initial_password_digest: initial.digest, completed_at: null } };
        },
      }; return query;
    } };
  const client = { auth: { getUser: async () => ({ data: { user: { id: "signed-in-user", app_metadata: { require_password_change: true, retained: true } } } }),
    updateUser: async value => { calls.push(["password", value]); return { error: authError ? {} : null }; } },
    rpc: async () => ({ data: state }) };
  const action = load("../app/auth/first-password/actions.ts", {
    "@/utils/supabase/server": { createClient: async () => client }, "@/utils/supabase/admin": { createAdminClient: () => admin },
    "@/utils/supabase/end-session": { endServerSession: async global => { calls.push(["logout", global]); } }, "@/lib/initial-password": cryptography,
  });
  return { action: action.completeInitialPasswordAction, calls };
}
test("the temporary password is rejected before Auth or activation can change", async () => {
  const fixture = completion();
  assert.equal((await fixture.action(temporary, temporary)).ok, false);
  assert.deepEqual(fixture.calls, []);
});
test("the first-password form validates confirmation, length and bcrypt byte limits", async () => {
  for (const pair of [[chosen, "different"], ["short", "short"], ["a".repeat(65), "a".repeat(65)], ["😀".repeat(20), "😀".repeat(20)]]) {
    const fixture = completion(); assert.equal((await fixture.action(...pair)).ok, false); assert.deepEqual(fixture.calls, []);
  }
});
test("a successful change clears the digest only after Auth succeeds and ends all temporary sessions", async () => {
  const fixture = completion();
  assert.equal((await fixture.action(chosen, chosen)).ok, true);
  assert.deepEqual(fixture.calls.map(call => call[0]), ["password", "metadata", "completed", "logout"]);
  assert.equal(fixture.calls[1][2].app_metadata.require_password_change, false);
  assert.equal(fixture.calls[1][2].app_metadata.retained, true);
  assert.equal(fixture.calls[2][1].password_salt, null);
  assert.equal(fixture.calls[2][1].initial_password_digest, null);
  assert.deepEqual(fixture.calls.at(-1), ["logout", true]);
});
test("Auth failures and already-completed setups never clear the first-password gate", async () => {
  const failed = completion({ authError: true });
  assert.equal((await failed.action(chosen, chosen)).ok, false);
  assert.deepEqual(failed.calls.map(call => call[0]), ["password"]);
  const stale = completion({ state: "sign_in_again" });
  assert.equal((await stale.action(chosen, chosen)).ok, false);
  assert.deepEqual(stale.calls, []);
});

test("the new member receives their access details once, and only after a complete sign-up", async () => {
  const fixture = provisioning();
  const result = await fixture.action(input);
  assert.equal(fixture.emails.length, 1);
  assert.equal(fixture.emails[0].to, "nuevo@example.invalid");
  assert.equal(fixture.emails[0].text, `Nuevo Miembro|nuevo@example.invalid|${temporary}|https://club.example/auth/sign-in`);
  assert.match(result.message, /Le enviamos sus datos de acceso/);
  const unsent = provisioning({ emailSent: false });
  assert.match((await unsent.action(input)).message, /no se pudo enviar el correo/);
  for (const options of [{ duplicate: true }, { failSetup: true }, { failActivation: true }, { authorized: false }]) {
    const failed = provisioning(options);
    await failed.action(input);
    assert.equal(failed.emails.length, 0);
  }
});
