// One world: what used to be a network is an ordinary function returning
// Bool. Each `equal` is a wire, `for some` names the wires inside, and the
// one interpreter that runs anything backwards (relate.ts) solves it from
// true for whichever ports are known.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyze } from "../../invertible/src/index.js";
import { hashDef } from "../src/hash.ts";
import { root } from "../src/io.ts";
import { get, replace, type Code, type Id } from "../src/model.ts";
import { relationFor } from "../src/lang/equations.ts";
import { infer } from "../src/lang/infer.ts";
import { base, loadProgram } from "../src/lang/load.ts";
import { reId } from "./helpers.ts";
import { relate, showTerm } from "../src/lang/relate.ts";
import { bool, runMain } from "../src/lang/run.ts";
import { showType } from "../src/lang/types.ts";
import { formatUnit, infer as units } from "../src/units.ts";

const p = loadProgram(join(root, "examples", "physics"));
const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;
const answers = (def: Id, known: Record<string, unknown>, n = 4) => {
  const out: Record<string, string>[] = [];
  for (const a of relate(p.code, def, known)) {
    out.push(Object.fromEntries(Object.entries(a.values).filter(([k]) => !(k in known)).map(([k, v]) => [p.pres.names[k] ?? k, showTerm(v)])));
    if (out.length >= n) break;
  }
  return out;
};

test("a network is a predicate: its type is Bool and main prints what it says", () => {
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const type = (n: string) => showType(info.typeOf.get(p.named(n))!, p.pres.names);
  assert.equal(type("fall"), "(Float64, Float64, Float64, Float64) -> Bool");
  assert.equal(type("rotate"), "(Float64, Float64, Float64, Float64, Float64) -> Bool");
  assert.equal(type("landing times"), "(Float64, Float64) -> List Float64");
  const lines: string[] = [];
  runMain(p.code, info, p.named("main"), { print: (s) => lines.push(s) });
  assert.deepEqual(lines, [
    "period(1, 9.81) = 2.006066681",
    "fall(29.62, 5, 9.81, 2) = true",
    "landing times(29.62, 5) = 2 -3.019367992",
    "rotate (1, 0) by a quarter turn = (0, 1)",
    "what lands on (0, 2) after a quarter turn = (2, 0)",
    "polar(0, 2, 2, π/2) = true",
    "for some y, angle: polar(1, y, 2, angle) = true",
    "for some y, angle: polar(3, y, 2, angle) = false",
  ]);
});

test("one predicate, every direction: fall solved for whichever port is unknown", () => {
  const fall = p.named("fall");
  const [distance, speed, gravity, time] = params(p.code, fall);
  const yes = bool(true);
  assert.deepEqual(answers(fall, { [speed]: 5, [gravity]: 9.81, [time]: 2, out: yes }), [{ distance: "29.62" }]);
  assert.deepEqual(answers(fall, { [distance]: 29.62, [gravity]: 9.81, [time]: 2, out: yes }), [{ speed: "5" }]);
  assert.deepEqual(answers(fall, { [distance]: 29.62, [speed]: 5, [time]: 2, out: yes }), [{ gravity: "9.81" }]);
  const times = answers(fall, { [distance]: 29.62, [speed]: 5, [gravity]: 9.81, out: yes }).map((a) => +a.time).sort((a, b) => a - b);
  assert.deepEqual(times.map((t) => +t.toFixed(6)), [-3.019368, 2]);
  // All four known: it's a check, and out says whether it holds.
  assert.deepEqual(answers(fall, { [distance]: 30, [speed]: 5, [gravity]: 9.81, [time]: 2 }), [{ out: "std.bool.false" }]);
});

test("for some: the wires inside rotate are unknowns, and it runs backwards through both polars", () => {
  const rotate = p.named("rotate");
  const [x, y, turn, x2, y2] = params(p.code, rotate);
  const round = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(+v * 1e6) / 1e6 + 0]));
  const [back] = answers(rotate, { [x2]: 0, [y2]: 2, [turn]: Math.PI / 2, out: bool(true) }, 1);
  assert.deepEqual(round(back), { x: 2, y: 0 });
  const [fwd] = answers(rotate, { [x]: 3, [y]: 4, [turn]: Math.PI, out: bool(true) }, 1);
  assert.deepEqual(round(fwd), { "x′": -3, "y′": -4 });
});

test("a periodic family that no member of fits ends instead of walking every turn", () => {
  const rotate = p.named("rotate");
  const [x, y, turn, x2] = params(p.code, rotate);
  // A quarter turn that's slightly off, and a point exactly on the axis:
  // every angle + 2πk misses x′ by the same 3e-8, so none fits.
  const t = Date.now();
  answers(rotate, { [x]: 1, [y]: 0, [turn]: 1.5707963, [x2]: 0, out: bool(true) }, 1);
  assert.ok(Date.now() - t < 5000);
});

test("polar from x and y alone: on an axis, and at the origin, where the angle is free", () => {
  const polar = p.named("polar");
  const [x, y] = params(p.code, polar);
  const first = (a: number, b: number) => answers(polar, { [x]: a, [y]: b, out: bool(true) }, 1)[0];
  const r = (v: string) => Math.round(+v * 1e6) / 1e6;
  // The canonical answer first: positive length, angle from the principal branch.
  for (const [a, b, len, ang] of [[3, 4, 5, 0.927295], [0, 2, 2, 1.570796], [0, -2, 2, -1.570796], [-2, 0, 2, 3.141593]]) {
    const got = first(a, b);
    assert.ok(got, `an answer for (${a}, ${b})`);
    assert.deepEqual([r(got.length), r(got.angle)], [len, ang], `(${a}, ${b})`);
  }
  // At the origin every angle fits: the length is 0 and the angle is left free.
  const o = first(0, 0);
  assert.equal(o.length, "0");
  assert.match(o.angle, /^_\d+$/);
});

test("what's left over is written with the ports' names, and a number keeps its · before one", () => {
  const fall = p.named("fall");
  const [, speed, gravity] = params(p.code, fall);
  const [a] = relate(p.code, fall, { [speed]: 5, [gravity]: 9.81, out: bool(true) }, { names: p.pres.names });
  assert.deepEqual(a.residual, ["distance = 5 · time + 4.905 · time²"]);
});

test("hence: a consequence gives the solver a way in without counting as a constraint", () => {
  const polar = p.named("polar");
  const { rel, predicate } = relationFor(p.code, polar);
  assert.ok(predicate);
  const [x, y] = rel.ports;
  // From x and y: the length in closed form (sqrt), the angle by an inverse
  // cosine, the y equation as a check. No numeric search.
  const both = analyze(rel as never, [x, y]) as { status: string; steps: { kind: string }[] };
  assert.equal(both.status, "solved");
  assert.deepEqual(both.steps.map((s) => s.kind), ["solve", "solve", "check"]);
  // From x alone it's a family of points, and the solver says so, instead
  // of treating x² + y² = length² as a third equation and searching.
  assert.equal((analyze(rel as never, [x]) as { status: string }).status, "underdetermined");
});

test("units: declared on parameters and numbers, inferred through predicates and functions", () => {
  const period = p.named("period");
  const u = units(p.code, period);
  assert.equal(formatUnit(u.unit(get(p.code, get(p.code, period, "def").body!, "lambda").body)!), "s");
  const fall = p.named("fall");
  const f = units(p.code, fall);
  const named = (n: string) => Object.keys(p.pres.names).find((id) => p.pres.names[id] === n && p.code.nodes[id]?.kind === "binder" && id in p.code.nodes)!;
  assert.equal(formatUnit(f.unit(named("drift"))!), "m");
  assert.equal(formatUnit(f.unit(named("drop"))!), "m");
  // A plain number where a length is needed is a type error.
  const measured = Object.values(p.code.nodes).find((n) => n.kind === "lit" && n.value === 29.62 && n.unit)!;
  const plain = replace(p.code, measured.id, () => ({ kind: "lit", value: 29.62 }));
  assert.ok(infer(plain, p.pres.names).errors.some((e) => /declared m|units don't agree|plain number/.test(e.message)));
  // A refusal names the units on both sides.
  const speed = Object.values(p.code.nodes).find((n) => n.kind === "lit" && n.value === 5 && n.unit)!;
  const seconds = replace(p.code, speed.id, () => ({ kind: "lit", value: 5, unit: { s: 1 } }));
  const msgs = infer(seconds, p.pres.names).errors.map((e) => e.message);
  assert.ok(msgs.includes("declared m/s, but the rest makes it s"), msgs.join("; "));
  assert.ok(msgs.some((m) => /^units don't agree here: \S+ is m, \S+ is s²$/.test(m)), msgs.join("; "));
});

test("a predicate hashes by structure: the same network written twice hashes the same", () => {
  const a = loadProgram(join(root, "examples", "physics"));
  const b = reId(a.own);
  assert.equal(hashDef(a.code, a.named("rotate")), hashDef(base(b.code), b.ids.get(a.named("rotate"))!));
  assert.notEqual(hashDef(a.code, a.named("rotate")), hashDef(a.code, a.named("fall")));
});

test("units: a recursive call isn't unfolded again, so checking stays fast when a def calls a recursive group", async () => {
  const T = await import("../../editor/typed.ts");
  const p = loadProgram(join(root, "examples", "physics"));
  const fall = p.named("fall"), main = p.named("main");
  // fall gets a value that calls main, which calls fall: one recursive
  // group that main reaches many times over.
  const r = T.addStep(p.code, p.pres.names, infer(p.code, p.pres.names) as never, fall);
  assert.ok(r.ok);
  if (!r.ok) return;
  const hole = r.select!;
  const code: Code = { ...r.code, nodes: { ...r.code.nodes, mainref: { id: "mainref", kind: "ref", target: main }, [hole]: { id: hole, kind: "call", fn: "mainref", args: [] } } };
  const t0 = Date.now();
  for (const d of code.defs) units(code, d);
  assert.ok(Date.now() - t0 < 2000, `units took ${Date.now() - t0} ms`);
});
