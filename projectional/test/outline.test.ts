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
  if (n.tag === "button" || n.tag === "style") return [];
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
  const classOf = (e: FakeEl) => (e.attrs.get("class") ?? "").split(" ");
  const itemLines = () => all(root).filter((e) => classOf(e).includes("todo-line"));
  // The line of the item with this title, and its button with this name.
  const line = (title: string) => itemLines().find((e) => leaves(e).join("") === title)!;
  const button = (title: string, name: string) => all(line(title)).find((e) => e.tag === "button" && e.attrs.get("title") === name)!;
  // Each item as a person reads it, ticked or not, then the count.
  const lines = () => [
    ...itemLines().map((e) => (classOf(e).includes("done") ? "✓ " : "○ ") + leaves(e).join("")),
    leaves(all(root).find((e) => classOf(e).includes("todo-count"))!).join(""),
  ];
  // "Add a step" opens a field under the item; typing and Enter adds it.
  const addStep = (title: string, step: string) => {
    button(title, "Add a step").fire("click");
    const field = all(root).filter((e) => e.tag === "input").at(-1)!;
    assert.equal(field.attrs.get("placeholder"), "New step, then Enter");
    field.type_(step);
    field.fire("keydown", { key: "Enter" });
  };
  return { cells, root, ran, button, lines, addStep, all: () => all(root) };
}

test("the outline draws every item at its depth, and the count reads 2 of 7 done", () => {
  const p = page();
  assert.deepEqual(p.lines(), ["○ plan the trip", "✓ book the train", "○ find a room", "○ ask Ana", "✓ water the plants", "○ write the report", "○ draft", "2 of 7 done"]);
});

test("ticking a step three deep runs its line and the count, and makes no row", () => {
  const p = page();
  const runs = p.cells.runs, rows = p.cells.rowsMade;
  p.button("ask Ana", "Tick").fire("click");
  assert.deepEqual(p.lines(), ["○ plan the trip", "✓ book the train", "○ find a room", "✓ ask Ana", "✓ water the plants", "○ write the report", "○ draft", "3 of 7 done"]);
  assert.equal(p.cells.rowsMade - rows, 0, "the row reads its item through a view (L99): its line runs, nothing is made");
  // However deep, a tick runs about the same: its line, the count and the list.
  const ran = p.cells.runs - runs;
  assert.ok(ran <= 10, `${ran} formulas and watchers ran`);
  const runs2 = p.cells.runs;
  p.button("water the plants", "Tick").fire("click");
  assert.equal(p.cells.runs - runs2, ran);
  assert.equal(p.lines().at(-1), "2 of 7 done");
  // The buttons read the item as it is now: ticking again unticks.
  p.button("ask Ana", "Tick").fire("click");
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
  p.button("call the bank", "Move up").fire("click");
  assert.deepEqual(p.lines().slice(4, 7), ["✓ water the plants", "○ call the bank", "○ write the report"]);
  assert.equal(p.cells.rowsMade - rows, 0, "a move makes no row");
  // The moved item's buttons still act on it: found by its key, not its place.
  p.button("call the bank", "Tick").fire("click");
  assert.equal(p.lines()[5], "✓ call the bank");
  p.addStep("find a room", "new step");
  assert.deepEqual(p.lines().slice(2, 5), ["○ find a room", "○ ask Ana", "○ new step"]);
  rows = p.cells.rowsMade;
  p.button("plan the trip", "Remove").fire("click");
  assert.equal(p.lines()[0], "✓ water the plants");
  assert.equal(p.cells.rowsMade - rows, 0);
  assert.equal(p.lines().at(-1), "2 of 4 done");
});

// What a tick draws again: the count, the bar under it (no text of its
// own), and the item's line, whose class says it's done, in any order.
test("a page shows only what changed: one line for a tick at any depth, nothing for a move", () => {
  const p = page();
  p.button("water the plants", "Tick").fire("click");
  assert.deepEqual([...p.ran].sort(), ["", "1 of 7 done", "water the plants"]);
  p.ran.length = 0;
  p.button("write the report", "Move up").fire("click");
  assert.deepEqual(p.ran, [], "a move draws no row, and the count it ran again is the same");
  p.ran.length = 0;
  p.button("ask Ana", "Tick").fire("click");
  assert.deepEqual([...p.ran].sort(), ["", "2 of 7 done", "ask Ana"]);
});

// A step added, moved or removed makes, moves or drops its own row: the
// item it's under keeps its row and its line (each of, cells.ts).
test("a step added, moved or removed changes its own row only, at any depth, and keeps working after its item moves", () => {
  const p = page();
  let rows = p.cells.rowsMade;
  p.ran.length = 0;
  p.addStep("find a room", "call the host");
  assert.deepEqual(p.lines().slice(2, 5), ["○ find a room", "○ ask Ana", "○ call the host"]);
  assert.equal(p.cells.rowsMade - rows, 1, "one row, the new step's; plan the trip and find a room keep theirs");
  assert.ok(!p.ran.some((r) => r.includes("plan the trip") || r.includes("find a room")), `drawn again: ${JSON.stringify(p.ran)}`);
  rows = p.cells.rowsMade;
  p.button("call the host", "Move up").fire("click");
  assert.deepEqual(p.lines().slice(2, 5), ["○ find a room", "○ call the host", "○ ask Ana"]);
  assert.equal(p.cells.rowsMade - rows, 0, "a move makes no row");
  // Its item moves; the step's buttons still act on it, wherever it is now.
  p.button("water the plants", "Move up").fire("click");
  p.button("water the plants", "Move up").fire("click");
  assert.equal(p.lines()[0], "✓ water the plants");
  p.button("call the host", "Tick").fire("click");
  assert.deepEqual(p.lines().slice(3, 6), ["○ find a room", "✓ call the host", "○ ask Ana"]);
  assert.equal(p.lines().at(-1), "3 of 8 done");
  rows = p.cells.rowsMade;
  p.button("call the host", "Remove").fire("click");
  assert.deepEqual(p.lines().slice(3, 5), ["○ find a room", "○ ask Ana"]);
  assert.equal(p.cells.rowsMade - rows, 0);
  p.addStep("ask Ana", "send the dates");
  assert.deepEqual(p.lines().slice(4, 6), ["○ ask Ana", "○ send the dates"]);
  assert.equal(p.lines().at(-1), "2 of 8 done");
});
