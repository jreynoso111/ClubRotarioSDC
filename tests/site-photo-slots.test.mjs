import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(relativePath, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name} from ${relativePath}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const registry = load("../lib/site-photos.ts", {});
const timeout = load("../lib/supabase/timeout.ts", {});
const storageBase = "https://project.supabase.co/storage/v1/object/public/club-public/";
const validHeroPath = "site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000e001.webp";
const validGroupPath = "site-photos/nosotros/nosotros-group/0b1c2d3e-0000-4000-8000-00000000e002.jpg";
const validEventPath = "site-photos/eventos/eventos-banner/0b1c2d3e-0000-4000-8000-00000000e003.webp";

function reader({ configured = true, rows = [], error = null, createThrows = false, hangs = false } = {}) {
  let cacheCalls = 0;
  const client = {
    from(table) {
      assert.equal(table, "site_photo_slots");
      return {
        select(fields) {
          assert.equal(fields, "slot_key,image_path,alt_text,caption,is_published");
          return {
            eq(column, value) {
              assert.equal(column, "is_published");
              assert.equal(value, true);
              if (hangs) return new Promise(() => {});
              return Promise.resolve({ data: rows, error });
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "club-public");
        return { getPublicUrl: (path) => ({ data: { publicUrl: storageBase + path } }) };
      },
    },
  };
  const exports = load("../lib/site-photo-slots.ts", {
    "server-only": {},
    react: { cache: (fn) => { cacheCalls += 1; return fn; } },
    "@/lib/supabase/timeout": timeout,
    "@/utils/supabase/config": { isSupabaseConfigured: () => configured },
    "@/utils/supabase/public-url": { toPublicSupabaseUrl: (url) => url },
    "@/utils/supabase/server": {
      createClient: async () => {
        if (createThrows) throw new Error("Supabase unavailable");
        return client;
      },
    },
    "./site-photos": registry,
  });
  return { getSitePhotos: exports.getSitePhotos, cacheCalls: () => cacheCalls };
}

function assertOriginals(photos) {
  assert.equal(Object.keys(photos).length, registry.SITE_PHOTO_SLOTS.length);
  for (const slot of registry.SITE_PHOTO_SLOTS) {
    assert.deepEqual(photos[slot.key], {
      url: slot.defaultImage,
      alt: slot.defaultAlt,
      caption: null,
      isCustom: false,
    }, slot.key);
  }
}

test("without Supabase, every slot shows its original image and description", async () => {
  assertOriginals(await reader({ configured: false }).getSitePhotos());
});

test("a failed read or an unavailable backend falls back to the originals", async () => {
  assertOriginals(await reader({ error: { message: "boom" } }).getSitePhotos());
  assertOriginals(await reader({ createThrows: true }).getSitePhotos());
});

test("a slow backend stops waiting after the public timeout and shows the originals", async () => {
  assert.equal(timeout.PUBLIC_CONTENT_TIMEOUT_MS, 3000);
  assertOriginals(await reader({ hangs: true }).getSitePhotos());
});

test("published uploads replace the original with their storage URL, description and caption", async () => {
  const photos = await reader({
    rows: [
      { slot_key: "home-hero-1", image_path: validHeroPath, alt_text: "  Patio con fuente  ", caption: null, is_published: true },
      { slot_key: "nosotros-group", image_path: validGroupPath, alt_text: "Socios en la sede", caption: "  Foto del 2026  ", is_published: true },
    ],
  }).getSitePhotos();

  assert.deepEqual(photos["home-hero-1"], {
    url: storageBase + validHeroPath,
    alt: "Patio con fuente",
    caption: null,
    isCustom: true,
  });
  assert.deepEqual(photos["nosotros-group"], {
    url: storageBase + validGroupPath,
    alt: "Socios en la sede",
    caption: "Foto del 2026",
    isCustom: true,
  });
  assert.equal(photos["home-hero-2"].isCustom, false);
});

test("an upload without a description keeps the original description", async () => {
  const photos = await reader({
    rows: [{ slot_key: "eventos-banner", image_path: validEventPath, alt_text: "   ", caption: null, is_published: true }],
  }).getSitePhotos();

  assert.equal(photos["eventos-banner"].isCustom, true);
  assert.equal(photos["eventos-banner"].alt, registry.SITE_PHOTO_SLOTS.find((slot) => slot.key === "eventos-banner").defaultAlt);
});

test("unpublished, misfiled, unknown and external rows never reach the public page", async () => {
  const photos = await reader({
    rows: [
      { slot_key: "eventos-banner", image_path: validEventPath, alt_text: "Borrador", caption: null, is_published: false },
      { slot_key: "revista-banner", image_path: "site-photos/home/revista-banner/0b1c2d3e-0000-4000-8000-00000000e004.webp", alt_text: "Mal guardada", caption: null, is_published: true },
      { slot_key: "slot-desconocido", image_path: "site-photos/home/slot-desconocido/0b1c2d3e-0000-4000-8000-00000000e005.webp", alt_text: "Desconocida", caption: null, is_published: true },
      { slot_key: "membership-community", image_path: "https://evil.example/x.jpg", alt_text: "Externa", caption: null, is_published: true },
    ],
  }).getSitePhotos();

  assertOriginals(photos);
});

test("the public reader is wrapped in React's per-request cache", () => {
  assert.equal(reader().cacheCalls(), 1);
});
