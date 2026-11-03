// L99: compiled each hands its rows tracked views, as the evaluator's does
// (cells.ts `view`, STABLE-REFERENCES.md §2), so on the compiled outline a
// tick three deep runs its line and the count and makes no row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Cells } from "../../ters/src/lang/cells.ts";
import { outlineProgram } from "../../ters/src/lang/cells-programs.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { compiledCall, mountHtml } from "../../ters/src/lang/html.ts";
import { FakeEl, FakeText, fakeDoc } from "../../ters/test/fakedom.ts";
import { compile } from "../src/compile.ts";
import { $eq, $setCells } from "../src/runtime.js";

const leaves = (n: FakeEl | FakeText): string[] => n instanceof FakeText ? (n.textContent ? [n.textContent] : []) : n.tag === "button" || n.tag === "style" ? [] : n.kids.flatMap(leaves);
const all = (e: FakeEl): FakeEl[] => [e, ...e.kids.flatMap((x) => (x instanceof FakeEl ? all(x) : []))];

test("compiled outline: ticking a step three deep makes no row and runs about ten formulas and watchers", async () => {
  const p = outlineProgram();
  const code = base(p.code), names = baseNames(p.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const dir = mkdtempSync(join(tmpdir(), "outline-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  const mainName = names[p.main];
  writeFileSync(join(dir, "outline.js"), compile(code, info, names, { runtime, exports: [mainName] }));
  const main = (await import(pathToFileURL(join(dir, "outline.js")).href)).defs[mainName] as () => unknown;
  const cells = new Cells($eq);
  $setCells(cells);
  const root = mountHtml(main() as never, { cells, doc: fakeDoc(), call: compiledCall }) as FakeEl;
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
