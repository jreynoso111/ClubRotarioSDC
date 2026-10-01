import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const editorialContent = {};
new Function("exports", compile("../lib/editorial-content.ts"))(editorialContent);
const compiledActions = compile("../app/plataforma/actions.ts");
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const storyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uploadId = "00000000-0000-4000-8000-000000000000";
const content = editorialContent.serializeEditorialContent({
  layoutId: "portada",
  body: "La jornada reunió a voluntarios y vecinos para compartir una actividad de servicio.",
  pullQuote: "El servicio empieza en comunidad.",
  inlineImagePath: `stories/${uploadId}-inline.webp`,
  inlineImageAlt: "Voluntarios preparando materiales",
  inlineImageCaption: "Preparativos de la jornada",
  coverImageAlt: "Voluntarios reunidos en la comunidad",
});

function setup(role = "editor", storyRecord = { id: storyId, slug: "una-historia-de-servicio", published_at: "2026-09-20T12:00:00.000Z", cover_image_path: null }) {
  const writes = [];
  const invalidations = [];
  const filters = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    from(table) {
      const query = {
        select() { return query; },
        eq(column, value) { filters.push({ table, column, value }); return query; },
        insert(value) { writes.push({ table, operation: "insert", value }); return query; },
        update(value) { writes.push({ table, operation: "update", value }); return query; },
        async maybeSingle() {
          if (table === "memberships") return { data: { membership_role: role, membership_status: "active" }, error: null };
          return { data: storyRecord, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    "./members-actions": { updateMemberAccessAction: async () => { throw new Error("Membership access is outside this harness."); } },
    "next/cache": { revalidatePath: (path) => invalidations.push(path) },
    "@/lib/platform": { isMissingSchemaError: () => false },
    "@/lib/audit": { auditCursorFilter() {}, auditPageCursor() {}, defaultAuditSort: {}, normalizeAuditQuery() {} },
    "@/lib/editorial-content": editorialContent,
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", compiledActions)((name) => dependencies[name], actions);
  return { actions, writes, invalidations, filters };
}

test("an editor saves a structured draft and invalidates the magazine routes", async () => {
  const { actions, writes, invalidations } = setup();
  const result = await actions.createStoryAction({
    title: "Una historia de servicio",
    excerpt: "Una jornada que reunió a la comunidad alrededor del servicio.",
    content,
    storyType: "cronica",
    status: "draft",
    coverImagePath: `stories/${uploadId}-cover.jpg`,
  });

  assert.equal(result.ok, true);
  assert.equal(writes[0].table, "stories");
  assert.equal(writes[0].value.status, "draft");
  assert.equal(writes[0].value.is_public, false);
  assert.equal(writes[0].value.cover_image_path, `stories/${uploadId}-cover.jpg`);
  assert.deepEqual(invalidations, ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
});

test("only an editor can publish, and unsupported layouts or image paths never reach the database", async () => {
  const member = setup("member");
  assert.equal((await member.actions.createStoryAction({ title: "Historia", content, storyType: "cronica", status: "draft" })).code, "forbidden");
  assert.equal(member.writes.some((write) => write.table === "stories"), false);

  const editor = setup();
  const badLayout = JSON.stringify({ ...JSON.parse(content), layoutId: "freeform" });
  assert.equal((await editor.actions.createStoryAction({ title: "Historia", content: badLayout, storyType: "cronica" })).code, "invalid");
  assert.equal((await editor.actions.createStoryAction({ title: "Historia", content, storyType: "cronica", coverImagePath: "../private.jpg" })).code, "invalid");
  assert.equal(editor.writes.some((write) => write.table === "stories"), false);

  const published = await editor.actions.createStoryAction({ title: "Historia publicada", content, storyType: "cronica", status: "published", isPublic: true });
  assert.equal(published.ok, true);
  assert.equal(editor.writes.at(-1).value.is_public, true);
});

test("publishing and returning a story to draft refresh the public index and detail route", async () => {
  const { actions, writes, invalidations } = setup();
  assert.equal((await actions.setStoryPublicationAction(storyId, true)).ok, true);
  assert.equal(writes[0].value.is_public, true);
  assert.deepEqual(invalidations.slice(-4), ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
  assert.equal((await actions.setStoryPublicationAction(storyId, false)).ok, true);
  assert.equal(writes[1].value.status, "draft");
});

test("editing updates the selected article while preserving its link, publication date and author", async () => {
  const { actions, writes, invalidations, filters } = setup();
  const result = await actions.createStoryAction({
    storyId, title: "Un título actualizado", excerpt: "Resumen actualizado para la revista del club.",
    content, storyType: "noticia", status: "published", isPublic: true,
  });

  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, "update");
  assert.equal(writes[0].value.title, "Un título actualizado");
  assert.equal(writes[0].value.published_at, "2026-09-20T12:00:00.000Z");
  assert.equal(Object.hasOwn(writes[0].value, "author_id"), false);
  assert.equal(Object.hasOwn(writes[0].value, "created_by"), false);
  assert.equal(Object.hasOwn(writes[0].value, "slug"), false);
  assert.equal(filters.filter((filter) => filter.table === "stories" && filter.column === "id" && filter.value === storyId).length, 2);
  assert.deepEqual(invalidations.slice(-4), ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
});

test("an existing cover can be retained; invalid or unavailable edit targets never write", async () => {
  const originalCover = "https://example.com/current-cover.jpg";
  const { actions, writes } = setup("editor", { id: storyId, slug: "historia", published_at: null, cover_image_path: originalCover });
  assert.equal((await actions.createStoryAction({ storyId, title: "Historia editada", content, storyType: "cronica", coverImagePath: originalCover })).ok, true);
  assert.equal(writes[0].value.cover_image_path, originalCover);
  assert.equal((await actions.createStoryAction({ storyId, title: "Historia editada", content, storyType: "cronica", coverImagePath: "https://example.com/another.jpg" })).code, "invalid");
  assert.equal((await actions.createStoryAction({ storyId: "not-an-id", title: "Historia editada", content, storyType: "cronica" })).code, "invalid");
  assert.equal(writes.length, 1);

  const unavailable = setup("editor", null);
  assert.equal((await unavailable.actions.createStoryAction({ storyId, title: "Historia editada", content, storyType: "cronica" })).code, "invalid");
  assert.equal(unavailable.writes.length, 0);
});

test("the selected layout, inline photo position and ordered gallery are persisted together", async () => {
  const { actions, writes } = setup();
  const document = editorialContent.parseEditorialContent(content);
  document.inlineImageAfterParagraph = 0;
  document.inlineImageAlignment = "left";
  document.gallery = [
    { path: `stories/${storyId}-gallery.jpg`, alt: "Primera foto", caption: "Inicio de la jornada" },
    { path: `stories/${uploadId}-gallery.webp`, alt: "Segunda foto", caption: "" },
  ];
  const result = await actions.createStoryAction({ title: "Historia con galería", content: editorialContent.serializeEditorialContent(document), storyType: "cronica", status: "draft" });
  assert.equal(result.ok, true);
  assert.deepEqual(editorialContent.parseEditorialContent(writes[0].value.content), document);

  const invalid = { ...document, gallery: [{ ...document.gallery[0], path: "../private.jpg" }] };
  const rejected = await actions.createStoryAction({ title: "Historia con galería", content: editorialContent.serializeEditorialContent(invalid), storyType: "cronica" });
  assert.equal(rejected.code, "invalid");
  assert.equal(writes.length, 1);
});
