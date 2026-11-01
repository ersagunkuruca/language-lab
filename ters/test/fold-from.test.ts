import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderBlocks } from "../src/lang/render.ts";

const text = (program: string, def: string) => {
  const p = loadProgram(join(root, "examples", program));
  return renderBlocks(p.code, p.pres, infer(p.code, p.pres.names), p.named(def));
};

// A fold to a function, applied, reads as a fold with an accumulator
// (BACKLOG E62): queens' safe threads the distance to the row being placed.
test("a fold to a function, applied to a start, reads as a fold from that start", () => {
  const safe = text("queens", "safe");
  assert.match(safe, /^ {2}fold placed from distance = 1$/m);
  assert.match(safe, /^ {4}nil → true$/m);
  assert.match(safe, /^ {4}cons\(queen, others\) with ‹others safe› → .*‹others safe›\(distance \+ 1\)$/m);
  assert.doesNotMatch(safe, /apply|=>/);
  // Two accumulators read in brackets.
  assert.match(text("numbers", "fold Nat′"), /^ {2}fold n from \(from = zero′, r = ‹if zero›\(\)\)$/m);
});
