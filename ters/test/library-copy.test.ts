// A library outside the prelude is as good as the prelude
// (MATHEMATICS-AS-LIBRARIES-2026-11-03.md, BACKLOG L202): the prelude's
// Clifford definitions copied under new ids, as a third-party library
// would hold them, type-check, and give the prelude's answers evaluated
// and compiled, and its grade masks (L203a: the reading knows a definition
// by its meaning's hash, not its id). Jets (L206) still find the
// prelude's definitions only.

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
import { bladeMask } from "../src/lang/grades.ts";
import { renameCode } from "../src/lang/modules.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { subtree, type Code, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const L = LIBRARY.code, N = LIBRARY.names;
const lib = (name: string) => L.defs.find((d) => N[d] === name && L.nodes[d]?.kind === "def")!;

test("the prelude's Clifford definitions copied under new ids check and give the same answers, evaluated and compiled (L202)", async () => {
  const clifford = L.defs.filter((d) => /^clifford /.test(N[d] ?? "") && L.nodes[d]?.kind === "def");
  assert.ok(clifford.length >= 20, `${clifford.length} Clifford definitions`);
  // Every node of theirs gets an id of its own; what they call outside
  // the set (table product, the std types) stays the prelude's.
  const ids = clifford.flatMap((d) => subtree(L, d));
  const rename = new Map(ids.map((id, i) => [id, `copied${i}x`]));
  const copy = renameCode({ nodes: Object.fromEntries(ids.map((id) => [id, L.nodes[id]])), defs: clifford }, rename);
  const k = new Lang({ nodes: { ...L.nodes, ...copy.nodes }, defs: [...L.defs, ...copy.defs] });
  for (const d of clifford) k.names[rename.get(d)!] = `my ${N[d]}`;
  const mine = (name: string) => rename.get(lib(name))!;

  // Cl(3, 0) on a record of its eight parts, and PGA's Cl(3, 0, 1) on sixteen.
  const num = () => k.tref(NUMBER);
  const record = (name: string, n: number) => k.type(name, [], [[name.toLowerCase(), Array.from({ length: n }, (_, i) => [`p${i}`, num] as [string, () => Id])]]);
  const E3 = record("Cl3", 8), P = record("Pga", 16);
  const of = (v: Id, ps: number[]) => k.call(v, ...ps.map((p) => k.lit(p)));
  const unit = (v: Id, n: number, i: number) => of(v, Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)));
  const list = (xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const algebra = (f: (name: string) => Id, squares: number[], v: Id, n: number) => k.call(f("clifford algebra"), list(squares), k.list(...Array.from({ length: n }, (_, i) => unit(v, n, i))));
  const a3 = of(E3.v.cl3, [1, 2, -1, 0.5, 3, 0, -2, 1]), b3 = of(E3.v.cl3, [0, 1, 1, 0, -1, 2, 0, 0.25]);
  const bivector = of(E3.v.cl3, [0, 0, 0, 0.3, 0, -0.2, 0.4, 0]);
  const pa = of(P.v.pga, Array.from({ length: 16 }, (_, i) => ((i * 7) % 5) - 2)), pb = of(P.v.pga, Array.from({ length: 16 }, (_, i) => ((i * 3) % 4) / 2));
  const names: string[] = [];
  for (const [who, f] of [["prelude", lib], ["copy", mine]] as const) {
    const show = (name: string, x: () => Id) => { const d = k.def(`${who} ${name}`); k.define(d, k.call(SHOW_ANY, x())); names.push(`${who} ${name}`); };
    const cl3 = () => algebra(f, [1, 1, 1], E3.v.cl3, 8), pga = () => algebra(f, [0, 1, 1, 1], P.v.pga, 16);
    show("product", () => k.call(f("clifford product"), cl3(), a3, b3));
    show("sandwich", () => k.call(f("clifford sandwich"), cl3(), k.call(f("clifford exp"), cl3(), bivector), a3));
    show("outer", () => k.call(f("clifford outer"), cl3(), a3, b3));
    show("inner", () => k.call(f("clifford inner"), cl3(), a3, b3));
    show("dual", () => k.call(f("clifford dual"), cl3(), a3));
    show("grade 2", () => k.call(f("clifford grade"), cl3(), k.int(2), a3));
    show("pga product", () => k.call(f("clifford product"), pga(), pa, pb));
    show("pga regressive", () => k.call(f("clifford regressive"), pga(), pa, pb));
    // Not shown, so the grade reading (L203) sees the multivector.
    const al = k.def(`${who} cl3`);
    k.define(al, cl3());
    k.define(k.def(`${who} masked`), k.fn(["v", "w"], (v, w) => k.call(f("clifford outer"), k.x(al), k.call(f("clifford grade"), k.x(al), k.int(1), v), k.call(f("clifford grade"), k.x(al), k.int(1), w))));
  }
  const own = base(k.code);
  const code: Code = { nodes: { ...own.nodes, ...copy.nodes }, defs: [...own.defs, ...copy.defs] }, nm = baseNames(k.names);
  const info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => `${nm[e.id] ?? e.id}: ${e.message}`), []);
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const evaluated = Object.fromEntries(names.map((n) => [n, r.value(at(n))]));
  const half = names.length / 2;
  for (const n of names.slice(0, half)) assert.equal(evaluated[n.replace("prelude", "copy")], evaluated[n], n);
  const path = join(mkdtempSync(join(tmpdir(), "library-copy-")), "copy.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const compiled = Object.fromEntries(names.map((n) => [n, typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n]]));
  assert.deepEqual(compiled, evaluated);
  // The copy's definitions are known by their meaning's hash (L203a), so
  // its masks are the prelude's: the outer product of two vectors is a
  // bivector, three parts of eight.
  const masks = ["prelude", "copy"].map((who) => bladeMask(code, info, at(`${who} masked`))?.mask);
  // Parts: 1, e1, e2, e12, e3, e13, e23, e123.
  assert.deepEqual(masks, [0b1101000, 0b1101000]);
});
