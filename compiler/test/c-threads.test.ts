// A map whose function only computes, on threads in C (L101, c.ts
// `par:map`): the items share out once they have taken a millisecond, the
// function and the items marked shared so their counts change atomically,
// and the map gives what the evaluator gives: the same array, and the
// same abort, the one the library's map meets first running its items
// from the last.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ABORT_OP, INT_OPS, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// main prints the map of `item` over 0 to n - 1, a list kept as an array
// (`array map`); `item` is given the
// item, a big Int and a list that every item reads (both shared between
// the threads), and some work.
function program(n: number, item: (k: Lang, x: Id, big: Id, list: Id, work: Id) => Id) {
  const k = new Lang(LIBRARY.code), main = k.def("main");
  const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
  k.define(main, k.thunk(() => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.let("list", k.call(INT_OPS.range, k.int(50)), (list) =>
      k.let("ys", k.call(lib("map"), k.call(INT_OPS.range, k.int(n)), k.fn(["x"], (x) => item(k, x, big, list,
        k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(10000)), k.fn(["j"], (j) => k.call(INT_OPS.add, k.call(INT_OPS.mul, j, x), big))))))), (ys) =>
        // Read by position too, so the list is kept as an array (C30).
        k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(L("item at"), ys, k.int(1), k.int(-1)))), k.call(S.print, k.call(SHOW_ANY, ys))))))));
  const code0 = base(k.code), names0 = baseNames(k.names), info0 = infer(code0, names0, undefined, checkOptions);
  assert.deepEqual(info0.errors.map((e) => e.message), []);
  // The list as an array (C30): the map is the array's.
  const r = withLibraryRepresentations(code0, info0, names0, main, [main]);
  assert.deepEqual(r.chosen, ["List as array of List"]);
  const { code, names } = r, info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...r.insiders] });
  let evaluator = "";
  try { runMain(code, info, main, { print: (l) => { evaluator += `${l}\n`; }, names }); } catch (e) { evaluator = `aborted ${(e as { reason?: unknown }).reason}`; }
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true });
  assert.deepEqual([...l.refused.values()], []);
  const c = emitC(l, { main }).c;
  assert.match(c, /lab_par_map_0\(/);
  const exe = compile(c);
  const run = (workers: string) => {
    const r = spawnSync(exe, [], { env: { ...process.env, TERS_WORKERS: workers, TERS_BRANCHES: "say" } });
    const err = r.stderr.toString();
    return { out: r.status ? `aborted ${err.split("\n").filter((x) => x && !x.startsWith("items on threads"))[0]}` : r.stdout.toString(), threads: Number(/items on threads: (\d+)/.exec(err)?.[1] ?? 0) };
  };
  return { evaluator, run };
}

test("a map's items run on threads, sharing a big Int and a list, and give the evaluator's array (L101)", { skip }, () => {
  const p = program(12, (k, x, big, list, work) => k.call(INT_OPS.add, k.call(INT_OPS.add, work, k.call(lib("sum"), list)), x));
  assert.match(p.evaluator, /^\d+\n\[/);
  const many = p.run("3"), one = p.run("0");
  assert.equal(many.out, p.evaluator);
  assert.equal(one.out, p.evaluator);
  assert.ok(many.threads > 0, "no item ran on another thread");
  assert.equal(one.threads, 0);
});

// Items 0 to 3 abort, on other threads, after the last ones have
// started them: the map's abort is item 3's, which in order is met first.
test("a map whose items abort on other threads aborts as in order: at the last item that does (L101)", { skip }, () => {
  const p = program(12, (k, x, _big, _list, work) => k.if(k.call(INT_OPS.less, k.call(INT_OPS.add, k.call(INT_OPS.mul, work, k.int(0)), x), k.int(4)), k.call(ABORT_OP, k.call(SHOW_ANY, x)), x));
  assert.equal(p.evaluator, "aborted 3");
  const many = p.run("3");
  assert.equal(many.out, p.evaluator);
  assert.ok(many.threads > 0, "no item ran on another thread");
  assert.equal(p.run("0").out, p.evaluator);
});
