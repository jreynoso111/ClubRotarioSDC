import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { accountDependencies } from "./helpers/account-deps.mjs";

function compile(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", source)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const account = accountDependencies["@/lib/account"];
const navigation = compile("../lib/platform-navigation.ts");

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuidOne = "11111111-1111-4111-8111-111111111111";
const uuidTwo = "22222222-2222-4222-8222-222222222222";
const ownPath = `${actorId}/avatar-${uuidOne}.webp`;
const nextPath = `${actorId}/avatar-${uuidTwo}.webp`;
const otherPath = `${otherId}/avatar-${uuidTwo}.webp`;
const siteOrigin = "https://www.clubrotariosdcolonial.org";

// Fake server client: records every write so rejected input can be shown to never reach Auth, Storage or the profile.
function setup({ membership = "active", signedIn = true, requirePassword = false, avatarPath = null, listed,
  updateUserError = null, reauthError = null, profileError = null } = {}) {
  const calls = { updateUser: [], reauthenticate: 0, updates: [], removes: [], lists: [], endSession: [], redirects: [] };
  const profile = { avatar_path: avatarPath };
  const defaultListing = [{ name: `avatar-${uuidTwo}.webp`, metadata: { size: 2048, mimetype: "image/webp" } }];
  const client = {
    auth: {
      getUser: async () => signedIn
        ? { data: { user: { id: actorId, email: "ana@example.org", app_metadata: requirePassword ? { require_password_change: true } : {} } }, error: null }
        : { data: { user: null }, error: new Error("missing session") },
      updateUser: async (attributes, options) => { calls.updateUser.push({ attributes, options }); return { data: {}, error: updateUserError }; },
      reauthenticate: async () => { calls.reauthenticate += 1; return { data: {}, error: reauthError }; },
    },
    from(table) {
      const state = { op: "select" };
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        update(values) { state.op = "update"; calls.updates.push({ table, values }); return builder; },
        async maybeSingle() {
          if (table === "memberships") return { data: membership ? { membership_status: membership } : null, error: null };
          if (table === "profiles" && state.op === "update") return { data: { id: actorId }, error: profileError };
          if (table === "profiles") return { data: { ...profile }, error: profileError };
          return { data: null, error: null };
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "club-media");
        return {
          list: async (folder, options) => { calls.lists.push({ folder, options }); return { data: listed ?? defaultListing, error: null }; },
          remove: async paths => { calls.removes.push(...paths); return { data: [], error: null }; },
        };
      },
    },
  };
  const dependencies = {
    "next/navigation": { redirect: destination => { calls.redirects.push(destination); throw new Error("NEXT_REDIRECT"); } },
    "@/lib/account": account,
    "@/utils/supabase/end-session": { endServerSession: async all => { calls.endSession.push(all); } },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
    "@/utils/site-url": { getPublicSiteOrigin: () => siteOrigin },
  };
  return { actions: compile("../app/plataforma/account-actions.ts", dependencies), calls };
}

test("avatar paths belong to the caller's folder, use the webp avatar shape and a lowercase uuid", () => {
  assert.equal(account.isOwnAvatarPath(actorId, ownPath), true);
  assert.equal(account.isOwnAvatarPath(actorId, otherPath), false);
  assert.equal(account.isOwnAvatarPath(actorId, `${actorId}/avatar-${uuidOne}.jpg`), false);
  assert.equal(account.isOwnAvatarPath(actorId, `${actorId}/avatar-ABCDEF01-2345-4678-89AB-CDEF01234567.webp`), false);
  assert.equal(account.isOwnAvatarPath(actorId, `${actorId}/avatar-not-a-uuid.webp`), false);
  assert.equal(account.isOwnAvatarPath(actorId, `${actorId}/avatar-${uuidOne}.webp.exe`), false);
  assert.equal(account.isOwnAvatarPath(actorId, `${actorId}/../avatar-${uuidOne}.webp`), false);
  assert.equal(account.isOwnAvatarPath(actorId, `avatar-${uuidOne}.webp`), false);
  assert.equal(account.isOwnAvatarPath("not-a-uid", `not-a-uid/avatar-${uuidOne}.webp`), false);
  assert.equal(account.isOwnAvatarPath(actorId, null), false);
  assert.equal(account.avatarPathFor(actorId, uuidTwo), nextPath);
  assert.equal(account.avatarObjectName(actorId, nextPath), `avatar-${uuidTwo}.webp`);
});

test("the avatar version and route URL only appear for a stored photo", () => {
  assert.equal(account.avatarVersion(null, "2026-10-18T12:00:00Z"), null);
  assert.equal(account.avatarVersion(ownPath, null), null);
  assert.equal(account.avatarVersion(ownPath, "2026-10-18T12:00:00Z"), "2026-10-18T12:00:00Z");
  assert.equal(account.avatarRouteUrl(actorId, "2026-10-18T12:00:00.000+00:00"),
    `/plataforma/avatar/${actorId}?v=2026-10-18T12%3A00%3A00.000%2B00%3A00`);
});

test("initials match the existing lists and the square crop stays centered", () => {
  assert.equal(account.initialsFor("María Pérez de la Cruz"), "MP");
  assert.equal(account.initialsFor("ana"), "A");
  assert.equal(account.initialsFor("   "), "?");
  assert.deepEqual(account.centeredSquare(800, 600), { x: 100, y: 0, side: 600 });
  assert.deepEqual(account.centeredSquare(600, 800), { x: 0, y: 100, side: 600 });
  assert.throws(() => account.centeredSquare(0, 10));
});

test("profile name and bio follow the form and database limits", () => {
  assert.equal(account.validateDisplayName(" A ").ok, false);
  assert.deepEqual(account.validateDisplayName("  Ana Pérez  "), { ok: true, value: "Ana Pérez" });
  assert.equal(account.validateDisplayName("n".repeat(121)).ok, false);
  assert.equal(account.validateDisplayName(42).ok, false);
  assert.equal(account.validateBio("b".repeat(601)).ok, false);
  assert.deepEqual(account.validateBio("  Voluntaria desde 2019 "), { ok: true, value: "Voluntaria desde 2019" });
  assert.deepEqual(account.validateBio(null), { ok: true, value: "" });
  assert.equal(account.validateBio(["no"]).ok, false);
});

test("email changes are validated, normalized and rejected when unchanged", () => {
  assert.equal(account.validateEmailAddress("Ana@Example.org ", "ana@example.org").ok, false);
  assert.deepEqual(account.validateEmailAddress("ANA.NUEVA@EXAMPLE.ORG", "ana@example.org"), { ok: true, value: "ana.nueva@example.org" });
  assert.equal(account.validateEmailAddress("sin-arroba", "ana@example.org").ok, false);
  assert.equal(account.validateEmailAddress(`${"a".repeat(250)}@x.org`, "ana@example.org").ok, false);
  assert.equal(account.validateEmailAddress(undefined, "ana@example.org").ok, false);
});

test("the password step needs a six-digit code and a matching confirmation of 8 to 72 bytes", () => {
  assert.deepEqual(account.validateReauthCode(" 123456 "), { ok: true, value: "123456" });
  for (const code of ["12345", "1234567", "12a456", "", 123456]) assert.equal(account.validateReauthCode(code).ok, false, String(code));
  assert.equal(account.validateNewPassword("abcdefg", "abcdefg").ok, false);
  assert.equal(account.validateNewPassword("abcdefgh", "abcdefgX").ok, false);
  assert.equal(account.validateNewPassword("ñ".repeat(37), "ñ".repeat(37)).ok, false);
  assert.equal(account.validateNewPassword("ñ".repeat(36), "ñ".repeat(36)).ok, true);
  assert.equal(account.validateNewPassword("abcdefgh", "abcdefgh").ok, true);
});

test("workspace tab ids accept the account page for every signed-in member", () => {
  const members = { canAudit: false, canEdit: false };
  assert.equal(navigation.allowedWorkspaceTab("perfil", members), "perfil");
  assert.equal(navigation.allowedWorkspaceTab("perfil", { canAudit: true, canEdit: true }), "perfil");
  assert.equal(navigation.navigationItems.some(item => item.id === "perfil"), false, "Mi cuenta stays out of the sidebar");
  assert.equal(navigation.allowedWorkspaceTab("mensajes", members), "mensajes");
  assert.equal(navigation.allowedWorkspaceTab("auditoria", members), null);
  assert.equal(navigation.allowedWorkspaceTab("diagnostico", members), null);
  assert.equal(navigation.allowedWorkspaceTab("fotografias", members), null);
  assert.equal(navigation.allowedWorkspaceTab("diagnostico", { canAudit: true, canEdit: false }), "diagnostico");
  assert.equal(navigation.allowedWorkspaceTab("perfil&tab=x", members), null);
  assert.equal(navigation.allowedWorkspaceTab(null, members), null);
});

test("profile updates validate both fields before writing and store an empty bio as null", async () => {
  let fixture = setup();
  assert.equal((await fixture.actions.updateOwnProfileAction({ displayName: "A", bio: "" })).ok, false);
  assert.equal((await fixture.actions.updateOwnProfileAction({ displayName: "Ana", bio: "b".repeat(601) })).ok, false);
  assert.equal(fixture.calls.updates.length, 0);

  fixture = setup();
  const saved = await fixture.actions.updateOwnProfileAction({ displayName: " Ana Pérez ", bio: "   " });
  assert.equal(saved.ok, true);
  assert.deepEqual(fixture.calls.updates, [{ table: "profiles", values: { display_name: "Ana Pérez", bio: null } }]);

  const denied = setup({ membership: "pending" });
  assert.equal((await denied.actions.updateOwnProfileAction({ displayName: "Ana", bio: "" })).code, "forbidden");
  assert.equal(denied.calls.updates.length, 0);
  assert.equal((await setup({ signedIn: false }).actions.updateOwnProfileAction({ displayName: "Ana", bio: "" })).code, "unauthenticated");
  assert.equal((await setup({ requirePassword: true }).actions.updateOwnProfileAction({ displayName: "Ana", bio: "" })).code, "password_setup_required");
});

test("a photo is saved only from the caller's own folder and the previous photo is removed only from that folder", async () => {
  for (const path of [otherPath, `${actorId}/avatar-${uuidTwo}.jpg`, `${actorId}/../avatar-${uuidTwo}.webp`, null]) {
    const fixture = setup({ avatarPath: ownPath });
    assert.equal((await fixture.actions.saveAvatarAction(path)).code, "invalid", String(path));
    assert.equal(fixture.calls.lists.length, 0);
    assert.equal(fixture.calls.updates.length, 0);
    assert.equal(fixture.calls.removes.length, 0);
  }

  const missing = setup({ listed: [] });
  assert.equal((await missing.actions.saveAvatarAction(nextPath)).code, "invalid");
  assert.equal(missing.calls.updates.length, 0);

  const oversized = setup({ listed: [{ name: `avatar-${uuidTwo}.webp`, metadata: { size: 6 * 1024 * 1024 } }] });
  assert.equal((await oversized.actions.saveAvatarAction(nextPath)).code, "invalid");
  assert.equal(oversized.calls.updates.length, 0);

  const replaced = setup({ avatarPath: ownPath });
  assert.equal((await replaced.actions.saveAvatarAction(nextPath)).ok, true);
  assert.deepEqual(replaced.calls.updates, [{ table: "profiles", values: { avatar_path: nextPath } }]);
  assert.deepEqual(replaced.calls.removes, [ownPath]);
  assert.deepEqual(replaced.calls.lists[0].folder, actorId);

  const tampered = setup({ avatarPath: otherPath });
  assert.equal((await tampered.actions.saveAvatarAction(nextPath)).ok, true);
  assert.deepEqual(tampered.calls.removes, [], "another member's object is never deleted");

  const sameAsCurrent = setup({ avatarPath: nextPath });
  assert.equal((await sameAsCurrent.actions.saveAvatarAction(nextPath)).ok, true);
  assert.deepEqual(sameAsCurrent.calls.removes, []);
});

test("removing a photo clears the path and deletes only an object from the caller's folder", async () => {
  const withOwn = setup({ avatarPath: ownPath });
  assert.equal((await withOwn.actions.removeAvatarAction()).ok, true);
  assert.deepEqual(withOwn.calls.updates, [{ table: "profiles", values: { avatar_path: null } }]);
  assert.deepEqual(withOwn.calls.removes, [ownPath]);

  const withOther = setup({ avatarPath: otherPath });
  assert.equal((await withOther.actions.removeAvatarAction()).ok, true);
  assert.deepEqual(withOther.calls.removes, []);

  const none = setup({ avatarPath: null });
  assert.equal((await none.actions.removeAvatarAction()).ok, true);
  assert.equal(none.calls.updates.length, 0);
});

test("email changes skip identical or malformed addresses and send the confirmation link to /auth/complete", async () => {
  const fixture = setup();
  assert.equal((await fixture.actions.changeEmailAction("ana@example.org")).ok, false);
  assert.equal((await fixture.actions.changeEmailAction("no-es-correo")).ok, false);
  assert.equal(fixture.calls.updateUser.length, 0);

  const saved = await fixture.actions.changeEmailAction("Ana.Nueva@Example.org");
  assert.deepEqual(saved, { ok: true, message: "Te enviamos un enlace de confirmación. El cambio se aplica cuando lo abras." });
  assert.deepEqual(fixture.calls.updateUser, [{
    attributes: { email: "ana.nueva@example.org" },
    options: { emailRedirectTo: `${siteOrigin}/auth/complete` },
  }]);

  const taken = setup({ updateUserError: { code: "email_exists" } });
  assert.equal((await taken.actions.changeEmailAction("otra@example.org")).code, "invalid");
});

test("the reauthentication code is requested once and rate limits are explained", async () => {
  const sent = setup();
  assert.equal((await sent.actions.requestPasswordCodeAction()).ok, true);
  assert.equal(sent.calls.reauthenticate, 1);

  const limited = setup({ reauthError: { code: "over_email_send_rate_limit" } });
  const result = await limited.actions.requestPasswordCodeAction();
  assert.equal(result.ok, false);
  assert.equal(result.code, "rate_limited");
});

test("password changes need the 6-digit code, a matching confirmation, and map Auth errors to Spanish messages", async () => {
  const secret = "clave-secreta-nueva";
  const invalidInputs = [
    { code: "12345", password: secret, confirm: secret },
    { code: "123456", password: secret, confirm: `${secret}!` },
    { code: "123456", password: "corta", confirm: "corta" },
  ];
  for (const input of invalidInputs) {
    const fixture = setup();
    const result = await fixture.actions.changePasswordAction(input);
    assert.equal(result.ok, false);
    assert.equal(fixture.calls.updateUser.length, 0, "no update without a valid code and matching confirmation");
  }

  const fixture = setup();
  const saved = await fixture.actions.changePasswordAction({ code: "123456", password: secret, confirm: secret });
  assert.equal(saved.ok, true);
  assert.deepEqual(fixture.calls.updateUser, [{ attributes: { password: secret, nonce: "123456" }, options: undefined }]);
  assert.equal(JSON.stringify(saved).includes(secret), false, "the password is never echoed back");

  const mapped = {
    reauth_nonce_missing: "reauthentication_required",
    reauthentication_needed: "reauthentication_required",
    reauthentication_not_valid: "reauthentication_required",
    otp_expired: "reauthentication_required",
    weak_password: "invalid",
    same_password: "invalid",
    over_request_rate_limit: "rate_limited",
    unexpected_failure: "backend_error",
  };
  for (const [code, expected] of Object.entries(mapped)) {
    const failed = await setup({ updateUserError: { code } }).actions.changePasswordAction({ code: "123456", password: secret, confirm: secret });
    assert.equal(failed.ok, false, code);
    assert.equal(failed.code, expected, code);
    assert.equal(failed.message.includes(secret), false, code);
  }

  const pending = await setup({ requirePassword: true }).actions.changePasswordAction({ code: "123456", password: secret, confirm: secret });
  assert.equal(pending.code, "password_setup_required");
});

test("signing out everywhere ends every session and returns to sign-in", async () => {
  const fixture = setup();
  await assert.rejects(() => fixture.actions.signOutEverywhereAction(), { message: "NEXT_REDIRECT" });
  assert.deepEqual(fixture.calls.endSession, [true]);
  assert.deepEqual(fixture.calls.redirects, ["/auth/sign-in"]);
});
