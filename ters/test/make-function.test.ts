import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { definitionFrom, infer, liftToDefinition, makeFunction } from "../../editor/typed.ts";

// A group made into a function called where it was (BACKLOG E146): physics
// fall's drop = 0.5 · gravity · time · time, its three · grouped, becomes
// part = (gravity, time) => 0.5 · gravity · time · time, called with what
// came in; the same variable wired in twice is one input, and a literal
// stays in.
test("a group of one value out becomes a function called in its place", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  const { code } = p, names = p.pres.names, fall = p.named("fall");
  const info = infer(code, names);
  const was = renderLet(code, p.pres, fall);
  const muls = subtree(code, fall).map((id) => code.nodes[id]).filter((n): n is NodeOf<"call"> => n.kind === "call" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "multiply");
  const drop = muls.filter((m) => m.args.some((a) => muls.some((x) => x.id === a)) || muls.some((x) => x.args.includes(m.id)));
  assert.equal(drop.length, 3, was);
  const r = makeFunction(code, names, info, fall, drop.map((m) => m.id));
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const text = renderLet(r.code, { ...p.pres, names: r.names }, fall);
  assert.match(text, /part = \(gravity, time\) => 0\.5 · gravity · time · time/);
  assert.match(text, /drop = part\(gravity, time\)/);
  assert.deepEqual(infer(r.code, r.names).errors, []);
});

// Several values out (BACKLOG E149, E165): HSI colour's r and g, grouped,
// leave part as one tuple (L128a), and each is read where it was by its
// place: no type of its own is made.
test("a group of several values out gives them back as a tuple", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names, hsi = p.named("hsi colour");
  const info = infer(code, names);
  const valueOf = (n: string) => {
    const l = subtree(code, hsi).map((id) => code.nodes[id]).find((x) => x.kind === "call" && code.nodes[x.fn]?.kind === "lambda" && (code.nodes[x.fn] as NodeOf<"lambda">).params.some((b) => names[b] === n)) as NodeOf<"call">;
    return subtree(code, l.args[0]).filter((x) => code.nodes[x].kind === "call");
  };
  const r = makeFunction(code, names, info, hsi, [...valueOf("r"), ...valueOf("g")]);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const text = renderLet(r.code, { ...p.pres, names: r.names }, hsi);
  assert.match(text, /part = \(saturation, hue\) => tuple\(1 \+ 2 · saturation · cos\(6\.283185307179586 · \(hue − 0\)\), 1 \+ 2 · saturation · cos\(6\.283185307179586 · \(hue − 0\.3333333333333333\)\)\)/);
  assert.match(text, /results = part\(saturation, hue\)\n\s+r = first\(results\)\n\s+g = second\(results\)/);
  assert.equal(r.code.defs.length, code.defs.length);
  assert.deepEqual(infer(r.code, r.names).errors, []);
  // Its results are named for where the values went (L128b, E165b), so the
  // graph draws a port each and reads first(results) as .r.
  const lam = Object.values(r.code.nodes).find((n): n is NodeOf<"lambda"> => n.kind === "lambda" && !!n.results?.length);
  assert.deepEqual(lam?.results?.map((b) => r.names[b]), ["r", "g"]);
});

// Make it a definition (BACKLOG E164): physics fall's drop, made a
// function, then that function lifted to a definition of its own in the
// side menu. It uses nothing from around it, so where it was is its name.
test("a group made a definition is in the side menu and called where it was", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  const { code } = p, names = p.pres.names, fall = p.named("fall");
  const info = infer(code, names);
  const muls = subtree(code, fall).map((id) => code.nodes[id]).filter((n): n is NodeOf<"call"> => n.kind === "call" && names[(code.nodes[n.fn] as NodeOf<"ref">).target] === "multiply");
  const drop = muls.filter((m) => m.args.some((a) => muls.some((x) => x.id === a)) || muls.some((x) => x.args.includes(m.id)));
  const r = definitionFrom(code, names, info, fall, drop.map((m) => m.id));
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  assert.equal(r.code.defs.length, code.defs.length + 1);
  assert.equal(r.code.defs[r.code.defs.indexOf(fall) + 1], r.def);
  assert.equal(r.names[r.def!], "part");
  const text = renderLet(r.code, { ...p.pres, names: r.names }, fall);
  assert.match(text, /drop = part\(gravity, time\)/);
  assert.match(renderLet(r.code, { ...p.pres, names: r.names }, r.def!), /^part\(gravity, time\):/);
  assert.deepEqual(infer(r.code, r.names).errors, []);
});

// A function that uses a value from around it takes it as its first input
// (lambda lifting): a function inside a definition, (x) => x + k with k a
// variable of the definition, becomes k_x = (k, x) => x + k, and where it
// was, (x) => part(k, x).
test("a function using what's around it takes that first when lifted", () => {
  const p = loadProgram(join(root, "examples", "mandelbrot"));
  const { code } = p, names = p.pres.names;
  const info = infer(code, names);
  // Every function inside a definition that isn't the definition itself.
  let lifted = 0;
  for (const d of code.defs.filter((x) => code.nodes[x]?.kind === "def")) {
    const body = (code.nodes[d] as NodeOf<"def">).body;
    for (const l of subtree(code, d).filter((x) => x !== body && code.nodes[x].kind === "lambda")) {
      const r = liftToDefinition(code, names, info, d, l);
      if (!r.ok) continue;
      lifted++;
      assert.deepEqual(infer(r.code, r.names).errors, [], `${names[d]}: ${r.note}`);
    }
  }
  assert.ok(lifted > 0);
});

// A value given to a solve (BACKLOG I123): Relations' square roots gives y
// to a relation run backwards. Making a function of it threw "has no
// parent": a solve's given values weren't children to parentOf.
test("a value given to a solve can be made a function", () => {
  const p = loadProgram(join(root, "examples", "relations"));
  const { code } = p, names = p.pres.names, d = p.named("square roots");
  const info = infer(code, names);
  const y = subtree(code, d).find((id) => { const n = code.nodes[id]; return n.kind === "ref" && names[n.target] === "y"; })!;
  const r = makeFunction(code, names, info, d, [y]);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (r.ok) assert.deepEqual(infer(r.code, r.names).errors, []);
});
