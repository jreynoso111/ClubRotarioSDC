// H09: fail CI on high/critical npm advisories. Production dependencies have
// no exceptions; the full tree may list a dated exception in
// security/audit-exceptions.json (advisory URL, reason and expiry).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scope = process.argv[2] === "--production" ? ["--omit=dev"] : [];
// Fixed command line (no user input); a shell lets Windows resolve npm.cmd.
let report;
try {
  report = JSON.parse(execSync(["npm", "audit", "--json", ...scope].join(" "), { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }));
} catch (error) {
  // npm audit exits non-zero when it finds advisories; its JSON is still on stdout.
  if (!error.stdout) throw error;
  report = JSON.parse(error.stdout);
}
if (report.error || typeof report.vulnerabilities !== "object") {
  console.error("npm audit did not return a usable report; failing closed.");
  process.exit(1);
}
const exceptions = scope.length ? [] : JSON.parse(readFileSync(new URL("../security/audit-exceptions.json", import.meta.url), "utf8")).exceptions;
const today = new Date().toISOString().slice(0, 10);
const vulnerabilities = report.vulnerabilities ?? {};
// npm lists inherited findings by package name ("via": "braces"); follow them
// to the advisories they come from so an exception covers the whole chain.
function advisoriesOf(name, seen = new Set()) {
  if (seen.has(name) || !vulnerabilities[name]) return [];
  seen.add(name);
  return vulnerabilities[name].via.flatMap(item => typeof item === "object" ? [item.url] : advisoriesOf(item, seen));
}
const blocking = [];
for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!["high", "critical"].includes(vulnerability.severity)) continue;
  const advisories = [...new Set(advisoriesOf(name))];
  const excused = advisories.length > 0 && advisories.every(url => exceptions.some(item => item.advisory === url && item.expires >= today));
  if (!excused) blocking.push(`${name} (${vulnerability.severity}) ${advisories.join(" ") || "sin aviso identificado"}`);
}
if (blocking.length) {
  console.error(`npm audit gate failed${scope.length ? " (production)" : ""}:\n- ${blocking.join("\n- ")}`);
  process.exit(1);
}
console.log(`npm audit gate passed${scope.length ? " (production)" : " (full tree)"}.`);
