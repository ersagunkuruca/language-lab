// Clifford algebras from their signature (ALGEBRA-TABLES.md, BACKLOG L42):
// clifford table(squares, basis) is the multiplication table for table
// product. [−1, −1] is the quaternions, with Hamilton's product; [−1] the
// complex numbers; [0] the dual numbers; [1, 1, 1] Cl(3, 0), whose
// pseudoscalar squares to −1. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, ARITHMETIC_V, COMPLEX_V, DUAL_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

// Hamilton's product (1843), to check the table against.
const hamilton = ([a1, b1, c1, d1]: number[], [a2, b2, c2, d2]: number[]) => [
  a1 * a2 - b1 * b2 - c1 * c2 - d1 * d2, a1 * b2 + b1 * a2 + c1 * d2 - d1 * c2,
  a1 * c2 - b1 * d2 + c1 * a2 + d1 * b2, a1 * d2 + b1 * c2 - c1 * b2 + d1 * a2];
const PAIRS = [[[0, 1, 0, 0], [0, 0, 1, 0]], [[0, 0, 1, 0], [0, 1, 0, 0]], [[0, 0, 0, 1], [0, 0, 0, 1]], [[1, 2, 3, 4], [-2, 0.5, 1, -3]]];

test("clifford table: quaternions, complex, dual and Cl(3, 0), evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const record = (name: string, parts: string[]) => k.type(name, [], [[name.toLowerCase(), parts.map((p) => [p, num] as [string, () => Id])]]);
  const Q = record("Quaternion", ["w", "i", "j", "k"]);
  const M = record("Multivector", ["s", "e1", "e2", "e12", "e3", "e13", "e23", "e123"]);
  const of = (v: Id, ...ps: number[]) => k.call(v, ...ps.map((p) => k.lit(p)));
  const unit = (v: Id, size: number, i: number) => of(v, ...Array.from({ length: size }, (_, j) => (j === i ? 1 : 0)));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const list = (...xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const table = (squares: number[], v: Id, size: number) => k.call(lib("clifford table"), list(...squares), k.list(...Array.from({ length: size }, (_, i) => unit(v, size, i))));
  const qTable = def("quaternion table", () => table([-1, -1], Q.v.quaternion, 4));
  // The one · at Quaternion is the table's: Arithmetic, as any type's own.
  const each = (op: Id) => k.fn(["a", "b"], (a, b) => k.call(S.zipParts, k.x(op), a, b));
  def("arithmetic at quaternion", () => k.call(ARITHMETIC_V, each(B.add), each(B.sub), k.fn(["a", "b"], (a, b) => k.call(lib("table product"), k.x(qTable), a, b)), k.fn(["a"], (a) => k.call(S.mapParts, k.x(B.neg), a))));
  const names: string[] = [];
  const show = (name: string, x: () => Id) => { names.push(name); def(name, () => k.call(SHOW_ANY, x())); };
  PAIRS.forEach(([a, b], i) => show(`q${i}`, () => k.call(ARITH.mul, of(Q.v.quaternion, ...a), of(Q.v.quaternion, ...b))));
  const C = (re: number, im: number) => of(COMPLEX_V, re, im);
  show("complex", () => k.call(lib("table product"), k.call(lib("clifford table"), list(-1), k.list(C(1, 0), C(0, 1))), C(1, 2), C(3, -4)));
  const D = (v: number, s: number) => of(DUAL_V, v, s);
  show("dual", () => k.call(lib("table product"), k.call(lib("clifford table"), list(0), k.list(D(1, 0), D(0, 1))), D(3, 1), D(5, 2)));
  const mTable = def("cl3 table", () => table([1, 1, 1], M.v.multivector, 8));
  const m = (i: number) => unit(M.v.multivector, 8, i);
  const mul = (a: Id, b: Id) => k.call(lib("table product"), k.x(mTable), a, b);
  show("e1 e1", () => mul(m(1), m(1)));
  show("e12 e12", () => mul(m(3), m(3)));
  show("e123 e123", () => mul(m(7), m(7)));
  show("e1 e2 e3", () => mul(mul(m(1), m(2)), m(4)));
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = names.map((n) => r.value(at(n)));
  const parts = (xs: number[]) => xs.map((x) => String(x)).join(", ");
  assert.deepEqual(got, [
    ...PAIRS.map(([a, b]) => `quaternion(${parts(hamilton(a, b))})`),
    "11 + 2i", "dual(15, 11)",
    "multivector(1, 0, 0, 0, 0, 0, 0, 0)", "multivector(-1, 0, 0, 0, 0, 0, 0, 0)", "multivector(-1, 0, 0, 0, 0, 0, 0, 0)", "multivector(0, 0, 0, 0, 0, 0, 0, 1)",
  ]);
  const path = join(mkdtempSync(join(tmpdir(), "clifford-")), "cl.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});

// Rotors (BACKLOG L43): R · v · R̃ turns v, and Cl(3, 0)'s even part is the
// quaternions, with w + ii + jj + kk as w − i e₂₃ + j e₁₃ − k e₁₂.
test("clifford reverse: rotors of Cl(3, 0) turn vectors and multiply as quaternions", async () => {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const M = k.type("Multivector", [], [["multivector", ["s", "e1", "e2", "e12", "e3", "e13", "e23", "e123"].map((p) => [p, num] as [string, () => Id])]]);
  const of = (...ps: number[]) => k.call(M.v.multivector, ...ps.map((p) => k.lit(p)));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const squares = () => k.list(...[1, 1, 1].map((x) => k.lit(x)));
  const basis = def("cl3 basis", () => k.list(...Array.from({ length: 8 }, (_, i) => of(...Array.from({ length: 8 }, (_, j) => (j === i ? 1 : 0))))));
  const table = def("cl3 table", () => k.call(lib("clifford table"), squares(), k.x(basis)));
  const mul = (a: Id, b: Id) => k.call(lib("table product"), k.x(table), a, b);
  const rev = (a: Id) => k.call(lib("clifford reverse"), squares(), k.x(basis), a);
  const rotor = (t: number) => of(Math.cos(t / 2), 0, 0, -Math.sin(t / 2), 0, 0, 0, 0);
  const quat = ([w, i, j, q]: number[]) => [w, 0, 0, -q, 0, j, -i, 0];
  const names: string[] = [];
  const show = (name: string, x: () => Id) => { names.push(name); def(name, () => k.call(SHOW_ANY, x())); };
  show("the reverse", () => rev(of(1, 2, 3, 4, 5, 6, 7, 8)));
  show("turn e1", () => mul(mul(rotor(Math.PI / 3), of(0, 1, 0, 0, 0, 0, 0, 0)), rev(rotor(Math.PI / 3))));
  show("turn twice", () => mul(rotor(0.4), rotor(0.5)));
  PAIRS.forEach(([a, b], i) => show(`q${i}`, () => mul(of(...quat(a)), of(...quat(b)))));
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = names.map((n) => r.value(at(n)));
  const parts = (v: Value) => { const s = String(v); return s.slice(s.indexOf("(") + 1, -1).split(", ").map(Number); };
  const near = (s: Value, want: number[]) => parts(s).forEach((x, i) => assert.ok(Math.abs(x - want[i]) < 1e-8, `${s} ≠ ${want}`));
  near(got[0], [1, 2, 3, -4, 5, -6, -7, -8]);
  near(got[1], [0, Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0, 0, 0, 0, 0]);
  near(got[2], [Math.cos(0.45), 0, 0, -Math.sin(0.45), 0, 0, 0, 0]);
  PAIRS.forEach(([a, b], i) => near(got[3 + i], quat(hamilton(a, b))));
  const path = join(mkdtempSync(join(tmpdir(), "rotor-")), "rotor.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});
