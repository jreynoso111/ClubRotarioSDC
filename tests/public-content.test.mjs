import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTypeScript(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name} from ${relativePath}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const storageBase = "https://project.supabase.co/storage/v1/object/public/club-public/";

// Resolves the stubbed query when awaited, like the Supabase query builder does.
function queryBuilder(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    maybeSingle: () => builder,
    then(resolve, reject) {
      const value = typeof result === "function" ? result() : result;
      return Promise.resolve(value).then(resolve, reject);
    },
  };
  return builder;
}

function storageClient() {
  return { storage: { from: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: `${storageBase}${path}` } }) }) } };
}

function loadPublicContent({ configured = true, tables = {} } = {}) {
  const supabase = {
    ...storageClient(),
    from: (table) => queryBuilder(tables[table] ?? { data: [], error: null }),
  };
  const config = { isSupabaseConfigured: () => configured };
  const timeout = loadTypeScript("../lib/supabase/timeout.ts");
  const editorial = loadTypeScript("../lib/editorial.ts", {
    "server-only": {},
    react: { cache: (fn) => fn },
    "@/utils/supabase/config": config,
    "@/utils/supabase/public-url": { toPublicSupabaseUrl: (url) => url },
    "@/utils/supabase/server": { createClient: async () => supabase },
    "@/lib/editorial-content": loadTypeScript("../lib/editorial-content.ts"),
    "@/lib/supabase/timeout": timeout,
  });
  const feed = loadTypeScript("../lib/supabase/public-feed.ts", {
    "server-only": {},
    "@/lib/editorial": editorial,
    "@/utils/supabase/config": config,
    "@/utils/supabase/server": { createClient: async () => supabase },
    "./timeout": timeout,
  });
  return { editorial, feed, timeout };
}

const storyRow = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Brigada de servicio en la Ciudad Colonial",
  slug: "brigada-de-servicio",
  excerpt: "Una jornada de servicio con vecinos y voluntarios.",
  content: "Primer párrafo de la crónica.\n\nSegundo párrafo.",
  story_type: "cronica",
  published_at: "2026-10-01T12:00:00.000Z",
  updated_at: "2026-10-10T12:00:00.000Z",
  cover_image_path: "stories/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-cover.webp",
};

test("story images keep static site assets and club storage paths, and refuse other hosts", () => {
  const { editorial } = loadPublicContent();
  const supabase = storageClient();

  assert.equal(editorial.publicImageUrl(supabase, "/alcazar-colon-illustration.png"), "/alcazar-colon-illustration.png");
  assert.equal(
    editorial.publicImageUrl(supabase, "stories/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-cover.webp"),
    `${storageBase}stories/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-cover.webp`,
  );
  for (const value of [
    "https://evil.example/x.png",
    "http://evil.example/x.png",
    "//evil.example/x.png",
    "javascript:alert(1)",
    "stories/../secret.png",
    "/a\\b.png",
    "site-photos/x.png",
    "",
    null,
    undefined,
  ]) {
    assert.equal(editorial.publicImageUrl(supabase, value), null, String(value));
  }
});

test("the public home feed shows only published stories and never a sample card", async () => {
  assert.deepEqual(await loadPublicContent({ configured: false }).feed.getPublicFeed(), { events: [], stories: [] });

  const failing = loadPublicContent({ tables: { stories: { data: null, error: { message: "down" } } } });
  assert.deepEqual(await failing.feed.getPublicFeed(), { events: [], stories: [] });

  const { feed } = loadPublicContent({ tables: { stories: { data: [storyRow], error: null } } });
  const { stories } = await feed.getPublicFeed();
  assert.deepEqual(
    stories.map((story) => ({ href: story.href, image: story.image })),
    [{ href: "/revista/brigada-de-servicio", image: `${storageBase}${storyRow.cover_image_path}` }],
  );
});

test("the revista archive renders empty, not with sample stories, when the store is unavailable", async () => {
  const { editorial } = loadPublicContent({ tables: { stories: { data: null, error: { message: "down" } } } });
  assert.deepEqual(await editorial.getPublicStoriesPage(1, 9), { stories: [], total: 0, page: 1, pageSize: 9 });
  assert.deepEqual(await editorial.getPublicStories(4), []);

  const empty = loadPublicContent({ tables: { stories: { data: [], error: null } } }).editorial;
  assert.deepEqual(await empty.getPublicStoriesPage(1, 9), { stories: [], total: 0, page: 1, pageSize: 9 });
});

test("a story detail returns null only for a successful lookup without a row", async () => {
  const { editorial } = loadPublicContent({ tables: { stories: { data: null, error: null } } });
  assert.equal(await editorial.getPublicStory("no-existe"), null);

  const { editorial: found } = loadPublicContent({ tables: { stories: { data: storyRow, error: null } } });
  const story = await found.getPublicStory(storyRow.slug);
  assert.equal(story.title, storyRow.title);
  assert.equal(story.updatedAt, storyRow.updated_at);
  assert.equal(story.coverImageUrl, `${storageBase}${storyRow.cover_image_path}`);
});

test("a failed or unconfigured story read throws so it is never reported as a 404", async () => {
  const failing = loadPublicContent({ tables: { stories: { data: null, error: { message: "permission denied" } } } });
  await assert.rejects(failing.editorial.getPublicStory("brigada-de-servicio"), { name: "PublicContentUnavailableError" });

  const unconfigured = loadPublicContent({ configured: false });
  await assert.rejects(unconfigured.editorial.getPublicStory("brigada-de-servicio"), { name: "PublicContentUnavailableError" });
});

test("a slow story read rejects after the public timeout of three seconds", async () => {
  const { editorial, timeout } = loadPublicContent({ tables: { stories: () => new Promise(() => {}) } });
  assert.equal(timeout.PUBLIC_CONTENT_TIMEOUT_MS, 3000);
  await assert.rejects(editorial.getPublicStory("brigada-de-servicio"), { name: "PublicContentUnavailableError" });
});

test("list reads keep their fallback while detail reads reject on timeout", async () => {
  const timeout = loadTypeScript("../lib/supabase/timeout.ts");
  assert.equal(await timeout.withPublicContentTimeout(new Promise(() => {}), "fallback", 5), "fallback");
  await assert.rejects(timeout.awaitPublicContent(new Promise(() => {}), 5), { name: "PublicContentUnavailableError" });
  assert.equal(await timeout.awaitPublicContent(Promise.resolve("ok"), 5), "ok");
});

test("the hard-coded guide and sample stories are gone from the public content modules", () => {
  const forbidden = /editorialGuides|getEditorialGuides|publicación de prueba|fallbackStories|Ejemplo editorial|generateStaticParams/;
  for (const path of [
    "../lib/editorial.ts",
    "../lib/supabase/public-feed.ts",
    "../app/revista/page.tsx",
    "../app/revista/[slug]/page.tsx",
    "../app/page.tsx",
  ]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), forbidden, path);
  }
});
