// ters wasi: a program as a WASI command (WebAssembly with GC), lowered as
// ters native lowers it, so it prints what ters run prints. Run here by
// Node's WASI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const examples = join(import.meta.dirname, "../../ters/examples");

async function wasi(file: string, args: string[], dir: string): Promise<[string, number]> {
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const w = new WASI({ version: "preview1", args: ["p", ...args], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  const code = w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(file)), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  return [readFileSync(of, "utf8"), code];
}

test("ters wasi builds examples that print what ters run prints: a value main, own handlers, files, sin and the rest (one memory, C193)", async () => {
  for (const [ex, args, files] of [["lockstep", [], {}], ["queens", [], {}], ["wc", ["a.txt"], { "a.txt": "one two\nthree\n" }], ["algebra", [], {}], ["impact", [], {}]] as [string, string[], Record<string, string>][]) {
    const dir = mkdtempSync(join(tmpdir(), "lab-wasi-"));
    for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
    const made = spawnSync(process.execPath, [lab, "wasi", join(examples, ex), "-o", join(dir, "p.wasm")], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const want = spawnSync(process.execPath, [lab, "run", join(examples, ex), ...args], { cwd: dir, encoding: "utf8" });
    assert.notEqual(want.stdout, "", ex);
    assert.deepEqual(await wasi(join(dir, "p.wasm"), args, dir), [want.stdout, want.status], ex);
  }
});

// C207k: collatz's loop computes on Ints alone, so on WebAssembly it runs
// on i64s (a copy `steps to one counted`), and a round whose value goes
// past an i64 starts again as written; it prints what ters run prints.
test("ters wasi runs collatz's loop on i64s, printing what ters run prints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-wasi-")), args = ["3000", "100"];
  const made = spawnSync(process.execPath, [lab, "wasi", join(examples, "collatz"), "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const want = spawnSync(process.execPath, [lab, "run", join(examples, "collatz"), ...args], { encoding: "utf8" });
  assert.deepEqual(await wasi(join(dir, "p.wasm"), args, dir), [want.stdout, want.status]);
});

// C211b: divisors' counted loop steps its counts as i64s on WebAssembly,
// as on C (C207e), and prints what ters run prints.
test("ters wasi counts divisors with i64s, printing what ters run prints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-wasi-")), args = ["1000", "100"];
  const made = spawnSync(process.execPath, [lab, "wasi", join(examples, "divisors"), "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const want = spawnSync(process.execPath, [lab, "run", join(examples, "divisors"), ...args], { encoding: "utf8" });
  assert.deepEqual(await wasi(join(dir, "p.wasm"), args, dir), [want.stdout, want.status]);
});

// C211d: queens-count's fold reads its array at a counted position, an
// i64, with array.get's .i64 body, not boxed and taken back.
test("ters wasi counts the queens with array reads at i64s, printing what ters run prints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-wasi-")), args = ["6"];
  const made = spawnSync(process.execPath, [lab, "wasi", join(examples, "queens-count"), "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const want = spawnSync(process.execPath, [lab, "run", join(examples, "queens-count"), ...args], { encoding: "utf8" });
  assert.deepEqual(await wasi(join(dir, "p.wasm"), args, dir), [want.stdout, want.status]);
});

// C211: a table of Int keys lists its entries by a radix sort on
// WebAssembly (64 or more keys, all i31s); swarm's `keys of` each tick.
test("ters wasi lists swarm's motes in order, printing what ters run prints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-wasi-")), args = ["60", "30"];
  const made = spawnSync(process.execPath, [lab, "wasi", join(examples, "swarm"), "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const want = spawnSync(process.execPath, [lab, "run", join(examples, "swarm"), ...args], { encoding: "utf8" });
  assert.deepEqual(await wasi(join(dir, "p.wasm"), args, dir), [want.stdout, want.status]);
});
