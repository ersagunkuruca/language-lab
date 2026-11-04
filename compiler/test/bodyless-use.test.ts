// A use with no body on the compiled targets (C161, L211): it gives the
// ports it produces, in port order, as a tuple, or the one value when it
// produces one. Here the uses come as the checker sees them before load
// fills them (the node put back after base()), and compile.ts's
// JavaScript and the core IR's take them as ports.ts `filled` reads them
// (uses.ts withBodies), with the evaluator's answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Code, Id, NodeOf } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { tuplePart } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";

// three(n): add with 2 and out = n given (n − 2); both(r): polar with
// length r and angle 0 given, x + 10 y of its (x, y); rest(n): a relation
// x = 10 − y, its own use with no body inside, given y = n.
function program() {
  const k = new Lang();
  const bare: Id[] = [];
  const use = (fn: Id, given: Record<string, Id>) => { const u = k.useOf(fn, given); bare.push(u); return u; };
  const three = k.def("three");
  k.define(three, k.fn(["n"], (n) => use(B.add, { 0: k.lit(2), out: n })));
  const polar = k.def("polar");
  k.define(polar, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(k.equal(x, k.call(B.mul, r, k.call(B.cos, t))), k.equal(y, k.call(B.mul, r, k.call(B.sin, t))))));
  k.results(polar, "x", "y");
  const [r, t] = (k.code.nodes[(k.code.nodes[polar] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const both = k.def("both");
  k.define(both, k.fn(["n"], (n) => k.let("p", use(polar, { [r]: n, [t]: k.lit(0), out: k.true }), (p) =>
    k.call(B.add, k.call(tuplePart(2, 0), p), k.call(B.mul, k.lit(10), k.call(tuplePart(2, 1), p))))));
  const rel = k.def("rest of ten");
  k.define(rel, k.fn(["x", "y"], (x, y) => k.equal(x, use(B.add, { 0: y, out: k.lit(10) }))));
  k.results(rel, "x");
  const [, y] = (k.code.nodes[(k.code.nodes[rel] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const rest = k.def("rest");
  k.define(rest, k.fn(["n"], (n) => use(rel, { [y]: n, out: k.true })));
  const code: Code = base(k.code), names = baseNames(k.names);
  for (const u of bare) code.nodes[u] = k.code.nodes[u];
  for (const u of bare) assert.equal((code.nodes[u] as { body?: Id }).body, undefined, "not filled");
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, defs: [three, both, rest] };
}

const inputs = [0, 3, 7.5];

test("uses with no body give the evaluator's answers on compile.ts's JavaScript and the core IR's", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: Id, x: number) => { for (const v of r.call(r.value(d), x)) return v; };
  const want = p.defs.map((d) => inputs.map((x) => ev(d, x)));
  assert.deepEqual(want, [[-2, 1, 5.5], [0, 3, 7.5], [10, 7, 2.5]]);
  // compile.ts
  const path = join(mkdtempSync(join(tmpdir(), "bodyless-")), "m.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: p.defs.map((d) => p.names[d]) }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, (x: number) => unknown>;
  assert.deepEqual(p.defs.map((d) => inputs.map((x) => defs[p.names[d]](x))), want);
  // The core IR's JavaScript.
  const core = lowerCore(p.code, p.info, p.names, p.defs);
  assert.deepEqual([...core.refused.entries()], []);
  const fs = loadCoreJs(core);
  const fn = (d: Id) => fs[core.funcs.findIndex((g) => g.def === d && !g.inner)];
  assert.deepEqual(p.defs.map((d) => inputs.map((x) => fn(d)(x))), want);
});

// WebAssembly and C solve no relation yet (scalar.ts: a solve needs the
// host's solver): a use with no body is refused there for that reason, as
// the filled one is, not for its shape.
test("in WebAssembly and C a use with no body is refused as a filled one is: they solve no relation yet", () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, p.defs, { data: true });
  assert.deepEqual([...new Set(lowered.refused.values())], ["solves a relation (not in this profile yet)"]);
});
