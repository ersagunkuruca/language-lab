// `+` is one sum (L244, CONFUSING item 9): the solver's relation for add,
// subtract and negate is the balance a + b = total read for one port, and
// the editor's built-in panel shows it with each direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinRelation } from "../src/lang/equations.ts";
import { showEq } from "../../invertible/src/relation.js";
import { definitionOf } from "../../editor/define.ts";
import { B, prelude } from "../src/prelude.ts";

test("add, subtract and negate are one sum, each read for another port", () => {
  const eq = (op: string) => (builtinRelation(op).eqs as Parameters<typeof showEq>[0][]).map(showEq);
  assert.deepEqual([eq("add"), eq("sub"), eq("neg"), eq("mul")], [["0 + 1 = out"], ["out + 1 = 0"], ["0 + out = 0"], ["out = 0 · 1"]]);
  const sub = definitionOf(prelude, B.sub)!;
  assert.deepEqual(sub.equations, ["result + b = a"]);
  assert.deepEqual(sub.ways.map((w) => w.steps), [["result = a − b"], ["b = a − result"], ["a = result + b"]]);
  assert.deepEqual(definitionOf(prelude, B.neg)!.equations, ["x + result = 0"]);
});
