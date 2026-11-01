// ledger (ters/examples/ledger), GAPS.md round 3's program, built
// in the editor by clicks: the evaluator, the compiled code and the
// hand-written ideal must print the same and exit the same way, failures
// included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { book, ways } from "../gaps/ledger.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>) => {
  const want = w.ideal(args, files);
  assert.deepEqual(w.compiled(args, files), want);
  assert.deepEqual(w.evaluator(args, files), want);
  return want;
};

test("ledger: a small file, by account and by month", () => {
  const r = all(["l.csv"], { "l.csv": "# a comment\n2026-09-01,salary,350000,pay\n2026-09-02,rent,-120000,flat\n\n2026-10-03,coffee,-450,beans\n2026-10-07,coffee,-5,gum\n" });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out[0].split("\n"), [
    "By account",
    "salary             3500.00 × 1",
    "coffee               -4.55 × 2",
    "rent              -1200.00 × 1",
    "",
    "By month",
    "2026-09            2300.00 × 2",
    "2026-10              -4.55 × 2",
    "",
    "smallest: -1200.00 on 2026-09-02, flat",
    "total: 2295.45 in 4 entries",
  ]);
});

test("ledger: a generated year of 2000 entries", () => {
  const r = all(["l.csv"], { "l.csv": book(2000) });
  assert.equal(r.code, 0);
  assert.match(r.out[0], /in 2000 entries$/);
});

test("ledger: what goes wrong, and the exit codes", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: ledger file.csv"], code: 2 });
  assert.deepEqual(all(["nope.csv"], {}), { out: [], err: ["ledger: no such file or folder: nope.csv"], code: 1 });
  assert.deepEqual(all(["l.csv"], { "l.csv": "\n# only a comment\n" }).err, ["ledger: l.csv has no entries"]);
  assert.deepEqual(all(["l.csv"], { "l.csv": "2026-01-01,a,1,x\n2026-01-02,b,2\n" }).err, ["ledger: line 2: expected date,account,cents,memo"]);
  assert.deepEqual(all(["l.csv"], { "l.csv": "2026-01-01,a,1,x,y\n" }).err, ["ledger: line 1: expected date,account,cents,memo"]);
  assert.deepEqual(all(["l.csv"], { "l.csv": "\n2026-01-01,a,1.5,x\n" }).err, ["ledger: line 2: the amount isn't a whole number of cents"]);
});
