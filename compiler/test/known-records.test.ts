// A known record of functions given to a definition (C224,
// known-records.ts): an implementation passed by hand, `half
// through(halving at float64, y)`, is read and called directly in the
// definition's own copy, and the record isn't built. Answers are the
// evaluator's, on the core IR's JavaScript and WebAssembly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { B } from "../../ters/src/prelude.ts";
import { S } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { kids, lowerScalar, type CoreIR, type SExpr } from "../src/scalar.ts";
import { compiledDefs } from "../src/core-js.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";

// Halving a = halving(half, twice), at Float64. `half through(how, x)`
// reads how's half and calls it; `halve times(how, n, x)` hands how to
// itself n times and to half through; `either(how, x)` reads both.
function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const h = k.interface("Halving", "a", [["half", (a) => k.tfun([k.tref(a)], k.tref(a))], ["twice", (a) => k.tfun([k.tref(a)], k.tref(a))]]);
  const at = def("halving at float64", () => k.call(h.v, k.fn(["x"], (x) => k.call(B.div, x, k.lit(2))), k.fn(["x"], (x) => k.call(B.mul, x, k.lit(2)))));
  const parts = (how: Id, f: (half: Id, twice: Id) => Id) => k.match(how, [{ variant: h.v, names: ["half", "twice"], body: ([half, twice]) => f(half, twice) }]);
  const through = def("half through", () => k.fn(["how", "x"], (how, x) => parts(how, (half) => k.call(half, x))));
  const times = k.def("halve times");
  k.define(times, k.fn(["how", "n", "x"], (how, n, x) => k.if(k.call(S.less, n, k.lit(1)), x, k.call(times, how, k.call(B.sub, n, k.lit(1)), k.call(through, how, x)))));
  const either = def("either", () => k.fn(["how", "x"], (how, x) => parts(how, (half, twice) => k.call(B.add, k.call(half, x), k.call(twice, x)))));
  const roots = [
    def("passed along", () => k.fn(["y"], (y) => k.call(through, k.x(at), y))),
    def("halved often", () => k.fn(["y"], (y) => k.call(times, k.x(at), k.lit(3), y))),
    def("both ways", () => k.fn(["y"], (y) => k.call(either, k.x(at), y))),
  ];
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, roots, record: h.def };
}

// What a root reaches: its function and every function it calls.
function reached(ir: CoreIR, from: number): SExpr[] {
  const seen = new Set<number>(), out: SExpr[] = [];
  const go = (fi: number) => {
    if (seen.has(fi)) return;
    seen.add(fi);
    const walk = (e: SExpr) => { out.push(e); if (e.k === "call") go(e.fn); if (e.k === "closure") go(e.fn); kids(e).forEach(walk); };
    walk(ir.funcs[fi].body);
  };
  go(from);
  return out;
}

test("a known record of functions given to a definition is called through directly, and isn't built (C224)", async () => {
  const p = program();
  const names = p.roots.map((d) => p.names[d]);
  const run = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const want = (d: Id, y: number) => { for (const v of run.call(run.value(d), y)) return v; throw new Error("no answer"); };
  const ys = [9, -3, 0.5];
  const lower = () => lowerScalar(p.code, p.info, p.names, p.roots, { data: true });
  // As lowered before: the record made, a field read and a call through it.
  process.env.NO_KNOWN_RECORDS = "1";
  let plain: CoreIR;
  try { plain = lower(); } finally { delete process.env.NO_KNOWN_RECORDS; }
  const ir = lower();
  assert.deepEqual([...ir.refused.values()], []);
  for (const [i, d] of p.roots.entries()) {
    const root = (x: CoreIR) => x.funcs.findIndex((f) => f.def === d && !f.inner);
    const was = reached(plain, root(plain)), now = reached(ir, root(ir));
    assert.ok(was.some((e) => e.k === "apply"), `${names[i]} was called through`);
    assert.deepEqual(now.filter((e) => e.k === "apply" || e.k === "make" || e.k === "closure" || e.k === "get").map((e) => e.k), [], names[i]);
  }
  // The answers, compiled to JavaScript and to WebAssembly.
  const js = compiledDefs(p.code, p.info, p.names, names) as unknown as Record<string, (y: number) => Value>;
  const w = (await instantiate(emitWasm(ir))) as unknown as Record<string, (y: number) => number>;
  for (const [i, d] of p.roots.entries()) {
    const f = ir.funcs.find((g) => g.def === d && !g.inner)!;
    for (const y of ys) {
      const v = want(d, y);
      assert.equal(js[names[i]](y), v, `${names[i]}(${y}) on JavaScript`);
      assert.equal(w[f.name](y), v, `${names[i]}(${y}) on WebAssembly`);
    }
  }
});
