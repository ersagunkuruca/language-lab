// Small random typed definitions for fuzz.test.ts (C101): over Float64,
// Int, Bool and List Int, from the palette's own parts, each shown as text.

import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ABORT_OP, ARRAY_OPS, COMPLEX_V, CONS, RATIO, LIST, FALSE, FIRST, INT_OPS, NIL, PAIR_V, RANDOM_OP, S, SECOND, SET, SHOW_ANY, TEXT_OPS, TRUE } from "../../ters/src/lang/std.ts";
import { INT, NUMBER, STRING } from "../../ters/src/lang/types.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";

// mulberry32: a small seeded generator, the same numbers on every machine.
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)] };
}

// Float64, Int, Bool, List Int, Text, a data type of three cases (Shape),
// a record (Box), List Float64 and List Shape (C119), and a tuple
// (Int, Float64) (C120), an Array Int (C129), a fraction (C130) and a
// complex number (C131), and a Map Int Int (C132) and a Set Int (C133)
// held and passed on.
type Ty = "F" | "I" | "B" | "L" | "T" | "D" | "R" | "P" | "Q" | "U" | "A" | "X" | "Z" | "M" | "E";
type Scope = Record<Ty, Id[]>;

export function program(seed: number, count: number, inputs: bigint[][] = []) {
  const k = new Lang(LIBRARY.code), r = random(seed);
  const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;
  const call = (f: Id, ...xs: Id[]) => k.call(f, ...xs);
  let names = 0;
  const fresh = () => `v${names++}`;
  const float = () => k.tref(NUMBER), integer = () => k.tref(INT);
  const Shape = k.type("Shape", [], [["dot", []], ["circle", [["radius", float]]], ["rect", [["width", integer], ["height", float]]]]);
  const Box = k.type("Box", [], [["box", [["count", integer], ["size", float]]]]);
  const shape_ = Shape.v, box = Box.v;
  // A record holding a function, a record and a list of data (C126).
  const Kit = k.type("Kit", [], [["kit", [["step", () => k.tfun([integer()], integer())], ["inner", () => k.tref(Box.def)], ["shapes", () => k.tref(LIST, k.tref(Shape.def))]]]]);
  // An effect of the program's own whose operations never return (C123):
  // performed inside a handler of it, through lets, matches and closures.
  const Escape = k.effect("Escape", [["bail", [["code", () => integer()]], null], ["quit", [["why", () => k.tref(STRING)], ["by", float]], null]]);
  let handling = 0;

  // An expression of type t, at most `depth` deep, over what's in scope.
  function gen(t: Ty, s: Scope, depth: number): Id {
    const leaf = depth <= 0 || r.next() < 0.2;
    const sub = (u: Ty, sc: Scope = s) => gen(u, sc, depth - 1);
    // An Int from −m to m: a remainder by m, which has an answer.
    // A Map Int Int from two lists, and a Set Int (trees or hash tables,
    // as each engine chooses).
    // Maps are values like any other (C132): let, matched on, folded,
    // returned, so each engine's representation is held and passed on.
    const mapOf = () => sub("M");
    const setOf = () => sub("E");
    // Its step's type has no Choice, so its body is under a first.
    const kitOf = () => call(Kit.v.kit, k.fn([fresh()], (v) => k.call(S.first, k.thunk(() => gen("I", { ...s, I: [...s.I, v] }, depth - 1)), k.thunk(() => k.int(0)))), sub("R"), sub("Q"));
    // Text keys and items (C122): a Map Text Int and a Set Text, from a
    // text split at spaces and commas.
    const words = () => call(TEXT_OPS.split, call(S.concat, sub("T"), k.lit(r.pick([" a b", ",x,y", "", " é 🎉"]))), k.lit(r.pick([" ", ","])));
    const textMap = () => call(lib("as map"), call(lib("zipped"), words(), sub("L")));
    const textSet = () => call(lib("as set"), words());
    // Keys and items that are pairs of an Int and a Text (C63f, C63k),
    // which every target's hash tables take.
    const pairOf = () => call(PAIR_V, sub("I"), sub("T"));
    const pairMap = () => call(lib("as map"), call(lib("zipped"), call(lib("zipped"), sub("L"), words()), sub("L")));
    const pairSet = () => call(lib("as set"), call(lib("zipped"), sub("L"), words()));
    // A search with several answers (C134): an item of a list, kept where
    // a condition on it holds, then worked on.
    const search = () => k.thunk(() => k.let(fresh(), call(S.oneOf, sub("L")), (v) =>
      k.if(gen("B", { ...s, I: [...s.I, v] }, depth - 1), gen("I", { ...s, I: [...s.I, v] }, depth - 1), call(S.fail))));
    const small = (m: number) => k.call(S.first, k.thunk(() => call(INT_OPS.remainder, sub("I"), k.int(m))), k.thunk(() => k.int(0)));
    // Shared by every type: a variable, an if, a let, a match on a list.
    if (!leaf) {
      const shape = r.int(12);
      if (shape === 0) return k.if(sub("B"), sub(t), sub(t));
      if (shape === 1) {
        const u = r.pick<Ty>(["F", "I", "L", "T", "D", "R", "P", "Q", "U", "A", "X", "Z", "M", "E"]);
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
      // A tuple taken apart (C120).
      if (shape === 6) return k.match(sub("U"), [
        { variant: PAIR_V, names: [fresh(), fresh()], body: ([a, b]) => gen(t, { ...s, I: [...s.I, a], F: [...s.F, b] }, depth - 1) },
      ]);
      // A match on a list of Float64s or of shapes (C119).
      if (shape === 5) {
        const [lt, it] = r.next() < 0.5 ? ["P", "F"] as const : ["Q", "D"] as const;
        return k.match(sub(lt), [
          { variant: NIL, names: [], body: () => sub(t) },
          { variant: CONS, names: [fresh(), fresh()], body: ([h, rest]) => gen(t, { ...s, [it]: [...s[it], h], [lt]: [...s[lt], rest] }, depth - 1) },
        ]);
      }
    }
    // The generic helpers, at this type (C124).
    if (!leaf && generic.length && r.next() < 0.06) {
      const lt = listOf[t], [choose, around, countWhere, lastOr] = genericDefs;
      const pick = r.int(lt ? 4 : 1);
      if (pick === 0) return call(choose, sub("B"), sub(t), sub(t));
      if (pick === 1) return call(lastOr, sub(lt!), sub(t));
      if (pick === 2) return call(lastOr, call(around, sub(t), sub(lt!)), sub(t));
      return call(choose, k.equal(call(countWhere, sub(lt!), k.fn([fresh()], (v) => gen("B", { ...s, [t]: [...s[t], v] }, depth - 1))), sub("I")), sub(t), sub(t));
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
          () => call(lib("item at"), sub("P"), sub("I"), sub("F")),
          () => call(SECOND, sub("U")),
          () => k.match(sub("Z"), [{ variant: COMPLEX_V, names: [fresh(), fresh()], body: (ri) => r.pick(ri) }]),
          () => call(lib("modulus"), sub("Z")),
          () => call(lib("angle of"), sub("Z")),
          () => call(Box.f["box.size"], sub("R")),
          () => orElse(call(B.div, sub("F"), sub("F"))),
          () => orElse(call(B.sqrt, sub("F"))),
          () => orElse(call(B.log, sub("F"))),
          () => orElse(call(S.mod, sub("F"), sub("F"))),
          // C108, C106: a text read as a number; a seeded draw.
          () => orElse(call(TEXT_OPS.readNumber, sub("T"))),
          () => call(S.seeded, sub("F"), k.thunk(() => call(B.add, call(RANDOM_OP), call(RANDOM_OP)))),
          () => call(B.sin, sub("F")),
          () => call(S.abs, sub("F")),
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
          () => call(lib("length"), r.next() < 0.5 ? sub("P") : sub("Q")),
          () => call(FIRST, sub("U")),
          () => call(ARRAY_OPS.length, sub("A")),
          () => k.match(sub("X"), [{ variant: RATIO, names: [fresh(), fresh()], body: (tb) => r.pick(tb) }]),
          () => orElse(call(ARRAY_OPS.at, sub("A"), sub("I"))),
          () => orElse(call(ARRAY_OPS.first, sub("A"))),
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
          () => call(S.count, search()),
          () => k.call(S.first, k.thunk(() => call(S.fuel, k.lit(r.pick([0, 1, 3, 8, 20, 200])), k.thunk(() => call(wander, small(60), sub("I"))))), k.thunk(() => sub("I"))),
          () => k.call(S.first, search(), k.thunk(() => sub("I"))),
          // A search under a budget (C145): several answers, the first
          // taken, or none, which gives the otherwise as running out does.
          () => k.call(S.first, k.thunk(() => call(S.fuel, k.lit(r.pick([0, 3, 200])), search())), k.thunk(() => sub("I"))),
          () => call(INT_OPS.abs, sub("I")),
          () => orElse(call(INT_OPS.wholePart, sub("F"))),
          () => call(lib("set size"), call(lib("as set"), sub("L"))),
          // A handler of Abort written in place: the reason's length.
          () => k.handle(k.if(sub("B"), call(ABORT_OP, sub("T")), sub("I")), [{ variant: ABORT_OP, names: [fresh()], body: ([why]) => call(TEXT_OPS.length, why) }]),
          () => orElse(call(lib("last of items"), sub("L"))),
          () => call(lib("map size"), call(lib("put"), mapOf(), sub("I"), sub("I"))),
          () => orElse(call(lib("value at"), mapOf(), sub("I"))),
          () => orElse(call(lib("smallest item"), setOf())),
          () => orElse(call(lib("largest key"), mapOf())),
          // A helper given a box and a shape (C116): C lends what it only reads.
          () => (helpers.length ? call(r.pick(helpers), sub("R"), sub("D"), sub("I")) : sub("I")),
          () => call(lib("queue size"), call(lib("queued"), call(lib("queue of"), sub("L")), sub("I"))),
          () => {
            handling++;
            const body = sub("I");
            handling--;
            return k.handle(body, [
              { variant: Escape.op.bail, names: [fresh()], body: ([c]) => gen("I", { ...s, I: [...s.I, c] }, depth - 1) },
              { variant: Escape.op.quit, names: [fresh(), fresh()], body: ([w, b]) => gen("I", { ...s, T: [...s.T, w], F: [...s.F, b] }, depth - 1) },
            ]);
          },
          () => (handling ? k.if(sub("B"), r.next() < 0.5 ? call(Escape.op.bail, sub("I")) : call(Escape.op.quit, sub("T"), sub("F")), sub("I")) : sub("I")),
          () => call(lib("map size"), call(lib("put"), textMap(), sub("T"), sub("I"))),
          () => orElse(call(lib("value at"), textMap(), sub("T"))),
          () => call(lib("map size"), call(lib("put"), pairMap(), pairOf(), sub("I"))),
          () => orElse(call(lib("value at"), pairMap(), pairOf())),
          () => call(lib("set size"), call(lib("add item"), pairSet(), pairOf())),
          () => call(lib("set size"), call(lib("set union"), textSet(), textSet())),
          // A recursive helper of the program's own, and a function
          // given to one with what's in scope closed over (C121).
          () => (recursive.length ? call(r.pick(recursive), sub("L"), sub("I")) : sub("I")),
          // Functions as values in a list (C125): each closes over its
          // item and what's in scope, then all are applied and summed, or
          // the first one found by a fold.
          () => {
            const fs = call(lib("map"), sub("L"), k.fn([fresh()], (v) => k.fn([fresh()], (w) => gen("I", { ...s, I: [...s.I, v, w] }, depth - 1))));
            if (r.next() < 0.5) return call(lib("sum"), call(lib("map"), fs, k.fn([fresh()], (f) => k.call(f, sub("I")))));
            return k.call(k.fold(fs, [
              { variant: NIL, names: [], body: () => k.fn([fresh()], (z) => z) },
              { variant: CONS, names: [fresh(), fresh()], results: [null, fresh()], body: ([f], [, g]) => k.fn([fresh()], (z) => k.call(g!, k.call(f, z))) },
            ]), sub("I"));
          },
          // A kit (C126): its function applied, its box's count, its shapes'
          // length, after a set of its inner box now and then.
          () => {
            const kit = kitOf();
            const pick = r.int(3);
            if (pick === 0) return k.call(call(Kit.f["kit.step"], kit), sub("I"));
            if (pick === 1) return call(Box.f["box.count"], call(Kit.f["kit.inner"], r.next() < 0.5 ? kit : call(SET, k.x(Kit.f["kit.inner"]), kit, sub("R"))));
            return call(lib("length"), call(Kit.f["kit.shapes"], kit));
          },
          () => (higher.length ? call(r.pick(higher), k.fn([fresh()], (v) => gen("I", { ...s, I: [...s.I, v] }, depth - 1)), sub("I")) : sub("I")),
        ])();
      }
      case "B": {
        if (leaf) return k.x(r.next() < 0.5 ? TRUE : FALSE);
        return r.pick<() => Id>([
          () => call(S.less, sub("F"), sub("F")),
          () => call(INT_OPS.less, sub("I"), sub("I")),
          () => k.equal(sub("I"), sub("I")),
          () => k.equal(sub("L"), sub("L")),
          () => k.equal(sub("P"), sub("P")),
          () => k.equal(sub("Q"), sub("Q")),
          () => k.equal(sub("U"), sub("U")),
          () => k.equal(sub("X"), sub("X")),
          () => k.equal(sub("Z"), sub("Z")),
          () => call(lib("fraction less than"), sub("X"), sub("X")),
          () => call(lib("contains"), sub("Q"), sub("D")),
          () => call(S.not, sub("B")),
          () => call(r.next() < 0.5 ? S.and : S.or, sub("B"), sub("B")),
          () => k.equal(sub("T"), sub("T")),
          () => call(TEXT_OPS.less, sub("T"), sub("T")),
          () => call(lib("starts with"), sub("T"), sub("T")),
          () => call(lib("contains"), sub("L"), sub("I")),
          () => call(lib("has key"), call(lib("remove key"), mapOf(), sub("I")), sub("I")),
          () => call(lib("has item"), call(lib("set union"), setOf(), setOf()), sub("I")),
          () => call(lib("has key"), call(lib("remove key"), textMap(), sub("T")), sub("T")),
          () => call(lib("has item"), call(lib("set difference"), textSet(), textSet()), sub("T")),
          () => call(lib("has key"), call(lib("remove key"), pairMap(), pairOf()), pairOf()),
          () => call(lib("has item"), call(lib("set union"), pairSet(), pairSet()), pairOf()),
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
          () => call(lib("inserted at"), sub("L"), sub("I"), sub("I")),
          () => call(lib("keys of"), mapOf()),
          () => call(lib("values of"), call(lib("merge maps"), mapOf(), mapOf())),
          () => call(lib("items of"), call(lib("set difference"), setOf(), setOf())),
          () => k.call(S.first, k.thunk(() => call(lib("queue items"), call(lib("dequeued"), call(lib("queue of"), sub("L"))))), k.thunk(() => sub("L"))),
          () => call(lib("range from"), small(20), small(20)),
          () => call(ARRAY_OPS.items, sub("A")),
          () => call(S.all, search()),
          () => call(lib("flat map"), sub("L"), k.fn([fresh()], (v) => k.list(v, gen("I", { ...s, I: [...s.I, v] }, depth - 1)))),
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
          () => call(SHOW_ANY, sub("P")),
          () => call(SHOW_ANY, sub("Q")),
          () => call(SHOW_ANY, sub("U")),
          () => call(SHOW_ANY, sub("A")),
          () => call(SHOW_ANY, sub("X")),
          () => call(lib("show fraction"), sub("X")),
          () => call(SHOW_ANY, sub("Z")),
          () => call(SHOW_ANY, sub("M")),
          () => call(SHOW_ANY, sub("E")),
          () => call(lib("show complex"), sub("Z")),
          () => call(SHOW_ANY, call(lib("merge maps"), textMap(), textMap())),
          () => call(SHOW_ANY, textSet()),
          () => call(TEXT_OPS.joinAll, call(lib("keys of"), textMap()), sub("T")),
          () => call(SHOW_ANY, call(lib("keys of"), pairMap())),
          () => call(SHOW_ANY, call(lib("items of"), pairSet())),
          () => k.call(S.first, k.thunk(() => call(lib("smallest item"), textSet())), k.thunk(() => sub("T"))),
          // Lists of tuples: zipped, sorted (by the Int, then the Float64).
          () => call(SHOW_ANY, call(lib("sort"), call(lib("zipped"), sub("L"), sub("P")))),
          () => call(TEXT_OPS.slice, sub("T"), sub("I"), sub("I")),
          () => call(S.show, sub("F")),
          () => call(INT_OPS.show, sub("I")),
          () => call(lib("uppercase"), sub("T")),
          () => call(lib("repeated"), sub("T"), small(4)),
          // Abort under attempt, and an outcome taken apart again (C117).
          () => call(SHOW_ANY, call(lib("attempt"), k.thunk(() => k.if(sub("B"), call(ABORT_OP, sub("T")), sub("I"))))),
          () => call(SHOW_ANY, call(lib("attempt"), k.thunk(() => call(lib("value or abort"), call(lib("attempt"), k.thunk(() => k.if(sub("B"), call(ABORT_OP, sub("T")), sub("L")))))))),
          // A call of an earlier definition, one that calls none itself.
          () => { const d = callable.length ? r.pick(callable) : null; if (!d) return sub("T"); calls = true; return call(d, sub("F"), sub("I"), sub("L")); },
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
      case "P": {
        if (leaf) return r.next() < 0.3 ? k.list() : k.list(...Array.from({ length: 1 + r.int(3) }, () => k.lit(r.pick([0, 1, -1, 0.5, 2.25, -3, 1e300]))));
        return r.pick<() => Id>([
          () => call(CONS, sub("F"), sub("P")),
          () => call(lib("append"), sub("P"), sub("P")),
          () => call(lib("reverse"), sub("P")),
          () => call(lib("take"), sub("P"), sub("I")),
          () => call(lib("drop"), sub("P"), sub("I")),
          () => call(lib("sort"), sub("P")),
          () => call(lib("replace at"), sub("P"), sub("I"), sub("F")),
          () => call(lib("map"), sub("L"), k.fn([fresh()], (v) => gen("F", { ...s, I: [...s.I, v] }, depth - 1))),
          () => call(lib("keep"), sub("P"), k.fn([fresh()], (v) => gen("B", { ...s, F: [...s.F, v] }, depth - 1))),
        ])();
      }
      case "Q": {
        if (leaf) return r.next() < 0.3 ? k.list() : k.list(...Array.from({ length: 1 + r.int(3) }, () => (r.next() < 0.3 ? k.x(shape_.dot) : call(shape_.circle, k.lit(r.pick([0, 1.5, -2]))))));
        return r.pick<() => Id>([
          () => call(CONS, sub("D"), sub("Q")),
          () => call(lib("append"), sub("Q"), sub("Q")),
          () => call(lib("reverse"), sub("Q")),
          () => call(lib("sort"), sub("Q")),
          () => call(lib("inserted at"), sub("Q"), sub("I"), sub("D")),
          () => call(lib("map"), sub("P"), k.fn([fresh()], (v) => gen("D", { ...s, F: [...s.F, v] }, depth - 1))),
          () => call(lib("keep"), sub("Q"), k.fn([fresh()], (v) => gen("B", { ...s, D: [...s.D, v] }, depth - 1))),
        ])();
      }
      case "A": {
        if (leaf) return call(ARRAY_OPS.of, k.list(...Array.from({ length: r.int(4) }, () => k.int(r.int(9) - 4))));
        return r.pick<() => Id>([
          () => call(ARRAY_OPS.of, sub("L")),
          () => call(ARRAY_OPS.push, sub("A"), sub("I")),
          () => call(ARRAY_OPS.pushFront, sub("A"), sub("I")),
          () => call(ARRAY_OPS.rest, sub("A")),
          () => call(ARRAY_OPS.replaceAt, sub("A"), small(4), sub("I")),
        ])();
      }
      case "X": {
        // Fractions (C130): made from Ints, kept in lowest terms, a 0
        // bottom with no answer.
        const orElse = (e: Id) => k.call(S.first, k.thunk(() => e), k.thunk(() => sub("X")));
        if (leaf) return call(lib("as fraction"), k.int(r.int(7) - 3));
        return r.pick<() => Id>([
          () => orElse(call(lib("fraction"), sub("I"), sub("I"))),
          () => call(lib("as fraction"), sub("I")),
          () => call(lib("add fractions"), sub("X"), sub("X")),
          () => call(lib("subtract fractions"), sub("X"), sub("X")),
          () => call(lib("multiply fractions"), sub("X"), sub("X")),
          () => call(lib("negate fraction"), sub("X")),
          () => orElse(call(lib("divide fractions"), sub("X"), sub("X"))),
        ])();
      }
      case "Z": {
        // Complex numbers (C131): what Float64 has no answer for has one
        // here, except where these have none too.
        const orElse = (e: Id) => k.call(S.first, k.thunk(() => e), k.thunk(() => sub("Z")));
        if (leaf) return r.next() < 0.3 ? k.x(lib("i")) : call(lib("as complex"), k.lit(r.pick([0, 1, -4, 0.5])));
        return r.pick<() => Id>([
          () => call(COMPLEX_V, sub("F"), sub("F")),
          () => call(lib("as complex"), sub("F")),
          () => call(lib("add complex"), sub("Z"), sub("Z")),
          () => call(lib("subtract complex"), sub("Z"), sub("Z")),
          () => call(lib("multiply complex"), sub("Z"), sub("Z")),
          () => call(lib("negate complex"), sub("Z")),
          () => call(lib("complex conjugate"), sub("Z")),
          () => call(lib("from polar"), sub("F"), sub("F")),
          () => call(lib("complex exp"), sub("Z")),
          () => orElse(call(lib("divide complex"), sub("Z"), sub("Z"))),
          () => orElse(call(lib("complex sqrt"), sub("Z"))),
          () => orElse(call(lib("complex log"), sub("Z"))),
          () => orElse(call(lib("complex power"), sub("Z"), sub("Z"))),
          () => orElse(call(lib(r.pick(["complex asin", "complex acos"])), sub("Z"))),
        ])();
      }
      case "M": {
        if (leaf) return r.next() < 0.5 ? k.x(lib("empty map")) : call(lib("as map"), call(lib("zipped"), sub("L"), sub("L")));
        return r.pick<() => Id>([
          () => call(lib("as map"), call(lib("zipped"), sub("L"), sub("L"))),
          () => call(lib("put"), sub("M"), sub("I"), sub("I")),
          () => call(lib("remove key"), sub("M"), sub("I")),
          () => call(lib("merge maps"), sub("M"), sub("M")),
        ])();
      }
      case "E": {
        if (leaf) return r.next() < 0.5 ? k.x(lib("empty set")) : call(lib("as set"), sub("L"));
        return r.pick<() => Id>([
          () => call(lib("as set"), sub("L")),
          () => call(lib("add item"), sub("E"), sub("I")),
          () => call(lib("remove item"), sub("E"), sub("I")),
          () => call(lib(r.pick(["set union", "set intersection", "set difference"])), sub("E"), sub("E")),
        ])();
      }
      case "U": {
        if (leaf) return call(PAIR_V, k.int(r.int(5) - 2), k.lit(r.pick([0, 0.5, -3])));
        return r.pick<() => Id>([
          () => call(PAIR_V, sub("I"), sub("F")),
          () => call(PAIR_V, call(FIRST, sub("U")), call(B.add, call(SECOND, sub("U")), sub("F"))),
          () => call(lib("item at"), call(lib("zipped"), sub("L"), sub("P")), sub("I"), sub("U")),
        ])();
      }
      case "R":
        // set (C106): a field of a box changed, the other kept.
        if (!leaf && r.next() < 0.3) return r.next() < 0.5 ? call(SET, k.x(Box.f["box.count"]), sub("R"), sub("I")) : call(SET, k.x(Box.f["box.size"]), sub("R"), sub("F"));
        return call(box.box, leaf ? k.int(r.int(5)) : sub("I"), leaf ? k.lit(0.5) : sub("F"));
    }
  }

  // A recursion on an Int that may not end, as far as the checker can
  // tell (Diverge): Collatz's steps from n, counted onto c. The
  // definitions call it under `with fuel` (C135), so every engine must
  // spend the same fuel per call and run out at the same call.
  const wander = k.def("wander");
  k.define(wander, k.fn(["n", "c"], (n, c) => k.if(call(INT_OPS.less, n, k.int(2)), c,
    call(wander, k.if(k.equal(k.call(S.first, k.thunk(() => call(INT_OPS.remainder, n, k.int(2))), k.thunk(() => k.int(0))), k.int(0)),
      k.call(S.first, k.thunk(() => call(INT_OPS.quotient, n, k.int(2))), k.thunk(() => k.int(0))),
      call(INT_OPS.add, call(INT_OPS.mul, n, k.int(3)), k.int(1))), call(INT_OPS.add, c, k.int(1))))));
  // Helpers from a box, a shape and an Int to an Int, which the
  // definitions call: some only read the box's fields, some make boxes.
  const helpers: Id[] = [], recursive: Id[] = [], higher: Id[] = [], generic: Id[] = [], genericDefs: Id[] = [];
  // The list type of each item type, where there is one.
  const listOf: Partial<Record<Ty, Ty>> = { I: "L", F: "P", D: "Q" };
  const callable: Id[] = [];
  let calls = false;
  for (let i = 0; i < 6; i++) {
    const h = k.def(`h${i}`);
    k.define(h, k.fn(["b", "s", "m"], (b, s0, m) =>
      k.let("c0", call(Box.f["box.count"], b), (c0) =>
        k.let("m0", call(INT_OPS.add, m, k.int(0)), (m0) => {
          const sc = (more: Partial<Scope> = {}): Scope => ({ F: [...(more.F ?? [])], I: [c0, m0, ...(more.I ?? [])], L: [], B: [], T: [], D: [s0], R: [b], P: [], Q: [], U: [], A: [], X: [], Z: [], M: [], E: [] });
          return k.match(s0, [
            { variant: shape_.dot, names: [], body: () => gen("I", sc(), 3) },
            { variant: shape_.circle, names: [fresh()], body: ([rad]) => gen("I", sc({ F: [rad] }), 3) },
            { variant: shape_.rect, names: [fresh(), fresh()], body: ([w, h2]) => gen("I", sc({ I: [w], F: [h2] }), 3) },
          ]);
        }))));
    helpers.push(h);
  }
  // Recursive helpers over a list and an Int, each recurring on the
  // rest, the result used after the call (no tail call); and helpers
  // given a function, calling it twice or folding a list with it (C121).
  for (let i = 0; i < 4; i++) {
    const h = k.def(`rec${i}`);
    k.define(h, k.fn(["xs", "a"], (xs, a) => k.match(xs, [
      { variant: NIL, names: [], body: () => gen("I", { F: [], I: [a], L: [], B: [], T: [], D: [], R: [], P: [], Q: [], U: [], A: [], X: [], Z: [], M: [], E: [] }, 2) },
      { variant: CONS, names: [fresh(), fresh()], body: ([hd, tl]) => k.let(fresh(), call(h, tl, gen("I", { F: [], I: [a, hd], L: [tl], B: [], T: [], D: [], R: [], P: [], Q: [], U: [], A: [], X: [], Z: [], M: [], E: [] }, 2)), (got) =>
        gen("I", { F: [], I: [got, hd, a], L: [tl], B: [], T: [], D: [], R: [], P: [], Q: [], U: [], A: [], X: [], Z: [], M: [], E: [] }, 2)) },
    ])));
    recursive.push(h);
  }
  {
    const twice = k.def("twice");
    k.define(twice, k.fn(["f", "x"], (f, x) => k.call(f, k.call(f, x))));
    const along = k.def("along");
    k.define(along, k.fn(["f", "x"], (f, x) => call(lib("sum"), call(lib("map"), call(lib("range from"), k.int(0), k.call(S.first, k.thunk(() => call(INT_OPS.remainder, x, k.int(5))), k.thunk(() => k.int(0)))), f))));
    higher.push(twice, along);
  }
  // Generic helpers of the program's own, called at many types (C124):
  // each engine makes a copy per type, or one for all.
  const choose = k.def("choose"), around = k.def("around"), countWhere = k.def("count where"), lastOr = k.def("last or");
  k.define(choose, k.fn(["b", "x", "y"], (b, x, y) => k.if(b, x, y)));
  k.define(around, k.fn(["x", "xs"], (x, xs) => call(CONS, x, call(lib("append"), xs, k.list(x)))));
  k.define(countWhere, k.fn(["xs", "p"], (xs, p) => call(lib("length"), call(lib("keep"), xs, p))));
  k.define(lastOr, k.fn(["xs", "d"], (xs, d) => k.fold(xs, [
    { variant: NIL, names: [], body: () => d },
    { variant: CONS, names: ["x", "rest"], results: [null, "last"], body: ([x, rest], [, last]) => k.match(rest, [{ variant: NIL, names: [], body: () => x }, { variant: CONS, names: ["y", "more"], body: () => last! }]) },
  ])));
  generic.push(choose);
  genericDefs.push(choose, around, countWhere, lastOr);
  const defs: { def: Id; result: Ty }[] = [];
  for (let i = 0; i < count; i++) {
    calls = false;
    const result = r.pick<Ty>(["F", "I", "B", "L", "T", "D", "R", "P", "Q", "U", "A", "X", "Z", "M", "E"]), def = k.def(`g${i}`);
    // Its inputs are a Float64, an Int and a List Int: each used once
    // first, so its type is that whatever the body does.
    k.define(def, k.fn(["x", "n", "xs"], (x, n, xs) =>
      k.let("x0", call(B.add, x, k.lit(0)), (x0) =>
        k.let("n0", call(INT_OPS.add, n, k.int(0)), (n0) =>
          k.let("xs0", call(lib("append"), xs, k.list(n0)), (xs0) =>
            call(SHOW_ANY, gen(result, { F: [x0], I: [n0], L: [xs0], B: [], T: [], D: [], R: [], P: [], Q: [], U: [], A: [], X: [], Z: [], M: [], E: [] }, 4)))))));
    defs.push({ def, result });
    if (!calls) callable.push(def);
  }
  // Each definition again behind an entry e(x, n, j) whose list is the
  // j-th of the inputs, written in the program: when the chooser stores
  // lists another way, only what the program builds is stored so, and
  // Ints come in from outside (C120).
  const lists = k.def("inputs");
  // A long one is built by the program from its length (C128): a literal of
  // a thousand items overflows the checker's stack (BACKLOG I154).
  const LONG = 100;
  const inputList = (xs: bigint[]) => (xs.length <= LONG ? k.list(...xs.map((x) => k.int(x)))
    : call(lib("map"), call(lib("range from"), k.int(0), k.int(xs.length)), k.fn(["i"], (i) => call(INT_OPS.sub, k.call(S.first, k.thunk(() => call(INT_OPS.remainder, call(INT_OPS.mul, i, k.int(7919)), k.int(201))), k.thunk(() => k.int(0))), k.int(100)))));
  k.define(lists, k.list(...inputs.map(inputList)));
  const entries = defs.map(({ def }, i) => {
    const e = k.def(`e${i}`);
    k.define(e, k.fn(["x", "n", "j"], (x, n, j) => call(def, x, n, call(lib("item at"), k.x(lists), j, k.list()))));
    return e;
  });
  // A main calling each once, for the representation chooser, which
  // weighs what main reaches (C118).
  const main = k.def("main");
  k.define(main, k.thunk(() => k.list(...entries.map((e) => call(e, k.lit(2.5), k.int(3), k.int(1))))));
  const code = base(k.code), names2 = baseNames(k.names);
  return { code, names: names2, info: infer(code, names2, undefined, checkOptions), defs, entries, main, own: [wander, ...helpers, ...recursive, ...higher, ...genericDefs, ...defs.map((d) => d.def), lists, ...entries, main] };
}
