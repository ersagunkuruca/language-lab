// depot (compiler/gaps/depot), GAPS.md round 17's program: a day of a
// bike-share network simulated. The evaluator, the core IR's module and
// the hand-written ideal must print the same and exit the same way, and
// so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { city, folder, program, ways } from "../gaps/depot.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>) => {
  const want = w.ideal(args, files);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const sample = readFileSync(join(folder, "city.txt"), "utf8");

test("depot: the sample town's day", () => {
  const r = all(["c.txt"], { "c.txt": sample });
  assert.equal(r.code, 0);
  assert.equal(r.out[0], "depot: 8 stations, 24 hours, seed 1");
  assert.match(r.out[1], /^rides \d+, went without \d+ \(\d+\.\d%\), walked on \d+$/);
  assert.equal(r.out.filter((l) => /^(Hilltop|Harbour) /.test(l)).length, 4);
  assert.equal(r.out.at(-1)!.length, 12 + 24);
});

// The stations are read by position (`station at`) on every event; the
// World holding them is changed with `set` on every event, which kept
// every list linked (C227, GAPS round 17 D1): 640 stations took 63 s.
test("depot: the lists are arrays, beside the map's tree", () => {
  assert.deepEqual(program().chosen, ["Map as weight-balanced tree", "List as array of List"]);
});

test("depot: other hours and seeds", () => {
  for (const args of [["c.txt", "6"], ["c.txt", "30", "7"]]) assert.equal(all(args, { "c.txt": sample }).code, 0);
});

test("depot: what goes wrong", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: depot city.txt [hours] [seed]"], code: 2 });
  assert.deepEqual(all(["nope"], {}), { out: [], err: ["depot: no such file or folder: nope"], code: 1 });
  const err = (text: string, args = ["t"]) => all(args, { t: text }).err;
  const two = "station a 4 2 0 0\nstation b 4 2 1 0\n";
  assert.deepEqual(err("station a 4 2 0 0\n"), ["depot: a city needs two stations or more"]);
  assert.deepEqual(err(two + "station c 4 x 1 0\n"), ["depot: line 3: x isn't a whole number"]);
  assert.deepEqual(err(two + "station c 4 2 1\n"), ["depot: line 3: a station is `station name docks bikes x y`, x and y in km"]);
  assert.deepEqual(err(two + "demand a z 3\n"), ["depot: no station is called z"]);
  assert.deepEqual(err(two + "demand a a 3\n"), ["depot: a demand goes nowhere, or has no riders"]);
  assert.deepEqual(err(two + "station a 4 2 2 0\n"), ["depot: two stations have one name"]);
  assert.deepEqual(err(two + "station c 4 5 2 0\n"), ["depot: a station has no docks, or more bikes than docks"]);
  assert.deepEqual(err(two + "bus a b\n"), ["depot: line 3: bus isn't station, demand or profile"]);
  assert.deepEqual(err(two + "profile 1 2\n"), ["depot: line 3: a profile is `profile` and 24 numbers, one for each hour"]);
  assert.deepEqual(err(two, ["t", "0"]), ["depot: the hours and the seed are whole numbers from 1"]);
});

test("depot: a made-up city of 40 stations, from the core IR and the ideal", () => {
  const files = { t: city(40) };
  assert.deepEqual(w.core(["t"], files), w.ideal(["t"], files));
});

// The program as `ters wasi` and `ters native` build it.
test("depot through ters wasi and ters native prints what ters run prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "depot-"));
  writeFileSync(join(dir, "c.txt"), sample);
  const want = spawnSync(process.execPath, [lab, "run", folder, join(dir, "c.txt")], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "c.txt"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), [join(dir, "c.txt")], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
