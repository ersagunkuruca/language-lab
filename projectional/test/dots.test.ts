import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Code, Id } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { addDot, dotHandles, isDot, removeDot, usesOf, useVar } from "../editor/typed.ts";

const load = (name: string) => loadProgram(join(root, "examples", name));
const output = (code: Code, names: Record<Id, string>, main: Id) => {
  const out: string[] = [];
  runMain(code, infer(code, names), main, { print: (s) => out.push(s) });
  return out;
};
// Every node under a def, in order.
const under = (code: Code, d: Id): Id[] => {
  const out: Id[] = [];
  const go = (id: Id) => {
    out.push(id);
    const n = code.nodes[id] as unknown as Record<string, unknown>;
    for (const k of ["fn", "body", "scrutinee", "otherwise"]) if (typeof n[k] === "string") go(n[k] as Id);
    for (const k of ["args", "arms"]) if (Array.isArray(n[k])) (n[k] as Id[]).forEach(go);
  };
  go(d);
  return out;
};

for (const program of ["queens", "relations"]) test(`${program}: a dot on any wire keeps the program and its output, and comes off again`, () => {
  const p = load(program);
  const info = infer(p.code, p.pres.names);
  const main = p.named("main");
  const before = output(p.code, p.pres.names, main);
  let tried = 0;
  for (const d of p.own.defs) {
    for (const slot of under(p.code, d)) {
      const r = addDot(p.code, p.pres.names, info, d, slot);
      if (!r.ok) continue;
      tried++;
      const dot = r.select!;
      assert.ok(isDot(r.code, d, dot));
      assert.equal(usesOf(r.code, dot).length, 1);
      const after = infer(r.code, r.names);
      assert.equal(after.errors.length, 0);
      assert.match(dotHandles(r.code, d, r.names)[dot], /^•\d+$/);
      // Running main searches every board, so a sample.
      if (program !== "queens" || tried % 40 === 1) assert.deepEqual(output(r.code, r.names, main), before);
      const back = removeDot(r.code, r.names, after, d, dot);
      assert.ok(back.ok, back.ok ? "" : back.reason);
      assert.equal(Object.keys(back.code.nodes).length, Object.keys(p.code.nodes).length);
    }
  }
  assert.ok(tried > 10, `only ${tried} wires took a dot`);
});

test("a dot shared by two inputs can't be removed until one goes", () => {
  const p = load("queens");
  const info = infer(p.code, p.pres.names);
  for (const d of p.own.defs) {
    for (const slot of under(p.code, d)) {
      const r = addDot(p.code, p.pres.names, info, d, slot);
      if (!r.ok) continue;
      const i2 = infer(r.code, r.names);
      const dot = r.select!;
      const other = under(r.code, d).find((s) => !under(r.code, s).some((x) => usesOf(r.code, dot).includes(x)) && useVar(r.code, r.names, i2, d, dot, s).ok);
      if (!other) continue;
      const shared = useVar(r.code, r.names, i2, d, dot, other);
      assert.ok(shared.ok);
      assert.equal(usesOf(shared.code, dot).length, 2);
      const no = removeDot(shared.code, shared.names, infer(shared.code, shared.names), d, dot);
      assert.equal(no.ok, false);
      return;
    }
  }
  assert.fail("no dot could be shared anywhere in queens");
});

test("holes and variables don't take dots", () => {
  const p = load("queens");
  const info = infer(p.code, p.pres.names);
  const d = p.named("main");
  const v = under(p.code, d).find((id) => { const n = p.code.nodes[id]; return n.kind === "ref" && p.code.nodes[n.target].kind === "binder"; });
  if (v) assert.equal(addDot(p.code, p.pres.names, info, d, v).ok, false);
});
