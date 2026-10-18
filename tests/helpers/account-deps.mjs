import { readFileSync } from "node:fs";
import ts from "typescript";

// lib/account.ts has no imports, so it compiles on its own and can back "@/lib/account" in loader tests.
const output = ts.transpileModule(readFileSync(new URL("../../lib/account.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const account = {};
new Function("exports", output)(account);

export const accountDependencies = { "@/lib/account": account };
