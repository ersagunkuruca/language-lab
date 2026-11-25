// Duals read out of arrays on the core IR's JavaScript, as the evaluator
// reads them. zero-parts.ts took an item read from an array (a runtime
// call with no type at hand) for no value at all, so `first(item at(…),
// else dual(0, 0))` was kept as the else's record of one part, and the
// item printed as dual(0, 0) or not a number. And `array of` a written
// list (core-js.ts's array.ofItems) was asked of C's and WebAssembly's
// runtime whether it may fail, which it doesn't have.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

const CASES = [
  ["print(show(first(item at(array of(map(range(2), (i) => dual(as float64(i), 1.0))), 1), else dual(0.0, 0.0))))", "dual(1, 1)"],
  ["print(show(first(item at(array of(map(range(2), (i) => dual(as float64(i), 1.0))), 1), else dual(5.0, 0.0))))", "dual(1, 1)"],
  ["print(show(first(item at(array of(map(range(2), (i) => dual(as float64(i), 1.0))), 7), else dual(5.0, 0.0))))", "dual(5, 0)"],
  ["print(show(first(item at(array of(list of(dual(1.0, 2.0), dual(3.0, 4.0))), 1), else dual(0.0, 0.0))))", "dual(3, 4)"],
];

for (const [text, want] of CASES) {
  test(`core JS as the evaluator: ${text}`, () => {
    const dir = join(mkdtempSync(join(tmpdir(), "dual-items-")), "p");
    mkdirSync(dir);
    writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
    writeFileSync(join(dir, "names.default.json"), "{}\n");
    const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
    ask("open", { path: dir });
    ask("define", { name: "main", kind: "function", params: [] });
    ask("replace", { at: "main", find: "□", text });
    const ev = spawnSync(process.execPath, [lab, "run", dir, "--evaluator"], { encoding: "utf8" });
    assert.equal(ev.status, 0, ev.stderr);
    assert.equal(ev.stdout, `${want}\n`);
    const out = join(mkdtempSync(join(tmpdir(), "dual-items-js-")), "p.mjs");
    const made = spawnSync(process.execPath, [lab, "compile", dir, "-o", out], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
    assert.equal(made.status, 0, made.stderr);
    const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, ev.stdout);
  });
}
