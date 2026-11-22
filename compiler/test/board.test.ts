// board (compiler/gaps/board), GAPS.md round 8's program, a page written
// in the editor: the evaluator, the core IR's page and the hand-written
// ideal must draw the same page at the start and after every phase of the
// same session (cards added, moved, pointed, renamed, filtered, searched,
// undone and redone, a focus timer run for frames, saved, loaded, picked,
// deleted).

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, session, ways } from "../gaps/board.ts";

const w = await ways();
const phases = ["start", ...session(1).map(([n]) => n)];

for (const n of [0, 12]) test(`board: the four agree on a session with ${n} cards added`, () => {
  const want = run(w.ideal, n).pages;
  for (const way of ["evaluator", "core"] as const) {
    const got = run(w[way], n).pages;
    got.forEach((p, i) => assert.equal(p, want[i], `${way}, after ${phases[i]}`));
  }
  // and what they agree on is right
  const end = want.at(-1)!;
  if (n === 12) {
    assert.match(want[phases.indexOf("add")], /To do · 14 cards · 35 pt/);
    assert.match(want[phases.indexOf("filter")], /Tagged #t3/);
    assert.match(want[phases.indexOf("focus")], /Focus: “[^”]+”, 24:57 left/);
    assert.match(want[phases.indexOf("save, load")], /Loaded 17 cards/);
  }
  assert.match(end, /<section class="history">/);
});

test("board on the core IR: its reads of the state wait on the places they use (C162b)", async () => {
  const { lowerCore, emitCoreJs } = await import("../src/core-js.ts");
  const { program } = await import("../gaps/board.ts");
  const { code, info, names, main } = program();
  const js = emitCoreJs(lowerCore(code, info, names, [main])).js;
  const reads = js.match(/R\.rt\("readPaths:[^"]*"/g) ?? [];
  // The progress bar, the tags, the counts and the history each read a few
  // places of the cards, not the whole state.
  assert.ok(reads.length >= 8, `${reads.length} reads followed`);
  assert.ok(reads.some((r) => r.includes("*/")), "a read of every card's field");
});

test("board on the core IR: a running frame runs no column again, the card's changed time put into the column that holds it (C162c)", async () => {
  const { lowerCore, emitCoreJs } = await import("../src/core-js.ts");
  const { program, ways, session } = await import("../gaps/board.ts");
  const { Cells } = await import("../../ters/src/lang/cells.ts");
  const { code, info, names, main } = program();
  const js = emitCoreJs(lowerCore(code, info, names, [main])).js;
  assert.ok((js.match(/R\.rt\("readPaths:[^"]*\|[^"]*"/g) ?? []).length >= 1, "a column keeps the cards it hands on");
  const w = await ways();
  const P = Cells.prototype as unknown as { recompute: (n: { label: string }) => void };
  const was = P.recompute, runs: string[] = [];
  let on = false;
  P.recompute = function (this: unknown, n: { label: string }) { if (on) runs.push(n.label); return was.call(this, n); };
  try {
    const root = w.core();
    for (const [name, act] of session(50)) {
      on = name === "focus";
      act(root);
      if (on) break;
    }
  } finally { P.recompute = was; }
  assert.ok(runs.length > 0, "the frames ran something");
  assert.equal(runs.filter((l) => l === "formula").length, 0, `formulas run in the frames: ${runs.join(" ")}`);
});

test("board on the core IR: a card added makes one row and puts only it on the page (C287)", async () => {
  const { all } = await import("../gaps/board.ts");
  const { Cells } = await import("../../ters/src/lang/cells.ts");
  const { FakeEl } = await import("../../ters/test/fakedom.ts");
  const root = w.core();
  const [add] = session(30);
  add[1](root);
  const list = all(root, "stage-todo")[0], first = all(list, "card")[0];
  // The rows each made, and the children the page put again all at once.
  const P = Cells.prototype as unknown as { recompute: (n: unknown) => void };
  const E = FakeEl.prototype as unknown as { replaceChildren: (...k: unknown[]) => void };
  const [was, put] = [P.recompute, E.replaceChildren];
  let rows = 0, most = 0;
  P.recompute = function (this: { rowsMade: number }, n: unknown) { const r = this.rowsMade; was.call(this, n); rows += this.rowsMade - r; };
  E.replaceChildren = function (this: unknown, ...k: unknown[]) { most = Math.max(most, k.length); put.apply(this, k); };
  try { session(5)[0][1](root); } finally { [P.recompute, E.replaceChildren] = [was, put]; }
  assert.equal(all(root, "stage-todo")[0], list, "the column is the same element");
  assert.equal(all(list, "card")[0], first, "and its first card the same row");
  assert.equal(all(list, "card").length, all(root, "card").filter((c) => all(list, "card").includes(c)).length);
  assert.ok(rows <= 5 * 2, `${rows} rows made for 5 cards`);
  assert.ok(most < 30, `children put again at once: ${most}`);
});
