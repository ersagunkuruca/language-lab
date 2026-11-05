// Lists stored as arrays (REPRESENTATIONS.md step 5, BACKLOG L117): the
// trees module publishes `array of List`, a representation of List at
// Array written in the language. Its row says its costs and that a cons's
// rest is hidden, and each job agrees with List's own through the meaning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY, TREES } from "../src/lang/library.ts";
import { ARRAY_OPS, CONS, LIST, NIL, S, SHOW_ANY } from "../src/lang/std.ts";
import { ARRAY } from "../src/lang/types.ts";
import { merge, type Id } from "../src/model.ts";
import { B } from "../src/prelude.ts";

test("array of List: its row, and its jobs agree with List's through items of array", () => {
  const rep = LIBRARY.reps.find((r) => r.name === "array of List")!;
  assert.ok(rep, "the trees module publishes it");
  assert.equal(rep.of, LIST);
  assert.equal(rep.type, ARRAY);
  assert.equal(rep.meaning, ARRAY_OPS.items);
  // Not one spelling per list as the chooser sees it: show says "array"
  // and an array's compare puts shorter ones first, so equal, show and
  // compare go through the meaning.
  assert.equal(rep.canonical, false);
  assert.ok(rep.byType);
  assert.deepEqual(rep.hidden, { [CONS]: [1] });
  const lib = (n: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === n)!;
  assert.deepEqual(rep.cost, { space: "n", [NIL]: "1", [CONS]: "1", match: "1", fold: "n", [lib("length")]: "1", [lib("append")]: "n", [lib("item at")]: "1", [lib("map")]: "n", [lib("replace at")]: "1" });
  // List as written, which the chooser weighs it against (C30d3b).
  const spec = LIBRARY.reps.find((r) => r.of === LIST && r.canonical)!;
  assert.equal(spec.type, LIST);
  assert.deepEqual(spec.cost, { space: "n", [NIL]: "1", [CONS]: "1", match: "1", fold: "n", [lib("length")]: "n", [lib("append")]: "n", [lib("item at")]: "n", [lib("replace at")]: "n", [lib("map")]: "n" });

  const all = merge(LIBRARY.code, TREES.code);
  const k = new Lang(all);
  const tree = (n: string) => TREES.code.defs.find((d) => TREES.names[d] === n)!;
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const nums = (...xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const arr = (...xs: number[]) => k.call(ARRAY_OPS.of, nums(...xs));
  const items = (a: Id) => k.call(ARRAY_OPS.items, a);
  const names: string[] = [];
  const show = (name: string, x: () => Id) => { names.push(`the ${name}`); def(`the ${name}`, () => k.call(SHOW_ANY, x())); };
  show("nil", () => items(k.x(tree("array nil"))));
  show("cons", () => items(k.call(tree("array cons"), k.lit(1), arr(2, 3))));
  show("match", () => k.call(tree("array match"), arr(1, 2, 3), k.thunk(() => k.call(CONS, k.lit(0), k.x(NIL))), k.fn(["x", "rest"], (x, rest) => k.call(CONS, x, items(rest)))));
  show("match empty", () => k.call(tree("array match"), arr(), k.thunk(() => k.call(CONS, k.lit(0), k.x(NIL))), k.fn(["x", "rest"], (x, rest) => k.call(CONS, x, items(rest)))));
  // The fold gives each arm its item, its rest and the rest's answer.
  show("fold", () => k.call(tree("array fold"), arr(1, 2, 3), k.thunk(() => k.x(NIL)), k.fn(["x", "rest", "r"], (x, rest, r) => k.call(CONS, k.call(lib("length"), items(rest)), k.call(CONS, x, r)))));
  show("length", () => k.call(tree("array length of"), arr(4, 5, 6)));
  show("append", () => items(k.call(tree("array append"), arr(1, 2), arr(3))));
  // item at by an Int position, and otherwise outside.
  show("item at", () => k.list(...[-1, 0, 1, 2, 3].map((i) => k.call(tree("array item at"), arr(10, 20, 30), k.int(i), k.lit(0)))));
  // replace at (C93c): in the buffer, and the array it was given still
  // reads as it was; the array as it is outside it.
  show("replace at", () => k.let("a", arr(10, 20, 30), (a) => k.let("b", k.call(tree("array replace at"), a, k.int(1), k.lit(5)), (b) =>
    k.list(items(b), items(a), items(k.call(tree("array replace at"), b, k.int(3), k.lit(9))), items(k.call(tree("array replace at"), a, k.int(0), k.lit(7))), items(b)))));
  show("show", () => k.call(tree("array show"), arr(1, 2)));
  show("compare", () => k.call(tree("array compare"), arr(3), arr(1, 2)));
  const code = merge(base(TREES.code), k.code), nm = { ...baseNames(k.names), ...TREES.names };
  const info = infer(code, nm, undefined, { ...checkOptions, insiders: [...(checkOptions.insiders ?? []), ...TREES.code.defs] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const got = names.map((n) => r.value(code.defs.find((d) => nm[d] === n)!));
  assert.deepEqual(got, ["[]", "[1, 2, 3]", "[1, 2, 3]", "[0]", "[2, 1, 1, 2, 0, 3]", "3", "[1, 2, 3]", "[0, 10, 20, 30, 0]", "[[10, 5, 30], [10, 20, 30], [10, 5, 30], [7, 20, 30], [10, 5, 30]]", "\"[1, 2]\"", "after"]);
});

// C137 s3e: a list stored as an array runs backwards as a cons list does.
// `array match` reads the front in one call (front of array), whose
// backward mode makes the array from its first item and rest, and `array
// cons` and `array nil` are seen as push front and the empty array, two
// ends that are never the same array: so a definition over arrays run
// from its answer ends, with one answer at most.
test("a definition over lists stored as arrays runs backwards, with one answer", () => {
  const all = merge(LIBRARY.code, TREES.code);
  const k = new Lang(all);
  const tree = (n: string) => TREES.code.defs.find((d) => TREES.names[d] === n)!;
  const arr = (...xs: number[]) => k.call(ARRAY_OPS.of, k.list(...xs.map((x) => k.lit(x))));
  const doubled = k.def("doubled");
  const lam = k.fn(["a"], (a) => k.call(tree("array match"), a, k.thunk(() => k.x(tree("array nil"))),
    k.fn(["x", "rest"], (x, rest) => k.call(tree("array cons"), k.call(B.add, x, x), k.call(doubled, rest)))));
  k.define(doubled, lam);
  const a = (k.code.nodes[lam] as { params: Id[] }).params[0];
  const halves = k.def("halves");
  k.define(halves, k.call(SHOW_ANY, k.call(ARRAY_OPS.items, k.call(S.first, k.thunk(() => k.solve(doubled, { out: arr(2, 4, 6) }, { [a]: "a" }, (b) => k.x(b[a]))), k.thunk(() => arr())))));
  const code = merge(base(TREES.code), k.code), nm = { ...baseNames(k.names), ...TREES.names };
  const info = infer(code, nm, undefined, { ...checkOptions, insiders: [...(checkOptions.insiders ?? []), ...TREES.code.defs] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  assert.equal(r.value(halves), "[1, 2, 3]");
});

// I106c: a list taken apart item by item doesn't keep its first buffer.
// Where what's left is under a quarter of a big buffer, the rest is copied
// into one of its own, once: matching the same view again gives the same
// rest, and the items are the same all the way down.
test("rests of a big array let its buffer go once little is left, and a view's rest is made once", async () => {
  const { STD_IMPL, arrayOf, ArrayView } = await import("../src/lang/std.ts");
  const rest = STD_IMPL[ARRAY_OPS.rest] as (a: unknown) => InstanceType<typeof ArrayView>;
  const n = 100_000;
  let v = arrayOf(Array.from({ length: n }, (_, i) => i));
  const first = v.buf;
  let copied = 0, seen = v.buf;
  for (let i = 0; i < n - 1; i++) { v = rest(v); if (v.buf !== seen) { copied += v.n; seen = v.buf; } }
  assert.equal(v.n, 1);
  assert.deepEqual(v.fields, [1, n - 1]);
  assert.notEqual(v.buf, first);
  assert.ok(v.buf.items.length <= 256 * 3, `one item holds ${v.buf.items.length} slots`);
  // Constant per rest: each copy holds three quarters of the one before,
  // so the copies add up to under three times the list.
  assert.ok(copied < 3 * n, `${copied} items copied`);
  // A view of 100 items on a buffer of 6000: its rest is a copy, once.
  const w = arrayOf(Array.from({ length: 2000 }, (_, i) => i));
  const x = new ArrayView(w.ver, w.start + 900, 100);
  assert.equal(rest(x), rest(x));
  assert.ok(rest(x).buf.items.length < 400);
  assert.deepEqual(rest(x).fields.slice(0, 3), [99, 901, 902]);
  assert.deepEqual(w.fields.slice(0, 3), [2000, 0, 1]);
});
