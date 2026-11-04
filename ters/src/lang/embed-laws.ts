// An embedding's laws (EMBEDDINGS.md, BACKLOG L208b): ι : A → B keeps the
// operations both types have,
//
//   ι(x + y) = ι(x) + ι(y)    ι(x − y) = ι(x) − ι(y)    ι(x · y) = ι(x) · ι(y)
//   ι(−x) = −ι(x)             x < y exactly when ι(x) < ι(y)
//
// each written as a test over the program (a definition that performs
// Check), so lab test runs it on small values like any test. A law whose
// operation one of the types hasn't got doesn't type, and is left out.
// Into Float64 an equation holds only as closely as Float64 rounds, so it
// is checked with near (L197).
//
// Prior art: Lean 4's Mathlib, whose `algebraMap` is a ring homomorphism by
// its type; here the laws are tested, not proved. CREDITS.md.

import type { Code, Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { Lang } from "./dsl.ts";
import { infer, type Info } from "./infer.ts";
import { ARITH, CHECK_OP, EMBEDDING, EMBEDDING_MAP } from "./std.ts";
import { runTests, type TestResult } from "./tests.ts";
import { shortcuts, type Edge } from "./diamonds.ts";
import { NUMBER, type Type } from "./types.ts";

export interface EmbeddingLaw extends TestResult { embedding: string; law: string }

// The program's embeddings: each definition kept under Embedding a b.
export function embeddingsIn(info: Info): { def: Id; from: Type; to: Type }[] {
  const out: { def: Id; from: Type; to: Type }[] = [];
  for (const [key, def] of info.implementations ?? []) {
    if (!key.startsWith(`${EMBEDDING}|`)) continue;
    const t = JSON.parse(key.slice(EMBEDDING.length + 1)) as Type;
    if (t.t === "con" && t.id === EMBEDDING && t.args.length === 2) out.push({ def, from: t.args[0], to: t.args[1] });
  }
  return out;
}

export function embeddingLaws(code: Code, info: Info, names: Names, only?: Set<Id>, near?: Id): EmbeddingLaw[] {
  const all = embeddingsIn(info).filter((e) => !only || only.has(e.def));
  if (!all.length) return [];
  const k = new Lang(code);
  const laws: { def: Id; embedding: string; law: string }[] = [];
  for (const e of all) {
    const name = names[e.def] ?? e.def;
    const map = (v: Id) => k.call(k.call(EMBEDDING_MAP, k.x(e.def)), v);
    const close = e.to.t === "con" && e.to.id === NUMBER && near;
    const same = (a: Id, b: Id) => (close ? k.call(near!, a, b) : k.equal(a, b));
    const law = (what: string, params: string[], body: (...xs: Id[]) => Id) => {
      const d = k.def(`${name}: ${what}`);
      k.define(d, k.fn(params, (...xs) => k.call(CHECK_OP, body(...xs), k.lit(`${name} keeps ${what}`))));
      laws.push({ def: d, embedding: name, law: what });
    };
    for (const [what, op] of [["+", ARITH.add], ["−", ARITH.sub], ["·", ARITH.mul]] as const)
      law(what, ["x", "y"], (x, y) => same(map(k.call(op, x, y)), k.call(op, map(x), map(y))));
    law("negation", ["x"], (x) => same(map(k.call(ARITH.neg, x)), k.call(ARITH.neg, map(x))));
    law("<", ["x", "y"], (x, y) => k.equal(k.call(ARITH.less, x, y), k.call(ARITH.less, map(x), map(y))));
  }
  // Each declared embedding agrees with every other path between its types
  // (the diamond rule, L208d): ι(x) = ι₂(ι₁(x)).
  const edges: Edge[] = embeddingsIn(info).map((e) => ({ def: e.def, from: JSON.stringify(e.from), to: JSON.stringify(e.to) }));
  const target = new Map(embeddingsIn(info).map((e) => [e.def, e.to]));
  for (const { direct, path } of shortcuts(edges)) {
    if (only && ![direct, ...path].some((e) => only.has(e.def))) continue;
    const name = names[direct.def] ?? direct.def;
    const via = path.map((e) => names[e.def] ?? e.def).join(" then ");
    const t = target.get(direct.def)!, close = t.t === "con" && t.id === NUMBER && near;
    const mapBy = (def: Id, v: Id) => k.call(k.call(EMBEDDING_MAP, k.x(def)), v);
    const d = k.def(`${name}: as ${via}`);
    k.define(d, k.fn(["x"], (x) => {
      const one = mapBy(direct.def, x), other = path.reduce((v, e) => mapBy(e.def, v), x);
      return k.call(CHECK_OP, close ? k.call(near!, one, other) : k.equal(one, other), k.lit(`${name} agrees with ${via}`));
    }));
    laws.push({ def: d, embedding: name, law: `as ${via}` });
  }
  const full: Code = { nodes: { ...code.nodes, ...k.code.nodes }, defs: [...code.defs, ...laws.map((l) => l.def)] };
  const all2: Names = { ...names, ...k.names };
  const checked = infer(full, all2);
  const bad = new Set(checked.errors.map((x) => x.id));
  const typed = laws.filter((l) => !inside(full, l.def, bad));
  if (typed.length === laws.length || !typed.length) return withLaws(full, checked, all2, typed);
  // A law that doesn't type is left out, and the rest checked without it.
  const again: Code = { nodes: full.nodes, defs: [...code.defs, ...typed.map((l) => l.def)] };
  return withLaws(again, infer(again, all2), all2, typed);

  function withLaws(c: Code, i: Info, n: Names, ls: typeof laws): EmbeddingLaw[] {
    const byDef = new Map(ls.map((l) => [l.def, l]));
    return runTests(c, i, n, ls.map((l) => l.def)).map((r) => ({ ...r, embedding: byDef.get(r.def)!.embedding, law: byDef.get(r.def)!.law }));
  }
}

// Whether any of `bad` is a node of definition d.
function inside(code: Code, d: Id, bad: Set<Id>): boolean {
  const seen = new Set<Id>();
  const go = (id: Id): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (bad.has(id)) return true;
    const n = code.nodes[id] as unknown as Record<string, unknown> | undefined;
    if (!n) return false;
    return Object.entries(n).some(([key, v]) => key !== "id" && key !== "target" && (typeof v === "string" ? !!code.nodes[v] && go(v) : Array.isArray(v) ? v.some((x) => typeof x === "string" && !!code.nodes[x] && go(x)) : v && typeof v === "object" ? Object.values(v).some((x) => typeof x === "string" && !!code.nodes[x] && go(x)) : false));
  };
  return go(d);
}

