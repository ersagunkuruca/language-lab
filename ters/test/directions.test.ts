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
import type { Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { runMain } from "../src/lang/run.ts";
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
  assert.match(p.text(p.main), /length, angle = polar\(x = 0, y = 2\)/);
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
