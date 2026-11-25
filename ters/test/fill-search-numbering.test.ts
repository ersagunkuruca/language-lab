// The palette's search of what fits a hole leaves the hole's check as it
// was (I362): an edit checked over that check (infer.ts inferEdited) takes
// its variables on from the check's count, so variables the search made
// in it afterwards were numbered like the edit's own, and one the search
// marked plain made the edit's fresh one plain. In the editor: a new
// definition's hole filled while the palette's search for it ran on, then
// Change the function on its + refused, "has functions in it, and only
// plain data can be used here".
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { fillings, infer, inferEdited } from "../src/lang/infer.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { derivedFrom, nodeIds, parentLookup, subtree, withNodes, type Code, type Id, type Node } from "../src/model.ts";


test("an edit checked over a hole's check after the palette searched it is checked as from scratch", () => {
  const p = loadProgram(join(root, "examples", "drift"));
  const names = p.pres.names, mine = new Set(p.own.defs);
  const code = p.code;
  const own = [...mine].flatMap((d) => subtree(code, d));
  // A call of + in the program's own code, and the definition's body it's in.
  const plus = own.map((id) => code.nodes[id]).find((n) => n.kind === "call" && (code.nodes[n.fn] as Node)?.kind === "ref" && (code.nodes[n.fn] as Node & { kind: "ref" }).target === "builtin.arith.add") as (Node & { kind: "call" }) | undefined;
  assert.ok(plus, "drift has a + of its own");
  const edit = (c: Code, n: Node): Code => { const next = { ...c, nodes: withNodes(c.nodes, { [n.id]: n }) }; derivedFrom(next, c, [n.id], true); return next; };
  // The + made a hole and checked whole; then filled back, checked over that.
  const holed = edit(code, { id: plus.id, kind: "hole" } as Node);
  const hi = infer(holed, names, undefined, checkOptions);
  const filled = edit(holed, plus);
  const fi = inferEdited(holed, filled, names, hi, checkOptions);
  assert.ok(fi, "the fill is checked over the hole's check");
  // The palette's search for the hole runs on after the fill's check.
  assert.ok(fillings(holed, hi, plus.id).length > 0);
  // Change the function: +'s function a hole, checked over the fill's check.
  const swapped = edit(filled, { id: plus.fn, kind: "hole" } as Node);
  const si = inferEdited(filled, swapped, names, fi, checkOptions);
  const whole = infer(swapped, names, undefined, checkOptions);
  assert.ok(si, "the swap is checked over the fill's check");
  assert.deepEqual(si.errors.map((e) => e.message), whole.errors.map((e) => e.message));
});
