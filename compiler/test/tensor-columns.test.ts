// C342: an Array Dual in a Tensor stored as columns on core JavaScript
// (columns.ts), as mnist's Newton pass on `contracted` keeps its weights:
// read by `item at` (the prelude's strided contraction sum, its `item
// read` put in place), made of a list's items (`transposed by`), and a
// slice of another (a tensor of a slice of the parameters). The answers
// are the evaluator's, past the end too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("Duals in a tensor are columns on core JavaScript: read, sliced, transposed", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "tensor-columns-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  for (const text of [
    "p = array of(map(range(13), (i) => dual(as float64(i), 1.0))); □",
    "w = tensor of array([3, 4], slice of array(p, 1, 12)); □",
    "x = tensor of([4, 1], map(range(4), (i) => dual(1.0, as float64(i)))); □",
    "y = tensor items array(contracted(w, x, [(1, 0)])); □",
    "t = tensor items array(transposed by(w, [1, 0])); □",
    "print(show(first(item at(y, 0), else dual(0.0, 0.0)))); print(show(first(item at(y, 2), else dual(0.0, 0.0)))); print(show(first(item at(y, 3), else dual(0.0, 0.0)))); print(show(first(item at(t, 1), else dual(0.0, 0.0)))); print(show(first(item at(t, 10), else dual(0.0, 0.0))))",
  ]) ask("replace", { at: "main", find: "□", text });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(ev.stdout, "dual(10, 24)\ndual(42, 72)\ndual(0, 0)\ndual(5, 1)\ndual(8, 1)\n");
  const out = join(mkdtempSync(join(tmpdir(), "tensor-columns-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  const js = readFileSync(out, "utf8");
  assert.match(js, /c0: \w+\.c0\.slice\(/, "the slice's columns copied");
  assert.match(js, /\.itemsOf\(/, "made of a list's items");
  assert.match(js, /new Float64Array\(/);
});
