// A stop in compiled code knows where it is (C143): the core IR's
// JavaScript throws Stopped, and WebAssembly's host its Abort, with the
// node the stop was lowered from and its definition. A run of main says
// the definition after the reason, in JavaScript, C and WASI (C143b); C's
// test harness gets the reason alone. Here an overflow used by show.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { lowerScalar } from "../src/scalar.ts";
import { loadCoreJs, lowerCore, Stopped } from "../src/core-js.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { emitC } from "../src/c.ts";
import { runCoreFn } from "../src/core-rt.ts";
import { build, compile, skip } from "./c-harness.ts";

function program() {
  const k = new Lang();
  const big = k.def("grow"), main = k.def("main");
  let shown = "";
  k.define(big, k.fn(["x"], (x) => (shown = k.call(S.show, k.call(B.mul, k.call(B.mul, x, k.lit(1e300)), k.lit(1e300))))));
  k.define(main, k.fn([], () => k.call(S.print, k.call(big, k.lit(1e10)))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  return { code, names, info, big, main, shown };
}

test("a stop says the node and definition it came from, on the core IR's JavaScript and WebAssembly (C143)", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const core = lowerCore(p.code, p.info, p.names, [p.big]);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === p.big && !g.inner)];
  assert.equal(f(1e-300), "1e+300");
  assert.throws(() => f(1e10), (e: unknown) => e instanceof Stopped && e.message === "the answer is too big for a Float64 (overflow)" && e.def === p.big && e.node === p.shown && e.defName === "grow");
  const said: string[] = [];
  assert.equal(runCoreFn(() => f(1e10), { args: false, result: "other" }, [], { print: (s: string) => said.push(s) } as never), 1);
  assert.deepEqual(said, ["the answer is too big for a Float64 (overflow) (in grow)"]);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.big], { data: true });
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (x: number) => unknown>;
  const name = lowered.funcs.find((g) => g.def === p.big)!.name;
  assert.throws(() => w[name](1e10), (e: unknown) => (e as Error & { reason: string }).reason === "the answer is too big for a Float64 (overflow)" && (e as { def?: string }).def === p.big && (e as { node?: string }).node === p.shown);
});

test("C says the reason of a stop with a site as before (C143)", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.big], { data: true });
  const at = lowered.funcs.findIndex((g) => g.def === p.big);
  assert.deepEqual(build(lowered)([[at, [1e10]]])[0].value, { aborted: "the answer is too big for a Float64 (overflow)" });
});

test("C's main says the reason and the definition (C143b)", { skip }, () => {
  const p = program();
  const exe = compile(emitC(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { main: p.main }).c);
  assert.throws(() => execFileSync(exe, { stdio: "pipe" }), (e: { status: number; stderr: Buffer }) => e.status === 1 && e.stderr.toString() === "the answer is too big for a Float64 (overflow) (in grow)\n");
});

test("WASI's main says the reason and the definition (C143b)", async () => {
  const p = program();
  const m = emitWasm(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { wasi: true });
  const io = mkdtempSync(join(tmpdir(), "stop-sites-"));
  const [stdout, stderr] = [openSync(join(io, "out"), "w"), openSync(join(io, "err"), "w")];
  const wasi = new WASI({ version: "preview1", args: ["main"], stdout, stderr, returnOnExit: true });
  const got = wasi.start(await WebAssembly.instantiate(await WebAssembly.compile(m.bytes), wasi.getImportObject() as WebAssembly.Imports));
  [stdout, stderr].forEach((fd) => closeSync(fd));
  assert.deepEqual([got, readFileSync(join(io, "err"), "utf8")], [1, "the answer is too big for a Float64 (overflow) (in grow)\n"]);
});
