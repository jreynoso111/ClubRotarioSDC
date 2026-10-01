import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/editorial-content.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const editorial = {};
new Function("exports", compiled)(editorial);

const uploadId = "00000000-0000-4000-8000-000000000000";
const article = {
  layoutId: "cronica-visual",
  body: "La comunidad se reunió.\n\nEl equipo acordó próximos pasos.",
  pullQuote: "Servir empieza por escuchar.",
  inlineImagePath: `stories/${uploadId}-inline.webp`,
  inlineImageAlt: "Voluntarios preparando la jornada",
  inlineImageCaption: "Preparativos en la Ciudad Colonial",
  inlineImageAfterParagraph: 1,
  inlineImageAlignment: "right",
  gallery: [{ path: `stories/${uploadId}-gallery.webp`, alt: "Voluntarios y vecinos en la jornada", caption: "Una jornada compartida" }],
  coverImageAlt: "Equipo rotario en una actividad de servicio",
};

test("the three editorial layouts serialize and round-trip with their image and text slots", () => {
  assert.deepEqual(editorial.editorialLayouts.map(({ id }) => id), ["portada", "cronica-visual", "voces"]);
  assert.deepEqual(editorial.parseEditorialContent(editorial.serializeEditorialContent(article)), article);
});

test("legacy plain text and unsafe or incomplete editorial documents are rejected as layouts", () => {
  assert.equal(editorial.parseEditorialContent("Una historia anterior en texto plano."), null);
  assert.equal(editorial.parseEditorialContent(JSON.stringify({ ...article, layoutId: "otro" })), null);
  assert.equal(editorial.parseEditorialContent(JSON.stringify({ ...article, inlineImagePath: "../private.svg" })), null);
  assert.equal(editorial.parseEditorialContent(JSON.stringify({ ...article, body: " " })), null);
});

test("story uploads accept only the generated story image paths", () => {
  assert.equal(editorial.isStoryAssetPath(`stories/${uploadId}-cover.jpg`), true);
  assert.equal(editorial.isStoryAssetPath(`stories/${uploadId}-gallery.jpg`), true);
  assert.equal(editorial.isStoryAssetPath("stories/../../other-user.png"), false);
  assert.equal(editorial.isStoryAssetPath("https://example.com/image.jpg"), false);
});

test("version 1 articles keep their original image placement and acquire an empty gallery", () => {
  const legacy = structuredClone(article);
  delete legacy.gallery;
  delete legacy.inlineImageAfterParagraph;
  delete legacy.inlineImageAlignment;
  const parsed = editorial.parseEditorialContent(JSON.stringify({ ...legacy, format: "club-editorial", version: 1 }));
  assert.deepEqual(parsed, { ...legacy, gallery: [], inlineImageAfterParagraph: -1, inlineImageAlignment: "wide" });
  assert.equal(editorial.getInlineImageInsertionIndex(parsed, 4), 2);
  assert.equal(editorial.getInlineImageInsertionIndex({ ...parsed, layoutId: "portada" }, 4), 4);
  assert.equal(JSON.parse(editorial.serializeEditorialContent(parsed)).version, 2);
});

test("version 2 validates gallery paths, accessible descriptions, duplicates, count and image placement", () => {
  const serialized = JSON.parse(editorial.serializeEditorialContent(article));
  const invalid = [
    { gallery: [{ ...article.gallery[0], path: "../private.jpg" }] },
    { gallery: [{ ...article.gallery[0], path: "https://example.com/photo.jpg" }] },
    { gallery: [{ ...article.gallery[0], alt: " " }] },
    { gallery: [article.gallery[0], article.gallery[0]] },
    { gallery: null }, { gallery: Array(13).fill(article.gallery[0]) },
    { inlineImageAfterParagraph: -2 }, { inlineImageAfterParagraph: 1.5 },
    { inlineImageAlignment: "anything" }, { version: 3 },
  ];
  for (const patch of invalid) assert.equal(editorial.parseEditorialContent(JSON.stringify({ ...serialized, ...patch })), null);
  assert.equal(editorial.getInlineImageInsertionIndex(article, 4), 1);
  assert.equal(editorial.getInlineImageInsertionIndex({ ...article, inlineImageAfterParagraph: 9 }, 2), 2);
  assert.equal(editorial.getInlineImageInsertionIndex({ ...article, inlineImageAfterParagraph: 0 }, 2), 0);
});
