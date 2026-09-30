import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(relativePath) {
  return ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const photoHelpers = {};
new Function("exports", compile("../lib/site-photos.ts"))(photoHelpers);
const compiledActions = compile("../app/plataforma/actions.ts");
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const oldAsset = "site-photos/membership-application/membership-service/00000000-0000-4000-8000-000000000001.jpg";
const nextAsset = "site-photos/membership-application/membership-service/00000000-0000-4000-8000-000000000002.webp";

function setup({ role = "editor", status = "active", signedIn = true } = {}) {
  const writes = [];
  const removed = [];
  const invalidations = [];
  const slotRows = [
    { slot_key: "membership-community", display_order: 1, image_path: null, alt_text: "", caption: null, is_published: false, updated_at: "2026-09-30T12:00:00Z" },
    { slot_key: "membership-service", display_order: 2, image_path: oldAsset, alt_text: "Voluntarios colaborando", caption: "Una jornada de servicio", is_published: true, updated_at: "2026-09-30T12:00:00Z" },
    { slot_key: "membership-fellowship", display_order: 3, image_path: null, alt_text: "", caption: null, is_published: false, updated_at: "2026-09-30T12:00:00Z" },
  ];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: actorId } : null }, error: null }) },
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
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": { isStoryAssetPath() { return true; }, parseEditorialContent() { return null; } },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", compiledActions)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, actions);
  return { actions, writes, removed, invalidations };
}

test("photo slot validation accepts only approved image formats and a slot-specific UUID path", () => {
  assert.equal(photoHelpers.isSupportedMembershipPhotoType("image/jpeg"), true);
  assert.equal(photoHelpers.isSupportedMembershipPhotoType("image/svg+xml"), false);
  assert.equal(photoHelpers.membershipPhotoExtension("image/webp"), "webp");
  assert.equal(photoHelpers.isMembershipPhotoAssetPath(nextAsset, "membership-service"), true);
  assert.equal(photoHelpers.isMembershipPhotoAssetPath(nextAsset, "membership-community"), false);
  assert.equal(photoHelpers.isMembershipPhotoAssetPath("../photo.webp", "membership-service"), false);
});

test("only active editors, club managers, and admins can load unpublished photo slots", async () => {
  const editor = setup();
  const result = await editor.actions.getMembershipPhotoSlotsAction();
  assert.equal(result.ok, true);
  assert.equal(result.slots.length, 3);
  assert.deepEqual(result.slots.map((slot) => slot.order), [1, 2, 3]);
  assert.equal(result.slots[1].imageUrl, `https://club.example/storage/${oldAsset}`);
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
    assert.equal((await denied.actions.getMembershipPhotoSlotsAction()).ok, false);
    assert.equal(denied.writes.some((write) => write.table === "site_photo_slots"), false);
  }
});

test("photo edits reject untrusted paths and publishing without accessible image text", async () => {
  const editor = setup();
  const badPath = await editor.actions.updateMembershipPhotoSlotAction({
    slotKey: "membership-service",
    imagePath: "../cover.jpg",
    altText: "Una foto",
    caption: null,
    isPublished: true,
  });
  const missingAlt = await editor.actions.updateMembershipPhotoSlotAction({
    slotKey: "membership-service",
    imagePath: nextAsset,
    altText: " ",
    caption: null,
    isPublished: true,
  });

  assert.equal(badPath.code, "invalid");
  assert.equal(missingAlt.code, "invalid");
  assert.equal(editor.writes.some((write) => write.table === "site_photo_slots" && write.operation === "update"), false);
});

test("authorized photo changes record the editor, clean up the replaced file, and refresh the public page", async () => {
  const { actions, writes, removed, invalidations } = setup({ role: "club_manager" });
  const result = await actions.updateMembershipPhotoSlotAction({
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
