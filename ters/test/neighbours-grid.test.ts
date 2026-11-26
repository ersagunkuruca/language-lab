// neighbours on a grid (C292): the prelude's grid, written in Ters, gives
// neighbours' own lists, and C and WebAssembly find a program's
// neighbours with it (src/lang/near-grid.ts copies it in as the
// program's own), printing what the evaluator prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { call } from "../mcp/server.ts";
import { skip } from "../../compiler/test/c-harness.ts";
import { wasiImports } from "../../compiler/src/wasi-imports.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("neighbours on a grid gives neighbours' lists: on a line, in the plane at ties, in 3D and 4D, and where the grid can't take them", () => {
  const k = new Lang(LIBRARY.code);
  const P2 = k.type("Spot", [], [["spot", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)]]]]);
  const P3 = k.type("Spot3", [], [["spot3", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)], ["z", () => k.tref(NUMBER)]]]]);
  const P4 = k.type("Spot4", [], [["spot4", [["a", () => k.tref(NUMBER)], ["b", () => k.tref(NUMBER)], ["c", () => k.tref(NUMBER)], ["d", () => k.tref(NUMBER)]]]]);
  let seed = 7;
  const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
  const cases: [string, () => Id, () => Id, number][] = [
    ["line", () => k.list(...[0, 3, 4, 10, -3, 7].map((x) => k.lit(x))), () => k.fn(["x"], (x) => x), 3],
    // On a lattice, so that many pairs are exactly reach apart.
    ["lattice", () => k.list(...Array.from({ length: 300 }, () => k.call(P2.v.spot, k.lit(rand(40) / 2), k.lit(rand(40) / 2)))), () => k.fn(["s"], (s) => s), 2.5],
    ["space", () => k.list(...Array.from({ length: 300 }, () => k.call(P3.v.spot3, k.lit(rand(1000) / 10 - 50), k.lit(rand(1000) / 10), k.lit(rand(1000) / 10)))), () => k.fn(["s"], (s) => s), 10],
    ["four parts", () => k.list(...Array.from({ length: 60 }, () => k.call(P4.v.spot4, k.lit(rand(10)), k.lit(rand(10)), k.lit(rand(10)), k.lit(rand(10))))), () => k.fn(["s"], (s) => s), 4],
    ["far out", () => k.list(k.lit(0), k.lit(1e12), k.lit(1e12 + 0.5), k.lit(1)), () => k.fn(["x"], (x) => x), 1],
    ["reach 0", () => k.list(k.lit(0), k.lit(0), k.lit(1)), () => k.fn(["x"], (x) => x), 0],
    ["reach below 0", () => k.list(k.lit(0), k.lit(0)), () => k.fn(["x"], (x) => x), -1],
    ["none", () => k.list(), () => k.fn(["x"], (x) => x), 1],
  ];
  // Each case's items are built again for each function from the same seed, so both get the same points.
  const defs = cases.flatMap(([name, items, place, reach], c) => ["neighbours", "neighbours on a grid"].map((f) => {
    seed = 7 + c;
    const d = k.def(`${name} by ${f}`);
    k.define(d, k.call(SHOW_ANY, k.call(lib(f), items(), place(), k.lit(reach))));
    return d;
  }));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  // Every pair, as the definition is written (not the evaluator's own grid).
  const r = makeRunner(code, info, { print: () => {}, names, libraryHosts: false });
  for (let i = 0; i < defs.length; i += 2) assert.equal(r.value(defs[i + 1]), r.value(defs[i]), cases[i / 2][0]);
  assert.equal(r.value(defs[1]), "[[1, 4], [0, 2], [1, 5], [5], [0], [2, 3]]");
});

// Written through the MCP, as neighbours.test's is, and built by ters
// native and ters wasi.
test("C and a WASI command find a program's neighbours on the grid and print what the evaluator prints", { skip }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-near-grid-")), "near");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.equal(r.error, false, `${name}: ${r.text}`); return r.text; };
  const def = (name: string, params: string[], body: string) => {
    ask("define", { name, kind: "function", params });
    const r = call("replace", { at: name, find: "□", text: body }), as = r.error ? /Give `as` \("([^"]+)"/.exec(r.text)?.[1] : undefined;
    if (r.error) ask("replace", { at: name, find: "□", text: body, as });
  };
  ask("open", { path: dir });
  ask("define", { name: "Vec3", kind: "type", first: "vec3(x: Float64, y: Float64, z: Float64)" });
  def("random", ["s"], "first(remainder(s * 16807, 2147483647), else 1)");
  def("chance", ["s"], "first(as float64(s) / 2147483647.0, else 0.0)");
  def("point at", ["i"], "vec3(100.0 * chance(random(i * 7919 + 13)), 100.0 * chance(random(random(i * 7919 + 13))), 50.0 * chance(random(random(random(i * 7919 + 13)))))");
  def("main", ["arguments"], 'close = neighbours(map(range from(0, first(read whole number(item at(arguments, 0, "400")), else 400)), point at), (p) => p, 10.0)\nprint(show(sum(map(close, length))) ++ " " ++ show(sum(map(close, sum))) ++ " " ++ show(item at(close, 7, nil)))');
  const ters = join(import.meta.dirname, "../cli/ters.ts");
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, ["--no-warnings", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const want = run(ters, "run", dir, "500");
  assert.match(want, /^\d+ \d+ \[/);
  run(ters, "native", dir, "-o", join(dir, "near"));
  assert.match(readFileSync(join(dir, "near.c"), "utf8"), /lab_grid_found/);
  assert.equal(spawnSync(join(dir, "near"), ["500"], { encoding: "utf8" }).stdout, want);
  run(ters, "wasi", dir, "-o", join(dir, "near.wasm"));
  const out = join(dir, "out.txt"), fd = openSync(out, "w");
  const w = new WASI({ version: "preview1", args: ["near", "500"], stdout: fd, returnOnExit: true });
  assert.equal(w.start(new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(dir, "near.wasm"))), wasiImports(w))), 0);
  closeSync(fd);
  assert.equal(readFileSync(out, "utf8"), want);
});

// C's own grid (c.ts gridC, C293) and WebAssembly's (wasm.ts gridRt) on
// places of one part and of two, and on places spread too far apart for
// a cell table, where C sorts them by cell: the lists the evaluator gives.
test("C's and WebAssembly's own grids give the evaluator's lists on a line, in the plane, and spread far apart", { skip }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-near-grid-c-")), "near");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.equal(r.error, false, `${name}: ${r.text}`); return r.text; };
  const def = (name: string, params: string[], body: string) => {
    ask("define", { name, kind: "function", params });
    const r = call("replace", { at: name, find: "□", text: body }), as = r.error ? /Give `as` \("([^"]+)"/.exec(r.text)?.[1] : undefined;
    if (r.error) ask("replace", { at: name, find: "□", text: body, as });
  };
  ask("open", { path: dir });
  ask("define", { name: "Vec2", kind: "type", first: "vec2(x: Float64, y: Float64)" });
  def("random", ["s"], "first(remainder(s * 16807, 2147483647), else 1)");
  def("chance", ["s"], "first(as float64(s) / 2147483647.0, else 0.0)");
  def("on line", ["i"], "60.0 * chance(random(i * 7919 + 13))");
  // Twenty clusters a few metres wide, far apart.
  def("far", ["i"], "100000.0 * chance(random(first(remainder(i, 20), else 0) * 7919 + 13)) + 3.0 * chance(random(random(i * 31 + 5)))");
  def("in plane", ["i"], "vec2(40.0 * chance(random(i * 7919 + 13)), 40.0 * chance(random(random(i * 7919 + 13))))");
  def("told", ["close"], 'show(sum(map(close, length))) ++ " " ++ show(sum(map(close, sum))) ++ " " ++ show(item at(close, 7, nil))');
  def("main", ["arguments"], 'n = first(read whole number(item at(arguments, 0, "300")), else 300)\nprint(told(neighbours(map(range from(0, n), on line), (p) => p, 1.5)))\nprint(told(neighbours(map(range from(0, n), far), (p) => p, 2.0)))\nprint(told(neighbours(map(range from(0, n), in plane), (p) => p, 3.0)))');
  const ters = join(import.meta.dirname, "../cli/ters.ts");
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, ["--no-warnings", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const want = run(ters, "run", dir, "300");
  assert.match(want, /^\d+ \d+ \[/);
  run(ters, "native", dir, "-o", join(dir, "near"));
  assert.match(readFileSync(join(dir, "near.c"), "utf8"), /grid found, on a grid/);
  assert.equal(spawnSync(join(dir, "near"), ["300"], { encoding: "utf8" }).stdout, want);
  run(ters, "wasi", dir, "-o", join(dir, "near.wasm"));
  const out = join(dir, "out.txt"), fd = openSync(out, "w");
  const w = new WASI({ version: "preview1", args: ["near", "300"], stdout: fd, returnOnExit: true });
  assert.equal(w.start(new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(dir, "near.wasm"))), wasiImports(w))), 0);
  closeSync(fd);
  assert.equal(readFileSync(out, "utf8"), want);
});
