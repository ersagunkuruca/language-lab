// C264: a compiled cell holds data with a Bool in it (the greenhouse's
// gardener `carrying: Bool`): compiled code's Bool inside data is a
// boolean, the evaluator's a case, so a cell's operations turn the value
// the evaluator's way going in and back coming out (scalar.ts host,
// `:deep`, since L276 #2885). What's left, `each` and `each of` handing
// such data to a function of ours, is I331.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { Cells } from "../../ters/src/lang/cells.ts";
import { equal } from "../../ters/src/lang/run.ts";
import { BOOL, CELL_OPS, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { compiledDefs } from "../src/core-js.ts";

test("a cell holding data with a Bool in it compiles, and reads back what was written (C264)", () => {
  const k = new Lang(LIBRARY.code);
  const Gardener = k.type("Gardener", [], [["gardener", [["at", () => k.tref(BOOL)], ["carrying", () => k.tref(BOOL)]]]]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("c", k.call(CELL_OPS.cell, k.call(Gardener.v.gardener, k.true, k.false)), (c) => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(CELL_OPS.read, c))),
    k.call(CELL_OPS.write, c, k.call(Gardener.v.gardener, k.false, k.true)),
    k.call(S.print, k.call(SHOW_ANY, k.call(CELL_OPS.read, c))),
  ))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  const defs = compiledDefs(code, info, names, ["main"], { cells: new Cells(equal), print: (s: string) => lines.push(s) }) as Record<string, () => void>;
  defs.main();
  assert.deepEqual(lines, ["gardener(true, false)", "gardener(false, true)"]);
});
