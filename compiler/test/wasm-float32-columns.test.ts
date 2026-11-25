// An array of records with Float32 fields kept as columns in WebAssembly
// (C309): each Float32 field a column of binary32s, an `(array (mut f32))`,
// each value rounded as it is written and widened as it is read. sparks
// (ters/examples/sparks), a spark four Float32s, prints what the evaluator
// prints; before, its sparks were rows, each field a struct of its own
// (300,000 sparks 8.4 s, as columns 0.9 s in Node).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const sparks = join(import.meta.dirname, "../../ters/examples/sparks");

test("WebAssembly keeps sparks' Float32 fields as f32 columns, as the evaluator computes (C309)", () => {
  const ev = spawnSync(process.execPath, [lab, "run", sparks, "200", "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  const run = mkdtempSync(join(tmpdir(), "float32-columns-")), wasm = join(run, "sparks.wasm");
  const made = spawnSync(process.execPath, [lab, "wasi", sparks, "-o", wasm], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1", COLUMNS_WHY: "1" } });
  assert.equal(made.status, 0, made.stderr);
  assert.doesNotMatch(made.stderr, /Spark kept rows/);
  // A type `(array (mut f32))`: 0x5e, f32, mutable.
  assert.ok(readFileSync(wasm).includes(Buffer.from([0x5e, 0x7d, 0x01])), "a column of f32s");
  writeFileSync(join(run, "run.cjs"), `const { readFileSync } = require("node:fs"), { WASI } = require("node:wasi"); ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["p", "200"], returnOnExit: true });
process.exitCode = w.start(new WebAssembly.Instance(new WebAssembly.Module(readFileSync(${JSON.stringify(wasm)})), wasiImports(w)));
`);
  const r = spawnSync(process.execPath, [join(run, "run.cjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, ev.stdout);
});
