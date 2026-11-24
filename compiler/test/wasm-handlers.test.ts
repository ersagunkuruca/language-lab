// A program's own handlers on WebAssembly (L213c8): operations answered at
// once, their cases on the module's handler stack ($hs), the nearest
// answering, popped however the code ends. What it prints is the evaluator's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ABORT_OP, INT_OPS, LOG_OP, RANDOM_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";

test("WebAssembly answers a program's own operations by the nearest handler, its release run as it ends", async () => {
  const k = new Lang();
  const ask = k.effect("Ask", [["ask", [["by", () => k.tref("type.int")]], () => k.tref("type.int")]]);
  // Asked from a function of its own, so the handler is found as the
  // code runs, not where it's written.
  const twice = k.def("twice");
  k.define(twice, k.thunk(() => k.call(INT_OPS.add, k.call(ask.op.ask, k.int(1)), k.call(ask.op.ask, k.int(2)))));
  const answering = (n: number, body: () => Id, release?: string) => k.handle(body(),
    [{ variant: ask.op.ask, names: ["by"], body: ([by]) => k.call(INT_OPS.mul, by, k.int(n)) }], undefined, release ? () => k.call(LOG_OP, k.lit(release)) : undefined);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, answering(10, () => k.call(INT_OPS.add, k.call(twice), answering(100, () => k.call(twice), "inner closed")), "outer closed"))),
    k.call(S.print, k.call(SHOW_ANY, answering(1000, () => k.call(twice)))),
    k.call(S.print, k.call(SHOW_ANY, k.handle(answering(5, () => k.seq(k.call(twice), k.call(ABORT_OP, k.lit("gave up")), k.int(1)), "closed on abort"),
      [{ variant: ABORT_OP, names: ["why"], body: () => k.int(0) }]))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want: string[] = [];
  runMain(code, info, main, { print: (l) => want.push(l), names, world: { log: (l: string) => want.push(`log ${l}`) } as never });
  assert.deepEqual(want, ["log inner closed", "log outer closed", "330", "3000", "log closed on abort", "0"]);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const got: string[] = [];
  const st = await runWasm(l, emitWasm(l), "main", [], { print: (x: string) => got.push(x), world: { log: (x: string) => got.push(`log ${x}`) } } as never);
  assert.equal(st, 0);
  assert.deepEqual(got, want);
});

// A handler of Random whose case draws itself (pig's `recorded into`,
// C325): while its case runs its frame is busy, so the draw is the next
// handler's out, or the world's (wasm.ts `hhas`, `htake`, `hgive`).
test("WebAssembly gives a draw in a handler of Random's case to the next handler out, or to the world (C325)", async () => {
  const k = new Lang();
  const draw = () => k.call(RANDOM_OP);
  const random = (body: () => Id) => [{ variant: RANDOM_OP, names: [], body }];
  const print = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    print(k.handle(k.handle(k.call(B.add, draw(), draw()), random(() => k.call(B.mul, draw(), k.lit(0.5)))), random(() => k.lit(0.75)))),
    print(k.call(S.less, k.handle(draw(), random(() => k.call(B.mul, draw(), k.lit(0.5)))), k.lit(0.5))),
    print(k.handle(k.handle(draw(), random(() => k.call(B.add, draw(), k.lit(1)))), random(() => k.lit(0.25)))),
    print((() => {
      const inner = k.handle(k.call(B.add, draw(), draw()), random(() => k.call(B.mul, draw(), k.lit(2))));
      const middle = k.handle(inner, random(() => k.call(B.add, draw(), k.lit(10))));
      return k.handle(middle, random(() => k.lit(0.5)));
    })()),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want: string[] = [];
  runMain(code, info, main, { print: (l) => want.push(l), names });
  assert.deepEqual(want, ["0.75", "true", "1.25", "42"]);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const got: string[] = [];
  const st = await runWasm(l, emitWasm(l), "main", [], { print: (x: string) => got.push(x) } as never);
  assert.equal(st, 0);
  assert.deepEqual(got, want);
});

test("pig builds for WebAssembly (C325)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasm-handlers-"));
  const made = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "wasi", join(import.meta.dirname, "../../ters/examples/pig"), "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  assert.ok(WebAssembly.validate(readFileSync(join(dir, "p.wasm"))));
});
