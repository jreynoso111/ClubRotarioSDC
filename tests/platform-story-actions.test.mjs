import { sitePhotosModule } from "./helpers/site-photos-module.mjs";
import { mfaDependencies } from "./helpers/mfa-deps.mjs";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

// Evaluates a module the way the app bundles it; every runtime dependency must be listed explicitly.
function loadModule(path, dependencies = {}) {
  const exports = {};
  new Function("require", "exports", compile(path))(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name} from ${path}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const editorialContent = {};
new Function("exports", compile("../lib/editorial-content.ts"))(editorialContent);
const compiledActions = compile("../app/plataforma/actions.ts");
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const storyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const memberId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const uploadId = "00000000-0000-4000-8000-000000000000";
const otherUploadId = "11111111-1111-4111-8111-111111111111";
const storyUpdatedAt = "2026-10-10T12:00:00.123456+00:00";
const staleUpdatedAt = "2026-10-01T12:00:00.000000+00:00";
const staticCover = "/alcazar-colon-illustration.png";
const conflictMessage = "Otra persona modificó este texto. Recarga para ver los cambios.";
const publisherMessage = "Solo la gestión o una persona autorizada puede publicar o modificar textos publicados.";

function storyContent(overrides = {}) {
  return editorialContent.serializeEditorialContent({
    layoutId: "portada",
    body: "La jornada reunió a voluntarios y vecinos para compartir una actividad de servicio.",
    pullQuote: "El servicio empieza en comunidad.",
    inlineImagePath: `stories/${uploadId}-inline.webp`,
    inlineImageAlt: "Voluntarios preparando materiales",
    inlineImageCaption: "Preparativos de la jornada",
    coverImageAlt: "Voluntarios reunidos en la comunidad",
    ...overrides,
  });
}
const content = storyContent();

// The stored row the editor loaded; overrides model a draft, a seeded cover or a missing row.
function storyRecord(overrides = {}) {
  return {
    id: storyId, slug: "una-historia-de-servicio", status: "published", published_at: "2026-09-20T12:00:00.000Z",
    cover_image_path: null, content, updated_at: storyUpdatedAt, ...overrides,
  };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reads a PostgREST ilike pattern: % and _ are wildcards, a backslash makes the next character literal.
function likeToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") source += escapeRegExp(pattern[++index] ?? "");
    else if (char === "%") source += ".*";
    else if (char === "_") source += ".";
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`, "i");
}

function setup(role = "editor", story = storyRecord(), options = {}) {
  const writes = [];
  const queries = [];
  const invalidations = [];
  const removed = [];
  const rows = options.rows ?? [];
  const client = {
    rpc: async name => { assert.equal(name, "has_privileged_session"); return { data: true, error: null }; },
    auth: { getClaims: async () => ({ data: { claims: { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null }), mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) }, getUser: async () => ({ data: { user: { id: actorId } }, error: null }) },
    storage: {
      from(bucket) {
        assert.equal(bucket, "club-public");
        return { remove: async paths => { removed.push(...paths); return { data: [], error: null }; } };
      },
    },
    from(table) {
      const state = { table, operation: "select", value: null, filters: [], range: null, order: [], count: false };
      queries.push(state);
      const query = {
        select(_columns, selectOptions) { state.count = selectOptions?.count === "exact"; return query; },
        eq(column, value) { state.filters.push({ column, value, kind: "eq" }); return query; },
        ilike(column, value) { state.filters.push({ column, value, kind: "ilike" }); return query; },
        order(column, orderOptions) { state.order.push({ column, ascending: orderOptions?.ascending }); return query; },
        range(first, last) { state.range = { first, last }; return query; },
        insert(value) { state.operation = "insert"; state.value = value; writes.push(state); return query; },
        update(value) { state.operation = "update"; state.value = value; writes.push(state); return query; },
        delete() { state.operation = "delete"; writes.push(state); return query; },
        async maybeSingle() {
          if (table === "memberships") return { data: { membership_role: role, membership_status: "active" }, error: null };
          if (state.operation === "select") return { data: story, error: null };
          if (state.operation === "insert") return options.writeError ? { data: null, error: options.writeError } : { data: { id: storyId }, error: null };
          if (state.operation === "update") {
            if (options.writeError) return { data: null, error: options.writeError };
            return { data: options.updateMatches === false ? null : { id: storyId }, error: null };
          }
          if (state.operation === "delete") return options.deleteError ? { data: null, error: options.deleteError } : { data: { id: storyId }, error: null };
          return { data: null, error: null };
        },
        // Only the list query is awaited directly; it filters the fixture rows the way the database would.
        then(resolve, reject) {
          const matching = rows.filter(row => state.filters.every(filter => filter.kind === "ilike"
            ? likeToRegExp(filter.value).test(row[filter.column] ?? "")
            : row[filter.column] === filter.value));
          const page = state.range ? matching.slice(state.range.first, state.range.last + 1) : matching;
          return Promise.resolve({ data: page, error: null, count: matching.length }).then(resolve, reject);
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
    "@/lib/site-photos": sitePhotosModule,
    "@/utils/supabase/public-url": { toPublicSupabaseUrl },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true }, "@/lib/email": {}, "@/lib/membership-applications": {}, "@/utils/site-url": {},
    ...mfaDependencies, "@/utils/supabase/server": { createClient: async () => client },
  };
  const actions = {};
  new Function("require", "exports", compiledActions)((name) => dependencies[name], actions);
  return { actions, writes, queries, invalidations, removed };
}

// Loads the real member-access module so the role gate runs exactly as in the app.
function setupMembers({ role = "club_manager", rpcError = null } = {}) {
  const rpcCalls = [];
  const invalidations = [];
  const claims = { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] };
  const client = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "has_privileged_session") return { data: true, error: null };
      return { data: null, error: rpcError };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: actorId } }, error: null }),
      getClaims: async () => ({ data: { claims }, error: null }),
      mfa: { listFactors: async () => ({ data: { all: [], totp: [{ id: "factor" }] }, error: null }) },
    },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          return table === "memberships" ? { data: { membership_role: role, membership_status: "active" }, error: null } : { data: null, error: null };
        },
      };
      return query;
    },
  };
  const moduleAuth = loadModule("../app/plataforma/module-auth.ts", {
    "server-only": {},
    "@/lib/mfa-policy": mfaDependencies["@/lib/mfa-policy"],
    "@/lib/mfa-session": mfaDependencies["@/lib/mfa-session"],
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  });
  const members = loadModule("../app/plataforma/members-actions.ts", {
    "next/cache": { revalidatePath: path => invalidations.push(path) },
    "@/lib/email": {},
    "@/lib/account": loadModule("../lib/account.ts"),
    "@/lib/member-access": loadModule("../lib/member-access.ts"),
    "@/lib/read-every-page": loadModule("../lib/read-every-page.ts"),
    "@/utils/site-url": {},
    "./module-auth": moduleAuth,
  });
  return { members, rpcCalls, invalidations };
}

test("an editor saves a structured draft and invalidates the magazine routes", async () => {
  const { actions, writes, invalidations } = setup("editor", null);
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
  assert.equal(writes[0].operation, "insert");
  assert.equal(writes[0].value.status, "draft");
  assert.equal(writes[0].value.is_public, false);
  assert.equal(writes[0].value.published_at, null);
  assert.equal(writes[0].value.slug, "una-historia-de-servicio");
  assert.equal(writes[0].value.cover_image_path, `stories/${uploadId}-cover.jpg`);
  assert.deepEqual(invalidations, ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
});

test("only an editor can publish, and unsupported layouts or image paths never reach the database", async () => {
  const member = setup("member", null);
  assert.equal((await member.actions.createStoryAction({ title: "Historia", content, storyType: "cronica", status: "draft" })).code, "forbidden");
  assert.equal(member.writes.length, 0);

  const editor = setup("editor", null);
  const badLayout = JSON.stringify({ ...JSON.parse(content), layoutId: "freeform" });
  assert.equal((await editor.actions.createStoryAction({ title: "Historia", content: badLayout, storyType: "cronica", status: "draft" })).code, "invalid");
  assert.equal((await editor.actions.createStoryAction({ title: "Historia", content, storyType: "cronica", status: "draft", coverImagePath: "../private.jpg" })).code, "invalid");
  assert.equal((await editor.actions.createStoryAction({ title: "Historia", content, storyType: "cronica", status: "draft", coverImagePath: "https://example.com/cover.jpg" })).code, "invalid");
  assert.equal((await editor.actions.createStoryAction({ title: "Historia", content, storyType: "cronica" })).code, "invalid");
  assert.equal(editor.writes.length, 0);

  const published = await editor.actions.createStoryAction({ title: "Historia publicada", content, storyType: "cronica", status: "published" });
  assert.equal(published.ok, true);
  assert.equal(editor.writes.at(-1).value.is_public, true);
  assert.ok(editor.writes.at(-1).value.published_at, "the first publication date is stored");
});

test("publishing and returning a story to draft keep the first publication date and refresh the magazine routes", async () => {
  const { actions, writes, invalidations } = setup("editor", storyRecord());
  assert.equal((await actions.setStoryStatusAction(storyId, "published", storyUpdatedAt)).ok, true);
  assert.equal(writes[0].value.is_public, true);
  assert.equal(writes[0].value.published_at, "2026-09-20T12:00:00.000Z");
  assert.deepEqual(invalidations.slice(-4), ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
  assert.equal((await actions.setStoryStatusAction(storyId, "draft", storyUpdatedAt)).ok, true);
  assert.equal(writes[1].value.status, "draft");
  assert.equal(writes[1].value.is_public, false);
  assert.equal(writes[1].value.published_at, "2026-09-20T12:00:00.000Z");

  const draft = setup("editor", storyRecord({ status: "draft", published_at: null }));
  assert.equal((await draft.actions.setStoryStatusAction(storyId, "published", storyUpdatedAt)).ok, true);
  assert.ok(draft.writes[0].value.published_at, "publishing a never-published draft stamps the date");
});

test("a draft goes to review only; a published story or a stale draft is refused", async () => {
  const draft = setup("editor", storyRecord({ status: "draft", published_at: null }));
  assert.equal((await draft.actions.submitStoryForReviewAction(storyId, storyUpdatedAt)).ok, true);
  assert.equal(draft.writes[0].value.status, "review");
  assert.equal(draft.writes[0].value.is_public, false);

  const published = setup("editor", storyRecord());
  assert.equal((await published.actions.submitStoryForReviewAction(storyId, storyUpdatedAt)).code, "invalid");
  assert.equal(published.writes.length, 0);

  const stale = setup("editor", storyRecord({ status: "draft", published_at: null }));
  const refused = await stale.actions.submitStoryForReviewAction(storyId, staleUpdatedAt);
  assert.equal(refused.code, "conflict");
  assert.equal(refused.message, conflictMessage);
  assert.equal(stale.writes.length, 0);
});

test("editing updates the selected article while preserving its link, publication date and author", async () => {
  const { actions, writes, invalidations, queries } = setup("editor", storyRecord());
  const result = await actions.createStoryAction({
    storyId, title: "Un título actualizado", excerpt: "Resumen actualizado para la revista del club.",
    content, storyType: "noticia", status: "published", expectedUpdatedAt: storyUpdatedAt,
  });

  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, "update");
  assert.equal(writes[0].value.title, "Un título actualizado");
  assert.equal(writes[0].value.published_at, "2026-09-20T12:00:00.000Z");
  for (const key of ["author_id", "created_by", "slug"]) assert.equal(Object.hasOwn(writes[0].value, key), false, key);
  assert.ok(writes[0].filters.some(filter => filter.column === "updated_at" && filter.value === storyUpdatedAt));
  // One read of the stored row and one conditional update, both by id.
  assert.equal(queries.filter(query => query.table === "stories" && query.filters.some(filter => filter.column === "id" && filter.value === storyId)).length, 2);
  assert.deepEqual(invalidations.slice(-4), ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
});

test("a stale editor is refused without writing, and a save that loses a race says so", async () => {
  const stale = setup("editor", storyRecord());
  const outdated = await stale.actions.createStoryAction({ storyId, title: "Historia editada", content, storyType: "cronica", status: "draft", expectedUpdatedAt: staleUpdatedAt });
  assert.equal(outdated.code, "conflict");
  assert.equal(outdated.message, conflictMessage);
  assert.equal(stale.writes.length, 0);

  const raced = setup("editor", storyRecord(), { updateMatches: false });
  const lost = await raced.actions.createStoryAction({ storyId, title: "Historia editada", content, storyType: "cronica", status: "draft", expectedUpdatedAt: storyUpdatedAt });
  assert.equal(lost.code, "conflict");
  assert.equal(lost.message, conflictMessage);

  const statusRace = setup("editor", storyRecord(), { updateMatches: false });
  const statusLost = await statusRace.actions.setStoryStatusAction(storyId, "archived", storyUpdatedAt);
  assert.equal(statusLost.message, conflictMessage);

  const withoutLock = setup("editor", storyRecord());
  assert.equal((await withoutLock.actions.createStoryAction({ storyId, title: "Historia editada", content, storyType: "cronica", status: "draft" })).code, "invalid");
  assert.equal(withoutLock.writes.length, 0);
});

test("a change the database refuses for non-publishers gets the publisher message", async () => {
  const refused = { code: "42501", message: "publisher_required" };
  const editor = setup("editor", storyRecord(), { writeError: refused });
  const created = await editor.actions.createStoryAction({ storyId, title: "Historia publicada", content, storyType: "cronica", status: "published", expectedUpdatedAt: storyUpdatedAt });
  assert.equal(created.code, "forbidden");
  assert.equal(created.message, publisherMessage);

  const status = await editor.actions.setStoryStatusAction(storyId, "archived", storyUpdatedAt);
  assert.equal(status.code, "forbidden");
  assert.equal(status.message, publisherMessage);

  const deleting = setup("editor", storyRecord(), { deleteError: refused });
  const deleted = await deleting.actions.deleteStoryAction(storyId);
  assert.equal(deleted.code, "forbidden");
  assert.equal(deleted.message, publisherMessage);
  assert.equal(deleting.removed.length, 0, "no image is removed when the row was not deleted");
});

test("a duplicate slug asks for another title; other unique violations keep the generic message", async () => {
  const slugClash = setup("editor", null, {
    writeError: { code: "23505", message: 'duplicate key value violates unique constraint "stories_slug_key"', details: "Key (slug)=(una-historia-de-servicio) already exists." },
  });
  const clash = await slugClash.actions.createStoryAction({ title: "Una historia de servicio", content, storyType: "cronica", status: "draft" });
  assert.equal(clash.code, "conflict");
  assert.equal(clash.message, "Ya existe un texto con ese título; cambia el título.");

  const otherKey = setup("editor", null, {
    writeError: { code: "23505", message: 'duplicate key value violates unique constraint "stories_pkey"', details: "Key (id)=(x) already exists." },
  });
  const other = await otherKey.actions.createStoryAction({ title: "Una historia de servicio", content, storyType: "cronica", status: "draft" });
  assert.notEqual(other.message, "Ya existe un texto con ese título; cambia el título.");
});

test("the public slug never ends with a dash, even when truncation cuts at a separator", async () => {
  const { actions, writes, invalidations } = setup("editor", null);
  const title = `${"a".repeat(99)} bbbbb`;
  assert.equal((await actions.createStoryAction({ title, content, storyType: "cronica", status: "draft" })).ok, true);
  assert.equal(writes[0].value.slug, "a".repeat(99));
  assert.deepEqual(invalidations.slice(-1), [`/revista/${"a".repeat(99)}`]);

  const accented = setup("editor", null);
  assert.equal((await accented.actions.createStoryAction({ title: "Año 2026: ¡Servicio!", content, storyType: "cronica", status: "draft" })).ok, true);
  assert.equal(accented.writes[0].value.slug, "ano-2026-servicio");
});

test("deleting a story removes its bucket images after the row is gone, and never a static site asset", async () => {
  const gallery = `stories/${storyId}-gallery.jpg`;
  const withGallery = storyContent({ gallery: [{ path: gallery, alt: "Primera foto", caption: "" }] });
  const { actions, writes, removed, invalidations } = setup("editor", storyRecord({ cover_image_path: staticCover, content: withGallery }));

  const result = await actions.deleteStoryAction(storyId);
  assert.equal(result.ok, true);
  assert.equal(writes[0].operation, "delete");
  assert.deepEqual([...removed].sort(), [gallery, `stories/${uploadId}-inline.webp`].sort());
  assert.equal(removed.includes(staticCover), false);
  assert.deepEqual(invalidations.slice(-4), ["/plataforma", "/", "/revista", "/revista/una-historia-de-servicio"]);
});

test("replacing a stored photo removes the previous bucket file, while a static cover is never removed", async () => {
  const newCover = `stories/${otherUploadId}-cover.jpg`;
  const edit = { storyId, title: "Historia con foto nueva", content, storyType: "cronica", status: "published", expectedUpdatedAt: storyUpdatedAt };

  const replaced = setup("editor", storyRecord({ cover_image_path: `stories/${uploadId}-cover.jpg` }));
  assert.equal((await replaced.actions.createStoryAction({ ...edit, coverImagePath: newCover })).ok, true);
  assert.deepEqual(replaced.removed, [`stories/${uploadId}-cover.jpg`]);

  const fromStatic = setup("editor", storyRecord({ cover_image_path: staticCover }));
  assert.equal((await fromStatic.actions.createStoryAction({ ...edit, coverImagePath: newCover })).ok, true);
  assert.deepEqual(fromStatic.removed, []);

  const kept = setup("editor", storyRecord({ cover_image_path: staticCover }));
  assert.equal((await kept.actions.createStoryAction({ ...edit, coverImagePath: staticCover })).ok, true);
  assert.equal(kept.writes[0].value.cover_image_path, staticCover);
  assert.deepEqual(kept.removed, []);
});

test("the selected layout, inline photo position and ordered gallery are persisted together", async () => {
  const { actions, writes } = setup("editor", null);
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
  const rejected = await actions.createStoryAction({ title: "Historia con galería", content: editorialContent.serializeEditorialContent(invalid), storyType: "cronica", status: "draft" });
  assert.equal(rejected.code, "invalid");
  assert.equal(writes.length, 1);
});

test("the story list filters by status and section, escapes the search and clamps the page", async () => {
  const rows = Array.from({ length: 45 }, (_, index) => ({
    id: `story-${index}`, title: `Historia ${index}`, slug: `historia-${index}`, excerpt: null, content: "",
    story_type: index % 2 ? "voces" : "cronica", status: index % 3 ? "published" : "draft", is_public: index % 3 !== 0,
    published_at: null, cover_image_path: null, author_id: null, updated_at: "2026-10-10T12:00:00.000000+00:00",
  }));
  const { actions, queries } = setup("editor", null, { rows });
  const lastStoriesQuery = () => queries.filter(query => query.table === "stories").at(-1);

  const first = await actions.listStoriesAction();
  assert.equal(first.ok, true);
  assert.equal(first.total, 45, "the exact total comes from the count, not from the page");
  assert.equal(first.stories.length, 20);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 20);
  assert.deepEqual(lastStoriesQuery().range, { first: 0, last: 19 });
  assert.deepEqual(lastStoriesQuery().order.map(order => order.column), ["updated_at", "id"]);
  assert.equal(first.stories[0].updatedAt, "2026-10-10T12:00:00.000000+00:00");
  assert.equal(first.stories[0].storyType, "cronica");

  const drafts = await actions.listStoriesAction({ status: "draft", type: "cronica", page: 1 });
  assert.equal(drafts.total, rows.filter(row => row.status === "draft" && row.story_type === "cronica").length);
  assert.ok(lastStoriesQuery().filters.some(filter => filter.column === "status" && filter.value === "draft"));
  assert.ok(lastStoriesQuery().filters.some(filter => filter.column === "story_type" && filter.value === "cronica"));

  const searched = await actions.listStoriesAction({ search: "Historia 1" });
  assert.equal(searched.total, rows.filter(row => row.title.includes("Historia 1")).length);
  assert.ok(lastStoriesQuery().filters.some(filter => filter.kind === "ilike" && filter.value === "%Historia 1%"));
  // Wildcards typed by the user are literal characters, so these match nothing.
  assert.equal((await actions.listStoriesAction({ search: "%" })).total, 0);
  assert.equal((await actions.listStoriesAction({ search: "_" })).total, 0);

  const beyond = await actions.listStoriesAction({ page: 99 });
  assert.equal(beyond.ok, true);
  assert.equal(beyond.page, 3, "a page past the end falls back to the last page");
  assert.equal(beyond.stories.length, 5);

  const negative = await actions.listStoriesAction({ page: -4 });
  assert.equal(negative.page, 1);

  assert.equal((await actions.listStoriesAction({ status: "deleted" })).code, "invalid");
  assert.equal((await actions.listStoriesAction({ type: "otro_tipo" })).code, "invalid");
  assert.equal((await actions.listStoriesAction({ search: "x".repeat(121) })).code, "invalid");

  const memberView = setup("member", null, { rows });
  assert.equal((await memberView.actions.listStoriesAction()).ok, true);
});

test("only club management can grant or remove magazine publishing, and the database answer is mapped", async () => {
  for (const role of ["editor", "coordinator", "member"]) {
    const denied = setupMembers({ role });
    const refused = await denied.members.setStoryPublisherAction(memberId, true);
    assert.equal(refused.ok, false, role);
    assert.equal(refused.code, "forbidden", role);
    assert.equal(denied.rpcCalls.some(call => call.name === "set_story_publisher"), false, role);
  }

  const manager = setupMembers({ role: "club_manager" });
  const granted = await manager.members.setStoryPublisherAction(memberId, true);
  assert.equal(granted.ok, true);
  assert.deepEqual(manager.rpcCalls.at(-1), { name: "set_story_publisher", args: { _user_id: memberId, _enabled: true } });
  assert.deepEqual(manager.invalidations, ["/plataforma"]);
  assert.equal((await manager.members.setStoryPublisherAction(actorId, false)).code, "forbidden");
  assert.equal((await manager.members.setStoryPublisherAction("not-a-uuid", true)).code, "invalid");
  assert.equal((await manager.members.setStoryPublisherAction(memberId, "yes")).code, "invalid");

  const notEditor = setupMembers({ role: "admin", rpcError: { code: "22023", message: "not_editor" } });
  const rejected = await notEditor.members.setStoryPublisherAction(memberId, true);
  assert.equal(rejected.code, "invalid");
  assert.match(rejected.message, /rol de edición activo/);
});
