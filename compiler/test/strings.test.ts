// strings (compiler/gaps/strings), GAPS.md round 20's program: six
// Karplus-Strong strings heard by YIN, by the McLeod pitch method and by
// the loudest partial, then overdubbed onto a loop. The evaluator, the
// core IR's module and the hand-written ideal must print the same and exit
// the same way, and so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, ways } from "../gaps/strings.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const ideal = (k: number) => w.ideal([String(k)], {});

test("strings: no blocks, by the evaluator, the core IR and the ideal", () => {
  const want = ideal(0);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](["0"], {}), want, way);
  assert.equal(want.out[0], "E2: sounds 82.4 Hz, yin 0, mcleod 0, loudest partial 0; reads C4 +0 cents");
  assert.equal(want.out[6], "loop: 6 layers of 0 samples, loudest 0, power 0");
});

test("strings: two blocks from the core IR and the ideal, each string heard at its pitch", () => {
  const r = w.core(["2"], {});
  assert.deepEqual(r, ideal(2));
  // YIN and McLeod's method hear the pitch the string sounds, and the tuner
  // reads the string's own note.
  for (const [line, note] of r.out.slice(0, 6).map((l, i) => [l, ["E2", "A2", "D3", "G3", "B3", "E4"][i]] as const)) {
    const m = /^(\w+): sounds ([\d.]+) Hz, yin ([\d.]+), mcleod ([\d.]+), .*; reads (\S+) /.exec(line)!;
    assert.ok(m, line);
    assert.equal(m[5], note, line);
    assert.ok(Math.abs(Number(m[3]) - Number(m[2])) < 0.05 && Math.abs(Number(m[4]) - Number(m[2])) < 0.05, line);
  }
  assert.equal(r.out[8], "redone, apart from the first by 0 millionths of a millionth");
});

test("strings: arguments that aren't whole numbers are 8 blocks", () => {
  assert.deepEqual(w.core(["x"], {}), ideal(8));
});

// The program as `ters wasi` and `ters native` build it, at two blocks: a
// loop of 24000 samples, deeper than WebAssembly's stack before C276.
test("strings through ters wasi and ters native prints what the ideal prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "strings-"));
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "s.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["s", "2"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "s.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), ideal(2).out.join("\n") + "\n", "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "s")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "s"), ["2"], { encoding: "utf8" }).stdout, ideal(2).out.join("\n") + "\n", "ters native");
});
