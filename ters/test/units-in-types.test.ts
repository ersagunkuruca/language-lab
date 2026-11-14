// Units written in a type (L252): a record's field says `Float64 m/s`,
// and what is made with it, read from it and taken out of it by a match
// has that unit, checked as any other unit (units.ts). The MCP's view
// prints it and its type reader reads it back; literals print theirs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { hashDef } from "../src/hash.ts";
import { ARITH } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { formatUnit, parseUnit, signatureUnits } from "../src/units.ts";
import { isPublished } from "../src/model.ts";

test("a unit reads back as formatUnit writes it", () => {
  for (const s of ["m", "m/s", "m/s²", "N", "1/s", "m²·kg"]) assert.equal(formatUnit(parseUnit(s)!), s);
  assert.deepEqual(parseUnit("kg·m/s^2"), parseUnit("N"));
  for (const s of ["Float64", "metre", "m/s/s", ""]) assert.equal(parseUnit(s), null, s);
});

function program(text: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "units-in-types-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  s.define("Body", "type", [], text[0]);
  return s;
}

test("a field's unit is written, printed and checked where the field is read or taken out", () => {
  const s = program(["body(position: Float64 m, speed: Float64 m/s, time: Float64 s)"]);
  assert.match(s.view("Body"), /body\(position#\w+: Float64 m, speed#\w+: Float64 m\/s, time#\w+: Float64 s\)/);
  const fill = (name: string, text: string) => { s.define(name, "function", ["b"]); return s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  // speed · time is a length, so it adds to a position.
  fill("ahead", "b.position + b.speed · b.time");
  assert.equal(s.errors(), "ok");
  assert.throws(() => fill("wrong", "b.position + b.speed"), /units don't agree here: position\(…\) is m, speed\(…\) is m\/s/);
  assert.throws(() => fill("wrong2", "match b\n  body(p, v, t) → p + v"), /units don't agree here: p is m, v is m\/s/);
});

test("a value made with a field takes its unit, and the unit is part of the type's hash", () => {
  const k = new Lang();
  const T = k.type("Run", [], [["run", [["distance", () => { const t = k.tref(NUMBER); (k.code.nodes[t] as { unit?: object }).unit = { m: 1 }; return t; }]]]]);
  const lit = (value: number, unit: Record<string, number>) => { const l = k.lit(value); (k.code.nodes[l] as { unit?: object }).unit = unit; return l; };
  const made = k.def("made");
  k.define(made, k.fn(["x"], () => k.call(T.v.run, lit(5, { s: 1 }))));
  const fine = k.def("fine");
  k.define(fine, k.fn(["x"], () => k.call(ARITH.add, k.call(T.f["run.distance"], k.call(T.v.run, lit(5, { m: 1 }))), lit(2, { m: 1 }))));
  const code = base(k.code), names = baseNames(k.names);
  const errors = infer(code, names, undefined, checkOptions).errors;
  // Only the 5 s given as a distance is refused.
  assert.deepEqual(errors.map((e) => [e.id, e.message]), [[(code.nodes[(code.nodes[(code.nodes[made] as { body: string }).body] as { body: string }).body] as { args: string[] }).args[0], "the field's type says m, but this is s"]]);
  const plain = { ...code, nodes: { ...code.nodes } };
  const tref = (code.nodes[(code.nodes[T.f["run.distance"]] as { type: string }).type]);
  plain.nodes[tref.id] = { ...tref, unit: undefined } as typeof tref;
  assert.notEqual(hashDef(code, T.def), hashDef(plain, T.def));
});

// The text reader (editor/typed.ts): a number then a word that reads as a
// unit and names nothing in scope is a number with that unit, a Float64.
test("a number's unit is read from text, and a name in scope is still the name", () => {
  const s = program(["body(position: Float64 m)"]);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); return s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  fill("fallen", ["x"], "x + 9.81 m/s² · 2 s · 3 s");
  assert.match(s.view("fallen"), /= x \+ 9\.81 m\/s² · 2 s · 3 s$/m);
  assert.equal(s.errors(), "ok");
  assert.throws(() => fill("mixed", ["x"], "3 m + 2 s"), /units don't agree here: m can't meet s/);
  // m is a parameter here, so `2 m` is no length: it doesn't read.
  assert.throws(() => fill("shadowed", ["m"], "2 m"), /in “2 m”, m is the name m here, not a unit/); // I260 says why
  // A unit literal where a field asks for one.
  fill("placed", ["x"], "body(1.5 m)");
  assert.match(s.errors(), /^ok/);
  assert.throws(() => fill("misplaced", ["x"], "body(1.5 s)"), /the field's type says m, but this is s/);
});

// Known units only (Ersagun, 2026-11-13): a signature shows a unit where
// one is written or follows from the body, and a number whose unit is
// free stays plain Float64.
test("a definition's signature shows its known units, and a unit-generic one shows none", () => {
  const s = new Session(join(import.meta.dirname, "../examples/physics"));
  assert.equal(s.typeOf(s.resolve("period")), "(Float64 m, Float64 m/s²) -[Choice]-> Float64 s");
  assert.equal(s.typeOf(s.resolve("fall")), "(Float64 m, Float64 m/s, Float64 m/s², Float64 s) -> Bool");
  assert.match(s.view("period"), /^\s*period#\w+ : \(Float64 m, Float64 m\/s²\) -\[Choice\]-> Float64 s$/m);
  const p = program(["body(position: Float64 m)"]);
  p.define("twice", "function", ["x"]);
  p.replace(/□#(\w+)/.exec(p.view("twice"))![1], "x + x");
  p.define("lifted", "function", ["b"]);
  p.replace(/□#(\w+)/.exec(p.view("lifted"))![1], "b.position + 1.5 m");
  assert.equal(p.typeOf(p.resolve("lifted")), "(Body) -> Float64 m");
  assert.doesNotMatch(p.typeOf(p.resolve("twice")), /Float64 \S*m/);
});

// L257 (round 16, trek): a constant's unit is used where it's named, and
// first, exp and asin have unit rules, so these mistakes are refused.
test("a constant's unit, first's and the transcendental functions' are checked", () => {
  const s = program(["body(position: Float64 m, time: Float64 s)"]);
  s.define("limit", "value", []);
  s.replace(/□#(\w+)/.exec(s.view("limit"))![1], "3.0 s");
  // b is a Body (`as`: time names other fields too).
  const fill = (name: string, text: string) => { s.define(name, "function", ["b"]); return s.replace(/□#(\w+)/.exec(s.view(name))![1], text, undefined, undefined, "Body"); };
  assert.throws(() => fill("wrong constant", "1.0 m + limit"), /units don't agree here/);
  // (refused for its units: the same without `+ 1.0 s` reads, below)
  assert.throws(() => fill("wrong first", "first(b.position / b.time, else 0.0 m/s) + 1.0 s"), /m\/s can't meet s|nothing fits/);
  assert.throws(() => fill("wrong exp", "2.0 m · exp(0.5) + 1.0 s"), /units don't agree here/);
  assert.throws(() => fill("wrong asin", "asin(2.0 m)"), /units don't agree here/);
  fill("later", "b.time + limit");
  assert.equal(s.typeOf(s.resolve("later")), "(Body) -> Float64 s");
  fill("speed", "first(b.position / b.time, else 0.0 m/s)");
  assert.equal(s.typeOf(s.resolve("speed")), "(Body) -> Float64 m/s");
  // A value whose own body disagrees is refused too.
  s.define("mixed", "value", []);
  assert.throws(() => s.replace(/□#(\w+)/.exec(s.view("mixed"))![1], "1.0 m + 1.0 s"), /units don't agree here/);
});

// A program that writes no unit shows none, and asks nothing of units.ts
// for it: #2631 inferred every definition's units through the prelude's,
// and tumble's check went from 2 s to over 120 s, its page frozen.
test("signatures of a program with no units of its own cost nothing (tumble)", () => {
  const s = new Session(join(import.meta.dirname, "../examples/tumble"));
  const defs = s.code.defs.filter((d) => !isPublished(d));
  const t0 = performance.now();
  for (const d of defs) s.typeOf(d);
  const ms = performance.now() - t0;
  assert.ok(ms < 10000, `tumble's ${defs.length} signatures took ${ms.toFixed(0)} ms`);
  assert.equal(signatureUnits(s.code, defs[0]), null);
});

// L252d (round 16, trek): a list's numbers have one unit, the list's.
// Written out, built, taken apart, summed, mapped and kept, and as a
// field typed List (Float64 m); a signature shows List (Float64 m).
test("units inside lists are checked and shown", () => {
  const s = program(["track(heights: List (Float64 m))"]);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); return s.replace(/□#(\w+)/.exec(s.view(name))![1], text); };
  assert.throws(() => fill("wrong sum", ["x"], "sum([1.0 m, 2.0 m]) + 1.0 s"), /m can't meet s/);
  assert.throws(() => fill("wrong map", ["x"], "sum(map([1.0, 2.0], (y) => y · 1.0 m)) + 1.0 s"), /m can't meet s/);
  assert.throws(() => fill("wrong field", ["t"], "sum(t.heights) + 1.0 s"), /m can't meet s/);
  assert.throws(() => fill("wrong made", ["x"], "track([1.0 s])"), /the field's type says m, but this is s/);
  fill("mean", ["xs"], "sum(xs) / as float64(length(xs)) + 0.0 m");
  assert.equal(s.typeOf(s.resolve("mean")), "(List (Float64 m)) -[Choice]-> Float64 m");
  fill("doubled", ["t"], "map(t.heights, (h) => h · 2.0)");
  assert.equal(s.typeOf(s.resolve("doubled")), "(Body) -> List (Float64 m)");
  fill("high", ["t"], "keep(t.heights, (h) => h > 1.0 m)");
  assert.equal(s.typeOf(s.resolve("high")), "(Body) -> List (Float64 m)");
  fill("top", ["t"], "match t.heights\n  nil → 0.0 m\n  cons(h, more) → h");
  assert.equal(s.typeOf(s.resolve("top")), "(Body) -> Float64 m");
  assert.match(s.errors(), /^ok/);
});

// L252e (round 16, trek's `by speed`): a value of a type with parameters
// has a unit per parameter. A map's values are checked where they are put
// and read back, a tuple's parts where it is made and taken apart, and a
// signature shows Map Int (Float64 s) and (a, Float64 s).
test("units in a map's values and a tuple's parts are checked and shown", () => {
  const s = program(["track(times: Map Int (Float64 s), wait: Float64 s)"]);
  const fill = (name: string, params: string[], text: string, as?: string) => { s.define(name, "function", params); return s.replace(/□#(\w+)/.exec(s.view(name))![1], text, undefined, undefined, as); };
  assert.throws(() => fill("wrong put", ["ts"], "first(value at(put(ts, 1, 2.0 m), 1), else 0.0 s)"), /s can't meet m|m can't meet s/);
  assert.throws(() => fill("wrong update", ["ts"], "first(value at(update at(ts, 1, 0.0 s, (d) => d + 1.0 s), 1), else 0.0 m)"), /s can't meet m|m can't meet s/);
  assert.throws(() => fill("wrong field", ["t"], "first(value at(t.times, 1), else 0.0 m)"), /s can't meet m|m can't meet s/);
  fill("added", ["t", "k"], "update at(t.times, k, 0.0 s, (d) => d + 1.0 s)");
  assert.equal(s.typeOf(s.resolve("added")), "(Body, Int) -> Map Int (Float64 s)");
  fill("timed", ["t"], "entries of(t.times)");
  assert.equal(s.typeOf(s.resolve("timed")), "(Body) -> List (Int, Float64 s)");
  fill("time of", ["e", "t"], "e.second + t.wait", "Tuple2");
  assert.equal(s.typeOf(s.resolve("time of")), "((a, Float64 s), Body) -> Float64 s");
  assert.throws(() => fill("wrong part", ["t"], "time of(tuple(1, 2.0 m), t)"), /s can't meet m|m can't meet s/);
  assert.match(s.errors(), /^ok/);
});
