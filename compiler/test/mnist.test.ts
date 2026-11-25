// mnist (compiler/gaps/mnist), GAPS.md round 22's program: a 784-32-10
// network learning digits by Adam, or by damped Newton steps whose
// Hessian-vector products come from running the backward pass on dual
// numbers, or by Adam with its gradient from `gradient` (reverse, L285
// R4) where the ideal's is hand-written, or Newton from `gradient`
// (reverse-newton, natively). The core IR's module and the hand-written ideal (whose
// Hessian times a vector is the R-operator written out) must print the
// same and exit the same way, and so must `ters native` and `ters wasi`.
// Made-up digits (mnist.ts `madeUp`), so the test needs no download.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WASI } from "node:wasi";
import { folder, madeUp, ways } from "../gaps/mnist.ts";
import { skip } from "./c-harness.ts";
import { wasiImports, wasiImportsSource } from "../src/wasi-imports.ts";

const w = await ways();
const same = (args: string[], files: Record<string, Uint8Array>) => {
  const want = w.ideal(args, files);
  assert.deepEqual(w.core(args, files), want);
  return want;
};

test("mnist: Adam over made-up digits, from the core IR and the ideal", () => {
  const r = same(["d", "adam", "200", "2"], madeUp(200, 100));
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(0, 2), ["mnist: 200 training digits, 100 test digits, 784-32-10 tanh, adam", "epoch 1: loss 2.2601"]);
  assert.match(r.out[3], /^test: \d+ of 100 right/);
});

test("mnist: Adam with gradient's gradient prints what the hand-written one does (L285 R4)", () => {
  const files = madeUp(200, 100), r = same(["d", "reverse", "200", "2"], files);
  assert.deepEqual(r.out.slice(1), w.ideal(["d", "adam", "200", "2"], files).out.slice(1));
});

test("mnist: a Newton step from dual numbers gives the R-operator's step", () => {
  const r = same(["d", "newton", "100", "1"], madeUp(100, 100));
  assert.equal(r.out[1], "epoch 1: loss 2.2962, damping 0.6667");
});

test("mnist: usage and files that aren't MNIST's", () => {
  const usage = ["usage: mnist <folder> [adam|reverse|newton|reverse-newton] [training digits, at least 100] [passes]"];
  for (const args of [[], ["d", "sgd"], ["d", "adam", "50"], ["d", "adam", "100", "0"]]) assert.deepEqual(same(args, {}), { out: [], err: usage, code: 2 });
  assert.deepEqual(same(["nope"], {}).err, ["mnist: no such file or folder: nope/train-images-idx3-ubyte"]);
  const files = madeUp(100, 100);
  files["d/train-labels-idx1-ubyte"] = files["d/train-images-idx3-ubyte"];
  assert.deepEqual(same(["d"], files).err, ["mnist: d/train-labels-idx1-ubyte isn't an MNIST label file"]);
  const short = madeUp(100, 100);
  short["d/t10k-images-idx3-ubyte"] = short["d/t10k-images-idx3-ubyte"].subarray(0, 5000);
  assert.deepEqual(same(["d"], short).err, ["mnist: d/t10k-images-idx3-ubyte or d/t10k-labels-idx1-ubyte is cut short"]);
});

test("mnist through ters wasi and ters native prints what the ideal prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "mnist-"));
  const files = madeUp(200, 100);
  for (const [f, bytes] of Object.entries(files)) { mkdirSync(join(dir, dirname(f)), { recursive: true }); writeFileSync(join(dir, f), bytes); }
  const want = w.ideal(["d", "adam", "200", "1"], files).out.join("\n") + "\n";
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "d", "adam", "200", "1"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want, "ters wasi");
  // C344: a training file of MNIST's size read under Node's WASI with the
  // collector on one thread crashed V8 every run (a collection inside
  // fd_read's fast call); through wasiImports it doesn't.
  const big = join(dir, "big");
  for (const [f, bytes] of Object.entries(madeUp(60000, 100))) { mkdirSync(join(big, dirname(f)), { recursive: true }); writeFileSync(join(big, f), bytes); }
  // (Run from a CommonJS file: from a module, or from -e, it didn't crash here.)
  writeFileSync(join(dir, "run.cjs"), `const { readFileSync } = require("node:fs"), { WASI } = require("node:wasi"); ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["p", "d", "adam", "100", "1"], preopens: { ".": ${JSON.stringify(big)} }, returnOnExit: true });
process.exitCode = w.start(new WebAssembly.Instance(new WebAssembly.Module(readFileSync(${JSON.stringify(join(dir, "p.wasm"))})), wasiImports(w)));
`);
  const child = spawnSync(process.execPath, ["--no-warnings", "--single-threaded-gc", join(dir, "run.cjs")], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /^mnist: 100 training digits, 100 test digits/);
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), ["d", "adam", "200", "1"], { cwd: dir, encoding: "utf8" }).stdout, want, "ters native");
  assert.equal(spawnSync(join(dir, "p"), ["d", "reverse", "200", "1"], { cwd: dir, encoding: "utf8" }).stdout, want.replace("tanh, adam", "tanh, reverse"), "ters native, reverse");
  // Newton with gradient's gradient and Hessian times a vector (L285)
  // prints what the hand-written Newton does. Natively: in the core IR's
  // JavaScript each `replace at` of its pass back makes a version (C334),
  // and a pass over 100 digits took 4.8 GB, more than CI's runner gives a
  // file running beside three others.
  const newton = w.ideal(["d", "newton", "100", "1"], files).out;
  assert.deepEqual(spawnSync(join(dir, "p"), ["d", "reverse-newton", "100", "1"], { cwd: dir, encoding: "utf8" }).stdout.trimEnd().split("\n").slice(1), newton.slice(1), "ters native, reverse-newton");
});
