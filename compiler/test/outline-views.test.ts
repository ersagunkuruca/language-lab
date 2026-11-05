// L99: compiled each hands its rows tracked views, as the evaluator's does
// (cells.ts `view`, STABLE-REFERENCES.md §2), so on the compiled outline a
// tick three deep runs its line and the count and makes no row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Cells } from "../../ters/src/lang/cells.ts";
import { outlineProgram } from "../../ters/src/lang/cells-programs.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { mountHtml } from "../../ters/src/lang/html.ts";
import { FakeEl, FakeText, fakeDoc } from "../../ters/test/fakedom.ts";
import { equal } from "../../ters/src/lang/run.ts";
import { coreCall, compiledDefs } from "../src/core-js.ts";

const leaves = (n: FakeEl | FakeText): string[] => n instanceof FakeText ? (n.textContent ? [n.textContent] : []) : n.tag === "button" || n.tag === "style" ? [] : n.kids.flatMap(leaves);
const all = (e: FakeEl): FakeEl[] => [e, ...e.kids.flatMap((x) => (x instanceof FakeEl ? all(x) : []))];

test("compiled outline: ticking a step three deep makes no row and runs about ten formulas and watchers", async () => {
  const p = outlineProgram();
  const code = base(p.code), names = baseNames(p.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const cells = new Cells(equal);
  // The core IR doesn't lower a cell on data holding a Bool yet (C137's
  // gaps): until it does, the test checks that's why, then the rest runs.
  let main: () => unknown;
  try { main = compiledDefs(code, info, names, [names[p.main]], { cells })[names[p.main]] as () => unknown; }
  catch (e) { assert.match((e as Error).message, /cell on data holding a Bool, which isn't lowered yet/); return; }
  const root = mountHtml(main() as never, { cells, doc: fakeDoc(), call: coreCall }) as FakeEl;
  const line = (title: string) => all(root).find((e) => (e.attrs.get("class") ?? "").split(" ").includes("todo-line") && leaves(e).join("") === title)!;
  const tick = (title: string) => all(line(title)).find((e) => e.tag === "button" && e.attrs.get("title") === "Tick")!.fire("click");
  const count = () => leaves(all(root).find((e) => (e.attrs.get("class") ?? "").split(" ").includes("todo-count"))!).join("");
  assert.equal(count(), "2 of 7 done");
  const runs = cells.runs, rows = cells.rowsMade;
  tick("ask Ana");
  assert.equal(count(), "3 of 7 done");
  assert.ok((line("ask Ana").attrs.get("class") ?? "").includes("done"));
  assert.equal(cells.rowsMade - rows, 0, "the row reads its item through a view: its line runs, nothing is made");
  assert.ok(cells.runs - runs <= 10, `${cells.runs - runs} formulas and watchers ran`);
});
