// A call turned around (BACKLOG E168): one input swaps sides with the
// result, the node becoming a solve; turned back it is the call again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { makeRunner } from "../src/lang/run.ts";
import { ARITH } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { NodeOf } from "../src/model.ts";
import { infer, turnAround, turnBack, turnable } from "../../editor/typed.ts";

const first = (v: unknown) => { if (v && typeof v === "object" && Symbol.iterator in v) for (const x of v as Iterable<unknown>) return x; return v; };

test("a call turned around works out its input from the result, and turns back", () => {
  const k = new Lang();
  // f(x) = 2·x + 1; main = f(4), turned on x: the x with f(x) = 4.
  const f = k.def("f");
  k.define(f, k.fn(["x"], (x) => k.call(ARITH.add, k.call(ARITH.mul, k.at(NUMBER, 2), k.x(x)), k.at(NUMBER, 1))));
  const main = k.def("main");
  const call = k.call(f, k.at(NUMBER, 4));
  k.define(main, call);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.ok(turnable(code, call));
  const r = turnAround(code, names, info, call, 0);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const s = r.code.nodes[call] as NodeOf<"solve">;
  assert.equal(s.kind, "solve");
  assert.deepEqual(Object.keys(s.binds), [(code.nodes[(code.nodes[f] as NodeOf<"def">).body!] as NodeOf<"lambda">).params[0]]);
  const after = infer(r.code, r.names);
  assert.equal(first(makeRunner(r.code, after, { print: () => {} }).value(main)), 1.5);
  // Back: the call again, giving f(4) = 9.
  const b = turnBack(r.code, r.names, after, call);
  assert.ok(b.ok, !b.ok ? b.reason : "");
  if (!b.ok) return;
  assert.equal(b.code.nodes[call].kind, "call");
  assert.equal(first(makeRunner(b.code, infer(b.code, b.names), { print: () => {} }).value(main)), 9);
  // A builtin's call has no body to turn.
  assert.equal(turnable(code, (code.nodes[(code.nodes[f] as NodeOf<"def">).body!] as NodeOf<"lambda">).body), null);
});

// QA-2026-11-01b F7 (BACKLOG I129): the turns that can't work say why in
// plain words, and the menu leaves out the ones the types rule out.
test("a turn that can't work says why", async () => {
  const { join } = await import("node:path");
  const { root } = await import("../src/io.ts");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { subtree } = await import("../src/model.ts");
  const { turnMismatch } = await import("../../editor/typed.ts");
  const callOf = (dir: string, def: string, fn: string) => {
    const p = loadProgram(join(root, "examples", dir));
    const names = p.pres.names, d = p.named(def);
    const c = subtree(p.code, d).map((x) => p.code.nodes[x]).find((n): n is NodeOf<"call"> => n.kind === "call" && names[(p.code.nodes[n.fn] as NodeOf<"ref">).target ?? ""] === fn)!;
    assert.ok(c, `${def} calls ${fn}`);
    return { code: p.code, names, info: infer(p.code, names), call: c.id };
  };
  // fall gives a Bool; distance is a Float64.
  const f = callOf("physics", "main", "fall");
  assert.match(turnMismatch(f.code, f.names, f.info, f.call, 0) ?? "", /^fall gives a Bool, and distance takes a Float64/);
  // split gives a pair; neither input is one.
  const s = callOf("relations", "main", "split");
  for (let k = 0; k < 2; k++) assert.match(turnMismatch(s.code, s.names, s.info, s.call, k) ?? "", /^split gives a Pair Float64 Float64, and \S+ takes a Float64/);
  // missing addend's body gives back neither input from its result.
  const m = callOf("relations", "main", "missing addend");
  const r = turnAround(m.code, m.names, m.info, m.call, 0);
  assert.equal(turnMismatch(m.code, m.names, m.info, m.call, 0), null);
  assert.match(r.ok ? "" : r.reason, /^missing addend can't work out known from its result: nothing in its body gives known back when the rest is given$/);
});
