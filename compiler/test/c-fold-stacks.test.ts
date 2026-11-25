// C327d (ALLOCATIONS-2026-11-24.md): a fold run as a loop down and a loop
// up keeps the values it passed on one growable stack in C, not a cell
// each. Here sort's and insert's (a list of 200, past the eight a stack
// holds in its own cell, and an empty one), and calculus's polynomial of
// a hundred thousand coefficients: the evaluator's answers, and every
// cell freed, the stack kept for the next fold not counted. Countdown's
// permutations, a function with several answers, keep their frames.
// WebAssembly keeps them the same way, one struct and a growable array
// (its answers on these inputs are wasm.test.ts's).

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunner, toList, type Value } from "../../ters/src/lang/run.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { build, hex, skip } from "./c-harness.ts";

const lowered = (name: string) => { const p = load(name); return { p, ir: lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true }) }; };

test("a fold's frames are one stack in C, not a cell each", { skip }, () => {
  for (const [name, fns] of [["sort", ["sort", "insert"]], ["calculus", ["polynomial"]]] as const) {
    const { p, ir } = lowered(name);
    const c = emitC(ir).c;
    assert.match(c, /lab_stack_push\(/, `${name}: its folds push onto a stack`);
    assert.doesNotMatch(c, /lab_new\(sizeof\(\w*frames\w*_frame\)/, `${name}: no frame cells`);
    const r = makeRunner(p.code, p.info, { print: () => {} });
    const calls: [number, Value[]][] = [];
    for (const fn of fns) {
      const i = ir.funcs.findIndex((g) => g.name === fn && !g.inner);
      assert.ok(i >= 0, `${name}: ${fn}`);
      const inputs: Value[][] = fn === "sort" ? [[toList(Array.from({ length: 200 }, (_, k) => (k * 37) % 101))], [toList([])], [toList([2, 1])]]
        : fn === "insert" ? [[2.5, toList(Array.from({ length: 30 }, (_, k) => k))], [0, toList([])]]
        : [[toList(Array.from({ length: 1e5 }, (_, k) => (k % 7) / 1e3)), 0.999], [toList([1, -2, 0.5]), 3]];
      for (const xs of inputs) calls.push([i, xs]);
    }
    const got = build(ir)(calls);
    calls.forEach(([i, xs], k) => {
      const bits = (v: Value) => JSON.stringify(v, (_, x) => (typeof x === "number" ? hex(x) : x));
      const want = [...r.call(r.value(ir.funcs[i].def), ...xs)][0];
      assert.equal(bits(got[k].value), bits(want), `${name}: ${ir.funcs[i].name}`);
      assert.equal(got[k].live, 0, `${name}: ${ir.funcs[i].name}: cells left`);
    });
  }
  // Several answers go on from the same stack: their frames stay cells.
  assert.doesNotMatch(emitC(lowered("countdown").ir).c, /lab_stack_push\(/, "countdown");
});

test("a fold's frames are one stack in WebAssembly, not a struct each", () => {
  for (const name of ["sort", "calculus"]) {
    const w = emitWasm(lowered(name).ir).wat;
    assert.match(w, /call \$fstack\.push\.\d+/, `${name}: its folds push onto a stack`);
    // Only `done`, made once in its global.
    assert.deepEqual(w.match(/struct\.new \$\w*frames\w*\.\w+/g), [w.match(/struct\.new \$\w*frames\w*\.done/)![0]], name);
  }
  assert.doesNotMatch(emitWasm(lowered("countdown").ir).wat, /fstack/, "countdown");
});
