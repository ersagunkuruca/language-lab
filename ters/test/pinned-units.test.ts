// Units in a pinned signature (L252e): a pin keeps its definition's units,
// unit variables and all, so an edit that changes them is refused at the
// definition, callers are checked against the pin rather than the body,
// and a module's pins carry them (units.ts PinUnits). examples/track is
// the program (track.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";
import { publishVersion, upgrade } from "../src/lang/modules.ts";
import { merge } from "../src/model.ts";
import { baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { formatUnit } from "../src/units.ts";
import { showWithPinUnits } from "../src/lang/unit-types.ts";
import { fresh } from "../src/lang/signatures.ts";
import { Subst } from "../src/lang/types.ts";

function program() {
  const dir = mkdtempSync(join(tmpdir(), "pinned-units-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  const def = (name: string, params: string[], body: string) => {
    s.define(name, params.length ? "function" : "value", params);
    return s.replace(/□#(\w+)/.exec(s.view(name))![1], body);
  };
  return { s, def };
}
const defNamed = (s: Session, name: string) => s.own.find((d) => s.name(d) === name)!;

test("a pin's unit variables: whole powers, numbered as they first appear", () => {
  const { s, def } = program();
  def("side of", ["area"], "sqrt(area)");
  def("mean", ["a", "b"], "(a + b) / 2.0");
  def("work", ["force", "distance"], "force · distance / 2.0 + 0.0 J");
  for (const f of ["side of", "mean", "work"]) s.pin(f);
  const shown = (f: string) => { const p = s.pins[defNamed(s, f)]; return showWithPinUnits(fresh(p, new Subst()), p.units!, s.allNames); };
  assert.equal(shown("side of"), "(Float64 u²) -[Choice]-> Float64 u");
  assert.equal(shown("mean"), "(Float64 u, Float64 u) -> Float64 u");
  // A unit written down is a base unit, the rest a variable.
  assert.equal(shown("work"), "(Float64 u, Float64 m²·kg/s²·u) -> Float64 J");
  assert.equal(formatUnit({ "~0": 1, "~1": -2, s: 1 }), "s·u/v²");
});

test("an edit that keeps a pinned function's type but changes its units is refused at it", () => {
  const { s, def } = program();
  def("rate", ["amount", "time"], "amount / 2.0 / time");
  def("speed", [], "rate(100.0 m, 9.86 s)");
  s.pin("rate");
  assert.throws(() => s.replace("rate", "amount · time", "amount / 2.0 / time"), /rate is pinned to \(Float64 u, Float64 v\) -\[Choice\]-> Float64 u\/v, and this makes it \(Float64 u, Float64 v\) -\[Choice\]-> Float64 u·v/);
  // One that keeps them (more general, too) is taken.
  s.replace("rate", "amount / time", "amount / 2.0 / time");
  assert.equal(s.errors(), "ok");
});

test("callers are checked against the pin's units, not the body's", () => {
  const { s, def } = program();
  // Pinned at metres, then made to work in any unit: the pin still says metres.
  def("ahead", ["x"], "x / 2.0 + 1.0 m");
  s.pin("ahead");
  s.replace("ahead", "0.0", "1 m");
  assert.match(s.view("ahead"), /x \/ 2(\.0)? \+ 0/);
  assert.equal(s.errors(), "ok");
  assert.throws(() => def("late", [], "ahead(2.0 s)"), /units don't agree here/);
});

test("a published module's pins carry their units, and a program using it is checked by them", () => {
  const { s, def } = program();
  def("squared", ["x"], "x · x");
  def("hypot", ["a", "b"], "sqrt(a · a + b · b)");
  const r = publishVersion(null, "measures", s.code, s.names, [defNamed(s, "squared"), defNamed(s, "hypot")], LIBRARY.code, LIBRARY.pins);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  const m = r.module, at = (n: string) => m.exports.find((d) => m.names[d] === n)!;
  assert.deepEqual(m.pins[at("squared")].units, { "0": { "~0": 1 }, out: { "~0": 2 } });
  assert.deepEqual(m.pins[at("hypot")].units, { "0": { "~0": 1 }, "1": { "~0": 1 }, out: { "~0": 1 } });
});

test("a new version that changes the units it promises isn't taken by an upgrade", () => {
  const { s, def } = program();
  def("rate", ["amount", "time"], "amount / 2.0 / time");
  const rate = defNamed(s, "rate");
  const v1 = publishVersion(null, "rates", s.code, s.names, [rate], LIBRARY.code, LIBRARY.pins);
  assert.ok(v1.ok);
  s.replace("rate", "amount · time", "amount / 2.0 / time");
  const v2 = publishVersion(v1.module, "rates", s.code, s.names, [rate], LIBRARY.code, LIBRARY.pins);
  assert.ok(v2.ok);
  const [a, b] = v2.module.lineages![rate];
  const r = upgrade(merge(LIBRARY.code, v2.module.code), a, b, v2.module.pins, baseNames(v2.module.names));
  assert.ok(!r.ok);
  assert.match(r.reason, /its units changed from \(Float64 u, Float64 v\) -\[Choice\]-> Float64 u\/v to/);
  // Back the other way too: u·v is no more general than u/v.
  assert.ok(!upgrade(merge(LIBRARY.code, v2.module.code), b, a, v2.module.pins, baseNames(v2.module.names)).ok);
});
