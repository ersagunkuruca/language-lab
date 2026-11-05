// A Shown and an Ordered with type parameters (L219, `Ordered (Tagged a)`)
// are found and used: std.ts implementationsOf read only the ones at a
// closed type, so the evaluator and every compiled target showed a
// Tagged as tagged(1, "x1") and sorted it by its fields. The evaluator,
// the core IR's JavaScript, WebAssembly and C now show it through its own
// show and sort it by its own less, each made at the type's arguments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { COMPARE, INT_OPS, ORDERED_V, S, SHOW_ANY, SHOWN_V } from "../../ters/src/lang/std.ts";
import { INT } from "../../ters/src/lang/types.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { lowerCore, loadCoreJs } from "../src/core-js.ts";
import { emitWasm, instantiate, fromText } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const k = new Lang(LIBRARY.code);
const T = k.type("Tagged", ["a"], [["tagged", [["level", () => k.tref(INT)], ["what", (_s, ps) => k.tref(ps[0])]]]]);
const tg = (n: number) => k.call(T.v.tagged, k.int(n), k.lit(`x${n}`));
const level = (x: Id, f: (l: Id) => Id) => k.match(x, [{ variant: T.v.tagged, names: ["level", "what"], body: ([l]) => f(l) }]);
const higher = k.def("higher");
k.define(higher, k.fn(["a", "b"], (a, b) => level(a, (la) => level(b, (lb) => k.call(INT_OPS.less, lb, la)))));
k.define(k.def("ordered at tagged"), k.call(ORDERED_V, k.x(higher)));
const showT = k.def("show tagged");
k.define(showT, k.fn(["t"], (t) => level(t, (l) => k.call(S.concat, k.lit("#"), k.call(INT_OPS.show, l)))));
k.define(k.def("shown at tagged"), k.call(SHOWN_V, k.x(showT)));
const cases: [string, Id, string][] = [
  ["one against two", k.call(SHOW_ANY, k.call(COMPARE, tg(1), tg(2))), "after"],
  ["sorted", k.call(SHOW_ANY, k.call(lib("sort"), k.list(tg(1), tg(3), tg(2)))), "[#3, #2, #1]"],
];
const defs = cases.map(([name, body]) => { const d = k.def(name); k.define(d, k.fn([], () => body)); return d; });
const code = base(k.code), names = baseNames(k.names);
const info = infer(code, names, undefined, checkOptions);

for (const [i, [name, , want]] of cases.entries()) test(`${name}: a Tagged a through its own Shown and Ordered, evaluated and compiled (L219)`, async () => {
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const d = defs[i];
  const r = makeRunner(code, info, { print: () => {}, names });
  let ev: unknown;
  for (const x of r.call(r.value(d))) { ev = x; break; }
  assert.equal(ev, want);
  const core = lowerCore(code, info, names, [d]);
  const fns = loadCoreJs(core, { print: () => {} }) as ((...xs: unknown[]) => unknown)[];
  assert.equal(fns[core.funcs.findIndex((f) => f.name === name)](), want);
  const ir = lowerScalar(code, info, names, [d], { data: true });
  assert.equal(ir.refused.get(d), undefined);
  const ex = await instantiate(emitWasm(ir)) as unknown as Record<string, (...xs: never[]) => unknown>;
  assert.equal(fromText(ex, ex[name]()), want);
  if (!skip) assert.equal(build(ir)([[ir.funcs.findIndex((f) => f.name === name), []]])[0].value, want);
});
