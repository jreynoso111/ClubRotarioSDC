import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const exports = {};
const compiled = ts.transpileModule(readFileSync(new URL("../lib/platform-navigation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("exports", compiled)(exports);
const { defaultNavigationOrder: order, isNavigationOrder, moveNavigationItem } = exports;

test("the shared menu accepts complete permutations and keeps messages outside the sidebar", () => {
  assert.equal(order.includes("mensajes"), false);
  assert.equal(isNavigationOrder([...order].reverse()), true);
  for (const invalid of [null, "resumen", [], order.slice(1), [...order, "mensajes"], order.map(() => "resumen"),
    [...order.slice(1), null], [...order.slice(1), "mensajes"]]) {
    assert.equal(isNavigationOrder(invalid), false);
  }
});

test("moving down reaches the target position and preserves pages hidden by permissions", () => {
  const next = moveNavigationItem(order, "resumen", "revista");
  assert.equal(next[order.indexOf("revista")], "resumen");
  assert.equal(isNavigationOrder(next), true);
  assert.deepEqual(next.slice(-3), ["fotografias", "auditoria", "diagnostico"]);
  assert.equal(order[0], "resumen");
});

test("moving up and a later inverse move restore the complete shared order", () => {
  const next = moveNavigationItem(order, "revista", "resumen");
  assert.equal(next[0], "revista");
  assert.deepEqual(moveNavigationItem(next, "revista", "organizacion"), order);
  assert.deepEqual(moveNavigationItem(order, "agenda", "agenda"), order);
  assert.deepEqual(moveNavigationItem(order, "missing", "agenda"), order);
});
