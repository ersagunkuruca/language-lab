// `lab compile` writes the compiled module's map beside it (C143c): each
// printed function's node by its name, and each stop site's node and
// definition, and which binder each local holds (C143d), ids only, which
// the module itself no longer carries, and each function's lines in the
// module as written (C143e).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../src/program.ts";
import { coreMap, lowerCore } from "../src/core-js.ts";

test("the compiled module's map names each function's node and each stop's (C143c)", () => {
  const p = load("calc"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const m = coreMap(ir);
  assert.equal(m.functions.f0, main);
  assert.equal(Object.keys(m.functions).length, ir.funcs.length);
  assert.ok(Object.values(m.functions).every((id) => id in ir.code.nodes));
  assert.ok(m.stops.every((s) => s.node in ir.code.nodes));
  // Which binder each local holds (C143d): binders of the program, in
  // functions the module prints.
  const held = Object.entries(m.locals);
  assert.ok(held.length > 0);
  for (const [fn, ls] of held) {
    assert.ok(fn in m.functions);
    for (const [l, id] of Object.entries(ls)) { assert.match(l, /^l\d+$/); assert.equal(ir.code.nodes[id]?.kind, "binder", `${fn}.${l}`); }
  }
  const dir = mkdtempSync(join(tmpdir(), "map-"));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/lab.ts"), "compile", join(import.meta.dirname, "../../ters/examples/calc"), "-o", "calc.mjs"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const { lines, ...written } = JSON.parse(readFileSync(join(dir, "calc.mjs.map.json"), "utf8"));
  assert.deepEqual(written, m);
  const js = readFileSync(join(dir, "calc.mjs"), "utf8").split("\n");
  assert.match(js.join("\n"), /function f0\(/);
  // Each printed function's lines in the module as written (C143e): it
  // starts on its first and ends on its last, and every function has them,
  // by its printed name though the bundler renamed f1 (the runtime has one).
  assert.doesNotMatch(js[lines.f1[0] - 1], /function f1\(/);
  for (const n of Object.keys(m.functions)) {
    const [a, b] = lines[n] ?? assert.fail(`no lines for ${n}`);
    assert.match(js[a - 1], /^\s*function\*? ?[\w$]+\(/);
    assert.ok(b >= a);
    assert.match(js[b - 1], /}\s*$/);
    assert.equal(js[b - 1].search(/\S/), js[a - 1].search(/\S/), `${n} ends at its own indent`);
  }
});

test("a stop's site in the map is the node it is lowered from (C143c)", () => {
  const p = load("physics"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const m = coreMap(ir);
  assert.ok(m.stops.length > 0);
  assert.ok(m.stops.every((s) => s.node in ir.code.nodes && s.def in ir.code.nodes));
});
