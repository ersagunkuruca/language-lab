// `ters compile` writes the compiled module's map beside it (C143c): each
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
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "compile", join(import.meta.dirname, "../../ters/examples/calc"), "-o", "calc.mjs"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const { lines, ...written } = JSON.parse(readFileSync(join(dir, "calc.mjs.map.json"), "utf8"));
  // calc's written reader is made with fresh ids each time (inverses.ts,
  // C110 s5c), so the functions lowered from it differ in id from lowering
  // to lowering; the rest is the same.
  const own = (fs: Record<string, string>) => Object.fromEntries(Object.entries(fs).filter(([, id]) => id in p.code.nodes));
  assert.deepEqual(Object.keys(written.functions), Object.keys(m.functions));
  assert.deepEqual(own(written.functions), own(m.functions));
  assert.deepEqual(written.stops, m.stops);
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

// C170d: the program's own cases are tagged by small numbers, the map
// saying which variant each is, and a stop names its definition with no
// ids, so the module carries no node ids at all.
test("a compiled module carries no node ids: its own cases by number, its stops by name (C170d)", () => {
  const p = load("chapters"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const m = coreMap(ir);
  assert.ok(m.tags && Object.keys(m.tags).length > 0);
  for (const [n, id] of Object.entries(m.tags)) { assert.match(n, /^\d+$/); assert.ok(id.startsWith("box:") || ir.code.nodes[id]?.kind === "variant", id); }
  const dir = mkdtempSync(join(tmpdir(), "ids-"));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "compile", join(import.meta.dirname, "../../ters/examples/chapters"), "-o", "chapters.mjs"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const js = readFileSync(join(dir, "chapters.mjs"), "utf8");
  const ours = js.slice(js.search(/^(?:var|const|let) defs = \(function/m));
  const ids = new Set(Object.keys(ir.code.nodes).filter((id) => /^[a-z0-9]{26}$/.test(id)));
  assert.deepEqual([...ours.matchAll(/"([a-z0-9]{26})"/g)].map((x) => x[1]).filter((x) => ids.has(x)), []);
  assert.match(ours, /\.prototype\.tag = \d+;/);
  assert.doesNotMatch(ours, /R2?\.stop\(\w+, "/);
});

// A page saved or built carries no node ids either (C143): the editor's
// preview keeps them for Show where it stopped.
test("a saved page's script carries no node ids; the preview's keeps its stops' (C143)", async () => {
  const { corePageScript } = await import("../src/core-js.ts");
  const p = load("dice"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const ids = new Set(Object.keys(ir.code.nodes).filter((id) => /^[a-z0-9]{26}$/.test(id)));
  const idsIn = (js: string) => [...js.matchAll(/"([a-z0-9]{26})"/g)].map((x) => x[1]).filter((x) => ids.has(x));
  assert.deepEqual(idsIn(corePageScript(ir, p.pres.names[main], "$core", "dice", undefined, undefined, true)), []);
  assert.ok(idsIn(corePageScript(ir, p.pres.names[main], "$core", "dice")).length > 0);
});
