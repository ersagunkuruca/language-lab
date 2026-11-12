// The clock on WebAssembly (I226): `now()` under WASI is the realtime
// clock's whole milliseconds since 1970, as C and Node's world give it.
// `ters wasi` of a program reading the clock stopped at "no runtime
// function wasi.now" (examples/dice, a page, did).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { NOW_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("now() on WebAssembly is the time in whole milliseconds, as on C and in ters run", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("t", k.call(NOW_OP), (t) => k.let("u", k.call(NOW_OP), (u) =>
    k.seq(k.call(S.print, k.call(SHOW_ANY, t)), k.call(S.print, k.call(SHOW_ANY, k.list(k.call(S.less, k.call(B.sub, u, t), k.lit(0)), k.call(S.equal, k.call(S.floor, t), t)))))))));
  const dir = mkdtempSync(join(tmpdir(), "clock-wasm-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const before = Date.now();
  const made = spawnSync(process.execPath, [lab, "wasi", dir, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const o = join(dir, "out.txt"), fo = openSync(o, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fo, stderr: fo, returnOnExit: true });
  assert.equal(w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), w.getImportObject() as WebAssembly.Imports)), 0);
  closeSync(fo);
  const m = /^(\d+)\n\[false, true\]\n$/.exec(readFileSync(o, "utf8"));
  assert.ok(m, readFileSync(o, "utf8"));
  const at = Number(m[1]);
  assert.ok(at >= before && at <= Date.now(), `${at} is between ${before} and now`);
});
