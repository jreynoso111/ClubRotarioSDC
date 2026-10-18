// Writes one identifier per build. next.config.ts reads it for version skew
// protection, so a tab left open across a release reloads instead of calling
// Server Actions that no longer exist.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const id = process.env.NEXT_DEPLOYMENT_ID?.trim() || `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
writeFileSync(new URL("../.deployment-id", import.meta.url), `${id}\n`);
console.log(`deployment id ${id}`);
