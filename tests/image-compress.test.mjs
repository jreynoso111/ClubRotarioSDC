import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/image-compress.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const MB = 1024 * 1024;

// Loads the compressor with a stand-in for the open-source library and records how it was called.
function load(library = async (file) => new Blob([new Uint8Array(Math.min(file.size, 400 * 1024))], { type: "image/webp" })) {
  const calls = [];
  const loaded = {};
  const imageCompression = async (file, options) => { calls.push(options); return library(file, options); };
  new Function("require", "exports", compiled)(name => {
    assert.equal(name, "browser-image-compression");
    return { __esModule: true, default: imageCompression };
  }, loaded);
  return { ...loaded, calls };
}
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const photo = (bytes, type = "image/jpeg", name = "Foto del club.JPG") => new File([new Uint8Array(bytes)], name, { type });

test("formatBytes writes Spanish sizes in KB and MB", () => {
  const { formatBytes } = load();
  assert.equal(formatBytes(640 * 1024), "640 KB");
  assert.equal(formatBytes(12_897_485), "12,3 MB");
  assert.equal(formatBytes(1.5 * MB), "1,5 MB");
  assert.equal(formatBytes(10 * MB), "10 MB");
  assert.equal(formatBytes(0), "0 KB");
  assert.throws(() => formatBytes(-1), RangeError);
});

test("optimizationNote reports only files that got smaller", () => {
  const { optimizationNote } = load();
  assert.equal(optimizationNote({ originalBytes: 12_897_485, finalBytes: 640 * 1024 }), "Foto optimizada: 12,3 MB → 640 KB");
  assert.equal(optimizationNote({ originalBytes: 1000, finalBytes: 1000 }), null);
});

test("presets and the input limit follow the upload rules", () => {
  const { imagePresets, MAX_INPUT_IMAGE_BYTES } = load();
  assert.deepEqual({ ...imagePresets.sitePhoto }, { maxDimension: 2400, maxBytes: 1.5 * MB });
  assert.deepEqual({ ...imagePresets.storyImage }, { maxDimension: 2400, maxBytes: 1.5 * MB });
  assert.deepEqual({ ...imagePresets.receiptImage }, { maxDimension: 2000, maxBytes: 1.5 * MB });
  assert.equal(MAX_INPUT_IMAGE_BYTES, 60 * MB);
});

test("a large photo goes through the library as WebP within the preset, without a CDN worker", async () => {
  const compressor = load();
  const result = await compressor.compressImage(photo(14 * MB), compressor.imagePresets.sitePhoto);
  assert.deepEqual(compressor.calls, [{ maxSizeMB: 1.5, maxWidthOrHeight: 2400, fileType: "image/webp", initialQuality: 0.86, useWebWorker: false }]);
  assert.equal(result.file.type, "image/webp");
  assert.equal(result.file.name, "Foto-del-club.webp");
  assert.equal(result.originalBytes, 14 * MB);
  assert.equal(result.finalBytes, 400 * 1024);
});

test("a small file is kept when the library cannot make it smaller", async () => {
  const compressor = load(async file => new Blob([new Uint8Array(file.size + 10)], { type: "image/webp" }));
  const original = photo(300 * 1024, "image/png", "logo.png");
  const result = await compressor.compressImage(original, compressor.imagePresets.sitePhoto);
  assert.equal(result.file, original);
  assert.equal(result.finalBytes, original.size);
});

test("oversized and unreadable files get the Spanish messages", async () => {
  const tooLarge = load();
  await assert.rejects(() => tooLarge.compressImage(photo(61 * MB), tooLarge.imagePresets.sitePhoto), /máximo 60 MB/);
  assert.equal(tooLarge.calls.length, 0);
  const unreadable = load(async () => { throw new Error("decode failed"); });
  await assert.rejects(() => unreadable.compressImage(photo(2 * MB, "image/heic", "IMG_1.HEIC"), unreadable.imagePresets.storyImage), /No pudimos leer esta imagen/);
});

test("upload screens optimize photos before storing them and show no old size limits", () => {
  const site = read("../app/plataforma/SitePhotoManager.tsx");
  const stories = read("../app/plataforma/StoryComposerDialog.tsx");
  const finance = read("../app/plataforma/FinanceModule.tsx");
  const account = read("../app/plataforma/AccountSettings.tsx");
  assert.match(site, /compressImage\(selected, \{ \.\.\.imagePresets\.sitePhoto/);
  assert.match(stories, /compressImage\(file, \{ \.\.\.imagePresets\.storyImage/);
  assert.match(finance, /compressImage\(file, \{ \.\.\.imagePresets\.receiptImage/);
  assert.match(account, /file\.size > MAX_INPUT_IMAGE_BYTES/);
  assert.doesNotMatch(account, /avatarMaxBytes/);
  for (const source of [site, stories, finance, account]) {
    assert.doesNotMatch(source, /máximo 10 MB|hasta 10 MB|hasta 5 MB|de 5 MB/);
  }
});
