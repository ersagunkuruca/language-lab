// T18g: edit sequences through the MCP tools keep their laws (edit-sequences.ts).
// EDIT_SEQ='[["sort", 3]]' runs other examples and seeds; EDIT_STEPS=n
// makes each sequence n steps (default 16).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLaws, run, show, shrunk, startOf, steps, type Op } from "./edit-sequences.ts";

const RUNS: [string, number][] = process.env.EDIT_SEQ ? JSON.parse(process.env.EDIT_SEQ) : [["collatz", 1], ["sort", 2], ["wc", 3]];
const STEPS = Number(process.env.EDIT_STEPS ?? 16);
// Sequences a run cut down, kept until the row that fixes them is done:
// each runs as a todo naming its row.
const KEPT: { example: string; steps: string; row: string }[] = [
  // buffer seed 14, 30 steps: `match k` made `match 0` in `edited` gives it
  // Diverge; the session's check says nothing, the program read back from
  // its files says `final` performs it.
  { example: "buffer", steps: "literal 425 510, literal 425 931", row: "I387" },
];

for (const [example, seed] of RUNS) test(`${example}: edit sequences keep their laws, and merge as files should (T18g, seed ${seed})`, () => {
  const ours = steps(seed, STEPS), theirs = steps(seed + 1000, STEPS);
  const a = run(example, ours), b = run(example, theirs);
  for (const [seq, r] of [[ours, a], [theirs, b]] as const) if (r.broken) {
    const cut = shrunk(example, seq, r.broken.law);
    assert.fail(`${example}, seed ${seed}: ${r.broken.text}\n  cut down to ${cut.length} steps: ${cut.map(show).join(", ")}`);
  }
  assert.ok(a.kept + b.kept > 0, "some steps were made");
  assert.deepEqual(mergeLaws(startOf(example), a.saved, b.saved), []);
  console.log(`${example} seed ${seed}: ${a.kept} and ${b.kept} of ${STEPS} steps made`);
});

for (const k of KEPT) test(`${k.example}: ${k.steps} keeps the laws (T18g)`, { todo: `kept until ${k.row}` }, () => {
  const seq = k.steps.split(", ").map((x) => { const [op, a, b] = x.split(" "); return { op: op as Op, a: Number(a), b: Number(b) }; });
  assert.equal(run(k.example, seq).broken?.text ?? null, null);
});
