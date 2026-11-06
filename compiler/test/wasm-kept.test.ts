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
import { CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";

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

// A list read by position, chosen as an array (C30): the table is made
// once, not at every read (a 1024-item table read 200,000 times took 6.7 s
// in WebAssembly and 6.5 s in C, then 22 and 16 ms).
function tableProgram() {
  const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  const xs = k.def("table");
  k.define(xs, k.call(L("map"), k.call(S.range, k.lit(16)), k.fn(["i"], (i) => k.call(B.mul, i, k.lit(3)))));
  const total = k.def("total");
  k.define(total, k.fn(["n"], (n) => k.fold(k.call(INT_OPS.range, n), [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["i", "rest"], results: [null, "sum"], body: ([i], [, s]) => k.call(B.add, s!, k.call(L("item at"), k.x(xs), k.call(INT_OPS.bitAnd, k.call(INT_OPS.mul, i, k.int(7)), k.int(15)), k.lit(-1))) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(total, k.int(100))))));
  const code = base(k.code), names = baseNames(k.names);
  const c = withLibraryRepresentations(code, infer(code, names, undefined, checkOptions), names, main, [xs, total, main]);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  const info = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const ir = lowerScalar(c.code, info, c.names, [total], { data: true });
  assert.deepEqual([...ir.refused.values()], []);
  return { ir, table: ir.funcs.findIndex((f) => f.name === "table"), total: ir.funcs.findIndex((f) => f.def === total) };
}
// 0, 7, 14, 5, … (i·7 mod 16) for i below 100, each times 3.
const WANT = Array.from({ length: 100 }, (_, i) => ((i * 7) & 15) * 3).reduce((a, b) => a + b, 0);

test("a list read by position, stored as an array, is kept too (C30)", async () => {
  const { ir, table, total } = tableProgram();
  assert.ok(table >= 0 && ir.funcs[table].value);
  const m = emitWasm(ir);
  assert.match(m.wat, new RegExp(`\\(global \\$kept${table} \\(mut `));
  const ex = (await instantiate(m)) as unknown as Record<string, (n: unknown) => unknown>;
  const got = ex[ir.funcs[total].name](toInt(ex as never, 100n));
  assert.equal(Number(Array.isArray(got) ? got[0] : got), WANT);
});
