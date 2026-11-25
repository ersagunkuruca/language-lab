// C327g: a record read only by its parts is its parts on WebAssembly too
// (chosen-parts.ts, as on JavaScript), a record made of array reads as
// well: strings' FFT pairs the items of two arrays in a fold, a Tuple2 a
// step, read only by its two parts. Counted by TERS_COUNT_MAKES
// (compiler/gaps/made.ts): the pairs aren't made, the run prints the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { made } from "../gaps/made.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), folder = join(import.meta.dirname, "../gaps/strings");

test("strings on WebAssembly makes no pair for a zipped fold's step, and prints the same", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasm-made-"));
  const build = (out: string, env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, out)], { encoding: "utf8", env: { ...process.env, TERS_COUNT_MAKES: "1", ...env } });
    assert.equal(r.status, 0, r.stderr);
    return join(dir, out);
  };
  const run = (wasm: string, out: string) => { const fd = openSync(join(dir, out), "w"); try { return made(wasm, ["1"], dir, fd); } finally { closeSync(fd); } };
  const off = run(build("off.wasm", { NO_CHOSEN_PARTS: "1" }), "off.txt"), on = run(build("on.wasm", {}), "on.txt");
  assert.equal(readFileSync(join(dir, "on.txt"), "utf8"), readFileSync(join(dir, "off.txt"), "utf8"));
  assert.ok(readFileSync(join(dir, "on.txt"), "utf8").length > 0);
  assert.equal(on.code, 0);
  assert.equal(off.code, 0);
  const pairs = (r: typeof on) => r.places.filter(([n]) => /^make Tuple2 in difference at Float64\.fold\.zipped/.test(n)).reduce((n, [, c]) => n + c, 0);
  assert.ok(pairs(off) > 0, "without chosen-parts the pairs are made");
  assert.equal(pairs(on), 0, "the pairs read by their parts aren't made");
  assert.ok(on.total < off.total * 0.8, `${on.total} structs, ${off.total} before`);
});
