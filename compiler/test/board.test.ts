// board (compiler/gaps/board), GAPS.md round 8's program, a page written
// in the editor: the evaluator, the compiled page and the hand-written
// ideal must draw the same page at the start and after every phase of the
// same session (cards added, moved, pointed, renamed, filtered, searched,
// undone and redone, a focus timer run for frames, saved, loaded, picked,
// deleted).

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, session, ways } from "../gaps/board.ts";

const w = await ways();
const phases = ["start", ...session(1).map(([n]) => n)];

for (const n of [0, 12]) test(`board: the three agree on a session with ${n} cards added`, () => {
  const want = run(w.ideal, n).pages;
  for (const way of ["evaluator", "compiled"] as const) {
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
