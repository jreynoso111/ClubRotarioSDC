import { readFileSync } from "node:fs";
import ts from "typescript";

// The real photo slot catalogue, for tests that compile server actions importing "@/lib/site-photos".
const output = ts.transpileModule(readFileSync(new URL("../../lib/site-photos.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sitePhotosExports = {};
new Function("exports", output)(sitePhotosExports);

export const sitePhotosModule = sitePhotosExports;
