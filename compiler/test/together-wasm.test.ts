// A together whose actions only compute, on WebAssembly (I225): with no
// fibers there (C187) nor threads, each action runs in place, in order,
// as `ters run` runs them. area's eight bands printed nothing: `ters wasi`
// stopped at "no runtime function fbranches:all".

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ABORT_OP, INT_OPS, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

// What ters run prints and says, then the same from ters wasi under Node's WASI.
async function onWasm(program: string): Promise<{ want: [string, string, number]; got: [string, string, number] }> {
  const dir = mkdtempSync(join(tmpdir(), "together-wasm-"));
  const r = spawnSync(process.execPath, [lab, "run", program], { encoding: "utf8" });
  const made = spawnSync(process.execPath, [lab, "wasi", program, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const o = join(dir, "out.txt"), e = join(dir, "err.txt"), fo = openSync(o, "w"), fe = openSync(e, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fo, stderr: fe, returnOnExit: true });
  const code = w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), w.getImportObject() as WebAssembly.Imports));
  closeSync(fo); closeSync(fe);
  return { want: [r.stdout, r.stderr, r.status ?? 1], got: [readFileSync(o, "utf8"), readFileSync(e, "utf8"), code] };
}

test("area counts its bands on WebAssembly as ters run does", async () => {
  const { want, got } = await onWasm(join(import.meta.dirname, "../../ters/examples/area"));
  assert.equal(want[2], 0, want[1]);
  assert.deepEqual(got, want);
});

test("a together's actions run in order on WebAssembly: its answers, and the first abort in order", async () => {
  const k = new Lang(LIBRARY.code);
  const sum = (n: number) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(n)), k.fn(["i"], (i) => k.call(B.mul, k.call(INT_OPS.toNumber, i), k.lit(2)))));
  const aborts = (why: string) => k.thunk(() => k.if(k.call(S.less, sum(10), k.lit(0)), k.lit(0), k.call(ABORT_OP, k.lit(why))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(k.thunk(() => sum(4)), k.thunk(() => k.lit(1.5)), k.thunk(() => sum(3)))))),
    k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(k.thunk(() => sum(2)), aborts("first"), aborts("second"))))),
  )));
  const dir = mkdtempSync(join(tmpdir(), "together-wasm-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const { want, got } = await onWasm(dir);
  assert.deepEqual(want, ["[12, 1.5, 6]\n", "first\n", 1]);
  assert.deepEqual(got, want);
});
