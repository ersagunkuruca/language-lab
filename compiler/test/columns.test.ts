// An array of records stored as columns (columns.ts, C60): drift's motes,
// stored by the chooser as an array, are moved as an array per field, and
// the program prints what the evaluator prints. Where an item leaves whole
// (every other example today), the array stays rows: none of them prints
// a column.

import { test } from "node:test";
import assert from "node:assert/strict";
import { represented } from "../../ters/cli/represented.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { lowerCore, printed, runCoreMain } from "../src/core-js.ts";
import { load } from "../src/program.ts";
import { kids, type SExpr } from "../src/scalar.ts";

function compiled(name: string) {
  const p = load(name);
  const main = p.code.defs.find((d) => p.pres.names[d] === "main")!;
  const r = represented({ title: name, code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options }, main, true);
  return { p, main, r, ir: lowerCore(r.code, r.info, r.names, [main]) };
}

test("drift's motes are moved as columns, and it prints what the evaluator prints", () => {
  const { main, r, ir } = compiled("drift");
  const js = printed(ir).js;
  assert.match(js, /c0: new Float64Array/, "the motes are columns");
  // The step writes x and y and reads vx and vy: the other five fields
  // aren't touched in its loop.
  const step = ir.funcs.find((f) => f.name.startsWith("array map.fold.items·moved"))!;
  const cols = new Set<string>();
  const w = (e: SExpr) => { if (e.k === "rt" && e.fn.startsWith("cols.")) cols.add(e.fn.replace(/\.a\d+/, "")); kids(e).forEach(w); };
  w(step.body);
  assert.deepEqual([...cols].sort(), ["cols.get.0", "cols.get.1", "cols.get.2", "cols.get.3", "cols.set.0_1"]);
  const out: string[] = [], evaluator: string[] = [];
  runCoreMain(ir, "main", ["300"], { print: (s) => out.push(s) });
  runProgram(r.code, r.info, main, ["300"], { print: (s) => evaluator.push(s), names: r.names });
  assert.deepEqual(out, evaluator);
});

test("an array whose items leave whole stays rows", () => {
  // swarm's motes go into a Map; pedal's pairs are read whole.
  for (const name of ["swarm", "pedal"]) {
    const { ir } = compiled(name);
    assert.doesNotMatch(printed(ir).js, /c0: new (Float64Array|Array)\(/, name);
  }
});
