// The nested to-do outline (BACKLOG L100, STABLE-REFERENCES.md "The
// demo"): plain Item data with keys, changed only by edits at a path, so a
// click runs one item's row and the count, however long the outline is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Cells } from "../src/lang/cells.ts";
import { outlineProgram } from "../src/lang/cells-programs.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { equal, runMain } from "../src/lang/run.ts";
import { evaluatorCall, mountHtml } from "../src/lang/html.ts";
import { fakeDoc, FakeEl, FakeText } from "./fakedom.ts";

function leaves(n: FakeEl | FakeText): string[] {
  if (n instanceof FakeText) return n.textContent ? [n.textContent] : [];
  if (n.tag === "button") return [];
  return n.kids.flatMap(leaves);
}

function page() {
  const p = outlineProgram();
  const code = base(p.code), names = baseNames(p.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const cells = new Cells(equal);
  const value = runMain(code, info, p.main, { print: () => {}, names, cells });
  // What the page says it drew again, as a page flashes it.
  const ran: string[] = [];
  const root = mountHtml(value, { cells, doc: fakeDoc(), call: evaluatorCall, ran: (n) => ran.push(leaves(n as FakeEl | FakeText).join(" | ")) }) as FakeEl;
  const all = (e: FakeEl): FakeEl[] => [e, ...e.kids.flatMap((x) => (x instanceof FakeEl ? all(x) : []))];
  // The row of the item with this title: its buttons follow its text.
  const button = (title: string, label: string) => {
    const rows = all(root).filter((e) => e.attrs.get("class") === "ui-row" && e.kids.some((x) => x instanceof FakeEl && x.textContent?.endsWith(title)));
    return all(rows[0]).find((e) => e.tag === "button" && e.textContent === label)!;
  };
  const lines = () => leaves(root);
  return { cells, root, ran, button, lines, all: () => all(root) };
}

test("the outline draws every item at its depth, and the count reads 2 of 7 done", () => {
  const p = page();
  assert.deepEqual(p.lines(), ["○ plan the trip", "✓ book the train", "○ find a room", "○ ask Ana", "✓ water the plants", "○ write the report", "○ draft", "2 of 7 done"]);
});

test("ticking a step three deep runs its line and the count, and makes no row", () => {
  const p = page();
  const runs = p.cells.runs, rows = p.cells.rowsMade;
  p.button("ask Ana", "tick").fire("click");
  assert.deepEqual(p.lines(), ["○ plan the trip", "✓ book the train", "○ find a room", "✓ ask Ana", "✓ water the plants", "○ write the report", "○ draft", "3 of 7 done"]);
  assert.equal(p.cells.rowsMade - rows, 0, "the row reads its item through a view (L99): its line runs, nothing is made");
  // However deep, a tick runs about the same: its line, the count and the list.
  const ran = p.cells.runs - runs;
  assert.ok(ran <= 10, `${ran} formulas and watchers ran`);
  const runs2 = p.cells.runs;
  p.button("water the plants", "tick").fire("click");
  assert.equal(p.cells.runs - runs2, ran);
  assert.equal(p.lines().at(-1), "2 of 7 done");
  // The buttons read the item as it is now: ticking again unticks.
  p.button("ask Ana", "tick").fire("click");
  assert.equal(p.lines()[3], "○ ask Ana");
});

test("adding, moving and removing items: one row made, moved or dropped, keys keeping each item's buttons on it", () => {
  const p = page();
  let rows = p.cells.rowsMade;
  const entry = p.all().find((e) => e.tag === "input")!;
  entry.type_("call the bank");
  entry.fire("keydown", { key: "Enter" });
  assert.equal(p.lines().at(-2), "○ call the bank");
  assert.equal(p.lines().at(-1), "2 of 8 done");
  assert.equal(p.cells.rowsMade - rows, 1, "one new row, the others kept");
  rows = p.cells.rowsMade;
  p.button("call the bank", "up").fire("click");
  assert.deepEqual(p.lines().slice(4, 7), ["✓ water the plants", "○ call the bank", "○ write the report"]);
  assert.equal(p.cells.rowsMade - rows, 0, "a move makes no row");
  // The moved item's buttons still act on it: found by its key, not its place.
  p.button("call the bank", "tick").fire("click");
  assert.equal(p.lines()[5], "✓ call the bank");
  p.button("find a room", "add a step").fire("click");
  assert.deepEqual(p.lines().slice(2, 5), ["○ find a room", "○ ask Ana", "○ new step"]);
  rows = p.cells.rowsMade;
  p.button("plan the trip", "remove").fire("click");
  assert.equal(p.lines()[0], "✓ water the plants");
  assert.equal(p.cells.rowsMade - rows, 0);
  assert.equal(p.lines().at(-1), "2 of 4 done");
});

test("a page shows only what changed: one line for a tick at any depth, nothing for a move", () => {
  const p = page();
  p.button("water the plants", "tick").fire("click");
  assert.deepEqual(p.ran, ["○ water the plants", "1 of 7 done"]);
  p.ran.length = 0;
  p.button("write the report", "up").fire("click");
  assert.deepEqual(p.ran, [], "a move draws no row, and the count it ran again is the same");
  p.ran.length = 0;
  p.button("ask Ana", "tick").fire("click");
  assert.deepEqual(p.ran, ["✓ ask Ana", "2 of 7 done"]);
});
