// C351a: on core JavaScript, contracted's one pair of axes at Float64
// (the prelude's `strided products`) is the runtime's
// `array.stridedProducts`, two rows by four columns of sums at once, each
// added in the definition's order. The answers are the evaluator's to the
// last bit: 3 rows (one left over) by 6 columns (two left over), and a
// middle axis (strides other than 1), with numbers whose sums round.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("contracted's products on core JavaScript, several sums at once, as the evaluator adds them", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "products-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: "main", find: "□", text: "w = tensor of([3, 5], map(range(15), (i) => as float64(i) * 0.1 + 0.3)); □" });
  ask("replace", { at: "main", find: "□", text: "x = tensor of([5, 6], map(range(30), (i) => as float64(i) * 0.37 - 2.9)); □" });
  ask("replace", { at: "main", find: "□", text: "c = tensor of([2, 3, 2], map(range(12), (i) => as float64(i) * 0.7 - 3.1)); □" });
  ask("replace", { at: "main", find: "□", text: "d = tensor of([3, 5], map(range(15), (i) => as float64(i) * 0.3)); □" });
  ask("replace", { at: "main", find: "□", text: "print(show(tensor items(contracted(w, x, [(1, 0)])))); print(show(tensor items(contracted(c, d, [(1, 0)]))))" });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  const out = join(mkdtempSync(join(tmpdir(), "products-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  assert.match(readFileSync(out, "utf8"), /R2\.rt\("array\.stridedProducts\.a\d+"\)/, "the products are the runtime's");
});

// C351b: at the numbers module's Dual, the arrays columns (columns.ts),
// `array.stridedProductsDual`: each sum's value and slope as the
// evaluator adds them, to the last bit.
test("contracted's products at Dual on core JavaScript, over columns, as the evaluator adds them", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "products-dual-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  for (const text of [
    "w = tensor of([3, 5], map(range(15), (i) => dual(as float64(i) * 0.1 + 0.3, as float64(i) * 0.01 - 0.07))); □",
    "x = tensor of([5, 6], map(range(30), (i) => dual(as float64(i) * 0.37 - 2.9, 0.11 * as float64(i)))); □",
    "c = tensor of([2, 3, 2], map(range(12), (i) => dual(as float64(i) * 0.7 - 3.1, 0.3))); □",
    "d = tensor of([3, 5], map(range(15), (i) => dual(as float64(i) * 0.3, as float64(i) * -0.13))); □",
    "y = tensor items array(contracted(w, x, [(1, 0)])); z = tensor items array(contracted(c, d, [(1, 0)])); □",
    "print(show(map(range(18), (i) => first(item at(y, i), else dual(0.0, 0.0))))); print(show(map(range(20), (i) => first(item at(z, i), else dual(0.0, 0.0)))))",
  ]) ask("replace", { at: "main", find: "□", text });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  const out = join(mkdtempSync(join(tmpdir(), "products-dual-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  assert.match(readFileSync(out, "utf8"), /R2\.rt\("array\.stridedProductsDual\.a\d+"\)/, "the products are the runtime's");
});
