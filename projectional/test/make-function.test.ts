import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { subtree, type NodeOf } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { infer, makeFunction } from "../editor/typed.ts";

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
  assert.match(text, /part = \(gravity₂, time₂\) => 0\.5 · gravity₂ · time₂ · time₂/);
  assert.match(text, /drop = part\(gravity₁, time₁\)/);
  assert.deepEqual(infer(r.code, r.names).errors, []);
});

// Several values out (BACKLOG E149): HSI colour's r and g, grouped, leave
// part as a record, Part results, and each is read where it was.
test("a group of several values out gives them back as a record", () => {
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
  assert.match(text, /part = \(saturation₂, hue₂\) => ‹part results›\(1 \+ 2 · saturation₂ · cos\(6\.283185307179586 · \(hue₂ − 0\)\), 1 \+ 2 · saturation₂ · cos\(6\.283185307179586 · \(hue₂ − 0\.3333333333333333\)\)\)/);
  assert.match(text, /results = part\(saturation₁, hue₁\)\n\s+r₁ = r₂\(results\)\n\s+g₁ = g₂\(results\)/);
  assert.deepEqual(infer(r.code, r.names).errors, []);
});
