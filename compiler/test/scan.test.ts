// scan (compiler/gaps/scan), GAPS.md round 19's program: sixteen-odd
// regular expressions read, made Thompson automata, made deterministic and
// made smallest, then run over a made-up log. The evaluator, the core IR's
// module and the hand-written ideal must print the same and exit the same
// way, and so must `ters wasi` and `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, ways } from "../gaps/scan.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const all = (args: string[]) => {
  const want = w.ideal(args, {});
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](args, {}), want, way);
  return want;
};

test("scan: 40 lines, every rule by all three automata", () => {
  const r = all(["40"]);
  assert.equal(r.code, 0);
  assert.equal(r.out[0], "40 lines, 19 rules");
  for (const line of r.out.filter((l) => l.startsWith("rule "))) assert.match(line, /, all three agree$/);
  assert.ok(r.out.includes("written out and read again: 19 of 19 the same"));
  assert.ok(r.out.includes(`milliseconds and round both match "10ms"`));
});

test("scan: no lines, one, and arguments that aren't whole numbers", () => {
  assert.equal(all(["0"]).out[0], "0 lines, 19 rules");
  all(["1"]);
  // Not a whole number: the 2000 lines of no argument, too many for the
  // evaluator in a test.
  for (const args of [["2.7"], ["x"], []]) assert.deepEqual(w.core(args, {}), w.ideal(args, {}));
});

test("scan: 400 lines, from the core IR and the ideal", () => {
  assert.deepEqual(w.core(["400"], {}), w.ideal(["400"], {}));
});

// The program as `ters wasi` and `ters native` build it.
test("scan through ters wasi and ters native prints what ters run prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "scan-"));
  const want = spawnSync(process.execPath, [lab, "run", folder, "200"], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "s.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["s", "200"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "s.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "s")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "s"), ["200"], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});
