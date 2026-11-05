// compare and sort go through a type's Ordered on the core IR too (L204g,
// C139b): a priority whose order is the other way round from its number's
// sorts the highest first in the core IR's JavaScript, WebAssembly and C,
// as the evaluator sorts it, and the prelude's Rational is ordered by its
// own less, not by a case of its named in scalar.ts. Before, the core IR
// ordered a priority by its number.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { COMPARE, INT_OPS, ORDERED_V, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { INT } from "../../ters/src/lang/types.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { lowerCore, loadCoreJs } from "../src/core-js.ts";
import { emitWasm, instantiate, fromText } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const k = new Lang(LIBRARY.code);
const P = k.type("Priority", [], [["priority", [["level", () => k.tref(INT)]]]]);
const pr = (n: number) => k.call(P.v.priority, k.int(n));
const level = (x: Id, f: (l: Id) => Id) => k.match(x, [{ variant: P.v.priority, names: ["level"], body: ([l]) => f(l) }]);
const higher = k.def("higher");
k.define(higher, k.fn(["a", "b"], (a, b) => level(a, (la) => level(b, (lb) => k.call(INT_OPS.less, lb, la)))));
k.define(k.def("ordered at priority"), k.call(ORDERED_V, k.x(higher)));
const fr = (a: number, b: number) => k.call(lib("fraction"), k.int(a), k.int(b));
// Each: its name, what it shows, and whether it can't fail (a fraction
// over 0 can, so WebAssembly gives Rational's wrapped and C alone is read).
const cases: [string, Id, string, boolean][] = [
  ["one against two", k.call(SHOW_ANY, k.call(COMPARE, pr(1), pr(2))), "after", true],
  ["two against two", k.call(SHOW_ANY, k.call(COMPARE, pr(2), pr(2))), "same", true],
  ["sorted", k.call(SHOW_ANY, k.call(lib("sort"), k.list(pr(1), pr(3), pr(2)))), "[priority(3), priority(2), priority(1)]", true],
  ["fractions", k.call(SHOW_ANY, k.call(lib("sort"), k.list(fr(1, 2), fr(-3, 4), fr(2, 3), fr(1, 3)))), "[-3/4, 1/3, 1/2, 2/3]", false],
];
const defs = cases.map(([name, body]) => { const d = k.def(name); k.define(d, k.fn([], () => body)); return d; });
const code = base(k.code), names = baseNames(k.names);
const info = infer(code, names, undefined, checkOptions);

for (const [i, [name, , want, total]] of cases.entries()) test(`${name}: through Ordered on the core IR's targets (C139b)`, async () => {
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const d = defs[i];
  const r = makeRunner(code, info, { print: () => {}, names });
  let ev: unknown;
  for (const x of r.call(r.value(d))) { ev = x; break; }
  assert.equal(ev, want);
  const core = lowerCore(code, info, names, [d]);
  assert.equal(core.refused.get(d), undefined);
  const fns = loadCoreJs(core, { print: () => {} }) as ((...xs: unknown[]) => unknown)[];
  assert.equal(fns[core.funcs.findIndex((f) => f.name === name)](), want);
  const ir = lowerScalar(code, info, names, [d], { data: true });
  assert.equal(ir.refused.get(d), undefined);
  if (total) {
    const ex = await instantiate(emitWasm(ir)) as unknown as Record<string, (...xs: never[]) => unknown>;
    assert.equal(fromText(ex, ex[name]()), want);
  }
  if (!skip) assert.equal(build(ir)([[ir.funcs.findIndex((f) => f.name === name), []]])[0].value, want);
});
