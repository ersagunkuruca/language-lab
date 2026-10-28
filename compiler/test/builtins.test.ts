// One builtin is described in up to eleven places (REVIEW-2026-10-22b.md
// §4): its type in std.ts, how it runs forward (run.ts), backwards
// (relate.ts), compiled (compile.ts), and more. A table that misses one
// fails only when a program happens to use it that way, which is how
// compiled `tan` couldn't be compiled at all. So this goes through every
// builtin std.ts declares and asks each job for it: it either does it, or
// refuses with a reason of its own. A new builtin without an entry fails
// here, not in somebody's program.

import { test } from "node:test";
import assert from "node:assert/strict";
import { S, SET, SIGS, STD_IMPL, STD_MANY, stdNames } from "../../projectional/src/lang/std.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { NotInvertible, relate } from "../../projectional/src/lang/relate.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import { NUMBER, Subst } from "../../projectional/src/lang/types.ts";
import { differentiate, NotDifferentiable } from "../../projectional/src/lang/derive.ts";
import { constraints } from "../../projectional/src/units.ts";
import { B } from "../../projectional/src/prelude.ts";
import { lowerScalar, OPS as SCALAR_OPS } from "../src/scalar.ts";
import { TARGETS } from "../src/builtins.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { emitWgsl } from "../src/wgsl.ts";
import type { Id } from "../../projectional/src/model.ts";
import { compile } from "../src/compile.ts";

// Builtins whose first input must be written in place, so a plain
// f(x, …) = builtin(x, …) can't use them; their own tests cover them.
const IN_PLACE: Record<Id, string> = {
  [SET]: "set takes the field it sets written in place (test/records.test.ts)",
  [S.byItsWays]: "by its ways only fills an implementation's field, and a way replaces it before anything runs (projectional/test/ways.test.ts)",
};

// f(x0, …) = builtin(x0, …), checked.
function calling(id: Id) {
  const t = SIGS[id](new Subst());
  const n = t.t === "fn" ? t.params.length : 0;
  const k = new Lang();
  const f = k.def("f");
  k.define(f, n ? k.fn(Array.from({ length: n }, (_, i) => `x${i}`), (...xs) => k.call(id, ...xs)) : k.thunk(() => k.call(id)));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), f };
}

const builtins = Object.keys(SIGS).filter((id) => !IN_PLACE[id]);
const name = (id: Id) => `${stdNames[id] ?? id} (${id})`;

test("std.ts declares the builtins this test goes through", () => {
  assert.ok(builtins.length > 60);
  for (const id of [S.equal, S.print, S.first]) assert.ok(SIGS[id], id);
});

test("every builtin type-checks when called, and the evaluator runs it", () => {
  for (const id of builtins) {
    const { code, info, f } = calling(id);
    assert.deepEqual(info.errors.map((e) => e.message), [], name(id));
    const r = makeRunner(code, info, { print: () => {} });
    assert.equal(typeof r.value(id), "function", `${name(id)} has no implementation in run.ts`);
    assert.ok(r.value(f) !== undefined);
  }
});

test("every builtin has one record for the compiler's targets (builtins.ts), agreeing with std.ts", () => {
  for (const id of [...builtins, SET]) {
    const t = TARGETS[id];
    assert.ok(t, `${name(id)} has no record in compiler/src/builtins.ts`);
    // std.ts's implementation is run only where there is one; a Choice
    // builtin is partial, and only those are.
    if (t.js === "impl") assert.ok(STD_IMPL[id] && !STD_MANY[id], name(id));
    assert.equal(t.js === "partial", !!STD_MANY[id], name(id));
    if (typeof t.scalar === "string") assert.ok(t.scalar in SCALAR_OPS, name(id));
  }
  assert.deepEqual(Object.keys(TARGETS).filter((id) => !SIGS[id]), []);
});

test("every builtin compiles to JavaScript", () => {
  for (const id of builtins) {
    const { code, info, names } = calling(id);
    assert.doesNotThrow(() => compile(code, info, names, { runtime: "./runtime.js", exports: ["f"] }), name(id));
  }
});

test("every builtin runs backwards, or says why it can't", () => {
  for (const id of builtins) {
    const { code, f } = calling(id);
    try {
      let steps = 0;
      for (const _ of relate(code, f, {}, { spend: () => ++steps < 200 })) break;
    } catch (e) {
      if (!(e instanceof NotInvertible)) throw e;
      // The fallback for an id relate.ts has no rule for isn't a reason.
      assert.doesNotMatch(e.message, /has no backwards reading/, `${name(id)}: relate.ts has neither a rule nor a reason`);
    }
  }
});

// The number builtins have three more jobs, each a table of its own: a
// derivative (derive.ts), a unit rule (units.ts), and the scalar profile
// that WASM and WGSL print (scalar.ts). Each does it or says why not.
const numberOnly = builtins.filter((id) => {
  const t = SIGS[id](new Subst());
  return t.t === "fn" && t.params.length > 0 && [...t.params, t.ret].every((p) => p.t === "con" && p.id === NUMBER);
});

// The second input stays at 2 (a divisor, a power that's whole).
const SAMPLE = [0, 2];
const arity = (id: Id) => { const t = SIGS[id](new Subst()); return t.t === "fn" ? t.params.length : 0; };

test("std.ts's number builtins are the ones these tables cover", () => {
  assert.ok(numberOnly.length >= 16, numberOnly.join(" "));
  for (const id of [B.add, B.sin, S.abs, S.floor, S.mod]) assert.ok(numberOnly.includes(id), id);
});

test("every number builtin has a derivative, or says why not", () => {
  for (const id of numberOnly) {
    const { code, names, f } = calling(id);
    let d;
    try { d = differentiate(code, names, f); } catch (e) {
      if (!(e instanceof NotDifferentiable)) throw e;
      assert.doesNotMatch(e.message, /isn't arithmetic/, `${name(id)}: derive.ts has neither a rule nor a reason`);
      continue;
    }
    // And it's the slope: against a central difference, away from jumps.
    const r = makeRunner(d.code, infer(d.code, d.names), { print: () => {} });
    const run = (g: Id, xs: number[]) => r.call(r.value(g), ...xs).next().value as number;
    for (const x of [0.3, 1.7, 2.45]) {
      const xs = SAMPLE.slice(0, arity(id)).map((v, i) => (i === 0 ? x : v));
      // Rounding to Float32 is flat between f32 values (about 1e-7 apart
      // here), so its difference quotient needs a wider step.
      const h = id === S.float32 ? 1e-2 : 1e-6, up = [...xs], down = [...xs];
      up[0] += h; down[0] -= h;
      const want = (run(f, up) - run(f, down)) / (2 * h);
      assert.ok(Math.abs(run(d.def, xs) - want) < 1e-4 * (1 + Math.abs(want)), `${name(id)}′ at ${xs}: ${run(d.def, xs)} ≠ ${want}`);
    }
  }
});

test("every number builtin has a unit rule", () => {
  for (const id of numberOnly) {
    const { code, f } = calling(id);
    // f's own call: the library's nodes (published, "@…") call it too.
    const call = Object.values(code.nodes).find((n) => !n.id.startsWith("@") && n.kind === "call" && (code.nodes[n.fn] as { target?: Id }).target === id)!;
    assert.ok(constraints(code, f).some((c) => c.node === call.id), `${name(id)}: units.ts has no rule for it`);
  }
});

test("every number builtin lowers to the scalar profile (WASM, WGSL), or says why not", async () => {
  for (const id of numberOnly) {
    const { code, info, names, f } = calling(id);
    const lowered = lowerScalar(code, info, names, [f]);
    const why = lowered.refused.get(f);
    if (why) { assert.doesNotMatch(why, /isn't in the scalar profile$/, `${name(id)}: scalar.ts has neither a rule nor a reason: ${why}`); continue; }
    // WGSL prints it (the GPU run, gpu.ts, checks its numbers).
    assert.doesNotThrow(() => emitWgsl(lowered), name(id));
    // WASM gives the evaluator's numbers exactly.
    const w = await instantiate(emitWasm(lowered));
    const r = makeRunner(code, info, { print: () => {} });
    for (const x of [-2.5, -1, 0.5, 3.7]) {
      const xs = SAMPLE.slice(0, arity(id)).map((v, i) => (i === 0 ? x : v));
      const want = r.call(r.value(f), ...xs).next().value;
      assert.ok(Object.is(w.f(...xs), want), `${name(id)}(${xs}) in WASM: ${w.f(...xs)} ≠ ${want}`);
    }
  }
});
