// sheet (ters/examples/sheet), GAPS.md round 7's program, written in the
// editor: the evaluator and the compiled code, as defined and as the
// chooser stores them, and the hand-written ideal must print the same,
// write the same report and exit the same way, failures included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { programs, sheetText, ways, type Name } from "../gaps/sheet.ts";
import { compile } from "../src/compile.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>) => {
  const want = w.ideal(args, files);
  const others: Name[] = ["evaluator", "evaluator, chosen", "compiled", "compiled, chosen"];
  for (const way of others) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const budget = readFileSync(join(import.meta.dirname, "../../ters/examples/sheet/budget.txt"), "utf8");

test("sheet: the budget, with a cycle, a division by zero and a formula that can't be read", () => {
  const r = all(["b.txt"], { "b.txt": budget });
  assert.equal(r.code, 1);
  assert.deepEqual(r.out, [
    "           A       B       C       D",
    "   1    1200   14400     750  #cycle",
    "   2     450    5400     820  #cycle",
    "   3     380    4560     676  #div/0",
    "   4    2030   24360    -670  #parse",
    "line 14: D1 is #cycle",
    "line 15: D2 is #cycle",
    "line 16: D3 is #div/0",
    "line 17: D4 is #parse",
  ]);
  assert.equal(r.wrote["b.txt.out"].split("\n")[9], "C2 = (MAX(A1:A3) - MIN(A1:A3)) → 820");
});

test("sheet: a made-up sheet, no arguments, a missing file, a line without =", () => {
  all(["s.txt"], { "s.txt": sheetText(20) });
  assert.equal(all([], {}).code, 2);
  assert.equal(all(["none.txt"], {}).code, 1);
  assert.equal(all(["x.txt"], { "x.txt": "A1 = 1\nA2 2\n" }).code, 1);
});

// C80: `width of`'s map (a lambda that makes no choice, inside `first`)
// was compiled as a search, a JS frame per item, and ran out of stack from
// about 6,000 cells. Its copy is plain now; 1,000 rows are 6,000 cells.
test("sheet: compiled, 1,000 rows (6,000 cells) print what the ideal prints", () => {
  const files = { "s.txt": sheetText(1000) };
  assert.deepEqual(w["compiled, chosen"](["s.txt"], files), w.ideal(["s.txt"], files));
});

// C82b: `classify` (a number or a word, or no answer) calls `uppercase`,
// whose row is open only so a caller's row can stand there. It was counted
// as a call that may choose, so classify, flush and tokens each took the
// rest of the search as a continuation, a closure per character. They are
// one-answer functions now, which return the answer or none.
test("sheet: the tokenizer, which has at most one answer, isn't compiled as a search (C82b)", () => {
  const { chosen } = programs();
  const source = compile(chosen.code, chosen.info, chosen.names, { exports: ["main"] });
  for (const f of ["tokens", "flush", "classify"]) {
    assert.doesNotMatch(source, new RegExp(`^function ${f}\\$k\\(`, "m"), f);
    assert.match(source, new RegExp(`^function ${f}\\(`, "m"), f);
  }
});
