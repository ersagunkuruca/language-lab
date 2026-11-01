// Each representation row's costs, measured (I106b, REVIEW-2026-11-01 §2):
// every job a row claims is run on values of size n and 8n, and how its
// time grows is checked against the cost the row states. A row whose code
// drifts from its table (a "constant" cons that copies) fails here, before
// the chooser trusts it.
//
// Times are the fastest of a few batches, and the bounds are loose: a job
// claimed constant or logarithmic may grow at most 3× from n to 8n, and one
// claimed linear or worse must grow at least 3× (8× expected). The chooser's
// own cost for a cons onto a match's rest (represent.ts ontoField: the
// array's space) is measured the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY, TREES } from "../src/lang/library.ts";
import { CONS, NIL } from "../src/lang/std.ts";

const code = base(TREES.code), names = { ...baseNames({}), ...LIBRARY.names, ...TREES.names };
const info = infer(code, names, undefined, { ...checkOptions, insiders: [...(checkOptions.insiders ?? []), ...TREES.code.defs] });
const r = makeRunner(code, info, { print: () => {}, names });
const def = (n: string): Value => {
  const d = [...TREES.code.defs, ...LIBRARY.modules.flatMap((m) => m.exports)].find((x) => names[x] === n);
  assert.ok(d, n);
  return r.value(d!);
};
const first = (x: unknown): Value => { for (const v of x as Iterable<Value>) return v; throw new Error("no answer"); };
const call = (f: Value, ...a: Value[]) => first(r.call(f, ...a));

// The fastest of 5 batches of `m` runs of job on a value of size n, in ms.
function timeOf(make: (n: number) => Value, job: (v: Value, i: number) => unknown, n: number, m: number): number {
  const v = make(n);
  let best = Infinity;
  for (let b = 0; b < 5; b++) {
    const t = performance.now();
    for (let i = 0; i < m; i++) job(v, i);
    best = Math.min(best, performance.now() - t);
  }
  return best;
}
// How much a job's time grows from n to 8n.
const growth = (make: (n: number) => Value, job: (v: Value, i: number) => unknown, n: number, m: number) =>
  timeOf(make, job, 8 * n, m) / timeOf(make, job, n, m);

function check(row: string, job: string, claimed: string, g: number) {
  if (process.env.SHOW_GROWTH) console.log(row, job, claimed, g.toFixed(2));
  const flat = claimed === "1" || claimed === "log n";
  assert.ok(flat ? g < 3 : g > 3, `${row}: ${job} is claimed ${claimed}, but grew ${g.toFixed(1)}× from n to 8n`);
}
const rep = (name: string, of?: string) => LIBRARY.reps.find((x) => x.name === name && (!of || Object.keys(x.cost).some((k) => names[k] === of)))!;
const costOf = (row: ReturnType<typeof rep>, job: string) => Object.entries(row.cost).find(([k]) => (names[k] ?? k) === job)![1];

test("array of List and List as written: each job grows as its row says", () => {
  const nums = (n: number) => { let l: Value = { tag: NIL, fields: [] }; for (let i = n - 1; i >= 0; i--) l = { tag: CONS, fields: [i, l] }; return l; };
  // The array's own jobs, on arrays built by its cons.
  const arr = rep("array of List"), cons = def("array cons"), nil = def("array nil");
  const array = (n: number) => { let a = nil; for (let i = 0; i < n; i++) a = call(cons, i, a); return a; };
  const rest = (a: Value) => call(def("array match"), a, () => [nil], (_x: Value, more: Value) => [more]);
  const jobs: Record<string, [(v: Value, i: number) => unknown, number]> = {
    match: [(a) => rest(a), 2000],
    length: [(a) => call(def("array length of"), a), 2000],
    "item at": [(a, i) => call(def("array item at"), a, i % 100, -1), 2000],
    fold: [(a) => call(def("array fold"), a, () => [0], (_x: Value, _r: Value, s: Value) => [s]), 3],
    append: [(a) => call(def("array append"), a, a), 3],
  };
  for (const [job, [run, m]] of Object.entries(jobs)) check("array of List", job, costOf(arr, job), growth(array, run, 2000, m));
  // A cons onto an array nobody else holds: each onto the newest version.
  let newest = nil;
  check("array of List", "cons", costOf(arr, "cons"), growth((n) => (newest = array(n)), (_a, i) => { newest = call(cons, i, newest); }, 2000, 2000));
  // A cons onto a match's rest copies: the chooser counts it as the space.
  check("array of List", "cons onto a match's rest", arr.cost.space, growth(array, (a, i) => call(cons, i, rest(a)), 2000, 30));

  // List as written: the prelude's own definitions on cons cells.
  const spec = rep("List as written");
  const lib: Record<string, [(v: Value, i: number) => unknown, number]> = {
    length: [(l) => call(def("length"), l), 3],
    "item at": [(l) => call(def("item at"), l, 1e9, -1), 3],
    append: [(l) => call(def("append"), l, l), 3],
    cons: [(l, i) => call(r.value(CONS), i, l), 20000],
  };
  for (const [job, [run, m]] of Object.entries(lib)) check("List as written", job, costOf(spec, job), growth(nums, run, 2000, m));
});

test("the weight-balanced trees: lookups and changes grow as a logarithm, walks as n", () => {
  const map = rep("weight-balanced tree", "put"), set = rep("weight-balanced tree", "add item");
  const put = def("tree put"), at = def("tree value at"), add = def("set tree add"), has = def("set tree has");
  const tree = (n: number) => { let t = def("empty tree"); for (let i = 0; i < n; i++) t = call(put, t, (i * 7919) % n, i); return t; };
  const setOf = (n: number) => { let t = def("empty set tree"); for (let i = 0; i < n; i++) t = call(add, t, (i * 7919) % n); return t; };
  check("tree of Map", "value at", costOf(map, "value at"), growth(tree, (t, i) => call(at, t, i % 1000), 1000, 2000));
  check("tree of Map", "put", costOf(map, "put"), growth(tree, (t, i) => call(put, t, i % 1000, 0), 1000, 2000));
  check("tree of Map", "keys of", costOf(map, "keys of"), growth(tree, (t) => call(def("tree keys"), t), 1000, 5));
  check("tree of Set", "has item", costOf(set, "has item"), growth(setOf, (t, i) => call(has, t, i % 1000), 1000, 2000));
  check("tree of Set", "add item", costOf(set, "add item"), growth(setOf, (t, i) => call(add, t, -1 - (i % 1000)), 1000, 2000));
});
