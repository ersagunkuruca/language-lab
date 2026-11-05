// Writes graphemes.json, the grapheme tables (L214e3, src/lang/
// grapheme-tables.ts), read off this machine's Intl.Segmenter. Run it when
// Node's Unicode version moves on (test/grapheme-tables.test.ts says so):
//   node library/graphemes.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraphemeTables, saveGraphemes } from "../src/lang/grapheme-tables.ts";

const t = performance.now();
const saved = saveGraphemes(buildGraphemeTables());
writeFileSync(join(import.meta.dirname, "graphemes.json"), JSON.stringify(saved) + "\n");
console.log(`graphemes: Unicode ${saved.unicode}, ${saved.runs.length} runs of ${saved.kinds.length} kinds, in ${((performance.now() - t) / 1000).toFixed(0)} s`);
