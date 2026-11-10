// An array of records stored as columns (columns.ts, C60): drift's motes,
// stored by the chooser as an array, are moved as an array per field, and
// the program prints what the evaluator prints. Where an item leaves whole
// (every other example today), the array stays rows: none of them prints
// a column.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const w = (e: SExpr) => { if (e.k === "rt" && /^array\.c(get|set|new|length)/.test(e.fn)) cols.add(e.fn.replace(/\.a\d+/, "")); kids(e).forEach(w); };
  w(step.body);
  assert.deepEqual([...cols].sort(), ["array.cget0", "array.cget1", "array.cget2", "array.cget3", "array.cset0_1"]);
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

// On C (`ters native`, C60 c2a), a map of an array of one type writes
// into the array it was given, in place where nothing else counts it;
// since c2d the buffer keeps the motes as columns.
test("drift's map on C writes into the array it was given, and prints what ters run prints", () => {
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), ex = join(import.meta.dirname, "../../ters/examples/drift");
  const out = join(mkdtempSync(join(tmpdir(), "drift-c-")), "drift");
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const c0 = readFileSync(`${out}.c`, "utf8");
  assert.match(c0, /lab_array_replaceAt_a\d+\(/);
  // c2d: its buffer holds the motes as columns, field 1 after every field 0.
  assert.match(c0, /->it \+ \(size_t\)\S+->cap \* 8\)\)/);
  const c = spawnSync(out, ["300"], { encoding: "utf8" }), run = spawnSync(process.execPath, [ters, "run", ex, "300"], { encoding: "utf8" });
  assert.equal(c.stdout, run.stdout);
});
