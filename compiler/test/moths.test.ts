// moths (compiler/gaps/moths), GAPS.md game round 1 (BACKLOG G3): moths
// flocking by Reynolds's boids on a grid hash, drawn to lamps. The
// evaluator, the core IR's module and the hand-written ideal must print the
// same lines, and so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, ways } from "../gaps/moths.ts";
import { skip } from "./c-harness.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const w = await ways();

test("moths: 25 ticks of 200 moths, all three ways", () => {
  const want = w.ideal(["25", "200"], {});
  assert.equal(want.out[0], "tick 25: checksum 72167.676025, mean speed 1.171265");
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](["25", "200"], {}), want, way);
});

test("moths: 100 ticks of 3000 moths, from the core IR and the ideal", () => {
  assert.deepEqual(w.core(["100", "3000"], {}), w.ideal(["100", "3000"], {}));
});

test("moths through ters wasi and ters native prints what the ideal prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "moths-"));
  const want = w.ideal(["50", "1000"], {}).out.join("\n") + "\n";
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "m.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["m", "50", "1000"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "m.wasm"))), wasiImports(wasi)));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "m")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "m"), ["50", "1000"], { encoding: "utf8" }).stdout, want, "ters native");
});

// C362: on WebAssembly the moths are columns, each read with `item at`
// made from them where it leaves whole (into `met`), as on JavaScript.
test("moths through ters wasi keeps the moths as columns (C362)", () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "moths-"));
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "m.wasm")], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1", COLUMNS_WHY: "1" } });
  assert.equal(made.status, 0, made.stderr);
  assert.doesNotMatch(made.stderr, /Moth kept rows/);
});
