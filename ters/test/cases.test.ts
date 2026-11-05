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
  // And Greek with marks no precomposed letter takes in (L214e2c): the
  // accents dropped, the dialytika kept, the ypogegrammeni an iota.
  const marks = ["\u0300", "\u0301", "\u0342", "\u0308", "\u0313", "\u0314", "\u0345", "\u0306", "\u0344", "\u0302", ""];
  const letters = [..."αεηιουωάέήίϊΐΑΗΕἀῆ ab-"];
  for (let i = 0; i < 400; i++) {
    const t = Array.from({ length: 1 + rnd(5) }, () => letters[rnd(letters.length)] + marks[rnd(marks.length)] + (rnd(3) ? "" : marks[rnd(marks.length)])).join("").normalize("NFC");
    const up = run("table uppercase", t, "el");
    if (up !== t.toLocaleUpperCase("el")) wrong.push(`el upper ${JSON.stringify(t)}: ${JSON.stringify(up)} not ${JSON.stringify(t.toLocaleUpperCase("el"))}`);
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

test("the cases module's collated orders text as the host's root order does", () => {
  const k = new Lang(LIBRARY.code);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const r = makeRunner(code, info, { print: () => {} });
  const f = r.value(cases("table collated"));
  const host = new Intl.Collator("und", { sensitivity: "variant", usage: "sort" });
  const SIGN = { "std.order.before": -1, "std.order.same": 0, "std.order.after": 1 } as Record<string, number>;
  const texts = [...WORDS.flatMap((w) => w.split(" ")), "", "a", "A", "á", "ae", "æ", "Æ", "ss", "ß", "ﬁ", "fi", "½", "1/2", "o", "ø", "ǫ", "й", "и", "آ", "ا", "각", "가", "갂", "ㄱ", "😀", "10", "9", "a-b", "ab", "a b", "Zebra", "zebra", "Ελλάδα", "Москва", "東京", "ไทย", "कि"].map((t) => t.normalize("NFC"));
  // And random text: letters with accents, Greek, Cyrillic, Hangul, marks.
  const pool = [..."aeiosAEIOSßæøØ1-. ÀÉÎÕÜāăąǽαβγΑΒΓάἀйиЙИабв각가ㄱ\u0300\u0301\u0316\u0327\u0308"];
  let seed = 11;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 300; i++) texts.push(Array.from({ length: 1 + rnd(4) }, () => pool[rnd(pool.length)]).join("").normalize("NFC"));
  const wrong: string[] = [];
  for (let i = 0; i < texts.length; i++) for (const j of [i + 1, i + 7, i + 23]) {
    const x = texts[i], y = texts[j % texts.length];
    const got = SIGN[([...r.call(f, x, y, { tag: LOCALE_V, fields: ["und"] })][0] as { tag: string }).tag], want = Math.sign(host.compare(x, y));
    if (got !== want) wrong.push(`${JSON.stringify(x)} ${JSON.stringify(y)}: host ${want}, table ${got}`);
  }
  assert.deepEqual(wrong, []);
});

// A locale's own letters (L214e5b2): Turkish's ç after c and ı before i,
// Spanish's ñ, Czech's č ř š ž, Slovenian's č š ž, Polish's ł and
// Hungarian's accents and ö ü (L214e5b2b), and Russian's and
// Ukrainian's Cyrillic before Latin (L214e5b3), as the host orders
// them, on random words of each language's letters.
test("the cases module's collated orders text as the host does in Turkish, Spanish, Czech, Slovenian, Polish, Hungarian, Russian and Ukrainian", () => {
  const k = new Lang(LIBRARY.code);
  const code = base(k.code), names = baseNames(k.names);
  const r = makeRunner(code, infer(code, names, undefined, checkOptions), { print: () => {} });
  const f = r.value(cases("table collated"));
  const SIGN = { "std.order.before": -1, "std.order.same": 0, "std.order.after": 1 } as Record<string, number>;
  const wrong: string[] = [];
  for (const [tag, own] of [["tr", "çğıİöşüÇĞÖŞÜ"], ["es", "ñÑáé"], ["cs", "čďěňřšťůžČŘŠŽ"], ["sl", "čćđšžČŠŽ"], ["pl", "ąćęłńóśźżŁŻ"], ["hu", "áéíóöőúüűÖŐÜŰ"], ["ru", "абвгдеёжзийклмнопрстуфхцчшщъыьэюяЁЯ"], ["uk", "абвгґдеєжзиіїйклмнопрстуфхцчшщьюяІЇҐ"]]) {
    const host = new Intl.Collator(tag, { usage: "sort" }), pool = [..."abcghinostuyzAIZ -" + own];
    let seed = 5;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const texts = Array.from({ length: 80 }, () => Array.from({ length: 1 + rnd(4) }, () => pool[rnd(pool.length)]).join("").normalize("NFC"));
    for (let i = 0; i < texts.length; i++) for (const j of [i + 1, i + 5, i + 17]) {
      const x = texts[i], y = texts[j % texts.length];
      const got = SIGN[([...r.call(f, x, y, { tag: LOCALE_V, fields: [tag] })][0] as { tag: string }).tag], want = Math.sign(host.compare(x, y));
      if (got !== want) wrong.push(`${tag} ${JSON.stringify(x)} ${JSON.stringify(y)}: host ${want}, table ${got}`);
    }
  }
  assert.deepEqual(wrong, []);
});
