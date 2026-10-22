// Running any function backwards.
//
// Every node is a relation between its inputs and its value. Running a
// function forward is the case where the inputs are known and the value
// isn't; running it backwards is the case where the value is known and some
// inputs aren't. This interpreter does both, and anything in between, with
// one rule per node kind:
//
//   data         unification. A constructor run backwards takes its value
//                apart, so `cons(h, t) = [1, 2]` binds h and t.
//   arithmetic   collected as equations and handed to the relation solver
//                (../../invertible) as soon as one can be solved: an equation
//                with one unknown is undone, a linear block is eliminated,
//                a nonlinear one is torn and scanned. Its branches (both
//                square roots, every 2πk) become choices here.
//   text         `join text` with a known result enumerates the ways to
//                split it; `show` with a known result reads the number back.
//   match / if   a choice over the arms: the arm's body is run backwards,
//                and the value examined is rebuilt from the arm's case.
//   fold         unfold: pick a case, run its body backwards to find the
//                parts and the folded values of the recursive parts, then
//                unfold those. It can go on forever, so it may Diverge.
//   comparisons  `less`, and `equal` when false, wait until both sides are
//                known, then check (they can't produce a number, only
//                reject one).
//   calls        a call to a known function runs that function's body.
//                Information flows from whatever is known: when the call's
//                value is known it is pushed into the function first, else
//                the inputs are computed first.
//
// Some things only run forward: floor and mod (many inputs, one output),
// first/all/count (they look at every answer of an action at once),
// derivative, `with fuel`, and calling a function. Each waits until what it
// needs is known, then runs; an answer that leaves one waiting isn't pinned
// down, so it isn't an answer. What can't run backwards at all, and why, is
// listed in BACKWARDS.md; the checker refuses those (solving for a
// function, printing), and the few left throw NotInvertible.
//
// The search is miniKanren's: a lazy stream of states with fair
// interleaving, so an infinite branch (unfolding a list forever) can't
// starve a finite one. Answers come in the order the arms and branches are
// written, canonical branch first, but fairness may interleave them.

import { plan, relation, stream } from "../../../invertible/src/relation.js";
import { call as ecall, evaluate as evaluateSolverExpr, num as enum_, show as eshow, simplify, v as evar } from "../../../invertible/src/expr.js";
import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { dependencies, ownerOfTypeParts, subtree } from "../model.ts";
import { derivativeLambda } from "./derive.ts";
import { fieldShapes, look, type TypeEnv } from "./nested.ts";
import { impl } from "../prelude.ts";
import { META, equal as valueEqual, showValue, type Data, type Value } from "./run.ts";
import { RELATIONS, VARIADIC } from "../relational.ts";
import { relationFor } from "./solve.ts";
import { CONS, FALSE, NIL, S, SET, SHOW_ANY, SIGS, STD_IMPL, STD_MANY, stdNames, TRUE } from "./std.ts";
import { intLit } from "./int.ts";
import { fieldIndex, fieldPath, setPath } from "./records.ts";
import { INT } from "./types.ts";
import { Subst } from "./types.ts";

export class NotInvertible extends Error {}

// ---------------------------------------------------------------- terms

export class LVar {
  n: number;
  constructor(n: number) { this.n = n; }
}
type Env = Map<Id, unknown>;
interface Closure { k: "closure"; lambda: Id; env: Env; orig?: unknown }
// A builtin, a constructor (a variant with fields) or a projection (a field).
interface Prim { k: "prim"; id: Id; orig?: unknown }
interface DataT { tag: Id; fields: Term[] }
export type Term = number | bigint | string | DataT | Closure | Prim | LVar;

const isData = (t: unknown): t is DataT => typeof t === "object" && t !== null && "tag" in t;
const dataT = (tag: Id, fields: Term[] = []): DataT => ({ tag, fields });
const boolT = (b: boolean) => dataT(b ? TRUE : FALSE);

// Values coming in from the forward evaluator. Its functions carry the node
// they came from (META), which is what lets a function passed in be run
// backwards: functions are not black boxes.
export function fromValue(x: unknown): Term {
  if (typeof x === "function") {
    const m = (x as unknown as Record<symbol, { lambda?: Id; env?: Env; prim?: Id }>)[META];
    if (m?.lambda) return { k: "closure", lambda: m.lambda, env: m.env!, orig: x };
    if (m?.prim) return { k: "prim", id: m.prim, orig: x };
    throw new NotInvertible("this function came from outside the program, so it can't be looked inside");
  }
  if (isData(x)) return dataT(x.tag, (x as Data).fields.map(fromValue));
  return x as Term;
}

// ---------------------------------------------------------------- states

// Equations for the solver use variables named "?n" for logic variable n.
interface Expr { k: "num" | "var" | "call"; v?: number; name?: string; f?: string; args?: Expr[] }
interface Eq { lhs: Expr; rhs: Expr }
type Wait =
  | { k: "concat"; a: Term; b: Term; c: Term }
  | { k: "show"; n: Term; s: Term }
  | { k: "test"; args: Term[]; f: (...xs: Value[]) => boolean; text: string }
  | { k: "compute"; args: Term[]; out: Term; f: (...xs: Value[]) => Value; text: string }
  | { k: "range"; n: Term; out: Term }
  // Runs `then` once `ready` says enough is known.
  | { k: "later"; ready: (s: State) => boolean; then: Goal; text: string };

interface State { sub: Sub; eqs: Eq[]; waits: Wait[]; next: number }

// The substitution: logic variable number to term. Persistent, as a 32-way
// trie on the number, so binding a variable copies one short path instead
// of the whole map. (Copying the map was what made reading text back
// cubic.) Variables are numbered densely from 0, so the trie stays shallow.
type Trie = (Trie | Term | undefined)[];
class Sub {
  root: Trie;
  depth: number;
  constructor(root: Trie = [], depth = 0) { this.root = root; this.depth = depth; }
  get(n: number): Term | undefined {
    if (n >= 2 ** (5 * (this.depth + 1))) return undefined;
    let node: Trie | undefined = this.root;
    for (let d = this.depth; d > 0; d--) {
      node = node[(n >>> (5 * d)) & 31] as Trie | undefined;
      if (!node) return undefined;
    }
    return node[n & 31] as Term | undefined;
  }
  has(n: number) { return this.get(n) !== undefined; }
  set(n: number, t: Term): Sub {
    let root = this.root, depth = this.depth;
    while (n >= 2 ** (5 * (depth + 1))) { root = [root]; depth++; }
    const put = (node: Trie | undefined, d: number): Trie => {
      const copy = node ? node.slice() : [];
      const i = (n >>> (5 * d)) & 31;
      copy[i] = d === 0 ? t : put(copy[i] as Trie | undefined, d - 1);
      return copy;
    };
    return new Sub(put(root, depth), depth);
  }
}

const walk = (t: Term, s: State): Term => {
  while (t instanceof LVar) {
    const b = s.sub.get(t.n);
    if (b === undefined) return t;
    t = b;
  }
  return t;
};

// Fully resolved, with any logic variables still unbound left in place.
function deep(t: Term, s: State): Term {
  t = walk(t, s);
  return isData(t) ? dataT(t.tag, t.fields.map((f) => deep(f, s))) : t;
}
const hasVars = (t: Term): boolean => t instanceof LVar || (isData(t) && t.fields.some(hasVars));
const ground = (t: Term, s: State): Term | undefined => { const d = deep(t, s); return hasVars(d) ? undefined : d; };

const close = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));

function unify(a: Term, b: Term, s: State): State | null {
  a = walk(a, s);
  b = walk(b, s);
  if (a === b) return s;
  if (a instanceof LVar) return bindVar(s, a, b);
  if (b instanceof LVar) return bindVar(s, b, a);
  if (typeof a === "number" && typeof b === "number") return close(a, b) ? s : null;
  if (typeof a !== "object" || typeof b !== "object") return null;
  if (isData(a) && isData(b)) {
    if (a.tag !== b.tag || a.fields.length !== b.fields.length) return null;
    let st: State | null = s;
    for (let i = 0; st && i < a.fields.length; i++) st = unify(a.fields[i], b.fields[i], st);
    return st;
  }
  // Functions are equal only when they are the same function.
  if ("k" in a && "k" in b && a.k === b.k) {
    if (a.k === "prim") return a.id === (b as Prim).id ? s : null;
    return a.lambda === (b as Closure).lambda && a.env === (b as Closure).env ? s : null;
  }
  return null;
}

function bindVar(s: State, v: LVar, t: Term): State {
  return { ...s, sub: s.sub.set(v.n, t) };
}

const freshVars = (s: State, n: number): [LVar[], State] =>
  [Array.from({ length: n }, (_, i) => new LVar(s.next + i)), { ...s, next: s.next + n }];

// ---------------------------------------------------------------- streams

// A stream is empty (null), an answer and the rest, or a suspended stream.
// Suspensions are where fair interleaving happens and where fuel is spent.
type Stream = null | [State, () => Stream] | (() => Stream);
type Goal = (s: State) => Stream;

const unit = (s: State): Stream => [s, () => null];
function mplus(a: Stream, b: () => Stream): Stream {
  if (a === null) return b();
  if (typeof a === "function") return () => mplus(b(), a);
  return [a[0], () => mplus(a[1](), b)];
}
function bind(a: Stream, g: Goal): Stream {
  if (a === null) return null;
  if (typeof a === "function") return () => bind(a(), g);
  return mplus(g(a[0]), () => bind(a[1](), g));
}
const succeed: Goal = unit;
const failG: Goal = () => null;
const conj = (...gs: Goal[]): Goal => (s) => gs.reduce<Stream>((st, g) => bind(st, g), unit(s));
const disj = (...gs: Goal[]): Goal => (s) => gs.reduceRight<() => Stream>((rest, g) => () => mplus(g(s), rest), () => null)();
const eq = (a: Term, b: Term): Goal => (s) => { const t = unify(a, b, s); return t ? settle(t) : null; };

// ---------------------------------------------------------------- constraints

const toExpr = (t: Term, s: State): Expr | null => {
  t = walk(t, s);
  if (t instanceof LVar) return evar(`?${t.n}`) as Expr;
  return typeof t === "number" ? enum_(t) as Expr : null;
};

function substExpr(e: Expr, s: State): Expr {
  if (e.k === "var" && e.name!.startsWith("?")) {
    const t = walk(new LVar(+e.name!.slice(1)), s);
    return typeof t === "number" ? enum_(t) as Expr : t instanceof LVar ? evar(`?${t.n}`) as Expr : (() => { throw new TypeMismatch(); })();
  }
  if (e.k === "call") return { ...e, args: e.args!.map((a) => substExpr(a, s)) };
  return e;
}
class TypeMismatch extends Error {}

const varsOf = (e: Expr, out = new Set<string>()): Set<string> => {
  if (e.k === "var") out.add(e.name!);
  else if (e.k === "call") e.args!.forEach((a) => varsOf(a, out));
  return out;
};
const evalExpr = evaluateSolverExpr as unknown as (e: Expr, env: Record<string, number>) => number;

// Make all the progress the known values allow: check equations that are
// fully known, solve one that the solver can, wake a waiting constraint.
// Each of these may branch, so this returns a stream.
function settle(s: State): Stream {
  let eqs: Eq[];
  try {
    eqs = s.eqs.map((e) => ({ lhs: substExpr(e.lhs, s), rhs: substExpr(e.rhs, s) }));
  } catch (e) {
    if (e instanceof TypeMismatch) return null;
    throw e;
  }
  const open: Eq[] = [];
  for (const e of eqs) {
    const vs = new Set([...varsOf(e.lhs), ...varsOf(e.rhs)]);
    if (vs.size) { open.push(e); continue; }
    const l = evalExpr(e.lhs, {}), r = evalExpr(e.rhs, {});
    if (!Number.isFinite(l) || !Number.isFinite(r) || !close(l, r)) return null;
  }
  s = { ...s, eqs: open };
  const solved = solveSome(s);
  if (solved) return solved;
  for (let i = 0; i < s.waits.length; i++) {
    const g = wake(s.waits[i], s);
    if (g) return g({ ...s, waits: s.waits.filter((_, j) => j !== i) });
  }
  return unit(s);
}

// Hand the solver the smallest thing it can solve: a single equation with
// one unknown, else (for a handful of equations) the whole system, which is
// where simultaneous equations like a + b = 10, a − b = 4 get eliminated.
function solveSome(s: State): Stream | undefined {
  if (!s.eqs.length) return undefined;
  const one = s.eqs.filter((e) => new Set([...varsOf(e.lhs), ...varsOf(e.rhs)]).size === 1);
  const tries = [...one.map((e) => [e]), ...(s.eqs.length <= 6 && s.eqs.length > 1 ? [s.eqs] : [])];
  for (const group of tries) {
    const ports = [...new Set(group.flatMap((e) => [...varsOf(e.lhs), ...varsOf(e.rhs)]))];
    const rel = relation({ name: "here", ports, eqs: group } as never) as { ports: string[] };
    const p = plan(rel as never, [] as never) as { steps: { type: string; x?: string; xs?: string[] }[] };
    const determined = p.steps.flatMap((st) => st.type === "solve" ? [st.x!] : st.type === "check" ? [] : st.xs ?? []).filter((x) => x.startsWith("?"));
    if (!determined.length) continue;
    const sols = stream(rel as never, p as never, {} as never) as Iterable<{ values: Record<string, number | null> }>;
    const it = sols[Symbol.iterator]();
    const next = (): Stream => {
      const r = it.next();
      if (r.done) return null;
      let t: State | null = s;
      for (const x of determined) {
        const val = r.value.values[x];
        if (val === null || val === undefined) continue; // the equations leave it free
        t = t && unify(new LVar(+x.slice(1)), val, t);
      }
      return t ? mplus(settle(t), next) : next();
    };
    return next();
  }
  return undefined;
}

const showNumber = STD_IMPL[S.show] as (x: number) => string;

function wake(w: Wait, s: State): Goal | null {
  switch (w.k) {
    case "concat": {
      const a = walk(w.a, s), b = walk(w.b, s), c = walk(w.c, s);
      if (typeof a === "string" && typeof b === "string") return eq(w.c, a + b);
      if (typeof c !== "string") return null;
      if (typeof a === "string") return c.startsWith(a) ? eq(w.b, c.slice(a.length)) : failG;
      if (typeof b === "string") return c.endsWith(b) ? eq(w.a, c.slice(0, c.length - b.length)) : failG;
      // Every way to cut the text in two that the two sides could be: a
      // side that is itself a join with a known part, or a number shown,
      // rules most cuts out before any branch is made (in "1 22 333", the
      // front of `show(n) ++ " " ++ rest` must end in a space, and before
      // it must be a number). Without this, reading text back is quadratic
      // in branches.
      const front = fits(w.a, s, 2), back = fits(w.b, s, 2);
      const cuts: Goal[] = [];
      for (let i = 0; i <= c.length; i++) {
        const x = c.slice(0, i), y = c.slice(i);
        if ((!front || front(x)) && (!back || back(y))) cuts.push(conj(eq(w.a, x), eq(w.b, y)));
      }
      return disj(...cuts);
    }
    case "show": {
      const n = walk(w.n, s), t = walk(w.s, s);
      if (typeof n === "number") return eq(w.s, showNumber(n));
      if (typeof t !== "string") return null;
      // Read it back, and accept only the spelling show would produce.
      const x = Number(t);
      return t.trim() === t && t !== "" && Number.isFinite(x) && showNumber(x) === t ? eq(w.n, x) : failG;
    }
    case "test": {
      const xs = w.args.map((a) => ground(a, s));
      if (xs.some((x) => x === undefined)) return null;
      return w.f(...(xs as Value[])) ? succeed : failG;
    }
    case "compute": {
      const xs = w.args.map((a) => ground(a, s));
      if (xs.some((x) => x === undefined)) return null;
      return eq(w.out, fromValue(w.f(...(xs as Value[]))));
    }
    case "later": return w.ready(s) ? w.then : null;
    case "range": {
      const n = walk(w.n, s);
      if (typeof n === "number") return eq(w.out, list(Array.from({ length: Math.max(0, n) }, (_, i) => i)));
      // Once the list's length is known, so is n; then compare the items.
      let length = 0;
      for (let d = walk(w.out, s); ; d = walk((d as DataT).fields[1], s), length++) {
        if (d instanceof LVar) return null;
        if (!isData(d)) return failG;
        if (d.tag === NIL) break;
      }
      return conj(eq(w.n, length), wait(w));
    }
  }
}

// A quick test of which texts an unknown could turn out to be, from the
// constraint waiting to produce it (null: no idea, anything fits). Looks a
// couple of joins deep, never branches.
function fits(t: Term, s: State, depth: number): ((text: string) => boolean) | null {
  t = walk(t, s);
  if (typeof t === "string") return (x) => x === t;
  if (!(t instanceof LVar) || depth === 0) return null;
  for (const w of s.waits) {
    if (w.k === "show" && walk(w.s, s) === t) return (x) => x.trim() === x && x !== "" && showNumber(Number(x)) === x;
    if (w.k !== "concat" || walk(w.c, s) !== t) continue;
    const a = walk(w.a, s), b = walk(w.b, s);
    if (typeof b === "string") { const f = fits(a, s, depth - 1); return (x) => x.endsWith(b) && (!f || f(x.slice(0, x.length - b.length))); }
    if (typeof a === "string") { const f = fits(b, s, depth - 1); return (x) => x.startsWith(a) && (!f || f(x.slice(a.length))); }
    return null;
  }
  return null;
}

const list = (xs: Term[]): DataT => xs.reduceRight<DataT>((tail, x) => dataT(CONS, [x, tail]), dataT(NIL));

const wait = (w: Wait): Goal => (s) => settle({ ...s, waits: [...s.waits, w] });

// ---------------------------------------------------------------- the interpreter

export interface Options {
  // Called at every step that might repeat forever (unfolding a fold,
  // calling a recursive definition). Returning false ends the search there:
  // this is how `with fuel` bounds a backwards search.
  spend?: () => boolean;
  // The names generic `show` prints cases with; std's if not given.
  names?: Names;
}

// Numeric builtins, by the name the solver knows them under.
const NUMERIC: Record<Id, string> = { ...Object.fromEntries(Object.keys(impl).map((op) => [`builtin.${op}`, op])), [S.abs]: "abs" };

export function interpreter(code: Code, opts: Options = {}) {
  const nodes = code.nodes;
  const owner = ownerOfTypeParts(code);
  const spend = opts.spend ?? (() => true);
  const recursive = new Map<Id, boolean>();
  const isRecursive = (lambda: Id) => {
    if (!recursive.has(lambda)) {
      const def = code.defs.find((d) => (nodes[d] as NodeOf<"def">).body === lambda);
      recursive.set(lambda, !!def && dependencies(code, def).includes(def));
    }
    return recursive.get(lambda)!;
  };
  // A point where the search may go on forever: suspend (for fairness) and
  // spend fuel.
  const step = (g: Goal): Goal => (s) => () => (spend() ? g(s) : null);

  const variantsOf = (variant: Id): Id[] => {
    const def = owner.get(variant)!;
    return (nodes[(nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants;
  };
  const fieldCount = (variant: Id) => (nodes[variant] as NodeOf<"variant">).fields.length;

  function ev(id: Id, env: Env, out: Term): Goal {
    const n = nodes[id];
    switch (n.kind) {
      case "lit": return eq(out, n.of === INT ? intLit(n.value) as Term : n.value);
      case "ref": return refGoal(n.target, env, out);
      case "lambda": return eq(out, { k: "closure", lambda: id, env });
      case "call": return callGoal(n, env, out);
      case "match": return matchGoal(n, env, out);
      case "fold": return foldGoal(n, env, out);
      case "solve": return solveGoal(n, env, out);
      case "hole": throw new NotInvertible("the program has a hole here");
      default: throw new NotInvertible(`a ${n.kind} is not an expression`);
    }
  }

  function refGoal(target: Id, env: Env, out: Term): Goal {
    const t = nodes[target];
    switch (t.kind) {
      case "binder":
        if (!env.has(target)) throw new NotInvertible("a variable is used outside its scope");
        return eq(out, fromValue(env.get(target)));
      case "def": {
        const body = nodes[t.body!];
        return body.kind === "lambda" ? eq(out, { k: "closure", lambda: body.id, env: new Map() }) : ev(body.id, new Map(), out);
      }
      case "builtin": return eq(out, { k: "prim", id: target });
      case "variant": return eq(out, t.fields.length ? { k: "prim", id: target } : dataT(target));
      case "field": return eq(out, { k: "prim", id: target });
      default: throw new NotInvertible(`can't refer to a ${t.kind}`);
    }
  }

  // Lits, refs and lambdas never search, so they always go first. The rest
  // go before the call when its value is unknown (forward), after it when
  // the value is known (backwards), so information flows from what's known.
  const cheap = (id: Id) => ["lit", "ref", "lambda"].includes(nodes[id].kind);

  // A call of a builtin that never branches when its inputs are unknown
  // (it waits, or adds an equation), all the way down.
  const WAITING = new Set<Id>([S.concat, S.show, ...Object.keys(NUMERIC)]);
  const waitsOnly = (id: Id): boolean => {
    const n = nodes[id];
    if (cheap(id)) return true;
    if (n.kind !== "call") return false;
    const head = nodes[n.fn];
    if (head.kind !== "ref") return false;
    const t = nodes[head.target];
    if (!(t?.kind === "builtin" && WAITING.has(head.target)) && t?.kind !== "variant") return false;
    return n.args.every(waitsOnly);
  };

  function callGoal(n: NodeOf<"call">, env: Env, out: Term): Goal {
    return (s0) => {
      const [[f, ...args], s] = freshVars(s0, n.args.length + 1);
      const argGoals = n.args.map((a, i) => ev(a, env, args[i]));
      const easy = argGoals.filter((_, i) => cheap(n.args[i]));
      const hard = argGoals.filter((_, i) => !cheap(n.args[i]));
      const applyG: Goal = (st) => apply(walk(f, st), args, out)(st);
      const known = !(walk(out, s) instanceof LVar);
      if (!known) return conj(ev(n.fn, env, f), ...easy, ...hard, applyG)(s);
      // Backwards into a builtin that waits for its inputs (join text, show,
      // arithmetic): its arguments that are themselves such calls go first.
      // They only record what they are waiting for, never branch, and then
      // the call can see the shape of its inputs (text(show(n), " ", rest)
      // can only be cut at a space after a number) instead of guessing.
      const waits = n.args.map((a, i) => !cheap(a) && waitsOnly(a) && waitsOnly(n.id));
      const before = argGoals.filter((_, i) => waits[i]), after = argGoals.filter((_, i) => !cheap(n.args[i]) && !waits[i]);
      return conj(ev(n.fn, env, f), ...easy, ...before, applyG, ...after)(s);
    };
  }

  function apply(f: Term, args: Term[], out: Term): Goal {
    // Functions can't be guessed: wait until it's known which one this is.
    if (f instanceof LVar) return wait({ k: "later", ready: (s) => !(walk(f, s) instanceof LVar), then: (s) => apply(walk(f, s), args, out)(s), text: "call" });
    if (typeof f !== "object" || isData(f)) throw new NotInvertible("calling something that isn't a function");
    if (f.k === "closure") {
      const lam = nodes[f.lambda] as NodeOf<"lambda">;
      const g: Goal = (s) => {
        const env = new Map(f.env);
        lam.params.forEach((p, i) => env.set(p, args[i]));
        return ev(lam.body, env, out)(s);
      };
      return isRecursive(f.lambda) ? step(g) : g;
    }
    const t = nodes[f.id];
    if (t.kind === "variant") return eq(out, dataT(f.id, args));
    if (t.kind === "field") {
      // A projection run backwards builds a record with that field known.
      const td = nodes[(nodes[owner.get(f.id)!] as NodeOf<"def">).body!] as NodeOf<"typedef">;
      const v = td.variants[0];
      const i = (nodes[v] as NodeOf<"variant">).fields.indexOf(f.id);
      return (s0) => {
        const [fs, s] = freshVars(s0, fieldCount(v));
        fs[i] = out as LVar;
        return eq(args[0], dataT(v, fs))(s);
      };
    }
    return builtin(f.id, args, out);
  }

  function builtin(id: Id, args: Term[], out: Term): Goal {
    if (NUMERIC[id]) {
      const op = NUMERIC[id];
      return (s) => {
        const xs = args.map((a) => walk(a, s));
        if (xs.every((x) => typeof x === "number")) {
          const f = op === "abs" ? Math.abs : (impl as Record<string, (...x: number[]) => number>)[op];
          return eq(out, f(...(xs as number[])))(s);
        }
        const es = args.map((a) => toExpr(a, s));
        const o = toExpr(out, s);
        if (!o || es.some((e) => !e)) return null;
        return settle({ ...s, eqs: [...s.eqs, { lhs: o, rhs: ecall(op, ...es) as Expr }] });
      };
    }
    const [a, b] = args;
    const both = <T>(f: (x: T, y: T) => boolean) => (x: Value, y: Value) => f(x as T, y as T);
    switch (id) {
      case S.concat: return wait({ k: "concat", a, b, c: out });
      case S.show: return wait({ k: "show", n: a, s: out });
      case S.floor: case S.mod:
        // Many inputs give the same output (a whole interval, every multiple
        // of b): there's nothing to enumerate, so these only run forward.
        return wait({ k: "compute", args, out, f: STD_IMPL[id] as (...x: Value[]) => Value, text: id === S.floor ? "floor" : "mod" });
      case S.range: return wait({ k: "range", n: a, out });
      case S.less: return compare(args, out, both<number>((x, y) => x < y), both<number>((x, y) => x >= y));
      case S.equal:
        return (s) => {
          const x = ground(a, s), y = ground(b, s);
          if (x !== undefined && y !== undefined) return eq(out, boolT(valueEqual(x as Value, y as Value)))(s);
          const o = walk(out, s);
          const yes = conj(eq(out, boolT(true)), eq(a, b));
          const no = conj(eq(out, boolT(false)), wait({ k: "test", args: [a, b], f: (x, y) => !valueEqual(x, y), text: "≠" }));
          return isData(o) ? (o.tag === TRUE ? yes : no)(s) : disj(yes, no)(s);
        };
      case S.and: return table(args, out, (x, y) => x && y);
      case S.or: return table(args, out, (x, y) => x || y);
      case S.not: return table(args, out, (x) => !x);
      case S.oneOf: return member(a, out);
      case S.fail: return failG;
      case S.first: case S.all: case S.count: return aggregate(id, args, out);
      case S.print: throw new NotInvertible("printing can't be run backwards (or searched: it would print once per guess)");
      // Backwards, derivative would be integration: it waits for its function.
      case S.derivative:
        return wait({
          k: "later", text: "derivative", ready: (s) => !(walk(a, s) instanceof LVar), then: (s) => {
            const f = walk(a, s) as Closure | Prim;
            const lambda = derivativeLambda(code, f.k === "closure" ? { lambda: f.lambda } : { prim: f.id });
            return eq(out, { k: "closure", lambda, env: f.k === "closure" ? f.env : new Map() })(s);
          },
        });
      // The action runs with its own budget: every step that might repeat
      // forever spends one, and when they're gone that branch has no answer.
      case S.fuel:
        return wait({
          k: "later", text: "with fuel", ready: (s) => typeof walk(a, s) === "number" && !(walk(b, s) instanceof LVar), then: (s) => {
            let left = walk(a, s) as number;
            return interpreter(code, { spend: () => left-- > 0 && spend() }).apply(walk(b, s), [], out)(s);
          },
        });
    }
    // The rest (Int and text operations, set) run forward: once their inputs
    // are known, each of their answers is a branch.
    if (id === SET) {
      // The path is read off the function's nodes, so only the record and
      // the value need to be known.
      return wait({
        k: "later", text: "set", ready: (s) => !(walk(a, s) instanceof LVar) && known(b, s) && known(args[2], s), then: (s) => {
          const get = walk(a, s) as Closure | Prim;
          const path = get.k === "prim" ? [get.id] : fieldPath(code, get.lambda);
          if (!path) throw new NotInvertible("set needs a field, or a path of fields");
          return eq(out, setPath(deep(b, s) as DataT, path.map((f) => fieldIndex(code, f)), deep(args[2], s)))(s);
        },
      });
    }
    const many = STD_MANY[id] ?? (STD_IMPL[id] ? (...xs: Value[]) => [STD_IMPL[id](...xs)] : id === SHOW_ANY ? (x: Value) => [showValue(x, code, opts.names ?? stdNames)] : null);
    if (many) {
      return wait({
        k: "later", text: id, ready: (s) => args.every((a) => known(a, s)), then: (s) => {
          const xs = args.map((a) => toValue(deep(a, s))!);
          return disj(...many(...xs).map((v: Value) => eq(out, fromValue(v))))(s);
        },
      });
    }
    throw new NotInvertible(`${id} has no backwards reading`);
  }


  // less, as a relation: when its answer is known, a check that waits until
  // both sides are known. When the answer isn't known, it's a choice.
  function compare(args: Term[], out: Term, yes: (...x: Value[]) => boolean, no: (...x: Value[]) => boolean): Goal {
    return (s) => {
      const xs = args.map((a) => walk(a, s));
      if (xs.every((x) => typeof x === "number")) return eq(out, boolT(yes(...(xs as number[]))))(s);
      const t = conj(eq(out, boolT(true)), wait({ k: "test", args, f: yes, text: "<" }));
      const f = conj(eq(out, boolT(false)), wait({ k: "test", args, f: no, text: "≥" }));
      const o = walk(out, s);
      return isData(o) ? (o.tag === TRUE ? t : f)(s) : disj(t, f)(s);
    };
  }

  // and, or, not: every row of the truth table that fits.
  function table(args: Term[], out: Term, f: (...xs: boolean[]) => boolean): Goal {
    const rows = args.length === 1 ? [[true], [false]] : [[true, true], [true, false], [false, true], [false, false]];
    return disj(...rows.map((row) => conj(...row.map((x, i) => eq(args[i], boolT(x))), eq(out, boolT(f(...row))))));
  }

  // one of(list) = x: x is somewhere in the list. If the list isn't known
  // either, this builds lists that contain x, one length at a time.
  function member(xs: Term, out: Term): Goal {
    return (s0) => {
      const l = walk(xs, s0);
      if (isData(l)) return l.tag === CONS ? disj(eq(out, l.fields[0]), step(member(l.fields[1], out)))(s0) : null;
      const [[h, t], s] = freshVars(s0, 2);
      return disj(eq(l, dataT(CONS, [out, t])), conj(eq(l, dataT(CONS, [h, t])), step(member(t, out))))(s);
    };
  }

  // first, all and count look at every answer of their action at once. Run
  // forward that's fine. Run backwards it would mean "find inputs for which
  // the set of answers is this", which is not a choice per answer; so they
  // wait until everything their action uses is known, then run it forward.
  // An answer of the action that still has unknowns in it isn't pinned
  // down, so it doesn't count (as in the evaluator's solve).
  function aggregate(id: Id, args: Term[], out: Term): Goal {
    return wait({
      k: "later", text: id === S.first ? "first" : id === S.all ? "all" : "count", ready: (s) => known(args[0], s), then: (s) => {
        const body = walk(args[0], s);
        const [[r], inner] = freshVars(s, 1);
        const answers: Term[] = [];
        for (const t of pull(apply(body, [], r)(inner))) {
          if (t.waits.length) continue;
          const v = ground(r, t);
          if (v === undefined) continue;
          answers.push(v);
          if (id === S.first) break;
        }
        if (id === S.first) return answers.length ? eq(out, answers[0])(s) : apply(walk(args[1], s), [], out)(s);
        return eq(out, id === S.all ? list(answers) : answers.length)(s);
      },
    });
  }

  // Is t fully known: no unknowns in it, and for a function, none in the
  // variables its body uses?
  const freeIn = new Map<Id, Id[]>();
  function known(t: Term, s: State): boolean {
    t = walk(t, s);
    if (t instanceof LVar) return false;
    if (isData(t)) return t.fields.every((f) => known(f, s));
    if (typeof t === "object" && t.k === "closure") {
      if (!freeIn.has(t.lambda)) freeIn.set(t.lambda, subtree(code, t.lambda).flatMap((x) => (nodes[x].kind === "ref" ? [(nodes[x] as NodeOf<"ref">).target] : [])));
      const env = t.env;
      return freeIn.get(t.lambda)!.every((b) => !env.has(b) || known(fromValue(env.get(b)), s));
    }
    return true;
  }

  function matchGoal(n: NodeOf<"match">, env: Env, out: Term): Goal {
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const others = arms.length && n.otherwise ? variantsOf(arms[0].variant).filter((v) => !arms.some((a) => a.variant === v)) : [];
    const armGoal = (arm: NodeOf<"arm">, fields: Term[]) => {
      const inner = new Map(env);
      arm.binds.forEach((b, i) => inner.set(b, fields[i]));
      return ev(arm.body, inner, out);
    };
    // A case, for a value whose case isn't known yet: give it that shape.
    const shaped = (v: Term, variant: Id, then: (fields: Term[]) => Goal): Goal => (s0) => {
      const [fs, s] = freshVars(s0, fieldCount(variant));
      return conj(eq(v, dataT(variant, fs)), then(fs))(s);
    };
    const branch = (v: Term): Goal => (s) => {
      const d = walk(v, s);
      if (isData(d)) {
        const arm = arms.find((a) => a.variant === d.tag);
        return (arm ? armGoal(arm, d.fields) : ev(n.otherwise!, env, out))(s);
      }
      if (!arms.length) return ev(n.otherwise!, env, out)(s);
      return disj(
        ...arms.map((arm) => shaped(v, arm.variant, (fs) => armGoal(arm, fs))),
        ...others.map((variant) => shaped(v, variant, () => ev(n.otherwise!, env, out))),
      )(s);
    };
    return (s0) => {
      const [[v], s] = freshVars(s0, 1);
      const scrut = ev(n.scrutinee, env, v);
      const backwards = !(walk(out, s) instanceof LVar) && !cheap(n.scrutinee);
      return (backwards ? conj(branch(v), scrut) : conj(scrut, branch(v)))(s);
    };
  }

  function foldGoal(n: NodeOf<"fold">, env: Env, out: Term): Goal {
    const arms = new Map(n.arms.map((a) => { const arm = nodes[a] as NodeOf<"arm">; return [arm.variant, arm]; }));
    const armGoal = (arm: NodeOf<"arm">, fields: Term[], res: Term): Goal => (s0) => {
      const rec = arm.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      const [rs, s] = freshVars(s0, rec.length);
      const inner = new Map(env);
      arm.binds.forEach((b, i) => inner.set(b, fields[i]));
      rec.forEach((i, k) => inner.set(arm.results[i]!, rs[k]));
      const body = ev(arm.body, inner, res);
      const shapes = fieldShapes(code, owner.get(arm.variant)!, arm.variant);
      const fids = (nodes[arm.variant] as NodeOf<"variant">).fields;
      const children = conj(...rec.map((i, k) => shapes[i] === "nested"
        ? mapped(owner.get(arm.variant)!, { tid: (nodes[fids[i]] as NodeOf<"field">).type, env: new Map() }, fields[i], rs[k])
        : fold(fields[i], rs[k])));
      return (walk(res, s) instanceof LVar ? conj(children, body) : conj(body, children))(s);
    };
    // A container of trees (a rose tree's children) and its folded value:
    // the same container with each tree's folded value in its place. Either
    // side may be what's known, so the shape comes from whichever is.
    const mapped = (def: Id, at: { tid: Id; env: TypeEnv }, v: Term, r: Term): Goal => {
      const place = look(code, def, at.tid, at.env);
      if (place.k === "self") return fold(v, r);
      if (place.k === "other") return eq(r, v);
      const shape = (variant: Id): Goal => (s0) => {
        const n = fieldCount(variant);
        const [vs, s1] = freshVars(s0, n);
        const [rs, s2] = freshVars(s1, n);
        const fs = place.fields(variant);
        return conj(eq(v, dataT(variant, vs)), eq(r, dataT(variant, rs)), ...fs.map((f, i) => mapped(def, f, vs[i], rs[i])))(s2);
      };
      return (s) => {
        const d = walk(v, s), e = walk(r, s);
        if (isData(d)) return shape(d.tag)(s);
        if (isData(e)) return shape(e.tag)(s);
        return step(disj(...place.variants.map(shape)))(s);
      };
    };
    // Folding a value whose shape is unknown is unfolding it: one choice per
    // case, and each recursive part is unfolded in turn.
    const fold = (v: Term, res: Term): Goal => (s) => {
      const d = walk(v, s);
      if (isData(d)) return armGoal(arms.get(d.tag)!, d.fields, res)(s);
      return step(disj(...[...arms.values()].map((arm) => (s1: State) => {
        const [fs, s2] = freshVars(s1, fieldCount(arm.variant));
        return conj(eq(v, dataT(arm.variant, fs)), armGoal(arm, fs, res))(s2);
      })))(s);
    };
    return (s0) => {
      const [[v], s] = freshVars(s0, 1);
      return conj(ev(n.scrutinee, env, v), fold(v, out))(s);
    };
  }

  // A solve node is a call with some ports connected to expressions and the
  // others to binders: the same thing as any other call, read sideways.
  function solveGoal(n: NodeOf<"solve">, env: Env, out: Term): Goal {
    return (s0) => {
      const ports = [...Object.keys(n.given), ...Object.keys(n.binds)];
      const [vs, s] = freshVars(s0, ports.length);
      const at = Object.fromEntries(ports.map((p, i) => [p, vs[i]]));
      const inner = new Map(env);
      for (const [p, b] of Object.entries(n.binds)) inner.set(b, at[p]);
      const given = Object.entries(n.given).map(([p, e]) => ev(e, env, at[p]));
      return conj(...given, relationGoal(n.fn, at), ev(n.body, inner, out))(s);
    };
  }

  // fn as a relation over named ports. A function's ports are its params
  // (by binder id, or position for a builtin) and "out"; anything else
  // (polar, a network, the sum atom) contributes its equations.
  function relationGoal(fn: Id, at: Record<string, Term>): Goal {
    const t = nodes[fn];
    return (s0) => {
      let s = s0;
      const port = (k: string) => {
        if (at[k] === undefined) { const [[x], s2] = freshVars(s, 1); s = s2; at[k] = x; }
        return at[k];
      };
      const body = t.kind === "def" && t.body ? nodes[t.body] : null;
      if (body?.kind === "lambda") {
        const args = body.params.map(port);
        return apply({ k: "closure", lambda: body.id, env: new Map() }, args, port("out"))(s);
      }
      if (isFunctionBuiltin(code, fn)) {
        return builtin(fn, Array.from({ length: arity(fn) }, (_, i) => port(String(i))), port("out"))(s);
      }
      const rel = relationFor(code, fn, Object.keys(at)) as unknown as { ports: string[]; vars: string[]; eqs: Eq[] };
      const names = new Map<string, Expr>();
      for (const x of rel.vars) {
        if (rel.ports.includes(x)) { const e = toExpr(port(x), s); if (!e) return null; names.set(x, e); }
        else { const [[y], s2] = freshVars(s, 1); s = s2; names.set(x, evar(`?${y.n}`) as Expr); }
      }
      const rename = (e: Expr): Expr => e.k === "var" ? names.get(e.name!) ?? e : e.k === "call" ? { ...e, args: e.args!.map(rename) } : e;
      return settle({ ...s, eqs: [...s.eqs, ...rel.eqs.map((e) => ({ lhs: rename(e.lhs), rhs: rename(e.rhs) }))] });
    };
  }

  return { ev, apply, relationGoal };
}

const arity = (fn: Id) => { const t = SIGS[fn]?.(new Subst()); return t?.t === "fn" ? t.params.length : 0; };

// Builtins that are functions with no equations to give the solver: text,
// comparisons, choice. Numeric builtins and relations go to the solver.
function isFunctionBuiltin(code: Code, fn: Id): boolean {
  const t = code.nodes[fn];
  return t.kind === "builtin" && !NUMERIC[fn] && !(t.op in RELATIONS) && !(t.op in VARIADIC);
}

function* pull(st: Stream): Generator<State> {
  while (st) {
    if (typeof st === "function") { st = st(); continue; }
    yield st[0];
    st = st[1]();
  }
}

// ---------------------------------------------------------------- entry point

export interface Answer {
  // Each port's value. A port whose value isn't pinned down holds a term
  // with unknowns in it, and `free` says so.
  values: Record<string, Term>;
  free: string[];
  // Constraints left over: equations the solver couldn't finish, checks
  // waiting for a value. Printed with unknowns as _1, _2, …
  residual: string[];
}

// Run `fn` with the ports in `known` given and every other port solved for.
// The ports of a function are its params (binder ids) and "out". Lazy: take
// as many answers as you need. May not end if there is no answer and the
// search space is infinite; pass `spend` to bound it.
export function* relate(code: Code, fn: Id, known: Record<string, unknown>, opts: Options = {}): Generator<Answer> {
  const it = interpreter(code, opts);
  const at: Record<string, Term> = Object.fromEntries(Object.entries(known).map(([k, v]) => [k, fromValue(v)]));
  const start: State = { sub: new Sub(), eqs: [], waits: [], next: 0 };
  const ports = portsOf(code, fn, Object.keys(known));
  const [vs, s] = freshVars(start, ports.length);
  ports.forEach((p, i) => { if (!(p in at)) at[p] = vs[i]; });
  for (const st of pull(it.relationGoal(fn, at)(s))) {
    const values = Object.fromEntries(ports.map((p) => [p, deep(at[p], st)]));
    const name = (n: number) => `_${n}`;
    const shown = (e: Expr): string => eshow(rn(e));
    const rn = (e: Expr): Expr => e.k === "var" && e.name!.startsWith("?") ? evar(name(+e.name!.slice(1))) as Expr : e.k === "call" ? { ...e, args: e.args!.map(rn) } : e;
    const residual = [
      ...tidy(st.eqs, values).map((e) => `${shown(e.lhs)} = ${shown(e.rhs)}`),
      ...st.waits.map((w) => w.k === "test" || w.k === "compute" ? `${w.text}(${w.args.map((a) => showTerm(deep(a, st))).join(", ")})` : w.k === "later" ? w.text : w.k),
    ];
    yield { values, free: ports.filter((p) => hasVars(values[p])), residual };
  }
}

// Leftover equations as a person would write them: unknowns that no port
// shows are substituted away (t = y + 0 and x + t = 10 is x + y = 10).
function tidy(eqs: Eq[], values: Record<string, Term>): Eq[] {
  const seen = new Set<string>();
  const collect = (t: Term) => { if (t instanceof LVar) seen.add(`?${t.n}`); else if (isData(t)) t.fields.forEach(collect); };
  Object.values(values).forEach(collect);
  const sub = (e: Expr, x: string, by: Expr): Expr => e.k === "var" && e.name === x ? by : e.k === "call" ? { ...e, args: e.args!.map((a) => sub(a, x, by)) } : e;
  let out = eqs.slice();
  for (let changed = true; changed;) {
    changed = false;
    for (const eq of out) {
      const [x, by] = eq.lhs.k === "var" && !seen.has(eq.lhs.name!) ? [eq.lhs.name!, eq.rhs] : eq.rhs.k === "var" && !seen.has(eq.rhs.name!) ? [eq.rhs.name!, eq.lhs] : [null, null];
      if (!x || varsOf(by!).has(x)) continue;
      out = out.filter((e) => e !== eq).map((e) => ({ lhs: sub(e.lhs, x, by!), rhs: sub(e.rhs, x, by!) }));
      changed = true;
      break;
    }
  }
  return out.map((e) => ({ lhs: simplify(e.lhs) as Expr, rhs: simplify(e.rhs) as Expr }));
}

function portsOf(code: Code, fn: Id, known: string[]): string[] {
  const t = code.nodes[fn];
  const body = t.kind === "def" && t.body ? code.nodes[t.body] : null;
  if (body?.kind === "lambda") return [...body.params, "out"];
  if (isFunctionBuiltin(code, fn)) return [...Array.from({ length: arity(fn) }, (_, i) => String(i)), "out"];
  return (relationFor(code, fn, known) as unknown as { ports: string[] }).ports;
}

export function showTerm(t: Term): string {
  if (t instanceof LVar) return `_${t.n}`;
  if (typeof t === "number") return String(+t.toPrecision(10));
  if (typeof t === "string") return JSON.stringify(t);
  if (isData(t)) {
    if (t.tag === CONS || t.tag === NIL) {
      const xs: string[] = [];
      let d: Term = t;
      while (isData(d) && d.tag === CONS) { xs.push(showTerm(d.fields[0])); d = d.fields[1]; }
      return isData(d) ? `[${xs.join(", ")}]` : `[${[...xs, `…${showTerm(d)}`].join(", ")}]`;
    }
    return t.fields.length ? `${t.tag}(${t.fields.map(showTerm).join(", ")})` : t.tag;
  }
  return "<function>";
}

// For the forward evaluator: a term back as a value, or undefined if it
// still has unknowns in it.
export function toValue(t: Term): Value | undefined {
  if (t instanceof LVar || hasVars(t)) return undefined;
  if (isData(t)) return { tag: t.tag, fields: t.fields.map((f) => toValue(f)!) };
  if (typeof t === "object") {
    if (t.orig) return t.orig as Value;
    throw new NotInvertible("a function made while running backwards can't be handed back");
  }
  return t;
}

