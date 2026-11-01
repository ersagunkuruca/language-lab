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

import { PARTIAL, signAnalysis } from "./signs.ts";
import type { Code, Id, Node, NodeOf } from "../model.ts";
import { ownerOfTypeParts, subtree } from "../model.ts";
import type { Names } from "../presentation.ts";
import { unitProblems, UnitsBefore } from "../units.ts";
import { fillHole } from "./refactor.ts";
import { planSolve, runsBackwards, solvesInWholeNumbers } from "./solve.ts";
import { computedForward, directionProblem, useDirections } from "./directions.ts";
import { analyzer, derivedFrom, determinism, oneAnswer, solveMode, type Fn } from "./modes.ts";
import { smoothDerivative as hasSmoothDerivative, smoothGradient as hasSmoothGradient, recordVariant, forgetDerived } from "./derive.ts";
import { BOOL, CELL_OPS, JOBS, S, SET, SIGS, SMART, TRUE } from "./std.ts";
import { countedCalls } from "./counting.ts";
import { ratioParts } from "./int.ts";
import { fieldPath, placePath } from "./records.ts";
import { leftToWays, pickWays, waysIn, type Ways } from "./ways.ts";
import { fresh, rigid, RIGID, type Pins } from "./signatures.ts";
import {
  ALGEBRAIC_TYPE, ARRAY, MASK_TYPES, BUILTIN_EFFECTS, NAMED_ROWS, writtenRow, CELL, PATH, CHOICE, COMPLEX_TYPE, CONSOLE, DUAL_TYPE, FIXED_TYPE, DIVERGE, EffectError, ArithError, FractionError, WORLD, WorldError, freeVars, instantiate, INT, NUMBER, NumbersError, PlainError, RATIONAL_TYPE, schemeArith, schemeNeeds, showType as showT, STRING, Subst, TypeError,
  type Row, type Scheme, type Type,
} from "./types.ts";
import { DECLARED, discharge } from "./ledger.ts";

// The searches: they run a function on paths they may abandon or repeat, so
// its row holds no world effect (std.ts searchRow) and is inside the call's.
const SEARCHES = new Set<Id>([S.all, S.count, S.first, S.optional]);

discharge("a match on an effect's operations", [DECLARED], "a case for each operation says what it does: the handler");

// missing: an interface a type has no implementation of, for the editor to
// offer to write one.
export interface Problem { id: Id; message: string; missing?: { iface: Id; type: Type } }
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
  // What it was checked with, so the palette's rechecks see the same pins.
  options?: Options;
  // Interfaces (INTERFACES.md): each implementation by its interface and
  // type (implementationKey), and the type each use of an interface's
  // operation is at, for arith.ts to resolve.
  implementations?: Map<string, Id>;
  opAt?: Map<Id, Type>;
  // Each node arith.ts copied for a definition used at another number
  // type, to the node it is a copy of (as written), so a Run fed by a
  // call into the copy still finds the definition (I29).
  copyOf?: Map<Id, Id>;
  // Calls whose Choice was dropped because their inputs answer them
  // (L125b): x / 2, or period(1, 9.81). A compiler calls them plainly.
  answered?: Set<Id>;
  // Each definition with results (RESULTS.md): the effects of the direction
  // it declares, Choice when it may give several answers or none, Diverge
  // when its search may not end.
  directions?: Map<Id, Id[]>;
  // The type each relational solve runs its function at, so arith.ts runs
  // a generic one at that type (L38: Int's · run backwards in whole
  // numbers).
  solveAt?: Map<Id, Type>;
}

// An implementation's place in Info.implementations: its interface and the
// closed type it is at.
export const implementationKey = (iface: Id, t: Type) => `${iface}|${JSON.stringify(t)}`;

// pins: signatures that definitions must keep and callers see
// (signatures.ts). hidden: definitions that can be used where they are
// but aren't offered for new uses.
// insiders: the definitions that may call a private constructor (the
// library that keeps its type's rule). Given, every other definition may
// not; not given, nothing is checked, as with no pins.
export interface Options { pins?: Pins; hidden?: Iterable<Id>; insiders?: Iterable<Id> }

const num: Type = { t: "con", id: NUMBER, args: [] };
const ARITH_WHAT = {
  arith: "a Number (Int, Rational, Float64, Fixed, Complex, or one case whose fields are all Float64s)",
  ordered: "a Number with < (Int, Rational, Fixed or Float64)",
};
const str: Type = { t: "con", id: STRING, args: [] };
// A number type itself (a pinned variable counts).
const isNumberType = (t: Type) => t.t === "con" && (t.id === NUMBER || t.id === INT || t.id === RATIONAL_TYPE || t.id === COMPLEX_TYPE || t.id === DUAL_TYPE || t.id === FIXED_TYPE || t.id === ALGEBRAIC_TYPE || t.id.startsWith("pin."));
// Each number type's own arithmetic, which the generic + − · −x < stand for.
// And Float64's sin, cos, tan, exp and log, which Trig's are at Float64.
const PER_TYPE = new Set([...["add", "sub", "mul", "neg", "less"].flatMap((op) => [`builtin.${op}`, `builtin.int.${op}`]), ...["sin", "cos", "tan", "exp", "log"].map((op) => `builtin.${op}`)]);
const bool: Type = { t: "con", id: BOOL, args: [] };

// `reuse` rechecks only the definitions in `only` and takes the others'
// types from an earlier check of the same program (the palette uses this to
// try a filling against just the definitions it can affect).
export function infer(code: Code, names: Names = {}, reuse?: { from: Info; only: Set<Id>; units?: UnitsBefore }, opts: Options = {}): Info {
  // A solve that one of its relation's directions answers is checked as a
  // solve of that direction (directions.ts, POLAR.md).
  code = useDirections(code);
  // gradient(f)(p): p's type, for gradient(f) (smoothGradient, below).
  const at = new Map<Id, Type>();
  const s = new Subst();
  if (reuse) s.next = reuse.from.subst.next;
  // A filling tried by the palette adds no types, so their parts' owners
  // are the earlier check's.
  const owner = reuse ? reuse.from.owner : ownerOfTypeParts(code);
  const insiders = opts.insiders ? new Set(opts.insiders) : null;
  const info: Info = { typeOf: new Map(), schemes: new Map(), errors: [], holes: new Map(), divergent: new Set(), subst: s, owner, hidden: new Set(opts.hidden ?? []), options: opts, implementations: new Map(), opAt: new Map(), answered: new Set() };
  const err = (id: Id, message: string, missing?: Problem["missing"]) => info.errors.push(missing ? { id, message, missing } : { id, message });
  const nm = (id: Id) => names[id] ?? id;
  const show = (t: Type) => showT(s.zonk(t), names);
  // The modes of this program, made when a call first needs them.
  let modes: ReturnType<typeof analyzer> | undefined;
  let signs: ReturnType<typeof signAnalysis> | undefined;
  const builtinSearches = new Map<Id, boolean>();
  // Solves waiting on their givens' types (L38), and whether one turned out
  // to be in whole numbers, so the program is checked again with it so.
  const waiting: { solve: Id; givens: [Id, Type][] }[] = [];
  let again = false;
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
      else if (e instanceof NumbersError) err(id, `${what ? what + ": " : ""}${show(got)} isn't a record of Float64s (Float64, or one case whose fields are all Float64s)`);
      else if (e instanceof ArithError) err(id, `${what ? what + ": " : ""}${show(got)} isn't ${ARITH_WHAT[e.kind]}`);
      else if (e instanceof FractionError) err(id, `${what ? what + ": " : ""}a number with a fraction part can't be an Int`);
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
      return { t: "fn", params: n.params.map((p) => typeExpr(p, params)), ret: typeExpr(n.result, params), eff: writtenRow(n.effects) };
    }
    if (n.kind !== "tref") throw new Error(`${id} is not a type`);
    if (params.has(n.target)) return params.get(n.target)!;
    // `Vector of T` is T to the checker; grades.ts checks its mask (L43e).
    if (MASK_TYPES[n.target]) {
      if (n.args.length === 1) return typeExpr(n.args[0], params);
      err(id, `${nm(n.target)} takes one type, the algebra's multivectors`);
    }
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
    if (def === CELL || def === PATH) { plainParams.set(def, null); return null; }
    // an array is plain when its items are
    if (def === ARRAY) { plainParams.set(def, new Set([0])); return new Set([0]); }
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
  // Float64s". A pin's rigid record-of-Float64s variable is one already.
  s.recordFields = (id, args) => {
    if (id.startsWith(`${RIGID}numbers.`)) return [{ t: "con", id: NUMBER, args: [] }];
    const td = typedefOf(id);
    if (!td || td.effect || td.variants.length !== 1) return null;
    const params = new Map(td.params.map((p, i) => [p, args[i] ?? s.fresh()] as const));
    return (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.map((f) => typeExpr((code.nodes[f] as NodeOf<"field">).type, params));
  };

  // --- strict positivity
  // A data type may not take itself as an input in its own fields, directly
  // or through another type. With `knot = wrap(f: knot → Float64)`,
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
      for (const t of subtree(code, type)) {
        const n = code.nodes[t];
        if (n?.kind === "tfun") for (const e of n.effects ?? []) if (!isEffect(e) && !BUILTIN_EFFECTS.includes(e) && !NAMED_ROWS.has(e)) err(t, `${nm(e)} is not an effect`);
      }
    }
  }

  // An interface is a record of functions over its one type parameter.
  for (const def of typeDefs) {
    const td = typedefOf(def)!;
    if (!td.interface) continue;
    if (td.params.length !== 1 || td.variants.length !== 1) { err(def, `${nm(def)} is an interface: it takes one type and has one case, its operations`); continue; }
    for (const f of (code.nodes[td.variants[0]] as NodeOf<"variant">).fields) {
      if (code.nodes[(code.nodes[f] as NodeOf<"field">).type]?.kind !== "tfun") err(f, `${nm(f)} is an operation of the interface ${nm(def)}, so its type is a function`);
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
  const recursiveCalls: { call: NodeOf<"call">; params: Type[]; args: Type[] }[] = [];
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
    // The group's recursive calls' inputs, now that its bodies are checked.
    for (const { call, params, args } of recursiveCalls.splice(0)) params.forEach((p, i) => {
      try { s.unify(p, args[i]); }
      catch (e) {
        if (e instanceof TypeError) err(call.args[i], `${callee(call)} needs ${show(p)} here, got ${show(args[i])}`);
        else unifyAt(call.args[i], p, args[i]);
      }
    });
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
    // Solves whose givens waited for the definition's types (L38).
    for (const w of waiting.splice(0)) {
      if (w.givens.some(([, t]) => { const r = s.resolve(t); return r.t === "con" && r.id === INT; })) { solvesInWholeNumbers(code, w.solve); again = true; }
      else for (const [g, t] of w.givens) unifyAt(g, num, t, "a given port");
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
      const fractional = [...fv.vars].filter((v) => s.fractional.has(v));
      if (fractional.length) sc.fractional = fractional;
      const whole = [...fv.vars].filter((v) => s.whole.has(v));
      if (whole.length) sc.whole = whole;
      const noWorld = [...fv.rows].filter((r) => s.noWorld.has(r));
      if (noWorld.length) sc.noWorld = noWorld;
      const needs = [...fv.vars].flatMap((v) => [...(s.needs.get(v)?.keys() ?? [])].map((i) => [v, i] as [number, Id]));
      if (needs.length) sc.needs = needs;
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
        if (!fitsPin(sc, p)) err(d, `${nm(d)} is pinned to ${showT(p.type, names, schemeArith(p), [], schemeNeeds(p))}, and this makes it ${showT(t, names, schemeArith(sc), [], schemeNeeds(sc))}`);
        // Inside, the body's types are the pin's too: an input whose only
        // use was cleared is still the Float64 the pin says, and a hole
        // there expects what the pin does.
        else try { s.unify(t, fresh(pin, s).type); } catch (e) { if (!(e instanceof TypeError)) throw e; }
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
    const before = t.wanted.length;
    try {
      t.unify(instantiate(sc, t), rigid(p));
      // An interface the body needs must be one the pin says.
      const said = new Set((p.needs ?? []).map(([v, i]) => `${v}|${i}`));
      return t.wanted.slice(before).every((w) => {
        const r = t.resolve(w.t);
        if (r.t !== "con" || !r.id.startsWith(RIGID)) return true;
        return said.has(`${r.id.slice(r.id.lastIndexOf(".") + 1)}|${w.iface}`);
      });
    }
    catch (e) { if (e instanceof TypeError) return false; throw e; }
  }

  // A function in a variable or a definition whose row is already closed
  // (it does these effects and no others) can be used where more may happen: each use
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
        err(id, `${nm(target)} has no value here: it is used outside the function or case that introduces it`);
        return s.fresh();
      case "def":
        if (isTypeDef(target)) { err(id, `${nm(target)} is a type, not a value`); return s.fresh(); }
        if (mono.has(target)) return mono.get(target)!;
        // A definition whose own row came out closed (it stores its
        // continuation in a field that says its effects) is opened the
        // same way, so its callers may do more (BACKLOG I36).
        if (info.schemes.has(target)) return opened(instantiate(info.schemes.get(target)!, s, id));
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
          const { params, self } = dataType(def);
          const op = code.nodes[target] as NodeOf<"variant">;
          // Its own type variables are fresh at each call and not in the row (L71a).
          const own = new Map([...params, ...(op.params ?? []).map((p) => [p, s.fresh()] as const)]);
          const eff = s.freshRow([def]);
          if (params.size) eff.args = { [def]: (self as { args: Type[] }).args };
          return { t: "fn", params: op.fields.map((f) => typeExpr((code.nodes[f] as NodeOf<"field">).type, own)), ret: op.returns ? typeExpr(op.returns, own) : s.fresh(), eff };
        }
        if ((t as NodeOf<"variant">).private && insiders && !current.every((d) => insiders.has(d)))
          err(id, `${nm(target)} is private to the library, which keeps ${nm(def)}'s rule: build a ${nm(def)} with the library's functions (${SMART[target] ?? "see LIBRARY.md"})`);
        const { self, fields } = dataType(def);
        const fs = fields(target);
        return fs.length ? { t: "fn", params: fs, ret: self, eff: s.freshRow() } : self;
      }
      case "field": {
        const def = owner.get(target)!;
        const { td, self, fields } = dataType(def);
        if (td.variants.length !== 1) { err(id, `${nm(target)} belongs to one case of ${nm(def)}; use a match to reach it`); return s.fresh(); }
        const i = (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.indexOf(target);
        // An interface's field is its operation, at the type this use
        // needs, which must have an implementation (INTERFACES.md).
        if (td.interface && td.params.length === 1) {
          const a = (self as { args: Type[] }).args[0], op = fields(td.variants[0])[i];
          s.requireInterface(a, def, id);
          info.opAt!.set(id, a);
          return opened(op);
        }
        return { t: "fn", params: [self], ret: fields(td.variants[0])[i], eff: s.freshRow() };
      }
      default:
        err(id, `can't refer to a ${t.kind}`);
        return s.fresh();
    }
  }

  // Infers the type of expression `id`. `row` is the effect row of the
  // enclosing function body: every call adds its effects to it.
  // What a want for an interface is reported at (Subst.site): the
  // expression being checked, put back once its parts have been.
  function expr(id: Id, env: Map<Id, Type>, row: Row): Type {
    const was = s.site;
    s.site = id;
    try { return exprAt(id, env, row); } finally { s.site = was; }
  }
  function exprAt(id: Id, env: Map<Id, Type>, row: Row): Type {
    const n = code.nodes[id];
    let t: Type;
    switch (n?.kind) {
      case "lit": {
        // A plain number literal is some Number, whichever its use needs
        // (WHAT-NUMBER-MEANS.md; Haskell's fromInteger and fromRational):
        // arith.ts writes it at that type, and Float64 when nothing says.
        // One with a fraction part isn't an Int.
        if (!n.of && typeof n.value === "number") {
          const v = s.fresh(false, false, "arith") as { t: "var"; v: number };
          if (!Number.isInteger(n.value)) s.fractional.add(v.v);
          else s.whole.add(v.v);
          t = v;
        } else t = n.of ? { t: "con", id: n.of, args: [] } : str;
        // A literal at Rational is a whole number or top/bottom; at
        // Complex, a Float64 (its real part). arith.ts spells them out.
        if ((n.of === RATIONAL_TYPE || n.of === ALGEBRAIC_TYPE) && !ratioParts(n.value)) err(id, `${JSON.stringify(n.value)} isn't a fraction: write a whole number, or top/bottom with the bottom not 0`);
        if ((n.of === COMPLEX_TYPE || n.of === DUAL_TYPE) && typeof n.value !== "number") err(id, `${JSON.stringify(n.value)} isn't a number`);
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
        if (applied?.length === 1) {
          // gradient(f)(3): a number written there is a Float64 here, so
          // which record the slope is over is known now.
          const a = s.resolve(applied[0]);
          if (a.t === "var" && s.arith.has(a.v) && code.nodes[n.args[0]]?.kind === "lit") s.unify(a, num);
          at.set(n.fn, applied[0]);
        }
        const early = gradient ? n.args.map((a) => expr(a, env, row)) : null;
        const subsBefore = s.subs.length;
        const f = smoothDerivative(n) ?? (early && smoothGradient(n, early[0])) ?? expr(n.fn, env, row);
        for (let i = subsBefore; i < s.subs.length; i++) s.subs[i].at ??= id;
        const args = early ?? applied ?? n.args.map((a, i) => {
          // A recursive let (BACKLOG L84): a let is `(name ↦ body)(value)`,
          // and a value that's a function may call itself by the name, as
          // ML's `let rec` (monomorphic inside, as there). It's checked for
          // termination like a definition; lift-lets.ts makes it one.
          // The name is in scope in any function a let names, so the
          // palette offers it there before the first call is written.
          const f = code.nodes[n.fn], p = f?.kind === "lambda" && code.nodes[a]?.kind === "lambda" ? f.params[i] : undefined;
          if (!p) return expr(a, env, row);
          const self = s.fresh();
          const t = expr(a, new Map(env).set(p, self), row);
          unifyAt(a, self, t);
          if (!terminates(code, [p], () => code.nodes[a] as NodeOf<"lambda">)) {
            const r = s.resolve(t);
            try { if (r.t === "fn") s.unifyRow(r.eff, { effs: [DIVERGE], tail: s.next++ }); }
            catch (e) { if (e instanceof EffectError) err(a, `${nm(p)} might not finish, and it is used where only a function that surely finishes fits`); else throw e; }
          }
          return t;
        });
        const ret = s.fresh();
        // A search's call does what its function does besides Choice, and
        // the code beside it may do more: its row goes inside this one.
        const search = code.nodes[n.fn]?.kind === "ref" && SEARCHES.has((code.nodes[n.fn] as NodeOf<"ref">).target);
        const callRow = search ? s.freshRow() : row;
        if (search) s.subs.push({ from: callRow, to: row, at: id });
        let fr = s.resolve(f);
        // A definition that runs a function it's given backwards (the
        // prelude's inverse) has Choice and Diverge for any function. Given
        // a function known here, the modes can say what it does with that
        // one: no Diverge when it ends, no Choice when it gives exactly one
        // answer (BACKLOG L29, L47). The same for the function such a
        // definition gives back, run forward (the prelude's conjugate).
        const given = code.nodes[n.fn];
        if (fr.t === "fn" && given?.kind === "ref" && info.schemes.has(given.target) && fr.params.length === args.length) {
          const searches = (t: Type) => { if (t.t !== "fn") return null; const r = s.resolveRow(t.eff); return r.effs.includes(CHOICE) || r.effs.includes(DIVERGE) ? r : null; };
          const ret = s.resolve(fr.ret);
          const r = searches(fr), rr = searches(ret);
          if (r || rr) {
            const spec = new Map<number, Fn>();
            n.args.forEach((a, i) => {
              const x = code.nodes[a], t = x?.kind === "ref" ? code.nodes[x.target] : undefined;
              if (x?.kind === "lambda") spec.set(i, { k: "lambda", id: a });
              else if (t && (t.kind === "def" || t.kind === "builtin" || t.kind === "variant") && !(t.kind === "def" && isTypeDef(t.id))) spec.set(i, { k: t.kind, id: t.id });
            });
            // Only for functions that don't act: one that does can't be run
            // backwards at all, and is refused as before.
            const acts = [...spec.keys()].some((i) => { const t = s.resolve(args[i]); return t.t === "fn" && s.resolveRow(t.eff).effs.some((e) => e !== CHOICE && e !== DIVERGE); });
            const dropped = (row: Row, v: ReturnType<ReturnType<typeof analyzer>["ofMode"]> | null): Row | null => {
              const drop = v && !v.stuck.length && !v.dynamic.length ? [...(v.ends ? [DIVERGE] : []), ...(v.ends && determinism(v.answers) === "det" ? [CHOICE] : [])] : [];
              return drop.length ? { ...row, effs: row.effs.filter((e) => !drop.includes(e)) } : null;
            };
            if (spec.size && !acts) {
              modes ??= analyzer(code, names);
              const mine = r && dropped(r, modes.ofMode(given.target, args.map((_, i) => String(i)), spec));
              const theirs = rr && ret.t === "fn" && dropped(rr, modes.ofReturned(given.target, spec));
              if (mine || theirs) fr = { ...fr, ...(mine ? { eff: mine } : {}), ...(theirs && ret.t === "fn" ? { ret: { ...ret, eff: theirs } } : {}) };
            }
          }
        }
        // `/`, `sqrt`, `log`, `^` and `mod` have no answer at some inputs,
        // so Choice, unless the inputs here are known to be fine (L125b).
        if (fr.t === "fn" && given?.kind === "ref" && PARTIAL[given.target]) {
          signs ??= signAnalysis(code);
          const r = s.resolveRow(fr.eff);
          if (r.effs.includes(CHOICE) && signs.answered(id)) { fr = { ...fr, eff: { ...r, effs: r.effs.filter((e) => e !== CHOICE) } }; info.answered!.add(id); }
        }
        // A definition whose only Choice is such a builtin's, called with
        // inputs that answer it (period(1, 9.81)), has none here (L125b).
        else if (fr.t === "fn" && given?.kind === "ref" && code.nodes[given.target]?.kind === "def" && info.schemes.has(given.target)) {
          const r = s.resolveRow(fr.eff);
          if (r.effs.includes(CHOICE)) {
            signs ??= signAnalysis(code);
            const searches = (f: Id): boolean => {
              const sc = info.schemes.get(f);
              if (sc) return sc.type.t === "fn" && s.resolveRow(sc.type.eff).effs.includes(CHOICE);
              const k = code.nodes[f]?.kind;
              if (k === "def") return true;
              if (k === "variant" || k === "field") return false;
              // A builtin's own type says it, read once, on a Subst of its
              // own: cloning the program's for it cost seconds (C67e).
              if (!builtinSearches.has(f)) { const sig = SIGS[f]?.(new Subst()); builtinSearches.set(f, !sig || (sig.t === "fn" && sig.eff.effs.includes(CHOICE))); }
              return builtinSearches.get(f)!;
            };
            if (signs.totalCall(id, searches)) { fr = { ...fr, eff: { ...r, effs: r.effs.filter((e) => e !== CHOICE) } }; info.answered!.add(id); }
          }
        }
        if (fr.t === "fn" && fr.params.length !== args.length) {
          err(id, `${callee(n)} takes ${fr.params.length} inputs, given ${args.length}`);
          t = fr.ret;
          break;
        }
        // Which inputs are some Number not yet known, for the message if
        // one is given where something else goes.
        const someNumber = args.map((a) => { const r = s.resolve(a); return r.t === "var" && s.arith.has(r.v); });
        // A call back into the group being checked (a recursive call) has
        // its inputs checked after the group's bodies (BACKLOG I118): the
        // body's own uses fix the types first, so a wrong recursive call is
        // blamed, not a right use that came after it.
        const back = given?.kind === "ref" && current.includes(given.target) && fr.t === "var";
        const params = back ? args.map(() => s.fresh()) : args;
        if (back) recursiveCalls.push({ call: n, params, args });
        try {
          s.unify(fr, { t: "fn", params, ret, eff: callRow });
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
          else if (e instanceof NumbersError) err(id, `${callee(n)} works only on records of Float64s (Float64, or one case whose fields are all Float64s)`);
          else if (e instanceof ArithError) {
            // A number given where something else goes, or a function on
            // numbers given something else.
            const ft = s.resolve(f);
            const given = ft.t === "fn" ? ft.params.findIndex((p, i) => {
              const want = s.resolve(p);
              return someNumber[i] && want.t === "con" && !isNumberType(want);
            }) : -1;
            if (given >= 0 && ft.t === "fn") err(n.args[given], `${callee(n)} needs ${show(ft.params[given])} here, and a number isn't one`);
            else err(id, `${callee(n)} works only on ${ARITH_WHAT[e.kind]}`);
          }
          else if (e instanceof FractionError) err(id, `${callee(n)} needs an Int here, and a number with a fraction part can't be one`);
          else if (e instanceof PlainError) err(id, `${callee(n)} works only on plain data (no functions inside), and this has functions in it`);
          else if (e instanceof TypeError) {
            // Find the argument that's wrong, for a useful message.
            const ft = s.resolve(f);
            if (ft.t !== "fn") err(id, `${callee(n)} is ${show(f)}, not a function`);
            else {
              let found = false;
              ft.params.forEach((p, i) => { try { s.clone().unify(p, args[i]); } catch { found = true; err(n.args[i], `${callee(n)} needs ${show(p)} here, got ${show(args[i])}`); } });
              // Every input fits, so it's the effects: an effect's type
              // argument here differs from the one it has around this call
              // (Yield Int there, Yield Text here).
              if (!found) err(id, `${callee(n)} is ${show(ft)} here, and its effects don't fit the ones around it: an effect is used at two types`);
            }
          } else throw e;
        }
        // An update needs to know which field it changes, so its first input
        // is a field or a path of them, written in place (or a hole, still
        // to be filled with one).
        if (code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === SET && n.args.length && !fieldPath(code, n.args[0], true)
          && !info.errors.some((e) => e.id === n.args[0])) {
          err(n.args[0], "set needs a field here, or a path of fields such as (p) ↦ p.address.city");
        }
        if (code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === CELL_OPS.path && n.args.length && !placePath(code, n.args[0], true)
          && !info.errors.some((e) => e.id === n.args[0])) {
          err(n.args[0], "path needs a field here, a path of fields such as (t) ↦ t.address.city, or (t) ↦ t for the whole");
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
  // over a record of Float64s, every part's slope must be readable; over a
  // Float64, it's derivative.
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
    // An interface's field with results (POLAR.md, L97c): the type's own
    // definition answers it, in the direction the field declares, with one
    // answer. Ports are positions.
    const field = code.nodes[n.fn];
    if (field?.kind === "field" && field.results) {
      const ty = code.nodes[field.type];
      const ins = ty?.kind === "tfun" ? ty.params.map((_, i) => i).filter((i) => !field.results!.includes(i)) : [];
      const given = Object.keys(n.given).filter((k) => k !== "out").map(Number);
      const port = (i: number) => field.ports?.[i] ?? String(i);
      if (given.length !== ins.length || !ins.every((i) => given.includes(i)) || !Object.keys(n.binds).every((k) => field.results!.includes(Number(k))))
        err(n.id, `${nm(n.fn)} gives ${field.results.map(port).join(", ")} from ${ins.map(port).join(", ")}`);
      relationalSolve(n, env, row, inner, false, undefined, true);
      return expr(n.body, inner, row);
    }
    // A given that is an Int makes the solve a whole-number one (L38),
    // found from its type, not from how the function is written.
    const givenTypes = new Map(Object.entries(n.given).map(([k, g]) => [k, expr(g, env, row)] as const));
    if ([...givenTypes.values()].some((t) => { const r = s.resolve(t); return r.t === "con" && r.id === INT; })) solvesInWholeNumbers(code, n.id);
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
      relationalSolve(n, env, row, inner, v ? !v.ends : true, v?.loops[0], oneAnswer(code, n), givenTypes);
      return expr(n.body, inner, row);
    }
    // A predicate's out = true is a Bool; every other port is a number.
    const outTrue = (k: string) => !!p?.predicate && k === "out";
    // A given whose type isn't known yet may turn out an Int later in the
    // definition (L38's open end): it waits until the definition is read,
    // and an Int then makes this a whole-number solve, checked again.
    const open = Object.entries(n.given).filter(([k]) => !outTrue(k) && s.resolve(givenTypes.get(k)!).t === "var");
    if (open.length && runsBackwards(code, n.fn)) waiting.push({ solve: n.id, givens: open.map(([k, g]) => [g, givenTypes.get(k)!]) });
    for (const [k, g] of Object.entries(n.given)) if (!open.some(([o]) => o === k) || !runsBackwards(code, n.fn)) unifyAt(g, outTrue(k) ? bool : num, givenTypes.get(k)!, "a given port");
    for (const b of Object.values(n.binds)) { inner.set(b, num); info.typeOf.set(b, num); }
    if (p) {
      const ports = p.rel!.ports;
      for (const k of [...Object.keys(n.given), ...Object.keys(n.binds)]) if (!ports.includes(k) && !outTrue(k)) err(n.id, `${nm(n.fn)} has no port ${k}`);
      if (p.status !== "solved") err(n.id, `${nm(n.fn)} needs ${p.needMore} more known port${p.needMore === 1 ? "" : "s"} to be solved this way`);
      else if (!p.unique && !computedForward(code, n)) choice(n.id, row, [CHOICE], `solving ${nm(n.fn)} this way may give several answers or none (Choice), which nothing here handles`);
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
  function relationalSolve(n: NodeOf<"solve">, env: Map<Id, Type>, row: Row, inner: Map<Id, Type>, loops: boolean, why?: string, one = false, givenTypes?: Map<string, Type>) {
    const ft = s.resolve(refType(n.id, n.fn, env));
    if (ft.t !== "fn") { err(n.id, `${nm(n.fn)} is not a function`); return; }
    (info.solveAt ??= new Map()).set(n.id, ft);
    const t = code.nodes[n.fn];
    const keys = t.kind === "def" ? (code.nodes[t.body!] as NodeOf<"lambda">).params : ft.params.map((_, i) => String(i));
    const portType = (k: string) => (k === "out" ? ft.ret : keys.includes(k) ? ft.params[keys.indexOf(k)] : null);
    for (const [k, g] of Object.entries(n.given)) {
      const pt = portType(k);
      const gt = givenTypes?.get(k) ?? expr(g, env, row);
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
  // The normal finish (BACKLOG L57): a handler's `otherwise` is a function
  // written in place, given the computation's value when it finishes
  // without escaping, `| done(x) → some(x)`, so a handler can change the
  // result's type (OCaml's value case). Without one, the match's value is
  // the computation's.
  // A match on an effect's operations: the computation it handles may do
  // the effect, and the match doesn't (the ledger, ledger.ts).
  function handle(n: NodeOf<"match"> | NodeOf<"fold">, effect: Id, arms: NodeOf<"arm">[], env: Map<Id, Type>, row: Row, result: Type): Type {
    if (n.kind === "fold") err(n.id, `${nm(effect)} is an effect; its operations are handled with a match, not folded`);
    const rest = s.next++;
    s.unifyRow({ effs: [], tail: rest }, row);
    const { params, self } = dataType(effect);
    const handled: Row = { effs: [effect], tail: rest, ...(params.size ? { args: { [effect]: (self as { args: Type[] }).args } } : {}) };
    const done = n.kind === "match" ? n.otherwise : null;
    const value = done ? s.fresh() : result;
    unifyAt(n.scrutinee, value, expr(n.scrutinee, env, handled), "the handled computation");
    if (done) {
      if (code.nodes[done].kind !== "lambda") err(done, `a handler's normal finish is a function written in place, given the computation's value: done(x) → …`);
      else unifyAt(done, { t: "fn", params: [value], ret: result, eff: row }, expr(done, env, row), "the normal finish");
    }
    const seen = new Set<Id>();
    for (const arm of arms) {
      if (owner.get(arm.variant) !== effect) { err(arm.id, `${nm(arm.variant)} is not an operation of ${nm(effect)}`); continue; }
      if (seen.has(arm.variant)) err(arm.id, `${nm(arm.variant)} is handled twice`);
      seen.add(arm.variant);
      const op = code.nodes[arm.variant] as NodeOf<"variant">;
      // The operation's own type variables are rigid here: the case works
      // for every one of them (L71a), so it can pass a ticket on but can't
      // take its answer to be a Text.
      const opParams = new Map([...params, ...(op.params ?? []).map((p) => [p, { t: "con", id: `${RIGID}any.${p}`, args: [] } as Type] as const)]);
      const fs = op.fields.map((f) => typeExpr((code.nodes[f] as NodeOf<"field">).type, opParams));
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
        const t: Type = { t: "fn", params: [typeExpr(r!, opParams)], ret: result, eff: row };
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
      unifyAt(arm.body, typeExpr(r, opParams), expr(arm.body, inner, own), `the answer to ${nm(arm.variant)}`);
      if (s.resolveRow(own).effs.includes(CHOICE)) err(arm.body, `the answer to ${nm(arm.variant)} must be one value, and this may give several or none: handle the Choice here (first, optional)`);
      try { s.unifyRow(own, row); } catch (e) { if (e instanceof EffectError) err(arm.body, `this case performs ${effName(e)}, which nothing here handles`); else throw e; }
    }
    const missing = typedefOf(effect)!.variants.filter((v) => !seen.has(v));
    if (missing.length) err(n.id, `no case for ${missing.map(nm).join(", ")}: a handler handles every operation of ${nm(effect)}`);
    return result;
  }

  // Implementations (INTERFACES.md): the definitions whose type is an
  // interface at a closed type, one for each pair; then every known type a
  // use asked for an interface must have one.
  const resultsGiven: { impl: Id; field: Id; by: Id }[] = [];
  function implementations() {
    const table = info.implementations!;
    let ways: Ways | undefined;
    for (const d of valueDefs) {
      const sc = info.schemes.get(d);
      const t = sc && s.zonk(sc.type);
      if (!t || t.t !== "con" || !typedefOf(t.id)?.interface || freeVars(t, s).vars.size) continue;
      const body = code.nodes[(code.nodes[d] as NodeOf<"def">).body!];
      const fn = body?.kind === "call" ? code.nodes[body.fn] : null;
      if (fn?.kind !== "ref" || fn.target !== typedefOf(t.id)!.variants[0]) { err(d, `${nm(d)} is an implementation of ${nm(t.id)}, so it is written as the record itself: ${nm(typedefOf(t.id)!.variants[0])}(…) with each operation`); continue; }
      const key = implementationKey(t.id, t.args[0]), other = table.get(key);
      if (other) err(d, `${nm(other)} and ${nm(d)} are both ${show(t)}: a type has one implementation of an interface, so keep one`);
      else table.set(key, d);
      // A field left to its ways needs a way that ends in fields it gives
      // (WAYS.md, L96b): said here, before anything runs.
      const args = (body as NodeOf<"call">).args, variant = code.nodes[fn.target] as NodeOf<"variant">;
      // A field with results (POLAR.md) is given by a definition that
      // declares the same results; checked in results(), with its direction.
      variant.fields.forEach((f, i) => { const fl = code.nodes[f], a = code.nodes[args[i]]; if (fl?.kind === "field" && fl.results && a?.kind === "ref" && !leftToWays(code, args[i])) resultsGiven.push({ impl: d, field: f, by: a.target }); });
      if ((!reuse || reuse.only.has(d)) && args.some((a) => leftToWays(code, a))) {
        const pick = pickWays(code, ways ??= waysIn(code), variant, args);
        const stuck = variant.fields.filter((f) => !pick.has(f));
        if (stuck.length) err(d, `${nm(d)} leaves ${stuck.map(nm).join(", ").replace(/, ([^,]*)$/, " and $1")} to ${stuck.length === 1 ? "its ways" : "their ways"}, and none of them ends in a field it gives: give ${stuck.length === 1 ? "it, or a field its ways use" : "one of them, or a field their ways use"}`);
      }
    }
    for (const w of s.wanted) {
      const t = s.zonk(w.t);
      if (table.has(implementationKey(w.iface, t))) continue;
      const of = show({ t: "con", id: w.iface, args: [t] });
      // + − · and < say what a Number is first, as they always have.
      if (w.iface === "std.arithmetic" || w.iface === "std.ordered") {
        const ordered = w.iface === "std.ordered";
        err(w.at || current[0], `${show(t)} isn't ${ARITH_WHAT[ordered ? "ordered" : "arith"]}, and has no ${ordered ? "<" : "+ − ·"} of its own: give it one, a definition of type ${of}`, { iface: w.iface, type: t });
      } else err(w.at || current[0], `${show(t)} has no ${nm(w.iface)}: give it one, a definition of type ${of}`, { iface: w.iface, type: t });
    }
  }

  // Units are part of a number's type: a conflict is a type error.
  for (const u of unitProblems(code, names, reuse?.only, reuse?.units)) err(u.id, u.message);

  // Definitions with results (RESULTS.md, L95): a predicate whose result
  // ports are named, in order. The direction they declare must be one the
  // inputs pin down, said here at the definition rather than at a use.
  function results() {
    for (const d of valueDefs) {
      const def = code.nodes[d] as NodeOf<"def">;
      if (!def.results) continue;
      // Not rechecked: its direction is as it was. (The palette's check of
      // each filling looked again at every definition with results, 25 ms
      // a filling: adding a value on physics fall took 18 s, I69.)
      if (reuse && !reuse.only.has(d)) { const was = reuse.from.directions?.get(d); if (was) (info.directions ??= new Map()).set(d, was); continue; }
      const lam = def.body ? code.nodes[def.body] : null;
      if (lam?.kind !== "lambda") { err(d, `${nm(d)} has results, so it is a function of its ports`); continue; }
      const odd = def.results.filter((r, i) => !lam.params.includes(r) || def.results!.indexOf(r) !== i);
      if (odd.length) { err(d, `${nm(d)}'s results are some of its own ports, each once: ${odd.map(nm).join(", ")} isn't`); continue; }
      const sc = info.schemes.get(d), t = sc && s.zonk(sc.type);
      if (t?.t === "fn" && !(t.ret.t === "con" && t.ret.id === BOOL)) { err(d, `${nm(d)} has results, so it is a predicate over its ports (it gives true or false), not ${show(t.ret)}`); continue; }
      const ins = lam.params.filter((p) => !def.results!.includes(p));
      const from = ins.length ? ins.map(nm).join(", ") : "nothing";
      const r = resultsDirection(code, d, names);
      if ("effects" in r) (info.directions ??= new Map()).set(d, r.effects);
      const why = "why" in r ? r.why : null;
      if (why) err(d, `${nm(d)}'s results can't all be found from ${from}: ${why}`);
      // Another direction of a relation (POLAR.md, L97b): its ports, in
      // order, are the relation's, of the same types.
      if (!def.direction || why) continue;
      const wrong = directionProblem(code, d, nm);
      if (wrong) { err(d, wrong); continue; }
      const theirs = info.schemes.get(def.direction);
      if (sc && theirs) { try { const c = s.clone(); c.unify(instantiate(sc, c), instantiate(theirs, c)); } catch { err(d, `${nm(d)} is a direction of ${nm(def.direction)}, so its ports have ${nm(def.direction)}'s types: ${show(sc.type)} isn't ${show(theirs.type)}`); } }
    }
  }

  settle();
  implementations();
  results();
  // Each field with results given by a definition with the same results,
  // in that direction with one answer (POLAR.md, L97c).
  for (const { impl, field, by } of resultsGiven) {
    const fl = code.nodes[field] as NodeOf<"field">, d = code.nodes[by];
    const lam = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
    const port = (i: number) => fl.ports?.[i] ?? String(i);
    const want = `${fl.results!.map(port).join(", ")} from ${(fl.ports ?? []).filter((_, i) => !fl.results!.includes(i)).join(", ")}`;
    const same = d?.kind === "def" && lam?.kind === "lambda" && d.results?.length === fl.results!.length && d.results.every((r, i) => lam.params.indexOf(r) === fl.results![i]);
    if (!same) err(impl, `${nm(impl)} gives ${nm(field)} as ${nm(by)}, which must name its results the way ${nm(field)} does: ${want}`);
    else if (info.directions?.get(by)?.length) err(impl, `${nm(impl)} gives ${nm(field)} as ${nm(by)}, which must give ${want} with one answer, and it may give several or none`);
  }
  // A representation's job (REPRESENTATIONS.md, L108): `job(of, by, cost)`
  // does t's job `of` at r, so `by` has of's type with r for t.
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "call" || n.args.length !== 3) continue;
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || f.target !== JOBS.job) continue;
    const job = info.typeOf.get(n.id), of = info.typeOf.get(n.args[0]), by = info.typeOf.get(n.args[1]);
    if (!job || !of || !by) continue;
    const j = s.zonk(job);
    if (j.t !== "con" || j.args.length !== 2) continue;
    const t = s.zonk(j.args[0]), r = j.args[1];
    if (t.t !== "con") continue;
    const at = (x: Type): Type => {
      x = s.zonk(x);
      if (x.t === "con") return x.id === t.id ? r : { ...x, args: x.args.map(at) };
      if (x.t === "fn") return { ...x, params: x.params.map(at), ret: at(x.ret) };
      return x;
    };
    const want = at(of);
    try { const c = s.clone(); c.unify(want, by); } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      err(n.args[1], `this does ${show(of)}'s job at ${show(r)}, so its type is ${show(want)}, not ${show(by)}`);
    }
  }
  if (again) return infer(code, names, reuse, opts);
  for (const [id, t] of info.typeOf) info.typeOf.set(id, s.zonk(t));
  for (const [id, t] of info.opAt!) info.opAt!.set(id, s.zonk(t));
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
// divergent. An Int counted towards a bound its guard compares it with
// (counting.ts, L46) strictly shrinks too: its distance to the bound does.
type Arc = [from: number, to: number, strict: boolean];
// The definitions a representation row names as its match (`match by`).
const matchers = new WeakMap<object, Set<Id>>();
// What is kept by a nodes object, forgotten when it changes (fillings).
function forgetNodes(nodes: object) { matchers.delete(nodes); forgetDerived(nodes); }
function matchersOf(code: Code): Set<Id> {
  let m = matchers.get(code.nodes);
  if (!m) {
    m = new Set();
    for (const n of Object.values(code.nodes)) {
      if (n.kind !== "call") continue;
      const f = code.nodes[n.fn], by = code.nodes[n.args[0]];
      if (f?.kind === "ref" && f.target === JOBS.matchBy && by?.kind === "ref") m.add(by.target);
    }
    matchers.set(code.nodes, m);
  }
  return m;
}
interface CallGraph { from: Id; to: Id; arcs: Arc[] }

// A let's function that calls itself by its name (BACKLOG L84): the let's
// binder, when the call's function is a lambda and its i-th input is a
// lambda that refers to the i-th parameter.
export function recursiveLet(code: Code, call: NodeOf<"call">, i: number): Id | null {
  const f = code.nodes[call.fn], a = code.nodes[call.args[i]];
  if (f?.kind !== "lambda" || a?.kind !== "lambda" || !f.params[i]) return null;
  const p = f.params[i];
  return subtree(code, a.id).some((x) => { const n = code.nodes[x]; return n?.kind === "ref" && n.target === p; }) ? p : null;
}

// `lambdaOf`: the function each member is, a definition's body by default
// (a recursive let's binder names its lambda).
function terminates(code: Code, group: Id[], lambdaOf = (d: Id) => { const body = (code.nodes[d] as NodeOf<"def">).body; return body ? code.nodes[body] : null; }): boolean {
  const inGroup = new Set(group);
  const graphs: CallGraph[] = [];
  for (const d of group) {
    const lam = lambdaOf(d);
    if (lam?.kind !== "lambda") return false;
    // An Int counted towards a bound shrinks at that call (L46, counting.ts).
    const counted = group.length === 1 ? countedCalls(code, d, lam) : new Set<string>();
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
          n.args.forEach((_, j) => { if (counted.has(`${n.id}:${j}`)) arcs.push([j, j, true]); });
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
      // A representation's match (REPRESENTATIONS.md; array of List's,
      // C30d3b) takes its first argument apart like a match: the
      // parameters of the functions given to it are pieces of it.
      if (n.kind === "call" && code.nodes[n.fn]?.kind === "ref" && matchersOf(code).has((code.nodes[n.fn] as NodeOf<"ref">).target)) {
        const from = sizeOf(n.args[0]);
        if (from) for (const a of n.args.slice(1)) {
          const l = code.nodes[a];
          if (l?.kind === "lambda") for (const p of l.params) size.set(p, new Map([...from.keys()].map((i) => [i, true])));
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
  | { kind: "lambda"; arity: number; params?: Type[] }
  // A definition with results used the way it declares: `x, y = polar(□, □)`.
  | { kind: "use"; target: Id };

// Everything that can go in a hole without a type or effect error: variables
// in scope, definitions, builtins and constructors (as values, or called with
// holes for their inputs when their result fits), literals, and a case
// analysis of any data in scope. This is the editor's palette: it never
// offers something that would be an error, so the user can't make one.
const isInterface = (code: Code, def: Id): boolean => {
  const body = (code.nodes[def] as NodeOf<"def"> | undefined)?.body;
  return !!body && code.nodes[body]?.kind === "typedef" && !!(code.nodes[body] as NodeOf<"typedef">).interface;
};

// A definition with results asked in its direction, as a use would ask
// it: the other ports given, out true. Either why its results can't all be
// found, or the effects that direction has (Choice for more than one
// answer, Diverge for a search that may not end).
export function resultsDirection(code: Code, d: Id, names: Names = {}): { why: string } | { effects: Id[] } {
  const def = code.nodes[d] as NodeOf<"def">;
  const lam = code.nodes[def.body!] as NodeOf<"lambda">;
  const ins = lam.params.filter((p) => !def.results!.includes(p));
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: Node) => { nodes[n.id] = n; return n.id; };
  const given = Object.fromEntries(ins.map((p) => [p, add({ id: `${d}:given:${p}`, kind: "hole" })]));
  given.out = add({ id: `${d}:true`, kind: "ref", target: TRUE });
  const binds = Object.fromEntries(def.results!.map((r) => [r, add({ id: `${d}:as:${r}`, kind: "binder" })]));
  const use = { id: `${d}:results`, kind: "solve", fn: d, given, binds, body: add({ id: `${d}:body`, kind: "hole" }) } as NodeOf<"solve">;
  add(use);
  const asked = { nodes, defs: code.defs };
  try {
    const p = planSolve(asked, use);
    let ends = true;
    if (p.mode === "relational") {
      const v = solveMode(asked, use, names);
      const stuck = v?.stuck.filter((x) => x !== "a hole") ?? [];
      if (stuck.length) return { why: stuck.find((x) => x.startsWith("nothing gives")) ?? `${stuck[0]} never gets what it needs` };
      ends = !!v?.ends;
    } else if (p.status !== "solved") return { why: `it needs ${p.needMore} more known port${p.needMore === 1 ? "" : "s"}` };
    return { effects: [...(oneAnswer(asked, use) ? [] : [CHOICE]), ...(ends ? [] : [DIVERGE])] };
  } catch (e) { return { why: (e as Error).message }; }
}

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
  // A type it pins an interface's variable to must have an
  // implementation (INTERFACES.md): sin fits where a Float64 goes, not
  // where Text does.
  const implemented = (s: Subst, from: number) => s.wanted.slice(from).every((w) => {
    const t = s.zonk(w.t);
    return t.t !== "con" || !!info.implementations?.has(implementationKey(w.iface, t));
  });
  const fits = (t: Type, asCall: boolean): Subst | null => {
    const s = info.subst.trial();
    const from = s.wanted.length;
    try {
      if (!asCall) { s.unify(h.expected, t); return implemented(s, from) ? s : null; }
      const r = s.resolve(t);
      if (r.t !== "fn") return null;
      s.unify(h.expected, r.ret);
      s.unifyRow(r.eff, h.row);
      return implemented(s, from) ? s : null;
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
  // Each filling is made once for both checks below, which ask one after
  // the other.
  // All of them are written into one copy of the program's nodes, the
  // last one taken out before the next goes in, instead of a copy of the
  // ~10,000 nodes each (BACKLOG E133a, SHARED-NODES.md). Each gets a Code
  // of its own, so what is kept by the Code is its own; what is kept by
  // the nodes is forgotten at each change.
  let last: [Filling, Code] | undefined, scratch: Record<Id, Node> | undefined, undo: (() => void) | undefined;
  const filled = (f: Filling): Code => {
    if (last?.[0] === f) return last[1];
    undo?.();
    forgetNodes(scratch ??= { ...code.nodes });
    const r = fillHole(code, {}, hole, f, {}, scratch);
    undo = r.undo;
    derivedFrom(r.code, code, subtree(r.code, hole));
    return (last = [f, r.code])[1];
  };
  let before: Problem[] | undefined;
  const units = new UnitsBefore(code);
  const recheck = (c: Code) => infer(c, {}, { from: info, only: affected, units }, info.options).errors;
  const baseline = () => (before ??= recheck(code));
  // A filling passes when it brings no error the program didn't have: not
  // only no more of them, since filling the hole can clear one (a
  // definition's results found again) while it makes another (a pinned
  // implementation's type broken).
  const noNew = (errs: Problem[]) => {
    const was = new Map<string, number>();
    for (const e of baseline()) was.set(e.message, (was.get(e.message) ?? 0) + 1);
    return errs.every((e) => { const n = was.get(e.message) ?? 0; was.set(e.message, n - 1); return n > 0; });
  };
  const whole = (f: Filling) => noNew(recheck(filled(f)));
  // A function that brings Choice where the world is (or the world under
  // a Choice) is checked against the whole program, and what that check
  // finds about the mix is the same for every function bringing the same
  // effects here: the first one's answer is kept for the rest (I40). A
  // pass says the mix is fine, so the others are checked like any other
  // filling; a failure only of the world under a Choice refuses them all.
  const mixing = new Map<string, boolean>();
  const mixChecked = (f: Filling, mix: string): boolean | undefined => {
    const k = `${mix}|${f.kind}`, known = mixing.get(k);
    if (known !== undefined) return known ? undefined : false;
    const errs = recheck(filled(f));
    if (noNew(errs)) { mixing.set(k, true); return true; }
    const was = new Set(baseline().map((e) => e.message));
    if (errs.every((e) => was.has(e.message) || e.message.includes("while a Choice is open"))) mixing.set(k, false);
    return false;
  };
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
      // (Running up to a hole isn't a difference: while one is left, what
      // waits on it, such as a call given holes, is stuck for that reason
      // alone, so a call filled in with holes leaves the plan as it was:
      // BACKLOG E103.)
      const v = p.mode === "relational" ? solveMode(c, n, {}) : null;
      return [p.mode, p.status, p.needMore, p.many, p.canFail, p.unique, p.predicate, p.rel?.ports.join(","), v ? `${v.ends}/${determinism(v.answers)}/${v.stuck.includes("a hole") ? "" : v.stuck.join(",")}` : ""].join("|");
    }
    catch (e) { return `!${(e as Error).message}`; }
  }).join(";");
  let planned: string | undefined;
  // What a whole check says, units aside, follows from what a filling
  // makes of the group's types (and, where it changes one, of its solves'
  // plans): fillings that make the same of them pass or fail together, so
  // one check answers for them all. Units are the exception: what a call
  // does to them is the callee's own (multiply multiplies them, add needs
  // them equal), so each filling's units are checked on their own, a small
  // part of a check (BACKLOG E103: fall's holes asked ~1,000 whole checks
  // each, one per thing an offer names).
  const groupTypes = h.group.flatMap((d) => { const sc = info.schemes.get(d); return sc ? [sc.type] : []; });
  const unitsOf = (c: Code) => new Set(unitProblems(c, {}, affected, units).map((u) => u.message));
  let unitsBefore: Set<string> | undefined;
  const noNewUnits = (now: Set<string>) => [...now].every((m) => (unitsBefore ??= unitsOf(code)).has(m));
  const checked = new Map<string, boolean>();
  const byKind = (key: string, f: Filling): boolean => {
    let ok = checked.get(key);
    if (ok === undefined) {
      const unit = unitsOf(filled(f));
      checked.set(key, (ok = noNew(recheck(filled(f)).filter((e) => !unit.has(e.message)))));
      return ok && noNewUnits(unit);
    }
    return ok && noNewUnits(unitsOf(filled(f)));
  };

  // The plans a filling makes, or null when they are the program's.
  const newPlans = (f: Filling): string | null => { const now = plans(filled(f)); return now === (planned ??= plans(code)) ? null : now; };
  const pinnedGroup = h.group.some((d) => info.options?.pins?.[d]);
  const around: Type[] = [h.expected, { t: "fn", params: h.scope.map((b) => b.type), ret: h.expected, eff: h.row }];
  let aroundBefore: string | undefined;
  // A definition with results is checked by its direction's verdict too
  // (results(), and an implementation that gives it), which its body
  // decides: splitting an input there is checked against the program.
  const withResults = h.group.some((d) => { const n = code.nodes[d]; return n?.kind === "def" && !!n.results; });
  // A definition with results here or among what depends on this one has
  // a direction its body decides, so each filling asks it again (I100):
  // one with something else where a result's length was used can leave a
  // result unfound, or give it several answers where an implementation
  // needs one (float64 polar, cordic vector). A filling that keeps every
  // direction as it was is checked like any other; one that
  // loses a result is refused, and one that changes its effects (an
  // implementation may need one answer) is checked against the program.
  const directions = new Map([...affected].flatMap((d) => { const n = code.nodes[d]; return n?.kind === "def" && !!n.results && code.nodes[n.body!]?.kind === "lambda" ? [[d, JSON.stringify(resultsDirection(code, d))] as const] : []; }).filter(([, r]) => !r.includes('"why"')));
  const direction = (f: Filling): "same" | "lost" | "changed" => {
    let out: "same" | "changed" = "same";
    for (const [d, was] of directions) {
      const now = resultsDirection(filled(f), d);
      if ("why" in now) return "lost";
      if (JSON.stringify(now) !== was) out = "changed";
    }
    return out;
  };
  const safe = (s: Subst, f: Filling, risky: boolean, mix?: string) => {
    if (mix && !risky) { const m = mixChecked(f, mix); if (m !== undefined) return m; }
    const dir = directions.size ? direction(f) : "same";
    if (dir === "lost") return false;
    if (dir === "changed") return whole(f);
    if (risky || (withResults && (f.kind === "match" || f.kind === "fold"))) return whole(f);
    const plan = solves.length ? newPlans(f) : null;
    if (plan !== null) return byKind(`plan ${plan}|${groupKey(s, [...groupTypes, ...around])}`, f);
    // A row only renamed pins nothing: a pure call's empty row joining the
    // definition's. (A type variable renamed may still be pinned: the new
    // one can carry a constraint, records of Float64s say.)
    const touches = pinned.some((k) => {
      const v = +k.slice(1);
      if (k[0] === "t") return s.types.has(v);
      if (!s.rows.has(v)) return false;
      const r = s.resolveRow({ effs: [], tail: v });
      return r.effs.length > 0 || r.tail === null || pinned.includes(`r${r.tail}`);
    });
    // A pinned group's own type is the pin's, so what its body makes of
    // the hole is seen in the hole: the type it expects, the effects
    // around it, the inputs in scope. Fillings that change none of those
    // keep the pin; the others are checked against it.
    const held = pinnedGroup && groupKey(s, around) !== (aroundBefore ??= groupKey(info.subst, around));
    if (!touches && !held) return true;
    return byKind(groupKey(s, [...groupTypes, ...(pinnedGroup ? around : [])]), f);
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
    const effs = ft.t === "fn" ? info.subst.resolveRow(ft.eff).effs : [];
    const mix = mixes(effs) ? [...effs].sort().join(",") : undefined;
    const asRef = fits(t, false);
    const ref: Filling = { kind: "ref", target, type: t };
    if (asRef && safe(asRef, ref, risky, mix)) out.push(ref);
    const r = info.subst.resolve(t);
    const asCall = r.t === "fn" ? fits(t, true) : null;
    const call: Filling = { kind: "call", target, arity: r.t === "fn" ? r.params.length : 0, type: t };
    if (asCall && safe(asCall, call, risky, mix)) out.push(call);
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
  // `by its ways` only for an implementation's field that has a way.
  const wayField = () => {
    const call = Object.values(code.nodes).find((n): n is NodeOf<"call"> => n.kind === "call" && n.args.includes(hole));
    const v = call && code.nodes[call.fn]?.kind === "ref" ? code.nodes[(code.nodes[call.fn] as NodeOf<"ref">).target] : null;
    return v?.kind === "variant" && waysIn(code).has(v.fields[call!.args.indexOf(hole)]);
  };
  for (const [id, sig] of Object.entries(SIGS)) if (!PER_TYPE.has(id) && (id !== S.byItsWays || wayField())) consider(id, sig(info.subst));
  // A private constructor only where the checker would take it.
  const insiders = info.options?.insiders ? new Set(info.options.insiders) : null;
  const outside = !!insiders && !h.group.every((d) => insiders.has(d));
  const atTop = Object.values(code.nodes).some((d) => d.kind === "def" && d.body === hole);
  for (const [part, def] of info.owner) {
    const n = code.nodes[part];
    // An interface's constructor makes an implementation, so it's offered
    // only as a definition's whole body: elsewhere an operation of the same
    // name (Twice's twice) is what's meant (BACKLOG E141).
    if (n.kind === "variant") { if (!(n.private && outside) && (atTop || !isInterface(code, def))) consider(part, constructorType(code, info.subst, def, part)); }
    // A field of a one-case type reads it from a value: fst(p), pages(c).
    // An interface's operation is checked whole: what its type ends up
    // as decides whether there is an implementation.
    // Arithmetic's and Ordered's operations are offered as the one + − · <.
    else if (code.nodes[part].kind === "field" && (def === "std.arithmetic" || def === "std.ordered")) continue;
    else if (code.nodes[part].kind === "field") { const t = fieldType(code, info.subst, def, part); if (t) consider(part, t, isInterface(code, def)); }
  }
  const lit = (of: "number" | "text" | "int", t: Type) => { const f: Filling = { kind: "lit", of }; const s = fits(t, false); if (s && safe(s, f, false)) out.push(f); };
  lit("number", num);
  lit("text", str);
  lit("int", { t: "con", id: INT, args: [] });
  const ex = info.subst.resolve(h.expected);
  if (ex.t === "fn") out.push({ kind: "lambda", arity: ex.params.length, params: ex.params.map((t) => info.subst.zonk(t)) });
  // Where any type goes (a new value, say), a function is one too: of one
  // input or two, so a local helper can be started there (BACKLOG E128).
  else if (ex.t === "var") for (const arity of [1, 2]) {
    const s = info.subst.clone();
    const t: Type = { t: "fn", params: Array.from({ length: arity }, () => s.fresh()), ret: s.fresh(), eff: s.freshRow() };
    try { s.unify(h.expected, t); } catch (e) { if (e instanceof TypeError) continue; throw e; }
    const f: Filling = { kind: "lambda", arity };
    if (safe(s, f, false)) out.push(f);
  }
  // A use of a definition with results (RESULTS.md): its value is its
  // body's, a hole of this one's type, so it fits; what its direction
  // brings (Choice, say) is checked against the whole program.
  for (const d of info.schemes.keys()) {
    const n = code.nodes[d];
    if (info.hidden.has(d) || n?.kind !== "def" || !n.results?.length || code.nodes[n.body ?? ""]?.kind !== "lambda") continue;
    const f: Filling = { kind: "use", target: d };
    if (whole(f)) out.push(f);
  }
  const dataTypes = [...new Set(info.owner.values())].filter((d) => !(code.nodes[(code.nodes[d] as NodeOf<"def">).body!] as NodeOf<"typedef">).effect);
  // The standard library's types that are data you write programs about;
  // the rest (Unit, Html, Event…) would only crowd the palette.
  const STD_SPLIT = ["std.bool", "std.list", "std.pair", "std.optional"];
  const splittable = dataTypes.filter((t) => !t.startsWith("std.") || STD_SPLIT.includes(t));
  for (const b of h.scope) {
    const bt = info.subst.resolve(b.type);
    if (bt.t === "con" && dataTypes.includes(bt.id)) {
      // Splitting an input of a definition with results can end its
      // computed-forward direction, so there it is checked as well.
      const split = (f: Filling) => { if (!withResults || whole(f)) out.push(f); };
      split({ kind: "match", on: b.id, type: bt.id });
      if (recursiveType(code, bt.id)) split({ kind: "fold", on: b.id, type: bt.id });
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
  // An interface's field is its operation (refType).
  if (td.interface) { s.requireInterface(made.ret.t === "con" ? made.ret.args[0] : made.ret, def, ""); const op = s.resolve(made.params[i]); return op.t === "fn" ? { ...op, eff: s.freshRow(s.resolveRow(op.eff).effs) } : op; }
  return { t: "fn", params: [made.ret], ret: made.params[i], eff: s.freshRow() };
}

function constructorType(code: Code, s: Subst, def: Id, variant: Id): Type {
  const td = code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const params = new Map(td.params.map((p) => [p, s.fresh()] as const));
  const te = (tid: Id): Type => {
    const t = code.nodes[tid];
    if (t.kind === "tfun") return { t: "fn", params: t.params.map(te), ret: te(t.result), eff: writtenRow(t.effects) };
    const r = t as NodeOf<"tref">;
    if (MASK_TYPES[r.target] && r.args.length === 1) return te(r.args[0]);
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
