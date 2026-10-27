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
  // Two values out (drift's · and drop's): refused, saying why.
  const two = makeFunction(code, names, info, fall, [drop[0].id, muls.find((m) => !drop.includes(m))!.id]);
  assert.equal(two.ok, false);
  if (!two.ok) assert.match(two.reason, /2 values leave the group/);
});
