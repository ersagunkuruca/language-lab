// A file handed to the person and one they choose (L271a) in C, a WASI
// command and WebAssembly in a JavaScript host, as the evaluator does it
// on the command line (world.ts): `offer
// file` writes the file in the folder the program runs in, under its name
// alone, and `ask for file` aborts, with no one there to choose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { ABORT_OP, IO, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";
import { wasiImports } from "../src/wasi-imports.ts";
import { compile, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(IO.offerFile, k.lit("../elsewhere/take.bin"), k.call(lib("bytes of"), k.list(k.int(1), k.int(2), k.int(255)))),
    k.call(S.print, k.handle(k.call(SHOW_ANY, k.call(IO.askForFile, k.lit(""))), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
    k.call(S.print, k.handle(k.seq(k.call(IO.offerFile, k.lit("/"), k.call(lib("bytes of"), k.list(k.int(7)))), k.lit("offered")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
    k.int(0))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

test("offer file and ask for file in C are the evaluator's on the command line (L271c)", { skip }, () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main: p.main }).c);
  const dir = mkdtempSync(join(tmpdir(), "offer-c-")), here = mkdtempSync(join(tmpdir(), "offer-ev-"));
  const r = spawnSync(exe, [], { cwd: dir });
  const printed: string[] = [], was = process.cwd();
  process.chdir(here);
  try { runMain(p.code, p.info, p.main, { print: (x) => printed.push(x), names: p.names, world: nodeWorld() }); } finally { process.chdir(was); }
  assert.match(printed[0], /no one to choose a file/);
  assert.deepEqual(r.stdout.toString().split("\n").slice(0, 2), printed);
  for (const d of [dir, here]) {
    assert.deepEqual([...readFileSync(join(d, "take.bin"))], [1, 2, 255]);
    assert.equal(existsSync(join(d, "file")), true);
  }
});

test("offer file and ask for file in a WASI command are the evaluator's on the command line (L271c)", () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const m = emitWasm(l, { wasi: true, main: p.main });
  const dir = mkdtempSync(join(tmpdir(), "offer-wasi-")), out = join(mkdtempSync(join(tmpdir(), "offer-out-")), "out.txt");
  const fd = openSync(out, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  w.start(new WebAssembly.Instance(new WebAssembly.Module(m.bytes), wasiImports(w)));
  closeSync(fd);
  assert.deepEqual(readFileSync(out, "utf8").split("\n").slice(0, 2), ["there's no one to choose a file on the command line: read one with read bytes", "offered"]);
  assert.deepEqual([...readFileSync(join(dir, "take.bin"))], [1, 2, 255]);
  assert.equal(existsSync(join(dir, "file")), true);
});

test("offer file and ask for file in WebAssembly with a JavaScript host ask the host's world (L271c)", async () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const f = l.funcs.find((g) => g.def === p.main && !g.inner)!;
  const dir = mkdtempSync(join(tmpdir(), "offer-js-")), was = process.cwd(), got: string[] = [];
  try { process.chdir(dir); await runWasm(l, emitWasm(l), f.name, [], { print: (x) => got.push(x), world: nodeWorld() }); } finally { process.chdir(was); }
  assert.deepEqual(got.slice(0, 2), ["there's no one to choose a file on the command line: read one with read bytes", "offered"]);
  assert.deepEqual([...readFileSync(join(dir, "take.bin"))], [1, 2, 255]);
  assert.equal(existsSync(join(dir, "file")), true);
});
