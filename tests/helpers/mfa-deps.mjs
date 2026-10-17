import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)(name => dependencies[name], exports);
  return exports;
}

export const mfaPolicy = compile("../../lib/mfa-policy.ts");
export const mfaSession = compile("../../lib/mfa-session.ts", { "server-only": {}, "./mfa-policy": mfaPolicy });
// Real MFA modules for test loaders that resolve "@/..." imports from a map.
export const mfaDependencies = { "@/lib/mfa-policy": mfaPolicy, "@/lib/mfa-session": mfaSession };
