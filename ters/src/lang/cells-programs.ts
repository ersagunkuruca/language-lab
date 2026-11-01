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
import { BOOL, CELL_OPS, CONS, FIRST, HTML_V, INT_OPS, LIST, NIL, NONE, PAIR, PAIR_V, S, SECOND, SHOW_ANY, SOME, TEXT_OPS, UNIT } from "./std.ts";
import { CELL, CELLS, DIVERGE, INT, NUMBER, STRING, UPDATE } from "./types.ts";

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

// What the page draws is std's `Html` (WEB.md), the same type every page
// uses. Its changing parts are functions, run by the page inside a
// watcher: when a cell one read changes, it runs again and only that part
// of the page changes. That's Solid's JSX expressions, as data, and `part`
// is a piece whose shape itself depends on cells (Solid's <Show>/<For>,
// both at once). The widgets are ordinary definitions of the program that
// build elements, not more kinds of page.
const VALUE = "std.event.event.value", KEY = "std.event.event.key";

function widgets(k: Lang) {
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (name: string, f: () => Id) => k.call(HTML_V.property, k.lit(name), k.thunk(f));
  const on = (name: string, f: (e: Id) => Id) => k.call(HTML_V.on, k.lit(name), k.fn(["event"], f));
  const cls = (name: string) => prop("class", () => k.lit(name));
  const text = (f: () => Id) => k.call(HTML_V.text, k.thunk(f));
  const read = (c: Id) => k.call(C.read, c);

  const label = k.def("label");
  k.define(label, k.fn(["shows"], (shows) => el("span", [cls("ui-text")], [k.call(HTML_V.text, shows)])));
  const button = k.def("button");
  k.define(button, k.fn(["name", "on click"], (name, click) =>
    el("button", [prop("type", () => k.lit("button")), cls("ui-button"), on("click", () => k.call(click))], [text(() => name)])));
  const box = (name: string, c: string) => {
    const d = k.def(name);
    k.define(d, k.fn(["items"], (items) => k.call(HTML_V.element, k.lit("div"), k.list(cls(c)), items)));
    return d;
  };
  const row = box("row", "ui-row"), column = box("column", "ui-column");
  // A column set in from the left: what belongs under the row above it, an
  // outline's steps. Inline, so it reads the same on every page.
  const indented = k.def("indented");
  k.define(indented, k.fn(["items"], (items) => k.call(HTML_V.element, k.lit("div"), k.list(cls("ui-column"), prop("style", () => k.lit("padding-left: 24px"))), items)));
  // A field that hands what was typed to `on enter`, then empties.
  const entry = k.def("entry");
  k.define(entry, k.fn(["hint", "on enter"], (hint, enter) => k.let("draft", k.call(C.cell, k.lit("")), (draft) =>
    el("input", [cls("ui-entry"), prop("placeholder", () => hint), prop("value", () => read(draft)),
      on("input", (e) => k.call(C.write, draft, k.call(VALUE, e))),
      on("keydown", (e) => k.if(k.call(S.and, k.equal(k.call(KEY, e), k.lit("Enter")), k.call(S.not, k.equal(read(draft), k.lit("")))),
        k.seq(k.call(enter, read(draft)), k.call(C.write, draft, k.lit(""))),
        k.unitValue)),
    ], []))));
  // A slider for a cell holding a whole Float64; a value that doesn't read
  // as one changes nothing.
  const slider = k.def("slider");
  k.define(slider, k.fn(["name", "low", "high", "value"], (name, low, high, c) => {
    const shown = () => k.call(S.show, read(c));
    return el("label", [cls("ui-slider")], [
      el("span", [cls("ui-slider-label")], [text(() => name)]),
      el("input", [prop("type", () => k.lit("range")), prop("min", () => k.call(S.show, low)), prop("max", () => k.call(S.show, high)),
        prop("step", () => k.lit("1")), prop("value", shown),
        on("input", (e) => k.match(k.call(S.optional, k.thunk(() => k.call(INT_OPS.read, k.call(VALUE, e)))), [
          { variant: SOME, names: ["n"], body: ([n]) => k.call(C.write, c, k.call(INT_OPS.toNumber, n)) },
          { variant: NONE, names: [], body: () => k.unitValue },
        ]))], []),
      el("output", [], [text(shown)]),
    ]);
  }));
  return { label, button, row, column, indented, entry, slider, part: HTML_V.part };
}

export function counterProgram() {
  const { k, lib } = lang();
  const ui = widgets(k);
  const map = lib("map"), keep = lib("keep"), append = lib("append"), length = lib("length");
  const read = (c: Id) => k.call(C.read, c);
  const show = (x: Id) => k.call(S.show, x);
  const text = (f: () => Id) => k.call(ui.label, k.thunk(f));
  const button = (label: string, f: () => Id) => k.call(ui.button, k.lit(label), k.thunk(f));

  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("count", k.call(C.cell, k.lit(0)), (count) =>
    k.let("doubled", k.call(C.formula, k.thunk(() => k.call(B.mul, read(count), k.lit(2)))), (doubled) =>
    k.let("details", k.call(C.cell, k.true), (details) =>
    k.let("todos", k.call(C.cell, k.list(k.lit("try the counter"), k.lit("hide the details"))), (todos) =>
      k.call(ui.column, k.list(
        k.call(ui.row, k.list(
          button("−", () => k.call(C.write, count, k.call(B.sub, read(count), k.lit(1)))),
          text(() => show(read(count))),
          button("+", () => k.call(C.write, count, k.call(B.add, read(count), k.lit(1)))),
        )),
        text(() => k.text(k.lit("doubled: "), show(read(doubled)))),
        k.call(ui.row, k.list(
          button("details", () => k.call(C.write, details, k.call(S.not, read(details)))),
          // While the details are hidden this reads only `details`, so the
          // counter doesn't make it run.
          text(() => k.if(read(details),
            k.text(k.lit("count squared: "), show(k.call(B.mul, read(count), read(count)))),
            k.lit("details hidden: this text no longer reads count"))),
        )),
        k.call(ui.entry, k.lit("add a todo, then Enter"), k.fn(["item"], (item) =>
          k.call(C.write, todos, k.call(append, read(todos), k.list(item))))),
        k.call(ui.part, k.thunk(() => k.call(ui.column, k.call(map, read(todos), k.fn(["item"], (item) =>
          k.call(ui.row, k.list(
            text(() => item),
            button("done", () => k.call(C.write, todos, k.call(keep, read(todos), k.fn(["other"], (o) => k.call(S.not, k.equal(o, item)))))),
          ))))))),
        text(() => k.text(show(k.call(INT_OPS.toNumber, k.call(length, read(todos)))), k.lit(" to do"))),
      ))))))));
  return { code: k.code, names: k.names, main };
}

export function fractionsProgram() {
  const { k, lib } = lang();
  const ui = widgets(k);
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

  // The value of the terms read so far (a convergent), as a Float64.
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
      const line = (label: () => Id, x: () => Id) => k.call(ui.label, k.thunk(() => k.let("ts", k.call(terms, x(), count()), (ts) =>
        k.text(label(), k.lit(" = "), k.call(showTerms, ts), k.lit(" ≈ "), k.call(S.show, k.call(value, ts))))));
      const nText = () => k.call(S.show, read(n));
      return k.call(ui.column, k.list(
        k.call(ui.slider, k.lit("terms"), k.lit(1), k.lit(40), many),
        k.call(ui.slider, k.lit("n"), k.lit(2), k.lit(30), n),
        line(() => k.text(k.lit("√"), nText()), () => read(rootN)),
        line(() => k.lit("e"), () => eCF),
        line(() => k.text(k.lit("√"), nText(), k.lit(" + e")), () => read(sum)),
        line(() => k.text(k.lit("e − √"), nText()), () => read(diff)),
        line(() => k.text(k.lit("1 / √"), nText()), () => read(inv)),
        // √n · √n is n, but when n isn't a square every term of the two
        // inputs agrees with n forever and no first term ever comes: equality
        // of exact reals is undecidable. `with fuel` gives up after a while.
        k.call(ui.label, k.thunk(() => k.text(k.lit("√"), nText(), k.lit(" × √"), nText(), k.lit(" = "),
          k.call(S.first,
            k.thunk(() => k.call(S.fuel, k.lit(300), k.thunk(() => shown(read(square), count())))),
            k.thunk(() => k.lit("no first term after 300 steps: is it just below n, or n, or just above? that can't be decided")))))),
      ));
    }))))))))));
  return { code: k.code, names: k.names, main, defs: { CF, rational, root, e, terms, showTerms, value, plus, minus, times, over } };
}

// A nested to-do outline (BACKLOG L100, STABLE-REFERENCES.md "The demo"):
// plain `Item` data with keys, any depth, in one cell, changed only by
// edits at a path (L98). The top-level rows are an `each` that follows
// the edits (L99a), and each item's steps an `each of` its children, so
// ticking an item at any depth runs its line, and adding, moving or
// removing an item or a step makes, moves or drops one row. The count is a formula over the whole outline.
// An item is found by its key, so its place is worked out when a button
// is pressed, not kept: positions shift, keys don't.
export function outlineProgram() {
  const { k, lib } = lang();
  const length = lib("length");
  const I = INT_OPS;
  const read = (c: Id) => k.call(C.read, c);

  const Item = k.type("Item", [], [["item", [
    ["key", () => k.tref(INT)], ["title", () => k.tref(STRING)], ["done", () => k.tref(BOOL)],
    ["children", (self) => k.tref(LIST, k.tref(self))],
  ]]]);
  const F = (f: string) => Item.f[`item.${f}`];
  const fieldPath = (f: string) => k.call(C.path, k.fn(["it"], (it) => k.call(F(f), it)));
  const whole = () => k.call(C.path, k.fn(["all"], (all) => all));
  const mk = (key: number, title: string, done: boolean, kids: Id[] = []) => k.call(Item.v.item, k.int(key), k.lit(title), done ? k.true : k.false, k.list(...kids));

  // Where the item with this key is: the list it's in, as a path from the
  // whole outline, and its position there. No answer when it isn't there.
  const place = k.def("place of");
  k.define(place, k.fn(["items", "key", "here", "at"], (items, key, here, at) => k.match(items, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["first", "rest"], body: ([x, rest]) => k.if(k.equal(k.call(F("key"), x), key),
      k.call(PAIR_V, here, at),
      k.call(S.first,
        k.thunk(() => k.call(place, k.call(F("children"), x), key, k.call(C.thenPath, k.call(C.itemPath, here, at), fieldPath("children")), k.int(0))),
        k.thunk(() => k.call(place, rest, key, here, k.call(I.add, at, k.int(1)))))) },
  ])));
  // How many items, and how many of them are done, at any depth.
  const tally = k.def("tally");
  k.define(tally, k.fn(["items"], (items) => k.fold(items, [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, k.int(0), k.int(0)) },
    { variant: CONS, names: ["first", "rest"], results: [null, "after"], body: ([x], [, after]) => k.match(k.call(tally, k.call(F("children"), x)), [
      { variant: PAIR_V, names: ["inside done", "inside all"], body: ([d, n]) => k.match(after!, [
        { variant: PAIR_V, names: ["done", "all"], body: ([d2, n2]) => k.call(PAIR_V,
          k.call(I.add, k.call(I.add, d, d2), k.if(k.call(F("done"), x), k.int(1), k.int(0))),
          k.call(I.add, k.call(I.add, n, n2), k.int(1))) },
      ]) },
    ]) },
  ])));

  // The edits a row's buttons make, each at the place its key is now.
  // The search is a Choice, so it's ended (optional) before anything is
  // written: an edit can't be made on a path a search may abandon.
  const at = (outline: Id, key: Id, f: (list: Id, i: Id) => Id) => k.match(k.call(S.optional, k.thunk(() => k.call(place, read(outline), key, whole(), k.int(0)))), [
    { variant: SOME, names: ["found"], body: ([found]) => k.match(found, [
      { variant: PAIR_V, names: ["list", "position"], body: ([l, i]) => f(l, i) },
    ]) },
    { variant: NONE, names: [], body: () => k.unitValue },
  ]);
  const fresh = (nextKey: Id, title: Id, then: (item: Id) => Id) => k.let("key", read(nextKey), (key) => k.seq(
    k.call(C.write, nextKey, k.call(I.add, key, k.int(1))),
    then(k.call(Item.v.item, key, title, k.false, k.x(NIL)))));
  // The page's own look is one style sheet below, every element just named
  // by its class, so the view reads as what it shows. A tick is the round
  // box before the title; the smaller buttons show when the line is
  // hovered or focused.
  const html = (name: string, ...args: Id[]) => k.call(lib(name), ...args);
  const classed = (c: string, e: Id) => html("classed", k.lit(c), e);
  const attribute = (name: string, value: string) => html("attribute", k.lit(name), k.lit(value));
  const prop = (name: string, f: () => Id) => k.call(HTML_V.property, k.lit(name), k.thunk(f));
  const on = (name: string, f: (e: Id) => Id) => k.call(HTML_V.on, k.lit(name), k.fn(["event"], f));
  const words = (t: string) => html("words", k.lit(t));
  const shows = (f: () => Id) => k.call(HTML_V.text, k.thunk(f));
  const none = () => k.x(NIL);

  // A button that shows a sign and is named for what it does, the name
  // what a screen reader says and a pointer's tooltip shows.
  const icon = k.def("icon button");
  k.define(icon, k.fn(["class", "name", "sign", "then"], (c, name, sign, then) =>
    html("with", k.list(k.call(HTML_V.property, k.lit("type"), k.thunk(() => k.lit("button"))), k.call(HTML_V.property, k.lit("title"), k.thunk(() => name)), k.call(HTML_V.property, k.lit("aria-label"), k.thunk(() => name))),
      html("classed", c, html("button", sign, then)))));
  const iconButton = (c: string, name: string, sign: string, f: () => Id) => k.call(icon, k.lit(c), k.lit(name), k.lit(sign), k.fn(["event"], f));
  // A field that hands what was typed to `on enter` and empties; Escape
  // empties it and calls `on escape`.
  const field = k.def("field");
  k.define(field, k.fn(["hint", "on enter", "on escape"], (hint, enter, escape) => k.let("draft", k.call(C.cell, k.lit("")), (draft) =>
    k.call(HTML_V.element, k.lit("input"), k.list(
      prop("class", () => k.lit("todo-field")), prop("placeholder", () => hint), prop("value", () => read(draft)),
      on("input", (e) => k.call(C.write, draft, k.call(VALUE, e))),
      on("keydown", (e) => k.if(k.call(S.and, k.equal(k.call(KEY, e), k.lit("Enter")), k.call(S.not, k.equal(read(draft), k.lit("")))),
        k.let("title", read(draft), (title) => k.seq(k.call(C.write, draft, k.lit("")), k.call(enter, title))),
        k.if(k.equal(k.call(KEY, e), k.lit("Escape")), k.seq(k.call(C.write, draft, k.lit("")), k.call(escape)), k.unitValue))),
    ), none()))));

  // One item and its steps, drawn. The item is plain data; each hands the
  // row a view of it (cells.ts, L99), so a tick runs the one line that
  // read that `done`, at any depth. Its steps are an each of its children
  // (each of), so a step added makes the step's row and nothing above it. "+" opens a field under the item for
  // the new step's title; Enter adds it, Escape or leaving the field closes it.
  const draw = k.def("draw item");
  k.define(draw, k.fn(["outline", "next key", "item"], (outline, nextKey, it) => k.let("key", k.call(F("key"), it), (key) => k.let("adding", k.call(C.cell, k.false), (adding) =>
    classed("todo-item", html("li", k.list(
      html("with", k.list(prop("class", () => k.if(k.call(F("done"), it), k.lit("todo-line done"), k.lit("todo-line")))), html("div", k.list(
        iconButton("todo-check", "Tick", "✓", () => at(outline, key, (l, i) => k.call(C.writeAt, outline, k.call(C.thenPath, k.call(C.itemPath, l, i), fieldPath("done")), k.call(S.not, k.call(F("done"), it))))),
        classed("todo-title", html("span", k.list(shows(() => k.call(F("title"), it))))),
        classed("todo-actions", html("span", k.list(
          iconButton("todo-act", "Add a step", "+", () => k.call(C.write, adding, k.true)),
          iconButton("todo-act", "Move up", "↑", () => at(outline, key, (l, i) => k.call(C.moveAt, outline, l, i, k.call(I.sub, i, k.int(1))))),
          iconButton("todo-act todo-remove", "Remove", "×", () => at(outline, key, (l, i) => k.call(C.removeAt, outline, l, i))),
        ))),
      ))),
      k.call(HTML_V.part, k.thunk(() => k.if(read(adding),
        html("with", k.list(attribute("autofocus", ""), on("blur", () => k.call(C.write, adding, k.false))),
          k.call(field, k.lit("New step, then Enter"),
            k.fn(["title"], (title) => k.seq(k.call(C.write, adding, k.false), fresh(nextKey, title, (step) => at(outline, key, (l, i) =>
              k.call(C.insertAt, outline, k.call(C.thenPath, k.call(C.itemPath, l, i), fieldPath("children")), k.call(length, k.call(F("children"), it)), step))))),
            k.thunk(() => k.call(C.write, adding, k.false)))),
        html("span", none())))),
      k.let("steps", k.call(C.eachOf, k.call(F("children"), it), k.fn(["step"], (step) => k.call(draw, outline, nextKey, step))), (steps) =>
        k.call(HTML_V.part, k.thunk(() => classed("todo-steps", html("ul", read(steps)))))),
    )))))));

  const styles = k.def("styles");
  const rule = (selector: string, declarations: string) => html("rule", k.lit(selector), k.lit(declarations));
  k.define(styles, k.thunk(() => html("style sheet", k.list(
    rule(".todo", "max-width: 560px; padding: 20px 20px 16px; border-radius: 16px; background: #fff; color: #1f2328; font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; box-shadow: 0 1px 2px rgb(0 0 0 / 6%), 0 8px 24px rgb(0 0 0 / 6%)"),
    rule(".todo-head", "display: flex; align-items: baseline; justify-content: space-between; gap: 12px"),
    rule(".todo-head h1", "margin: 0; font-size: 20px; letter-spacing: -0.01em"),
    rule(".todo-count", "color: #6b7280; font-size: 13px; font-variant-numeric: tabular-nums"),
    rule(".todo-bar", "height: 4px; margin: 10px 0 14px; border-radius: 2px; background: #eef0f2; overflow: hidden"),
    rule(".todo-bar-fill", "width: 0; height: 100%; background: #17a398; transition: width 0.25s ease"),
    rule(".todo-field", "box-sizing: border-box; width: 100%; margin: 0; padding: 9px 12px; font: inherit; color: inherit; border: 1px solid #e3e5e8; border-radius: 10px; background: #f7f8f9; outline: none"),
    rule(".todo-field:focus", "border-color: #17a398; background: #fff; box-shadow: 0 0 0 3px rgb(23 163 152 / 15%)"),
    rule(".todo-list, .todo-steps", "list-style: none; margin: 0; padding: 0"),
    rule(".todo-list", "margin-top: 10px"),
    rule(".todo-steps", "margin-left: 17px; padding-left: 12px; border-left: 1px solid #eceef0"),
    rule(".todo-item > .todo-field", "width: calc(100% - 38px); margin: 2px 0 6px 38px; padding: 6px 10px"),
    rule(".todo-line", "display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 2px 6px; border-radius: 8px"),
    rule(".todo-line:hover", "background: #f5f6f7"),
    rule(".todo-check", "flex: none; display: grid; place-items: center; width: 22px; height: 22px; margin: 0; padding: 0; border: 2px solid #c4c9cf; border-radius: 50%; background: transparent; color: transparent; font-size: 12px; line-height: 1; cursor: pointer; transition: background 0.15s, border-color 0.15s"),
    rule(".todo-check:hover", "border-color: #17a398; background: transparent"),
    rule(".done .todo-check, .done .todo-check:hover", "border-color: #17a398; background: #17a398; color: #fff"),
    rule(".todo-title", "flex: 1; min-width: 0; overflow-wrap: anywhere"),
    rule(".done .todo-title", "color: #9aa1a9; text-decoration: line-through; text-decoration-color: #c4c9cf"),
    rule(".todo-actions", "display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s"),
    rule(".todo-line:hover .todo-actions, .todo-line:focus-within .todo-actions", "opacity: 1"),
    html("media", k.lit("(hover: none)"), k.list(rule(".todo-actions", "opacity: 1"))),
    rule(".todo-act", "width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #6b7280; font-size: 16px; line-height: 1; cursor: pointer"),
    rule(".todo-act:hover", "background: #e9ecef; color: #1f2328"),
    rule(".todo-remove:hover", "background: #fdece7; color: #c2410c"),
    rule(".todo-credits", "margin: 14px 0 0; color: #8b929a; font-size: 12px"),
  ))));

  const credits = k.def("credits");
  k.define(credits, k.thunk(() => classed("todo-credits", html("p", k.list(words("Credits: edits at a path and rows kept by key follow Solid's createStore and mapArray, MobX and Immer's patches (prior art, STABLE-REFERENCES.md). The look, round ticks and buttons that show on hover, is ours, after to-do apps such as Things and Todoist (influence)."))))));

  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("outline", k.call(C.cell, k.list(
      mk(1, "plan the trip", false, [mk(2, "book the train", true), mk(3, "find a room", false, [mk(4, "ask Ana", false)])]),
      mk(5, "water the plants", true),
      mk(6, "write the report", false, [mk(7, "draft", false)]),
    )), (outline) =>
    k.let("next key", k.call(C.cell, k.int(8)), (nextKey) =>
    k.let("rows", k.call(C.each, outline, k.fn(["item"], (it) => k.call(draw, outline, nextKey, it))), (rows) =>
    k.let("progress", k.call(C.formula, k.thunk(() => k.call(tally, read(outline)))), (progress) => {
      const counts = (f: (done: Id, all: Id) => Id) => k.match(read(progress), [{ variant: PAIR_V, names: ["done", "all"], body: ([d, n]) => f(d, n) }]);
      return classed("todo", html("div", k.list(
        k.call(styles),
        classed("todo-head", html("div", k.list(
          html("h1", k.list(words("To do"))),
          classed("todo-count", html("span", k.list(shows(() => counts((d, n) => k.text(k.call(SHOW_ANY, d), k.lit(" of "), k.call(SHOW_ANY, n), k.lit(" done"))))))),
        ))),
        classed("todo-bar", html("div", k.list(
          html("with", k.list(prop("style", () => counts((d, n) => k.text(k.lit("width: calc(100% * "), k.call(SHOW_ANY, d), k.lit(" / "), k.call(SHOW_ANY, n), k.lit(")"))))),
            classed("todo-bar-fill", html("div", none())))))),
        k.call(field, k.lit("Add an item, then Enter"), k.fn(["title"], (title) => fresh(nextKey, title, (x) =>
          k.call(C.insertAt, outline, whole(), k.call(length, read(outline)), x))), k.thunk(() => k.unitValue)),
        k.call(HTML_V.part, k.thunk(() => classed("todo-list", html("ul", read(rows))))),
        k.call(credits),
      )));
    }))))));
  return { code: k.code, names: k.names, main, item: Item.def };
}
