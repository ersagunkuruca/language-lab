// neighbours (L280g, docs/design/data/NEARBY-2026-11-22.md): each item's
// neighbours, the positions of the others within reach of its place,
// smallest first, every pair compared; places any record of Float64s.
// Evaluated and compiled the same, each on its grid and every pair.

import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compiledDefs, emitCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { holdNeighbours } from "../../compiler/src/scalar.ts";
import { call } from "../mcp/server.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const show = (x: Id) => k.call(SHOW_ANY, x);
  const P = k.type("Spot", [], [["spot", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)]]]]);
  const spot = (x: number, y: number) => k.call(P.v.spot, k.lit(x), k.lit(y));
  // On a line: 3 apart is within 3 (≤), 6 isn't.
  def("on a line", () => show(k.call(lib("neighbours"), k.list(k.lit(0), k.lit(3), k.lit(4), k.lit(10)), k.fn(["x"], (x) => x), k.lit(3))));
  // In the plane, by the spot itself: (0, 0) and (3, 4) are 5 apart.
  def("in the plane", () => show(k.call(lib("neighbours"), k.list(spot(0, 0), spot(3, 4), spot(9, 9), spot(0, 5)), k.fn(["s"], (s) => s), k.lit(5))));
  def("none", () => show(k.call(lib("neighbours"), k.list(), k.fn(["x"], (x) => x), k.lit(1))));
  // Many, on a lattice so that many pairs are exactly reach apart: the
  // evaluator's grid (library/hosts.ts) and the compiled one (core-rt.ts)
  // against each other, and both against the definition's every pair.
  let seed = 5;
  const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
  def("many", () => show(k.call(lib("neighbours"), k.list(...Array.from({ length: 400 }, () => spot(rand(60) / 2, rand(60) / 2))), k.fn(["s"], (s) => s), k.lit(2.5))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["on a line", "in the plane", "none", "many"];

test("neighbours on a line and in the plane, within reach counted with ≤, evaluated and compiled the same, on grids and every pair", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const evaluated = NAMES.map((n) => r.value(at(n)));
  assert.deepEqual(evaluated.slice(0, 3), ["[[1], [0, 2], [1], []]", "[[1, 3], [0, 3], [], [0, 1]]", "[]"]);
  const pairs = makeRunner(p.code, p.info, { print: () => {}, names: p.names, libraryHosts: false });
  assert.equal(evaluated[3], pairs.value(at("many")));
  // The compiled program finds them on a grid in its runtime.
  assert.match(emitCoreJs(lowerCore(p.code, p.info, p.names, [at("many")])).js, /R\.rt\("neighbours\.grid"\)/);
  // Held (L280g, the choices' way entry): a grid of cells of another
  // size, narrower than reach too, a k-d tree, or every pair; the same lists.
  const call = Object.values(p.code.nodes).find((n) => n.kind === "call" && (p.code.nodes[n.fn] as { target?: Id }).target === lib("neighbours") && subtree(p.code, at("many")).includes(n.id))!;
  for (const way of [1, 4, "every pair", "k-d tree"] as const) {
    holdNeighbours([[call.id, way]]);
    try {
      const js = emitCoreJs(lowerCore(p.code, p.info, p.names, [at("many")])).js;
      if (way === "every pair") assert.doesNotMatch(js, /neighbours\.grid/); else assert.match(js, way === "k-d tree" ? /, "k-d tree"\)/ : new RegExp(`, ${way}\\)`));
      assert.equal((compiledDefs(p.code, p.info, p.names, ["many"]).many as () => Value)(), evaluated[3]);
    } finally { holdNeighbours([]); }
  }
  const defs = compiledDefs(p.code, p.info, p.names, NAMES) as unknown as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

// As a person writes it (through the MCP, as the editor's typed fill
// reads text) and as `ters compile` builds it: the place's lambda leaves
// its effects open, and the list representation calls a copy of
// neighbours. The module still finds them on its grid, and prints what
// the evaluator does.
test("a program written as text and built by ters compile finds its neighbours on a grid", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-neighbours-")), "near");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.equal(r.error, false, `${name}: ${r.text}`); return r.text; };
  const def = (name: string, params: string[] | null, body: string[]) => {
    ask("define", { name, kind: params ? "function" : "value", params: params ?? [] });
    // A reading nothing settles yet is asked for, as the editor would ask.
    for (const text of body) { const r = call("replace", { at: name, find: "□", text }), as = r.error ? /Give `as` \("([^"]+)"/.exec(r.text)?.[1] : undefined; if (r.error) ask("replace", { at: name, find: "□", text, as }); }
  };
  ask("open", { path: dir });
  ask("define", { name: "Vec3", kind: "type", first: "vec3(x: Float64, y: Float64, z: Float64)" });
  def("random", ["s"], ["first(remainder(s * 16807, 2147483647), else 1)"]);
  def("chance", ["s"], ["first(as float64(s) / 2147483647.0, else 0.0)"]);
  def("point at", ["i"], ["s = random(i * 7919 + 13); □", "a = random(s); □", "vec3(100.0 * chance(s), 100.0 * chance(a), 100.0 * chance(random(a)))"]);
  def("main", ["arguments"], ['n = first(read whole number(item at(arguments, 0, "300")), else 300); ps = map(range from(0, n), point at); close = neighbours(ps, (p) => p, 10.0); print(show(sum(map(close, length))) ++ " " ++ show(sum(map(close, sum))))']);
  const ters = join(import.meta.dirname, "../cli/ters.ts"), out = join(dir, "near.mjs");
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, ["--no-warnings", ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  run(ters, "compile", dir, "-o", out);
  assert.match(readFileSync(out, "utf8"), /\.rt\("neighbours\.grid"\)/);
  assert.equal(run(out, "400"), run(ters, "run", dir, "400"));
});
