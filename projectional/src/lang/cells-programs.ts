// Two programs on the Cells effect (LANGUAGE.md, "Cells"), written with
// the DSL: a reactive page in the style of Solid.js (a counter, a value
// shown only when asked, a todo list), and continued fractions whose terms
// are computed on demand, with Gosper's arithmetic on them. The page
// reactive.html runs both (editor/reactive.ts).
//
// Credits: the reactive model is Solid.js's (Ryan Carniato,
// https://www.solidjs.com); see src/lang/cells.ts. Continued-fraction
// arithmetic is R. W. Gosper's (HAKMEM, MIT AI Memo 239, 1972, item 101,
// and his "Continued Fraction Arithmetic", 1977). The expansion of √n is the
// standard (m, d, a) recurrence (e.g. Wikipedia, "Methods of computing
// square roots", continued fraction expansion), and e = [2; 1, 2, 1, 1, 4,
// 1, 1, 6, …] is Euler's (1737).

import type { Id } from "../model.ts";
import { B } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { LIBRARY } from "./library.ts";
import { CELL_OPS, CONS, FIRST, INT_OPS, LIST, NIL, NONE, PAIR, PAIR_V, S, SECOND, SOME, TEXT_OPS, UNIT } from "./std.ts";
import { CELL, INT, NUMBER, STRING } from "./types.ts";
import type { UiIds } from "./ui.ts";

const C = CELL_OPS;

function lang() {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string): Id => {
    const d = LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name);
    if (!d) throw new Error(`no ${name} in the library`);
    return d;
  };
  return { k, lib };
}

// What the page draws. Every field that shows something is a function, run
// by the page inside a watcher: when a cell it read changes, it runs again
// and only that part of the page changes. That's Solid's JSX expressions,
// as data. `dynamic` is a part whose shape itself depends on cells (Solid's
// <Show>/<For>, both at once).
function uiType(k: Lang) {
  const str = () => k.tref(STRING), num = () => k.tref(NUMBER);
  return k.type("UI", [], [
    ["text", [["shows", () => k.tfun([], str())]]],
    ["button", [["label", str], ["on click", () => k.tfun([], k.tref(UNIT))]]],
    ["entry", [["hint", str], ["on enter", () => k.tfun([str()], k.tref(UNIT))]]],
    ["slider", [["label", str], ["low", num], ["high", num], ["value", () => k.tref(CELL, num())]]],
    ["row", [["items", (self) => k.tref(LIST, k.tref(self))]]],
    ["column", [["items", (self) => k.tref(LIST, k.tref(self))]]],
    ["dynamic", [["view", (self) => k.tfun([], k.tref(self))]]],
  ]);
}

export function counterProgram() {
  const { k, lib } = lang();
  const ui = uiType(k);
  const map = lib("map"), keep = lib("keep"), append = lib("append"), length = lib("length");
  const read = (c: Id) => k.call(C.read, c);
  const show = (x: Id) => k.call(S.show, x);
  const text = (f: () => Id) => k.call(ui.v.text, k.thunk(f));
  const button = (label: string, f: () => Id) => k.call(ui.v.button, k.lit(label), k.thunk(f));

  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("count", k.call(C.cell, k.lit(0)), (count) =>
    k.let("doubled", k.call(C.formula, k.thunk(() => k.call(B.mul, read(count), k.lit(2)))), (doubled) =>
    k.let("details", k.call(C.cell, k.true), (details) =>
    k.let("todos", k.call(C.cell, k.list(k.lit("try the counter"), k.lit("hide the details"))), (todos) =>
      k.call(ui.v.column, k.list(
        k.call(ui.v.row, k.list(
          button("−", () => k.call(C.write, count, k.call(B.sub, read(count), k.lit(1)))),
          text(() => show(read(count))),
          button("+", () => k.call(C.write, count, k.call(B.add, read(count), k.lit(1)))),
        )),
        text(() => k.text(k.lit("doubled: "), show(read(doubled)))),
        k.call(ui.v.row, k.list(
          button("details", () => k.call(C.write, details, k.call(S.not, read(details)))),
          // While the details are hidden this reads only `details`, so the
          // counter doesn't make it run.
          text(() => k.if(read(details),
            k.text(k.lit("count squared: "), show(k.call(B.mul, read(count), read(count)))),
            k.lit("details hidden: this text no longer reads count"))),
        )),
        k.call(ui.v.entry, k.lit("add a todo, then Enter"), k.fn(["item"], (item) =>
          k.call(C.write, todos, k.call(append, read(todos), k.list(item))))),
        k.call(ui.v.dynamic, k.thunk(() => k.call(ui.v.column, k.call(map, read(todos), k.fn(["item"], (item) =>
          k.call(ui.v.row, k.list(
            text(() => item),
            button("done", () => k.call(C.write, todos, k.call(keep, read(todos), k.fn(["other"], (o) => k.call(S.not, k.equal(o, item)))))),
          ))))))),
        text(() => k.text(show(k.call(INT_OPS.toNumber, k.call(length, read(todos)))), k.lit(" to do"))),
      ))))))));
  return { code: k.code, names: k.names, main, ui: ui.v as UiIds };
}

export function fractionsProgram() {
  const { k, lib } = lang();
  const ui = uiType(k);
  const map = lib("map");
  const int = (n: number) => k.int(n);
  const I = INT_OPS;
  const read = (c: Id) => k.call(C.read, c);
  const add = (a: Id, b: Id) => k.call(I.add, a, b), sub = (a: Id, b: Id) => k.call(I.sub, a, b), mul = (a: Id, b: Id) => k.call(I.mul, a, b);
  const later = (f: () => Id) => k.call(C.formula, k.thunk(f));

  // A continued fraction a₀ + 1/(a₁ + 1/(a₂ + …)): its first whole part,
  // and the rest as a formula, computed when someone reads it and then
  // remembered. `end` is a finite one's end (the rest is infinite).
  const cf = k.type("CF", [], [
    ["end", []],
    ["term", [["whole", () => k.tref(INT)], ["rest", (self) => k.tref(CELL, k.tref(self))]]],
  ]);
  const end = cf.v.end, term = cf.v.term;
  const CF = cf.def;

  // Rounds down; dividing by zero gives 0 (callers never do).
  const div = k.def("div");
  k.define(div, k.fn(["a", "b"], (a, b) => k.call(S.first, k.thunk(() => k.call(I.quotient, a, b)), k.thunk(() => int(0)))));
  const whole = k.def("whole");
  k.define(whole, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(I.wholePart, x)), k.thunk(() => int(0)))));

  // p/q by Euclid's algorithm: finite.
  const rational = k.def("rational");
  k.define(rational, k.fn(["p", "q"], (p, q) => k.if(k.equal(q, int(0)), end,
    k.let("w", k.call(div, p, q), (w) => k.call(term, w, later(() => k.call(rational, q, sub(p, mul(q, w)))))))));

  // √n = [a₀; a₁, a₂, …], periodic after a₀ (the m, d, a recurrence).
  const rootFrom = k.def("root terms");
  k.define(rootFrom, k.fn(["n", "a0", "m", "d", "a"], (n, a0, m, d, a) => k.call(term, a, later(() =>
    k.let("m′", sub(mul(d, a), m), (m2) =>
    k.let("d′", k.call(div, sub(n, mul(m2, m2)), d), (d2) =>
      k.call(rootFrom, n, a0, m2, d2, k.call(div, add(a0, m2), d2))))))));
  const root = k.def("square root");
  k.define(root, k.fn(["n"], (n) => k.let("a0", k.call(whole, k.call(B.sqrt, k.call(I.toNumber, n))), (a0) =>
    k.if(k.equal(mul(a0, a0), n), k.call(term, a0, later(() => end)), k.call(rootFrom, n, a0, int(0), int(1), a0)))));

  // e = [2; 1, 2, 1, 1, 4, 1, 1, 6, …] (Euler).
  const eFrom = k.def("e terms");
  k.define(eFrom, k.fn(["k"], (j) => k.call(term, int(1), later(() =>
    k.call(term, mul(int(2), j), later(() => k.call(term, int(1), later(() => k.call(eFrom, add(j, int(1)))))))))));
  const e = k.def("e");
  k.define(e, k.thunk(() => k.call(term, int(2), later(() => k.call(eFrom, int(1))))));

  // The first n terms. Reading a rest is where the work happens, once.
  const terms = k.def("terms");
  k.define(terms, k.fn(["x", "n"], (x, n) => k.if(k.call(I.less, n, int(1)), NIL, k.match(x, [
    { variant: end, names: [], body: () => NIL },
    { variant: term, names: ["whole", "rest"], body: ([w, rest]) => k.call(CONS, w, k.call(terms, read(rest), sub(n, int(1)))) },
  ]))));

  // [1; 2, 2, 2]
  const showTerms = k.def("show terms");
  k.define(showTerms, k.fn(["terms"], (ts) => k.match(ts, [
    { variant: NIL, names: [], body: () => k.lit("[]") },
    { variant: CONS, names: ["first", "rest"], body: ([h, t]) => k.text(k.lit("["), k.call(I.show, h), k.match(t, [
      { variant: NIL, names: [], body: () => k.lit("") },
    ], k.text(k.lit("; "), k.call(TEXT_OPS.joinAll, k.call(map, t, I.show), k.lit(", ")))), k.lit("]")) },
  ])));

  // The value of the terms read so far (a convergent), as a Number.
  const value = k.def("value");
  k.define(value, k.fn(["terms"], (ts) => k.fold(ts, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["whole", "rest"], results: [null, "value of rest"], body: ([w, rest], [, r]) =>
      k.match(rest, [{ variant: NIL, names: [], body: () => k.call(I.toNumber, w) }],
        k.call(B.add, k.call(I.toNumber, w), k.call(B.div, k.lit(1), r!))) },
  ])));

  // ---- Gosper's arithmetic. z = (axy + bx + cy + d) / (exy + fx + gy + h)
  // of two continued fractions x and y. A term of z is known when the four
  // corner ratios a/e, b/f, c/g, d/h round down to the same whole number q:
  // then z = q + 1/z′. Otherwise take in a term of x or y. Corners an
  // input that has ended no longer reaches don't count.
  const gs = k.type("Gosper", [], [["gosper", "abcdefgh".split("").map((c) => [c, () => k.tref(INT)] as [string, () => Id])]]);
  const G = gs.v.gosper;
  const withG = (g: Id, body: (c: Record<string, Id>) => Id) => k.match(g, [{ variant: G, names: "abcdefgh".split(""), body: (bs) => body(Object.fromEntries("abcdefgh".split("").map((c, i) => [c, bs[i]]))) }]);
  const pair = (a: Id, b: Id) => k.call(PAIR_V, a, b);

  // Do these pairs all round down to one q? None if one's denominator is 0.
  const agree = k.def("agree");
  k.define(agree, k.fn(["pairs", "q"], (ps, q) => k.fold(ps, [
    { variant: NIL, names: [], body: () => k.true },
    { variant: CONS, names: ["pair", "rest"], results: [null, "rest agree"], body: ([p], [, r]) =>
      k.and(k.equal(k.call(I.quotient, k.call(FIRST, p), k.call(SECOND, p)), q), r!) },
  ])));
  const sameFloor = k.def("same floor");
  k.define(sameFloor, k.fn(["pairs"], (ps) => k.call(S.optional, k.thunk(() => k.match(ps, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["pair", "rest"], body: ([p, rest]) => k.let("q", k.call(I.quotient, k.call(FIRST, p), k.call(SECOND, p)), (q) =>
      k.if(k.call(agree, rest, q), q, k.call(S.fail))) },
  ])))));
  // Every denominator is 0: z is infinite, so the fraction has ended.
  const ended = k.def("ended");
  k.define(ended, k.fn(["pairs"], (ps) => k.fold(ps, [
    { variant: NIL, names: [], body: () => k.true },
    { variant: CONS, names: ["pair", "rest"], results: [null, "rest ended"], body: ([p], [, r]) => k.and(k.equal(k.call(SECOND, p), int(0)), r!) },
  ])));
  const isEnd = (x: Id, yes: Id, no: () => Id) => k.match(x, [{ variant: end, names: [], body: () => yes }], no());
  const corners = k.def("corners");
  k.define(corners, k.fn(["g", "x", "y"], (g, x, y) => withG(g, (c) => {
    const ae = () => pair(c.a, c.e), bf = () => pair(c.b, c.f), cg = () => pair(c.c, c.g), dh = () => pair(c.d, c.h);
    return isEnd(x, isEnd(y, k.list(dh()), () => k.list(cg(), dh())), () => isEnd(y, k.list(bf(), dh()), () => k.list(ae(), bf(), cg(), dh())));
  })));
  // z = q + 1/z′
  const emit = k.def("give term");
  k.define(emit, k.fn(["g", "q"], (g, q) => withG(g, (c) =>
    k.call(G, c.e, c.f, c.g, c.h, sub(c.a, mul(c.e, q)), sub(c.b, mul(c.f, q)), sub(c.c, mul(c.g, q)), sub(c.d, mul(c.h, q))))));
  // x = t + 1/x′, or x = ∞ when x has ended; the same for y.
  const takeX = k.def("take from x");
  k.define(takeX, k.fn(["g", "t"], (g, t) => withG(g, (c) =>
    k.call(G, add(mul(c.a, t), c.c), add(mul(c.b, t), c.d), c.a, c.b, add(mul(c.e, t), c.g), add(mul(c.f, t), c.h), c.e, c.f))));
  const endX = k.def("x ended");
  k.define(endX, k.fn(["g"], (g) => withG(g, (c) => k.call(G, int(0), int(0), c.a, c.b, int(0), int(0), c.e, c.f))));
  const takeY = k.def("take from y");
  k.define(takeY, k.fn(["g", "t"], (g, t) => withG(g, (c) =>
    k.call(G, add(mul(c.a, t), c.b), c.a, add(mul(c.c, t), c.d), c.c, add(mul(c.e, t), c.f), c.e, add(mul(c.g, t), c.h), c.g))));
  const endY = k.def("y ended");
  k.define(endY, k.fn(["g"], (g) => withG(g, (c) => k.call(G, int(0), c.a, int(0), c.c, int(0), c.e, int(0), c.g))));
  // Which input z still depends on: x if the corners at x = ∞ and x = 0
  // disagree (a/e with c/g, or b/f with d/h), y if those at y = ∞ and y = 0
  // do (a/e with b/f, or c/g with d/h). When both do, take turns. Two
  // corners with denominator 0 are both ∞, so they agree.
  const differ = k.def("differ");
  k.define(differ, k.fn(["p", "q"], (p, q) => k.let("dp", k.call(SECOND, p), (dp) => k.let("dq", k.call(SECOND, q), (dq) =>
    k.if(k.equal(dp, int(0)), k.call(S.not, k.equal(dq, int(0))),
      k.if(k.equal(dq, int(0)), k.true,
        k.call(S.not, k.equal(k.call(div, k.call(FIRST, p), dp), k.call(div, k.call(FIRST, q), dq)))))))));
  const fromX = k.def("from x?");
  k.define(fromX, k.fn(["g", "x", "y", "x's turn"], (g, x, y, turn) => isEnd(x, k.false, () => isEnd(y, k.true, () => withG(g, (c) => {
    const ae = () => pair(c.a, c.e), bf = () => pair(c.b, c.f), cg = () => pair(c.c, c.g), dh = () => pair(c.d, c.h);
    return k.let("on x", k.call(S.or, k.call(differ, ae(), cg()), k.call(differ, bf(), dh())), (onX) =>
      k.let("on y", k.call(S.or, k.call(differ, ae(), bf()), k.call(differ, cg(), dh())), (onY) =>
        k.if(k.equal(onX, onY), turn, onX)));
  })))));

  const arith = k.def("arithmetic");
  const take = (g: Id, x: Id, y: Id, turn: Id, onX: boolean) => k.match(onX ? x : y, [
    { variant: end, names: [], body: () => end },
    { variant: term, names: ["t", "rest"], body: ([t, rest]) => k.let("next", read(rest), (next) => {
      const taken = k.call(onX ? takeX : takeY, g, t);
      const g2 = isEnd(next, k.call(onX ? endX : endY, taken), () => k.call(onX ? takeX : takeY, g, t));
      const flip = k.call(S.not, turn);
      return onX ? k.call(arith, g2, next, y, flip) : k.call(arith, g2, x, next, flip);
    }) },
  ]);
  k.define(arith, k.fn(["g", "x", "y", "x's turn"], (g, x, y, turn) => k.let("corners", k.call(corners, g, x, y), (cs) =>
    k.if(k.call(ended, cs), end, k.match(k.call(sameFloor, cs), [
      { variant: SOME, names: ["q"], body: ([q]) => k.call(term, q, later(() => k.call(arith, k.call(emit, g, q), x, y, turn))) },
      { variant: NONE, names: [], body: () => k.if(k.call(fromX, g, x, y, turn), take(g, x, y, turn, true), take(g, x, y, turn, false)) },
    ])))));
  const op = (name: string, cs: number[]) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "y"], (x, y) => k.call(arith, k.call(G, ...cs.map(int)), x, y, k.true)));
    return d;
  };
  const plus = op("plus", [0, 1, 1, 0, 0, 0, 0, 1]);
  const minus = op("minus", [0, 1, -1, 0, 0, 0, 0, 1]);
  const times = op("times", [1, 0, 0, 0, 0, 0, 0, 1]);
  const over = op("over", [0, 1, 0, 0, 0, 0, 1, 0]);

  // ---- the page
  const shown = (x: Id, count: Id) => k.call(showTerms, k.call(terms, x, count));
  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("how many", k.call(C.cell, k.lit(10)), (many) =>
    k.let("n", k.call(C.cell, k.lit(2)), (n) =>
    k.let("√n", later(() => k.call(root, k.call(whole, read(n)))), (rootN) =>
    k.let("e", k.call(e), (eCF) =>
    // Each number is a formula: computed when a line first reads its
    // terms, then remembered, so showing one more term computes one more
    // term of each, and changing n recomputes what depends on √n only.
    k.let("√n + e", later(() => k.call(plus, read(rootN), eCF)), (sum) =>
    k.let("e − √n", later(() => k.call(minus, eCF, read(rootN))), (diff) =>
    k.let("1 / √n", later(() => k.call(over, k.call(rational, int(1), int(1)), read(rootN))), (inv) =>
    k.let("√n × √n", later(() => k.call(times, read(rootN), read(rootN))), (square) => {
      const count = () => k.call(whole, read(many));
      const line = (label: () => Id, x: () => Id) => k.call(ui.v.text, k.thunk(() => k.let("ts", k.call(terms, x(), count()), (ts) =>
        k.text(label(), k.lit(" = "), k.call(showTerms, ts), k.lit(" ≈ "), k.call(S.show, k.call(value, ts))))));
      const nText = () => k.call(S.show, read(n));
      return k.call(ui.v.column, k.list(
        k.call(ui.v.slider, k.lit("terms"), k.lit(1), k.lit(40), many),
        k.call(ui.v.slider, k.lit("n"), k.lit(2), k.lit(30), n),
        line(() => k.text(k.lit("√"), nText()), () => read(rootN)),
        line(() => k.lit("e"), () => eCF),
        line(() => k.text(k.lit("√"), nText(), k.lit(" + e")), () => read(sum)),
        line(() => k.text(k.lit("e − √"), nText()), () => read(diff)),
        line(() => k.text(k.lit("1 / √"), nText()), () => read(inv)),
        // √n · √n is n, but when n isn't a square every term of the two
        // inputs agrees with n forever and no first term ever comes: equality
        // of exact reals is undecidable. `with fuel` gives up after a while.
        k.call(ui.v.text, k.thunk(() => k.text(k.lit("√"), nText(), k.lit(" × √"), nText(), k.lit(" = "),
          k.call(S.first,
            k.thunk(() => k.call(S.fuel, k.lit(300), k.thunk(() => shown(read(square), count())))),
            k.thunk(() => k.lit("no first term after 300 steps: is it just below n, or n, or just above? that can't be decided")))))),
      ));
    }))))))))));
  return { code: k.code, names: k.names, main, ui: ui.v as UiIds, defs: { CF, rational, root, e, terms, showTerms, value, plus, minus, times, over } };
}
