// Countdown (projectional/examples/countdown), the program of GAPS.md
// round 2, written in the editor by clicks: the evaluator, the compiled code,
// WebAssembly and the hand-written ideal must find the same solutions in
// the same order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ways } from "../gaps/countdown.ts";
import { WASI } from "node:wasi";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../src/program.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm } from "../src/wasm.ts";

const w = await ways();

test("countdown: four ways agree on a small instance", () => {
  const want = w.ideal([2, 3, 5, 7, 11], 100);
  assert.equal(want.length, 30);
  assert.deepEqual(w.compiled([2, 3, 5, 7, 11], 100), want);
  assert.deepEqual(w.wasm([2, 3, 5, 7, 11], 100), want);
  assert.deepEqual(w.evaluator([2, 3, 5, 7, 11], 100), want);
});

test("countdown: Hutton's example has his 49 solutions, compiled, in WebAssembly and ideal", () => {
  // "The countdown problem" (Hutton, 2002): 49 solutions for 765 from
  // 1, 3, 7, 10, 25 and 50 once commutativity and identities are skipped.
  const want = w.ideal([1, 3, 7, 10, 25, 50], 765);
  assert.equal(want.length, 49);
  assert.equal(want[0], "(((3 − 1) + 7) × (10 + (25 + 50)))");
  assert.deepEqual(w.compiled([1, 3, 7, 10, 25, 50], 765), want);
  assert.deepEqual(w.wasm([1, 3, 7, 10, 25, 50], 765), want);
});

test("countdown: its main as a WASI command, with no JavaScript host, prints Hutton's 49 solutions", async () => {
  // mod and show are the module's own (wasm-rt.ts number.mod, number.show):
  // it imports only fd_write and proc_exit.
  const p = load("countdown");
  const m = emitWasm(lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true }), { wasi: true });
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(m.bytes)).map((x) => `${x.module}.${x.name}`), ["wasi_snapshot_preview1.fd_write", "wasi_snapshot_preview1.proc_exit"]);
  const dir = mkdtempSync(join(tmpdir(), "countdown-")), out = join(dir, "out");
  const stdout = openSync(out, "w");
  const wasi = new WASI({ version: "preview1", args: ["countdown"], stdout, returnOnExit: true });
  assert.equal(wasi.start(await WebAssembly.instantiate(m.bytes, wasi.getImportObject() as WebAssembly.Imports).then((r) => r.instance)), 0);
  closeSync(stdout);
  assert.deepEqual(readFileSync(out, "utf8").trimEnd().split("\n"), w.ideal([1, 3, 7, 10, 25, 50], 765));
  rmSync(dir, { recursive: true });
});
