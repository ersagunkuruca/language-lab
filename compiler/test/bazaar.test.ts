// bazaar (compiler/gaps/bazaar), GAPS.md round 23's program: a small
// relational database whose questions are data, planned and run. The
// evaluator, the core IR's module and the hand-written ideal must print
// the same, plans included, and so must `ters compile`, `ters wasi` and
// `ters native`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";
import { folder, ways } from "../gaps/bazaar.ts";
import { skip } from "./c-harness.ts";

const w = await ways();
const ideal = (n: number) => w.ideal([String(n)]);

test("bazaar: 400 orders by the evaluator, the core IR and the ideal, plans included", () => {
  const want = ideal(400);
  for (const way of ["evaluator", "core"] as const) assert.deepEqual(w[way](["400"]), want, way);
  const out = want.out.join("\n");
  // The tests pushed down: March's below the join, onto the orders; the
  // city's into the customers under the anti join's right side; the amount
  // over 400 left above the column it reads, December's below it.
  assert.match(out, /== busy in March\n.*\n.*\n.*\n {8}hash join #0 = #1, filing the (left|right)\n(.*\n)*? +keep where #4 = 3 and 2 < #3\n +read orders/);
  assert.match(out, /keep where #2 = Trabzon\n +read customers/);
  assert.match(out, /keep where 400\.00 < #9\n +add #3 × #8\n(.*\n)* +keep where #4 = 12\n +read orders/);
});

test("bazaar: 30,000 orders from the core IR and the ideal; the smaller side filed", () => {
  const r = w.core(["30000"]);
  assert.deepEqual(r, ideal(30000));
  // 1500 customers against 30,000 orders: the customers are filed.
  assert.match(r.out.join("\n"), /^== revenue by city\n {2}sort by #1 down\n {4}group by #7\n {6}hash join #0 = #2, filing the right\n {8}read products\n {8}hash join #0 = #1, filing the right\n {10}read customers\n {10}read orders\n/);
});

test("bazaar: fewer than 20 orders, or an argument that isn't a whole number, is refused", () => {
  for (const a of ["19", "x", "007"]) {
    const r = w.core([a]);
    assert.deepEqual(r, w.ideal([a]), a);
    assert.deepEqual(r.out, []);
    assert.deepEqual(r.err, ["usage: bazaar [orders, at least 20]"]);
  }
});

test("bazaar through ters compile, ters wasi and ters native prints what the ideal prints", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "bazaar-"));
  const want = ideal(2000).out.join("\n") + "\n";
  const js = spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "b.mjs")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(spawnSync(process.execPath, [join(dir, "b.mjs"), "2000"], { encoding: "utf8" }).stdout, want, "ters compile");
  const made = spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "b.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const wasi = new WASI({ version: "preview1", args: ["b", "2000"], stdout: fd, stderr: fd, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "b.wasm"))), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "b")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "b"), ["2000"], { encoding: "utf8" }).stdout, want, "ters native");
});
