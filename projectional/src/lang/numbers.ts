// Natural numbers twice: the Peano definition, which is the program, and a
// binary representation, which is how the machine may run it (NUMBERS.md).
//
// Nothing here is special. Nat and Binary are ordinary data types, every
// function is an ordinary definition, and `meaning` (Binary → Nat) is an
// ordinary fold. What makes Binary a representation of Nat is the side
// table returned with the program (`representations`): which definitions do
// each part of Nat's job on Binary, and what they cost.

import type { Id } from "../model.ts";
import { B } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import type { Representation } from "./represent.ts";
import { CONS, NIL, S } from "./std.ts";

export function numbers() {
  const k = new Lang();

  // ------------------------------------------------------------ the meaning
  const nat = k.type("Nat", [], [["zero", []], ["succ", [["pred", (self) => k.tref(self)]]]]);
  const { zero, succ } = nat.v;

  const double = k.def("double");
  k.define(double, k.fn(["n"], (n) => k.fold(n, [
    { variant: zero, names: [], body: () => zero },
    { variant: succ, names: ["m"], results: ["twice m"], body: (_, [r]) => k.call(succ, k.call(succ, r!)) },
  ])));

  const add = k.def("add");
  k.define(add, k.fn(["a", "b"], (a, b) => k.fold(a, [
    { variant: zero, names: [], body: () => b },
    { variant: succ, names: ["m"], results: ["m + b"], body: (_, [r]) => k.call(succ, r!) },
  ])));

  const mul = k.def("multiply");
  k.define(mul, k.fn(["a", "b"], (a, b) => k.fold(a, [
    { variant: zero, names: [], body: () => zero },
    { variant: succ, names: ["m"], results: ["m × b"], body: (_, [r]) => k.call(add, b, r!) },
  ])));

  // Nat → Number, to print one.
  const number = k.def("number");
  k.define(number, k.fn(["n"], (n) => k.fold(n, [
    { variant: zero, names: [], body: () => k.lit(0) },
    { variant: succ, names: ["m"], results: ["r"], body: (_, [r]) => k.call(B.add, r!, k.lit(1)) },
  ])));

  // Number → Nat: count the items of range(k).
  const fromNumber = k.def("nat");
  k.define(fromNumber, k.fn(["count"], (c) => k.fold(k.call(S.range, c), [
    { variant: NIL, names: [], body: () => zero },
    { variant: CONS, names: ["i", "rest"], results: [null, "r"], body: (_, [, r]) => k.call(succ, r!) },
  ])));

  // ------------------------------------------------- a program that uses it
  // Written against Nat only. It never mentions Binary.
  const one = k.def("one");
  k.define(one, k.call(succ, zero));

  const factorial = k.def("factorial");
  k.define(factorial, k.fn(["n"], (n) => k.fold(n, [
    { variant: zero, names: [], body: () => one },
    { variant: succ, names: ["m"], results: ["m!"], body: ([m], [r]) => k.call(mul, k.call(succ, m), r!) },
  ])));

  const power = k.def("power");
  k.define(power, k.fn(["base", "exponent"], (b, e) => k.fold(e, [
    { variant: zero, names: [], body: () => one },
    { variant: succ, names: ["m"], results: ["r"], body: (_, [r]) => k.call(mul, b, r!) },
  ])));

  // Plain recursion with match, the Peano way.
  const even = k.def("is even");
  k.define(even, k.fn(["n"], (n) => k.match(n, [
    { variant: zero, names: [], body: () => k.true },
    { variant: succ, names: ["m"], body: ([m]) => k.call(S.not, k.call(even, m)) },
  ])));

  const say = (label: string, n: Id) => k.call(S.print, k.text(k.lit(label), k.call(S.show, k.call(number, n))));
  const parity = (label: string, n: Id) => k.call(S.print, k.text(k.lit(label), k.if(k.call(even, n), k.lit("yes"), k.lit("no"))));
  const N = (x: number) => k.call(fromNumber, k.lit(x));
  const report = (name: string, f: number, b: number, e: number, p: number) => {
    const d = k.def(name);
    k.define(d, k.thunk(() => k.seq(
      say(`${f}! = `, k.call(factorial, N(f))),
      say(`${b}^${e} = `, k.call(power, N(b), N(e))),
      parity(`${p} is even: `, N(p)),
    )));
    return d;
  };
  // `small` is small enough for unary; `main` is not.
  const small = report("small", 6, 2, 10, 7);
  const main = report("main", 18, 2, 50, 100);

  // ------------------------------------------------------ the representation
  // Little-endian bits. `even(h)` is 2h, `odd(h)` is 2h + 1. Canonical: no
  // even(empty) (a leading zero), so every number has one spelling and
  // structural equality is still number equality.
  const bin = k.type("Binary", [], [["empty", []], ["even", [["half", (self) => k.tref(self)]]], ["odd", [["half", (self) => k.tref(self)]]]]);
  const { empty, even: ev, odd } = bin.v;

  const meaning = k.def("meaning");
  k.define(meaning, k.fn(["bits"], (b) => k.fold(b, [
    { variant: empty, names: [], body: () => zero },
    { variant: ev, names: ["half"], results: ["h"], body: (_, [h]) => k.call(double, h!) },
    { variant: odd, names: ["half"], results: ["h"], body: (_, [h]) => k.call(succ, k.call(double, h!)) },
  ])));

  // 2h, without a leading zero.
  const twice = k.def("twice′");
  k.define(twice, k.fn(["h"], (h) => k.match(h, [{ variant: empty, names: [], body: () => empty }], k.call(ev, h))));

  const zero2 = k.def("zero′");
  k.define(zero2, k.x(empty));

  const succ2 = k.def("succ′");
  k.define(succ2, k.fn(["b"], (b) => k.match(b, [
    { variant: empty, names: [], body: () => k.call(odd, empty) },
    { variant: ev, names: ["h"], body: ([h]) => k.call(odd, h) },
    { variant: odd, names: ["h"], body: ([h]) => k.call(ev, k.call(succ2, h)) },
  ])));

  const pred2 = k.def("pred′");
  k.define(pred2, k.fn(["b"], (b) => k.match(b, [
    { variant: empty, names: [], body: () => empty },
    { variant: ev, names: ["h"], body: ([h]) => k.call(odd, k.call(pred2, h)) },
    { variant: odd, names: ["h"], body: ([h]) => k.call(twice, h) },
  ])));

  const add2 = k.def("add′");
  k.define(add2, k.fn(["a", "b"], (a, b) => k.match(a, [
    { variant: empty, names: [], body: () => b },
    {
      variant: ev, names: ["x"], body: ([x]) => k.match(b, [
        { variant: empty, names: [], body: () => a },
        { variant: ev, names: ["y"], body: ([y]) => k.call(twice, k.call(add2, x, y)) },
        { variant: odd, names: ["y"], body: ([y]) => k.call(odd, k.call(add2, x, y)) },
      ]),
    },
    {
      variant: odd, names: ["x"], body: ([x]) => k.match(b, [
        { variant: empty, names: [], body: () => a },
        { variant: ev, names: ["y"], body: ([y]) => k.call(odd, k.call(add2, x, y)) },
        { variant: odd, names: ["y"], body: ([y]) => k.call(ev, k.call(succ2, k.call(add2, x, y))) },
      ]),
    },
  ])));

  const mul2 = k.def("multiply′");
  k.define(mul2, k.fn(["a", "b"], (a, b) => k.fold(a, [
    { variant: empty, names: [], body: () => empty },
    { variant: ev, names: ["h"], results: ["h × b"], body: (_, [r]) => k.call(twice, r!) },
    { variant: odd, names: ["h"], results: ["h × b"], body: (_, [r]) => k.call(add2, b, k.call(twice, r!)) },
  ])));

  const number2 = k.def("number′");
  k.define(number2, k.fn(["b"], (b) => k.fold(b, [
    { variant: empty, names: [], body: () => k.lit(0) },
    { variant: ev, names: ["h"], results: ["r"], body: (_, [r]) => k.call(B.mul, k.lit(2), r!) },
    { variant: odd, names: ["h"], results: ["r"], body: (_, [r]) => k.call(B.add, k.call(B.mul, k.lit(2), r!), k.lit(1)) },
  ])));

  // A match on Nat, done on Binary: one function per case of Nat.
  const match2 = k.def("match Nat′");
  k.define(match2, k.fn(["n", "if zero", "if succ"], (n, z, s) =>
    k.match(n, [{ variant: empty, names: [], body: () => k.call(z) }], k.call(s, k.call(pred2, n)))));

  // A fold over Nat, done on Binary, and still a fold (so still total): the
  // fold over the bits builds "run the succ case for indices k … k + n − 1".
  // It calls the succ case n times, as the fold over Nat must, but every
  // index it passes is a Binary.
  const fold2 = k.def("fold Nat′");
  k.define(fold2, k.fn(["n", "if zero", "if succ"], (n, z, s) => k.call(
    k.fold(n, [
      { variant: empty, names: [], body: () => k.fn(["from", "r"], (_, r) => r) },
      {
        variant: ev, names: ["h"], results: ["run h"],
        body: ([h], [g]) => k.fn(["from", "r"], (i, r) => k.call(g!, k.call(add2, i, h), k.call(g!, i, r))),
      },
      {
        variant: odd, names: ["h"], results: ["run h"],
        body: ([h], [g]) => k.fn(["from", "r"], (i, r) =>
          k.call(s, k.call(add2, i, k.call(twice, h)), k.call(g!, k.call(add2, i, h), k.call(g!, i, r)))),
      },
    ]),
    zero2, k.call(z))));

  const representations: Representation[] = [
    {
      name: "unary", of: nat.def, type: nat.def, meaning: null, canonical: true, impl: {},
      cost: { space: "n", [zero]: "1", [succ]: "1", match: "1", fold: "n", [add]: "n", [mul]: "n²", [number]: "n", [fromNumber]: "n" },
    },
    {
      name: "binary", of: nat.def, type: bin.def, meaning, canonical: true,
      impl: { [zero]: zero2, [succ]: succ2, match: match2, fold: fold2, [add]: add2, [mul]: mul2, [number]: number2 },
      cost: { space: "log n", [zero]: "1", [succ]: "1", match: "1", fold: "n", [add]: "log n", [mul]: "log² n", [number]: "log n", [fromNumber]: "n" },
    },
  ];

  return {
    code: k.code, names: k.names, representations,
    defs: { double, add, multiply: mul, number, nat: fromNumber, one, factorial, power, even, small, main, meaning, twice, zero2, succ2, pred2, add2, mul2, number2, match2, fold2 },
    types: { nat: nat.def, binary: bin.def },
  };
}
