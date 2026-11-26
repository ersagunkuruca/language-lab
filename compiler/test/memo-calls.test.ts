// C352, C353: on core JavaScript a function that only computes, works
// through a loop and is called again with inputs it was lately called with
// gives that answer again (memo-calls.ts): fit's `sums from`, worked out in
// `damped` and again in the next `step` at the same parameters, and its
// `tried(model, points)`, each model fitted to print it and again to find
// the best, an Optional record kept for each of the four. The
// answers are the evaluator's. An array replaced in place between two
// calls (its type written by an owned replace) is never kept so: the second
// call sees the new item.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

function compiled(steps: string[], defs: [string, string[], string][] = []) {
  const dir = join(mkdtempSync(join(tmpdir(), "memo-")), "p");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  for (const [name, params, body] of defs) { ask("define", { name, kind: "function", params }); ask("replace", { at: name, find: "□", text: body }); }
  ask("define", { name: "main", kind: "function", params: [] });
  for (const text of steps) ask("replace", { at: "main", find: "□", text });
  const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  const out = join(mkdtempSync(join(tmpdir(), "memo-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  return { out: ev.stdout, js: readFileSync(out, "utf8") };
}

test("fit's sums worked out once for the same parameters, as the evaluator answers", () => {
  const dir = join(import.meta.dirname, "../gaps/fit");
  const data = join(mkdtempSync(join(tmpdir(), "memo-fit-")), "d.txt");
  writeFileSync(data, Array.from({ length: 200 }, (_, i) => { const x = i / 20; return `${x} ${(3 / (1 + Math.exp(-1.3 * x)) + 0.05 * Math.sin(7 * i)).toFixed(6)}`; }).join("\n") + "\n");
  const ev = spawnSync(process.execPath, [lab, "run", dir, data, "--evaluator"], { encoding: "utf8" });
  assert.equal(ev.status, 0, ev.stderr);
  const out = join(mkdtempSync(join(tmpdir(), "memo-fit-js-")), "p.mjs");
  const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const run = spawnSync(process.execPath, [out, data], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  const kept = readFileSync(out, "utf8").match(/Object\.is\(f\d+\$k0\[j\d*\], l0\)/g) ?? [];
  // sse of, sums from, step, and tried with the fit it calls.
  assert.ok(kept.length >= 5, `answers kept by ${kept.length} functions`);
});

test("an array replaced in place between two calls is read again", () => {
  const { js } = compiled([
    "xs = array of(map(range(50), (i) => as float64(i) * 0.5)); □",
    "print(show(sum of items(xs))); □",
    "ys = replace in array(xs, 3, 100.0); print(show(sum of items(ys)))",
  ], [["added", ["l"], "match l\n  nil → 0.0\n  cons(x, r) → x + added(r)"], ["sum of items", ["xs"], "added(items of array(xs))"]]);
  assert.doesNotMatch(js, /Object\.is\(f\d+\$k0\[j\d*\]/, "nothing kept where an array is written in place");
});
