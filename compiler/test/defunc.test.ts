// A function value in a shader (C225, defunc.ts): examples/tiles picks
// each tile's shape as it draws, a distance function chosen at run time,
// which a GPU (no function pointers) ran only as a record of which shape
// and its size, and a call as an if on which.

import { test } from "node:test";
import assert from "node:assert/strict";
import { kids, lowerScalar, type CoreIR, type SExpr } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { loadJs } from "../src/js-scalar.ts";
import { load } from "../src/program.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";

const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };
const every = (ir: CoreIR): SExpr[] => ir.funcs.flatMap((f) => { const out: SExpr[] = []; const walk = (e: SExpr) => { out.push(e); kids(e).forEach(walk); }; walk(f.body); return out; });

test("examples/tiles: each tile's shape, a function picked as it draws, goes to the GPU as which shape it is (C225)", () => {
  const p = load("tiles"), colour = p.named("colour");
  const lower = () => lowerScalar(p.code, p.info, p.pres.names, [colour], { records: true, shader: true });
  process.env.NO_DEFUNC = "1";
  let before: CoreIR;
  try { before = lower(); } finally { delete process.env.NO_DEFUNC; }
  assert.match(before.refused.get(colour) ?? "", /computed function \(that needs closures\)/);
  const ir = lower();
  assert.deepEqual([...ir.refused.values()], []);
  assert.deepEqual(ir.fns, []);
  assert.ok(!every(ir).some((e) => e.k === "closure" || e.k === "apply" || e.k === "cap"), "no closure left for a printer");
  const s = emitWgsl(ir);
  assert.deepEqual([...s.refused.values()], []);
  // Which of the three shapes, then each one's size: a vec4f.
  assert.match(s.wgsl, /fn shape_of_\w+\([^)]*\) -> vec4f/);
  // The same colours as the evaluator, compiled to JavaScript from the same IR.
  const js = loadJs(ir).get(colour)!;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  let seen = new Set<string>();
  for (const t of [0, 1.3, 2.6]) for (const x of [-0.85, -0.6, -0.15, 0.1, 0.4, 0.75]) for (const y of [-0.8, -0.35, 0.05, 0.3, 0.9]) {
    const want = (first(r.call(r.value(colour), x, y, t)) as { fields: number[] }).fields;
    assert.deepEqual(js(x, y, t), want, `at ${x}, ${y}, ${t}`);
    seen.add(want.join(","));
  }
  // Every kind of tile and the background showed.
  assert.ok(seen.size >= 4, [...seen].join(" | "));
});
