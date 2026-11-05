// The cases module (BACKLOG L214e2, TEXT-2026-11-03 "How each target does
// it"): uppercase and lowercase written in Ters over the case tables
// (case-tables.ts, read off the host when the library is built), for the
// targets with no host to ask. WebAssembly and C run these (L214e5); the
// evaluator and compiled JS keep the host's `uppercase` and `lowercase`,
// and test/cases.test.ts checks the two agree.
//
// A character maps by its locale's own difference first (Turkish and
// Azeri's dotted and dotless i, Greek capitals without their accents),
// then by the code points that map to several (ß to SS), then by the
// runs. The rules that look at the letters around are SpecialCasing's and
// CLDR's (L214e2b):
//  - final sigma: Σ lowercase is ς after a cased letter and not before
//    one, case-ignorable letters between (an apostrophe, a mark) looked
//    through;
//  - Turkish and Azeri: I followed by a combining dot above (U+0307)
//    lowercases to i, the dot taken in;
//  - Lithuanian: I, J and Į keep a dot (U+0307) before an accent above
//    when lowercased, and lose it after i and j when uppercased;
//  - Greek uppercase: an ι or υ after a vowel whose accent was dropped
//    gets a diaeresis (άι is ΑΪ), and a lone ή, "or", keeps its tonos.
// Text is NFC where it enters (L214a), so Greek's combining accents are
// mostly composed; one left apart after a letter is kept, unlike the
// host's Greek uppercase.

import { merge, type Id } from "../model.ts";
import { prelude } from "../prelude.ts";
import { caseTables, type CaseTable } from "./case-tables.ts";
import { loadGraphemes, type GraphemeClass, type SavedGraphemes } from "./grapheme-tables.ts";
import savedGraphemes from "../../library/graphemes.json" with { type: "json" };
import savedCollation from "../../library/collation.json" with { type: "json" };
import { HANGUL, type SavedCollation } from "./collation-tables.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { CONS, FALSE, INT_OPS, LIST, LOCALE_V, NIL, NONE, ORDER_V, S, SOME, std, TEXT_OPS, TRUE } from "./std.ts";
import { INT, STRING } from "./types.ts";

export function buildCases(): Module {
  const k = new Lang();
  const tables = caseTables();
  const defs: Id[] = [];
  // `me` is the definition being written, for one that calls itself.
  let me = "";
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name), outer = me; me = d; k.define(d, k.fn(params, body)); me = outer; defs.push(d); return d; };
  const less = (a: Id, b: Id) => k.call(INT_OPS.less, a, b);
  const same = (a: Id, b: Id) => k.call(S.equal, a, b);
  const add = (a: Id, b: Id) => k.call(INT_OPS.add, a, b);
  const sub = (a: Id, b: Id) => k.call(INT_OPS.sub, a, b);
  const and = (a: Id, b: Id) => k.call(S.and, a, b);
  const not = (a: Id) => k.call(S.not, a);
  const or = (...xs: Id[]) => xs.reduce((a, b) => k.call(S.or, a, b));
  const list = (xs: Id, nil: () => Id, cons: (x: Id, rest: Id) => Id) => k.match(xs, [
    { variant: NIL, names: [], body: nil },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => cons(x, rest) },
  ]);
  const ints = (xs: number[]) => k.list(...xs.map((x) => k.int(x)));

  const Run = k.type("Case run", [], [["case run", [["from", () => k.tref(INT)], ["count", () => k.tref(INT)], ["step", () => k.tref(INT)], ["delta", () => k.tref(INT)]]]]);
  const Several = k.type("Case several", [], [["case several", [["code", () => k.tref(INT)], ["to", () => k.tref(LIST, k.tref(INT))]]]]);
  defs.push(Run.def, Several.def);
  const runV = Run.v["case run"], severalV = Several.v["case several"];

  // The tables as values, each its own definition.
  const runsOf = (name: string, t: CaseTable) => { const d = k.def(name); k.define(d, k.list(...t.runs.map((r) => k.call(runV, k.int(r.from), k.int(r.count), k.int(r.step), k.int(r.delta))))); defs.push(d); return d; };
  const severalOf = (name: string, xs: [number, number[]][]) => { const d = k.def(name); k.define(d, k.list(...xs.map(([c, to]) => k.call(severalV, k.int(c), ints(to))))); defs.push(d); return d; };
  const upperRuns = runsOf("upper case runs", tables.upper), lowerRuns = runsOf("lower case runs", tables.lower);
  const upperSeveral = severalOf("upper case several", tables.upper.several), lowerSeveral = severalOf("lower case several", tables.lower.several);
  const tr = tables.locales.tr, lt = tables.locales.lt;
  if (JSON.stringify(tables.locales.az) !== JSON.stringify(tr)) throw new Error("Azeri's case mapping is no longer Turkish's: the cases module needs its own table");
  const trUpper = severalOf("turkish upper case", tr.upper), trLower = severalOf("turkish lower case", tr.lower);
  const ltUpper = severalOf("lithuanian upper case", lt.upper), ltLower = severalOf("lithuanian lower case", lt.lower);
  const el = tables.locales.el;
  if (el.lower.length) throw new Error("Greek lowercase is no longer the root's: the cases module needs its table");
  const elUpper = severalOf("greek upper case", el.upper);

  // A code point's mapping among the ones that map to several, if there.
  const found = def("case several of", ["code", "table"], (c, t) => list(t, () => k.x(NONE), (x, rest) =>
    k.match(x, [{ variant: severalV, names: ["from", "to"], body: ([from, to]) => k.if(same(from, c), k.call(SOME, to), k.call(me, c, rest)) }])));
  // A code point's mapping by the runs, which are in order of `from`; a
  // run's step is 1 or 2.
  const byRuns = def("case run of", ["code", "runs"], (c, rs) => list(rs, () => k.list(c), (r, rest) =>
    k.match(r, [{ variant: runV, names: ["from", "count", "step", "delta"], body: ([from, count, step, delta]) => k.if(less(c, from), k.list(c),
      k.let("i", sub(c, from), (i) => k.if(k.if(same(step, k.int(1)), less(i, count), and(same(k.call(INT_OPS.bitAnd, i, k.int(1)), k.int(0)), less(k.call(INT_OPS.shiftDown, i, k.int(1)), count))),
        k.list(add(c, delta)), k.call(me, c, rest)))) }])));
  const mapped = def("case mapped", ["code", "own", "several", "runs"], (c, own, sv, rs) => k.match(k.call(found, c, own), [
    { variant: SOME, names: ["to"], body: ([to]) => to },
    { variant: NONE, names: [], body: () => k.match(k.call(found, c, sv), [
      { variant: SOME, names: ["to"], body: ([to]) => to },
      { variant: NONE, names: [], body: () => k.call(byRuns, c, rs) }]) }]));

  // A locale's language: its tag up to the first "-".
  const language = def("case language", ["locale"], (l) => k.match(l, [{ variant: LOCALE_V, names: ["tag"], body: ([tag]) =>
    list(k.call(TEXT_OPS.split, tag, k.lit("-")), () => k.lit(""), (x) => x) }]));
  const turkic = (lang: Id) => k.call(S.or, same(lang, k.lit("tr")), same(lang, k.lit("az")));
  const own = (lang: Id, trT: Id, ltT: Id, elT?: Id) => k.if(turkic(lang), k.x(trT), k.if(same(lang, k.lit("lt")), k.x(ltT), elT ? k.if(same(lang, k.lit("el")), k.x(elT), k.list()) : k.list()));

  const codesOf = def("case codes of", ["characters"], (chs) => list(chs, () => k.list(), (ch, rest) =>
    k.call(CONS, k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, ch)), k.thunk(() => k.int(0))), k.call(me, rest))));
  const codes = def("case codes", ["text"], (t) => k.call(codesOf, k.call(TEXT_OPS.characters, t)));
  const text = def("case text", ["codes"], (cs) => list(cs, () => k.lit(""), (c, rest) =>
    k.text(k.call(S.first, k.thunk(() => k.call(TEXT_OPS.fromCode, c)), k.thunk(() => k.lit(""))), k.call(me, rest))));

  // A code point among the runs of a property, [first, last] in a flat
  // list of Ints, in order.
  const pairs = (name: string, rs: [number, number][]) => { const d = k.def(name); k.define(d, ints(rs.flat())); defs.push(d); return d; };
  const flat = (name: string, xs: number[]) => { const d = k.def(name); k.define(d, ints(xs)); defs.push(d); return d; };
  const casedRuns = pairs("cased runs", tables.cased), ignorableRuns = pairs("case ignorable runs", tables.ignorable);
  const softDotted = flat("soft dotted", tables.softDotted), above = flat("accents above", tables.above), greekAccented = flat("greek accented", tables.greekAccented);
  const inRuns = def("case in runs", ["code", "runs"], (c, rs) => list(rs, () => k.x(FALSE), (from, r1) => list(r1, () => k.x(FALSE), (to, rest) =>
    k.if(less(c, from), k.x(FALSE), k.if(less(to, c), k.call(me, c, rest), k.x(TRUE))))));
  const among = def("case among", ["code", "codes"], (c, xs) => list(xs, () => k.x(FALSE), (x, rest) => k.if(same(x, c), k.x(TRUE), k.call(me, c, rest))));
  const isCased = (c: Id) => k.call(inRuns, c, k.x(casedRuns)), isIgnorable = (c: Id) => k.call(inRuns, c, k.x(ignorableRuns));
  // A cased letter comes next, case-ignorable ones looked through.
  const casedNext = def("cased next", ["codes"], (cs) => list(cs, () => k.x(FALSE), (n, rest) => k.if(isIgnorable(n), k.call(me, rest), isCased(n))));
  // After a cased letter, case-ignorable ones looked through.
  const afterNow = (c: Id, after: Id) => k.if(isIgnorable(c), after, isCased(c));
  const one = (xs: Id, x: number) => same(xs, k.list(k.int(x)));
  const VOWELS = [0x391, 0x395, 0x397, 0x399, 0x39f, 0x3a5, 0x3a9];

  // xs then ys.
  const then = def("case then", ["xs", "ys"], (xs, ys) => list(xs, () => ys, (x, rest) => k.call(CONS, x, k.call(me, rest, ys))));
  // "accented vowel": the letter before was a Greek vowel whose accent was
  // dropped; "soft dot": an i or j before, and only marks not above since.
  const upperAll = def("upper codes", ["codes", "own", "greek", "lithuanian", "after cased", "accented vowel", "soft dot"], (cs, o, el, lt, after, acc, soft) => list(cs, () => k.list(), (c, rest) =>
    k.if(and(lt, and(soft, same(c, k.int(0x307)))), k.call(me, rest, o, el, lt, after, acc, soft),
      k.let("mapped", k.call(mapped, c, o, k.x(upperSeveral), k.x(upperRuns)), (m0) =>
      k.let("accented", and(el, k.call(among, c, k.x(greekAccented))), (accented) =>
      k.let("upper", k.if(and(el, and(acc, one(m0, 0x399))), k.list(k.int(0x3aa)),
        k.if(and(el, and(acc, one(m0, 0x3a5))), k.list(k.int(0x3ab)),
          k.if(and(accented, and(one(m0, 0x397), and(not(after), not(k.call(casedNext, rest))))), k.list(k.int(0x389)), m0))), (m) =>
      k.call(then, m, k.call(me, rest, o, el, lt, afterNow(c, after),
        and(accented, list(m, () => k.x(FALSE), (x) => or(...VOWELS.map((v) => same(x, k.int(v)))))),
        and(lt, k.call(S.or, k.call(among, c, k.x(softDotted)), and(soft, and(isIgnorable(c), not(k.call(among, c, k.x(above)))))))))))))));
  // An accent above comes next, other marks looked through.
  const aboveNext0 = def("accent above next", ["codes"], (cs) => list(cs, () => k.x(FALSE), (n, rest) =>
    k.if(k.call(among, n, k.x(above)), k.x(TRUE), k.if(isIgnorable(n), k.call(me, rest), k.x(FALSE)))));
  // "dotted I": the I before was Turkish's I with a dot, whose dot is
  // taken into the i.
  const lowerAll = def("lower codes", ["codes", "own", "after cased", "turkic", "lithuanian", "dotted I"], (cs, o, after, tk, lt, dotted) => list(cs, () => k.list(), (c, rest) =>
    k.let("dot next", list(rest, () => k.x(FALSE), (n) => same(n, k.int(0x307))), (dotNext) =>
    k.let("above next", k.call(aboveNext0, rest), (aboveNext) =>
    k.if(and(dotted, same(c, k.int(0x307))), k.call(me, rest, o, after, tk, lt, k.x(FALSE)),
      k.if(and(same(c, k.int(0x3a3)), and(after, not(k.call(casedNext, rest)))), k.call(CONS, k.int(0x3c2), k.call(me, rest, o, k.x(TRUE), tk, lt, k.x(FALSE))),
        k.if(and(tk, and(same(c, k.int(0x49)), dotNext)), k.call(CONS, k.int(0x69), k.call(me, rest, o, k.x(TRUE), tk, lt, k.x(TRUE))),
          k.let("mapped", k.call(mapped, c, o, k.x(lowerSeveral), k.x(lowerRuns)), (m) =>
          k.call(then, k.if(and(lt, and(aboveNext, or(same(c, k.int(0x49)), same(c, k.int(0x4a)), same(c, k.int(0x12e))))), k.call(then, m, k.list(k.int(0x307))), m),
            k.call(me, rest, o, afterNow(c, after), tk, lt, k.x(FALSE)))))))))));

  const upper = def("table uppercase", ["text", "locale"], (t, l) => k.let("language", k.call(language, l), (lang) =>
    k.call(text, k.call(upperAll, k.call(codes, t), own(lang, trUpper, ltUpper, elUpper), same(lang, k.lit("el")), same(lang, k.lit("lt")), k.x(FALSE), k.x(FALSE), k.x(FALSE)))));
  const lower = def("table lowercase", ["text", "locale"], (t, l) => k.let("language", k.call(language, l), (lang) =>
    k.call(text, k.call(lowerAll, k.call(codes, t), own(lang, trLower, ltLower), k.x(FALSE), turkic(lang), same(lang, k.lit("lt")), k.x(FALSE)))));

  // Grapheme clusters (L214e3b): UAX #29's rules over the grapheme tables
  // (grapheme-tables.ts), as `graphemeBreaks` there has them. The tables
  // are one list of Ints, three a run: its first and last code point, and
  // its kind, the class times 8, plus 4 if it is pictographic, plus its
  // conjunct (1 consonant, 2 linker, 3 extend).
  const CLASSES: GraphemeClass[] = ["Other", "CR", "LF", "Control", "Extend", "ZWJ", "Regional_Indicator", "Prepend", "SpacingMark", "L", "V", "T", "LV", "LVT"];
  const cl = (c: GraphemeClass) => CLASSES.indexOf(c);
  const CONJ = { "": 0, Consonant: 1, Linker: 2, Extend: 3 } as const;
  const gruns = k.def("grapheme runs");
  k.define(gruns, k.list(...loadGraphemes(savedGraphemes as SavedGraphemes).flatMap((r) => [r.from, r.to, cl(r.g.cls) * 8 + (r.g.pictographic ? 4 : 0) + CONJ[r.g.conjunct]].map((x) => k.int(x)))));
  defs.push(gruns);
  const kindIn = def("grapheme kind in", ["code", "runs"], (c, rs) => list(rs, () => k.int(0), (from, r1) => list(r1, () => k.int(0), (to, r2) => list(r2, () => k.int(0), (kind, rest) =>
    k.if(less(c, from), k.int(0), k.if(less(to, c), k.call(me, c, rest), kind))))));
  const clsOf = (kind: Id) => k.call(INT_OPS.shiftDown, kind, k.int(3));
  const pictOf = (kind: Id) => same(k.call(INT_OPS.bitAnd, kind, k.int(4)), k.int(4));
  const conjOf = (kind: Id) => k.call(INT_OPS.bitAnd, kind, k.int(3));
  const isCls = (x: Id, ...cs: GraphemeClass[]) => or(...cs.map((c) => same(x, k.int(cl(c)))));
  // Whether the clusters join between a and b, given what the rules that
  // look further know through a: flags in a row, an emoji then Extends
  // before a, a conjunct with a linker.
  const joins = def("graphemes join", ["a", "b", "flags", "emoji before", "conjunct"], (a, b, ri, emoji, conj) =>
    k.let("A", clsOf(a), (A) => k.let("B", clsOf(b), (B) =>
      k.if(and(isCls(A, "CR"), isCls(B, "LF")), k.x(TRUE),
        k.if(or(isCls(A, "CR", "LF", "Control"), isCls(B, "CR", "LF", "Control")), k.x(FALSE),
          k.if(and(isCls(A, "L"), isCls(B, "L", "V", "LV", "LVT")), k.x(TRUE),
            k.if(and(isCls(A, "LV", "V"), isCls(B, "V", "T")), k.x(TRUE),
              k.if(and(isCls(A, "LVT", "T"), isCls(B, "T")), k.x(TRUE),
                k.if(isCls(B, "Extend", "ZWJ", "SpacingMark"), k.x(TRUE),
                  k.if(isCls(A, "Prepend"), k.x(TRUE),
                    k.if(and(same(conj, k.int(2)), same(conjOf(b), k.int(1))), k.x(TRUE),
                      k.if(and(isCls(A, "ZWJ"), and(emoji, pictOf(b))), k.x(TRUE),
                        and(isCls(A, "Regional_Indicator"), and(isCls(B, "Regional_Indicator"), same(k.call(INT_OPS.bitAnd, ri, k.int(1)), k.int(1))))))))))))))));
  // The clusters of the characters left, `so far` the one being made and
  // `a` its last character's kind.
  const clusters = def("grapheme clusters", ["characters", "a", "flags", "emoji", "conjunct", "so far"], (chs, a, ri, emoji, conj, cur) =>
    list(chs, () => k.list(cur), (ch, rest) =>
      k.let("b", k.call(kindIn, k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, ch)), k.thunk(() => k.int(0))), k.x(gruns)), (b) =>
      k.let("flags now", k.if(isCls(clsOf(a), "Regional_Indicator"), add(ri, k.int(1)), k.int(0)), (ri2) =>
      k.let("emoji now", k.call(S.or, pictOf(a), and(emoji, isCls(clsOf(a), "Extend"))), (emoji2) =>
      k.let("conjunct now", k.if(same(conjOf(a), k.int(1)), k.int(1),
        k.if(and(not(same(conj, k.int(0))), or(same(conjOf(a), k.int(2)), same(conjOf(a), k.int(3)))), k.if(same(conjOf(a), k.int(2)), k.int(2), conj), k.int(0))), (conj2) =>
      k.if(k.call(joins, a, b, ri2, emoji, conj2),
        k.call(me, rest, b, ri2, emoji2, conj2, k.text(cur, ch)),
        k.call(CONS, cur, k.call(me, rest, b, ri2, emoji2, conj2, ch)))))))));
  const graphemes = def("table graphemes", ["text"], (t) => list(k.call(TEXT_OPS.characters, t), () => k.list(), (ch, rest) =>
    k.call(clusters, rest, k.call(kindIn, k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, ch)), k.thunk(() => k.int(0))), k.x(gruns)), k.int(0), k.x(FALSE), k.int(0), ch)));

  // Collation's root order (L214e4b): UTS #10's comparison over the
  // collation tables (collation-tables.ts), as `collationCompare` there
  // has it, for NFC text: a precomposed letter has its NFD's elements in
  // the tables, so text is read code point by code point (the root's
  // contractions, й and آ, are each one in NFC), and a Hangul syllable is
  // taken apart into its jamo by arithmetic. The tables are text, six bits
  // a character from "0": a record is 14 characters, its first code point
  // (4), how many from there (3, 0 for one of several elements), the
  // primary (3, or where its elements start in the second text), the
  // secondary (2, or how many elements), the tertiary (1) and a mark's
  // combining class (1); an element there is 7, the same four. The records
  // are in chunks of 256, each with its first code point, found by halves
  // within. An element is one Int, primary · 2^21 + secondary · 2^12 +
  // tertiary · 2^6 + combining class.
  const col = savedCollation as SavedCollation;
  const enc = (v: number, w: number) => { let out = ""; for (let i = w - 1; i >= 0; i--) out += String.fromCharCode(48 + (Math.floor(v / 64 ** i) % 64)); return out; };
  let multiText = "";
  const records = [
    ...col.runs,
    ...col.multi.map(([c, es]) => { const at = multiText.length / 7; for (const [p, sec, ter, cc] of es) multiText += enc(p, 3) + enc(sec, 2) + enc(ter, 1) + enc(cc ?? 0, 1); return [c, 0, at, es.length, 0, 0]; }),
  ].sort((a, b) => a[0] - b[0]);
  const REC = 14, CHUNK = 256;
  const Chunk = k.type("Collation chunk", [], [["collation chunk", [["first", () => k.tref(INT)], ["records", () => k.tref(STRING)]]]]);
  defs.push(Chunk.def);
  const chunkV = Chunk.v["collation chunk"];
  const chunks = k.def("collation chunks");
  const chunkList: Id[] = [];
  for (let i = 0; i < records.length; i += CHUNK) chunkList.push(k.call(chunkV, k.int(records[i][0]), k.lit(records.slice(i, i + CHUNK).map(([a, b, c, d, e, f]) => enc(a, 4) + enc(b, 3) + enc(c, 3) + enc(d, 2) + enc(e, 1) + enc(f, 1)).join(""))));
  k.define(chunks, k.list(...chunkList));
  const multis = k.def("collation several");
  k.define(multis, k.lit(multiText));
  defs.push(chunks, multis);
  const mul = (a: Id, b: Id) => k.call(INT_OPS.mul, a, b);
  const quot = (a: Id, b: Id) => k.call(INT_OPS.quotient, a, b);
  const rem = (a: Id, b: Id) => k.call(INT_OPS.remainder, a, b);
  const codeOf = (ch: Id) => k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, ch)), k.thunk(() => k.int(0)));
  // The number `width` characters long at `at`.
  const num = def("collation number", ["text", "at", "width"], (t, at, w) => k.if(same(w, k.int(0)), k.int(0),
    add(mul(k.call(me, t, at, sub(w, k.int(1))), k.int(64)), sub(codeOf(k.call(TEXT_OPS.slice, t, add(at, sub(w, k.int(1))), add(at, w))), k.int(48)))));
  const field = (recs: Id, i: Id, off: number, w: number) => k.call(num, recs, add(mul(i, k.int(REC)), k.int(off)), k.int(w));
  // The chunk a code point's record is in: the last whose first isn't after it.
  const chunkOf = def("collation chunk of", ["code", "chunks", "found"], (c, cs, got) => list(cs, () => got, (x, rest) =>
    k.match(x, [{ variant: chunkV, names: ["first", "records"], body: ([first, recs]) => k.if(less(c, first), got, k.call(me, c, rest, recs)) }])));
  // The last record from lo to hi whose first code point isn't after c.
  const find = def("collation find", ["code", "records", "lo", "hi"], (c, recs, lo, hi) => k.if(same(lo, hi), lo,
    k.let("mid", quot(add(add(lo, hi), k.int(1)), k.int(2)), (mid) => k.if(less(c, field(recs, mid, 0, 4)), k.call(me, c, recs, lo, sub(mid, k.int(1))), k.call(me, c, recs, mid, hi)))));
  const element = (p: Id, sec: Id, ter: Id, cc: Id) => add(add(add(mul(p, k.int(2 ** 21)), mul(sec, k.int(4096))), mul(ter, k.int(64))), cc);
  const several = def("collation several of", ["at", "count"], (at, n) => k.if(same(n, k.int(0)), k.list(),
    k.call(CONS, element(k.call(num, k.x(multis), mul(at, k.int(7)), k.int(3)), k.call(num, k.x(multis), add(mul(at, k.int(7)), k.int(3)), k.int(2)), k.call(num, k.x(multis), add(mul(at, k.int(7)), k.int(5)), k.int(1)), k.call(num, k.x(multis), add(mul(at, k.int(7)), k.int(6)), k.int(1))),
      k.call(me, add(at, k.int(1)), sub(n, k.int(1))))));
  // A code point's elements, none for one the tables don't have.
  const elementsOf = def("collation elements of", ["code"], (c) => k.let("records", k.call(chunkOf, c, k.x(chunks), k.lit("")), (recs) =>
    k.if(same(recs, k.lit("")), k.list(),
      k.let("i", k.call(find, c, recs, k.int(0), sub(quot(k.call(TEXT_OPS.length, recs), k.int(REC)), k.int(1))), (i) =>
        k.let("from", field(recs, i, 0, 4), (from) => k.let("count", field(recs, i, 4, 3), (count) =>
          k.if(same(count, k.int(0)),
            k.if(same(from, c), k.call(several, field(recs, i, 7, 3), field(recs, i, 10, 2)), k.list()),
            k.if(less(sub(c, from), count), k.list(element(add(field(recs, i, 7, 3), sub(c, from)), field(recs, i, 10, 2), field(recs, i, 12, 1), field(recs, i, 13, 1))), k.list()))))))));
  // A Hangul syllable's jamo (Unicode §3.12), each looked up.
  const hangul = def("collation hangul", ["code"], (c) => k.let("s", sub(c, k.int(HANGUL.from)), (sv) =>
    k.call(then, k.call(elementsOf, add(k.int(0x1100), quot(sv, k.int(588)))), k.call(then, k.call(elementsOf, add(k.int(0x1161), quot(rem(sv, k.int(588)), k.int(28)))),
      k.if(same(rem(sv, k.int(28)), k.int(0)), k.list(), k.call(elementsOf, add(k.int(0x11a7), rem(sv, k.int(28)))))))));
  const textElements = def("collation text elements", ["codes"], (cs) => list(cs, () => k.list(), (c, rest) =>
    k.call(then, k.if(and(not(less(c, k.int(HANGUL.from))), not(less(k.int(HANGUL.to), c))), k.call(hangul, c), k.call(elementsOf, c)), k.call(me, rest))));
  // Each level's weights: the primaries but the marks' zeros, all the secondaries, all the tertiaries.
  // The marks after a letter in canonical order (NFD's), by their combining
  // class: NFC text may have a letter's own accent before a mark with a
  // lower class (Í then a mark below).
  const cccOf = (e: Id) => rem(e, k.int(64));
  const insert = def("collation insert", ["element", "run"], (e, run) => list(run, () => k.list(e), (x, rest) =>
    k.if(less(cccOf(e), cccOf(x)), k.call(CONS, e, run), k.call(CONS, x, k.call(me, e, rest)))));
  const canonical = def("collation canonical", ["elements", "run"], (es, run) => list(es, () => run, (e, rest) =>
    k.if(same(cccOf(e), k.int(0)), k.call(then, run, k.call(CONS, e, k.call(me, rest, k.list()))), k.call(me, rest, k.call(insert, e, run)))));
  const primaries = def("collation primaries", ["elements"], (es) => list(es, () => k.list(), (e, rest) => k.let("p", quot(e, k.int(2 ** 21)), (p) =>
    k.if(same(p, k.int(0)), k.call(me, rest), k.call(CONS, p, k.call(me, rest))))));
  const secondaries = def("collation secondaries", ["elements"], (es) => list(es, () => k.list(), (e, rest) => k.call(CONS, rem(quot(e, k.int(4096)), k.int(512)), k.call(me, rest))));
  const tertiaries = def("collation tertiaries", ["elements"], (es) => list(es, () => k.list(), (e, rest) => k.call(CONS, rem(quot(e, k.int(64)), k.int(64)), k.call(me, rest))));
  const order = (v: string) => k.x(v);
  const compareWeights = def("collation compare weights", ["a", "b"], (a, b) => list(a, () => list(b, () => order(ORDER_V.same), () => order(ORDER_V.before)), (x, ra) =>
    list(b, () => order(ORDER_V.after), (y, rb) => k.if(less(x, y), order(ORDER_V.before), k.if(less(y, x), order(ORDER_V.after), k.call(me, ra, rb))))));
  const orSame = (o: Id, next: () => Id) => k.match(o, [
    { variant: ORDER_V.same, names: [], body: next },
    { variant: ORDER_V.before, names: [], body: () => order(ORDER_V.before) },
    { variant: ORDER_V.after, names: [], body: () => order(ORDER_V.after) },
  ]);
  const collated = def("table collated", ["a", "b"], (a, b) => k.let("x", k.call(canonical, k.call(textElements, k.call(codes, a)), k.list()), (x) => k.let("y", k.call(canonical, k.call(textElements, k.call(codes, b)), k.list()), (y) =>
    orSame(k.call(compareWeights, k.call(primaries, x), k.call(primaries, y)), () =>
      orSame(k.call(compareWeights, k.call(secondaries, x), k.call(secondaries, y)), () =>
        k.call(compareWeights, k.call(tertiaries, x), k.call(tertiaries, y)))))));

  const offered = [upper, lower, graphemes, collated];
  const comments: Record<Id, string> = {
    [upper]: "The text in capitals as `uppercase` gives it, written in Ters over the Unicode case tables, so a target with no host to ask (WebAssembly, C) gives the same.",
    [graphemes]: "The text's grapheme clusters, the characters a reader sees, as `graphemes` gives them, written in Ters over the Unicode grapheme tables (UAX #29), so a target with no host to ask (WebAssembly, C) gives the same.",
    [lower]: "The text in small letters as `lowercase` gives it (final sigma included), written in Ters over the Unicode case tables, so a target with no host to ask (WebAssembly, C) gives the same.",
    [collated]: "Which of two texts comes first in the Unicode Collation Algorithm's root order, as `collate` gives it in the root locale, written in Ters over the Unicode collation tables, so a target with no host to ask (WebAssembly, C) gives the same.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, offered, merge(prelude, std));
  if (!p.ok) throw new Error(`the cases module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("cases", p.code, p.names, offered.map(at), p.pins, notes, []);
}
