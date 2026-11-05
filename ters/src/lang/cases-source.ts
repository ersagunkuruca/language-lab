// The cases module (BACKLOG L214e2, TEXT-2026-11-03 "How each target does
// it"): uppercase and lowercase written in Ters over the case tables
// (case-tables.ts, read off the host when the library is built), for the
// targets with no host to ask. WebAssembly and C run these (L214e5); the
// evaluator and compiled JS keep the host's `uppercase` and `lowercase`,
// and test/cases.test.ts checks the two agree.
//
// A character maps by its locale's own difference first (Turkish and
// Azeri's dotted and dotless i), then by the code points that map to
// several (ß to SS), then by the runs. Two rules look at the letters
// around, as Unicode's SpecialCasing has them:
//  - final sigma: Σ lowercase is ς after a cased letter and not before
//    one, σ elsewhere. "Cased" here is a letter that has a case mapping,
//    and a case-ignorable letter between (an apostrophe, a mark) isn't
//    looked through yet;
//  - Turkish and Azeri: I followed by a combining dot above (U+0307)
//    lowercases to i, the dot taken in.
// Greek capitals lose their accents a letter at a time (the table);
// what Greek uppercase does around them is left: a combining accent after
// a letter dropped, and a diaeresis added where a dropped accent kept two
// vowels apart. So is Lithuanian's dot kept before an accent (L214e2 in
// DONE).

import { merge, type Id } from "../model.ts";
import { prelude } from "../prelude.ts";
import { caseTables, type CaseTable } from "./case-tables.ts";
import { loadGraphemes, type GraphemeClass, type SavedGraphemes } from "./grapheme-tables.ts";
import savedGraphemes from "../../library/graphemes.json" with { type: "json" };
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { CONS, FALSE, INT_OPS, LIST, LOCALE_V, NIL, NONE, S, SOME, std, TEXT_OPS, TRUE } from "./std.ts";
import { INT } from "./types.ts";

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
  // A letter with a case: one of the mappings moves it.
  const cased = def("has a case", ["code"], (c) => not(and(same(k.call(byRuns, c, k.x(upperRuns)), k.list(c)), same(k.call(byRuns, c, k.x(lowerRuns)), k.list(c)))));

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

  // xs then ys.
  const then = def("case then", ["xs", "ys"], (xs, ys) => list(xs, () => ys, (x, rest) => k.call(CONS, x, k.call(me, rest, ys))));
  const upperAll = def("upper codes", ["codes", "own"], (cs, o) => list(cs, () => k.list(), (c, rest) =>
    k.call(then, k.call(mapped, c, o, k.x(upperSeveral), k.x(upperRuns)), k.call(me, rest, o))));
  // Σ is 0x3A3, σ 0x3C3, ς 0x3C2; I is 0x49, i 0x69, the dot above 0x307.
  // "dotted I": the I before was Turkish's I with a dot, whose dot is
  // taken into the i.
  const lowerAll = def("lower codes", ["codes", "own", "after cased", "turkic", "dotted I"], (cs, o, after, tk, dotted) => list(cs, () => k.list(), (c, rest) =>
    k.let("next cased", list(rest, () => k.x(FALSE), (n) => k.call(cased, n)), (nextCased) =>
    k.let("dot next", list(rest, () => k.x(FALSE), (n) => same(n, k.int(0x307))), (dotNext) =>
    k.if(and(dotted, same(c, k.int(0x307))), k.call(me, rest, o, after, tk, k.x(FALSE)),
      k.if(and(same(c, k.int(0x3a3)), and(after, not(nextCased))), k.call(CONS, k.int(0x3c2), k.call(me, rest, o, k.x(TRUE), tk, k.x(FALSE))),
        k.if(and(tk, and(same(c, k.int(0x49)), dotNext)), k.call(CONS, k.int(0x69), k.call(me, rest, o, k.x(TRUE), tk, k.x(TRUE))),
          k.call(then, k.call(mapped, c, o, k.x(lowerSeveral), k.x(lowerRuns)), k.call(me, rest, o, k.call(cased, c), tk, k.x(FALSE))))))))));

  const upper = def("table uppercase", ["text", "locale"], (t, l) => k.let("language", k.call(language, l), (lang) =>
    k.call(text, k.call(upperAll, k.call(codes, t), own(lang, trUpper, ltUpper, elUpper)))));
  const lower = def("table lowercase", ["text", "locale"], (t, l) => k.let("language", k.call(language, l), (lang) =>
    k.call(text, k.call(lowerAll, k.call(codes, t), own(lang, trLower, ltLower), k.x(FALSE), turkic(lang), k.x(FALSE)))));

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
  const or = (...xs: Id[]) => xs.reduce((a, b) => k.call(S.or, a, b));
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

  const offered = [upper, lower, graphemes];
  const comments: Record<Id, string> = {
    [upper]: "The text in capitals as `uppercase` gives it, written in Ters over the Unicode case tables, so a target with no host to ask (WebAssembly, C) gives the same.",
    [graphemes]: "The text's grapheme clusters, the characters a reader sees, as `graphemes` gives them, written in Ters over the Unicode grapheme tables (UAX #29), so a target with no host to ask (WebAssembly, C) gives the same.",
    [lower]: "The text in small letters as `lowercase` gives it (final sigma included), written in Ters over the Unicode case tables, so a target with no host to ask (WebAssembly, C) gives the same.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, offered, merge(prelude, std));
  if (!p.ok) throw new Error(`the cases module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("cases", p.code, p.names, offered.map(at), p.pins, notes, []);
}
