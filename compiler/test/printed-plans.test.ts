// A solve the equations' solver plans is printed as its plan (C167a,
// DEBUG-AND-SPEED-2026-11-04 §1): relations' split is `(s + d) / 2` and
// `(s − d) / 2` in the compiled code, and the module ships neither the
// program's nodes nor the evaluator's solver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { coreModule, emitCoreJs, loadPrinted, lowerCore, printed, solverCode, usesSolver } from "../src/core-js.ts";
import { runProgram } from "../../ters/src/lang/run.ts";

test("relations' solves are printed plans: no node table, no evaluator (C167a)", () => {
  const p = load("relations"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const { js } = emitCoreJs(ir);
  assert.match(js, /\(\(v2 \+ v3\) \/ 2\)/);
  assert.doesNotMatch(js, /R\.rt\("solve/);
  assert.equal(usesSolver(ir), false);
  const m = coreModule(ir, p.pres.names[main] ?? "main", "/x/core-rt.ts", "/x/world.ts");
  assert.match(m, /import \{ plans \} from "\/x\/plan-rt\.js"/);
  assert.doesNotMatch(m, /core-solve|"nodes"/);
});

// A relational solve's mode plan is printed too (C167b), its forward
// calls the builtins' own: the pedal's solves are all printed, so its
// page ships no nodes, and backwards' greeting taken apart is one.
test("mode plans are printed, with builtins run forward (C167b)", () => {
  const pedal = load("pedal"), page = pedal.named("main");
  const ir = lowerCore(pedal.code, pedal.info, pedal.pres.names, [page]);
  const { js } = emitCoreJs(ir);
  assert.match(js, /R\.moded\(/);
  assert.match(js, /"builtin\.div"/);
  // An answer's value is read where it is used, not through the runtime
  // (C137d22).
  assert.doesNotMatch(js, /R\.rt\("pick:/);
  // A mode plan's data is made with the program's own classes (C137d23).
  const plan = js.slice(js.indexOf("R.moded("));
  assert.match(plan, /new K\d+\(/);
  assert.doesNotMatch(plan.slice(0, plan.indexOf("return solve$;")), /fields: \[/);
  assert.equal(usesSolver(ir), false);
  const b = load("backwards"), main = b.named("main");
  assert.match(emitCoreJs(lowerCore(b.code, b.info, b.pres.names, [main])).js, /R\.moded\([\s\S]*"hello, "/);
});

// Where the evaluator's solver still runs, it gets only the nodes it reads
// (C167c): converter's one solve reads a couple of hundred of its nodes.
test("a solve the evaluator runs is given only the nodes it reaches (C167c)", () => {
  const p = load("converter"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const c = solverCode(ir, emitCoreJs(ir).js);
  const n = Object.keys(c.nodes).length;
  assert.ok(n > 0 && n < Object.keys(ir.code.nodes).length / 4, `${n} nodes`);
});

// A derivative and `for some` too (C167d): what they look inside is the
// printed closure's lambda, so they read only what it reaches, and a
// derivative's rules the builtins by id. calculus given only those nodes,
// as its module is, prints what the evaluator does.
test("a derivative is given only the nodes it reaches, and calculus says the same (C167d)", () => {
  const p = load("calculus"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const shown = printed(ir), n = Object.keys(shown.code!.nodes).length;
  assert.ok(n > 0 && n < Object.keys(ir.code.nodes).length / 2, `${n} nodes`);
  const want: string[] = [], got: string[] = [];
  runProgram(p.code, p.info, main, [], { print: (s) => want.push(s), names: p.pres.names });
  const fi = ir.funcs.findIndex((g) => g.name === "main" && !g.inner && !g.budgeted);
  const fs = loadPrinted(shown, { print: (s) => got.push(s) }, shown.code);
  fs[fi](...(ir.funcs[fi].params.length ? [null] : []));
  assert.deepEqual(got, want);
});
