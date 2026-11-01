import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { fillValue, infer } from "../../editor/typed.ts";

// What's typed in the palette reads as the blocks print it.

// A field, x.f (BACKLOG I113): Mandelbrot escape's z.re, cleared to a
// hole, takes "z.re" typed, and prints it back the same.
test("typed text reads a field as the blocks print it", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const re = subtree(code, escape).map((x) => code.nodes[x]).find((n): n is NodeOf<"call"> => n.kind === "call" && code.nodes[n.fn]?.kind === "ref" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "re" && code.nodes[(code.nodes[n.fn] as NodeOf<"ref">).target].kind === "field")!;
  assert.ok(re);
  const open = replace(code, re.id, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const r = fillValue(open, names, info, re.id, "z.re", escape);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.equal(renderLet(r.code, { ...p.pres, names: r.names }, escape), renderLet(code, p.pres, escape));
  // A field of something else in the sum, and one that isn't there.
  assert.ok(fillValue(open, names, info, re.id, "c.re + z.im", escape).ok);
  assert.equal(fillValue(open, names, info, re.id, "z.nope", escape).ok, false);
  // A number with a point is still a number.
  assert.ok(fillValue(open, names, info, re.id, "1.5", escape).ok);
});
