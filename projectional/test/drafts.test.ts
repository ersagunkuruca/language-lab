// Loose parts (editor/drafts.ts): set loose, they're definitions of their
// own, well typed, taking the variables they used as inputs; on disk the
// program is the same as without them and they're kept apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Code, Id, NodeOf } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { S } from "../src/lang/std.ts";
import { join, looseOf, setLoose, split } from "../editor/drafts.ts";

// greet = (name) => "Hi " ++ (name ++ "!")
function greet(): { code: Code; names: Names } {
  const nodes: Code["nodes"] = {};
  nodes.name = { id: "name", kind: "binder" };
  nodes.f1 = { id: "f1", kind: "ref", target: S.concat };
  nodes.f2 = { id: "f2", kind: "ref", target: S.concat };
  nodes.hi = { id: "hi", kind: "lit", value: "Hi " };
  nodes.bang = { id: "bang", kind: "lit", value: "!" };
  nodes.use = { id: "use", kind: "ref", target: "name" };
  nodes.inner = { id: "inner", kind: "call", fn: "f2", args: ["use", "bang"] };
  nodes.outer = { id: "outer", kind: "call", fn: "f1", args: ["hi", "inner"] };
  nodes.lam = { id: "lam", kind: "lambda", params: ["name"], body: "outer" };
  nodes.greet = { id: "greet", kind: "def", body: "lam" };
  return { code: base({ nodes, defs: ["greet"] }), names: { greet: "greet", name: "name" } };
}

test("a part set loose is a definition of its own, taking the variables it used as inputs", () => {
  const { code, names } = greet();
  // Take name ++ "!" out of greet, leaving a hole where it was.
  const r = setLoose(code, {}, {}, "greet", "inner", ["name"]);
  const holed: Code = { ...r.code, nodes: { ...r.code.nodes, outer: { ...(r.code.nodes.outer as NodeOf<"call">), args: ["hi", "gap"] }, gap: { id: "gap", kind: "hole" } } };
  assert.deepEqual(looseOf(holed, r.of, "greet"), [r.def]);
  const lam = holed.nodes[(holed.nodes[r.def] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  assert.equal(lam.kind, "lambda", "it takes name as an input");
  assert.equal(r.home[lam.params[0]], "name", "an input that stands for greet's name");
  assert.equal((holed.nodes.use as NodeOf<"ref">).target, lam.params[0]);
  const info = infer(holed, baseNames(names));
  assert.deepEqual(info.errors.map((e) => e.message), [], "both are well typed");

  // On disk: greet as it is, and the loose part apart.
  const { code: disk, drafts } = split(holed, r.of, r.home);
  assert.ok(!disk.defs.includes(r.def) && !disk.nodes.inner && !disk.nodes[r.def]);
  assert.ok(disk.nodes.greet && disk.nodes.gap);
  assert.deepEqual(drafts.of, { [r.def]: "greet" });
  assert.equal(drafts.home[lam.params[0]], "name");
  const back = join(disk, drafts);
  assert.deepEqual(new Set(Object.keys(back.nodes)), new Set(Object.keys(holed.nodes)));
  assert.deepEqual(back.defs, holed.defs);
  // A loose part whose definition is gone goes too.
  const gone = join({ nodes: { ...disk.nodes }, defs: disk.defs.filter((d: Id) => d !== "greet") }, { ...drafts });
  assert.ok(!gone.defs.includes(r.def));
});

test("Delete takes out one node: what fed it lies loose, and wires back in", async () => {
  const T = await import("../editor/typed.ts");
  const { code, names } = greet();
  const info = infer(code, baseNames(names));
  // Delete the outer ++: "Hi " and name ++ "!" are left lying.
  const d = T.deleteOne(code, names, info, "greet", {}, {}, "outer");
  if (!d.ok) assert.fail(d.reason);
  assert.equal(d.code.nodes.outer.kind, "hole");
  const parts = looseOf(d.code, d.of!, "greet");
  assert.equal(parts.length, 2, "both inputs are kept");
  assert.equal(infer(d.code, baseNames(d.names)).errors.length, 0);
  const second = parts[1];
  const lam = d.code.nodes[(d.code.nodes[second] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  assert.equal(d.names[lam.params[0]], "name", "its input is called what it stands for");

  // Wired back into the hole, where name is in reach: name again, and loose no more.
  const w = T.wireLoose(d.code, d.names, infer(d.code, baseNames(d.names)), "greet", d.of!, d.home!, second, "outer");
  if (!w.ok) assert.fail(w.reason);
  assert.equal(looseOf(w.code, w.of!, "greet").length, 1);
  assert.equal(w.code.nodes.outer.kind, "call");
  assert.equal((w.code.nodes.use as NodeOf<"ref">).target, "name");
  assert.equal(infer(w.code, baseNames(w.names)).errors.length, 0);

  // Deleting a loose part throws it away.
  const gone = T.deleteOne(w.code, w.names, infer(w.code, baseNames(w.names)), "greet", w.of!, w.home!, parts[0]);
  if (!gone.ok) assert.fail(gone.reason);
  assert.deepEqual(looseOf(gone.code, gone.of!, "greet"), []);
  assert.ok(!gone.code.nodes.hi);
});

test("pulling a value off its input leaves the input a hole and the value loose", async () => {
  const T = await import("../editor/typed.ts");
  const { code, names } = greet();
  const u = T.unwire(code, names, infer(code, baseNames(names)), "greet", {}, {}, "inner");
  if (!u.ok) assert.fail(u.reason);
  assert.equal(u.code.nodes.inner.kind, "hole");
  const [part] = looseOf(u.code, u.of!, "greet");
  assert.ok(part);
  assert.equal(infer(u.code, baseNames(u.names)).errors.length, 0);
});

test("a drop on a filled input swaps the value in, and the one that was there lies loose", async () => {
  const T = await import("../editor/typed.ts");
  const { code, names } = greet();
  const info = infer(code, baseNames(names));
  // name, dropped on the input that has name ++ "!".
  const r = T.over(code, names, info, "greet", {}, {}, "inner", "name", (c, n, i) => T.useVar(c, n, i, "greet", "name", "inner"));
  if (!r.ok) assert.fail(r.reason);
  assert.equal((r.code.nodes.inner as NodeOf<"ref">).target, "name");
  const [part] = looseOf(r.code, r.of!, "greet");
  assert.ok(part, "the old value is kept");
  assert.equal(infer(r.code, baseNames(r.names)).errors.length, 0);
  // Dropping what is there already changes nothing.
  const again = T.over(r.code, r.names, infer(r.code, baseNames(r.names)), "greet", r.of!, r.home!, "use", "name", () => ({ ok: false, reason: "x" }));
  assert.equal(again.ok, false);
});
