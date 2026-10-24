// The palette offers only fillings that type-check. It checks the risky
// ones against just the definitions they can affect and shares that check
// between fillings that leave those definitions' types the same, so this
// confirms each offer against a full check of the program.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { replace, type NodeOf } from "../src/model.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { fillHole } from "../src/lang/refactor.ts";
import { sweep } from "./helpers.ts";

for (const name of ["calculus", "backwards", "queens"]) {
  test(`every filling the palette offers in ${name} type-checks`, () => {
    const p = loadProgram(join(import.meta.dirname, "../examples", name));
    const calls = Object.values(p.code.nodes).filter((n): n is NodeOf<"call"> => n.kind === "call" && n.args.length > 0);
    const bad: string[] = [];
    for (const c of sweep(calls.filter((_, i) => i % 9 === 0))) {
      const hole = c.args[0];
      const code = replace(p.code, hole, () => ({ kind: "hole" }));
      const info = infer(code);
      for (const f of fillings(code, info, hole)) {
        if (infer(fillHole(code, {}, hole, f).code).errors.length > info.errors.length) bad.push(`${hole}: ${JSON.stringify(f)}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}

// Fillings that leave the group's types the same don't always pass or fail
// together: units come from what's called (multiply multiplies them, add
// needs them equal). One function failing on units used to hide every
// other function of the same type.
test("a call's function as a hole: every function of the right type is offered, checked on its own units", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples/physics"));
  const mul = Object.values(p.code.nodes).find((n): n is NodeOf<"call"> => n.kind === "call" && p.code.nodes[n.fn].kind === "ref" && (p.code.nodes[n.fn] as NodeOf<"ref">).target === "builtin.mul")!;
  const code = replace(p.code, mul.fn, () => ({ kind: "hole" }));
  const info = infer(code);
  const offered = fillings(code, info, mul.fn).flatMap((f) => (f.kind === "ref" ? [f.target] : []));
  for (const op of ["builtin.arith.mul", "builtin.arith.add", "builtin.arith.sub"]) assert.ok(offered.includes(op), `${op} is offered`);
  for (const target of offered) assert.equal(infer(fillHole(code, {}, mul.fn, { kind: "ref", target, type: null as never }).code).errors.length, info.errors.length, target);
});

// One + for every number type (NUMBERS.md, "One `+`"): where a Number or
// an Int is added, the palette offers the generic arithmetic and not each
// type's own, and a program with the generic one means what it did.
test("the palette offers one + − · for Numbers and Ints alike, and a program with it runs the same", async () => {
  const { ARITH } = await import("../src/lang/std.ts");
  const { runMain } = await import("../src/lang/run.ts");
  const own = /^builtin\.(int\.)?(add|sub|mul|neg|less)$/;
  for (const [name, op] of [["physics", "builtin.mul"], ["wc", "builtin.int.add"]]) {
    const p = loadProgram(join(import.meta.dirname, "../examples", name));
    const c = Object.values(p.own.nodes).find((n): n is NodeOf<"call"> => n.kind === "call" && (p.code.nodes[n.fn] as NodeOf<"ref">).target === op)!;
    const code = replace(p.code, c.fn, () => ({ kind: "hole" }));
    const offered = fillings(code, infer(code, p.pres.names), c.fn).flatMap((f) => (f.kind === "ref" ? [f.target] : []));
    for (const g of [ARITH.add, ARITH.sub, ARITH.mul]) assert.ok(offered.includes(g), `${name}: ${g} offered`);
    assert.deepEqual(offered.filter((t) => own.test(t)), [], `${name}: no type's own arithmetic offered`);
  }
  const p = loadProgram(join(import.meta.dirname, "../examples/physics"));
  const run = (code: typeof p.code) => { const out: string[] = []; runMain(code, infer(code, p.pres.names), p.named("main"), { print: (s) => out.push(s) }); return out; };
  const fns = Object.values(p.own.nodes).filter((n) => n.kind === "ref" && n.target === "builtin.mul").map((n) => n.id);
  let code = p.code;
  for (const f of fns) code = replace(code, f, () => ({ kind: "ref", target: ARITH.mul }));
  assert.ok(fns.length > 0);
  assert.deepEqual(infer(code, p.pres.names).errors, []);
  assert.deepEqual(run(code), run(p.code));
});
