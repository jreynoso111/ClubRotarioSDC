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

const origin = "https://www.clubrotariosdcolonial.org";
const staticPaths = ["/", "/revista", "/eventos", "/nosotros", "/solicitar-membresia"];

function loadSitemap({ stories = [], events = [], storiesError, eventsError } = {}) {
  return loadTypeScript("../app/sitemap.ts", {
    "next/server": { connection: async () => {} },
    "@/lib/editorial": {
      getPublicStories: async () => {
        if (storiesError) throw storiesError;
        return stories;
      },
      getPublicEvents: async () => {
        if (eventsError) throw eventsError;
        return events;
      },
    },
    "@/utils/site-url": { getPublicSiteOrigin: () => origin },
  }).default;
}

test("the sitemap lists public pages, published stories and public events, and never the platform", async () => {
  const sitemap = loadSitemap({
    stories: [
      { slug: "brigada-de-servicio", updatedAt: "2026-10-10T12:00:00.000Z", publishedAt: "2026-10-01T12:00:00.000Z" },
      { slug: "sin-fecha", updatedAt: null, publishedAt: null },
    ],
    events: [{ slug: "encuentro-de-otono", updatedAt: "2026-10-05T09:00:00.000Z" }],
  });
  const entries = await sitemap();
  const urls = entries.map((entry) => entry.url);

  for (const path of [...staticPaths, "/revista/brigada-de-servicio", "/revista/sin-fecha", "/eventos/encuentro-de-otono"]) {
    assert.ok(urls.includes(`${origin}${path}`), `missing ${path}`);
  }
  assert.equal(entries.find((entry) => entry.url === `${origin}/revista/brigada-de-servicio`).lastModified, "2026-10-10T12:00:00.000Z");
  assert.equal(entries.find((entry) => entry.url === `${origin}/revista/sin-fecha`).lastModified, undefined);
  assert.equal(urls.some((url) => /\/(plataforma|auth|api)(\/|$)/.test(url)), false);
});

test("the sitemap keeps the static pages when the content store fails", async () => {
  const sitemap = loadSitemap({ storiesError: new Error("down"), eventsError: new Error("down") });
  const urls = (await sitemap()).map((entry) => entry.url);
  assert.deepEqual(urls, staticPaths.map((path) => `${origin}${path}`));
});

test("robots allow the public site, block member and API routes, and point to the sitemap", () => {
  const robots = loadTypeScript("../app/robots.ts", {
    "@/utils/site-url": { getPublicSiteOrigin: () => origin },
  }).default;

  assert.deepEqual(robots(), {
    rules: { userAgent: "*", allow: "/", disallow: ["/plataforma", "/auth", "/api"] },
    sitemap: `${origin}/sitemap.xml`,
  });
});
