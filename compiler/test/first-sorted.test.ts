// C356: a sorted list read only for its first item is the prelude's
// `first by key`, one pass, no sort (first-sorted.ts): larder's
// `nicest of(sort by(options, key))`. Of equal keys the first stays, as the
// stable sort keeps them, and the answers are the evaluator's. A list read
// past its first item is sorted as written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { firstSorted } from "../src/first-sorted.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

function program(steps: string[], defs: [string, string[], string][]) {
  const dir = join(mkdtempSync(join(tmpdir(), "first-sorted-")), "p");
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
  const run = spawnSync(process.execPath, [lab, "run", dir], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, ev.stdout);
  const p = loadProgram(dir);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  return { out: ev.stdout, read: firstSorted(p.code, info, p.pres.names, p.own.defs, { ...p.options, units: false })?.read ?? 0 };
}

test("the first of a sorted list, the first of equal keys, without sorting", () => {
  const { out, read } = program(
    ["print(show(first of(sort by([3, -2, 2, 5, -1, 1], (x) => x * x))))"],
    [["first of", ["l"], "match l\n  nil → 0\n  cons(x, r) → x"]],
  );
  assert.equal(out, "-1\n");
  assert.equal(read, 1);
});

test("a sorted list read past its first item is sorted as written", () => {
  const { out, read } = program(
    ["print(show(first two(sort by([3, -2, 2, 5, -1, 1], (x) => x * x))))"],
    [["first of", ["l"], "match l\n  nil → 0\n  cons(x, r) → x"], ["first two", ["l"], "match l\n  nil → 0\n  cons(x, r) → x + first of(r)"]],
  );
  assert.equal(out, "0\n");
  assert.equal(read, 0);
});
