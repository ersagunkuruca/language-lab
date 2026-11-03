// `stop with(reason)` (L51c, SPEC §8.4) on the core IR's JavaScript,
// WebAssembly (a host's and WASI's) and C: the program ends with the
// program's own words, as the evaluator's run does, where a value of any
// type was wanted (a Float64, a list).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner, runProgram } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { CONS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { emitC } from "../src/c.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { build, compile, skip } from "./c-harness.ts";

// double: twice x, or a stop for a negative. tail: a list's rest, or a
// stop for the empty list. main prints, then stops.
function program() {
  const k = new Lang();
  const double = k.def("double"), rest = k.def("rest"), main = k.def("main");
  k.define(double, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), k.call(S.stop, k.call(S.concat, k.lit("negative: "), k.call(S.show, x))), k.call(B.mul, x, k.lit(2)))));
  k.define(rest, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(S.stop, k.lit("the empty list has no rest")) },
    // x compared, so it is a list of Float64s.
    { variant: CONS, names: ["x", "r"], body: ([x, r]) => k.if(k.call(S.less, x, k.lit(0)), r, r) },
  ])));
  k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(S.show, k.call(double, k.lit(3)))), k.call(S.print, k.call(S.show, k.call(double, k.lit(-2)))), k.call(S.print, k.lit("not reached")))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, double, rest, main };
}
const list = (...xs: number[]): unknown => xs.reduceRight<unknown>((acc, x) => ({ tag: CONS, fields: [x, acc] }), { tag: NIL, fields: [] });
const calls = [["double", [3]], ["double", [-2]], ["rest", [list(1, 2)]], ["rest", [list()]]] as const;
const wants = [6, { stop: "negative: -2" }, list(2), { stop: "the empty list has no rest" }];

test("stop with on the core IR's JavaScript and WebAssembly: the evaluator's words", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: string, x: unknown) => { try { for (const v of r.call(r.value(d), x as never)) return v; } catch (e) { return { stop: (e as Error).message }; } };
  const defs = { double: p.double, rest: p.rest };
  assert.deepEqual(calls.map(([d, xs]) => ev(defs[d], xs[0])), wants);
  const core = lowerCore(p.code, p.info, p.names, [p.double, p.rest]);
  assert.deepEqual([...core.refused.entries()], []);
  const fs = loadCoreJs(core);
  const at = (d: string) => fs[core.funcs.findIndex((f) => f.def === d && !f.inner)];
  const tried = (f: () => unknown) => { try { return f(); } catch (e) { return { stop: (e as Error).message }; } };
  assert.deepEqual(calls.map(([d, xs]) => tried(() => at(defs[d])(xs[0]))), wants);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.double], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (x: number) => unknown>;
  const name = lowered.funcs.find((f) => f.def === p.double)!.name;
  assert.deepEqual([tried(() => w[name](3)), tried(() => w[name](-2))], [6, wants[1]]);
});

test("stop with under WASI: what main printed, the words to standard error, exit 1", async () => {
  const p = program();
  const printed: string[] = [], errors: string[] = [];
  const exit = runProgram(p.code, p.info, p.main, [], { print: (l) => printed.push(l), names: p.names, world: { ...nodeWorld(), error: (l) => errors.push(l) } });
  assert.deepEqual([exit, printed, errors], [1, ["6"], ["negative: -2"]]);
  const m = emitWasm(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { wasi: true });
  const io = mkdtempSync(join(tmpdir(), "stop-with-"));
  const [stdout, stderr] = [openSync(join(io, "out"), "w"), openSync(join(io, "err"), "w")];
  const wasi = new WASI({ version: "preview1", args: ["main"], stdout, stderr, returnOnExit: true });
  const got = wasi.start(await WebAssembly.instantiate(await WebAssembly.compile(m.bytes), wasi.getImportObject() as WebAssembly.Imports));
  [stdout, stderr].forEach((fd) => closeSync(fd));
  assert.deepEqual([got, readFileSync(join(io, "out"), "utf8"), readFileSync(join(io, "err"), "utf8")], [1, "6\n", "negative: -2\n"]);
});

test("stop with in C: each call's answer or its words, every cell freed, and a program's exit", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.double, p.rest], { data: true });
  assert.deepEqual([...emitC(lowered).refused.entries()], []);
  const at = (d: string) => lowered.funcs.findIndex((f) => f.def === d && !f.inner);
  const defs = { double: p.double, rest: p.rest };
  const got = build(lowered)(calls.map(([d, xs]) => [at(defs[d]), [...xs] as never]));
  assert.deepEqual(got.map((g) => g.value), [6, { aborted: "negative: -2" }, list(2), { aborted: "the empty list has no rest" }]);
  assert.deepEqual(got.map((g) => g.live), [0, 0, 0, 0]);
  const exe = compile(emitC(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { main: p.main }).c);
  const r = spawnSync(exe, [], { encoding: "utf8" });
  assert.deepEqual([r.status, r.stdout, r.stderr], [1, "6\n", "negative: -2\n"]);
});
