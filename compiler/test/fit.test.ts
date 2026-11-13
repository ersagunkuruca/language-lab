// fit (compiler/gaps/fit), GAPS.md round 15's program: damped
// Gauss-Newton over models chosen at run time by name, each asked for
// its gradient (I247). The evaluator, the core IR's module and the
// hand-written ideal must print the same and exit the same way, and so
// must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, measurements, ways } from "../gaps/fit.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>) => {
  const want = w.ideal(args, files);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const sample = readFileSync(join(folder, "data.txt"), "utf8");

test("fit: the sample, every model fitted and the best named", () => {
  const r = all(["d.txt"], { "d.txt": sample });
  assert.equal(r.code, 0);
  assert.equal(r.out[0], "20 points");
  assert.match(r.out[2], /^exp \(a·e\^\(b·x\)\): a = 2\.47\d+, b = 0\.40\d+, /);
  assert.equal(r.out.at(-1), "best: exp");
});

test("fit: a power of a negative x has no fit, and what goes wrong", () => {
  const r = all(["d"], { d: "-1 2\n1 3\n2 5\n3 7\n" });
  assert.equal(r.out[3], "power: no fit");
  assert.deepEqual(all([], {}), { out: [], err: ["usage: fit data.txt"], code: 2 });
  assert.deepEqual(all(["nope"], {}), { out: [], err: ["fit: no such file or folder: nope"], code: 1 });
  const err = (text: string) => all(["d"], { d: text }).err;
  assert.deepEqual(err("1 2\n2 3\n"), ["fit: the data has 2 points: a fit needs at least 3"]);
  assert.deepEqual(err("1 2\n2 x\n"), ["fit: line 2: x isn't a number"]);
  assert.deepEqual(err("# h\n1 2 3\n"), ["fit: line 2: expected x and y"]);
});

test("fit: 500 made-up measurements, from the core IR and the ideal", () => {
  const files = { d: measurements(500) };
  assert.deepEqual(w.core(["d"], files), w.ideal(["d"], files));
});

// The program as `ters wasi` and `ters native` build it: no node table,
// the gradients carried (I247).
test("fit through ters wasi and ters native prints what ters run prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "fit-"));
  writeFileSync(join(dir, "d.txt"), sample);
  const want = spawnSync(process.execPath, [lab, "run", folder, join(dir, "d.txt")], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "d.txt"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), [join(dir, "d.txt")], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
