// mnist (compiler/gaps/mnist), GAPS.md round 22's program: a 784-32-10
// network learning digits by Adam, or by damped Newton steps whose
// Hessian-vector products come from running the backward pass on dual
// numbers. The core IR's module and the hand-written ideal (whose
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

test("mnist: a Newton step from dual numbers gives the R-operator's step", () => {
  const r = same(["d", "newton", "100", "1"], madeUp(100, 100));
  assert.equal(r.out[1], "epoch 1: loss 2.2962, damping 0.6667");
});

test("mnist: usage and files that aren't MNIST's", () => {
  const usage = ["usage: mnist <folder> [adam|newton] [training digits, at least 100] [passes]"];
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
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), ["d", "adam", "200", "1"], { cwd: dir, encoding: "utf8" }).stdout, want, "ters native");
});
