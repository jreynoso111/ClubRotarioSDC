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
  assert.equal(editorial.isStoryAssetPath("stories/../../other-user.png"), false);
  assert.equal(editorial.isStoryAssetPath("https://example.com/image.jpg"), false);
});
