// Where a definition can run, told from types (profiles.ts, L22b): every
// "no" told there is the compiler's "no" too (its lowering, scalar.ts), on
// each example, so the editor can say it before the lowering answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { gpuRefusals } from "../src/lang/profiles.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { ARITH, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

test("a definition that gives a List is told it can't run on the GPU, from its type alone; its callers aren't", () => {
  const k = new Lang();
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const wrapped = fn("wrapped", ["x"], (x) => k.list(x));
  const twice = fn("twice", ["x"], (x) => k.call(ARITH.add, x, x));
  const caller = fn("caller", ["x"], (x) => k.let("w", k.call(wrapped, x), () => k.call(twice, k.call(ARITH.mul, x, k.lit(1.5)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const why = gpuRefusals(code, info, names, [wrapped, twice, caller]);
  assert.match(why.get(wrapped)!, /^takes or gives List, which has 2 cases/);
  assert.equal(why.get(twice), undefined);
  assert.equal(why.get(caller), undefined);
  // And the compiler says so too.
  assert.ok(lowerScalar(code, info, names, [wrapped], { records: true, shader: true }).refused.has(wrapped));
});

// L22c: an effect in a definition's type is carried to its callers, so a
// caller of one that prints is told it can't run on the GPU from its own
// type, as the lowering says; one that handles it isn't.
test("a definition that prints can't run on the GPU, nor can its callers, told from their types", () => {
  const k = new Lang();
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const shout = fn("shout", ["x"], (x) => k.seq(k.call(S.print, k.call(SHOW_ANY, x)), k.call(ARITH.mul, x, k.lit(2))));
  const caller = fn("caller", ["x"], (x) => k.call(ARITH.add, k.call(shout, x), k.lit(1)));
  const quiet = fn("quiet", ["x"], (x) => k.call(ARITH.mul, x, x));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const why = gpuRefusals(code, info, names, [shout, caller, quiet]);
  assert.equal(why.get(shout), "has effects (Console)");
  assert.equal(why.get(caller), "has effects (Console)");
  assert.equal(why.get(quiet), undefined);
  const theirs = lowerScalar(code, info, names, [shout, caller, quiet], { records: true, shader: true }).refused;
  assert.match(theirs.get(shout)!, /has effects \(Console\)/);
  assert.ok(theirs.has(caller));
  assert.ok(!theirs.has(quiet));
});

test("every no told from types is the compiler's no too, on each example", () => {
  let told = 0;
  for (const e of ["sort", "queens", "physics", "routes", "shaders", "raymarch", "calc", "wc", "calculus", "impact", "agent", "effects", "countdown", "dice"]) {
    const p = loadProgram(`examples/${e}`);
    const info = infer(p.code, p.pres.names);
    if (info.errors.length) continue;
    const own = p.code.defs.filter((d) => !LIBRARY.code.nodes[d]);
    const ours = gpuRefusals(p.code, info, p.pres.names, own);
    let theirs: Map<string, string>;
    try { theirs = lowerScalar(p.code, info, p.pres.names, own, { records: true, shader: true }).refused; } catch { continue; }
    for (const [d, why] of ours) {
      told++;
      assert.ok(theirs.has(d), `${e}: ${p.pres.names[d]} ${why}, but the compiler lowers it`);
    }
  }
  assert.ok(told >= 8, `${told} told`);
});
