import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", source)(() => { throw new Error("member-picker rules have no imports."); }, exports);
  return exports;
}

const picker = compile("../lib/member-picker.ts");
const candidates = [
  { userId: "u-carla", name: "Carla Santos" },
  { userId: "u-ana", name: "Ana Rivera" },
  { userId: "u-luis", name: "Luis Méndez" },
];

test("the member search ignores accents and case and lists people by name", () => {
  assert.deepEqual(picker.filterMemberOptions(candidates, "MENDEZ").map(item => item.userId), ["u-luis"]);
  assert.deepEqual(picker.filterMemberOptions(candidates, "lu").map(item => item.userId), ["u-luis"]);
  assert.deepEqual(picker.filterMemberOptions(candidates, "").map(item => item.name), ["Ana Rivera", "Carla Santos", "Luis Méndez"]);
  assert.deepEqual(picker.filterMemberOptions(candidates, "zzz"), []);
});

test("the selected person stays available when the filter would hide them", () => {
  assert.deepEqual(picker.filterMemberOptions(candidates, "ana", "u-luis").map(item => item.userId), ["u-luis", "u-ana"]);
  assert.deepEqual(picker.filterMemberOptions(candidates, "ana", null).map(item => item.userId), ["u-ana"]);
});

test("a committee has one chair: choosing someone else is blocked, the holder keeps the chair", () => {
  const members = [{ userId: "u-ana", role: "chair" }, { userId: "u-luis", role: "member" }];
  assert.equal(picker.chairConflict(members, "u-luis").userId, "u-ana");
  assert.equal(picker.chairConflict(members, "u-ana"), null);
  assert.equal(picker.chairConflict(members, ""), members[0]);
  assert.equal(picker.chairConflict([{ userId: "u-luis", role: "secretary" }], "u-ana"), null);
});
