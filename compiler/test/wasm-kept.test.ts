// A definition's value is worked out once in WebAssembly (C173), kept in
// a global the first time it is called, as the core IR's JavaScript keeps
// it: bounce's Clifford table (`flat`) was made again for every step, 7.7×
// the core JS time, and is now made once. That every example still gives
// what the evaluator gives on WebAssembly is the targets' sweeps'.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate, toInt } from "../src/wasm.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { merge, type Id } from "../../ters/src/model.ts";
import { CONS, INT_OPS, NIL } from "../../ters/src/lang/std.ts";

test("a definition's value is kept, not worked out at every use (C173)", async () => {
  const p = load("bounce");
  const k = new Lang(p.code), d = k.def("bench");
  // n of bounce's steps in the flat space, the space read at each.
  k.define(d, k.fn(["n"], (n) => k.fold(k.call(INT_OPS.range, n), [
    { variant: NIL, names: [], body: () => k.x(p.named("flat bodies")) },
    { variant: CONS, names: ["i", "t"], results: [null, "b"], body: (_: Id[], rs: (Id | null)[]) => k.call(p.named("step"), k.x(p.named("flat")), rs[1]!) },
  ])));
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ir = lowerScalar(code, info, names, [d], { data: true });
  const flat = ir.funcs.findIndex((f) => f.name === "flat");
  assert.ok(flat >= 0 && ir.funcs[flat].value);
  const m = emitWasm(ir);
  assert.match(m.wat, new RegExp(`\\(global \\$kept${flat} \\(mut `));
  assert.match(m.wat, new RegExp(`global\\.get \\$kept${flat}\\n\\s*ref\\.is_null`));
  // And it runs: 20 steps, the table made at the first.
  const ex = (await instantiate(m)) as unknown as { bench: (n: unknown) => unknown };
  assert.ok(ex.bench(toInt(ex as never, 20n)));
});
