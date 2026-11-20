// What is compiled doesn't depend on how the program was checked (L266,
// Ersagun 2026-11-17: "typechecking method shouldn't affect runtime
// perf"). The editor checks an edit over the check before (infer.ts
// inferEdited) and hands that to the compiler; the command line checks
// the whole program. Both must give the same JavaScript and the same C.
// And what the passes learn is carried, not left for a check after them:
// a recursion resolved at Int is seen to end (arith.ts), so it takes no
// steps of a budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../../ters/src/io.ts";
import { infer, inferEdited, type Info } from "../../ters/src/lang/infer.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { resolveArithmetic } from "../../ters/src/lang/arith.ts";
import { subtree, type Code, type Id, type NodeOf, withNodes } from "../../ters/src/model.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreModule, lowerCore } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";

const lib = new Set(LIBRARY.code.defs);
type Loaded = ReturnType<typeof loadProgram>;
const compiled = (p: Loaded, code: Code, info: Info, main: Id) => {
  const names = p.pres.names;
  const q = represented({ title: "x", code, own: p.own.defs, names, info, reps: representationsIn(code, info, names, p.own.defs), options: p.options }, main, true);
  const js = coreModule(lowerCore(q.code, q.info, q.names, [main]), "main", "rt.ts", "world.ts", undefined);
  const c = emitC(lowerScalar(code, info, names, [main], { data: true })).c;
  return { js, c };
};

for (const example of ["fibonacci", "collatz", "bounce"]) test(`${example}: an edit compiles the same checked over the check before or whole`, () => {
  const p = loadProgram(join(root, "examples", example));
  const names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const before = infer(p.code, names, undefined, p.options);
  const lits = p.code.defs.filter((d) => !lib.has(d)).flatMap((d) => subtree(p.code, d)).filter((id) => { const n = p.code.nodes[id]; return n.kind === "lit" && typeof n.value === "number"; });
  let compared = 0;
  for (const id of lits.slice(0, 2)) {
    const l = p.code.nodes[id] as NodeOf<"lit">;
    const next: Code = { ...p.code, nodes: withNodes(p.code.nodes, { [id]: { ...l, value: (l.value as number) + 1 } }) };
    const edited = inferEdited(p.code, next, names, before, p.options);
    const whole = infer(next, names, undefined, p.options);
    if (!edited || whole.errors.length) continue;
    assert.deepEqual(compiled(p, next, edited, main), compiled(p, next, whole, main), `${example} with ${id} edited`);
    compared++;
  }
  assert.ok(compared > 0, "some edit was checked over the check before");
});

test("fibonacci's fib, resolved at Int, ends and spends no budget", () => {
  const p = loadProgram(join(root, "examples", "fibonacci"));
  const names = p.pres.names, fib = p.own.defs.find((d) => names[d] === "fib")!, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  // Generic, counting in any number type, it might not finish.
  assert.ok(info.divergent.has(fib));
  assert.ok(!resolveArithmetic(p.code, info, names).info.divergent.has(fib));
  const ir = lowerScalar(p.code, info, names, [main], { data: true });
  assert.ok(ir.funcs.filter((f) => names[f.def] === "fib" || f.name === "fib").every((f) => !f.spends));
});
