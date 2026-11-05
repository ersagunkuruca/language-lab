// Writes collation.json, the collation tables (L214e4, src/lang/
// collation-tables.ts), read off this machine's Intl.Collator. Run it when
// Node's Unicode version moves on (test/collation-tables.test.ts says so):
//   node library/collation.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCollationTables, saveCollation } from "../src/lang/collation-tables.ts";

const t = performance.now();
const saved = saveCollation(buildCollationTables());
writeFileSync(join(import.meta.dirname, "collation.json"), JSON.stringify(saved) + "\n");
console.log(`collation: Unicode ${saved.unicode}, ${saved.runs.length} runs, ${saved.multi.length} of several elements, ${saved.contractions.length} contractions, in ${((performance.now() - t) / 1000).toFixed(0)} s`);
