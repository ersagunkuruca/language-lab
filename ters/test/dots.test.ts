import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import type { Code, Id } from "../src/model.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { capped, sweep } from "./helpers.ts";
import { addDot, dotHandles, isDot, removeDot, usesOf, useVar } from "../../editor/typed.ts";

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

for (const program of ["queens", "relations", "physics"]) test(`${program}: a dot on any wire keeps the program and its output, and comes off again`, () => {
  const p = load(program);
  const info = infer(p.code, p.pres.names);
  const main = p.named("main");
  const before = output(p.code, p.pres.names, main);
  let tried = 0;
  // Forty wires a change (T12), every one nightly; a dot is put on each.
  const wires = capped(sweep(p.own.defs.flatMap((d) => under(p.code, d).map((slot) => ({ d, slot })))), 40);
  const taking = wires.map((w) => ({ ...w, r: addDot(p.code, p.pres.names, info, w.d, w.slot) })).filter((w) => w.r.ok);
  assert.ok(taking.length > 3, `only ${taking.length} wires took a dot`);
  for (const { d, r } of taking) {
    if (!r.ok) continue;
    tried++;
    const dot = r.select!;
    assert.ok(isDot(r.code, d, dot));
    assert.equal(usesOf(r.code, dot).length, 1);
    const after = infer(r.code, r.names);
    assert.equal(after.errors.length, 0);
    assert.match(dotHandles(r.code, d, r.names)[dot], /^•\d+$/);
    // Running main is most of the time, so a sample where it's slow:
    // queens searches every board, and physics' main takes about 2.9 s
    // (T14l: 85 of 98 s on 29 dots, measured by stage), so one in eight;
    // relations' about 1.3 s (T14m: 28 of 37 s on 21 dots), one in four.
    const every = program === "queens" ? 40 : program === "physics" ? 8 : program === "relations" ? 4 : 1;
    if (tried % every === 1 % every) assert.deepEqual(output(r.code, r.names, main), before);
    const back = removeDot(r.code, r.names, after, d, dot);
    assert.ok(back.ok, back.ok ? "" : back.reason);
    assert.equal(Object.keys(back.code.nodes).length, Object.keys(p.code.nodes).length);
  }
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
      // Only dots of a known type, onto slots of that type (T14m: each
      // useVar checks the whole program, 100 ms, and most slots can't take it).
      const head = (id: Id) => { const t = i2.typeOf.get(id), z = t && i2.subst.zonk(t); return z?.t === "con" ? z.id : null; };
      const want = head(dot);
      if (want === null) continue;
      const other = under(r.code, d).find((s) => head(s) === want && !under(r.code, s).some((x) => usesOf(r.code, dot).includes(x)) && useVar(r.code, r.names, i2, d, dot, s).ok);
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

// Ersagun 2026-11-14 on Eight queens: a dot put on the wire into count, and
// that wire taken off, left a dot nothing read, its Remove greyed out, and
// queens(8) still in main. A dot no wire leaves goes, and its value lies
// loose; Remove the dot on one does the same.
test("taking off a dot's last wire sets its value loose, and the dot goes", async () => {
  const { unwire } = await import("../../editor/typed.ts");
  const p = load("queens");
  const info = infer(p.code, p.pres.names);
  const main = p.named("main");
  const slot = under(p.code, main).find((id) => { const n = p.code.nodes[id]; return n.kind === "call" && p.code.nodes[n.fn].kind === "ref" && p.pres.names[(p.code.nodes[n.fn] as { target: Id }).target] === "count"; });
  const into = (p.code.nodes[slot!] as { args: Id[] }).args[0];
  const dotted = addDot(p.code, p.pres.names, info, main, into);
  assert.ok(dotted.ok);
  const dot = dotted.select!;
  const use = usesOf(dotted.code, dot)[0];
  const off = unwire(dotted.code, dotted.names, infer(dotted.code, dotted.names), main, {}, {}, use);
  assert.ok(off.ok, off.ok ? "" : off.reason);
  assert.equal(off.code.nodes[use].kind, "hole");
  assert.ok(!isDot(off.code, main, dot), "the dot is gone");
  const parts = Object.keys(off.of ?? {});
  assert.equal(parts.length, 1, "its value lies loose");
  assert.equal(off.of![parts[0]], main);
  // Remove the dot on a dot no wire leaves sets its value loose too.
  const zero: Code = { ...dotted.code, nodes: { ...dotted.code.nodes, [use]: { id: use, kind: "hole" } } };
  const gone = removeDot(zero, dotted.names, infer(zero, dotted.names), main, dot, { of: {}, home: {} });
  assert.ok(gone.ok && !isDot(gone.code, main, dot) && Object.keys(gone.of ?? {}).length === 1, gone.ok ? "" : gone.reason);
  // With its one wire, Remove the dot puts the value back on it.
  assert.ok(removeDot(dotted.code, dotted.names, infer(dotted.code, dotted.names), main, dot).ok);
});
