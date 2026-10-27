import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { type NodeOf } from "../src/model.ts";
import { fillings } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { fill, infer, toHole, wrapInto } from "../editor/typed.ts";

// Wrap in… (BACKLOG E135): the part becomes a hole, the palette fills it,
// and the part goes back in as the first input where it type-checks; where
// a function of nothing goes, as () => it.
test("wrap in puts the part inside the call picked, as a thunk where one goes", () => {
  const p = loadProgram(join(root, "examples", "queens"));
  const { code } = p, names = p.pres.names, main = p.named("main");
  const callee = (n: NodeOf<"call">) => names[(code.nodes[n.fn] as NodeOf<"ref">).target];
  const count = Object.values(code.nodes).find((n) => n.kind === "call" && callee(n) === "count") as NodeOf<"call">;
  const before = infer(code, names);
  const holed = toHole(code, names, before, count.id);
  assert.ok(holed.ok);
  if (!holed.ok) return;
  const offers = fillings(holed.code, infer(holed.code, names), count.id);
  const first = offers.find((f) => f.kind === "call" && names[f.target] === "first")!;
  assert.ok(first, "first is offered there");
  const filled = fill(holed.code, names, infer(holed.code, names), count.id, first, "first", main);
  assert.ok(filled.ok);
  if (!filled.ok) return;
  const r = wrapInto(filled.code, filled.names, before, count.id, code);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.match(renderLet(r.code, { ...p.pres, names: r.names }, main), /first\(\(\) => count\(\(\) => queens\(8\)\), □/);
  // Nothing to put it in: refused.
  const lit = Object.values(code.nodes).find((n) => n.kind === "lit" && n.value === "all solutions for 6:")!;
  const h2 = toHole(code, names, before, lit.id);
  assert.ok(h2.ok);
  if (!h2.ok) return;
  const asText = fill(h2.code, names, infer(h2.code, names), lit.id, { kind: "lit", of: "string" } as never, "text", main);
  if (asText.ok) assert.equal(wrapInto(asText.code, asText.names, before, lit.id, code).ok, false);
});
