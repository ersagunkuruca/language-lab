// Type and effect inference for the core, plus the questions an editor asks
// of it: what type does this hole need, and which things could go there.
//
// Hindley-Milner over the id graph. Variables are looked up by binder id, so
// scope errors can only mean "this ref points at a binder whose lambda or arm
// doesn't enclose it", which is what an editor's cut-and-paste can cause.
// Definitions are checked in dependency order, mutually recursive groups
// together, and generalized. A recursive group that can't be shown to end
// (size-change termination, at the end of this file) gets the Diverge
// effect: totality is inferred, not promised. Data types must be strictly
// positive, so data can't be used to recurse without recursion.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { ownerOfTypeParts, subtree } from "../model.ts";
import type { Names } from "../presentation.ts";
import { unitProblems } from "../units.ts";
import { fillHole } from "./refactor.ts";
import { planSolve } from "./solve.ts";
import { BOOL, SET, SIGS } from "./std.ts";
import { fieldPath } from "./records.ts";
import {
  CHOICE, CONSOLE, DIVERGE, EffectError, freeVars, instantiate, NUMBER, PlainError, showType as showT, STRING, Subst, TypeError,
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
const bool: Type = { t: "con", id: BOOL, args: [] };

// `reuse` rechecks only the definitions in `only` and takes the others'
// types from an earlier check of the same program (the palette uses this to
// try a filling against just the definitions it can affect).
export function infer(code: Code, names: Names = {}, reuse?: { from: Info; only: Set<Id> }): Info {
  const s = new Subst();
  if (reuse) s.next = reuse.from.subst.next;
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
      else if (e instanceof PlainError) err(id, `${what ? what + ": " : ""}${show(got)} has functions in it, and only plain data can be used here`);
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
  const fieldTypes = (def: Id) => typedefOf(def)!.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant"> | undefined)?.fields ?? [])
    .flatMap((f) => { const n = code.nodes[f]; return n?.kind === "field" ? [{ field: f, type: n.type }] : []; });

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
    return { td, params, self, fields };
  };

  // The folded value of a field: its type with the data type itself
  // replaced by the fold's result. A field of type Tree gives R; one of type
  // List Tree (a rose tree's children) gives List R, the fold mapped over
  // the container; null if the field has no Tree in it. A string says why
  // the fold can't reach a Tree that is in it.
  const foldedType = (def: Id, tid: Id, params: Map<Id, Type>, result: Type): Type | null | string => {
    const t = code.nodes[tid];
    const targets = trefTargets(tid);
    const via = [...targets].find((x) => x !== def && isTypeDef(x) && reachOf(x).has(def));
    if (via) return `${nm(via)} is defined together with ${nm(def)}, so a fold over ${nm(def)} can't see inside it`;
    if (!targets.has(def)) return null;
    if (t.kind === "tfun") return `a fold can't go inside a function`;
    if (t.kind !== "tref") return null;
    const td = typedefOf(def)!;
    if (t.target === def) {
      const same = t.args.length === td.params.length && t.args.every((a, i) => { const x = code.nodes[a]; return x.kind === "tref" && x.target === td.params[i]; });
      return same ? result : `${nm(def)} is used here with other arguments, so this isn't the same data a fold folds`;
    }
    const args: Type[] = [];
    for (const a of t.args) {
      const r = foldedType(def, a, params, result);
      if (typeof r === "string") return r;
      args.push(r ?? typeExpr(a, params));
    }
    return { t: "con", id: t.target, args };
  };

  // --- plain data
  // A data type is plain when none of its fields holds a function, given
  // that the params it puts in fields are plain. plainShape(T) is the set of
  // T's params that must be plain, or null if T holds functions anyway.
  const plainParams = new Map<Id, Set<number> | null>();
  const plainShape = (def: Id): Set<number> | null => {
    if (plainParams.has(def)) return plainParams.get(def)!;
    const td = typedefOf(def);
    plainParams.set(def, new Set()); // builtins; and a type's mention of itself adds nothing
    if (!td) return new Set();
    const need = new Set<number>();
    let ok = true;
    const walk = (tid: Id) => {
      const t = code.nodes[tid];
      if (t.kind === "tfun") { ok = false; return; }
      if (t.kind !== "tref") return;
      const i = td.params.indexOf(t.target);
      if (i >= 0) { need.add(i); return; }
      const inner = plainShape(t.target);
      if (!inner) { ok = false; return; }
      t.args.forEach((a, j) => { if (inner.has(j)) walk(a); });
    };
    for (const { type } of fieldTypes(def)) walk(type);
    plainParams.set(def, ok ? need : null);
    return ok ? need : null;
  };
  s.plainArgs = (id, args) => { const need = plainShape(id); return need && args.filter((_, i) => need.has(i)); };

  // --- strict positivity
  // A data type may not take itself as an input in its own fields, directly
  // or through another type. With `knot = wrap(f: knot → Number)`,
  // `apply(x) = match x | wrap(f) → f(x)` calls itself through the data
  // with no recursion anywhere, and `apply(wrap(apply))` never ends. As an
  // output it's fine: `() → Stream` is how lazy data is written.
  const typeDefs = code.defs.filter(isTypeDef);
  const trefTargets = (tid: Id) => trefTargetsIn(code, tid);
  const reach = new Map<Id, Set<Id>>();
  // The data types a T can contain, T included.
  const reachOf = (def: Id): Set<Id> => {
    if (reach.has(def)) return reach.get(def)!;
    const out = new Set<Id>([def]);
    reach.set(def, out);
    for (const { type } of fieldTypes(def)) for (const t of trefTargets(type)) if (isTypeDef(t)) reachOf(t).forEach((x) => out.add(x));
    return out;
  };
  const positiveParam = new Map<string, boolean>();
  // Is T's param i only used strictly positively in T's fields?
  const paramPositive = (T: Id, i: number): boolean => {
    const key = `${T}#${i}`;
    if (!positiveParam.has(key)) {
      positiveParam.set(key, true); // assumed while it's being checked
      const p = typedefOf(T)!.params[i];
      positiveParam.set(key, fieldTypes(T).every(({ type }) => positive(type, (t) => t === p, false)));
    }
    return positiveParam.get(key)!;
  };
  // Does type expression tid use the types `is` picks out only strictly
  // positively (never left of an arrow, also not inside another type)?
  function positive(tid: Id, is: (t: Id) => boolean, under: boolean): boolean {
    const t = code.nodes[tid];
    if (t?.kind === "tfun") return t.params.every((p) => positive(p, is, true)) && positive(t.result, is, under);
    if (t?.kind !== "tref") return true;
    const touches = (x: Id) => is(x) || (isTypeDef(x) && [...reachOf(x)].some(is));
    if (under && touches(t.target)) return false;
    return t.args.every((a, i) => {
      const inside = [...trefTargets(a)].some(touches);
      if (inside && isTypeDef(t.target) && !paramPositive(t.target, i)) return false;
      return positive(a, is, under);
    });
  }
  for (const def of typeDefs) {
    // the type itself, and any type it's defined together with
    const self = (t: Id) => t === def || (isTypeDef(t) && reachOf(t).has(def) && reachOf(def).has(t));
    for (const { field, type } of fieldTypes(def)) {
      if (!positive(type, self, false)) err(field, `${nm(def)} can't take itself as an input in its own field ${nm(field)}: through it, a function could call itself without recursion and never end`);
    }
  }

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
  // Definitions not rechecked keep their earlier types.
  if (reuse) for (const d of valueDefs) {
    if (reuse.only.has(d)) continue;
    const sc = reuse.from.schemes.get(d);
    if (sc) { info.schemes.set(d, sc); info.typeOf.set(d, sc.type); }
    if (reuse.from.divergent.has(d)) info.divergent.add(d);
  }
  const groups = sccs(reuse ? valueDefs.filter((d) => reuse.only.has(d)) : valueDefs, deps);

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
    // Only functions can be recursive: a value defined in terms of itself
    // (ones = cons(1, ones)) has no first step to take.
    if (recursive) for (const d of group) {
      const body = (code.nodes[d] as NodeOf<"def">).body;
      if (body && code.nodes[body].kind !== "lambda") err(d, `${nm(d)} is defined in terms of itself; only a function can be recursive`);
    }
    if (recursive && !terminates(code, group)) {
      for (const d of group) {
        info.divergent.add(d);
        const t = s.resolve(mono.get(d)!);
        if (t.t === "fn") s.unifyRow(t.eff, { effs: [DIVERGE], tail: s.next++ });
      }
    }
    for (const d of group) {
      const t = s.zonk(mono.get(d)!);
      const fv = freeVars(t, s);
      info.schemes.set(d, { vars: [...fv.vars], rows: [...fv.rows], type: t, plain: [...fv.vars].filter((v) => s.plain.has(v)) });
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
        err(id, `${nm(target)} has no type`);
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
      case "lit": t = n.of ? { t: "con", id: n.of, args: [] } : typeof n.value === "number" ? num : str; break;
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
          else if (e instanceof PlainError) err(id, `${callee(n)} works only on plain data (no functions inside), and this has functions in it`);
          else if (e instanceof TypeError) {
            // Find the argument that's wrong, for a useful message.
            const ft = s.resolve(f);
            if (ft.t !== "fn") err(id, `${callee(n)} is ${show(f)}, not a function`);
            else ft.params.forEach((p, i) => { try { s.clone().unify(p, args[i]); } catch { err(n.args[i], `${callee(n)} needs ${show(p)} here, got ${show(args[i])}`); } });
          } else throw e;
        }
        // An update needs to know which field it changes, so its first input
        // is a field or a path of them, written in place (or a hole, still
        // to be filled with one).
        if (code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === SET && n.args.length && !fieldPath(code, n.args[0], true)
          && !info.errors.some((e) => e.id === n.args[0])) {
          err(n.args[0], "set needs a field here, or a path of fields such as (p) ↦ p.address.city");
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
    // A predicate's out = true is a Bool; every other port is a number.
    const outTrue = (k: string) => !!p?.predicate && k === "out";
    for (const [k, g] of Object.entries(n.given)) unifyAt(g, outTrue(k) ? bool : num, expr(g, env, row), "a given port");
    for (const b of Object.values(n.binds)) { inner.set(b, num); info.typeOf.set(b, num); }
    if (p) {
      const ports = p.rel!.ports;
      for (const k of [...Object.keys(n.given), ...Object.keys(n.binds)]) if (!ports.includes(k) && !outTrue(k)) err(n.id, `${nm(n.fn)} has no port ${k}`);
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
      // An answer is a value found by search; a function can't be guessed.
      try { s.requirePlain(pt); } catch (e) {
        if (e instanceof PlainError) err(n.id, `${nm(b)} can't be solved for: it has functions in it, and functions can't be guessed`); else throw e;
      }
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
      const { td, params, self, fields } = dataType(def);
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
            const ft = foldedType(def, (code.nodes[fids[i]] as NodeOf<"field">).type, params, result);
            if (ft === null) err(arm.id, `${nm(fids[i])} is not recursive, so it has no folded value`);
            else if (typeof ft === "string") err(arm.id, `${nm(fids[i])} can't be folded: ${ft}`);
            const rt = ft && typeof ft !== "string" ? ft : s.fresh();
            inner.set(r, rt);
            info.typeOf.set(r, rt);
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

  // Units are part of a number's type: a conflict is a type error.
  for (const u of unitProblems(code)) err(u.id, u.message);

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

// Every type a type expression mentions.
function trefTargetsIn(code: Code, tid: Id, out = new Set<Id>()): Set<Id> {
  const t = code.nodes[tid];
  if (t?.kind === "tfun") { t.params.forEach((p) => trefTargetsIn(code, p, out)); trefTargetsIn(code, t.result, out); }
  if (t?.kind === "tref") { out.add(t.target); t.args.forEach((a) => trefTargetsIn(code, a, out)); }
  return out;
}

// The termination check: size-change termination (Lee, Jones and Ben-Amram,
// 2001), on the order "is a piece of".
//
// Each recursive call gives a graph from the caller's inputs to the
// callee's: an arc i → j when the callee's input j is the caller's input i
// (≥) or a piece a match took apart from it (>). Lets are transparent: a
// dot naming a piece is still that piece. Composing graphs follows a chain
// of calls. The group ends if every chain that comes back to where it
// started (every idempotent graph from f to f) has an input that strictly
// shrinks along it: data is finite (data types are strictly positive and
// values aren't recursive), so a shrinking input can't shrink forever.
//
// This accepts every recursion on one decreasing argument, lexicographic
// orders (ackermann), and arguments that swap places, and rejects ping-pong
// recursion where each call shrinks one argument while growing the other.
// Passing a function of the group around as a value counts as possibly
// divergent.
type Arc = [from: number, to: number, strict: boolean];
interface CallGraph { from: Id; to: Id; arcs: Arc[] }

function terminates(code: Code, group: Id[]): boolean {
  const inGroup = new Set(group);
  const graphs: CallGraph[] = [];
  for (const d of group) {
    const body = (code.nodes[d] as NodeOf<"def">).body;
    const lam = body ? code.nodes[body] : null;
    if (lam?.kind !== "lambda") return false;
    // size.get(b): for each input i that b is (false) or is a piece of (true)
    const size = new Map<Id, Map<number, boolean>>(lam.params.map((p, i) => [p, new Map([[i, false]])]));
    const sizeOf = (id: Id | undefined) => {
      const n = id === undefined ? null : code.nodes[id];
      return n?.kind === "ref" ? size.get(n.target) : undefined;
    };
    let ok = true;
    const walk = (id: Id) => {
      const n = code.nodes[id];
      if (n.kind === "ref" && inGroup.has(n.target)) ok = false;
      if (n.kind === "call") {
        const f = code.nodes[n.fn];
        if (f.kind === "ref" && inGroup.has(f.target)) {
          const arcs: Arc[] = [];
          n.args.forEach((a, j) => sizeOf(a)?.forEach((strict, i) => arcs.push([i, j, strict])));
          graphs.push({ from: d, to: f.target, arcs });
          n.args.forEach(walk);
          return;
        }
        if (f.kind === "lambda") {
          f.params.forEach((p, i) => { const sz = sizeOf(n.args[i]); if (sz) size.set(p, new Map(sz)); });
          n.args.forEach(walk);
          walk(f.body);
          return;
        }
      }
      if (n.kind === "match" || n.kind === "fold") {
        const from = sizeOf(n.scrutinee);
        if (from) {
          for (const a of n.arms) {
            for (const b of (code.nodes[a] as NodeOf<"arm">).binds) size.set(b, new Map([...from.keys()].map((i) => [i, true])));
          }
        }
      }
      kids(n).forEach(walk);
    };
    walk(lam.body);
    if (!ok) return false;
  }

  const norm = (from: Id, to: Id, arcs: Arc[]): CallGraph => {
    const best = new Map<string, Arc>();
    for (const [i, j, strict] of arcs) {
      const k = `${i},${j}`;
      best.set(k, [i, j, strict || (best.get(k)?.[2] ?? false)]);
    }
    return { from, to, arcs: [...best.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
  };
  const key = (g: CallGraph) => `${g.from}\u0000${g.to}\u0000${g.arcs.map((a) => a.join(",")).join(";")}`;
  const compose = (g: CallGraph, h: CallGraph) =>
    norm(g.from, h.to, g.arcs.flatMap(([i, j, s1]) => h.arcs.filter(([k]) => k === j).map(([, l, s2]): Arc => [i, l, s1 || s2])));
  const all = new Map<string, CallGraph>();
  const todo = graphs.map((g) => norm(g.from, g.to, g.arcs));
  while (todo.length) {
    const g = todo.pop()!;
    if (all.has(key(g))) continue;
    all.set(key(g), g);
    for (const h of [...all.values()]) {
      if (g.to === h.from) todo.push(compose(g, h));
      if (h.to === g.from) todo.push(compose(h, g));
    }
  }
  return [...all.values()].every((g) => g.from !== g.to || key(compose(g, g)) !== key(g) || g.arcs.some(([i, j, strict]) => i === j && strict));
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
  // Checking the whole program costs a full inference, so it's shared:
  // what callers can see of a filling is only what it makes of the group's
  // types, and fillings that make the same of them pass or fail together.
  // Only the group and what depends on it can be affected, so only they
  // are rechecked. That holds for a filling that makes a new recursive
  // group too: everything in it already depends on this group.
  const affected = dependents(code, h.group);
  let before: number | undefined;
  const recheck = (c: Code) => infer(c, {}, { from: info, only: affected }).errors.length;
  const whole = (f: Filling) => recheck(fillHole(code, {}, hole, f).code) <= (before ??= recheck(code));
  // Running a function backwards depends on its body, not just its type
  // (a call that may search forever makes the search Diverge), so if the
  // group is run backwards anywhere, every filling is checked on its own.
  const solvedOn = Object.values(code.nodes).some((n) => (n.kind === "solve" || n.kind === "part") && !!n.fn && h.group.includes(n.fn));
  const checked = new Map<string, boolean>();
  const safe = (s: Subst, f: Filling, risky: boolean) => {
    if (risky || solvedOn) return whole(f);
    const touches = pinned.some((k) => (k[0] === "t" ? s.types.has(+k.slice(1)) : s.rows.has(+k.slice(1))));
    if (!touches) return true;
    const key = groupKey(s, h.group.flatMap((d) => { const sc = info.schemes.get(d); return sc ? [sc.type] : []; }));
    if (!checked.has(key)) checked.set(key, whole(f));
    return checked.get(key)!;
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
  // Referring to the group itself, or to a def that depends on it, makes a
  // recursive group whose checks (does it end?) see the body: confirmed.
  for (const [d, sc] of info.schemes) {
    if (h.group.includes(d)) consider(d, sc.type, true);
    else consider(d, instantiate(sc, info.subst), affected.has(d));
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
  const dataTypes = [...new Set(info.owner.values())];
  for (const b of h.scope) {
    const bt = info.subst.resolve(b.type);
    if (bt.t === "con" && dataTypes.includes(bt.id)) {
      out.push({ kind: "match", on: b.id, type: bt.id });
      out.push({ kind: "fold", on: b.id, type: bt.id });
    } else if (bt.t === "var") {
      // Nothing says what it is yet (a new input, say): splitting it by the
      // cases of a type is what says so. Checked like any filling that pins
      // a variable down.
      for (const type of dataTypes.filter((t) => !t.startsWith("std.") || t === "std.bool" || t === "std.list")) {
        const td = code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
        const s = info.subst.clone();
        try { s.unify(bt, { t: "con", id: type, args: td.params.map(() => s.fresh()) }); } catch (e) { if (e instanceof TypeError) continue; throw e; }
        for (const kind of ["match", "fold"] as const) {
          const f: Filling = { kind, on: b.id, type };
          if (safe(s, f, false)) out.push(f);
        }
      }
    }
  }
  return out;
}

// The definitions in `group` and every definition that reaches one of them.
function dependents(code: Code, group: Id[]): Set<Id> {
  const owner = ownerOfTypeParts(code);
  const usedBy = new Map<Id, Id[]>();
  for (const d of code.defs) {
    for (const id of subtree(code, d)) {
      const n = code.nodes[id];
      let t = n.kind === "ref" ? n.target : n.kind === "part" || n.kind === "solve" ? n.fn : null;
      if (t && owner.has(t)) t = owner.get(t)!;
      if (t && t !== d) usedBy.set(t, [...(usedBy.get(t) ?? []), d]);
    }
  }
  const out = new Set(group);
  const todo = [...group];
  while (todo.length) for (const u of usedBy.get(todo.pop()!) ?? []) if (!out.has(u)) { out.add(u); todo.push(u); }
  return out;
}

// The group's types under s, with variables numbered by first appearance
// (and marked when they must be plain), so equal keys mean equal types.
function groupKey(s: Subst, types: Type[]): string {
  const vars = new Map<number, number>();
  const rows = new Map<number, number>();
  const go = (t: Type): string => {
    t = s.resolve(t);
    if (t.t === "var") {
      if (!vars.has(t.v)) vars.set(t.v, vars.size);
      return `${s.plain.has(t.v) ? "p" : "v"}${vars.get(t.v)}`;
    }
    if (t.t === "con") return `${t.id}(${t.args.map(go).join(",")})`;
    const r = s.resolveRow(t.eff);
    if (r.tail !== null && !rows.has(r.tail)) rows.set(r.tail, rows.size);
    return `(${t.params.map(go).join(",")})-[${r.effs.join(",")}|${r.tail === null ? "" : rows.get(r.tail)}]->${go(t.ret)}`;
  };
  return types.map(go).join(";");
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
