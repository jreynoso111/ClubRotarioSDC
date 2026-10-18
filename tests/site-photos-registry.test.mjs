import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(relativePath) {
  return ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const registry = {};
new Function("exports", compile("../lib/site-photos.ts"))(registry);
const slots = registry.SITE_PHOTO_SLOTS;
const pendingIllustrations = ["club-fellowship.webp", "club-service.webp", "club-group.webp"];
const catalogueMigration = read("../supabase/migrations/20261018200000_site_photo_slots_all_pages.sql");
const membershipMigration = read("../supabase/migrations/20260930204143_membership_photo_gallery.sql");
const uuid = "0b1c2d3e-0000-4000-8000-00000000d001";

test("the catalogue has one entry per slot, with unique keys and orders inside the database limits", () => {
  const keys = slots.map((slot) => slot.key);
  const orders = slots.map((slot) => slot.order);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, [...registry.SITE_PHOTO_SLOT_KEYS]);
  assert.equal(new Set(orders).size, orders.length);
  assert.deepEqual(orders, [...orders].sort((left, right) => left - right));
  for (const order of orders) assert.ok(order >= 1 && order <= 50, String(order));
});

test("the database lists every slot key and order, so it rejects anything else", () => {
  for (const slot of slots) {
    assert.match(catalogueMigration, new RegExp(`'${slot.key}'`), `${slot.key} is missing from the key check`);
    const insertedHere = catalogueMigration.includes(`('${slot.key}', ${slot.order})`);
    const insertedBefore = membershipMigration.includes(`('${slot.key}', ${slot.order})`);
    assert.ok(insertedHere || insertedBefore, `${slot.key} has no matching display_order in the migrations`);
  }
});

test("each slot belongs to a known page section, and the home page keeps six hero photos", () => {
  for (const slot of slots) assert.ok(registry.SITE_PHOTO_SECTION_KEYS.includes(slot.section), slot.key);
  assert.deepEqual(
    slots.filter((slot) => slot.section === "home").map((slot) => slot.key),
    ["home-hero-1", "home-hero-2", "home-hero-3", "home-hero-4", "home-hero-5", "home-hero-6"],
  );
  for (const section of registry.SITE_PHOTO_SECTION_KEYS) {
    assert.ok(slots.some((slot) => slot.section === section), `${section} has no slot`);
  }
});

test("each slot links to its place on the public site and keeps the page path for revalidation", () => {
  const expectedPaths = {
    "home-hero-1": "/",
    "nosotros-banner": "/nosotros",
    "nosotros-group": "/nosotros",
    "eventos-banner": "/eventos",
    "revista-banner": "/revista",
    "membership-service": "/solicitar-membresia",
  };
  for (const slot of slots) {
    assert.ok(slot.pageHref.startsWith("/"), slot.key);
    assert.match(slot.where, /\S/, slot.key);
    assert.match(slot.title, /\S/, slot.key);
  }
  for (const [key, path] of Object.entries(expectedPaths)) {
    assert.equal(registry.sitePhotoPagePath(key), path, key);
  }
});

test("every default image exists in public/, except the three illustrations still being created", () => {
  const publicDir = new URL("../public/", import.meta.url);
  for (const slot of slots) {
    assert.ok(slot.defaultImage.startsWith("/"), slot.key);
    const file = slot.defaultImage.slice(1);
    if (pendingIllustrations.includes(file)) continue;
    assert.ok(existsSync(new URL(file, publicDir)), `${slot.defaultImage} is missing from public/`);
  }
  const pending = slots.map((slot) => slot.defaultImage.slice(1)).filter((file) => pendingIllustrations.includes(file));
  assert.deepEqual([...new Set(pending)].sort(), [...pendingIllustrations].sort());
});

test("default alt texts are meaningful Spanish descriptions within the database limit", () => {
  for (const slot of slots) {
    assert.match(slot.defaultAlt, /\S/, slot.key);
    assert.ok(slot.defaultAlt.length <= 250, slot.key);
  }
  for (const key of ["home-hero-1", "home-hero-6", "nosotros-banner", "eventos-banner", "revista-banner"]) {
    assert.match(slots.find((slot) => slot.key === key).defaultAlt, /Ilustración|Alcázar|Fortaleza|Foto/, key);
  }
});

test("the nosotros life photos carry the agreed captions by default", () => {
  const captions = Object.fromEntries(slots.filter((slot) => slot.section === "nosotros" && slot.hasCaption)
    .map((slot) => [slot.key, slot.defaultCaption]));
  assert.deepEqual(captions, {
    "nosotros-fellowship": "Compañerismo · Encuentros que fortalecen la amistad entre socios.",
    "nosotros-service": "Servicio · Proyectos que responden a necesidades reales de la comunidad.",
    "nosotros-group": "Nuestro club · Personas de acción unidas por el ideal de servir.",
  });
});

test("storage paths are built per slot section and only accept the slot's own folder", () => {
  assert.equal(
    registry.sitePhotoAssetPath("home-hero-1", uuid, "webp"),
    `site-photos/home/home-hero-1/${uuid}.webp`,
  );
  assert.equal(
    registry.sitePhotoAssetPath("membership-service", uuid, "jpg"),
    `site-photos/membership-application/membership-service/${uuid}.jpg`,
  );
  assert.equal(registry.isSitePhotoAssetPath(`site-photos/nosotros/nosotros-group/${uuid}.png`, "nosotros-group"), true);
  assert.equal(registry.isSitePhotoAssetPath(`site-photos/home/nosotros-group/${uuid}.png`, "nosotros-group"), false);
  assert.equal(registry.isSitePhotoAssetPath(`site-photos/nosotros/nosotros-group/${uuid}.gif`, "nosotros-group"), false);
  assert.equal(registry.isSitePhotoAssetPath(`stories/nosotros/nosotros-group/${uuid}.png`, "nosotros-group"), false);
  assert.equal(registry.isSitePhotoAssetPath(null, "nosotros-group"), false);
});

test("the platform groups photos by page in catalogue order, with the expected counts", () => {
  const groups = registry.groupSitePhotoSlots(registry.emptySitePhotoSlots());
  assert.deepEqual(groups.map((group) => group.section), ["home", "nosotros", "eventos", "revista", "membership-application"]);
  assert.deepEqual(groups.map((group) => group.slots.length), [6, 4, 1, 1, 3]);
  assert.equal(groups.find((group) => group.section === "home").label, "Inicio");
  for (const group of groups) assert.ok(group.slots.every((slot) => slot.section === group.section), group.section);
});

test("every aspect hint has a label for the platform", () => {
  for (const slot of slots) assert.ok(registry.SITE_PHOTO_ASPECT_LABELS[slot.aspect], slot.key);
});

test("the public pages read the photo slots instead of hard-coded images", () => {
  const home = read("../app/page.tsx");
  assert.match(home, /getSitePhotos/);
  assert.doesNotMatch(home, /heroIllustrations/);
  assert.doesNotMatch(read("../app/globals.css"), /hero-art-image-6/);

  const nosotros = read("../app/nosotros/page.tsx");
  assert.match(nosotros, /La vida del club/);
  assert.match(nosotros, /id="vida-del-club"/);
  assert.doesNotMatch(nosotros, /fotografías, presidentes/);

  for (const path of ["../app/eventos/page.tsx", "../app/revista/page.tsx", "../app/solicitar-membresia/page.tsx"]) {
    assert.match(read(path), /getSitePhotos/, path);
  }
  assert.doesNotMatch(read("../app/solicitar-membresia/page.tsx"), /Espacio para fotografía/);
});
