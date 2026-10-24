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
import { determinism, oneAnswer, solveMode } from "./modes.ts";
import { smoothDerivative as hasSmoothDerivative, smoothGradient as hasSmoothGradient, recordVariant } from "./derive.ts";
import { BOOL, S, SET, SIGS } from "./std.ts";
import { ratioParts } from "./int.ts";
import { fieldPath } from "./records.ts";
import { fresh, rigid, RIGID, type Pins } from "./signatures.ts";
import {
  BUILTIN_EFFECTS, CELL, CHOICE, COMPLEX_TYPE, CONSOLE, DIVERGE, EffectError, ArithError, WORLD, WorldError, freeVars, instantiate, INT, NUMBER, NumbersError, PlainError, RATIONAL_TYPE, showType as showT, STRING, Subst, TypeError,
  type Row, type Scheme, type Type,
} from "./types.ts";
import { DECLARED, discharge } from "./ledger.ts";

// The searches: they run a function on paths they may abandon or repeat, so
// its row holds no world effect (std.ts searchRow) and is inside the call's.
const SEARCHES = new Set<Id>([S.all, S.count, S.first, S.optional]);

discharge("a match on an effect's operations", [DECLARED], "a case for each operation says what it does: the handler");

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
  // Definitions the palette doesn't offer: a module's helpers.
  hidden: Set<Id>;
}

// pins: signatures that definitions must keep and callers see
// (signatures.ts). hidden: definitions that can be used where they are
// but aren't offered for new uses.
export interface Options { pins?: Pins; hidden?: Iterable<Id> }

const num: Type = { t: "con", id: NUMBER, args: [] };
const ARITH_WHAT = {
  arith: "number types (Number, Int, or one case whose fields are all Numbers)",
  ordered: "Numbers or Ints",
};
const str: Type = { t: "con", id: STRING, args: [] };
// Each number type's own arithmetic, which the generic + − · −x < stand for.
const PER_TYPE = new Set(["add", "sub", "mul", "neg", "less"].flatMap((op) => [`builtin.${op}`, `builtin.int.${op}`]));
const bool: Type = { t: "con", id: BOOL, args: [] };

// `reuse` rechecks only the definitions in `only` and takes the others'
// types from an earlier check of the same program (the palette uses this to
// try a filling against just the definitions it can affect).
export function infer(code: Code, names: Names = {}, reuse?: { from: Info; only: Set<Id> }, opts: Options = {}): Info {
  // gradient(f)(p): p's type, for gradient(f) (smoothGradient, below).
  const at = new Map<Id, Type>();
  const s = new Subst();
  if (reuse) s.next = reuse.from.subst.next;
  const owner = ownerOfTypeParts(code);
  const info: Info = { typeOf: new Map(), schemes: new Map(), errors: [], holes: new Map(), divergent: new Set(), subst: s, owner, hidden: new Set(opts.hidden ?? []) };
  const err = (id: Id, message: string) => info.errors.push({ id, message });
  const nm = (id: Id) => names[id] ?? id;
  const show = (t: Type) => showT(s.zonk(t), names);
  const effName = (e: EffectError) => e.effects.map(nm).join(", ");
  const worldMessage = (what: string, e: EffectError) => `${what} does ${effName(e)} while a Choice is open, so it would act on paths that are later abandoned: handle the Choice first (first, all, count or optional) and act on its result`;
  const worldOrEffect = (e: EffectError) => (e instanceof WorldError ? worldMessage("this", e) : `this performs ${effName(e)}, which nothing here handles`);
  // Rows contained in others (Subst.subs): each one's effects added to the
  // other's, until nothing changes. A row still open is left for later; a
  // closed one that can't take an effect, or a search's that can't take the
  // world, is an error at the call it came from.
  function settle() {
    for (let changed = true; changed; ) {
      changed = false;
      for (const c of s.subs) {
        const from = s.resolveRow(c.from), to = s.resolveRow(c.to);
        const missing = from.effs.filter((e) => !to.effs.includes(e));
        if (!missing.length) continue;
        changed = true;
        try {
          if (to.tail === null) throw new EffectError(missing);
          s.unifyRow(to, { effs: missing, tail: s.next++ });
        } catch (e) {
          if (!(e instanceof EffectError)) throw e;
          err(c.at ?? current[0], worldOrEffect(e));
          c.from = { effs: [], tail: null };
        }
      }
    }
  }

  const unifyAt = (id: Id, want: Type, got: Type, what = "") => {
    try {
      s.unify(want, got);
    } catch (e) {
      if (e instanceof EffectError) err(id, `${what || "this"} performs ${effName(e)}, which nothing here handles`);
      else if (e instanceof NumbersError) err(id, `${what ? what + ": " : ""}${show(got)} isn't a record of Numbers (Number, or one case whose fields are all Numbers)`);
      else if (e instanceof ArithError) err(id, `${what ? what + ": " : ""}${show(got)} isn't ${ARITH_WHAT[e.kind]}`);
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
  // An effect is a typedef whose variants are operations.
  const isEffect = (id: Id) => !!typedefOf(id)?.effect;
  const fieldTypes = (def: Id) => typedefOf(def)!.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant"> | undefined)?.fields ?? [])
    .flatMap((f) => { const n = code.nodes[f]; return n?.kind === "field" ? [{ field: f, type: n.type }] : []; });

  const typeExpr = (id: Id, params: Map<Id, Type>): Type => {
    const n = code.nodes[id];
    // A function type in data lists its effects, a closed row: a function
    // put in a field can't hide what it does when it's taken out and called.
    if (n.kind === "tfun") {
      return { t: "fn", params: n.params.map((p) => typeExpr(p, params)), ret: typeExpr(n.result, params), eff: { effs: [...(n.effects ?? [])], tail: null } };
    }
    if (n.kind !== "tref") throw new Error(`${id} is not a type`);
    if (params.has(n.target)) return params.get(n.target)!;
    if (isEffect(n.target)) err(id, `${nm(n.target)} is an effect, not a type of values`);
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
    // a cell is a place, not a value: two of them holding the same thing differ
    if (def === CELL) { plainParams.set(def, null); return null; }
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
  // The fields of a one-case data type at these args, for "a record of
  // Numbers". A pin's rigid record-of-Numbers variable is one already.
  s.recordFields = (id, args) => {
    if (id.startsWith(`${RIGID}numbers.`)) return [{ t: "con", id: NUMBER, args: [] }];
    const td = typedefOf(id);
    if (!td || td.effect || td.variants.length !== 1) return null;
    const params = new Map(td.params.map((p, i) => [p, args[i] ?? s.fresh()] as const));
    return (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.map((f) => typeExpr((code.nodes[f] as NodeOf<"field">).type, params));
  };

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
    // Rows hold effects without arguments, so an effect has no parameters:
    // for an error that carries data of its own, declare an effect for it.
    if (isEffect(def) && typedefOf(def)!.params.length) err(def, `${nm(def)} is an effect, and effects can't have parameters (declare one effect for each kind of reason)`);
    // the type itself, and any type it's defined together with
    const self = (t: Id) => t === def || (isTypeDef(t) && reachOf(t).has(def) && reachOf(def).has(t));
    for (const { field, type } of fieldTypes(def)) {
      if (!positive(type, self, false)) err(field, `${nm(def)} can't take itself as an input in its own field ${nm(field)}: through it, a function could call itself without recursion and never end`);
      for (const t of subtree(code, type)) {
        const n = code.nodes[t];
        if (n?.kind === "tfun") for (const e of n.effects ?? []) if (!isEffect(e) && !BUILTIN_EFFECTS.includes(e)) err(t, `${nm(e)} is not an effect`);
      }
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
        // Its type may already be closed without Diverge: it was passed
        // where only a pure function fits (map parts' function, say).
        try { if (t.t === "fn") s.unifyRow(t.eff, { effs: [DIVERGE], tail: s.next++ }); }
        catch (e) { if (e instanceof EffectError) err(d, `${nm(d)} might not finish, and it is used where only a function that surely finishes fits`); else throw e; }
      }
    }
    settle();
    const generalized = new Set<number>();
    for (const d of group) freeVars(s.zonk(mono.get(d)!), s, new Set(), generalized);
    // Rows contained in others among the group's own row variables go into
    // its schemes, and leave the live ones.
    const kept: [number, number][] = [];
    s.subs = s.subs.filter((c) => {
      const f = s.resolveRow(c.from).tail, t = s.resolveRow(c.to).tail;
      if (f === null || !generalized.has(f)) return true;
      // (kept live too, for showIn; nothing binds a scheme's own rows)
      if (t !== null && generalized.has(t)) { kept.push([f, t]); return true; }
      // contained in something that stays: approximately, the same row
      try { s.unifyRow(c.from, c.to); } catch (e) { if (e instanceof EffectError) err(c.at ?? group[0], worldOrEffect(e)); else throw e; }
      return false;
    });
    for (const d of group) {
      const t = s.zonk(mono.get(d)!);
      const fv = freeVars(t, s);
      let sc: Scheme = { vars: [...fv.vars], rows: [...fv.rows], type: t, plain: [...fv.vars].filter((v) => s.plain.has(v)), numbers: [...fv.vars].filter((v) => s.numbers.has(v)) };
      const arith = [...fv.vars].filter((v) => s.arith.get(v) === "arith"), ordered = [...fv.vars].filter((v) => s.arith.get(v) === "ordered");
      if (arith.length) sc.arith = arith;
      if (ordered.length) sc.ordered = ordered;
      const noWorld = [...fv.rows].filter((r) => s.noWorld.has(r));
      if (noWorld.length) sc.noWorld = noWorld;
      const subs = kept.filter(([f, to]) => fv.rows.has(f) && fv.rows.has(to));
      if (subs.length) sc.subs = subs;
      // What a definition does while a Choice it doesn't handle is open:
      // its caller handles the Choice around the whole call, so a world
      // effect anywhere in it is under the Choice.
      if (t.t === "fn") {
        const effs = s.resolveRow(t.eff).effs, w = effs.filter((e) => WORLD.includes(e));
        if (effs.includes(CHOICE) && w.length) err(d, `${nm(d)} does ${w.map(nm).join(" and ")} while a Choice is open, so it would act on paths that are later abandoned: handle the Choice first (first, all, count or optional) and act on its result`);
      }
      // A pinned definition must keep its pin, and its callers see the pin
      // whatever the body says, so a change that breaks it is an error here
      // and nowhere else.
      const pin = opts.pins?.[d];
      if (pin && code.nodes[d]) {
        const p = fresh(pin, s);
        if (!fitsPin(sc, p)) err(d, `${nm(d)} is pinned to ${show(p.type)}, and this makes it ${show(t)}`);
        sc = p;
      }
      info.schemes.set(d, sc);
      mono.delete(d);
      info.typeOf.set(d, sc.type);
    }
  }

  // Does a body of type `sc` keep the pin `p`? Its type, instantiated,
  // must unify with the pin's type with the pin's variables held rigid.
  function fitsPin(sc: Scheme, p: Scheme): boolean {
    const t = s.clone();
    const plainArgs = t.plainArgs;
    t.plainArgs = (id, args) => (id.startsWith(`${RIGID}any.`) ? null : plainArgs(id, args));
    try { t.unify(instantiate(sc, t), rigid(p)); return true; }
    catch (e) { if (e instanceof TypeError) return false; throw e; }
  }

  // A function in a variable whose row is already closed (it does these
  // effects and no others) can be used where more may happen: each use
  // gets an open copy, so a field's `view`, closed by the page thunk it's
  // shown in, can still be handed to inverse in a handler that does more.
  // Only the outer row: its parameters keep their types. Koka's `open`
  // (Leijen, "Type directed compilation of row-typed algebraic effects").
  function opened(t: Type): Type {
    const r = s.resolve(t);
    if (r.t !== "fn") return t;
    const row = s.resolveRow(r.eff);
    return row.tail === null ? { ...r, eff: { effs: row.effs, tail: s.next++ } } : t;
  }

  function refType(id: Id, target: Id, env: Map<Id, Type>): Type {
    const t = code.nodes[target];
    if (!t) { err(id, "points at nothing"); return s.fresh(); }
    switch (t.kind) {
      case "binder":
        if (env.has(target)) return opened(env.get(target)!);
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
        const def = owner.get(target)!;
        // An operation: calling it performs the effect. One that never
        // returns has a result of any type, since nobody receives it.
        if (isEffect(def)) {
          const { fields } = dataType(def);
          const r = (code.nodes[target] as NodeOf<"variant">).returns;
          return { t: "fn", params: fields(target), ret: r ? typeExpr(r, new Map()) : s.fresh(), eff: s.freshRow([def]) };
        }
        const { self, fields } = dataType(def);
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
      case "lit": {
        t = n.of ? { t: "con", id: n.of, args: [] } : typeof n.value === "number" ? num : str;
        // A literal at Rational is a whole number or top/bottom; at
        // Complex, a Number (its real part). arith.ts spells them out.
        if (n.of === RATIONAL_TYPE && !ratioParts(n.value)) err(id, `${JSON.stringify(n.value)} isn't a fraction: write a whole number, or top/bottom with the bottom not 0`);
        if (n.of === COMPLEX_TYPE && typeof n.value !== "number") err(id, `${JSON.stringify(n.value)} isn't a number`);
        break;
      }
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
        // gradient(f) needs f's type first: which record it's over. In
        // gradient(f)(p), p's type says so too, when f is generic.
        const isGradient = (c: Node | undefined) => c?.kind === "call" && c.args.length === 1 && code.nodes[c.fn]?.kind === "ref" && (code.nodes[c.fn] as NodeOf<"ref">).target === S.gradient;
        const gradient = isGradient(n);
        const applied = isGradient(code.nodes[n.fn]) ? n.args.map((a) => expr(a, env, row)) : null;
        if (applied?.length === 1) at.set(n.fn, applied[0]);
        const early = gradient ? n.args.map((a) => expr(a, env, row)) : null;
        const subsBefore = s.subs.length;
        const f = smoothDerivative(n) ?? (early && smoothGradient(n, early[0])) ?? expr(n.fn, env, row);
        for (let i = subsBefore; i < s.subs.length; i++) s.subs[i].at ??= id;
        const args = early ?? applied ?? n.args.map((a) => expr(a, env, row));
        const ret = s.fresh();
        // A search's call does what its function does besides Choice, and
        // the code beside it may do more: its row goes inside this one.
        const search = code.nodes[n.fn]?.kind === "ref" && SEARCHES.has((code.nodes[n.fn] as NodeOf<"ref">).target);
        const callRow = search ? s.freshRow() : row;
        if (search) s.subs.push({ from: callRow, to: row, at: id });
        const fr = s.resolve(f);
        if (fr.t === "fn" && fr.params.length !== args.length) {
          err(id, `${callee(n)} takes ${fr.params.length} inputs, given ${args.length}`);
          t = fr.ret;
          break;
        }
        try {
          s.unify(f, { t: "fn", params: args, ret, eff: callRow });
        } catch (e) {
          if (e instanceof WorldError) {
            // The callee acting itself, or a function it's given that it
            // runs under its Choice?
            const ft = s.resolve(f);
            const given = ft.t === "fn" ? ft.params.findIndex((p, i) => { const t = s.clone(); try { t.unify(p, args[i]); return false; } catch (x) { return x instanceof WorldError; } }) : -1;
            if (given >= 0) err(n.args[given], `this does ${effName(e)} while a Choice is open (${callee(n)} runs it under one), so it would act on paths that are later abandoned: handle the Choice first and act on its result`);
            else err(id, worldMessage(callee(n), e));
          }
          else if (e instanceof EffectError) err(id, `${callee(n)} performs ${effName(e)}, which nothing here handles`);
          else if (e instanceof NumbersError) err(id, `${callee(n)} works only on records of Numbers (Number, or one case whose fields are all Numbers)`);
          else if (e instanceof ArithError) err(id, `${callee(n)} works only on ${ARITH_WHAT[e.kind]}`);
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

  // derivative(f) where derive.ts can read every slope of f, which is
  // written right there: its result fails only where f does, so it has f's
  // effects and no Choice (src/lang/derive.ts, smoothDerivative). Any other
  // derivative(f) takes the builtin's own type, Choice included.
  function smoothDerivative(n: NodeOf<"call">): Type | null {
    const head = code.nodes[n.fn];
    if (head?.kind !== "ref" || head.target !== S.derivative || n.args.length !== 1 || !hasSmoothDerivative(code, n.args[0])) return null;
    const e = s.freshRow();
    const t: Type = { t: "fn", params: [{ t: "fn", params: [num], ret: num, eff: e }], ret: { t: "fn", params: [num], ret: num, eff: e }, eff: s.freshRow() };
    info.typeOf.set(n.fn, t);
    return t;
  }

  // gradient(f) the same way, once f's type says which record it takes:
  // over a record of Numbers, every part's slope must be readable; over a
  // Number, it's derivative.
  function smoothGradient(n: NodeOf<"call">, ft: Type): Type | null {
    const point = at.get(n.id);
    if (point) { const fr = s.resolve(ft); if (fr.t === "fn" && fr.params.length === 1) { try { s.clone().unify(fr.params[0], point); s.unify(fr.params[0], point); } catch { /* reported at the call */ } } }
    const f = s.zonk(ft);
    if (f.t !== "fn" || f.params.length !== 1) return null;
    const r = f.params[0];
    if (r.t !== "con") return null;
    if (r.id === NUMBER ? !hasSmoothDerivative(code, n.args[0]) : !hasSmoothGradient(code, n.args[0], recordVariant(code, r.id) ?? "")) return null;
    const e = s.freshRow();
    const t: Type = { t: "fn", params: [{ t: "fn", params: [r], ret: num, eff: e }], ret: { t: "fn", params: [r], ret: r, eff: e }, eff: s.freshRow() };
    info.typeOf.set(n.fn, t);
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
      // Whether this direction ends is its mode's (modes.ts, MODES.md):
      // Diverge only when the search may go on forever, and a direction
      // nothing pins down is an error here rather than a search that never
      // gives an answer.
      const v = solveMode(code, n, names);
      // (A hole is a gap the editor already shows; the search runs up to it.)
      if (v?.stuck.length && !v.stuck.includes("a hole")) err(n.id, `${nm(n.fn)} can't be run this way: ${v.stuck.find((x) => x.startsWith("nothing gives")) ?? `${v.stuck[0]} never gets what it needs`}`);
      relationalSolve(n, env, row, inner, v ? !v.ends : true, v?.loops[0], oneAnswer(code, n));
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
  // adds Choice (any number of answers) unless its mode always gives
  // exactly one, Diverge when it may unfold forever, and whatever the
  // function itself does, except printing, which can't be undone.
  function relationalSolve(n: NodeOf<"solve">, env: Map<Id, Type>, row: Row, inner: Map<Id, Type>, loops: boolean, why?: string, one = false) {
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
    // Searching runs a function many times over and drops most of the runs,
    // so nothing it does may be seen from outside: no world effects, and no
    // effects of our own either, whose handlers could be anything.
    const acts = own.filter((e) => e !== CHOICE && e !== DIVERGE);
    if (acts.length) err(n.id, `${nm(n.fn)} performs ${acts.map(nm).join(", ")}, and a function that acts can't be run backwards`);
    // What the function's row doesn't name yet (a function given as a
    // port, as in inverse) is whatever that function turns out to do: it
    // goes into the row around, as a call's would, rather than nowhere.
    // Only that part: the search's own Choice and Diverge stay outside.
    // Which function it is shows only where inverse is called, so one that
    // acts is refused when it's run backwards (relate.ts), not here.
    if (!one) {
      const effs = [...new Set([CHOICE, ...(loops ? [DIVERGE] : [])])];
      choice(n.id, row, effs, `running ${nm(n.fn)} backwards may give several answers or none (Choice)${loops ? ` and may search forever (Diverge${why ? `: ${why}` : ""})` : ""}, which nothing here handles`);
    }
    const tail = s.resolveRow(ft.eff).tail;
    if (acts.length || tail === null) return;
    const around = s.resolveRow(row);
    try { s.unifyRow(around, { effs: around.effs, tail }); }
    catch (e) { if (e instanceof EffectError) err(n.id, `running ${nm(n.fn)} backwards performs ${effName(e)}, which nothing here handles`); else throw e; }
  }

  function callee(n: NodeOf<"call">): string {
    const f = code.nodes[n.fn];
    return f.kind === "ref" ? nm(f.target) : "this function";
  }

  function cases(n: NodeOf<"match"> | NodeOf<"fold">, env: Map<Id, Type>, row: Row): Type {
    const result = s.fresh();
    const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
    const def = arms.length ? owner.get(arms[0].variant) : undefined;
    if (def && isEffect(def)) return handle(n, def, arms, env, row, result);
    const scrut = expr(n.scrutinee, env, row);
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

  // A handler is a match whose cases are an effect's operations (OCaml 5's
  // effect cases in `match`, LANGUAGE.md "Effects you define"). The value
  // examined is the computation that performs the effect: its effects are
  // the match's, minus this one. A case for an operation that returns
  // gives the answer, and the computation carries on with it; a case for
  // one that never returns gives the value of the whole match. Cases run
  // outside the handler, so their own effects are the match's.
  // A match on an effect's operations: the computation it handles may do
  // the effect, and the match doesn't (the ledger, ledger.ts).
  function handle(n: NodeOf<"match"> | NodeOf<"fold">, effect: Id, arms: NodeOf<"arm">[], env: Map<Id, Type>, row: Row, result: Type): Type {
    if (n.kind === "fold") err(n.id, `${nm(effect)} is an effect; its operations are handled with a match, not folded`);
    const rest = s.next++;
    s.unifyRow({ effs: [], tail: rest }, row);
    unifyAt(n.scrutinee, result, expr(n.scrutinee, env, { effs: [effect], tail: rest }), "the handled computation");
    const { fields } = dataType(effect);
    const seen = new Set<Id>();
    for (const arm of arms) {
      if (owner.get(arm.variant) !== effect) { err(arm.id, `${nm(arm.variant)} is not an operation of ${nm(effect)}`); continue; }
      if (seen.has(arm.variant)) err(arm.id, `${nm(arm.variant)} is handled twice`);
      seen.add(arm.variant);
      const fs = fields(arm.variant);
      const op = code.nodes[arm.variant] as NodeOf<"variant">;
      // An operation answered later: one more binder, the rest of the
      // computation, (answer) -[the match's row]-> the match's value. It
      // resumes under this same match (deep), so it can do what the match
      // does and gives what the match gives (ANSWERED-LATER.md).
      const later = op.later && op.returns ? 1 : 0;
      if (arm.binds.length !== fs.length + later) err(arm.id, later ? `${nm(arm.variant)} has ${fs.length} inputs and the rest of the computation, ${arm.binds.length} bound` : `${nm(arm.variant)} has ${fs.length} inputs, ${arm.binds.length} bound`);
      const inner = new Map(env);
      arm.binds.forEach((b, i) => { if (fs[i]) { inner.set(b, fs[i]); info.typeOf.set(b, fs[i]); } });
      const r = op.returns;
      if (later && arm.binds.length === fs.length + 1) {
        const rest = arm.binds[fs.length];
        const t: Type = { t: "fn", params: [typeExpr(r!, new Map())], ret: result, eff: row };
        inner.set(rest, t);
        info.typeOf.set(rest, t);
        // A case gives one value, so a search can't resume the rest once
        // per answer; and on any one path it resumes the rest at most once.
        const own = s.freshRow();
        unifyAt(arm.body, result, expr(arm.body, inner, own), "this case");
        if (s.resolveRow(own).effs.includes(CHOICE)) err(arm.body, `this case may give several answers or none, so it could resume the rest of ${nm(arm.variant)} more than once: handle the Choice here (first, optional)`);
        try { s.unifyRow(own, row); } catch (e) { if (e instanceof EffectError) err(arm.body, `this case performs ${effName(e)}, which nothing here handles`); else throw e; }
        const twice = resumedTwice(code, arm.body, rest);
        if (twice) err(twice, `this resumes the rest of ${nm(arm.variant)} a second time: the rest runs once, so resume it on one path only`);
        continue;
      }
      if (!r) { unifyAt(arm.body, result, expr(arm.body, inner, row), "this case"); continue; }
      // An answer is one value: the computation carries on once with it.
      const own = s.freshRow();
      unifyAt(arm.body, typeExpr(r, new Map()), expr(arm.body, inner, own), `the answer to ${nm(arm.variant)}`);
      if (s.resolveRow(own).effs.includes(CHOICE)) err(arm.body, `the answer to ${nm(arm.variant)} must be one value, and this may give several or none: handle the Choice here (first, optional)`);
      try { s.unifyRow(own, row); } catch (e) { if (e instanceof EffectError) err(arm.body, `this case performs ${effName(e)}, which nothing here handles`); else throw e; }
    }
    const missing = typedefOf(effect)!.variants.filter((v) => !seen.has(v));
    if (missing.length) err(n.id, `no case for ${missing.map(nm).join(", ")}: a handler handles every operation of ${nm(effect)}`);
    if (n.kind === "match" && n.otherwise) err(n.otherwise, `a handler has a case for each operation of ${nm(effect)} and nothing else`);
    return result;
  }

  // Units are part of a number's type: a conflict is a type error.
  for (const u of unitProblems(code, names)) err(u.id, u.message);

  settle();
  for (const [id, t] of info.typeOf) info.typeOf.set(id, s.zonk(t));
  for (const h of info.holes.values()) {
    h.expected = s.zonk(h.expected);
    h.scope = h.scope.map((b) => ({ id: b.id, type: s.zonk(b.type) }));
  }
  return info;
}

// Where `body` uses the binder `rest` a second time on one path, or null.
// Each branch of a match is its own path; a fold's case runs once per
// item, so the rest may not be used in one; a function value that holds
// the rest counts as its one use (a second call of it is caught when it
// happens, ANSWERED-LATER.md).
export function resumedTwice(code: Code, body: Id, rest: Id): Id | null {
  let second: Id | null = null;
  // The most uses on any one path through id.
  const uses = (id: Id): number => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "ref": return n.target === rest ? 1 : 0;
      case "call": return sum([n.fn, ...n.args]);
      case "lambda": return Math.min(uses(n.body), 1) + (uses(n.body) > 1 ? flag(n.body) : 0);
      case "match": {
        const first = uses(n.scrutinee), then = Math.max(0, ...n.arms.map((a) => uses((code.nodes[a] as NodeOf<"arm">).body)), n.otherwise ? uses(n.otherwise) : 0);
        if (first && then) flag(id);
        return first + then;
      }
      case "fold": {
        const first = uses(n.scrutinee), inArm = n.arms.some((a) => uses((code.nodes[a] as NodeOf<"arm">).body) > 0);
        if (inArm) flag(id);
        return first + (inArm ? 1 : 0);
      }
      case "solve": return sum([...Object.values(n.given), n.body]);
      default: return 0;
    }
  };
  const flag = (id: Id) => { second ??= id; return 0; };
  const sum = (ids: Id[]) => { let t = 0; for (const x of ids) { const u = uses(x); if (t > 0 && u > 0) flag(x); t += u; } return t; };
  if (uses(body) > 1) second ??= body;
  return second;
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
  | { kind: "lit"; of: "number" | "text" | "int" }
  // `on` null: on a value given next (the scrutinee starts as a hole).
  | { kind: "match" | "fold"; on: Id | null; type: Id }
  | { kind: "lambda"; arity: number; params?: Type[] };

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
  // A row inside one of those (a search's call, first's default) reaches
  // callers through it.
  for (let more = true; more; ) {
    more = false;
    for (const c of info.subst.subs) {
      const f = info.subst.resolveRow(c.from).tail, t = info.subst.resolveRow(c.to).tail;
      if (f !== null && t !== null && pinned.includes(`r${t}`) && !pinned.includes(`r${f}`)) { pinned.push(`r${f}`); more = true; }
    }
  }
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
  // (a call that may search forever makes the search Diverge, a square
  // makes the answer two). What the check makes of the body is its plan,
  // so a filling that leaves every plan of the group's solves as it was
  // is checked like any other; one that changes a plan, on its own.
  const solves = Object.values(code.nodes).filter((n): n is NodeOf<"solve"> => n.kind === "solve" && h.group.includes(n.fn));
  const plans = (c: Code) => solves.map((n) => {
    try {
      const p = planSolve(c, n);
      // A search's Diverge, and whether it can run at all, are its mode's.
      // (Running up to the hole being filled isn't a difference.)
      const v = p.mode === "relational" ? solveMode(c, n, {}) : null;
      return [p.mode, p.status, p.needMore, p.many, p.canFail, p.unique, p.predicate, p.rel?.ports.join(","), v ? `${v.ends}/${determinism(v.answers)}/${v.stuck.filter((x) => x !== "a hole").join(",")}` : ""].join("|");
    }
    catch (e) { return `!${(e as Error).message}`; }
  }).join(";");
  let planned: string | undefined;
  const samePlans = (f: Filling) => plans(fillHole(code, {}, hole, f).code) === (planned ??= plans(code));
  const checked = new Map<string, boolean>();
  const safe = (s: Subst, f: Filling, risky: boolean) => {
    if (risky || (solves.length && !samePlans(f))) return whole(f);
    // A row only renamed pins nothing: a pure call's empty row joining the
    // definition's. (A type variable renamed may still be pinned: the new
    // one can carry a constraint, records of Numbers say.)
    const touches = pinned.some((k) => {
      const v = +k.slice(1);
      if (k[0] === "t") return s.types.has(v);
      if (!s.rows.has(v)) return false;
      const r = s.resolveRow({ effs: [], tail: v });
      return r.effs.length > 0 || r.tail === null || pinned.includes(`r${r.tail}`);
    });
    if (!touches) return true;
    // Units are the exception: what a call does to them is the callee's
    // own (multiply multiplies them, add needs them equal), so a ref or a
    // call is checked for each thing it names.
    const named = f.kind === "ref" || f.kind === "call" ? `|${f.target}` : "";
    const key = groupKey(s, h.group.flatMap((d) => { const sc = info.schemes.get(d); return sc ? [sc.type] : []; })) + named;
    if (!checked.has(key)) checked.set(key, whole(f));
    return checked.get(key)!;
  };
  // A filling that brings Choice or the world where the other is may break
  // the rule that the world isn't touched under Choice, which only the
  // whole check sees.
  const near = new Set(info.subst.resolveRow(h.row).effs);
  const expected = info.subst.resolve(h.expected);
  const underChoice = near.has(CHOICE) || (expected.t === "fn" && info.subst.resolveRow(expected.eff).effs.includes(CHOICE));
  const mixes = (effs: Id[]) => effs.some((e) => (e === CHOICE ? [...near].some((x) => WORLD.includes(x)) : WORLD.includes(e) && underChoice));
  const consider = (target: Id, t: Type, risky = false) => {
    const ft = info.subst.resolve(t);
    if (ft.t === "fn" && mixes(info.subst.resolveRow(ft.eff).effs)) risky = true;
    const asRef = fits(t, false);
    const ref: Filling = { kind: "ref", target, type: t };
    if (asRef && safe(asRef, ref, risky)) out.push(ref);
    const r = info.subst.resolve(t);
    const asCall = r.t === "fn" ? fits(t, true) : null;
    const call: Filling = { kind: "call", target, arity: r.t === "fn" ? r.params.length : 0, type: t };
    if (asCall && safe(asCall, call, risky)) out.push(call);
  };
  for (const b of h.scope) consider(b.id, b.type);
  // An input nothing has given a type yet can still be called: calling it
  // with n inputs is what says it's a function of n (before(□, □)).
  for (const b of h.scope) {
    if (info.subst.resolve(b.type).t !== "var") continue;
    for (const arity of [1, 2, 3]) {
      const s = info.subst.clone();
      const t: Type = { t: "fn", params: Array.from({ length: arity }, () => s.fresh()), ret: s.fresh(), eff: s.freshRow() };
      try { s.unify(b.type, t); s.unify(h.expected, t.ret); s.unifyRow(t.eff, h.row); } catch (e) { if (e instanceof TypeError) continue; throw e; }
      const call: Filling = { kind: "call", target: b.id, arity, type: s.zonk(t) };
      if (safe(s, call, false)) out.push(call);
    }
  }
  // Referring to the group itself, or to a def that depends on it, makes a
  // recursive group whose checks (does it end?) see the body: confirmed.
  for (const [d, sc] of info.schemes) {
    if (info.hidden.has(d)) continue;
    if (h.group.includes(d)) consider(d, sc.type, true);
    else consider(d, instantiate(sc, info.subst), affected.has(d));
  }
  // One + for every number type (NUMBERS.md, "One `+`"): the palette
  // offers the generic arithmetic, not each type's own, which stored
  // programs keep and which is what the generic resolves to.
  for (const [id, sig] of Object.entries(SIGS)) if (!PER_TYPE.has(id)) consider(id, sig(info.subst));
  for (const [part, def] of info.owner) {
    if (code.nodes[part].kind === "variant") consider(part, constructorType(code, info.subst, def, part));
    // A field of a one-case type reads it from a value: fst(p), pages(c).
    else if (code.nodes[part].kind === "field") { const t = fieldType(code, info.subst, def, part); if (t) consider(part, t); }
  }
  const lit = (of: "number" | "text" | "int", t: Type) => { const f: Filling = { kind: "lit", of }; const s = fits(t, false); if (s && safe(s, f, false)) out.push(f); };
  lit("number", num);
  lit("text", str);
  lit("int", { t: "con", id: INT, args: [] });
  const ex = info.subst.resolve(h.expected);
  if (ex.t === "fn") out.push({ kind: "lambda", arity: ex.params.length, params: ex.params.map((t) => info.subst.zonk(t)) });
  const dataTypes = [...new Set(info.owner.values())].filter((d) => !(code.nodes[(code.nodes[d] as NodeOf<"def">).body!] as NodeOf<"typedef">).effect);
  // The standard library's types that are data you write programs about;
  // the rest (Unit, Html, Event…) would only crowd the palette.
  const STD_SPLIT = ["std.bool", "std.list", "std.pair", "std.optional"];
  const splittable = dataTypes.filter((t) => !t.startsWith("std.") || STD_SPLIT.includes(t));
  for (const b of h.scope) {
    const bt = info.subst.resolve(b.type);
    if (bt.t === "con" && dataTypes.includes(bt.id)) {
      out.push({ kind: "match", on: b.id, type: bt.id });
      if (recursiveType(code, bt.id)) out.push({ kind: "fold", on: b.id, type: bt.id });
    } else if (bt.t === "var") {
      // Nothing says what it is yet (a new input, say): splitting it by the
      // cases of a type is what says so. Checked like any filling that pins
      // a variable down.
      for (const type of splittable) {
        const td = code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
        const s = info.subst.clone();
        try { s.unify(bt, { t: "con", id: type, args: td.params.map(() => s.fresh()) }); } catch (e) { if (e instanceof TypeError) continue; throw e; }
        for (const kind of recursiveType(code, type) ? ["match", "fold"] as const : ["match"] as const) {
          const f: Filling = { kind, on: b.id, type };
          if (safe(s, f, false)) out.push(f);
        }
      }
    }
  }
  // A case analysis of a value still to be given: `if` is this on a Bool.
  // Its arms are holes and its value is the hole's, so its type always
  // fits; running the group backwards may still not go through it.
  for (const type of splittable) {
    for (const kind of recursiveType(code, type) ? ["match", "fold"] as const : ["match"] as const) {
      const f: Filling = { kind, on: null, type };
      if (safe(info.subst, f, false)) out.push(f);
    }
  }
  // A handler: a match on a computation still to be given, one case per
  // operation of an effect (handle above).
  for (const type of new Set(info.owner.values())) {
    if (!(code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">).effect || info.hidden.has(type)) continue;
    const f: Filling = { kind: "match", on: null, type };
    if (safe(info.subst, f, false)) out.push(f);
  }
  return out;
}

// A type with a case that holds the type itself: a fold has something to fold.
function recursiveType(code: Code, type: Id): boolean {
  const td = code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  return td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => {
    const t = code.nodes[(code.nodes[f] as NodeOf<"field">).type];
    return t.kind === "tref" && t.target === type;
  }));
}

// The definitions in `group` and every definition that reaches one of them.
function dependents(code: Code, group: Id[]): Set<Id> {
  const owner = ownerOfTypeParts(code);
  const usedBy = new Map<Id, Id[]>();
  for (const d of code.defs) {
    for (const id of subtree(code, d)) {
      const n = code.nodes[id];
      let t = n.kind === "ref" ? n.target : n.kind === "solve" ? n.fn : null;
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
// A field as the function that reads it, for a data type with one case
// (refType's "field"); null for an effect's input or a field of one case
// among several, which only a match reaches.
function fieldType(code: Code, s: Subst, def: Id, field: Id): Type | null {
  const td = code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  if (td.effect || td.variants.length !== 1) return null;
  const made = constructorType(code, s, def, td.variants[0]);
  if (made.t !== "fn") return null;
  const i = (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.indexOf(field);
  return { t: "fn", params: [made.ret], ret: made.params[i], eff: s.freshRow() };
}

function constructorType(code: Code, s: Subst, def: Id, variant: Id): Type {
  const td = code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const params = new Map(td.params.map((p) => [p, s.fresh()] as const));
  const te = (tid: Id): Type => {
    const t = code.nodes[tid];
    if (t.kind === "tfun") return { t: "fn", params: t.params.map(te), ret: te(t.result), eff: { effs: [...(t.effects ?? [])], tail: null } };
    const r = t as NodeOf<"tref">;
    return params.get(r.target) ?? { t: "con", id: r.target, args: r.args.map(te) };
  };
  const self: Type = { t: "con", id: def, args: [...params.values()] };
  const fs = (code.nodes[variant] as NodeOf<"variant">).fields.map((f) => te((code.nodes[f] as NodeOf<"field">).type));
  // An effect's operation performs it (infer's refType).
  if (td.effect) {
    const r = (code.nodes[variant] as NodeOf<"variant">).returns;
    return { t: "fn", params: fs, ret: r ? te(r) : s.fresh(), eff: s.freshRow([def]) };
  }
  return fs.length ? { t: "fn", params: fs, ret: self, eff: s.freshRow() } : self;
}
