// Grapheme tables for the targets with no host to ask (L214e3, TEXT-2026-
// 11-03 "How each target does it"): each code point's Grapheme_Cluster_Break
// class (UAX #29), with the two properties its rules read besides,
// Extended_Pictographic and Indic_Conjunct_Break. As the case tables are
// (case-tables.ts), they are read off the building machine's own
// `Intl.Segmenter`, the one the evaluator and compiled JS use, not copied
// from the Unicode data, so every target agrees on its Unicode version.
//
// A code point's class is found by how it joins: next to a letter of each
// class, before and after (CR, LF, a control, a mark, a joiner, a regional
// indicator, a prepended mark, a spacing mark, Hangul's L, V, T, LV and LVT
// jamo, an emoji), and in the three-letter places the rules look further
// (an emoji's joiner, a pair of flags, a Devanagari conjunct). Two code
// points that join the same way everywhere are the same class, and each
// class is named by the letter it joins like. Most blocks join as a plain
// letter does all through, and are passed over whole: a block's code
// points each put in a pair with a control between, the block's text
// breaks as many times as a plain letter's would.
//
// `graphemeBreaks` is UAX #29's rules over the tables, here to check them
// against the host (test/grapheme-tables.test.ts) and to be written in
// Ters next (L214e3b).

export type GraphemeClass = "Other" | "CR" | "LF" | "Control" | "Extend" | "ZWJ" | "Regional_Indicator" | "Prepend" | "SpacingMark" | "L" | "V" | "T" | "LV" | "LVT";
// A class with its two other properties: Extended_Pictographic, and
// Indic_Conjunct_Break's Consonant, Linker or Extend.
export interface Grapheme { cls: GraphemeClass; pictographic: boolean; conjunct: "" | "Consonant" | "Linker" | "Extend" }
export interface GraphemeRun { from: number; to: number; g: Grapheme }

const SEP = "\u0001";
const segmenter = () => new Intl.Segmenter("en", { granularity: "grapheme" });

// The letters it is tried next to, each a class's own (or a property's).
const PROBES: [string, string][] = [
  ["Other", "a"], ["CR", "\r"], ["LF", "\n"], ["Control", "\u0001"], ["Extend", "\u200c"], ["ZWJ", "\u200d"],
  ["Regional_Indicator", "\u{1f1e6}"], ["Prepend", "\u0600"], ["SpacingMark", "\u0903"],
  ["L", "\u1100"], ["V", "\u1161"], ["T", "\u11a8"], ["LV", "\uac00"], ["LVT", "\uac01"],
];
// The places it is tried in: a pair, before or after each letter, and the
// rules that look further.
const PLACES: ((c: string) => string)[] = [
  ...PROBES.flatMap(([, p]) => [(c: string) => p + c, (c: string) => c + p]),
  (c) => "\u{1f600}\u200d" + c, // after an emoji and its joiner (GB11)
  (c) => c + "\u200d\u{1f600}", // before a joiner and an emoji
  (c) => "\u{1f600}" + c + "\u{1f600}", // between two emoji: a joiner
  (c) => "\u{1f600}" + c + "\u200d\u{1f600}", // an emoji's Extend, before its joiner
  (c) => "\u0915\u094d" + c, // after a consonant and a virama (GB9c)
  (c) => c + "\u094d\u0915", // before a virama and a consonant
  (c) => "\u0915" + c + "\u0915", // between two consonants: a linker
  (c) => "\u0915\u094d" + c + "\u0915", // after a linker and before a consonant
];

// The tables as saved (library/graphemes.json): [from, to, kind] with
// kind an index into KINDS. Reading them off the host takes about a
// minute, so library/graphemes.ts does it once per Unicode version, and
// the test says when the host's version has moved on.
export const KINDS: Grapheme[] = [];
const kindOf = (g: Grapheme): number => {
  const i = KINDS.findIndex((k) => k.cls === g.cls && k.pictographic === g.pictographic && k.conjunct === g.conjunct);
  return i >= 0 ? i : KINDS.push(g) - 1;
};
export interface SavedGraphemes { unicode: string; kinds: Grapheme[]; runs: [number, number, number][] }
export const saveGraphemes = (runs: GraphemeRun[]): SavedGraphemes => {
  KINDS.length = 0;
  const saved = runs.map((r) => [r.from, r.to, kindOf(r.g)] as [number, number, number]);
  return { unicode: process.versions.unicode ?? "", kinds: [...KINDS], runs: saved };
};
export const loadGraphemes = (s: SavedGraphemes): GraphemeRun[] => s.runs.map(([from, to, k]) => ({ from, to, g: s.kinds[k] }));

export function buildGraphemeTables(): GraphemeRun[] {
  const seg = segmenter();
  const count = (s: string) => { let n = 0; for (const _ of seg.segment(s)) n++; return n; };
  const ch = String.fromCodePoint;
  const joins = (s: string) => count(s);
  const signature = (c: number) => PLACES.map((f) => joins(f(ch(c)))).join(",");
  const plain = signature(0x61);
  // How many pieces a block's text breaks into in each place, a plain
  // letter's way: a block that matches in every place is all plain.
  const plainCounts = PLACES.map((f) => count(f("a")));
  const allPlain = (lo: number, hi: number) => PLACES.every((f, i) => {
    let s = "";
    for (let c = lo; c < hi; c++) s += SEP + f(ch(c));
    return count(s) === (hi - lo) * (plainCounts[i] + 1);
  });
  // Each class's signature, by its letter; the properties apart.
  const named = new Map<string, Grapheme>();
  const name = (sig: string, g: Grapheme) => {
    if (named.has(sig)) throw new Error(`${g.cls} joins as ${named.get(sig)!.cls} does everywhere the tables try it`);
    named.set(sig, g);
  };
  // The joiner is Indic_Conjunct_Break's Extend too (Unicode 15.1).
  for (const [cls, p] of PROBES) name(signature(p.codePointAt(0)!), { cls: cls as GraphemeClass, pictographic: false, conjunct: cls === "ZWJ" ? "Extend" : "" });
  name(signature(0x1f600), { cls: "Other", pictographic: true, conjunct: "" });
  name(signature(0x915), { cls: "Other", pictographic: false, conjunct: "Consonant" });
  name(signature(0x94d), { cls: "Extend", pictographic: false, conjunct: "Linker" });
  name(signature(0x93c), { cls: "Extend", pictographic: false, conjunct: "Extend" });
  const runs: GraphemeRun[] = [];
  const put = (c: number, g: Grapheme) => {
    const last = runs.at(-1);
    if (last && last.to === c - 1 && last.g.cls === g.cls && last.g.pictographic === g.pictographic && last.g.conjunct === g.conjunct) last.to = c;
    else runs.push({ from: c, to: c, g });
  };
  const BLOCK = 256;
  for (let lo = 0; lo < 0x110000; lo += BLOCK) {
    if (lo >= 0xd800 && lo < 0xe000) continue;
    if (allPlain(lo, lo + BLOCK)) continue;
    for (let c = lo; c < lo + BLOCK; c++) {
      const s = signature(c);
      if (s === plain) continue;
      const g = named.get(s);
      if (!g) throw new Error(`U+${c.toString(16)} joins like no class the tables know: ${s}`);
      put(c, g);
    }
  }
  return runs;
}

const OTHER: Grapheme = { cls: "Other", pictographic: false, conjunct: "" };
export function graphemeOf(runs: GraphemeRun[], c: number): Grapheme {
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (c < runs[m].from) hi = m - 1;
    else if (c > runs[m].to) lo = m + 1;
    else return runs[m].g;
  }
  return OTHER;
}

// UAX #29's grapheme cluster boundaries over the tables: the code point
// positions a cluster starts at, after the first.
export function graphemeBreaks(runs: GraphemeRun[], cps: number[]): number[] {
  const gs = cps.map((c) => graphemeOf(runs, c));
  const out: number[] = [];
  let ri = 0; // regional indicators in a row before here
  let emoji = false; // an emoji, then Extend*, before here (GB11)
  let conj = 0; // 0 none; 1 a consonant then Extend/Linker*; 2 and a linker among them (GB9c)
  for (let i = 1; i < gs.length; i++) {
    const a = gs[i - 1], b = gs[i], A = a.cls, B = b.cls;
    // What the rules looking further know, through gs[i - 1].
    ri = A === "Regional_Indicator" ? ri + 1 : 0;
    const emojiBefore = emoji;
    emoji = a.pictographic || (emoji && A === "Extend");
    conj = a.conjunct === "Consonant" ? 1 : conj && (a.conjunct === "Linker" || a.conjunct === "Extend") ? (a.conjunct === "Linker" ? 2 : conj) : 0;
    const join =
      A === "CR" && B === "LF" ? true // GB3
        : A === "CR" || A === "LF" || A === "Control" || B === "CR" || B === "LF" || B === "Control" ? false // GB4, GB5
          : A === "L" && (B === "L" || B === "V" || B === "LV" || B === "LVT") ? true // GB6
            : (A === "LV" || A === "V") && (B === "V" || B === "T") ? true // GB7
              : (A === "LVT" || A === "T") && B === "T" ? true // GB8
                : B === "Extend" || B === "ZWJ" ? true // GB9
                  : B === "SpacingMark" ? true // GB9a
                    : A === "Prepend" ? true // GB9b
                      : conj === 2 && b.conjunct === "Consonant" ? true // GB9c
                        : A === "ZWJ" && emojiBefore && b.pictographic ? true // GB11
                          : A === "Regional_Indicator" && B === "Regional_Indicator" && ri % 2 === 1 ? true // GB12, GB13
                            : false; // GB999
    if (!join) out.push(i);
  }
  return out;
}
