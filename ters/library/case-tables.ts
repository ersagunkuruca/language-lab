// Writes case-tables.json, the case tables (L214e1, src/lang/
// case-tables.ts), read off this machine's toUpperCase, toLowerCase and
// Unicode properties. The library's case mapping is built over them, so
// every machine builds the same library (I244). Run it, then
// `node library/build.ts`, when Node's Unicode version moves on
// (test/case-tables.test.ts says so):
//   node library/case-tables.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostCaseTables } from "../src/lang/case-tables.ts";

const t = performance.now();
const saved = hostCaseTables();
writeFileSync(join(import.meta.dirname, "case-tables.json"), JSON.stringify(saved) + "\n");
console.log(`case tables: Unicode ${saved.unicode}, ${saved.upper.runs.length} upper and ${saved.lower.runs.length} lower runs, in ${((performance.now() - t) / 1000).toFixed(1)} s`);
