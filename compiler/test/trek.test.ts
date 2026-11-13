// trek (compiler/gaps/trek), GAPS.md round 16's program: a hiking track
// analyzer whose numbers carry units. The evaluator, the core IR's module
// and the hand-written ideal must print the same and exit the same way,
// and so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, track, ways } from "../gaps/trek.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>) => {
  const want = w.ideal(args, files);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const sample = readFileSync(join(folder, "track.txt"), "utf8");

test("trek: the sample, summed up kilometre by kilometre", () => {
  const r = all(["t.txt"], { "t.txt": sample });
  assert.equal(r.code, 0);
  assert.equal(r.out[0], "400 fixes, 399 legs");
  assert.equal(r.out[1], "distance 4.5 km");
  assert.match(r.out[8], /^biggest climb: legs 0 to \d+, \d+ m up over \d+ m$/);
  assert.equal(r.out.filter((l) => l.startsWith("km ")).length, 5);
});

test("trek: what goes wrong", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: trek track.txt"], code: 2 });
  assert.deepEqual(all(["nope"], {}), { out: [], err: ["trek: no such file or folder: nope"], code: 1 });
  const err = (text: string) => all(["t"], { t: text }).err;
  assert.deepEqual(err("0 46.5 7.9 1500\n"), ["trek: the track has 1 fixes: it needs at least 2"]);
  assert.deepEqual(err("0 46.5 7.9 1500\n10 46.5 x 1501\n"), ["trek: line 2: x isn't a number"]);
  assert.deepEqual(err("# h\n0 46.5 7.9\n"), ["trek: line 2: expected seconds, latitude, longitude and height"]);
  assert.deepEqual(err("10 46.5 7.9 1500\n0 46.5 7.9 1501\n"), ["trek: the fixes aren't in time order"]);
});

test("trek: 4000 made-up fixes, from the core IR and the ideal", () => {
  const files = { t: track(4000) };
  assert.deepEqual(w.core(["t"], files), w.ideal(["t"], files));
});

// The program as `ters wasi` and `ters native` build it: no node table,
// the gradients carried (I247).
test("trek through ters wasi and ters native prints what ters run prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "trek-"));
  writeFileSync(join(dir, "t.txt"), sample);
  const want = spawnSync(process.execPath, [lab, "run", folder, join(dir, "t.txt")], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "t.txt"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), [join(dir, "t.txt")], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
