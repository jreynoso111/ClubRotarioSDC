import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../../utils/supabase/public-url.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = {};
new Function("require", "exports", output)((name) => {
  if (name === "server-only") return {};
  throw new Error(`Unexpected dependency ${name}`);
}, loaded);
export const toPublicSupabaseUrl = loaded.toPublicSupabaseUrl;
