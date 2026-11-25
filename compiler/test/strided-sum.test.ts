// C343: the prelude's `strided contraction sum` (a pair of axes summed a
// stride at a time, C302) reads its two arrays through `item at`; on core
// JavaScript a kept array's `item at` is read in place from its buffer as
// `dot`'s `get` is (kept-arrays.ts), unchecked where the loop's first and
// last positions are in the arrays. The answers are the evaluator's: a
// matrix times a vector, and a contraction over a middle axis (strides
// other than 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("a contraction's sum reads its arrays in place on core JavaScript, as the evaluator answers", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "strided-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: [] });
  ask("replace", { at: "main", find: "□", text: "w = tensor of([3, 4], map(range(12), (i) => as float64(i) * 0.5)); □" });
  ask("replace", { at: "main", find: "□", text: "x = tensor of([4, 1], map(range(4), (i) => as float64(i) + 1.0)); □" });
  ask("replace", { at: "main", find: "□", text: "c = tensor of([2, 3, 2], map(range(12), (i) => as float64(i) - 3.0)); □" });
  ask("replace", { at: "main", find: "□", text: "d = tensor of([3, 2], map(range(6), (i) => as float64(i) * 2.0)); □" });
  ask("replace", { at: "main", find: "□", text: "print(show(tensor items(contracted(w, x, [(1, 0)])))); print(show(tensor items(contracted(c, d, [(1, 0)]))))" });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(ev.stdout, "[10, 30, 50]\n[4, -2, 16, 16, 76, 106, 88, 124]\n");
  const out = join(mkdtempSync(join(tmpdir(), "strided-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  assert.match(readFileSync(out, "utf8"), /l\d+ \+ w0\$b\[w0\$s \+ l\d+\] \* w1\$b\[w1\$s \+ l\d+\]/, "the sum's two reads in place");
});
