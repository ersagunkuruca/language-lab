// One holder decided per value (holders.ts, C327f). `bump` replaces in an
// array only it holds, and `fill` pushes onto one; `nudge` replaces in `b`,
// which main prints again after. Arrays of Float64 have two holders here,
// so one-holder.ts, deciding by type, writes none of them in place; per
// value, bump's replaces and fill's pushes are written in place, and
// nudge's stay versions, so `b` prints as it was made. On JavaScript and
// on WebAssembly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { call } from "../../ters/mcp/server.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("a replace or push on an array nobody else holds is in place, per value", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "holders-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "fill", kind: "function", params: ["a", "x", "n"] });
  ask("replace", { at: "fill", find: "□", text: "if x < n then fill(push(a, x), x + 1.0, n) else a" });
  ask("define", { name: "bump", kind: "function", params: ["a", "i"] });
  ask("replace", { at: "bump", find: "□", text: "if i < array length(a) then bump(replace in array(a, i, first(item at(a, i), else 0.0) + 1.0), i + 1) else a" });
  ask("define", { name: "nudge", kind: "function", params: ["a", "i"] });
  ask("replace", { at: "nudge", find: "□", text: "if i < array length(a) then nudge(replace in array(a, i, first(item at(a, i), else 0.0) + 10.0), i + 1) else a" });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: "main", find: "□", text: "b = fill(empty array(), 0.0, 3.0); □" });
  ask("replace", { at: "main", find: "□", text: "print(show(items of array(bump(fill(empty array(), 0.0, 4.0), 0)))); print(show(items of array(nudge(b, 0)))); print(show(items of array(b)))" });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(ev.stdout, "[1, 2, 3, 4]\n[10, 11, 12]\n[0, 1, 2]\n");
  const out = join(mkdtempSync(join(tmpdir(), "holders-js-")), "p.mjs");
  const env = { ...process.env, TERS_NO_KEPT_OUTPUT: "1" };
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  const js = readFileSync(out, "utf8");
  assert.equal([...js.matchAll(/R2\.rt\("array\.replaceOwned\./g)].length, 1, "bump's replace, not nudge's");
  assert.equal([...js.matchAll(/R2\.rt\("array\.replaceAt\./g)].length, 1, "nudge's replace");
  assert.ok(js.includes('R2.rt("array.pushOwned.'), "fill's push");
  // And on WebAssembly, its replaces in place counted as the arrays they
  // make: nudge's three alone.
  const wasm = join(mkdtempSync(join(tmpdir(), "holders-wasm-")), "p.wasm");
  const wmade = spawnSync(process.execPath, [lab, "wasi", dir, "-o", wasm], { encoding: "utf8", env: { ...env, TERS_COUNT_VIEWS: "array\\.replace" } });
  assert.equal(wmade.status, 0, wmade.stderr);
  const io = mkdtempSync(join(tmpdir(), "holders-io-")), out2 = openSync(join(io, "out"), "w");
  const wasi = new WASI({ version: "preview1", args: ["p"], stdout: out2, returnOnExit: true });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasm)), wasiImports(wasi));
  wasi.start(inst);
  closeSync(out2);
  assert.equal(readFileSync(join(io, "out"), "utf8"), ev.stdout);
  assert.equal(new DataView((inst.exports.memory as WebAssembly.Memory).buffer).getBigInt64(120, true), 3n);
});

// A function giving back what it was given (or a part of it) lends it to
// its answer: the caller still holds it, now shared with the answer, so a
// replace after reads as a version (part 4c). `kept` is `b` itself.
test("what a call lends its answer is shared with it after the call", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "holders-lend-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "fill", kind: "function", params: ["a", "x", "n"] });
  ask("replace", { at: "fill", find: "□", text: "if x < n then fill(push(a, x), x + 1.0, n) else a" });
  ask("define", { name: "bump", kind: "function", params: ["a", "i"] });
  ask("replace", { at: "bump", find: "□", text: "if i < array length(a) then bump(replace in array(a, i, first(item at(a, i), else 0.0) + 1.0), i + 1) else a" });
  ask("define", { name: "kept", kind: "function", params: ["a"] });
  ask("replace", { at: "kept", find: "□", text: "a" });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: "main", find: "□", text: "b = fill(empty array(), 0.0, 3.0); □" });
  ask("replace", { at: "main", find: "□", text: "c = kept(b); □" });
  ask("replace", { at: "main", find: "□", text: "print(show(items of array(bump(b, 0)))); print(show(items of array(c)))" });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(ev.stdout, "[1, 2, 3]\n[0, 1, 2]\n");
  const env = { ...process.env, TERS_NO_KEPT_OUTPUT: "1" };
  const out = join(mkdtempSync(join(tmpdir(), "holders-lend-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.stdout, ev.stdout);
  const wasm = join(mkdtempSync(join(tmpdir(), "holders-lend-wasm-")), "p.wasm");
  const wmade = spawnSync(process.execPath, [lab, "wasi", dir, "-o", wasm], { encoding: "utf8", env });
  assert.equal(wmade.status, 0, wmade.stderr);
  const io = mkdtempSync(join(tmpdir(), "holders-lend-io-")), out2 = openSync(join(io, "out"), "w");
  const wasi = new WASI({ version: "preview1", args: ["p"], stdout: out2, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasm)), wasiImports(wasi)));
  closeSync(out2);
  assert.equal(readFileSync(join(io, "out"), "utf8"), ev.stdout);
});
