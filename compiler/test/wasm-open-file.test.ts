// `with open file` on WebAssembly (L213c9, c-open-file.test.ts for C): the
// file kept open while the body runs, its lines and bytes the host's
// (wasm.ts worldOf, `kept…`), closed once however the body ends. Each run
// in a folder of its own, the evaluator's and WebAssembly's compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { ABORT_OP, ADD_BYTES_OP, NEXT_BYTES_OP, NEXT_LINE_OP, S, SHOW_ANY, WRITE_LINE_OP } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// main printing what `body` gives, run by the evaluator and by WebAssembly
// on a file `name` that starts as `start`: what each printed, its status,
// and the file each left.
async function both(name: string, start: string | Uint8Array, body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("with open file"), k.lit(name), k.thunk(() => body(k)))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const m = emitWasm(l);
  const ev = mkdtempSync(join(tmpdir(), "open-file-")), wd = mkdtempSync(join(tmpdir(), "open-file-wasm-"));
  writeFileSync(join(ev, name), start);
  writeFileSync(join(wd, name), start);
  const want: string[] = [], got: string[] = [], cwd = process.cwd();
  let st: number;
  try {
    process.chdir(ev);
    try { runMain(code, info, main, { print: (x) => want.push(x), names, world: { ...nodeWorld(), log: () => {} } }); } catch (e) { want.push(`aborted ${(e as Error).message}`); }
    process.chdir(wd);
    st = await runWasm(l, m, "main", [], { print: (x: string) => got.push(x), world: { ...nodeWorld(), log: () => {}, error: (x: string) => got.push(`aborted ${x}`) } } as never);
  } finally { process.chdir(cwd); }
  return { want, got, st, evFile: readFileSync(join(ev, name)), wasmFile: readFileSync(join(wd, name)) };
}

test("WebAssembly keeps a file open with open file: lines from its start, lines added at its end, as the evaluator does", async () => {
  const r = await both("notes.txt", "first\r\nsecond\nthird", (k) => k.listOf(
    k.call(NEXT_LINE_OP), k.call(NEXT_LINE_OP),
    k.seq(k.call(WRITE_LINE_OP, k.lit("added")), k.call(NEXT_LINE_OP)), k.call(NEXT_LINE_OP), k.call(NEXT_LINE_OP)));
  assert.deepEqual(r.want, ['[some("first"), some("second"), some("thirdadded"), none, none]']);
  assert.equal(r.st, 0);
  assert.deepEqual(r.got, r.want);
  assert.equal(r.wasmFile.toString(), r.evFile.toString());
});

test("an Abort inside the body still closes the file on WebAssembly, after its lines are written", async () => {
  const r = await both("log.txt", "", (k) => k.seq(k.call(WRITE_LINE_OP, k.lit("started")), k.call(ABORT_OP, k.lit("gave up")), k.int(1)));
  assert.notEqual(r.st, 0);
  assert.match(r.got.join("\n"), /gave up/);
  assert.equal(r.wasmFile.toString(), "started\n");
  assert.equal(r.wasmFile.toString(), r.evFile.toString());
});

test("WebAssembly reads and adds bytes with open file, as the evaluator does", async () => {
  const r = await both("f", Uint8Array.from([...Buffer.from("head\n"), 0xff, 0x00, 0x80]), (k) => k.listOf(
    k.call(SHOW_ANY, k.call(NEXT_LINE_OP)),
    k.call(SHOW_ANY, k.call(lib("byte items"), k.call(NEXT_BYTES_OP, k.int(2)))),
    k.seq(k.call(ADD_BYTES_OP, k.call(lib("bytes of"), k.list(k.int(7), k.int(255)))), k.call(SHOW_ANY, k.call(lib("byte items"), k.call(NEXT_BYTES_OP, k.int(10)))))));
  assert.deepEqual(r.want, ['["some(\\"head\\")", "[255, 0]", "[128, 7, 255]"]']);
  assert.equal(r.st, 0);
  assert.deepEqual(r.got, r.want);
  assert.deepEqual([...r.wasmFile], [...r.evFile]);
});
