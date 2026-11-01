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

// An if, as the blocks print a match on a Bool (BACKLOG I114): escape's
// whole body, cleared to a hole, takes its own text back, and an if inside
// a then or an else keeps its own then and else.
test("typed text reads if c then a else b", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const lam = code.nodes[(code.nodes[escape] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const open = replace(code, lam.body, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const r = fillValue(open, names, info, lam.body, "if 4 < z.re · z.re + z.im · z.im or 299 < steps then steps else escape(z · z + c, c, steps + 1)", escape);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  // The same program as before: the if is the match on a Bool it was.
  assert.equal(renderLet(r.code, { ...p.pres, names: r.names }, escape), renderLet(code, p.pres, escape));
  const nested = fillValue(open, names, info, lam.body, "if 299 < steps then steps else if 4 < z.re then 0 else steps + 1", escape);
  assert.ok(nested.ok, !nested.ok ? nested.reason : "");
  if (nested.ok) assert.match(renderLet(nested.code, { ...p.pres, names: nested.names }, escape), /match 299 < steps \{ true → steps; false → match 4 < re\(z\) \{ true → 0; false → steps \+ 1 \} \}/);
  // A then and an else that don't agree are refused.
  assert.equal(fillValue(open, names, info, lam.body, 'if 299 < steps then steps else "no"', escape).ok, false);
});

// What's wrong, not where (BACKLOG I115): a function, a field or a name
// that isn't there is named, with the nearest ones.
test("typed text that doesn't read says what's missing", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, escape = p.named("escape");
  const lam = code.nodes[(code.nodes[escape] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const open = replace(code, lam.body, () => ({ kind: "hole" }));
  const info = infer(open, names);
  const why = (text: string) => { const r = fillValue(open, names, info, lam.body, text, escape); return r.ok ? "" : r.reason; };
  assert.match(why("kep(steps)"), /^there.s no function named kep; did you mean .*keep/);
  assert.match(why("z.nope + 1"), /^there's no field named nope/);
  assert.match(why("stpes + 1"), /^nothing is named stpes here; did you mean steps\?/);
  assert.match(why("escape(z, c, stpes)"), /^nothing is named stpes here/);
});
