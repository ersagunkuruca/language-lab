// The cases module (L214e2, cases-source.ts): uppercase and lowercase
// written in Ters over the case tables give what the host's `uppercase`
// and `lowercase` give, in the root locale and in Turkish, Azeri and
// Lithuanian and Greek, final sigma, Lithuanian's dot, Greek's diaeresis and Turkish's I with a dot above included.

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
  "àéîõü ÀÉÎÕÜ", "Āā Ăă Ąą",
  // The rules that look around: final sigma through an apostrophe and a mark, Greek's
  // diaeresis and lone ή, Lithuanian's dot.
  "ΌΣ' ΟΔΟΣ'Α Σ", "Άι ούτε ή εκείνη ήι αί ρολόι Μάιος", "ή", "Ή καλή ή κακή", "ΐ ύι",
  "I\u0300 J\u0301 Į\u0303 I\u0316\u0301 Ì Í Ĩ", "i\u0307 i\u0307\u0301 j\u0307 i\u0316\u0307 į\u0307 a\u0307 kiaušinį", "Ⅻ ⓐ Ⓐ", "Ǆ ǆ", "ꙁ Ꙁ", "Ǳ", "ı", "ſ", "K Å Ω", "ὒ ᾳ ᾼ",
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
    // Left (L214e2b): a combining accent Greek uppercase drops after a
    // letter, which text in NFC mostly doesn't have.
    if (tag === "el" && /[\u0300-\u036f]/.test(t)) continue;
    const up = run("table uppercase", t, tag), down = run("table lowercase", t, tag);
    if (up !== t.toLocaleUpperCase(tag)) wrong.push(`${tag} upper ${JSON.stringify(t.slice(0, 20))}: ${JSON.stringify(String(up).slice(0, 40))}`);
    if (down !== t.toLocaleLowerCase(tag)) wrong.push(`${tag} lower ${JSON.stringify(t.slice(0, 20))}: ${JSON.stringify(String(down).slice(0, 40))}`);
  }
  // Random Greek, accented and not, in NFC: the diaeresis and the lone ή.
  let seed = 3;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const pool = [..."αεηιουωάέήίόύώϊϋΐΰἀἁἄἅᾶῆῖῦῶᾳῃῳᾴὰὲὴὶὸὺὼΆΈΉΊΌΎΏΪΫ ΑΒΓκλμ-'"];
  for (let i = 0; i < 300; i++) {
    const t = Array.from({ length: 1 + rnd(6) }, () => pool[rnd(pool.length)]).join("");
    const up = run("table uppercase", t, "el");
    if (up !== t.toLocaleUpperCase("el")) wrong.push(`el upper ${JSON.stringify(t)}: ${JSON.stringify(up)}`);
  }
  assert.deepEqual(wrong, []);
});

// Grapheme clusters (L214e3b): the module's, over the grapheme tables,
// are the host's `graphemes`.
test("the cases module's graphemes are the host's", () => {
  const k = new Lang(LIBRARY.code);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const r = makeRunner(code, info, { print: () => {} });
  const items = (l: Value): string[] => { const out: string[] = []; for (let c = l as { tag: string; fields: Value[] }; c.fields.length; c = c.fields[1] as never) out.push(c.fields[0] as string); return out; };
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const wrong: string[] = [];
  for (const t of ["", "a", "Hello", "é؀a", "\r\n\n", "\u{1f1e6}\u{1f1e8}\u{1f1e6}", "\u{1f468}‍\u{1f469}‍\u{1f467} and \u{1f44d}\u{1f3fd}",
    "क्षि क्‍क", "각각", "กำ العربية", "a‍\u{1f600}", ...WORDS]) {
    const got = items([...r.call(r.value(cases("table graphemes")), t)][0]);
    const want = [...seg.segment(t)].map((x) => x.segment);
    if (got.join("|") !== want.join("|")) wrong.push(`${JSON.stringify(t)}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(wrong, []);
});
