// Lists stored as balanced trees by position (BACKLOG C45): `tree of
// List`, a representation of std's List written in the language like
// `array of List` (array-list.ts) and the Map and Set trees (map-tree.ts).
// Its meaning is the items in order. Every job on one end or one position
// is log n: a cons, a match, `item at`, `replace at`, and an append. A
// fold is n log n, since each arm's rest is a tree again. So the chooser
// takes it where a program changes items by position in a loop, which the
// array (a copy each time) and the cons cells (a walk each time) make n².
//
// A tree is tip, or node(item, size, left, right): the left side's items
// come before the item, the right side's after it, and an item's position
// is how many come before it, read off the sizes on the way down. It stays
// balanced by weight as map-tree.ts's do (Adams, 1993, with Hirai and
// Yamamoto's ⟨3, 2⟩), and an append joins two trees with one item between
// them, down the heavier side (Adams' concat3).
//
// Prior art: persistent vectors indexed by position, Clojure's (Hickey,
// after Bagwell's hash tries) and RRB trees (Bagwell and Rompf, 2012),
// which C45 names; Haskell's Data.Sequence (Hinze and Paterson's finger
// trees, 2006); ropes (Boehm, Atkinson and Plass, 1995). This is the
// binary, weight-balanced one: RRB's 32-wide nodes are the same costs in
// fewer, wider steps, a later step if a program needs the constant.

import type { Id } from "../model.ts";
import type { Lang } from "./dsl.ts";
import { B as BUILTIN } from "../prelude.ts";
import { COMPARE, CONS, COST, INT_OPS, JOBS, NIL, PAIR_V, REPRESENTATION_V, S, SHOW_ANY } from "./std.ts";
import { INT } from "./types.ts";

export interface ListTree { representation: Id; defs: Id[] }

const cost = (k: Lang, c: "constant" | "logarithmic" | "linear" | "linearithmic") => k.x(`${COST}.${c}`);

export function buildListTree(k: Lang, prelude: (name: string) => Id): ListTree {
  const defs: Id[] = [];
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); defs.push(d); return d; };
  const rec = (name: string) => { const d = k.def(name); defs.push(d); return d; };
  const i = {
    add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), sub: (a: Id, b: Id) => k.call(INT_OPS.sub, a, b),
    mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b),
  };
  const T = k.type("List tree", ["a"], [
    ["tip", []],
    // The item first: a set tree's node is the same fields in another
    // order, and the published module would make the two one type.
    ["node", [
      ["item", (_, [a]) => k.tref(a)],
      ["size", () => k.tref(INT)],
      ["left", (self, ps) => k.tref(self, ...ps.map((p) => k.tref(p)))],
      ["right", (self, ps) => k.tref(self, ...ps.map((p) => k.tref(p)))],
    ]],
  ]);
  defs.push(T.def);
  const { tip, node } = T.v;
  const parts = (t: Id, f: (s: Id, x: Id, l: Id, r: Id) => Id, otherwise: () => Id, p = "") => k.match(t, [
    { variant: tip, names: [], body: otherwise },
    { variant: node, names: [`${p}item`, `${p}size`, `${p}left`, `${p}right`], body: ([x, s, l, r]) => f(s, x, l, r) },
  ]);
  const size = def("list tree size", ["tree"], (t) => parts(t, (s) => s, () => k.int(0)));
  const made = def("list tree node", ["item", "left", "right"], (x, l, r) => k.call(node, x, i.add(i.add(k.call(size, l), k.call(size, r)), k.int(1)), l, r));
  const N = (x: Id, l: Id, r: Id) => k.call(made, x, l, r);
  const ps = ["item", "left", "right"];
  // The rotations, as map-tree.ts's. A side that is too heavy is never a
  // tip, so the tip cases only keep the types whole.
  const singleL = def("list tree single left", ps, (x, l, r) => parts(r, (_, rx, rl, rr) => N(rx, N(x, l, rl), rr), () => N(x, l, r), "r "));
  const singleR = def("list tree single right", ps, (x, l, r) => parts(l, (_, lx, ll, lr) => N(lx, ll, N(x, lr, r)), () => N(x, l, r), "l "));
  const doubleL = def("list tree double left", ps, (x, l, r) => parts(r, (_, rx, rl, rr) =>
    parts(rl, (__, mx, ml, mr) => N(mx, N(x, l, ml), N(rx, mr, rr)), () => N(x, l, r), "m "), () => N(x, l, r), "r "));
  const doubleR = def("list tree double right", ps, (x, l, r) => parts(l, (_, lx, ll, lr) =>
    parts(lr, (__, mx, ml, mr) => N(mx, N(lx, ll, ml), N(x, mr, r)), () => N(x, l, r), "m "), () => N(x, l, r), "l "));
  const DELTA = 3, RATIO = 2;
  const balance = def("list tree balance", ps, (x, l, r) => k.let("left size", k.call(size, l), (sl) => k.let("right size", k.call(size, r), (sr) =>
    k.if(i.less(i.add(sl, sr), k.int(2)), N(x, l, r),
      k.if(i.less(i.mul(k.int(DELTA), sl), sr),
        parts(r, (_, __, rl, rr) => k.if(i.less(k.call(size, rl), i.mul(k.int(RATIO), k.call(size, rr))), k.call(singleL, x, l, r), k.call(doubleL, x, l, r)), () => N(x, l, r), "r "),
        k.if(i.less(i.mul(k.int(DELTA), sr), sl),
          parts(l, (_, __, ll, lr) => k.if(i.less(k.call(size, lr), i.mul(k.int(RATIO), k.call(size, ll))), k.call(singleR, x, l, r), k.call(doubleR, x, l, r)), () => N(x, l, r), "l "),
          N(x, l, r)))))));
  const B = (x: Id, l: Id, r: Id) => k.call(balance, x, l, r);
  const one = (x: Id) => N(x, k.x(tip), k.x(tip));

  const nil = k.def("list tree nil");
  k.define(nil, k.x(tip));
  defs.push(nil);
  // A cons: the item before the leftmost, down the left side.
  const cons = rec("list tree cons");
  k.define(cons, k.fn(["item", "tree"], (x, t) => parts(t, (_, y, l, r) => B(y, k.call(cons, x, l), r), () => one(x))));
  // The item after the rightmost, down the right side.
  const snoc = rec("list tree snoc");
  k.define(snoc, k.fn(["tree", "item"], (t, x) => parts(t, (_, y, l, r) => B(y, l, k.call(snoc, r, x)), () => one(x))));
  // The first item, and the tree without it: down the left side.
  const first = rec("list tree first");
  k.define(first, k.fn(["tree", "item"], (t, x) => parts(t, (_, y, l) => k.call(first, l, y), () => x)));
  const dropFirst = rec("list tree without first");
  k.define(dropFirst, k.fn(["tree"], (t) => parts(t, (_, y, l, r) => parts(l, () => B(y, k.call(dropFirst, l), r), () => r, "l "), () => k.x(tip))));
  // A match: the first item and the rest, both log n.
  const match = def("list tree match", ["tree", "if empty", "if not"], (t, empty, not) => parts(t, (_, y, l) =>
    k.call(not, k.call(first, l, y), k.call(dropFirst, t)), () => k.call(empty)));
  // The items in order, onto a list: the meaning.
  const onto = rec("list tree onto");
  k.define(onto, k.fn(["tree", "rest"], (t, rest) => parts(t, (_, y, l, r) => k.call(onto, l, k.call(CONS, y, k.call(onto, r, rest))), () => rest)));
  const items = def("items of list tree", ["tree"], (t) => k.call(onto, t, k.x(NIL)));
  // A fold from the last item back, as a list's fold runs its arms; each
  // arm's rest is built from the back as it goes, one cons an item.
  const fold = def("list tree fold", ["tree", "if empty", "if not"], (t, empty, not) => k.match(k.fold(k.call(items, t), [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, k.call(empty), k.x(tip)) },
    { variant: CONS, names: ["item", "rest"], results: [null, "the rest's answer"], body: ([x], [, r]) => k.match(r!, [
      { variant: PAIR_V, names: ["answer", "rest"], body: ([answer, rest]) => k.call(PAIR_V, k.call(not, x, rest, answer), k.call(cons, x, rest)) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["answer", "tree"], body: ([answer]) => answer }]));
  // Two trees and an item between them, as one (Adams' concat3): down the
  // heavier side until the two are within the balance, then a node.
  const link = rec("list tree link");
  k.define(link, k.fn(["left", "item", "right"], (l, x, r) => parts(l, (sl, lx, ll, lr) => parts(r, (sr, rx, rl, rr) =>
    k.if(i.less(i.mul(k.int(DELTA), sl), sr), B(rx, k.call(link, l, x, rl), rr),
      k.if(i.less(i.mul(k.int(DELTA), sr), sl), B(lx, ll, k.call(link, lr, x, r)), N(x, l, r))),
  () => k.call(snoc, l, x), "r "), () => k.call(cons, x, r), "l ")));
  const append = def("list tree append", ["front", "back"], (a, b) => parts(b, (_, y, l) => k.call(link, a, k.call(first, l, y), k.call(dropFirst, b)), () => a));
  // A position as item at rounds it (within a half of n is n), or none
  // for one that isn't a number; `at` then goes down by the sizes.
  const position = (p: Id) => k.call(INT_OPS.wholePart, k.call(S.floor, k.call(BUILTIN.add, p, k.lit(0.5))));
  const find = rec("list tree at");
  k.define(find, k.fn(["tree", "position", "otherwise"], (t, p, o) => parts(t, (_, y, l, r) => k.let("before", k.call(size, l), (before) =>
    k.if(i.less(p, before), k.call(find, l, p, o),
      k.if(i.less(before, p), k.call(find, r, i.sub(p, i.add(before, k.int(1))), o), y))), () => o)));
  const itemAt = def("list tree item at", ["tree", "position", "otherwise"], (t, p, o) => k.call(S.first,
    k.thunk(() => k.call(find, t, position(p), o)), k.thunk(() => o)));
  // A replace keeps every size, so the tree keeps its shape.
  const put = rec("list tree replace");
  k.define(put, k.fn(["tree", "position", "by"], (t, p, by) => parts(t, (s, y, l, r) => k.let("before", k.call(size, l), (before) =>
    k.if(i.less(p, before), k.call(node, y, s, k.call(put, l, p, by), r),
      k.if(i.less(before, p), k.call(node, y, s, l, k.call(put, r, i.sub(p, i.add(before, k.int(1))), by)), k.call(node, by, s, l, r)))), () => t)));
  const replaceAt = def("list tree replace at", ["tree", "position", "by"], (t, p, by) => k.call(S.first,
    k.thunk(() => k.call(put, t, position(p), by)), k.thunk(() => t)));
  // Equal, show and compare see the list it stands for.
  const equal = def("list tree equal", ["a", "b"], (a, b) => k.call(S.equal, k.call(items, a), k.call(items, b)));
  const show = def("list tree show", ["tree"], (t) => k.call(SHOW_ANY, k.call(items, t)));
  const compare = def("list tree compare", ["a", "b"], (a, b) => k.call(COMPARE, k.call(items, a), k.call(items, b)));

  const rep = k.def("tree of List");
  k.define(rep, k.call(REPRESENTATION_V, k.x(items), cost(k, "linear"), k.list(
    k.call(JOBS.job, k.x(NIL), k.x(nil), cost(k, "constant")),
    k.call(JOBS.job, k.x(CONS), k.x(cons), cost(k, "logarithmic")),
    k.call(JOBS.matchBy, k.x(match), cost(k, "logarithmic")),
    k.call(JOBS.foldBy, k.x(fold), cost(k, "linearithmic")),
    k.call(JOBS.job, k.x(prelude("length")), k.x(size), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("append")), k.x(append), cost(k, "logarithmic")),
    k.call(JOBS.job, k.x(prelude("item at")), k.x(itemAt), cost(k, "logarithmic")),
    k.call(JOBS.job, k.x(prelude("replace at")), k.x(replaceAt), cost(k, "logarithmic")),
    k.call(JOBS.equalBy, k.x(equal)), k.call(JOBS.showBy, k.x(show)), k.call(JOBS.compareBy, k.x(compare)),
  )));
  defs.push(rep);
  return { representation: rep, defs };
}
