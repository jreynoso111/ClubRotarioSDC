import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(relativePath) {
  return ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const sitePhotos = {};
new Function("exports", compile("../lib/site-photos.ts"))(sitePhotos);
const compiledActions = compile("../app/plataforma/actions.ts");
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const oldAsset = "site-photos/membership-application/membership-service/00000000-0000-4000-8000-000000000001.jpg";
const nextAsset = "site-photos/membership-application/membership-service/00000000-0000-4000-8000-000000000002.webp";
const homeAsset = "site-photos/home/home-hero-1/00000000-0000-4000-8000-000000000003.webp";
const homeNextAsset = "site-photos/home/home-hero-1/00000000-0000-4000-8000-000000000004.png";

function setup({ role = "editor", status = "active", signedIn = true } = {}) {
  const writes = [];
  const removed = [];
  const invalidations = [];
  const slotRows = [
    { slot_key: "membership-community", display_order: 1, image_path: null, alt_text: "", caption: null, is_published: false, updated_at: "2026-09-30T12:00:00Z" },
    { slot_key: "membership-service", display_order: 2, image_path: oldAsset, alt_text: "Voluntarios colaborando", caption: "Una jornada de servicio", is_published: true, updated_at: "2026-09-30T12:00:00Z" },
    { slot_key: "membership-fellowship", display_order: 3, image_path: null, alt_text: "", caption: null, is_published: false, updated_at: "2026-09-30T12:00:00Z" },
    { slot_key: "home-hero-1", display_order: 4, image_path: homeAsset, alt_text: "Patio colonial con fuente", caption: null, is_published: true, updated_at: "2026-10-18T12:00:00Z" },
  ];
  const client = {
    rpc: async name => { assert.equal(name, "has_privileged_session"); return { data: true, error: null }; },
    auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: signedIn ? { id: actorId } : null }, error: null }) },
    from(table) {
      let operation = "select";
      let value = null;
      let slotKey = null;
      const query = {
        select(fields) { writes.push({ table, operation: "select", fields }); return query; },
        order(column, options) { writes.push({ table, operation: "order", column, options }); return query; },
        eq(column, target) { if (column === "slot_key") slotKey = target; return query; },
        update(input) { operation = "update"; value = input; writes.push({ table, operation, value }); return query; },
        async maybeSingle() {
          if (table === "memberships") return { data: { membership_role: role, membership_status: status }, error: null };
          if (operation === "update") return { data: { slot_key: slotKey }, error: null };
          return { data: { image_path: slotRows.find((row) => row.slot_key === slotKey)?.image_path ?? null }, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: slotRows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "club-public");
        return {
          getPublicUrl(path) { return { data: { publicUrl: `https://club.example/storage/${path}` } }; },
          async remove(paths) { removed.push(...paths); return { data: paths.map((path) => ({ name: path })), error: null }; },
        };
      },
    },
  };
  const dependencies = {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/lib/site-photos": sitePhotos,
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true }, "@/lib/email": {}, "@/lib/membership-applications": {}, "@/utils/site-url": {},
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", compiledActions)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, actions);
  return { actions, writes, removed, invalidations };
}

test("site photo helpers accept only approved formats and the folder of each slot", () => {
  assert.equal(sitePhotos.isSupportedSitePhotoType("image/jpeg"), true);
  assert.equal(sitePhotos.isSupportedSitePhotoType("image/svg+xml"), false);
  assert.equal(sitePhotos.sitePhotoExtension("image/webp"), "webp");
  assert.equal(sitePhotos.isSitePhotoAssetPath(nextAsset, "membership-service"), true);
  assert.equal(sitePhotos.isSitePhotoAssetPath(nextAsset, "membership-community"), false);
  assert.equal(sitePhotos.isSitePhotoAssetPath(homeAsset, "home-hero-1"), true);
  assert.equal(sitePhotos.isSitePhotoAssetPath(homeAsset, "nosotros-banner"), false);
  assert.equal(sitePhotos.isSitePhotoAssetPath(nextAsset.toUpperCase(), "membership-service"), false);
  assert.equal(sitePhotos.isSitePhotoAssetPath("../photo.webp", "membership-service"), false);
});

test("only active editors, club managers, and admins can load every photo slot", async () => {
  const editor = setup();
  const result = await editor.actions.getSitePhotoSlotsAction();
  assert.equal(result.ok, true);
  assert.equal(result.slots.length, 4);
  assert.deepEqual(result.slots.map((slot) => slot.order), [1, 2, 3, 4]);
  assert.equal(result.slots[1].imageUrl, `https://club.example/storage/${oldAsset}`);
  assert.equal(result.slots[3].key, "home-hero-1");
  assert.ok(editor.writes.some((write) =>
    write.table === "site_photo_slots" &&
    write.operation === "select" &&
    write.fields.includes("display_order")
  ));
  assert.ok(editor.writes.some((write) =>
    write.table === "site_photo_slots" &&
    write.operation === "order" &&
    write.column === "display_order" &&
    write.options?.ascending === true
  ));

  for (const input of [{ role: "member" }, { role: "admin", status: "pending" }, { signedIn: false }]) {
    const denied = setup(input);
    assert.equal((await denied.actions.getSitePhotoSlotsAction()).ok, false);
    assert.equal(denied.writes.some((write) => write.table === "site_photo_slots"), false);
  }
});

test("photo edits reject unknown slots, foreign paths, and publishing without accessible text", async () => {
  const editor = setup();
  const cases = [
    { slotKey: "membership-service", imagePath: "../cover.jpg", altText: "Una foto", caption: null, isPublished: true },
    { slotKey: "membership-service", imagePath: nextAsset, altText: " ", caption: null, isPublished: true },
    { slotKey: "home-hero-99", imagePath: homeNextAsset, altText: "Una foto", caption: null, isPublished: true },
    { slotKey: "membership-service", imagePath: homeNextAsset, altText: "Una foto", caption: null, isPublished: true },
    { slotKey: "nosotros-banner", imagePath: homeNextAsset, altText: "Una foto", caption: null, isPublished: true },
    { slotKey: "home-hero-1", imagePath: null, altText: "", caption: null, isPublished: true },
  ];
  for (const input of cases) {
    const result = await editor.actions.updateSitePhotoSlotAction(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.code, "invalid", JSON.stringify(input));
  }
  assert.equal(editor.writes.some((write) => write.table === "site_photo_slots" && write.operation === "update"), false);
});

test("authorized photo changes record the editor, clean up the replaced file, and refresh the public page", async () => {
  const { actions, writes, removed, invalidations } = setup({ role: "club_manager" });
  const result = await actions.updateSitePhotoSlotAction({
    slotKey: "membership-service",
    imagePath: nextAsset,
    altText: "Voluntarios preparando materiales",
    caption: "Preparativos para la jornada",
    isPublished: true,
  });

  assert.equal(result.ok, true);
  const update = writes.find((write) => write.table === "site_photo_slots" && write.operation === "update");
  assert.deepEqual(update.value, {
    image_path: nextAsset,
    alt_text: "Voluntarios preparando materiales",
    caption: "Preparativos para la jornada",
    is_published: true,
    updated_by: actorId,
  });
  assert.deepEqual(removed, [oldAsset]);
  assert.deepEqual(invalidations, ["/plataforma", "/solicitar-membresia"]);
});

test("a home photo is saved under its own folder and revalidates the home page", async () => {
  const { actions, writes, removed, invalidations } = setup();
  const result = await actions.updateSitePhotoSlotAction({
    slotKey: "home-hero-1",
    imagePath: homeNextAsset,
    altText: "Patio colonial con arcos",
    caption: null,
    isPublished: true,
  });

  assert.equal(result.ok, true);
  assert.equal(writes.find((write) => write.operation === "update").value.image_path, homeNextAsset);
  assert.deepEqual(removed, [homeAsset]);
  assert.deepEqual(invalidations, ["/plataforma", "/"]);
});

test("a nosotros card revalidates its page without the in-page anchor", async () => {
  const { actions, invalidations } = setup();
  const result = await actions.updateSitePhotoSlotAction({
    slotKey: "nosotros-group",
    imagePath: null,
    altText: "",
    caption: "Nuestro club · Personas de acción",
    isPublished: false,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(invalidations, ["/plataforma", "/nosotros"]);
});

test("restoring the original clears the upload, unpublishes it, and deletes the file", async () => {
  const { actions, writes, removed, invalidations } = setup();
  const result = await actions.restoreSitePhotoAction("home-hero-1");

  assert.equal(result.ok, true);
  const update = writes.find((write) => write.table === "site_photo_slots" && write.operation === "update");
  assert.deepEqual(update.value, {
    image_path: null,
    alt_text: "",
    caption: null,
    is_published: false,
    updated_by: actorId,
  });
  assert.deepEqual(removed, [homeAsset]);
  assert.deepEqual(invalidations, ["/plataforma", "/"]);
});

test("restoring is refused for unknown slots and for roles without photo editing", async () => {
  const editor = setup();
  const unknown = await editor.actions.restoreSitePhotoAction("slot-inexistente");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "invalid");

  const member = setup({ role: "member" });
  assert.equal((await member.actions.restoreSitePhotoAction("home-hero-1")).ok, false);
  assert.equal(member.writes.some((write) => write.table === "site_photo_slots"), false);
  assert.deepEqual(member.removed, []);
});

test("restoring a slot that has no upload changes nothing in storage", async () => {
  const { actions, removed } = setup();
  const result = await actions.restoreSitePhotoAction("membership-community");

  assert.equal(result.ok, true);
  assert.deepEqual(removed, []);
});
