// The tunings module (BACKLOG L273): a tuning is the pitch of its first
// step, its steps in cents within a period (an octave, 1200 cents, unless
// it says otherwise), and a name for each step. Equal divisions of the
// octave (12, 24, 53, any n), just intonation as Rationals, and Scala .scl
// files (Manuel Op de Coul's format, the Scala program's, prior art) all
// make one; a tuner reads a heard pitch against any of them.
//
// Cents are Ellis's (A. J. Ellis, 1885): 1200·log₂ of a ratio. 53-TET's
// names follow Turkish theory's naturals on 53 commas (Arel–Ezgi–Uzdilek:
// a whole tone is 9 commas and the limma, bakiye, 4), each step named by
// its nearest natural and how many commas it is off. Hz are s⁻¹ to the
// unit checker and cents a plain number (a ratio's logarithm), so neither
// is a unit of its own (units.ts has SI's bases).

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { CONS, INT_OPS, LIST, NIL, PAIR_V, S, TEXT_OPS, std } from "./std.ts";
import { INT, NUMBER, STRING } from "./types.ts";

export const TWELVE = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
// A quarter tone above each of the twelve: "C+" is 50 cents above C.
export const TWENTY_FOUR = TWELVE.flatMap((n) => [n, `${n}+`]);
// Each of the 53 commas by its nearest natural and how many commas off.
const NATURALS: [string, number][] = [["C", 0], ["D", 9], ["E", 18], ["F", 22], ["G", 31], ["A", 40], ["B", 49], ["C", 53]];
export const FIFTY_THREE = Array.from({ length: 53 }, (_, s) => {
  const [name, at] = NATURALS.reduce((best, n) => (Math.abs(s - n[1]) < Math.abs(s - best[1]) ? n : best));
  const d = s - at;
  return d === 0 ? name : `${name}${d > 0 ? "+" : "−"}${Math.abs(d)}`;
});

export function buildTunings(pre: Module, nums: Module): Module {
  const k = new Lang(merge(prelude, std, pre.code, nums.code));
  const from = (m: Module) => (name: string) => {
    const d = m.code.defs.find((x) => m.names[x] === name);
    if (!d) throw new Error(`tunings: no ${name}`);
    return d;
  };
  const lib = from(pre), num = from(nums);
  const map = lib("map"), length = lib("length"), numbered = lib("numbered"), itemAt = lib("item at"), keep = lib("keep"), startsWith = lib("starts with"), addedAtEnd = lib("added at end");
  const ratioToFloat = num("as float64");
  const f = { add: (a: Id, b: Id) => k.call(B.add, a, b), sub: (a: Id, b: Id) => k.call(B.sub, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b), div: (a: Id, b: Id) => k.call(B.div, a, b) };
  const i = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), float: (a: Id) => k.call(INT_OPS.toNumber, a), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b) };
  const pairOf = (p: Id, names: [string, string], body: (a: Id, b: Id) => Id) => k.match(p, [{ variant: PAIR_V, names, body: ([a, b]) => body(a, b) }]);
  // a / b, 0 where b is 0, so the checker reads the guard (L125b).
  const over = (a: Id, b: Id, name: string) => k.let(name, b, (d) => k.if(k.call(S.equal, d, k.lit(0)), k.lit(0), f.div(a, d)));
  // A Float64's whole part as an Int, 0 for one that has none (infinity).
  const wholeOf = (x: Id) => k.call(S.first, k.thunk(() => k.call(INT_OPS.wholePart, k.call(S.floor, x))), k.thunk(() => k.int(0)));

  const listOf = (t: Id) => k.tref(LIST, t);
  const T = k.type("Tuning", [], [["tuning", [
    ["name", () => k.tref(STRING)], ["tonic", () => k.tref(NUMBER)], ["steps", () => listOf(k.tref(NUMBER))], ["period", () => k.tref(NUMBER)], ["names", () => listOf(k.tref(STRING))],
  ]]], "tunings");
  const TV = T.v.tuning;
  const R = k.type("Reading", [], [["reading", [
    ["name", () => k.tref(STRING)], ["step", () => k.tref(INT)], ["octave", () => k.tref(INT)], ["cents off", () => k.tref(NUMBER)], ["target", () => k.tref(NUMBER)],
  ]]], "tuner readings");
  const RV = R.v.reading;
  const tuningOf = (t: Id, body: (name: Id, tonic: Id, steps: Id, period: Id, names: Id) => Id) =>
    k.match(t, [{ variant: TV, names: ["name", "tonic", "steps", "period", "names"], body: ([a, b, c, d, e]) => body(a, b, c, d, e) }]);

  // 1200·log₂(high / low), 0 where either isn't above 0.
  const cents = k.def("cents between");
  k.define(cents, k.fn(["low", "high"], (lo, hi) => k.if(k.call(S.and, k.call(S.less, k.lit(0), lo), k.call(S.less, k.lit(0), hi)),
    // Both are above 0, so the log has an answer; the checker can't see
    // that through the division, so its none is 0 too.
    k.call(S.first, k.thunk(() => f.mul(k.lit(1200 / Math.LN2), k.call(B.log, over(hi, lo, "low")))), k.thunk(() => k.lit(0))), k.lit(0))));
  // The pitch `amount` cents above `pitch`.
  const centsAbove = k.def("cents above");
  k.define(centsAbove, k.fn(["pitch", "amount"], (p, c) => f.mul(p, k.call(B.exp, f.mul(c, k.lit(Math.LN2 / 1200))))));

  const equal = k.def("equal temperament");
  k.define(equal, k.fn(["divisions", "tonic", "names"], (n, tonic, names) => k.call(TV,
    k.call(S.concat, k.call(INT_OPS.show, n), k.lit("-TET")), tonic,
    k.call(map, k.call(INT_OPS.range, n), k.fn(["step"], (st) => over(f.mul(k.lit(1200), i.float(st)), i.float(n), "divisions"))),
    k.lit(1200), names)));
  const C4 = 440 * Math.pow(2, -9 / 12);
  const names = (xs: string[]) => k.list(...xs.map((x) => k.lit(x)));
  const twelve = k.def("twelve tone");
  k.define(twelve, k.fn(["a4"], (a) => k.call(equal, k.int(12), f.mul(a, k.lit(C4 / 440)), names(TWELVE))));
  const quarter = k.def("quarter tones");
  k.define(quarter, k.fn(["a4"], (a) => k.call(equal, k.int(24), f.mul(a, k.lit(C4 / 440)), names(TWENTY_FOUR))));
  // A is 40 commas above C (four whole tones and a limma: 9 + 9 + 4 + 9 + 9).
  const fiftyThree = k.def("fifty three tone");
  k.define(fiftyThree, k.fn(["a4"], (a) => k.call(equal, k.int(53), f.mul(a, k.lit(Math.pow(2, -40 / 53))), names(FIFTY_THREE))));

  const just = k.def("just intonation");
  k.define(just, k.fn(["name", "tonic", "ratios", "names"], (name, tonic, rs, ns) => k.call(TV, name, tonic,
    k.call(map, rs, k.fn(["ratio"], (r) => k.call(cents, k.lit(1), k.call(ratioToFloat, r)))), k.lit(1200), ns)));

  // The same tuning moved so that `step` in `octave` (C4's octave is 4)
  // sounds at `pitch`.
  const withRef = k.def("with reference");
  k.define(withRef, k.fn(["tuning", "step", "octave", "pitch"], (t, st, oc, hz) => tuningOf(t, (name, _tonic, steps, period, ns) =>
    k.call(TV, name, k.call(centsAbove, hz, k.call(B.neg, f.add(f.mul(i.float(k.call(INT_OPS.sub, oc, k.int(4))), period), k.call(itemAt, steps, st, k.lit(0))))), steps, period, ns))));

  // A step's pitch, in an octave (the tonic's is 4).
  const stepPitch = k.def("step pitch");
  k.define(stepPitch, k.fn(["tuning", "step", "octave"], (t, st, oc) => tuningOf(t, (_n, tonic, steps, period) =>
    k.call(centsAbove, tonic, f.add(f.mul(i.float(k.call(INT_OPS.sub, oc, k.int(4))), period), k.call(itemAt, steps, st, k.lit(0)))))));

  // The step closest to `within` cents among numbered steps, as (place,
  // its cents), starting from the best so far.
  const closest = k.def("closest step");
  k.define(closest, k.fn(["within", "steps", "best"], (w, xs, best) => k.match(xs, [
    { variant: NIL, names: [], body: () => best },
    { variant: CONS, names: ["step", "rest"], body: ([x, rest]) => pairOf(x, ["place", "cents"], (_pl, c) => pairOf(best, ["best place", "best cents"], (_bp, bc) =>
      k.call(closest, w, rest, k.if(k.call(S.less, k.call(S.abs, f.sub(w, c)), k.call(S.abs, f.sub(w, bc))), x, best)))) },
  ])));

  // What a tuner says about a pitch heard: the nearest step, its octave,
  // how many cents the pitch is above it (below when negative), and the
  // pitch it should be.
  const nearest = k.def("nearest step");
  k.define(nearest, k.fn(["tuning", "pitch"], (t, hz) => tuningOf(t, (_name, tonic, steps, period, ns) =>
    k.let("cents above tonic", k.call(cents, tonic, hz), (c) =>
      k.let("octave", wholeOf(over(c, period, "period")), (o) =>
        k.let("within", f.sub(c, f.mul(i.float(o), period)), (w) =>
          k.let("n", k.call(length, steps), (n) =>
            pairOf(k.call(closest, w, k.call(addedAtEnd, k.call(numbered, steps), k.call(PAIR_V, n, period)), k.call(PAIR_V, k.int(0), k.call(itemAt, steps, k.int(0), k.lit(0)))), ["place", "step cents"], (pl, sc) =>
              k.let("next octave", k.call(S.equal, pl, n), (up) =>
                k.let("step", k.if(up, k.int(0), pl), (st) =>
                  k.let("its octave", k.if(up, i.add(o, k.int(1)), o), (oc) =>
                    k.call(RV, k.call(itemAt, ns, st, k.call(INT_OPS.show, st)), st, i.add(oc, k.int(4)), f.sub(w, sc),
                      k.call(centsAbove, tonic, f.add(f.mul(i.float(o), period), sc))))))))))))));

  // A word: the text up to the first space or tab, after any.
  const words = k.def("words of");
  k.define(words, k.fn(["line"], (l) => k.call(keep,
    k.call(TEXT_OPS.split, k.call(TEXT_OPS.joinAll, k.call(map, k.call(TEXT_OPS.characters, l), k.fn(["c"], (c) =>
      k.if(k.call(S.or, k.call(S.equal, c, k.lit("\t")), k.call(S.equal, c, k.lit("\r"))), k.lit(" "), c))), k.lit("")), k.lit(" ")),
    k.fn(["word"], (w) => k.call(S.not, k.call(S.equal, w, k.lit("")))))));
  const firstWord = (l: Id) => k.match(k.call(words, l), [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["word", "rest"], body: ([w]) => w },
  ]);
  // A pitch line's value in cents: cents when it has a point, else a ratio
  // a/b, or a whole number a (a/1).
  const sclValue = k.def("scala value");
  k.define(sclValue, k.fn(["word"], (w) => k.if(k.call(lib("contains text"), w, k.lit(".")), k.call(TEXT_OPS.readNumber, w),
    k.match(k.call(TEXT_OPS.split, w, k.lit("/")), [
      { variant: CONS, names: ["top", "rest"], body: ([top, rest]) => k.match(rest, [
        { variant: NIL, names: [], body: () => k.call(cents, k.lit(1), k.call(TEXT_OPS.readNumber, top)) },
        { variant: CONS, names: ["bottom", "more"], body: ([bot]) => k.call(cents, k.call(TEXT_OPS.readNumber, bot), k.call(TEXT_OPS.readNumber, top)) },
      ]) },
    ], k.call(S.fail)))));

  // A Scala .scl file: lines starting with ! are comments, then a
  // description, the number of pitches, and the pitches, the last of them
  // the period. No answer for a file that isn't one.
  const scala = k.def("scala tuning");
  k.define(scala, k.fn(["file", "tonic"], (file, tonic) =>
    k.let("lines", k.call(keep, k.call(TEXT_OPS.split, file, k.lit("\n")), k.fn(["line"], (l) => k.call(S.not, k.call(startsWith, l, k.lit("!"))))), (ls) =>
      k.match(ls, [
        { variant: CONS, names: ["description", "rest"], body: ([desc, rest]) => k.match(rest, [
          { variant: CONS, names: ["count line", "pitch lines"], body: ([cl, pls]) =>
            k.let("values", k.call(map, k.call(lib("take"), pls, wholeOf(k.call(TEXT_OPS.readNumber, firstWord(cl)))), k.fn(["line"], (l) => k.call(sclValue, firstWord(l)))), (vs) =>
              k.let("count", k.call(length, vs), (n) => k.if(i.less(n, k.int(1)), k.call(S.fail),
                k.call(TV, k.call(TEXT_OPS.joinAll, k.call(words, desc), k.lit(" ")), tonic,
                  k.call(CONS, k.lit(0), k.call(lib("take"), vs, k.call(INT_OPS.sub, n, k.int(1)))),
                  k.call(itemAt, vs, k.call(INT_OPS.sub, n, k.int(1)), k.lit(1200)),
                  NIL)))) },
        ], k.call(S.fail)) },
      ], k.call(S.fail)))));

  const offered = [T.def, R.def, cents, centsAbove, equal, twelve, quarter, fiftyThree, just, withRef, stepPitch, nearest, scala];
  const helpers = [closest, words, sclValue];
  const comments: Record<Id, string> = {
    [T.def]: "A tuning: the pitch of its first step (its tonic, in Hz, in octave 4), each step's cents above it within a period (1200 cents is an octave), and the steps' names.",
    [R.def]: "What a tuner reads off a pitch: the nearest step's name, place and octave, how many cents the pitch is above it (below when negative), and the pitch the step should be.",
    [cents]: "How far high is above low in cents, 1200·log₂(high/low): 100 is an equal-tempered semitone. 0 where either isn't above 0. Ellis's cents (1885).",
    [centsAbove]: "The pitch that many cents above this one.",
    [equal]: "The octave divided into equal steps: 12 is the piano's, 24 has quarter tones, 53 is Turkish theory's commas. Names are optional (an empty list numbers the steps).",
    [twelve]: "12-TET with C to B, tuned so A4 is the pitch given (440 is concert pitch).",
    [quarter]: "24-TET: the twelve and a quarter tone above each (C+ is 50 cents above C), A4 at the pitch given.",
    [fiftyThree]: "53-TET, the comma tuning of Turkish theory: steps named by the nearest natural and how many commas off (D+4 is 4 commas above D), naturals placed as Arel–Ezgi–Uzdilek place them (whole tone 9 commas, limma 4); A4 at the pitch given.",
    [just]: "Just intonation: the steps are ratios to the tonic (3/2 is a pure fifth), as Rationals.",
    [withRef]: "The same tuning moved so that a step in an octave sounds at the pitch given: A4 = 432, say.",
    [stepPitch]: "The pitch of a step in an octave (C4's octave is 4).",
    [nearest]: "What a tuner says about a pitch heard: the nearest step, its octave, how many cents off, and the pitch it should be.",
    [scala]: "A tuning from a Scala .scl file (Manuel Op de Coul's format): ! comments, a description, the number of pitches, then each pitch as cents (with a point) or a ratio, the last one the period. No answer for a file that isn't one.",
    [closest]: "A helper of nearest step. Not offered.",
    [words]: "A helper of scala tuning. Not offered.",
    [sclValue]: "A helper of scala tuning. Not offered.",
  };
  const p = publish(merge(prelude, std, pre.code, nums.code, k.code), k.names, [...offered, ...helpers], merge(prelude, std, pre.code, nums.code));
  if (!p.ok) throw new Error(`the tunings module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("tunings", p.code, p.names, offered.map(at), { ...pre.pins, ...nums.pins, ...p.pins }, notes, helpers.map(at));
}
