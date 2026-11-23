// A file's bytes read and written (read bytes, write bytes) by a program
// compiled to C (C291a), to a WASI command and to WebAssembly in a
// JavaScript host (C291b): the bytes as written come back, a byte past 127
// too, and a file that isn't there aborts with the reason, as the
// evaluator does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { readLog } from "../../ters/src/lang/worldlog.ts";
import { BYTES_V, CONS, IO, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";
import { compile, skip } from "./c-harness.ts";

// The program, and what the evaluator prints and the reason it stops.
function program() {
  const k = new Lang();
  const list = (xs: number[]) => xs.reduceRight((rest, x) => k.call(CONS, k.int(x), rest), k.x(NIL));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(IO.writeBytes, k.lit("b.bin"), k.call(BYTES_V, list([0, 7, 128, 255, 10]))),
    k.call(S.print, k.call(SHOW_ANY, k.call(IO.readBytes, k.lit("b.bin")))),
    k.call(S.print, k.call(SHOW_ANY, k.call(IO.readBytes, k.lit("none.bin")))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const at = mkdtempSync(join(tmpdir(), "bytes-files-")), was = process.cwd(), want: string[] = [];
  let reason = "";
  try { process.chdir(at); runMain(code, info, main, { print: (l) => want.push(l), names, world: nodeWorld() }); } catch (e) { reason = (e as Error).message; } finally { process.chdir(was); }
  assert.equal(want.length, 1, reason);
  assert.match(reason, /none\.bin/);
  return { code, info, names, main, want };
}

test("read bytes and write bytes in C give back the bytes written, and a missing file's reason (C291a)", { skip }, () => {
  const { code, info, names, main, want } = program();
  const l = lowerScalar(code, info, names, [main], { data: true, handlers: true, threads: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main }).c);
  const c = mkdtempSync(join(tmpdir(), "bytes-files-c-")), r = spawnSync(exe, [], { cwd: c, env: { ...process.env, TERS_LOG: join(c, "log.json") } });
  assert.deepEqual(r.stdout.toString().split("\n").filter((x) => x), want);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr.toString(), /none\.bin/);
  // The run's log, as `ters run --replay` reads it: the bytes as bytes.
  const log = readLog(readFileSync(join(c, "log.json"), "utf8"));
  assert.deepEqual(log.map((e) => e.op), ["writeBytes", "readBytes", "readBytes"]);
  assert.deepEqual(log[0].args, ["b.bin", Uint8Array.from([0, 7, 128, 255, 10])]);
  assert.deepEqual(log[1].answer, Uint8Array.from([0, 7, 128, 255, 10]));
  assert.match(String(log[2].threw), /none\.bin/);
});

test("read bytes and write bytes in a WASI command give back the bytes written, and a missing file's reason (C291b)", () => {
  const { code, info, names, main, want } = program();
  const l = lowerScalar(code, info, names, [main], { data: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const m = emitWasm(l, { wasi: true, main });
  const dir = mkdtempSync(join(tmpdir(), "bytes-files-wasi-")), out = join(dir, "out.txt"), fd = openSync(out, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  const status = w.start(new WebAssembly.Instance(new WebAssembly.Module(m.bytes), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.notEqual(status, 0);
  const lines = readFileSync(out, "utf8").split("\n").filter((x) => x);
  assert.deepEqual(lines.slice(0, want.length), want);
  assert.match(lines.slice(want.length).join("\n"), /none\.bin/);
  assert.deepEqual([...readFileSync(join(dir, "b.bin"))], [0, 7, 128, 255, 10]);
});

test("read bytes and write bytes in WebAssembly with a JavaScript host give back the bytes written (C291b)", async () => {
  const { code, info, names, main, want } = program();
  const l = lowerScalar(code, info, names, [main], { data: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const f = l.funcs.find((g) => g.def === main && !g.inner)!;
  const dir = mkdtempSync(join(tmpdir(), "bytes-files-js-")), was = process.cwd(), got: string[] = [], errs: string[] = [];
  let status = 0;
  try { process.chdir(dir); status = await runWasm(l, emitWasm(l), f.name, [], { print: (x) => got.push(x), world: { ...nodeWorld(), error: (x: string) => errs.push(x) } }); } finally { process.chdir(was); }
  assert.equal(status, 1);
  assert.deepEqual(got, want);
  assert.match(errs.join("\n"), /none\.bin/);
  assert.deepEqual([...readFileSync(join(dir, "b.bin"))], [0, 7, 128, 255, 10]);
});
