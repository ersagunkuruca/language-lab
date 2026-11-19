// The check of a representation chosen for Map or Set, carried rather
// than made again (the compiler redesign's stages 2 and 3: a whole check
// after the choice was 150 ms of machine's compile). The definitions the
// rewrite went into keep their types, each stored type as its row's (Map
// as the hash table or the tree), and a job's call it wrote in is typed
// at the instance its inputs give it; the trees module's definitions the
// choice brought take theirs from one check of the module, kept for the
// process, their variables moved apart from the program's.
// `TERS_VERIFY_REPS` has the verifier vouch for every node (the tests);
// `TERS_RECHECK` checks the program again instead.

import { dependenciesOfAll, subtree, type Code, type Id } from "../model.ts";
import { infer, type Info } from "./infer.ts";
import { base, baseNames, checkOptions } from "./base.ts";
import { TREES } from "./library.ts";
import { LIST } from "./std.ts";
import { OverMap, type Type } from "./types.ts";
import type { Representation } from "./represent.ts";
import { elaborate, verify } from "./verify.ts";

// The trees module checked on the library, once.
let treesChecked: Info | null = null;
const treesCheck = (): Info => (treesChecked ??= infer(base(TREES.code), baseNames(TREES.names ?? {}), undefined, checkOptions));
// Its variables, moved past any the program's check makes.
const APART = 1 << 28;

export function carriedChoice(code: Code, info: Info, next: Code, reps: Representation[], defs: Id[]): Info | null {
  if (process.env.TERS_RECHECK || !reps.length || reps.some((r) => r.of === LIST || r.of === r.type)) return null;
  const was = new Set(code.defs), made = next.defs.filter((d) => !was.has(d));
  if (made.some((d) => !TREES.code.nodes[d])) return null;
  // The definitions the rewrite went into: the program's own and the
  // library's they reach (a priority queue's on a Map), each of whose
  // types is carried stored as its row's.
  const rewritten = [...defs.filter((d) => next.nodes[d])];
  const own = new Set(defs);
  for (const d of dependenciesOfAll(next, defs)) if (was.has(d) && !own.has(d) && next.nodes[d]?.kind === "def" && subtree(next, d).some((id) => next.nodes[id] !== code.nodes[id])) rewritten.push(d);
  const as = new Map(reps.map((r) => [r.of, r.type]));
  const stored = (t: Type): Type => {
    t = info.subst.zonk(t);
    if (t.t === "var") return t;
    if (t.t === "con") return { t: "con", id: as.get(t.id) ?? t.id, args: t.args.map(stored) };
    return { t: "fn", params: t.params.map(stored), ret: stored(t.ret), eff: t.eff };
  };
  const tc = treesCheck();
  if (tc.errors.length) return null;
  const apart = (t: Type): Type => {
    t = tc.subst.zonk(t);
    if (t.t === "var") return { t: "var", v: t.v + APART };
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(apart) };
    return { t: "fn", params: t.params.map(apart), ret: apart(t.ret), eff: { effs: t.eff.effs, tail: t.eff.tail === null ? null : t.eff.tail + APART } };
  };
  const typeOf = new OverMap(info.typeOf), schemes = new Map(info.schemes), divergent = new Set(info.divergent), owner = new Map(info.owner);
  const opAt = new Map(info.opAt ?? []), solveAt = new Map(info.solveAt ?? []);
  for (const d of rewritten) {
    for (const id of subtree(next, d)) {
      const t = info.typeOf.get(id);
      if (t) typeOf.set(id, stored(t));
      const o = info.opAt?.get(id), s = info.solveAt?.get(id);
      if (o) opAt.set(id, stored(o));
      if (s) solveAt.set(id, stored(s));
    }
    const sc = info.schemes.get(d);
    if (sc) schemes.set(d, { ...sc, type: stored(sc.type) });
  }
  for (const d of made) {
    for (const id of subtree(next, d)) {
      const t = tc.typeOf.get(id), o = tc.opAt?.get(id), s = tc.solveAt?.get(id), w = tc.owner.get(id);
      if (t) typeOf.set(id, apart(t));
      if (o) opAt.set(id, apart(o));
      if (s) solveAt.set(id, apart(s));
      if (w) owner.set(id, w);
    }
    const sc = tc.schemes.get(d);
    if (sc) schemes.set(d, { ...sc, vars: sc.vars.map((v) => v + APART), rows: sc.rows.map((v) => v + APART), type: apart(sc.type) });
    if (tc.divergent.has(d)) divergent.add(d);
  }
  // What the rewrite wrote in (a call of a row's job, `tree insert(t, k,
  // v)`): each name of a definition called there at the instance its
  // inputs' types and the call's give it.
  let fresh = APART * 2;
  const instance = (general: Type, params: Type[], ret: Type | undefined): Type | null => {
    if (general.t !== "fn" || general.params.length !== params.length) return null;
    const vars = new Map<number, Type>(), rows = new Map<number, number | null>();
    let ok = true;
    const match = (g: Type, t: Type): void => {
      if (!ok) return;
      if (g.t === "var") { const was = vars.get(g.v); if (was) { if (JSON.stringify(was) !== JSON.stringify(t)) ok = false; } else vars.set(g.v, t); return; }
      if (g.t === "con") { if (t.t !== "con" || t.id !== g.id || t.args.length !== g.args.length) { if (t.t !== "var") ok = false; return; } g.args.forEach((x, i) => match(x, t.args[i])); return; }
      if (t.t !== "fn" || t.params.length !== g.params.length) { if (t.t !== "var") ok = false; return; }
      g.params.forEach((x, i) => match(x, t.params[i]));
      match(g.ret, t.ret);
      if (g.eff.tail !== null && !rows.has(g.eff.tail)) rows.set(g.eff.tail, t.eff.tail);
    };
    general.params.forEach((g, i) => match(g, params[i]));
    if (ret) match(general.ret, ret);
    if (!ok) return null;
    const put = (g: Type): Type => {
      if (g.t === "var") { let t = vars.get(g.v); if (!t) vars.set(g.v, (t = { t: "var", v: fresh++ })); return t; }
      if (g.t === "con") return { t: "con", id: g.id, args: g.args.map(put) };
      let tail = g.eff.tail;
      if (tail !== null) { if (!rows.has(tail)) rows.set(tail, fresh++); tail = rows.get(tail)!; }
      return { t: "fn", params: g.params.map(put), ret: put(g.ret), eff: { effs: g.eff.effs, tail } };
    };
    return put(general);
  };
  for (const d of rewritten) for (const id of subtree(next, d)) {
    const n = next.nodes[id];
    if (n?.kind !== "call" || n.given !== undefined || typeOf.has(n.fn)) continue;
    const f = next.nodes[n.fn];
    if (f?.kind !== "ref") return null;
    const sc = schemes.get(f.target);
    const args = n.args.map((a) => typeOf.get(a));
    if (!sc || args.some((a) => !a)) return null;
    const at = instance(sc.type, args as Type[], typeOf.get(id));
    if (!at || at.t !== "fn") return null;
    typeOf.set(n.fn, at);
    if (!typeOf.has(id)) typeOf.set(id, at.ret);
  }
  const out: Info = { ...info, typeOf, schemes, divergent, owner, opAt, solveAt };
  if (process.env.TERS_VERIFY_REPS) {
    const v = verify(next, elaborate(next, out, [...rewritten, ...made]));
    if (v.problems.length) throw new Error(`carried types of ${reps.map((r) => r.name).join(", ")}: ${v.problems.slice(0, 3).map((p) => `${p.id} ${p.rule}`).join("; ")}`);
  }
  return out;
}
