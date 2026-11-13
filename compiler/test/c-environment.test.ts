// L253: an environment variable on C, as the evaluator answers it
// (ters/test/environment.test.ts): getenv's value, or none where it isn't
// set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { ENV_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

test("environment variable on C: getenv's value, or none", { skip }, () => {
  const k = new Lang();
  const main = k.def("main");
  const shown = (name: string) => k.call(S.print, k.call(SHOW_ANY, k.call(ENV_OP, k.lit(name))));
  k.define(main, k.thunk(() => k.seq(shown("TERS_L253"), shown("TERS_L253_UNSET"))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true, cells: true, closureArgs: true });
  const exe = compile(emitC(l, { main }).c);
  const env = { ...process.env, TERS_L253: "café" };
  delete env.TERS_L253_UNSET;
  // NFC as all text that comes in: e + combining acute is é.
  assert.equal(execFileSync(exe, [], { env, encoding: "utf8" }), 'some("café")\nnone\n');
});
