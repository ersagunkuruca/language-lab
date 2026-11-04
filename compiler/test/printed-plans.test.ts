// A solve the equations' solver plans is printed as its plan (C167a,
// DEBUG-AND-SPEED-2026-11-04 §1): relations' split is `(s + d) / 2` and
// `(s − d) / 2` in the compiled code, and the module ships neither the
// program's nodes nor the evaluator's solver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { coreModule, emitCoreJs, lowerCore, usesSolver } from "../src/core-js.ts";

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
  assert.equal(usesSolver(ir), false);
  const b = load("backwards"), main = b.named("main");
  assert.match(emitCoreJs(lowerCore(b.code, b.info, b.pres.names, [main])).js, /R\.moded\([\s\S]*"hello, "/);
});
