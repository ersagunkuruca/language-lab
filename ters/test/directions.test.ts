// A relation's other direction given by a definition of its own (POLAR.md
// step 2, BACKLOG L97b): polar(length, angle) → x, y, and unpolar marked as
// its direction for x, y → length, angle. A solve of polar given x and y
// is then unpolar's one answer instead of a search, evaluated and compiled
// the same, and the program still reads as polar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Code, NodeOf } from "../src/model.ts";
import { SHAPE, toTodaysShape } from "../src/model.ts";
import type { Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { bool, runMain, type Value } from "../src/lang/run.ts";
import { relate } from "../src/lang/relate.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program(direction = true, ports = 4) {
  const k = new Lang();
  const polar = k.def("polar");
  k.define(polar, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(k.equal(x, k.call(B.mul, r, k.call(B.cos, t))), k.equal(y, k.call(B.mul, r, k.call(B.sin, t))))));
  k.results(polar, "x", "y");
  const unpolar = k.def("unpolar");
  const names = ["length", "angle", "x", "y"].slice(0, ports);
  k.define(unpolar, k.fn(names, (r, t, x, y) => k.and(k.equal(r, k.call(B.sqrt, k.call(B.add, k.call(B.mul, x ?? r, x ?? r), k.call(B.mul, y ?? t, y ?? t)))), k.equal(t, k.call(B.atan2, y ?? t, x ?? r)))));
  if (ports === 4) k.results(unpolar, "length", "angle"); else k.results(unpolar, "length");
  if (direction) k.direction(unpolar, polar);
  const [, , x, y] = (k.code.nodes[(k.code.nodes[polar] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const [r, t] = (k.code.nodes[(k.code.nodes[polar] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const main = k.def("main");
  k.define(main, k.thunk(() => k.solve(polar, { [x]: k.lit(0), [y]: k.lit(2), out: k.true }, { [r]: "length", [t]: "angle" }, ({ [r]: rv, [t]: tv }) => k.text(k.call(SHOW_ANY, rv), k.lit(" "), k.call(SHOW_ANY, tv)))));
  const code: Code = base(k.code), nm = baseNames(k.names);
  const info = infer(code, nm);
  const pres: Presentation = { names: nm, comments: {}, hints: {}, style: blocksStyle as unknown as Style };
  return { code, names: nm, info, polar, unpolar, main, text: (d: string) => renderBlocks(code, pres, info, d) };
}

test("a solve that a direction answers is that direction: one answer, no Choice, and it still reads as polar", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(showType(p.info.typeOf.get(p.main)!, p.names), "() -> Text");
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), "2 1.570796327");
  // The use gives its ports as a tuple (L211i), read by the ports' names.
  assert.match(p.text(p.main), /tuple2 = polar\(x = 0, y = 2\)\n.*show\(tuple2\.length\) \+\+ " " \+\+ show\(tuple2\.angle\)/);
});

test("without the direction the same solve is the search, with its Choice", () => {
  const p = program(false);
  assert.match(showType(p.info.typeOf.get(p.main)!, p.names), /Choice/);
});

test("the direction is compiled the same as it's evaluated", async () => {
  const p = program();
  const path = join(mkdtempSync(join(tmpdir(), "directions-")), "directions.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, "2 1.570796327");
});

test("a direction has the relation's ports, in order", () => {
  const p = program(true, 3);
  assert.deepEqual(p.info.errors.filter((e) => e.id === p.unpolar).map((e) => e.message), ["unpolar is a direction of polar, so it has polar's 4 ports, in order"]);
});

// The law a direction promises (SPEC §7.6, S14, L201): each answer it
// gives holds for the relation. It may give fewer answers than the search
// (unpolar gives the principal angle and a length ≥ 0, the search every
// angle 2π apart and the negative lengths too), answer where the search
// finds nothing (x = 0, where the search divides by cos t), and pick a
// different first: at (−2, 0.5) the search's first has length −2.06,
// unpolar's +2.06. The direction's first is the canonical answer in its
// direction.
function lawBroken(code: Code, relation: string, direction: string, given: Record<string, number>, ports: string[]): string | null {
  const paramsOf = (d: string) => (code.nodes[(code.nodes[d] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const rel = paramsOf(relation), dir = paramsOf(direction);
  const at = (ps: string[], vs: Record<string, number>) => Object.fromEntries(ports.flatMap((n, i) => (n in vs ? [[ps[i], vs[n]]] : [])));
  const take = <T,>(it: Iterable<T>, n: number) => { const out: T[] = []; for (const x of it) if (out.push(x) >= n) break; return out; };
  const found = ports.filter((n) => !(n in given));
  const read = (ps: string[], a: { values: Record<string, unknown> }) => Object.fromEntries(found.map((n) => [n, a.values[ps[ports.indexOf(n)]] as number]));
  const mine = take(relate(code, direction, { ...at(dir, given), out: bool(true) } as Record<string, Value>), 4).map((a) => read(dir, a));
  if (!mine.length) return "the direction gave no answer";
  // Holding is read within a tolerance, as the solver checks an answer it
  // found: `equal` is exact (L197), and 5 · cos(atan2(−4, 3)) is
  // 3.0000000000000004. So the relation is run from the found ports, and
  // must give back the given ones.
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(b));
  const back = (ps: string[], a: { values: Record<string, unknown> }) => Object.keys(given).every((n) => close(a.values[ps[ports.indexOf(n)]] as number, given[n]));
  for (const m of mine)
    if (!take(relate(code, relation, { ...at(rel, m), out: bool(true) } as Record<string, Value>), 4).some((a) => back(rel, a))) return `${JSON.stringify(m)} doesn't hold for the relation`;
  return null;
}

test("a direction keeps the law: each answer it gives holds for the relation (SPEC §7.6, L201)", () => {
  const p = program();
  const ports = ["length", "angle", "x", "y"];
  for (const [x, y] of [[3, -4], [1, 1], [-2, 0.5], [0, 2], [-1, -1e-3]]) assert.equal(lawBroken(p.code, p.polar, p.unpolar, { x, y }, ports), null, `at x = ${x}, y = ${y}`);
  // A direction that gives a different answer is caught: the angle off by π.
  const k = new Lang();
  const polar = k.def("polar");
  k.define(polar, k.fn(ports, (r, t, x, y) => k.and(k.equal(x, k.call(B.mul, r, k.call(B.cos, t))), k.equal(y, k.call(B.mul, r, k.call(B.sin, t))))));
  k.results(polar, "x", "y");
  const wrong = k.def("wrong unpolar");
  k.define(wrong, k.fn(ports, (r, t, x, y) => k.and(k.equal(r, k.call(B.sqrt, k.call(B.add, k.call(B.mul, x, x), k.call(B.mul, y, y)))), k.equal(t, k.call(B.add, k.call(B.atan2, y, x), k.lit(Math.PI))))));
  k.results(wrong, "length", "angle");
  k.direction(wrong, polar);
  assert.match(lawBroken(base(k.code), polar, wrong, { x: 3, y: -4 }, ports) ?? "", /doesn't hold/);
});

// L182c2: a direction is a way of its relation; a program saved with the
// old `direction` attribute loads with it as a way.
test("a saved direction loads as a way of its relation (L182c2)", () => {
  const nodes: Record<string, unknown> = { d: { id: "d", kind: "def", body: "b", direction: "r" } };
  toTodaysShape(nodes, SHAPE - 1);
  assert.deepEqual(nodes.d, { id: "d", kind: "def", body: "b", way: "r" });
});
