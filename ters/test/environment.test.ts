// L253: environment variables as a world operation. `environment
// variable(name)` is the variable's value or none; the world answers it
// (process.env on Node), `ters run --allow` leaves it out unless the list
// says environment, and the core IR's JavaScript asks the same world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { allowedOnly, nodeWorld } from "../src/lang/world.ts";
import { ENV_OP, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { lowerCore, loadCoreJs } from "../../compiler/src/core-js.ts";

const k = new Lang();
const main = k.def("main");
k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(ENV_OP, k.lit("TERS_L253")))), k.call(S.print, k.call(SHOW_ANY, k.call(ENV_OP, k.lit("TERS_L253_UNSET")))))));
const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
const world = { environmentVariable: (n: string) => (n === "TERS_L253" ? "yes" : null) } as never;

test("environment variable: the world's answer, none where it isn't set, and Environment in main's type", () => {
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.match(showType(info.typeOf.get(main)!, names), /Environment/);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names, world });
  assert.deepEqual(out, ['some("yes")', "none"]);
  // A world without it has none set; Node's is process.env.
  out.length = 0;
  runMain(code, info, main, { print: (s) => out.push(s), names });
  assert.deepEqual(out, ["none", "none"]);
  process.env.TERS_L253 = "from node";
  try {
    out.length = 0;
    runMain(code, info, main, { print: (s) => out.push(s), names, world: nodeWorld() });
    assert.deepEqual(out, ['some("from node")', "none"]);
  } finally { delete process.env.TERS_L253; }
});

test("ters run --allow leaves environment variables out unless it names environment", () => {
  process.env.TERS_L253 = "set";
  try {
    assert.throws(() => allowedOnly(nodeWorld(), ["files"]).environmentVariable!("TERS_L253"), /Environment isn't allowed/);
    assert.equal(allowedOnly(nodeWorld(), ["environment"]).environmentVariable!("TERS_L253"), "set");
  } finally { delete process.env.TERS_L253; }
});

test("the core IR's JavaScript asks the same world", () => {
  const ir = lowerCore(code, info, names, [main]);
  const fi = ir.funcs.findIndex((g) => g.def === main && !g.inner);
  assert.ok(fi >= 0, String(ir.refused.get(main)));
  const out: string[] = [];
  loadCoreJs(ir, { print: (s) => out.push(s), world })[fi]();
  assert.deepEqual(out, ['some("yes")', "none"]);
});
