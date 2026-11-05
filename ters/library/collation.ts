// Writes collation.json, the collation tables (L214e4, src/lang/
// collation-tables.ts), read off this machine's Intl.Collator, with each
// locale's tailoring that the tables can hold (L214e5b2): one whose order
// the tailored tables give back exactly on random words of its alphabet.
// Run it when Node's Unicode version moves on (test/collation-tables.test.ts
// says so):
//   node library/collation.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCollationTables, elementsByCode, saveCollation, tailoring, TAILORED, type Element } from "../src/lang/collation-tables.ts";

// Latin-script languages, tried in turn; those that put their own script
// first, or sort two letters as one, are later steps (BACKLOG L214e5b3 on).
const LANGUAGES = ["af", "az", "bs", "ca", "cs", "cy", "da", "de", "en", "eo", "es", "et", "fi", "fil", "fo", "fr", "gl", "ha", "hr", "hu", "id", "is", "it", "lt", "lv", "ms", "mt", "nb", "nl", "nn", "pl", "pt", "ro", "se", "sk", "sl", "sq", "sv", "sw", "tk", "to", "tr", "uz", "vi", "wo", "yo", "zu"];

const t = performance.now();
const root = buildCollationTables(), all = elementsByCode(root);
const tailored: Record<string, Map<number, Element[]>> = {};
const left: string[] = [];
for (const language of LANGUAGES) {
  let ov: Map<number, Element[]>;
  try { ov = tailoring(all, elementsByCode(buildCollationTables(language))); } catch (e) { left.push(`${language} (${(e as Error).message})`); continue; }
  if (!ov.size) continue;
  if (!agrees(language, ov)) { left.push(`${language} (differs from the host)`); continue; }
  tailored[language] = ov;
}
const saved = saveCollation(root, tailored, all);
writeFileSync(join(import.meta.dirname, "collation.json"), JSON.stringify(saved) + "\n");
console.log(`collation: Unicode ${saved.unicode}, ${saved.runs.length} runs, ${saved.multi.length} of several elements, ${saved.contractions.length} contractions, ${Object.keys(tailored).length} tailorings (${Object.entries(tailored).map(([l, m]) => `${l} ${m.size}`).join(", ")}), in ${((performance.now() - t) / 1000).toFixed(0)} s`);
if (left.length) console.log(`left as root: ${left.join(", ")}`);

// The tailored tables against the host, on random words of the language's
// letters (each letter the locale moves, and a to z either case).
function agrees(language: string, ov: Map<number, Element[]>): boolean {
  const els = (s: string) => [...s].flatMap((x) => { const c = x.codePointAt(0)!; return ov.get(c) ?? (all.get(c) ?? []).map(([p, sec, ter, cc]) => [p * TAILORED, sec, ter, cc ?? 0] as Element); });
  const compare = (x: string, y: string) => {
    const a = els(x), b = els(y);
    for (let level = 0; level < 3; level++) {
      const ws = (es: Element[]) => es.map((e) => e[level]).filter((w) => level > 0 || w !== 0);
      const wa = ws(a), wb = ws(b);
      for (let i = 0; i < Math.min(wa.length, wb.length); i++) if (wa[i] !== wb[i]) return wa[i] < wb[i] ? -1 : 1;
      if (wa.length !== wb.length) return wa.length < wb.length ? -1 : 1;
    }
    return 0;
  };
  const letters = [...new Set([..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ -", ...[...ov.keys()].filter((c) => c < 0x250).map((c) => String.fromCodePoint(c))])];
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
  const words = Array.from({ length: 400 }, () => Array.from({ length: 1 + rnd(4) }, () => letters[rnd(letters.length)]).join("").normalize("NFC"));
  const host = new Intl.Collator(language, { usage: "sort" });
  return words.every((x, i) => words.slice(i, i + 60).every((y) => Math.sign(host.compare(x, y)) === compare(x, y)));
}
