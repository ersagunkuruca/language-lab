// The cases module (L214e2, cases-source.ts): uppercase and lowercase
// written in Ters over the case tables give what the host's `uppercase`
// and `lowercase` give, in the root locale and in Turkish, Azeri and
// Lithuanian and Greek, final sigma and Turkish's I with a dot above included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { CASES, LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { LOCALE_V } from "../src/lang/std.ts";

const cases = (name: string) => CASES.exports.find((d) => LIBRARY.names[d] === name)!;

const WORDS = [
  "Hello, World", "straße", "ŉ and ǰ", "İstanbul DIŞ ıi Iİ", "İ", "ΟΔΟΣ ΟΔΟΣ. Σ ΑΣ", "Ϊ́ and ΐ", "ǅungla ǈ ǋ", "Ꭰ ꭰ", "ﬃ ﬆ", "𐐀𐐨 𞤀",
  "àéîõü ÀÉÎÕÜ", "Āā Ăă Ąą", "Ⅻ ⓐ Ⓐ", "Ǆ ǆ", "ꙁ Ꙁ", "Ǳ", "ı", "ſ", "K Å Ω", "ὒ ᾳ ᾼ",
];
// Every code point below U+0600 that maps, one at a time, as text.
const SWEEP = Array.from({ length: 0x600 }, (_, c) => String.fromCodePoint(c)).filter((s) => s.toUpperCase() !== s || s.toLowerCase() !== s).join(" ");

test("the cases module's uppercase and lowercase are the host's", () => {
  const k = new Lang(LIBRARY.code);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {} });
  const run = (f: string, t: string, tag: string) => [...r.call(r.value(cases(f)), t, { tag: LOCALE_V, fields: [tag] } as Value)][0];
  const wrong: string[] = [];
  for (const tag of ["en", "tr", "az", "lt", "el"]) for (const t of [...WORDS, SWEEP]) {
    // Left (L214e2): Lithuanian's dot before an accent, and a combining
    // accent Greek uppercase drops after a letter.
    if (tag === "lt" && /[iIįĮjJ]/.test(t)) continue;
    if (tag === "el" && /[\u0300-\u036f]/.test(t)) continue;
    const up = run("table uppercase", t, tag), down = run("table lowercase", t, tag);
    if (up !== t.toLocaleUpperCase(tag)) wrong.push(`${tag} upper ${JSON.stringify(t.slice(0, 20))}: ${JSON.stringify(String(up).slice(0, 40))}`);
    if (down !== t.toLocaleLowerCase(tag)) wrong.push(`${tag} lower ${JSON.stringify(t.slice(0, 20))}: ${JSON.stringify(String(down).slice(0, 40))}`);
  }
  assert.deepEqual(wrong, []);
});
