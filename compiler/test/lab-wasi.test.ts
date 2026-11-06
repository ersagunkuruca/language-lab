// lab wasi: a program as a WASI command (WebAssembly with GC), lowered as
// lab native lowers it, so it prints what lab run prints. Run here by
// Node's WASI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";

const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
const examples = join(import.meta.dirname, "../../ters/examples");

async function wasi(file: string, args: string[], dir: string): Promise<[string, number]> {
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const w = new WASI({ version: "preview1", args: ["p", ...args], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  const code = w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(file)), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  return [readFileSync(of, "utf8"), code];
}

test("lab wasi builds examples that print what lab run prints: a value main, own handlers, files, sin and the rest (one memory, C193)", async () => {
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
