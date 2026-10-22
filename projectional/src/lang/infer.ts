// Type and effect inference for the core, plus the questions an editor asks
// of it: what type does this hole need, and which things could go there.
//
// Hindley-Milner over the id graph. Variables are looked up by binder id, so
// scope errors can only mean "this ref points at a binder whose lambda or arm
// doesn't enclose it", which is what an editor's cut-and-paste can cause.
// Definitions are checked in dependency order, mutually recursive groups
// together, and generalized. A recursive group whose recursion isn't
// structural gets the Diverge effect: totality is inferred, not promised.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { dependencies, ownerOfTypeParts } from "../model.ts";
import type { Names } from "../presentation.ts";
import { fillHole } from "./refactor.ts";
import { planSolve } from "./solve.ts";
import { SIGS } from "./std.ts";
import {
  CHOICE, CONSOLE, DIVERGE, EffectError, freeVars, instantiate, NUMBER, showType as showT, STRING, Subst, TypeError,
  type Row, type Scheme, type Type,
} from "./types.ts";

export interface Problem { id: Id; message: string }
// group: the definitions being checked together with the hole's own. Inside
// them, those definitions aren't generalized yet, so the palette must use
// their types as they are rather than fresh copies.
export interface HoleInfo { expected: Type; scope: { id: Id; type: Type }[]; row: Row; group: Id[] }

export interface Info {
  typeOf: Map<Id, Type>;
  schemes: Map<Id, Scheme>;
  errors: Problem[];
  holes: Map<Id, HoleInfo>;
  divergent: Set<Id>;
  subst: Subst;
  owner: Map<Id, Id>;
}

const num: Type = { t: "con", id: NUMBER, args: [] };
const str: Type = { t: "con", id: STRING, args: [] };

export function infer(code: Code, names: Names = {}): Info {
  const s = new Subst();
  const owner = ownerOfTypeParts(code);
  const info: Info = { typeOf: new Map(), schemes: new Map(), errors: [], holes: new Map(), divergent: new Set(), subst: s, owner };
  const err = (id: Id, message: string) => info.errors.push({ id, message });
  const nm = (id: Id) => names[id] ?? id;
  const show = (t: Type) => showT(s.zonk(t), names);
  const effName = (e: EffectError) => e.effects.map(nm).join(", ");

  const unifyAt = (id: Id, want: Type, got: Type, what = "") => {
    try {
      s.unify(want, got);
    } catch (e) {
      if (e instanceof EffectError) err(id, `${what || "this"} performs ${effName(e)}, which nothing here handles`);
      else if (e instanceof TypeError) err(id, `${what ? what + ": " : ""}expected ${show(want)}, got ${show(got)}`);
      else throw e;
    }
  };

  // --- types of data
  const typedefOf = (def: Id) => {
    const d = code.nodes[def];
    const body = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
    return body?.kind === "typedef" ? body : null;
  };
  const isTypeDef = (id: Id) => !!typedefOf(id);

  const typeExpr = (id: Id, params: Map<Id, Type>): Type => {
    const n = code.nodes[id];
    if (n.kind === "tfun") return { t: "fn", params: n.params.map((p) => typeExpr(p, params)), ret: typeExpr(n.result, params), eff: s.freshRow() };
    if (n.kind !== "tref") throw new Error(`${id} is not a type`);
    if (params.has(n.target)) return params.get(n.target)!;
    return { t: "con", id: n.target, args: n.args.map((a) => typeExpr(a, params)) };
  };

  // Instantiate a data type: its params as fresh variables, and each
  // variant's field types in terms of them.
  const dataType = (def: Id) => {
    const td = typedefOf(def)!;
    const params = new Map(td.params.map((p) => [p, s.fresh()] as const));
    const self: Type = { t: "con", id: def, args: [...params.values()] };
    const fields = (variant: Id) => (code.nodes[variant] as NodeOf<"variant">).fields.map((f) => typeExpr((code.nodes[f] as NodeOf<"field">).type, params));
    return { td, self, fields };
  };

  // A field is recursive if its type is the data type itself, applied to its
  // own params in order. Those are the fields a fold folds.
  const isRecursiveField = (def: Id, field: Id) => {
    const td = typedefOf(def)!;
    const t = code.nodes[(code.nodes[field] as NodeOf<"field">).type];
    return t.kind === "tref" && t.target === def && t.args.length === td.params.length &&
      t.args.every((a, i) => { const x = code.nodes[a]; return x.kind === "tref" && x.target === td.params[i]; });
  };

  // --- definitions, in dependency order
  const valueDefs = code.defs.filter((d) => !isTypeDef(d) && code.nodes[d]?.kind === "def");
  const deps = (d: Id): Id[] => {
    const out = new Set<Id>();
    const walk = (id: Id) => {
      const n = code.nodes[id];
      if (!n) return;
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "def" && !isTypeDef(n.target)) out.add(n.target);
      // a function run backwards is used too: its type gives the ports' types
      if (n.kind === "solve" && code.nodes[n.fn]?.kind === "def") out.add(n.fn);
      for (const c of kids(n)) walk(c);
    };
    const body = (code.nodes[d] as NodeOf<"def">).body;
    if (body) walk(body);
    return [...out];
  };
  const groups = sccs(valueDefs, deps);

  const mono = new Map<Id, Type>();
  let current: Id[] = [];
  for (const group of groups) {
    current = group;
    for (const d of group) mono.set(d, s.fresh());
    for (const d of group) {
      const body = (code.nodes[d] as NodeOf<"def">).body;
      if (body === null) {
        err(d, "extern: no body to check");
        continue;
      }
      // A definition's own value must be pure: anything that acts is a
      // function (an "action" with no inputs) and acts when called.
      const t = expr(body, new Map(), { effs: [], tail: null });
      unifyAt(d, mono.get(d)!, t);
    }
    const recursive = group.length > 1 || deps(group[0]).includes(group[0]);
    if (recursive && !structural(code, group)) {
      for (const d of group) {
        info.divergent.add(d);
        const t = s.resolve(mono.get(d)!);
        if (t.t === "fn") s.unifyRow(t.eff, { effs: [DIVERGE], tail: s.next++ });
      }
    }
    for (const d of group) {
      const t = s.zonk(mono.get(d)!);
      const fv = freeVars(t, s);
      info.schemes.set(d, { vars: [...fv.vars], rows: [...fv.rows], type: t });
      mono.delete(d);
      info.typeOf.set(d, t);
    }
  }

  function refType(id: Id, target: Id, env: Map<Id, Type>): Type {
    const t = code.nodes[target];
    if (!t) { err(id, "points at nothing"); return s.fresh(); }
    switch (t.kind) {
      case "binder":
        if (env.has(target)) return env.get(target)!;
        err(id, `${nm(target)} is used outside the function or case that introduces it`);
        return s.fresh();
      case "def":
        if (isTypeDef(target)) { err(id, `${nm(target)} is a type, not a value`); return s.fresh(); }
        if (mono.has(target)) return mono.get(target)!;
        if (info.schemes.has(target)) return instantiate(info.schemes.get(target)!, s);
        return s.fresh();
      case "builtin":
        if (SIGS[target]) return SIGS[target](s);
        err(id, `${nm(target)} has no type here (a relation is used inside a network)`);
        return s.fresh();
      case "variant": {
        const { self, fields } = dataType(owner.get(target)!);
        const fs = fields(target);
        return fs.length ? { t: "fn", params: fs, ret: self, eff: s.freshRow() } : self;
      }
      case "field": {
        const def = owner.get(target)!;
        const { td, self, fields } = dataType(def);
        if (td.variants.length !== 1) { err(id, `${nm(target)} belongs to one case of ${nm(def)}; use a match to reach it`); return s.fresh(); }
        const i = (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.indexOf(target);
        return { t: "fn", params: [self], ret: fields(td.variants[0])[i], eff: s.freshRow() };
      }
      default:
        err(id, `can't refer to a ${t.kind}`);
        return s.fresh();
    }
  }

  // Infers the type of expression `id`. `row` is the effect row of the
  // enclosing function body: every call adds its effects to it.
  function expr(id: Id, env: Map<Id, Type>, row: Row): Type {
    const n = code.nodes[id];
    let t: Type;
    switch (n?.kind) {
      case "lit": t = typeof n.value === "number" ? num : str; break;
      case "ref": t = refType(id, n.target, env); break;
      case "hole":
        t = s.fresh();
        info.holes.set(id, { expected: t, scope: [...env].map(([b, bt]) => ({ id: b, type: bt })), row, group: current });
        break;
      case "lambda": {
        const inner = new Map(env);
        const params = n.params.map((p) => { const pt = s.fresh(); inner.set(p, pt); info.typeOf.set(p, pt); return pt; });
        const bodyRow = s.freshRow();
        t = { t: "fn", params, ret: expr(n.body, inner, bodyRow), eff: bodyRow };
        break;
      }
      case "call": {
        const f = expr(n.fn, env, row);
        const args = n.args.map((a) => expr(a, env, row));
        const ret = s.fresh();
        const fr = s.resolve(f);
        if (fr.t === "fn" && fr.params.length !== args.length) {
          err(id, `${callee(n)} takes ${fr.params.length} inputs, given ${args.length}`);
          t = fr.ret;
          break;
        }
        try {
          s.unify(f, { t: "fn", params: args, ret, eff: row });
        } catch (e) {
          if (e instanceof EffectError) err(id, `${callee(n)} performs ${effName(e)}, which nothing here handles`);
          else if (e instanceof TypeError) {
            // Find the argument that's wrong, for a useful message.
            const ft = s.resolve(f);
            if (ft.t !== "fn") err(id, `${callee(n)} is ${show(f)}, not a function`);
            else ft.params.forEach((p, i) => { try { s.clone().unify(p, args[i]); } catch { err(n.args[i], `${callee(n)} needs ${show(p)} here, got ${show(args[i])}`); } });
          } else throw e;
        }
        t = ret;
        break;
      }
      case "match":
      case "fold":
        t = cases(n, env, row);
        break;
      case "solve":
        t = solveType(n, env, row);
        break;
      default:
        err(id, `a ${n?.kind ?? "missing node"} is not an expression`);
        t = s.fresh();
    }
    info.typeOf.set(id, t);
    return t;
  }

  // A relation used in one direction: given ports are numbers, solved ports
  // are numbers bound in the body, and Choice unless the answer is unique.
  // A function run backwards by the relational interpreter instead takes
  // its port types from the function's own type.
  function solveType(n: NodeOf<"solve">, env: Map<Id, Type>, row: Row): Type {
    const inner = new Map(env);
    let p: ReturnType<typeof planSolve> | null = null;
    try { p = planSolve(code, n); } catch (e) { err(n.id, (e as Error).message); }
    if (p?.mode === "relational") {
      relationalSolve(n, env, row, inner, p.loops);
      return expr(n.body, inner, row);
    }
    for (const g of Object.values(n.given)) unifyAt(g, num, expr(g, env, row), "a given port");
    for (const b of Object.values(n.binds)) { inner.set(b, num); info.typeOf.set(b, num); }
    if (p) {
      const ports = p.rel!.ports;
      for (const k of [...Object.keys(n.given), ...Object.keys(n.binds)]) if (!ports.includes(k)) err(n.id, `${nm(n.fn)} has no port ${k}`);
      if (p.status !== "solved") err(n.id, `${nm(n.fn)} needs ${p.needMore} more known port${p.needMore === 1 ? "" : "s"} to be solved this way`);
      else if (!p.unique) choice(n.id, row, [CHOICE], `solving ${nm(n.fn)} this way may give several answers or none (Choice), which nothing here handles`);
    }
    return expr(n.body, inner, row);
  }

  function choice(id: Id, row: Row, effs: Id[], message: string) {
    try { s.unifyRow(row, { effs, tail: s.next++ }); }
    catch (e) { if (e instanceof EffectError) err(id, message); else throw e; }
  }

  // Ports of a function: its params (by binder id, or by position for a
  // builtin) and "out", typed from the function's type. Running backwards
  // adds Choice (any number of answers), Diverge when it may unfold
  // forever, and whatever the function itself does, except printing, which
  // can't be undone.
  function relationalSolve(n: NodeOf<"solve">, env: Map<Id, Type>, row: Row, inner: Map<Id, Type>, loops: boolean) {
    const ft = s.resolve(refType(n.id, n.fn, env));
    if (ft.t !== "fn") { err(n.id, `${nm(n.fn)} is not a function`); return; }
    const t = code.nodes[n.fn];
    const keys = t.kind === "def" ? (code.nodes[t.body!] as NodeOf<"lambda">).params : ft.params.map((_, i) => String(i));
    const portType = (k: string) => (k === "out" ? ft.ret : keys.includes(k) ? ft.params[keys.indexOf(k)] : null);
    for (const [k, g] of Object.entries(n.given)) {
      const pt = portType(k);
      const gt = expr(g, env, row);
      if (pt) unifyAt(g, pt, gt, "a given port"); else err(n.id, `${nm(n.fn)} has no port ${k}`);
    }
    for (const [k, b] of Object.entries(n.binds)) {
      const pt = portType(k) ?? s.fresh();
      if (!portType(k)) err(n.id, `${nm(n.fn)} has no port ${k}`);
      inner.set(b, pt);
      info.typeOf.set(b, pt);
    }
    const own = s.resolveRow(ft.eff).effs;
    if (own.includes(CONSOLE)) err(n.id, `${nm(n.fn)} prints, and printing can't be run backwards`);
    const effs = [...new Set([CHOICE, ...(loops ? [DIVERGE] : []), ...own.filter((e) => e !== CONSOLE)])];
    choice(n.id, row, effs, `running ${nm(n.fn)} backwards may give several answers or none (Choice)${loops ? " and may search forever (Diverge)" : ""}, which nothing here handles`);
  }

  function callee(n: NodeOf<"call">): string {
    const f = code.nodes[n.fn];
    return f.kind === "ref" ? nm(f.target) : "this function";
  }

  function cases(n: NodeOf<"match"> | NodeOf<"fold">, env: Map<Id, Type>, row: Row): Type {
    const scrut = expr(n.scrutinee, env, row);
    const result = s.fresh();
    const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
    const def = arms.length ? owner.get(arms[0].variant) : undefined;
    if (!def) {
      if (n.kind === "fold" || !n.otherwise) err(n.id, "a case analysis needs at least one case");
    } else {
      const { td, self, fields } = dataType(def);
      unifyAt(n.scrutinee, self, scrut, "the value examined");
      const seen = new Set<Id>();
      for (const arm of arms) {
        if (owner.get(arm.variant) !== def) { err(arm.id, `${nm(arm.variant)} is not a case of ${nm(def)}`); continue; }
        if (seen.has(arm.variant)) err(arm.id, `${nm(arm.variant)} is handled twice`);
        seen.add(arm.variant);
        const fs = fields(arm.variant);
        const fids = (code.nodes[arm.variant] as NodeOf<"variant">).fields;
        if (arm.binds.length !== fs.length) err(arm.id, `${nm(arm.variant)} has ${fs.length} fields, ${arm.binds.length} bound`);
        const inner = new Map(env);
        arm.binds.forEach((b, i) => { if (fs[i]) { inner.set(b, fs[i]); info.typeOf.set(b, fs[i]); } });
        if (n.kind === "fold") {
          arm.results.forEach((r, i) => {
            if (r === null) return;
            if (!isRecursiveField(def, fids[i])) err(arm.id, `${nm(fids[i])} is not recursive, so it has no folded value`);
            inner.set(r, result);
            info.typeOf.set(r, result);
          });
        }
        unifyAt(arm.body, result, expr(arm.body, inner, row), "this case");
      }
      const missing = td.variants.filter((v) => !seen.has(v));
      const otherwise = n.kind === "match" ? n.otherwise : null;
      if (missing.length && !otherwise) err(n.id, `no case for ${missing.map(nm).join(", ")}`);
      if (!missing.length && otherwise) err(otherwise, "every case is already handled, so this one can never run");
    }
    if (n.kind === "match" && n.otherwise) unifyAt(n.otherwise, result, expr(n.otherwise, env, row), "the other cases");
    return result;
  }

  for (const [id, t] of info.typeOf) info.typeOf.set(id, s.zonk(t));
  for (const h of info.holes.values()) {
    h.expected = s.zonk(h.expected);
    h.scope = h.scope.map((b) => ({ id: b.id, type: s.zonk(b.type) }));
  }
  return info;
}

// Children that are expressions or binders (types and variants excluded).
function kids(n: Node): Id[] {
  switch (n.kind) {
    case "call": return [n.fn, ...n.args];
    case "lambda": return [n.body];
    case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms];
    case "arm": return [n.body];
    case "solve": return [...Object.values(n.given), n.body];
    default: return [];
  }
}

// Tarjan's algorithm. Returns groups with dependencies before dependents.
function sccs(ids: Id[], deps: (id: Id) => Id[]): Id[][] {
  const index = new Map<Id, number>(), low = new Map<Id, number>(), on = new Set<Id>();
  const stack: Id[] = [], out: Id[][] = [];
  const set = new Set(ids);
  const visit = (v: Id) => {
    index.set(v, index.size); low.set(v, index.get(v)!); stack.push(v); on.add(v);
    for (const w of deps(v).filter((x) => set.has(x))) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const g: Id[] = [];
      let w: Id;
      do { w = stack.pop()!; on.delete(w); g.push(w); } while (w !== v);
      out.push(g);
    }
  };
  ids.forEach((v) => { if (!index.has(v)) visit(v); });
  return out;
}

// The termination check, in the style of Coq's guard condition but much
// smaller: every recursive call must pass, in some input position, a value
// that a match took apart from what that same position received. Such a
// call works on a strictly smaller piece of finite data, so the recursion
// ends. Anything else (including passing the function around as a value)
// counts as possibly divergent.
function structural(code: Code, group: Id[]): boolean {
  const inGroup = new Set(group);
  for (const d of group) {
    const body = (code.nodes[d] as NodeOf<"def">).body;
    const lam = body ? code.nodes[body] : null;
    if (lam?.kind !== "lambda") return false;
    // smaller.get(b) = the param positions b is a strict sub-part of
    const smaller = new Map<Id, Set<number>>();
    const params = lam.params;
    const positionsOf = (id: Id): Set<number> => {
      const n = code.nodes[id];
      if (n.kind !== "ref") return new Set();
      const i = params.indexOf(n.target);
      return i >= 0 ? new Set([i]) : smaller.get(n.target) ?? new Set();
    };
    let ok = true;
    const walk = (id: Id, inCallHead = false) => {
      const n = code.nodes[id];
      if (n.kind === "ref" && inGroup.has(n.target) && !inCallHead) ok = false;
      if (n.kind === "call") {
        const f = code.nodes[n.fn];
        if (f.kind === "ref" && inGroup.has(f.target)) {
          const guarded = n.args.some((a, i) => {
            const an = code.nodes[a];
            return an.kind === "ref" && params.indexOf(an.target) < 0 && (smaller.get(an.target)?.has(i) ?? false);
          });
          if (!guarded) ok = false;
          n.args.forEach((a) => walk(a));
          return;
        }
      }
      if (n.kind === "match" || n.kind === "fold") {
        const from = positionsOf(n.scrutinee);
        // Taken apart from a param (or a piece of one): the pieces are smaller.
        // Includes the "original" binders in a fold's arms.
        for (const a of n.arms) for (const b of (code.nodes[a] as NodeOf<"arm">).binds) if (from.size) smaller.set(b, new Set(from));
      }
      for (const c of kids(n)) walk(c, n.kind === "call" && c === n.fn);
    };
    walk(lam.body);
    if (!ok) return false;
  }
  return true;
}

// ---------------------------------------------------------------- editor API

export type Filling =
  | { kind: "ref"; target: Id; type: Type }
  | { kind: "call"; target: Id; arity: number; type: Type }
  | { kind: "lit"; of: "number" | "text" }
  | { kind: "match" | "fold"; on: Id; type: Id }
  | { kind: "lambda"; arity: number };

// Everything that can go in a hole without a type or effect error: variables
// in scope, definitions, builtins and constructors (as values, or called with
// holes for their inputs when their result fits), literals, and a case
// analysis of any data in scope. This is the editor's palette: it never
// offers something that would be an error, so the user can't make one.
export function fillings(code: Code, info: Info, hole: Id): Filling[] {
  const h = info.holes.get(hole);
  if (!h) return [];
  const out: Filling[] = [];
  // Variables of the enclosing definitions' types. A filling that pins one
  // of them down changes what callers see, which may break a caller far
  // away; those fillings are confirmed by checking the whole program.
  const pinned = h.group.flatMap((d) => { const sc = info.schemes.get(d); return sc ? [...sc.vars.map((v) => `t${v}`), ...sc.rows.map((r) => `r${r}`)] : []; });
  const fits = (t: Type, asCall: boolean): Subst | null => {
    const s = info.subst.clone();
    try {
      if (!asCall) { s.unify(h.expected, t); return s; }
      const r = s.resolve(t);
      if (r.t !== "fn") return null;
      s.unify(h.expected, r.ret);
      s.unifyRow(r.eff, h.row);
      return s;
    } catch (e) {
      if (e instanceof TypeError) return null;
      throw e;
    }
  };
  const safe = (s: Subst, f: Filling, risky: boolean) => {
    const touches = pinned.some((k) => (k[0] === "t" ? s.types.has(+k.slice(1)) : s.rows.has(+k.slice(1))));
    return (!touches && !risky) || infer(fillHole(code, {}, hole, f).code).errors.length === 0;
  };
  const consider = (target: Id, t: Type, risky = false) => {
    const asRef = fits(t, false);
    const ref: Filling = { kind: "ref", target, type: t };
    if (asRef && safe(asRef, ref, risky)) out.push(ref);
    const r = info.subst.resolve(t);
    const asCall = r.t === "fn" ? fits(t, true) : null;
    const call: Filling = { kind: "call", target, arity: r.t === "fn" ? r.params.length : 0, type: t };
    if (asCall && safe(asCall, call, risky)) out.push(call);
  };
  for (const b of h.scope) consider(b.id, b.type);
  // Referring to a def that itself depends on this one makes them one
  // recursive group, checked without generalization: also confirmed.
  for (const [d, sc] of info.schemes) {
    if (h.group.includes(d)) consider(d, sc.type);
    else consider(d, instantiate(sc, info.subst), dependencies(code, d).some((x) => h.group.includes(x)));
  }
  for (const [id, sig] of Object.entries(SIGS)) consider(id, sig(info.subst));
  for (const [part, def] of info.owner) {
    if (code.nodes[part].kind === "variant") consider(part, constructorType(code, info.subst, def, part));
  }
  const lit = (of: "number" | "text", t: Type) => { const f: Filling = { kind: "lit", of }; const s = fits(t, false); if (s && safe(s, f, false)) out.push(f); };
  lit("number", num);
  lit("text", str);
  const ex = info.subst.resolve(h.expected);
  if (ex.t === "fn") out.push({ kind: "lambda", arity: ex.params.length });
  for (const b of h.scope) {
    const bt = info.subst.resolve(b.type);
    if (bt.t === "con" && info.owner.size && [...info.owner.values()].includes(bt.id)) {
      out.push({ kind: "match", on: b.id, type: bt.id });
      out.push({ kind: "fold", on: b.id, type: bt.id });
    }
  }
  return out;
}

// A variant's constructor type with fresh variables (same as infer's refType).
function constructorType(code: Code, s: Subst, def: Id, variant: Id): Type {
  const td = code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const params = new Map(td.params.map((p) => [p, s.fresh()] as const));
  const te = (tid: Id): Type => {
    const t = code.nodes[tid];
    if (t.kind === "tfun") return { t: "fn", params: t.params.map(te), ret: te(t.result), eff: s.freshRow() };
    const r = t as NodeOf<"tref">;
    return params.get(r.target) ?? { t: "con", id: r.target, args: r.args.map(te) };
  };
  const self: Type = { t: "con", id: def, args: [...params.values()] };
  const fs = (code.nodes[variant] as NodeOf<"variant">).fields.map((f) => te((code.nodes[f] as NodeOf<"field">).type));
  return fs.length ? { t: "fn", params: fs, ret: self, eff: s.freshRow() } : self;
}
