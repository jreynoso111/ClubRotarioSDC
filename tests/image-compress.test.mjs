import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/image-compress.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const imageCompress = {};
new Function("exports", compiled)(imageCompress);

const { compressionSchedule, fitWithin, formatBytes, imagePresets, MAX_INPUT_IMAGE_BYTES, optimizationNote } = imageCompress;
const MB = 1024 * 1024;

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("fitWithin scales the longest side down and never upscales", () => {
  assert.deepEqual(fitWithin(800, 600, 2400), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(2400, 1800, 2400), { width: 2400, height: 1800 });
  assert.deepEqual(fitWithin(4000, 3000, 2400), { width: 2400, height: 1800 });
  assert.deepEqual(fitWithin(3000, 4000, 2000), { width: 1500, height: 2000 });
  assert.throws(() => fitWithin(0, 100, 2400), RangeError);
});

test("fitWithin keeps the aspect ratio and the longest side within the limit", () => {
  for (const [width, height, maxDimension] of [[5472, 3648, 2000], [4032, 3024, 2400], [1234, 777, 500], [9000, 1000, 2400]]) {
    const fit = fitWithin(width, height, maxDimension);
    assert.ok(Math.max(fit.width, fit.height) <= maxDimension);
    assert.ok(fit.width <= width && fit.height <= height);
    assert.ok(Math.abs((fit.width / fit.height) / (width / height) - 1) < 0.005);
  }
});

test("compression schedule tries the best quality first and shrinks one round at a time", () => {
  const schedule = compressionSchedule();
  assert.equal(schedule.length, 6);
  assert.equal(schedule[0].scale, 1);
  assert.deepEqual([...schedule[0].qualities], [0.86, 0.8, 0.72, 0.64, 0.56]);
  for (const round of schedule) {
    const qualities = [...round.qualities];
    assert.deepEqual(qualities, [...qualities].sort((a, b) => b - a));
  }
  for (let index = 1; index < schedule.length; index += 1) {
    assert.ok(Math.abs(schedule[index].scale / schedule[index - 1].scale - 0.85) < 1e-9);
  }
  assert.ok(schedule[schedule.length - 1].scale > 0.4);
});

test("formatBytes writes Spanish sizes in KB and MB", () => {
  assert.equal(formatBytes(640 * 1024), "640 KB");
  assert.equal(formatBytes(12_897_485), "12,3 MB");
  assert.equal(formatBytes(1.5 * MB), "1,5 MB");
  assert.equal(formatBytes(10 * MB), "10 MB");
  assert.equal(formatBytes(0), "0 KB");
  assert.throws(() => formatBytes(-1), RangeError);
});

test("optimizationNote reports only files that got smaller", () => {
  assert.equal(optimizationNote({ originalBytes: 12_897_485, finalBytes: 640 * 1024 }), "Foto optimizada: 12,3 MB → 640 KB");
  assert.equal(optimizationNote({ originalBytes: 1000, finalBytes: 1000 }), null);
});

test("presets and the input limit follow the upload rules", () => {
  assert.deepEqual({ ...imagePresets.sitePhoto }, { maxDimension: 2400, maxBytes: 1.5 * MB });
  assert.deepEqual({ ...imagePresets.storyImage }, { maxDimension: 2400, maxBytes: 1.5 * MB });
  assert.deepEqual({ ...imagePresets.receiptImage }, { maxDimension: 2000, maxBytes: 1.5 * MB });
  assert.equal(MAX_INPUT_IMAGE_BYTES, 60 * MB);
});

// Each test loads a fresh copy of the module, so the WebP support check starts from zero.
function loadImageCompress() {
  const loaded = {};
  new Function("exports", compiled)(loaded);
  return loaded;
}

function fakeFile({ name, type, size }) {
  return { name, type, size };
}

const encodedSteps = (browser) => browser.calls.encodes.filter(encode => encode.width > 1);

// Stands in for the browser APIs used by the compressor. sizeFor decides how large each encoded picture is.
function installBrowser({ width = 4000, height = 3000, sizeFor = () => 300_000, webp = true, decodeFails = false } = {}) {
  const calls = { decodeOptions: [], encodes: [], draws: [] };
  globalThis.createImageBitmap = async (_file, options) => {
    calls.decodeOptions.push(options);
    if (decodeFails) throw new Error("InvalidStateError");
    return { width, height, close() {} };
  };
  globalThis.Image = class {
    set src(_value) {
      queueMicrotask(() => this.onerror?.());
    }
  };
  globalThis.OffscreenCanvas = class {
    constructor(canvasWidth, canvasHeight) {
      this.width = canvasWidth;
      this.height = canvasHeight;
    }

    getContext() {
      const { width: canvasWidth, height: canvasHeight } = this;
      return {
        fillStyle: "",
        imageSmoothingQuality: "low",
        fillRect() { calls.draws.push({ fill: true, width: canvasWidth, height: canvasHeight }); },
        drawImage(_source, _x, _y, drawWidth, drawHeight) { calls.draws.push({ fill: false, width: drawWidth, height: drawHeight }); },
      };
    }

    async convertToBlob({ type, quality }) {
      const outputType = !webp && type === "image/webp" ? "image/png" : type;
      const size = sizeFor({ width: this.width, height: this.height, quality, type: outputType });
      calls.encodes.push({ type: outputType, quality, width: this.width, height: this.height, size });
      return new Blob([new Uint8Array(size)], { type: outputType });
    }
  };
  return {
    calls,
    restore() {
      delete globalThis.createImageBitmap;
      delete globalThis.Image;
      delete globalThis.OffscreenCanvas;
    },
  };
}

test("a large phone photo is scaled to the preset and re-encoded as WebP within budget", async () => {
  const browser = installBrowser({ sizeFor: () => 300_000 });
  try {
    const { compressImage } = loadImageCompress();
    const result = await compressImage(fakeFile({ name: "IMG_2048.JPG", type: "image/jpeg", size: 8 * MB }), imagePresets.sitePhoto);
    assert.equal(result.file.name, "IMG_2048.webp");
    assert.equal(result.file.type, "image/webp");
    assert.equal(result.width, 2400);
    assert.equal(result.height, 1800);
    assert.equal(result.originalBytes, 8 * MB);
    assert.equal(result.finalBytes, 300_000);
    assert.deepEqual(browser.calls.decodeOptions, [{ imageOrientation: "from-image" }]);
    assert.deepEqual(encodedSteps(browser).map(encode => encode.quality), [0.86]);
  } finally {
    browser.restore();
  }
});

test("quality steps down until the file fits the byte budget", async () => {
  const browser = installBrowser({ sizeFor: ({ width, height, quality }) => Math.round((width * height * quality) / 2) });
  try {
    const { compressImage } = loadImageCompress();
    const result = await compressImage(fakeFile({ name: "foto.jpg", type: "image/jpeg", size: 6 * MB }), { maxDimension: 2400, maxBytes: 1.5 * MB });
    assert.deepEqual(encodedSteps(browser).map(encode => encode.quality), [0.86, 0.8, 0.72]);
    assert.equal(result.width, 2400);
    assert.ok(result.finalBytes <= 1.5 * MB);
  } finally {
    browser.restore();
  }
});

test("dimensions shrink in rounds when the lowest quality is still too large", async () => {
  const browser = installBrowser({ sizeFor: ({ width, height, quality }) => Math.round(width * height * quality * 0.4) });
  try {
    const { compressImage } = loadImageCompress();
    const result = await compressImage(fakeFile({ name: "foto.jpg", type: "image/jpeg", size: 6 * MB }), { maxDimension: 2400, maxBytes: 500_000 });
    assert.equal(result.width, 1474);
    assert.equal(result.height, 1105);
    assert.ok(result.finalBytes <= 500_000);
    assert.equal(encodedSteps(browser).at(-1).quality, 0.72);
  } finally {
    browser.restore();
  }
});

test("an image that cannot reach the budget in the smallest round fails in Spanish", async () => {
  const browser = installBrowser({ sizeFor: ({ width }) => (width > 1 ? 2 * MB : 10) });
  try {
    const { compressImage } = loadImageCompress();
    await assert.rejects(
      compressImage(fakeFile({ name: "foto.jpg", type: "image/jpeg", size: 8 * MB }), { maxDimension: 2400, maxBytes: 1.5 * MB }),
      { message: "No pudimos reducir esta foto a 1,5 MB. Prueba con otra imagen." },
    );
  } finally {
    browser.restore();
  }
});

test("a file that already fits is kept unless WebP saves at least 15 percent", async () => {
  const options = { maxDimension: 2400, maxBytes: 1.5 * MB };
  const alreadySmall = fakeFile({ name: "ya.webp", type: "image/webp", size: 1_000_000 });
  let browser = installBrowser({ width: 1000, height: 800, sizeFor: () => 950_000 });
  try {
    const { compressImage } = loadImageCompress();
    const kept = await compressImage(alreadySmall, options);
    assert.equal(kept.file, alreadySmall);
    assert.equal(kept.finalBytes, 1_000_000);
  } finally {
    browser.restore();
  }

  browser = installBrowser({ width: 1000, height: 800, sizeFor: () => 400_000 });
  try {
    const { compressImage } = loadImageCompress();
    const smaller = await compressImage(fakeFile({ name: "foto.jpg", type: "image/jpeg", size: 1_000_000 }), options);
    assert.equal(smaller.file.name, "foto.webp");
    assert.equal(smaller.file.type, "image/webp");
    assert.equal(smaller.finalBytes, 400_000);
  } finally {
    browser.restore();
  }
});

test("oversized, unreadable and unsupported files get the Spanish messages", async () => {
  const { compressImage } = loadImageCompress();
  const options = { maxDimension: 2400, maxBytes: 1.5 * MB };
  await assert.rejects(
    compressImage(fakeFile({ name: "gigante.jpg", type: "image/jpeg", size: 61 * MB }), options),
    { message: "La foto es demasiado grande (máximo 60 MB)." },
  );
  await assert.rejects(
    compressImage(fakeFile({ name: "documento.pdf", type: "application/pdf", size: 1000 }), options),
    { message: "No pudimos leer esta imagen. Usa una foto JPG, PNG o WebP." },
  );
  const browser = installBrowser({ decodeFails: true });
  try {
    await assert.rejects(
      compressImage(new File([new Uint8Array(16)], "IMG_0001.HEIC", { type: "image/heic" }), options),
      { message: "No pudimos leer esta imagen. Usa una foto JPG, PNG o WebP." },
    );
  } finally {
    browser.restore();
  }
});

test("browsers that cannot encode WebP receive a JPEG on a white background", async () => {
  const browser = installBrowser({ webp: false, sizeFor: () => 300_000 });
  try {
    const { compressImage } = loadImageCompress();
    const result = await compressImage(fakeFile({ name: "sin-webp.png", type: "image/png", size: 3 * MB }), { maxDimension: 2400, maxBytes: 1.5 * MB });
    assert.equal(result.file.name, "sin-webp.jpg");
    assert.equal(result.file.type, "image/jpeg");
    assert.ok(browser.calls.draws.some(draw => draw.fill));
  } finally {
    browser.restore();
  }
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
