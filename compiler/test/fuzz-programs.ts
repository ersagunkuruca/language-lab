// Small random typed definitions for fuzz.test.ts (C101): over Float64,
// Int, Bool and List Int, from the palette's own parts, each shown as text.

import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { CONS, FALSE, INT_OPS, NIL, RANDOM_OP, S, SET, SHOW_ANY, TEXT_OPS, TRUE } from "../../ters/src/lang/std.ts";
import { INT, NUMBER } from "../../ters/src/lang/types.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";

// mulberry32: a small seeded generator, the same numbers on every machine.
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)] };
}

// Float64, Int, Bool, List Int, Text, a data type of three cases (Shape)
// and a record (Box).
type Ty = "F" | "I" | "B" | "L" | "T" | "D" | "R";
type Scope = Record<Ty, Id[]>;

export function program(seed: number, count: number) {
  const k = new Lang(LIBRARY.code), r = random(seed);
  const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;
  const call = (f: Id, ...xs: Id[]) => k.call(f, ...xs);
  let names = 0;
  const fresh = () => `v${names++}`;
  const float = () => k.tref(NUMBER), integer = () => k.tref(INT);
  const Shape = k.type("Shape", [], [["dot", []], ["circle", [["radius", float]]], ["rect", [["width", integer], ["height", float]]]]);
  const Box = k.type("Box", [], [["box", [["count", integer], ["size", float]]]]);
  const shape_ = Shape.v, box = Box.v;

  // An expression of type t, at most `depth` deep, over what's in scope.
  function gen(t: Ty, s: Scope, depth: number): Id {
    const leaf = depth <= 0 || r.next() < 0.2;
    const sub = (u: Ty, sc: Scope = s) => gen(u, sc, depth - 1);
    // Shared by every type: a variable, an if, a let, a match on a list.
    if (!leaf) {
      const shape = r.int(12);
      if (shape === 0) return k.if(sub("B"), sub(t), sub(t));
      if (shape === 1) {
        const u = r.pick<Ty>(["F", "I", "L", "T", "D", "R"]);
        return k.let(fresh(), sub(u), (v) => gen(t, { ...s, [u]: [...s[u], v] }, depth - 1));
      }
      if (shape === 3) return k.match(sub("D"), [
        { variant: shape_.dot, names: [], body: () => sub(t) },
        { variant: shape_.circle, names: [fresh()], body: ([rad]) => gen(t, { ...s, F: [...s.F, rad] }, depth - 1) },
        { variant: shape_.rect, names: [fresh(), fresh()], body: ([w, h]) => gen(t, { ...s, I: [...s.I, w], F: [...s.F, h] }, depth - 1) },
      ]);
      if (shape === 4 && t !== "B") return k.fold(sub("L"), [
        { variant: NIL, names: [], body: () => sub(t) },
        { variant: CONS, names: [fresh(), fresh()], results: [null, fresh()], body: ([h], [, acc]) => gen(t, { ...s, I: [...s.I, h], [t]: [...s[t], acc!] }, depth - 1) },
      ]);
      if (shape === 2) return k.match(sub("L"), [
        { variant: NIL, names: [], body: () => sub(t) },
        { variant: CONS, names: [fresh(), fresh()], body: ([h, rest]) => gen(t, { ...s, I: [...s.I, h], L: [...s.L, rest] }, depth - 1) },
      ]);
    }
    if ((leaf || r.next() < 0.15) && s[t].length && r.next() < 0.7) return k.x(r.pick(s[t]));
    switch (t) {
      case "F": {
        // 1e300 now and then, so a product can overflow (a stop).
        if (leaf) return k.lit(r.pick([0, 1, -1, 0.5, 2.25, -3, 10, 0.1, 1e-3, 1e15, 1e300]));
        // An operation with no answer at some inputs, and a fallback.
        const orElse = (e: Id) => k.call(S.first, k.thunk(() => e), k.thunk(() => sub("F")));
        return r.pick<() => Id>([
          () => call(B.add, sub("F"), sub("F")),
          () => call(B.sub, sub("F"), sub("F")),
          () => call(B.mul, sub("F"), sub("F")),
          () => call(B.neg, sub("F")),
          () => call(INT_OPS.toNumber, sub("I")),
          () => call(S.floor, sub("F")),
          () => call(lib("smaller"), sub("F"), sub("F")),
          () => call(Box.f["box.size"], sub("R")),
          () => orElse(call(B.div, sub("F"), sub("F"))),
          () => orElse(call(B.sqrt, sub("F"))),
          () => orElse(call(B.log, sub("F"))),
          () => orElse(call(S.mod, sub("F"), sub("F"))),
          // C108, C106: a text read as a number; a seeded draw.
          () => orElse(call(TEXT_OPS.readNumber, sub("T"))),
          () => call(S.seeded, sub("F"), k.thunk(() => call(B.add, call(RANDOM_OP), call(RANDOM_OP)))),
          () => call(B.sin, sub("F")),
          () => call(B.exp, sub("F")),
          () => call(B.atan2, sub("F"), sub("F")),
          () => orElse(call(B.pow, sub("F"), sub("F"))),
        ])();
      }
      case "I": {
        if (leaf) return k.int(r.pick([0, 1, -1, 2, 3, 7, -10, 1000, 2n ** 62n]));
        const orElse = (e: Id) => k.call(S.first, k.thunk(() => e), k.thunk(() => sub("I")));
        return r.pick<() => Id>([
          () => call(INT_OPS.add, sub("I"), sub("I")),
          () => call(INT_OPS.sub, sub("I"), sub("I")),
          () => call(INT_OPS.mul, sub("I"), sub("I")),
          () => call(INT_OPS.neg, sub("I")),
          () => call(lib("length"), sub("L")),
          () => call(lib("item at"), sub("L"), sub("I"), sub("I")),
          () => call(Box.f["box.count"], sub("R")),
          () => call(TEXT_OPS.length, sub("T")),
          () => orElse(call(INT_OPS.quotient, sub("I"), sub("I"))),
          () => orElse(call(INT_OPS.remainder, sub("I"), sub("I"))),
          () => orElse(call(INT_OPS.read, sub("T"))),
          () => orElse(call(TEXT_OPS.code, sub("T"))),
          () => orElse(call(TEXT_OPS.find, sub("T"), sub("T"))),
          // Small powers only: a power of a power would be millions of digits.
          () => orElse(call(INT_OPS.power, call(INT_OPS.remainder, sub("I"), k.int(10)), call(INT_OPS.remainder, sub("I"), k.int(20)))),
          () => call(lib("sum"), sub("L")),
          () => orElse(call(INT_OPS.wholePart, sub("F"))),
        ])();
      }
      case "B": {
        if (leaf) return k.x(r.next() < 0.5 ? TRUE : FALSE);
        return r.pick<() => Id>([
          () => call(S.less, sub("F"), sub("F")),
          () => call(INT_OPS.less, sub("I"), sub("I")),
          () => k.equal(sub("I"), sub("I")),
          () => k.equal(sub("L"), sub("L")),
          () => call(S.not, sub("B")),
          () => k.equal(sub("T"), sub("T")),
          () => call(TEXT_OPS.less, sub("T"), sub("T")),
          () => call(lib("starts with"), sub("T"), sub("T")),
          () => call(lib("contains"), sub("L"), sub("I")),
          () => k.equal(sub("D"), sub("D")),
          () => k.equal(sub("R"), sub("R")),
        ])();
      }
      case "L": {
        if (leaf) return r.next() < 0.3 ? k.list() : k.list(...Array.from({ length: 1 + r.int(3) }, () => k.int(r.int(9) - 4)));
        return r.pick<() => Id>([
          () => call(CONS, sub("I"), sub("L")),
          () => call(lib("append"), sub("L"), sub("L")),
          () => call(lib("reverse"), sub("L")),
          () => call(lib("take"), sub("L"), sub("I")),
          () => call(lib("drop"), sub("L"), sub("I")),
          () => call(lib("replace at"), sub("L"), sub("I"), sub("I")),
          // map with a closure: the item, and whatever is in scope.
          () => call(lib("map"), sub("L"), k.fn([fresh()], (v) => gen("I", { ...s, I: [...s.I, v] }, depth - 1))),
          () => call(lib("sort"), sub("L")),
          () => call(lib("keep"), sub("L"), k.fn([fresh()], (v) => gen("B", { ...s, I: [...s.I, v] }, depth - 1))),
        ])();
      }
      case "T": {
        if (leaf) return k.lit(r.pick(["", "a", "héllo", "🎉", "a b", 'say "hi"\\', "tab\there\n", "\u0001\u001f\u007f", "30.5", "-2", "1e3", "42", ".5", "007"]));
        return r.pick<() => Id>([
          () => call(S.concat, sub("T"), sub("T")),
          () => call(SHOW_ANY, sub("I")),
          () => call(SHOW_ANY, sub("F")),
          () => call(SHOW_ANY, sub("D")),
          () => call(TEXT_OPS.slice, sub("T"), sub("I"), sub("I")),
          () => call(S.show, sub("F")),
          () => call(INT_OPS.show, sub("I")),
          () => call(lib("uppercase"), sub("T")),
          () => call(TEXT_OPS.joinAll, call(TEXT_OPS.split, sub("T"), sub("T")), sub("T")),
          () => k.call(S.first, k.thunk(() => call(TEXT_OPS.fromCode, sub("I"))), k.thunk(() => sub("T"))),
        ])();
      }
      case "D": {
        if (leaf) return r.next() < 0.3 ? k.x(shape_.dot) : call(shape_.circle, k.lit(r.pick([0, 1.5, -2])));
        return r.pick<() => Id>([
          () => call(shape_.circle, sub("F")),
          () => call(shape_.rect, sub("I"), sub("F")),
        ])();
      }
      case "R":
        // set (C106): a field of a box changed, the other kept.
        if (!leaf && r.next() < 0.3) return r.next() < 0.5 ? call(SET, k.x(Box.f["box.count"]), sub("R"), sub("I")) : call(SET, k.x(Box.f["box.size"]), sub("R"), sub("F"));
        return call(box.box, leaf ? k.int(r.int(5)) : sub("I"), leaf ? k.lit(0.5) : sub("F"));
    }
  }

  const defs: { def: Id; result: Ty }[] = [];
  for (let i = 0; i < count; i++) {
    const result = r.pick<Ty>(["F", "I", "B", "L", "T", "D", "R"]), def = k.def(`g${i}`);
    // Its inputs are a Float64, an Int and a List Int: each used once
    // first, so its type is that whatever the body does.
    k.define(def, k.fn(["x", "n", "xs"], (x, n, xs) =>
      k.let("x0", call(B.add, x, k.lit(0)), (x0) =>
        k.let("n0", call(INT_OPS.add, n, k.int(0)), (n0) =>
          k.let("xs0", call(lib("append"), xs, k.list(n0)), (xs0) =>
            call(SHOW_ANY, gen(result, { F: [x0], I: [n0], L: [xs0], B: [], T: [], D: [], R: [] }, 4)))))));
    defs.push({ def, result });
  }
  const code = base(k.code), names2 = baseNames(k.names);
  return { code, names: names2, info: infer(code, names2, undefined, checkOptions), defs };
}
