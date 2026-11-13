// L253: an environment variable on WebAssembly, as the evaluator answers
// it (ters/test/environment.test.ts): through the host's world, and as a
// WASI command, from the environment the host gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { ENV_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, runMain } from "../src/wasm.ts";

const k = new Lang();
const main = k.def("main");
const shown = (name: string) => k.call(S.print, k.call(SHOW_ANY, k.call(ENV_OP, k.lit(name))));
k.define(main, k.thunk(() => k.seq(shown("TERS_L253"), shown("TERS_L25"), shown("TERS_L253_UNSET"))));
const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
const lowered = () => lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: false, cells: true, closureArgs: true });

test("environment variable on WebAssembly: the host's world answers", async () => {
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowered(), out: string[] = [];
  const world = { environmentVariable: (n: string) => (n === "TERS_L253" ? "yes" : null) } as never;
  await runMain(l, emitWasm(l), "main", [], { print: (s) => out.push(s), world });
  assert.deepEqual(out, ['some("yes")', "none", "none"]);
});

test("environment variable in a WASI command: the value after name=, or none", async () => {
  const l = lowered(), m = emitWasm(l, { wasi: true, main });
  const dir = mkdtempSync(join(tmpdir(), "env-wasi-")), of = join(dir, "out.txt"), fd = openSync(of, "w");
  // TERS_L25 is a prefix of a variable that is set, but isn't set itself.
  const w = new WASI({ version: "preview1", args: ["p"], env: { OTHER: "x", TERS_L253: "a=b c", TERS_L2530: "no" }, preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  const status = w.start(new WebAssembly.Instance(await WebAssembly.compile(m.bytes), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.deepEqual([readFileSync(of, "utf8"), status], ['some("a=b c")\nnone\nnone\n', 0]);
});
