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
import { formatUnit, parseUnit } from "../src/units.ts";

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
