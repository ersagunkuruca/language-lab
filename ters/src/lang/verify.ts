// A program's typing written out, and checked without inferring it
// (docs/design/tools/CHECKED-ONCE-2026-11-11.md §3 A, proof-carrying
// code). `elaborate` writes a check's result as every node's type, each
// definition's scheme and the variables they share, numbered from 0;
// `verify` checks that each node's type follows from its parts' by the
// language's rules, one node at a time, with no unification left to
// search: a variable stands only for itself, except a scheme's or a
// built-in's, matched at each use.
//
// It checks values' types (a function's inputs and result, a call's, a
// use's instance of what it names, each case of a match or a fold) and a
// function's row against the calls in it. Not yet: why a recursion ends
// (Diverge left out is the checker's word: counting.ts, infer.ts), a Choice
// its inputs answer, effects inside a handler, interfaces and number kinds;
// `unchecked` counts the nodes a rule doesn't cover, so a check can say
// how much of a program it vouches for. No compile runs it yet: the
// passes' carried types (I203) are verified in their tests only
// (REVIEW-2026-11-11 §2, I207).

import type { Code, Id, NodeOf } from "../model.ts";
import { children, subtree } from "../model.ts";
import type { Info } from "./infer.ts";
import { LIST, RELEASE_V, S, SIGS } from "./std.ts";
import { laterOps } from "./later-ops.ts";
import { CHOICE, DIVERGE } from "./types.ts";
import { Subst, type Type } from "./types.ts";

export interface Elaboration {
  // Each typed node's type: variables numbered from 0, every one either
  // free (stands for itself) or a scheme's.
  types: Map<Id, Type>;
  // Each definition's scheme: its type and the variables it is general in.
  schemes: Map<Id, { vars: number[]; type: Type }>;
  // Each expression lifted through a canonical embedding (EMBEDDINGS.md):
  // what it is, and what it is taken as where it is used.
  embedded: Map<Id, { from: Type; to: Type }>;
  // Calls whose Choice their inputs answer (signs.ts, L125b): x / 2.
  answered: Set<Id>;
}

// Variables renumbered from 0 in the order they are met.
class Numbering {
  private map = new Map<number, number>();
  v(n: number) { let m = this.map.get(n); if (m === undefined) this.map.set(n, (m = this.map.size)); return m; }
  type(t: Type): Type {
    if (t.t === "var") return { t: "var", v: this.v(t.v) };
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map((a) => this.type(a)) };
    return { t: "fn", params: t.params.map((p) => this.type(p)), ret: this.type(t.ret), eff: { effs: t.eff.effs, tail: t.eff.tail === null ? null : -1 } };
  }
}

export function elaborate(code: Code, info: Info, defs: Id[] = code.defs): Elaboration {
  const n = new Numbering(), types = new Map<Id, Type>(), schemes = new Map<Id, { vars: number[]; type: Type }>(), embedded = new Map<Id, { from: Type; to: Type }>();
  for (const d of defs) {
    for (const id of subtree(code, d)) {
      const t = info.typeOf.get(id);
      if (t) types.set(id, n.type(info.subst.zonk(t)));
      const em = info.embedded?.get(id);
      if (em && !em.of) embedded.set(id, { from: n.type(info.subst.zonk(em.from)), to: n.type(info.subst.zonk(em.to)) });
    }
    const sc = info.schemes.get(d);
    if (sc) schemes.set(d, { vars: sc.vars.map((v) => n.v(v)), type: n.type(info.subst.zonk(sc.type)) });
  }
  const answered = new Set<Id>();
  for (const d of defs) for (const id of subtree(code, d)) if (info.answered?.has(id)) answered.add(id);
  return { types, schemes, embedded, answered };
}

// Value types the same (rows aside, a later step's).
function same(a: Type, b: Type): boolean {
  if (a.t === "var") return b.t === "var" && a.v === b.v;
  if (a.t === "con") return b.t === "con" && a.id === b.id && a.args.length === b.args.length && a.args.every((x, i) => same(x, b.args[i]));
  return b.t === "fn" && a.params.length === b.params.length && a.params.every((x, i) => same(x, b.params[i])) && same(a.ret, b.ret);
}
// `x` an instance of `p`, whose variables in `general` may stand for any
// type, the same one each time.
function instance(p: Type, x: Type, general: (v: number) => boolean, got = new Map<number, Type>()): boolean {
  if (p.t === "var" && general(p.v)) { const w = got.get(p.v); if (w) return same(w, x); got.set(p.v, x); return true; }
  if (p.t === "var") return x.t === "var" && x.v === p.v;
  if (p.t === "con") return x.t === "con" && p.id === x.id && p.args.length === x.args.length && p.args.every((a, i) => instance(a, x.args[i], general, got));
  return x.t === "fn" && p.params.length === x.params.length && p.params.every((a, i) => instance(a, x.params[i], general, got)) && instance(p.ret, x.ret, general, got);
}

// The same up to renaming variables: a definition's type is general in its
// variables, its body's in variables of its own.
const alike = (a: Type, b: Type) => instance(a, b, () => true) && instance(b, a, () => true);

export interface Verdict { problems: { id: Id; rule: string }[]; checked: number; unchecked: Map<string, number> }

// `under`: the schemes of definitions the code uses but isn't given here
// (the library's, checked already).
export function verify(code: Code, e: Elaboration, defs: Id[] = code.defs, under?: Elaboration): Verdict {
  const problems: { id: Id; rule: string }[] = [], unchecked = new Map<string, number>();
  const skip = (why: string) => unchecked.set(why, (unchecked.get(why) ?? 0) + 1);
  const bad = (id: Id, rule: string) => problems.push({ id, rule });
  const ty = (id: Id) => e.types.get(id);
  // An input as its use takes it: lifted, when it is embedded.
  // (That the embedding from one to the other is one is a later step's.)
  const given = (id: Id) => { const t = ty(id), em = e.embedded.get(id); if (!t || !em || !same(t, em.from)) return t; skip("an embedding's lift"); return em.to; };
  const schemeOf = (d: Id) => e.schemes.get(d) ?? under?.schemes.get(d);
  // A data type's case or field, as a function of its parts, in the type's
  // own parameters (which stand for any type at a use).
  const PARAM = -1_000_000;
  const typeOfExpr = (id: Id, params: Map<Id, Type>): Type | null => {
    const n = code.nodes[id];
    if (n?.kind === "tfun") { const ps = n.params.map((p) => typeOfExpr(p, params)), r = typeOfExpr(n.result, params); return ps.every(Boolean) && r ? { t: "fn", params: ps as Type[], ret: r, eff: { effs: [], tail: null } } : null; }
    if (n?.kind !== "tref") return null;
    if (params.has(n.target)) return params.get(n.target)!;
    const args = n.args.map((a) => typeOfExpr(a, params));
    return args.every(Boolean) ? { t: "con", id: n.target, args: args as Type[] } : null;
  };
  const ownerOf = new Map<Id, NodeOf<"typedef"> & { def: Id }>();
  for (const d of code.defs) {
    const b = (code.nodes[d] as NodeOf<"def">).body, td = b ? code.nodes[b] : undefined;
    if (td?.kind !== "typedef") continue;
    for (const v of td.variants) { ownerOf.set(v, { ...td, def: d }); for (const f of (code.nodes[v] as NodeOf<"variant">).fields) ownerOf.set(f, { ...td, def: d }); }
  }
  const dataParts = (target: Id): { self: Type; fields: (v: Id) => (Type | null)[]; td: NodeOf<"typedef"> } | null => {
    const td = ownerOf.get(target);
    if (!td) return null;
    const params = new Map(td.params.map((p, i) => [p, { t: "var", v: PARAM - i } as Type]));
    return { td, self: { t: "con", id: td.def, args: [...params.values()] }, fields: (v) => (code.nodes[v] as NodeOf<"variant">).fields.map((f) => typeOfExpr((code.nodes[f] as NodeOf<"field">).type, params)) };
  };
  const general = (vars: Set<number>) => (v: number) => vars.has(v) || v <= PARAM + 1000 && v > PARAM - 1000;
  let checked = 0;
  for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id], t = ty(id);
    if (!n || !t) continue;
    checked++;
    switch (n.kind) {
      case "def": {
        const bt = n.body ? ty(n.body) : undefined, sc = e.schemes.get(id);
        if (bt && !alike(bt, t)) bad(id, "a definition is its body's type");
        if (sc && !alike(sc.type, t)) bad(id, "a definition's scheme is its type");
        break;
      }
      case "lambda": {
        if (t.t !== "fn") { bad(id, "a function's type is a function's"); break; }
        if (t.params.length !== n.params.length) { skip("a function of a tuple's parts"); break; }
        n.params.forEach((p, i) => { const pt = ty(p); if (!pt || !same(pt, t.params[i])) bad(id, "a function's input is its parameter's type"); });
        const bt = ty(n.body);
        if (!bt || !same(bt, t.ret)) bad(id, "a function's result is its body's type");
        // What it does: every effect of a call in its body (not inside a
        // function of its own, which does it when called) is in its row.
        const todo = [n.body];
        while (todo.length) {
          const c = code.nodes[todo.pop()!];
          if (!c || c.kind === "lambda") continue;
          if (c.kind === "match" && c.arms.length && ownerOf.get((code.nodes[c.arms[0]] as NodeOf<"arm">).variant)?.effect) { skip("effects inside a handler"); continue; }
          if (c.kind === "call" && c.args) {
            const ft = ty(c.fn);
            if (ft?.t === "fn") for (const ef of ft.eff.effs) {
              if (t.eff.effs.includes(ef)) continue;
              // A Choice its inputs answer (signs.ts): whether they do is a
              // later step's to check, as are the ones not recorded.
              if (ef === CHOICE) { skip("a Choice its inputs answer"); continue; }
              if (ef === DIVERGE) { skip("termination"); continue; }
              bad(c.id, "what a call does is in the row of the function it is in");
            }
          }
          todo.push(...children(c));
        }
        break;
      }
      case "call": {
        if (!n.args) { skip("call of a relation (given ports)"); break; }
        const ft = ty(n.fn);
        if (!ft || ft.t !== "fn") { bad(id, "what is called is a function"); break; }
        if (ft.params.length !== n.args.length) { skip("call of another shape (spread, reshaped)"); break; }
        n.args.forEach((a, i) => { const at = given(a); if (!at || !same(at, ft.params[i])) bad(id, e.embedded.has(a) ? "an embedded input is lifted from its type to the one taken" : "each input is the type the function takes"); });
        if (!same(ft.ret, t)) bad(id, "a call is the type the function gives");
        break;
      }
      case "ref": {
        const target = code.nodes[n.target];
        if (target?.kind === "binder") { const bt = ty(n.target); if (!bt) skip("a binder with no type"); else if (!same(bt, t)) bad(id, "a name is its binder's type"); break; }
        if (target?.kind === "def") { const sc = schemeOf(n.target); if (!sc) { skip("a definition with no scheme"); break; } if (!instance(sc.type, t, general(new Set(sc.vars)))) bad(id, "a use is an instance of its definition's scheme"); break; }
        if (target?.kind === "builtin") {
          // A written list (infer.ts listOfType): n items of one type.
          if (n.target === S.listOf) {
            if (t.t !== "fn" || t.ret.t !== "con" || t.ret.id !== LIST || !t.params.every((p) => same(p, (t.ret as Extract<Type, { t: "con" }>).args[0]))) bad(id, "a written list takes items of its items' type");
            break;
          }
          const sig = SIGS[n.target];
          if (!sig) { skip("a built-in with no signature"); break; }
          const s = new Subst();
          s.next = PARAM - 2000;
          const g = sig(s);
          if (!instance(g, t, (v) => v < PARAM - 1000)) skip("a built-in at a type its signature doesn't say (an interface's, a number's)");
          break;
        }
        if (target?.kind === "variant" || target?.kind === "field") {
          const dp = dataParts(n.target);
          if (!dp) { skip("a case of a type not in the code"); break; }
          // An effect's operation (infer.ts constructorType): its inputs,
          // what it returns (any type when it says none), and it performs
          // the effect.
          if (dp.td.effect && target.kind === "variant") {
            // Its own type parameters (await's `a`) as the type's are.
            const own = new Map<Id, Type>([...dp.td.params.map((q, i) => [q, { t: "var", v: PARAM - i } as Type] as const), ...(target.params ?? []).map((q, i) => [q, { t: "var", v: PARAM - 800 - i } as Type] as const)]);
            const fs = target.fields.map((f) => typeOfExpr((code.nodes[f] as NodeOf<"field">).type, own)), r = target.returns ? typeOfExpr(target.returns, own) : { t: "var", v: PARAM - 900 } as Type;
            if (!fs.every(Boolean) || !r) { skip("a field's type not written as types"); break; }
            const want: Type = { t: "fn", params: fs as Type[], ret: r, eff: { effs: [], tail: null } };
            if (!instance(want, t, (v) => general(new Set())(v) || (v <= PARAM - 800 && v >= PARAM - 900))) bad(id, "an effect's operation is used at an instance of its type");
            else if (t.t !== "fn" || !t.eff.effs.includes((dp.self as Extract<Type, { t: "con" }>).id)) bad(id, "an effect's operation performs its effect");
            break;
          }
          // An interface's operation (infer.ts fieldType): its field's type,
          // the interface's type parameters at the type implementing it.
          if (dp.td.interface && target.kind === "field" && dp.td.variants.length === 1) {
            const i = (code.nodes[dp.td.variants[0]] as NodeOf<"variant">).fields.indexOf(n.target), f = dp.fields(dp.td.variants[0])[i];
            if (!f) { skip("a field's type not written as types"); break; }
            if (!instance(f, t, general(new Set()))) bad(id, "an interface's operation is used at an instance of its type");
            break;
          }
          if (dp.td.effect || (dp.td.interface && target.kind === "field") || (target.kind === "field" && dp.td.variants.length !== 1)) { skip(dp.td.effect ? "an effect's operation" : dp.td.interface ? `an interface's ${target.kind}` : "a field several cases share"); break; }
          let want: Type | null;
          if (target.kind === "variant") { const fs = dp.fields(n.target); want = fs.every(Boolean) ? (fs.length ? { t: "fn", params: fs as Type[], ret: dp.self, eff: { effs: [], tail: null } } : dp.self) : null; }
          else { const i = (code.nodes[dp.td.variants[0]] as NodeOf<"variant">).fields.indexOf(n.target), f = dp.fields(dp.td.variants[0])[i]; want = f ? { t: "fn", params: [dp.self], ret: f, eff: { effs: [], tail: null } } : null; }
          if (!want) { skip("a field's type not written as types"); break; }
          if (!instance(want, t, general(new Set()))) bad(id, "a case or a field is used at an instance of its type");
          break;
        }
        skip(`a name of a ${target?.kind ?? "missing node"}`);
        break;
      }
      case "match": case "fold": {
        const first = n.arms.length ? (code.nodes[n.arms[0]] as NodeOf<"arm">).variant : undefined;
        if (first && ownerOf.get(first)?.effect) {
          // A handler (infer.ts handle): the handled computation gives the
          // match's value, or what `otherwise` (done(x) → …) is given;
          // each case binds its operation's inputs, and gives the answer the
          // operation returns, or the match's value (one that ends it, or
          // one given the rest of the computation as `(answer) → value`).
          // A release gives Unit. What each does is checked with the
          // handler's rows, a later step.
          if (n.kind !== "match") { bad(id, "an effect is handled with a match"); break; }
          const st = ty(n.scrutinee), ot = n.otherwise ? ty(n.otherwise) : undefined;
          const value = n.otherwise ? (ot?.t === "fn" && ot.params.length === 1 ? ot.params[0] : undefined) : t;
          if (n.otherwise && (!ot || ot.t !== "fn" || !same(ot.ret, t))) bad(id, "a handler's otherwise is given the computation's value and gives the match's");
          if (!st || !value || !same(st, value)) bad(id, "a handled computation gives the handler's value");
          const later = laterOps(code);
          for (const a of n.arms) {
            const arm = code.nodes[a] as NodeOf<"arm">, bt = ty(arm.body);
            if (!bt) { bad(id, "each case of a handler has a type"); continue; }
            if (arm.variant === RELEASE_V) { if (!(bt.t === "con" && bt.id === "std.unit")) bad(arm.id, "a release gives Unit"); continue; }
            const op = code.nodes[arm.variant] as NodeOf<"variant">, td = ownerOf.get(arm.variant)!;
            const own = new Map<Id, Type>([...td.params.map((q, i) => [q, { t: "var", v: PARAM - i } as Type] as const), ...(op.params ?? []).map((q, i) => [q, { t: "var", v: PARAM - 800 - i } as Type] as const)]);
            const fs = op.fields.map((f) => typeOfExpr((code.nodes[f] as NodeOf<"field">).type, own)), r = op.returns ? typeOfExpr(op.returns, own) : null;
            const any = (v: number) => general(new Set())(v) || (v <= PARAM - 800 && v >= PARAM - 900);
            if (fs.some((f, i) => { const b = arm.binds[i], btp = b ? ty(b) : undefined; return !f || !btp || !instance(f, btp, any); })) bad(arm.id, "a handler's case binds its operation's inputs");
            const rest = later.has(arm.variant) && arm.binds.length === fs.length + 1 ? ty(arm.binds[fs.length]) : undefined;
            if (rest) {
              if (rest.t !== "fn" || rest.params.length !== 1 || !same(rest.ret, t) || (r && !instance(r, rest.params[0], any))) bad(arm.id, "the rest of the computation is given the answer and gives the match's value");
              if (!same(bt, t)) bad(arm.id, "a case given the rest gives the match's value");
            } else if (!r) { if (!same(bt, t)) bad(arm.id, "a case of an operation that answers nothing gives the match's value"); }
            else if (!instance(r, bt, any)) bad(arm.id, "a case gives the answer its operation returns");
          }
          break;
        }
        for (const a of n.arms) {
          const arm = code.nodes[a] as NodeOf<"arm">, bt = ty(arm.body);
          if (!bt || !same(bt, t)) { bad(id, `each case of a ${n.kind} gives its type`); break; }
        }
        if (n.kind === "match" && n.otherwise) { const ot = ty(n.otherwise); if (!ot || !same(ot, t)) bad(id, "a match's otherwise gives its type"); }
        break;
      }
    }
  }
  return { problems, checked, unchecked };
}
