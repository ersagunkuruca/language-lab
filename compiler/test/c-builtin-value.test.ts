// A runtime builtin given as a value on C and WebAssembly (C195,
// converter's `quantity` hands `show` on): a closure whose code calls the
// runtime's function, printing what the evaluator prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { INT_OPS, S } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

function program() {
  const k = new Lang();
  const applied = k.def("applied to"), main = k.def("main");
  k.define(applied, k.fn(["f", "x"], (f, x) => k.call(f, x)));
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(applied, k.x(S.show), k.lit(1.5))),
    k.call(S.print, k.call(applied, k.x(S.show), k.lit(-0.25))),
    k.call(S.print, k.call(applied, k.x(INT_OPS.show), k.int(42))),
  )));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), main };
}

test("C gives show as a value, a closure calling the runtime's show", { skip }, () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const out: string[] = [];
  runProgram(p.code, p.info, p.main, [], { print: (l) => out.push(l), names: p.names });
  const exe = compile(emitC(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { main: p.main }).c);
  const r = spawnSync(exe, [], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, out.map((l) => `${l}\n`).join(""));
});
