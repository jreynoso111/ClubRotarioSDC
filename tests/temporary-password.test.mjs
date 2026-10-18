import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../lib/temporary-password.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const words = {};
new Function("exports", source)(words);

test("temporary passwords are one plain Spanish word that Auth accepts", () => {
  assert.ok(words.temporaryPasswordWords.length >= 30);
  for (const word of words.temporaryPasswordWords) assert.match(word, /^[a-z]{8,12}$/);
  for (let index = 0; index < 50; index++) assert.ok(words.temporaryPasswordWords.includes(words.generateTemporaryPassword()));
  assert.equal(words.generateTemporaryPassword(() => 0), words.temporaryPasswordWords[0]);
});
