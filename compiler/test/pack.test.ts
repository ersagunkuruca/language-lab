// pack (compiler/gaps/pack), GAPS.md round 18's program: a made-up
// document packed by LZ77 and Huffman and unpacked again. The evaluator,
// the core IR's module and the hand-written ideal must print the same and
// exit the same way, and so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, program, ways } from "../gaps/pack.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const all = (args: string[]) => {
  const want = w.ideal(args, {});
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](args, {}), want, way);
  return want;
};

test("pack: 200 words packed and back", () => {
  const r = all(["200"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, [
    "200 words, 1113 bytes, Adler-32 " + r.out[0].split(" ").at(-1),
    "LZ77: 350 tokens, 165 of them copies",
    "Huffman: 516 bytes, 46.4% of the text",
    r.out[3],
  ]);
  assert.match(r.out[3], /^Unpacked: 1113 bytes, Adler-32 \d+, the same$/);
});

test("pack: no words, a few, and arguments that aren't numbers", () => {
  assert.equal(all(["0"]).out[0], "0 words, 0 bytes, Adler-32 1");
  for (const args of [["1"], ["7"], ["2.7"], ["x"]]) assert.match(all(args).out[3], /, the same$/);
});

// GAPS round 18: the chains are a Map whose values are lists, and that
// kept every list as written, so the bytes, read by position, are linked
// lists and the program is quadratic.
test("pack: what the lists are stored as", () => {
  assert.deepEqual(program().chosen, ["Map as weight-balanced tree", "Nat as int"]);
});

test("pack: 800 words, from the core IR and the ideal", () => {
  assert.deepEqual(w.core(["800"], {}), w.ideal(["800"], {}));
});

// The program as `ters wasi` and `ters native` build it.
test("pack through ters wasi and ters native prints what ters run prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "pack-"));
  const want = spawnSync(process.execPath, [lab, "run", folder, "300"], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["p", "300"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), ["300"], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
