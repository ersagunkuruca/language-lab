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

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), gaps = join(import.meta.dirname, "../gaps"), folder = join(gaps, "strings");

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

// A deep loop's frames (deep-loops.ts) taken by `$up` wait on a spare
// list for `$down`'s next call (frame-spares.ts): pack's tree update at
// makes a frame a level only as deep as the deepest walk, not each walk.
test("pack on WebAssembly makes a deep loop's frames only as deep as it goes", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasm-spares-"));
  const build = (out: string, env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [lab, "wasi", join(gaps, "pack"), "-o", join(dir, out)], { encoding: "utf8", env: { ...process.env, TERS_COUNT_MAKES: "1", ...env } });
    assert.equal(r.status, 0, r.stderr);
    return join(dir, out);
  };
  const run = (wasm: string, out: string) => { const fd = openSync(join(dir, out), "w"); try { return made(wasm, ["400"], dir, fd); } finally { closeSync(fd); } };
  const off = run(build("off.wasm", { NO_FRAME_SPARES: "1" }), "off.txt"), on = run(build("on.wasm", {}), "on.txt");
  assert.equal(readFileSync(join(dir, "on.txt"), "utf8"), readFileSync(join(dir, "off.txt"), "utf8"));
  assert.equal(on.code, 0);
  const frames = (r: typeof on) => r.places.filter(([n]) => /^new tree update at.*frames\.\d+/.test(n)).reduce((n, [, c]) => n + c, 0);
  assert.ok(frames(off) > 1000, `${frames(off)} frames made without the spare lists`);
  assert.ok(frames(on) < 100, `${frames(on)} frames made`);
  assert.ok(on.places.some(([n]) => /\(fresh frame\)$/.test(n)), "the fresh frames are counted");
});

// A case with no fields (pack's Order.0 and Order.2, an empty list) is one
// struct in a global: the run makes none of them, and prints the same.
test("pack on WebAssembly makes a field-less case once, not per use", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasm-nil-"));
  const build = (out: string, env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [lab, "wasi", join(gaps, "pack"), "-o", join(dir, out)], { encoding: "utf8", env: { ...process.env, TERS_COUNT_MAKES: "1", ...env } });
    assert.equal(r.status, 0, r.stderr);
    return join(dir, out);
  };
  const run = (wasm: string, out: string) => { const fd = openSync(join(dir, out), "w"); try { return made(wasm, ["400"], dir, fd); } finally { closeSync(fd); } };
  const off = run(build("off.wasm", { NO_NIL_GLOBALS: "1" }), "off.txt"), on = run(build("on.wasm", {}), "on.txt");
  assert.equal(readFileSync(join(dir, "on.txt"), "utf8"), readFileSync(join(dir, "off.txt"), "utf8"));
  assert.ok(readFileSync(join(dir, "on.txt"), "utf8").length > 0);
  assert.equal(on.code, 0);
  const orders = (r: typeof on) => r.places.filter(([n]) => /^new Order\.[02] /.test(n)).reduce((n, [, c]) => n + c, 0);
  assert.ok(orders(off) > 0, "without the globals the field-less orders are made");
  assert.equal(orders(on), 0);
  assert.ok(on.total < off.total * 0.8, `${on.total} structs, ${off.total} before`);
});
