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
//                reject one). `equal` when true is unification, which
//                is what a wire in a network was.
//   for some     a fresh unknown, and the function's body run backwards
//                from true.
//   calls        a call to a known function runs that function's body.
//
// The order the goals of a body run in isn't decided here: modes.ts plans
// it for each function in each mode before the search starts (MODES.md),
// and the interpreter follows the plan (see "The schedule" below).
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
// starve a finite one. miniKanren is by Daniel P. Friedman, William E. Byrd
// and Oleg Kiselyov (The Reasoned Schemer, MIT Press, 2005;
// http://minikanren.org). The stream shape below (empty, an answer and the
// rest, or a suspension) and unit/mplus/bind follow Jason Hemann and
// Daniel P. Friedman's microKanren ("μKanren: A Minimal Functional Core for
// Relational Programming", Scheme Workshop 2013,
// http://webyrd.net/scheme-2013/papers/HemannMuKanren2013.pdf). Answers come in the order the arms and branches are
// written, canonical branch first, but fairness may interleave them.

import { plan, relation, stream } from "../../../invertible/src/relation.js";
import { call as ecall, evaluate as evaluateSolverExpr, num as enum_, show as eshow, simplify, v as evar } from "../../../invertible/src/expr.js";
import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { children, dependencies, ownerOfTypeParts, subtree } from "../model.ts";
import { derivativeLambda, gradientLambda } from "./derive.ts";
import { fieldShapes, look, type TypeEnv } from "./nested.ts";
import { B, impl } from "../prelude.ts";
import { close, fromList, META, sameNumber, equal as valueEqual, showValue, compareValues, variantOrder, ORDER_VALUES, type Data, type Value } from "./run.ts";
import { NUMERIC, relationFor } from "./equations.ts";
import { analyzer, type Choice, type Exec, type Fn, type Mode, type Plan } from "./modes.ts";
import { seededGenerator } from "./random.ts";
import { needsResolving, resolveArithmetic } from "./arith.ts";
import { infer } from "./infer.ts";
import { CELL_OPS, COMPARE, CONS, FALSE, INT_OPS, IO, NIL, NONE, RANDOM_OP, S, SET, SHOW_ANY, SIGS, SOME, STD_IMPL, STD_MANY, stdNames, TEXT_OPS, TRUE } from "./std.ts";
import { add as intAdd, intLit, neg as intNeg, sub as intSub, type Int } from "./int.ts";
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
// `gradient`: this is gradient(the closure), whose lambda is written once
// it's applied to a point and so known to be over that point's record.
interface Closure { k: "closure"; lambda: Id; env: Env; orig?: unknown; gradient?: true }
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
  // Runs `then` once `ready` says enough is known. `on`, when given, is
  // what `ready` reads, so the wait can sleep until one of them changes.
  | { k: "later"; ready: (s: State) => boolean; then: Goal; text: string; on?: Term[] };

// `spend` is the search's step budget, carried in the state so the
// equation solver, which runs outside the interpreter, spends from it too.
interface State { sub: Sub; eqs: Eq[]; waits: Wait[]; next: number; spend?: () => boolean; asleep?: Asleep }

// Equations and waits that nothing new is known about sleep, each under
// the unknowns it reads, and wake when one of them gets a value (in
// bindVar). Without this, every step re-read every one of them: a search
// that leaves one waiting equation and one waiting check per level (n = n₁
// + 1 and n₁ ≠ 0, … in fibFast(n) = 8 past its first answer) got slower
// with every level, about a minute for 2,000 steps (BACKLOG L83). An item
// sleeps under all its unknowns, so ids say which ones are still asleep.
// This is Prolog's coroutining (freeze/2, when/2: a goal suspended on
// variables wakes when one is bound; Holzbaur's attributed variables,
// PLILP 1992), here for the solver's equations and the waits below.
type Sleeper = { eq: Eq } | { wait: Wait };
interface Asleep { items: Sub<Sleeper>; watch: Sub<number[]>; eqs: number; waits: number }
let sleeperIds = 0;

// The substitution: logic variable number to term. Persistent, as a 32-way
// trie on the number, so binding a variable copies one short path instead
// of the whole map. (Copying the map was what made reading text back
// cubic.) Variables are numbered densely from 0, so the trie stays shallow.
type Trie = unknown[];
class Sub<T = Term> {
  root: Trie;
  depth: number;
  constructor(root: Trie = [], depth = 0) { this.root = root; this.depth = depth; }
  get(n: number): T | undefined {
    if (n >= 2 ** (5 * (this.depth + 1))) return undefined;
    let node: Trie | undefined = this.root;
    for (let d = this.depth; d > 0; d--) {
      node = node[(n >>> (5 * d)) & 31] as Trie | undefined;
      if (!node) return undefined;
    }
    return node[n & 31] as T | undefined;
  }
  has(n: number) { return this.get(n) !== undefined; }
  // The variables bound, in order.
  *keys(): Generator<number> {
    function* go(node: Trie, d: number, base: number): Generator<number> {
      for (let i = 0; i < node.length; i++) {
        if (node[i] === undefined) continue;
        if (d === 0) yield base + i;
        else yield* go(node[i] as Trie, d - 1, (base + i) * 32);
      }
    }
    yield* go(this.root, this.depth, 0);
  }
  set(n: number, t: T | undefined): Sub<T> {
    let root = this.root, depth = this.depth;
    while (n >= 2 ** (5 * (depth + 1))) { root = [root]; depth++; }
    const put = (node: Trie | undefined, d: number): Trie => {
      const copy = node ? node.slice() : [];
      const i = (n >>> (5 * d)) & 31;
      copy[i] = d === 0 ? t : put(copy[i] as Trie | undefined, d - 1);
      return copy;
    };
    return new Sub<T>(put(root, depth), depth);
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


function unify(a: Term, b: Term, s: State): State | null {
  a = walk(a, s);
  b = walk(b, s);
  if (a === b) return s;
  if (a instanceof LVar) return bindVar(s, a, b);
  if (b instanceof LVar) return bindVar(s, b, a);
  // The same rule as `equal` forward (run.ts sameNumber): Ints exactly.
  if (typeof a === "number" && typeof b === "number") return sameNumber(a, b) ? s : null;
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
  const sub = s.sub.set(v.n, t);
  const z = s.asleep, ids = z?.watch.get(v.n);
  if (!z || !ids) return { ...s, sub };
  // What was waiting on v wakes.
  let items = z.items, eqsAsleep = z.eqs, waitsAsleep = z.waits;
  const eqs = s.eqs.slice(), waits = s.waits.slice();
  for (const id of ids) {
    const it = items.get(id);
    if (!it) continue;
    items = items.set(id, undefined);
    if ("eq" in it) { eqs.push(it.eq); eqsAsleep--; } else { waits.push(it.wait); waitsAsleep--; }
  }
  return { ...s, sub, eqs, waits, asleep: { items, watch: z.watch.set(v.n, undefined), eqs: eqsAsleep, waits: waitsAsleep } };
}

// Every equation and wait, asleep or not: for what an answer leaves open.
function* asleepItems(s: State): Generator<Sleeper> {
  const z = s.asleep;
  if (!z || !(z.eqs + z.waits)) return;
  for (const id of z.items.keys()) { const it = z.items.get(id); if (it) yield it; }
}
const everyEq = (s: State): Eq[] => [...s.eqs, ...[...asleepItems(s)].flatMap((it) => ("eq" in it ? [it.eq] : []))];
const everyWait = (s: State): Wait[] => [...s.waits, ...[...asleepItems(s)].flatMap((it) => ("wait" in it ? [it.wait] : []))];

// What a wait reads, or null when it can't say (a `later` without `on`).
function waitReads(w: Wait): Term[] | null {
  switch (w.k) {
    case "concat": return [w.a, w.b, w.c];
    case "show": return [w.n, w.s];
    case "test": case "compute": return w.args;
    case "range": return [w.n, w.out];
    case "later": return w.on ?? null;
  }
}
function unknownsIn(ts: Term[], s: State): number[] {
  const out = new Set<number>();
  const go = (t: Term) => { t = walk(t, s); if (t instanceof LVar) out.add(t.n); else if (isData(t)) t.fields.forEach(go); };
  ts.forEach(go);
  return [...out];
}

// Past a handful, the equations and waits settle couldn't use go to sleep.
// A few stay awake, so a small search runs as it always did, and the
// solver can still take up to six equations together.
const AWAKE = 6;
function doze(s: State): State {
  const z = s.asleep ?? { items: new Sub<Sleeper>(), watch: new Sub<number[]>(), eqs: 0, waits: 0 };
  const sleepEqs = s.eqs.length + z.eqs > AWAKE, sleepWaits = s.waits.length + z.waits > AWAKE;
  if (!sleepEqs && !sleepWaits) return s;
  let { items, watch, eqs: eqsAsleep, waits: waitsAsleep } = z;
  const put = (it: Sleeper, on: number[]) => {
    const id = sleeperIds++;
    items = items.set(id, it);
    for (const v of on) watch = watch.set(v, [...(watch.get(v) ?? []), id]);
  };
  const eqs: Eq[] = [], waits: Wait[] = [];
  for (const e of s.eqs) {
    const on = [...new Set([...varsOf(e.lhs), ...varsOf(e.rhs)])].filter((x) => x.startsWith("?")).map((x) => +x.slice(1));
    if (sleepEqs && on.length) { put({ eq: e }, on); eqsAsleep++; } else eqs.push(e);
  }
  for (const w of s.waits) {
    const reads = sleepWaits ? waitReads(w) : null;
    const on = reads && unknownsIn(reads, s);
    if (on?.length) { put({ wait: w }, on); waitsAsleep++; } else waits.push(w);
  }
  return { ...s, eqs, waits, asleep: { items, watch, eqs: eqsAsleep, waits: waitsAsleep } };
}

// Every equation awake again, for the solver to take together.
function wakeEqs(s: State): State {
  const z = s.asleep;
  if (!z?.eqs) return s;
  let items = z.items;
  const eqs = s.eqs.slice();
  for (const id of z.items.keys()) { const it = items.get(id); if (it && "eq" in it) { eqs.push(it.eq); items = items.set(id, undefined); } }
  return { ...s, eqs, asleep: { ...z, items, eqs: 0 } };
}

const freshVars = (s: State, n: number): [LVar[], State] =>
  [Array.from({ length: n }, (_, i) => new LVar(s.next + i)), { ...s, next: s.next + n }];

const WORLD_OPS = new Set<Id>(Object.values(IO));
const CELL_IDS = new Set<Id>(Object.values(CELL_OPS));

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
  // A run of answers that g rejects at once is walked in a loop: as
  // recursion, eight thousand of them in a row (queens' safe, backwards)
  // overflow the stack.
  for (;;) {
    if (a === null) return null;
    if (typeof a === "function") { const later = a; return () => bind(later(), g); }
    const r = g(a[0]);
    const rest = a[1];
    if (r !== null) return mplus(r, () => bind(rest(), g));
    a = rest();
  }
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
  // The solver may take up to six equations together: with that few in
  // all, they're all at hand.
  if (s.asleep?.eqs && s.eqs.length + s.asleep.eqs <= AWAKE) s = wakeEqs(s);
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
  if (solved !== undefined) return solved; // null: no solution, a failure
  for (let i = 0; i < s.waits.length; i++) {
    const g = wake(s.waits[i], s);
    // A check that passes changes nothing, so what else woke with it is
    // looked at again before the state goes on.
    if (g === succeed) return settle({ ...s, waits: s.waits.filter((_, j) => j !== i) });
    if (g) return g({ ...s, waits: s.waits.filter((_, j) => j !== i) });
  }
  return unit(doze(s));
}

const PERIODS = 64;

// Hand the solver the smallest thing it can solve: a single equation with
// one unknown, else (for a handful of equations) the whole system, which is
// where simultaneous equations like a + b = 10, a − b = 4 get eliminated.
function solveSome(s: State): Stream | undefined {
  if (!s.eqs.length) return undefined;
  // An equation that holds whatever its unknown is (0 = 0 · angle, at the
  // origin) says nothing about it: it's dropped, and the unknown stays free.
  const vars = (e: Eq) => [...new Set([...varsOf(e.lhs), ...varsOf(e.rhs)])];
  const always = (e: Eq) => { const [x] = vars(e); return [0.37, -1.9, 2.6].every((t) => { const l = evalExpr(e.lhs, { [x]: t }), r = evalExpr(e.rhs, { [x]: t }); return Number.isFinite(l) && close(l, r); }); };
  const empty = s.eqs.filter((e) => vars(e).length === 1 && always(e));
  if (empty.length) return settle({ ...s, eqs: s.eqs.filter((e) => !empty.includes(e)) });
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
    // An answer that leaves every unknown free (0 = 2 · a · b, solved for a
    // with b unknown) pins nothing down: settling it again would be the same
    // state, forever. This group waits for more to be known.
    const head = it.next();
    if (!head.done && determined.every((x) => head.value.values[x] === null || head.value.values[x] === undefined)) continue;
    let first: IteratorResult<{ values: Record<string, number | null> }> | null = head;
    // A periodic family (angle + 2πk) never ends. If none of its first
    // members fits what else is known, the rest won't either, and walking
    // them would never come back (it spends no fuel), so stop there.
    let left = PERIODS;
    // Each answer the solver hands back is a step of the search: a search
    // that solves many equations per unfolding (queens' safe, backwards)
    // would otherwise do unbounded work between steps.
    const next = (): Stream => {
      if (s.spend && !s.spend()) return null;
      const r = first ?? it.next();
      first = null;
      if (r.done || left-- <= 0) return null;
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
  for (const w of everyWait(s)) {
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
  // What `random()` answers with, inside `seeded` (set by its reading below).
  random?: () => number;
  // The schedules, when an interpreter inside this one (seeded, with fuel)
  // runs the same code.
  plans?: ReturnType<typeof analyzer>;
}

// One analyzer per program, brought up to date as nodes are added.
const analyzers = new WeakMap<Code, ReturnType<typeof analyzer>>();
function plansFor(code: Code, names?: Names): ReturnType<typeof analyzer> {
  let a = analyzers.get(code);
  if (!a) { a = analyzer(code, names as Record<Id, string> | undefined, { plansOnly: true }); analyzers.set(code, a); }
  return a;
}

export function interpreter(code: Code, opts: Options = {}) {
  // The generic + resolved to each type's own first (arith.ts), as the
  // evaluator does; a program from the evaluator is resolved already.
  if (needsResolving(code)) code = resolveArithmetic(code, infer(code)).code;
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

  // The schedule (modes.ts, MODES.md): for a function in a mode, the order
  // its goals run in, decided before the search starts. A body runs in a
  // frame, one logic variable per slot (a node's value or a binder's: a
  // ref and its binder, a let's parameter and its argument, a let and its
  // body share one). Each goal below is one node's relation over its
  // slots, the same whichever way it runs; the plan says when it runs.
  // What the plan can't decide (a call of a function only known then) is
  // decided here, from what's known when it's reached.
  const plans = opts.plans ?? plansFor(code, opts.names);
  const slot = plans.slot;
  type Frame = Map<Id, Term>;
  const sl = (f: Frame, id: Id): Term => {
    const t = f.get(slot(id));
    if (t === undefined) throw new NotInvertible("a variable is used outside its scope");
    return t;
  };

  // The binders a lambda uses from outside itself.
  const lamFree = new Map<Id, Id[]>();
  const freeBinders = (lam: Id): Id[] => {
    let out = lamFree.get(lam);
    if (!out) {
      const inside = new Set(subtree(code, lam));
      out = [...new Set(subtree(code, lam).flatMap((x) => {
        const n = nodes[x];
        return n.kind === "ref" && nodes[n.target]?.kind === "binder" && !inside.has(n.target) ? [n.target] : [];
      }))];
      lamFree.set(lam, out);
    }
    return out;
  };

  // The slots a body has of its own, not going into the functions written
  // in it (each call of one gets its own frame), and the binders it uses
  // from outside.
  const owned = new Map<string, { own: Id[]; outside: Id[] }>();
  function slotsOf(key: string, starts: Id[]) {
    let hit = owned.get(key);
    if (hit) return hit;
    const roots = new Set<Id>(), inside = new Set<Id>(), used = new Set<Id>();
    const visit = (id: Id) => {
      const n = nodes[id];
      if (!n) return;
      roots.add(slot(id));
      switch (n.kind) {
        case "binder": inside.add(id); return;
        case "ref": if (nodes[n.target]?.kind === "binder") used.add(n.target); return;
        case "lambda": for (const b of freeBinders(id)) used.add(b); return;
        case "call":
          if (plans.isLet(n)) {
            const lam = nodes[n.fn] as NodeOf<"lambda">;
            n.args.forEach(visit);
            lam.params.forEach(visit);
            visit(lam.body);
            return;
          }
      }
      children(n).forEach(visit);
    };
    starts.forEach(visit);
    const outside = [...used].filter((b) => !inside.has(b));
    const theirs = new Set(outside.map(slot));
    hit = { own: [...roots].filter((r) => !theirs.has(r)), outside };
    owned.set(key, hit);
    return hit;
  }

  // A new frame: its own slots fresh, what it uses from outside from
  // `outer`, and each port tied to what's passed in.
  function framed(key: string, starts: Id[], outer: (b: Id) => Term | undefined, ports: [Id, Term][], then: (f: Frame) => Goal): Goal {
    return (s0) => {
      const { own, outside } = slotsOf(key, starts);
      const [vs, s] = freshVars(s0, own.length);
      const f: Frame = new Map(own.map((r, i) => [r, vs[i]]));
      const set = new Set<Id>();
      for (const b of outside) {
        const t = outer(b);
        if (t === undefined) throw new NotInvertible("a variable is used outside its scope");
        f.set(slot(b), t);
        set.add(slot(b));
      }
      const ties: Goal[] = [];
      for (const [id, t] of ports) {
        const r = slot(id);
        if (set.has(r)) ties.push(eq(f.get(r)!, t));
        else { set.add(r); f.set(r, t); }
      }
      return conj(...ties, then(f))(s);
    };
  }

  // The mode a call runs in when the plan couldn't say: what's known now.
  const fnOf = (t: Term): Fn | null => {
    if (typeof t !== "object" || t instanceof LVar || isData(t)) return null;
    if (t.k === "closure") return t.gradient ? null : { k: "lambda", id: t.lambda };
    const k = nodes[t.id]?.kind;
    return k === "builtin" || k === "variant" || k === "field" ? { k, id: t.id } : null;
  };
  const modeNow = (args: Term[], out: Term, s: State): Mode => ({
    known: [...args.flatMap((a, i) => (known(a, s) ? [String(i)] : [])), ...(known(out, s) ? ["out"] : [])],
    spec: args.flatMap((a, i): [number, Fn][] => { const g = fnOf(walk(a, s)); return g ? [[i, g]] : []; }),
  });

  function invoke(c: Closure, args: Term[], out: Term, mode?: Mode): Goal {
    plans.fresh(c.lambda);
    const lam = nodes[c.lambda] as NodeOf<"lambda">;
    return framed(c.lambda, [...lam.params, lam.body], (b) => (c.env.has(b) ? fromValue(c.env.get(b)) : undefined),
      [...lam.params.map((p, i): [Id, Term] => [p, args[i]]), [lam.body, out]],
      (f) => (s) => runPlan(plans.planOf({ k: "lambda", id: c.lambda }, mode ?? modeNow(args, out, s)), f)(s));
  }

  function runPlan(p: Plan, f: Frame): Goal {
    const goals = p.steps.map((e) => exec(e, f));
    if (p.branch) goals.push(choose(p.branch, f));
    return conj(...goals);
  }

  function exec(e: Exec, f: Frame): Goal {
    // A goal the mode never got to: it waits for what it needs.
    // A builtin waits on its own for what it needs, so it goes in as it is.
    if (e.waits && (e.k === "call" && !isBuiltinCall(e.node) || e.k === "solve" || e.k === "unfold")) {
      // When it runs, it runs in the mode it's in then.
      const g = exec({ ...e, waits: undefined, ...("callee" in e ? { callee: undefined } : {}) }, f);
      const ready = needs(e, f);
      return wait({ k: "later", text: waitText(e), ready, then: g, on: reads(e, f) });
    }
    switch (e.k) {
      case "given": {
        const n = nodes[e.node];
        if (n.kind === "lit") return eq(sl(f, e.node), n.of === INT ? intLit(n.value) as Term : n.value);
        return refGoal((n as NodeOf<"ref">).target, sl(f, e.node));
      }
      case "closure": {
        const env: Env = new Map();
        for (const b of freeBinders(e.node)) env.set(b, sl(f, b));
        return eq(sl(f, e.node), { k: "closure", lambda: e.node, env });
      }
      case "call": return callGoal(nodes[e.node] as NodeOf<"call">, f, e.callee);
      case "same": return e.a === e.b ? succeed : eq(sl(f, e.a), sl(f, e.b));
      case "case": return eq(sl(f, e.value), dataT(e.variant, e.binds.map((b) => sl(f, b))));
      case "unfold": return unfoldGoal(e, f);
      case "solve": return solveGoal(nodes[e.node] as NodeOf<"solve">, f, e.callee);
      case "hole": return () => { throw new NotInvertible("the program has a hole here"); };
    }
  }

  const isBuiltinCall = (id: Id) => { const h = nodes[(nodes[id] as NodeOf<"call">).fn]; return h.kind === "ref" && nodes[h.target]?.kind === "builtin"; };

  // What a waiting goal needs: a call its inputs or its value, a solve
  // what it's given, a fold one level down its part or its result.
  function needs(e: Exec, f: Frame): (s: State) => boolean {
    if (e.k === "call") {
      const n = nodes[e.node] as NodeOf<"call">;
      const ins = n.args.map((a) => sl(f, a)), out = sl(f, n.id);
      return (s) => ins.every((t) => known(t, s)) || known(out, s);
    }
    if (e.k === "solve") {
      const ins = Object.values((nodes[e.node] as NodeOf<"solve">).given).map((x) => sl(f, x));
      return (s) => ins.every((t) => known(t, s));
    }
    if (e.k === "unfold") { const p = sl(f, e.part), r = sl(f, e.result); return (s) => known(p, s) || known(r, s); }
    return () => true;
  }
  // What needs reads.
  function reads(e: Exec, f: Frame): Term[] | undefined {
    if (e.k === "call") { const n = nodes[e.node] as NodeOf<"call">; return [...n.args.map((a) => sl(f, a)), sl(f, n.id)]; }
    if (e.k === "solve") return Object.values((nodes[e.node] as NodeOf<"solve">).given).map((x) => sl(f, x));
    if (e.k === "unfold") return [sl(f, e.part), sl(f, e.result)];
    return undefined;
  }
  const waitText = (e: Exec): string => {
    if (e.k === "call") { const h = nodes[(nodes[e.node] as NodeOf<"call">).fn]; return h.kind === "ref" ? opts.names?.[h.target] ?? stdNames[h.target] ?? "call" : "call"; }
    return e.k === "solve" ? "solve" : "fold";
  };

  function refGoal(target: Id, out: Term): Goal {
    const t = nodes[target];
    switch (t.kind) {
      case "def": {
        const body = nodes[t.body!];
        if (body.kind === "lambda") return eq(out, { k: "closure", lambda: body.id, env: new Map() });
        // A value defined once: its body, in a frame of its own.
        return framed(body.id, [body.id], () => undefined, [[body.id, out]], (f) => (s) => runPlan(plans.planOfValue(target, known(out, s)), f)(s));
      }
      case "builtin": return eq(out, { k: "prim", id: target });
      case "variant": return eq(out, t.fields.length ? { k: "prim", id: target } : dataT(target));
      case "field": return eq(out, { k: "prim", id: target });
      default: throw new NotInvertible(`can't refer to a ${t.kind}`);
    }
  }

  function callGoal(n: NodeOf<"call">, f: Frame, callee?: Mode): Goal {
    const args = n.args.map((a) => sl(f, a)), out = sl(f, n.id), fn = sl(f, n.fn);
    const head = nodes[n.fn];
    const applyG: Goal = (s) => apply(walk(fn, s), args, out, callee)(s);
    // A function named here: its value is known before anything runs.
    if (head.kind === "ref" && nodes[head.target]?.kind !== "binder") return conj(refGoal(head.target, fn), applyG);
    return applyG;
  }

  // A choice of arms (a match, or a fold's first level). The value
  // examined known: its arm. Else each arm is a branch.
  function choose(c: Choice, f: Frame): Goal {
    const node = nodes[c.node] as NodeOf<"match"> | NodeOf<"fold">;
    const v = sl(f, c.value);
    const written = node.arms.map((a) => (nodes[a] as NodeOf<"arm">).variant);
    const others = node.kind === "match" && node.otherwise && written.length ? variantsOf(written[0]).filter((x) => !written.includes(x)) : [];
    const arm = (a: Choice["arms"][number]): Goal => {
      const rest = runPlan(a.plan, f);
      // Otherwise: the value is one of the cases not written.
      if (a.variant === null) {
        if (!written.length) return rest;
        return (s) => {
          const d = walk(v, s);
          if (isData(d)) return others.includes(d.tag) ? rest(s) : null;
          return disj(...others.map((o) => (s1: State) => {
            const [fs, s2] = freshVars(s1, fieldCount(o));
            return conj(eq(v, dataT(o, fs)), rest)(s2);
          }))(s);
        };
      }
      return c.exclusive ? conj(eq(v, dataT(a.variant, a.binds.map((b) => sl(f, b)))), rest) : rest;
    };
    return (s) => {
      const d = walk(v, s);
      if (isData(d)) {
        const a = c.arms.find((x) => x.variant === d.tag) ?? c.arms.find((x) => x.variant === null);
        return a ? arm(a)(s) : null;
      }
      const g = disj(...c.arms.map(arm));
      // Unfolding a value whose case isn't known may go on forever.
      return (node.kind === "fold" ? step(g) : g)(s);
    };
  }

  // A recursive part and its folded value: the fold one level down, in a
  // frame of its own. A container of trees (a rose tree's children) is the
  // same container with each tree's folded value in its place.
  function unfoldGoal(e: Extract<Exec, { k: "unfold" }>, f: Frame): Goal {
    const n = nodes[e.fold] as NodeOf<"fold">;
    // Each level starts on a fresh stack (a suspension, which spends no
    // fuel): a long list read back would otherwise run out of it.
    const once = (p: Term, r: Term): Goal => {
      const g = framed(`${e.fold}#arms`, n.arms, (b) => f.get(slot(b)), [[`${e.fold}#part`, p], [`${e.fold}#out`, r]], (h) => runPlan(e.plan(), h));
      return (s) => () => g(s);
    };
    const def = owner.get(e.variant)!;
    const part = sl(f, e.part), result = sl(f, e.result);
    if (fieldShapes(code, def, e.variant)[e.index] !== "nested") return once(part, result);
    const fid = (nodes[e.variant] as NodeOf<"variant">).fields[e.index];
    return mapped(def, { tid: (nodes[fid] as NodeOf<"field">).type, env: new Map() }, part, result, once);
  }

  // Either side may be what's known, so the shape comes from whichever is.
  function mapped(def: Id, at: { tid: Id; env: TypeEnv }, v: Term, r: Term, once: (v: Term, r: Term) => Goal): Goal {
    const place = look(code, def, at.tid, at.env);
    if (place.k === "self") return once(v, r);
    if (place.k === "other") return eq(r, v);
    const shape = (variant: Id): Goal => (s0) => {
      const n = fieldCount(variant);
      const [vs, s1] = freshVars(s0, n);
      const [rs, s2] = freshVars(s1, n);
      const fs = place.fields(variant);
      return conj(eq(v, dataT(variant, vs)), eq(r, dataT(variant, rs)), ...fs.map((x, i) => mapped(def, x, vs[i], rs[i], once)))(s2);
    };
    return (s) => {
      const d = walk(v, s), e = walk(r, s);
      if (isData(d)) return shape(d.tag)(s);
      if (isData(e)) return shape(e.tag)(s);
      return step(disj(...place.variants.map(shape)))(s);
    };
  }

  // A solve node is a call with some ports connected to expressions and the
  // others to binders: the same thing as any other call, read sideways.
  function solveGoal(n: NodeOf<"solve">, f: Frame, callee?: Mode): Goal {
    const at: Record<string, Term> = {};
    for (const [p, e] of Object.entries(n.given)) at[p] = sl(f, e);
    for (const [p, b] of Object.entries(n.binds)) at[p] = sl(f, b);
    return relationGoal(n.fn, at, callee);
  }

  // mode: the mode the plan says the function runs in, when it says.
  function apply(f: Term, args: Term[], out: Term, mode?: Mode): Goal {
    // Functions can't be guessed: wait until it's known which one this is.
    if (f instanceof LVar) return wait({ k: "later", ready: (s) => !(walk(f, s) instanceof LVar), then: (s) => apply(walk(f, s), args, out, mode)(s), text: "call", on: [f] });
    if (isData(f) && f.tag === RANDOM_OP && !args.length) {
      if (!opts.random) throw new NotInvertible("random() outside seeded answers from the world, which only runs forward");
      const next = opts.random;
      return (s) => eq(out, next())(s);
    }
    if (typeof f !== "object" || isData(f)) throw new NotInvertible("calling something that isn't a function");
    if (f.k === "closure" && f.gradient) {
      const g = f;
      return wait({
        k: "later", text: "gradient", on: [args[0]], ready: (s) => !(walk(args[0], s) instanceof LVar), then: (s) => {
          const p = walk(args[0], s);
          const lambda = typeof p === "number" ? derivativeLambda(code, { lambda: g.lambda }) : isData(p) ? gradientLambda(code, { lambda: g.lambda }, (p as DataT).tag) : null;
          if (!lambda) throw new NotInvertible("gradient is taken at a record of Float64s");
          return apply({ k: "closure", lambda, env: g.env }, args, out)(s);
        },
      });
    }
    if (f.k === "closure") {
      const g = invoke(f, args, out, mode);
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
      case S.floor: case S.mod: case S.float32:
        // Many inputs give the same output (a whole interval, every multiple
        // of b, every number rounding to one f32): there's nothing to
        // enumerate, so these only run forward.
        return wait({ k: "compute", args, out, f: STD_IMPL[id] as (...x: Value[]) => Value, text: id === S.floor ? "floor" : id === S.mod ? "mod" : "round to Float32" });
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
      case S.and: case S.hence: return table(args, out, (x, y) => x && y);
      case S.or: return table(args, out, (x, y) => x || y);
      case S.not: return table(args, out, (x) => !x);
      case S.oneOf: return member(a, out);
      case S.exists: return exists(a, out);
      case S.fail: return failG;
      case S.first: case S.all: case S.count: case S.optional: return aggregate(id, args, out);
      case S.mapParts: case S.zipParts: case S.total: return parts(id, args, out);
      // Forward only: once the seed and the action are known, the action runs
      // with random() answered by the evaluator's generator (random.ts).
      // Backwards it would have to search the seeds.
      case S.seeded:
        return wait({
          k: "later", text: "seeded", on: [a, b], ready: (s) => typeof walk(a, s) === "number" && !(walk(b, s) instanceof LVar), then: (s) => {
            const gen = seededGenerator(walk(a, s) as number);
            return interpreter(code, { ...opts, spend, plans, random: () => gen.next() }).apply(walk(b, s), [], out)(s);
          },
        });
      case S.print: throw new NotInvertible("printing can't be run backwards (or searched: it would print once per guess)");
      // Backwards, derivative would be integration: it waits for its function.
      case S.derivative:
        return wait({
          k: "later", text: "derivative", on: [a], ready: (s) => !(walk(a, s) instanceof LVar), then: (s) => {
            const f = walk(a, s) as Closure | Prim;
            const lambda = derivativeLambda(code, f.k === "closure" ? { lambda: f.lambda } : { prim: f.id });
            return eq(out, { k: "closure", lambda, env: f.k === "closure" ? f.env : new Map() })(s);
          },
        });
      // Like derivative, it waits for its function; which record it's
      // over shows when it's applied to a point (apply, below).
      case S.gradient:
        return wait({
          k: "later", text: "gradient", on: [a], ready: (s) => !(walk(a, s) instanceof LVar), then: (s) => {
            const f = walk(a, s) as Closure | Prim;
            if (f.k !== "closure") return eq(out, f.k === "prim" ? { k: "closure", lambda: derivativeLambda(code, { prim: f.id }), env: new Map() } : f)(s);
            return eq(out, { ...f, gradient: true })(s);
          },
        });
      // The action runs with its own budget: every step that might repeat
      // forever spends one, and when they're gone that branch has no answer.
      case S.fuel:
        return wait({
          k: "later", text: "with fuel", on: [a, b], ready: (s) => typeof walk(a, s) === "number" && !(walk(b, s) instanceof LVar), then: (s) => {
            let left = walk(a, s) as number;
            const inner = () => left-- > 0 && spend();
            // Inside, the solver spends the action's budget; its answers go
            // on with the outer one.
            return bind(interpreter(code, { spend: inner, plans }).apply(walk(b, s), [], out)({ ...s, spend: inner }), (t) => unit({ ...t, spend: s.spend }));
          },
        });
    }
    // The rest (Int and text operations, set) run forward: once their inputs
    // are known, each of their answers is a branch.
    if (id === SET) {
      // The path is read off the function's nodes, so only the record and
      // the value need to be known.
      return wait({
        k: "later", text: "set", on: [a, b, args[2]], ready: (s) => !(walk(a, s) instanceof LVar) && known(b, s) && known(args[2], s), then: (s) => {
          const get = walk(a, s) as Closure | Prim;
          const path = get.k === "prim" ? [get.id] : fieldPath(code, get.lambda);
          if (!path) throw new NotInvertible("set needs a field, or a path of fields");
          return eq(out, setPath(deep(b, s) as DataT, path.map((f) => fieldIndex(code, f)), deep(args[2], s)))(s);
        },
      });
    }
    // Whole-number add, subtract and negate: any two of the three sides
    // give the third. Waiting for both inputs instead, length(xs) = 0
    // backwards would guess every list, then add up each guess to see.
    if (id === INT_OPS.add || id === INT_OPS.sub || id === INT_OPS.neg) {
      const sides = [...args, out];
      // The side to find, from the others: out = a + b, a = out − b, b = out − a.
      const solve: ((x: Int[]) => Int)[] = id === INT_OPS.add ? [([, b, o]) => intSub(o, b), ([a, , o]) => intSub(o, a), ([a, b]) => intAdd(a, b)]
        : id === INT_OPS.sub ? [([, b, o]) => intAdd(o, b), ([a, , o]) => intSub(a, o), ([a, b]) => intSub(a, b)]
        : [([, o]) => intNeg(o), ([a]) => intNeg(a)];
      const unknown = (s: State) => sides.filter((t) => walk(t, s) instanceof LVar).length;
      return wait({
        k: "later", text: stdNames[id] ?? id, on: sides, ready: (s) => unknown(s) <= 1, then: (s) => {
          const xs = sides.map((t) => walk(t, s));
          const i = xs.findIndex((x) => x instanceof LVar);
          const at = i < 0 ? sides.length - 1 : i;
          return eq(sides[at], solve[at](xs as Int[]))(s);
        },
      });
    }
    // split, backwards: the pieces joined by the separator, if splitting
    // that gives the same pieces (no piece holds the separator). Waiting
    // for the text alone, a search for words in a line would build ever
    // longer lists of pieces that never meet a text.
    if (id === TEXT_OPS.split) {
      const [t, by] = args;
      return wait({
        k: "later", text: "split", on: [t, by, out], ready: (s) => known(by, s) && (known(t, s) || known(out, s)), then: (s) => {
          const sep = walk(by, s) as string, split = STD_IMPL[id] as (t: string, by: string) => Value;
          if (known(t, s)) return eq(out, fromValue(split(walk(t, s) as string, sep)))(s);
          const pieces = fromList(toValue(deep(out, s))!) as string[];
          const text = pieces.join(sep);
          return sep !== "" && valueEqual(split(text, sep), toValue(deep(out, s))!) ? eq(t, text)(s) : null;
        },
      });
    }
    // compare runs forwards once both are known: which pairs are in order
    // isn't a search worth making.
    const many = STD_MANY[id] ?? (STD_IMPL[id] ? (...xs: Value[]) => [STD_IMPL[id](...xs)] : id === SHOW_ANY ? (x: Value) => [showValue(x, code, opts.names ?? stdNames)]
      : id === COMPARE ? (a: Value, b: Value) => [ORDER_VALUES[compareValues(a, b, variantOrder(code)) + 1]] : null);
    if (many) {
      return wait({
        k: "later", text: id, on: args, ready: (s) => args.every((a) => known(a, s)), then: (s) => {
          const xs = args.map((a) => toValue(deep(a, s))!);
          return disj(...many(...xs).map((v: Value) => eq(out, fromValue(v))))(s);
        },
      });
    }
    // Each builtin either has a reading above or says here why it has none
    // (compiler/test/builtins.test.ts checks every one).
    if (WORLD_OPS.has(id)) throw new NotInvertible(`${stdNames[id] ?? id} touches the world (the console, files): that can't be undone, and a search would do it once per guess`);
    if (CELL_IDS.has(id)) throw new NotInvertible(`${stdNames[id] ?? id} works on cells, the runtime's state, which only runs forward`);
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

  // for some(f): true when some value makes f true. Run that way it is one
  // more unknown, and f's body runs backwards from true. False means no
  // value does, which can only be found by searching them all; so it's
  // decided only when the search can't depend on anything else unknown.
  function exists(f: Term, out: Term): Goal {
    return (s0) => {
      const [[x], s] = freshVars(s0, 1);
      const yes = conj(eq(out, boolT(true)), (st: State) => apply(walk(f, st), [x], boolT(true))(st));
      const no: Goal = (st) => {
        for (const t of pull(apply(walk(f, st), [x], boolT(true))(st))) {
          for (const n of t.sub.keys()) {
            if (n < s0.next && !st.sub.has(n)) throw new NotInvertible("for some can't be false while what it depends on is unknown");
          }
          return null;
        }
        return eq(out, boolT(false))(st);
      };
      const o = walk(out, s);
      if (isData(o)) return (o.tag === TRUE ? yes : no)(s);
      return disj(yes, no)(s);
    };
  }

  // one of(list) = x: x is somewhere in the list. Each cell of the list is
  // waited for until it's known. Making up lists that contain x instead (a
  // list one longer each time) never ends when the list is really built by
  // a later goal: `one of([3])` asked for 5 went on proposing [5], [_, 5],
  // … before the literal's cons was ever unified (miniKanren's classic
  // goal-order divergence, REVIEW-2026-10-22b.md §3). A list that never
  // becomes known leaves the wait as a residual.
  function member(xs: Term, out: Term): Goal {
    return (s) => {
      const l = walk(xs, s);
      if (l instanceof LVar) return wait({ k: "later", text: "one of", ready: (st) => !(walk(xs, st) instanceof LVar), then: member(xs, out), on: [xs] })(s);
      if (isData(l)) return l.tag === CONS ? disj(eq(out, l.fields[0]), step(member(l.fields[1], out)))(s) : null;
      return null;
    };
  }

  // first, all and count look at every answer of their action at once. Run
  // forward that's fine. Run backwards it would mean "find inputs for which
  // the set of answers is this", which is not a choice per answer; so they
  // wait until everything their action uses is known, then run it forward.
  // An answer of the action that still has unknowns in it isn't pinned
  // down, so it doesn't count (as in the evaluator's solve).
  // The parts builtins are their function, part by part: once any side's
  // shape is known (Float64, or which record), every side gets that shape
  // and each part is one call, which runs backwards like any other.
  // `total` is the parts added up.
  function parts(id: Id, args: Term[], out: Term): Goal {
    const sides = id === S.total ? [args[0]] : [...args.slice(1), ...(id === S.mapParts || id === S.zipParts ? [out] : [])];
    const shapeOf = (s: State) => sides.map((t) => walk(t, s)).find((t) => typeof t === "number" || isData(t));
    return wait({
      k: "later", text: id === S.total ? "total" : id === S.mapParts ? "map parts" : "zip parts", ready: (s) => shapeOf(s) !== undefined, then: (s0) => {
        const shape = shapeOf(s0)!;
        const add: Term = { k: "prim", id: B.add };
        if (!isData(shape)) return (id === S.total ? eq(out, args[0]) : apply(walk(args[0], s0), args.slice(1), out))(s0);
        const n = fieldCount(shape.tag);
        let s = s0;
        const each: Term[][] = [];
        const goals: Goal[] = [];
        for (const side of sides) {
          const [fs, s2] = freshVars(s, n);
          s = s2;
          each.push(fs);
          goals.push(eq(side, dataT(shape.tag, fs)));
        }
        if (id === S.total) {
          // ((p0 + p1) + p2) + …, the order the evaluator adds in.
          let acc: Term = each[0][0];
          for (let i = 1; i < n; i++) {
            const [[t], s2] = i === n - 1 ? [[out as LVar], s] : freshVars(s, 1);
            s = s2;
            goals.push(apply(add, [acc, each[0][i]], t));
            acc = t;
          }
          if (n === 1) goals.push(eq(out, acc));
        } else {
          const f = walk(args[0], s);
          const ins = each.slice(0, -1), outs = each[each.length - 1];
          for (let i = 0; i < n; i++) goals.push(apply(f, ins.map((fs) => fs[i]), outs[i]));
        }
        return conj(...goals)(s);
      },
    });
  }

  function aggregate(id: Id, args: Term[], out: Term): Goal {
    return wait({
      k: "later", text: id === S.first ? "first" : id === S.all ? "all" : id === S.optional ? "optional" : "count", on: [args[0]], ready: (s) => known(args[0], s), then: (s) => {
        const body = walk(args[0], s);
        const [[r], inner] = freshVars(s, 1);
        const answers: Term[] = [];
        for (const t of pull(apply(body, [], r)(inner))) {
          if (t.waits.length || t.asleep?.waits) continue;
          const v = ground(r, t);
          if (v === undefined) continue;
          answers.push(v);
          if (id === S.first || id === S.optional) break;
        }
        if (id === S.first) return answers.length ? eq(out, answers[0])(s) : apply(walk(args[1], s), [], out)(s);
        if (id === S.optional) return eq(out, answers.length ? dataT(SOME, [answers[0]]) : dataT(NONE, []))(s);
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

  // fn as a relation over named ports. A function's ports are its params
  // (by binder id, or position for a builtin) and "out". A numeric builtin
  // contributes its equation.
  function relationGoal(fn: Id, at: Record<string, Term>, mode?: Mode): Goal {
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
        return apply({ k: "closure", lambda: body.id, env: new Map() }, args, port("out"), mode)(s);
      }
      if (isFunctionBuiltin(code, fn)) {
        return builtin(fn, Array.from({ length: arity(fn) }, (_, i) => port(String(i))), port("out"))(s);
      }
      const rel = relationFor(code, fn).rel as unknown as { ports: string[]; vars: string[]; eqs: Eq[] };
      const names = new Map<string, Expr>();
      for (const x of rel.vars) {
        if (rel.ports.includes(x)) { const e = toExpr(port(x), s); if (!e) return null; names.set(x, e); }
        else { const [[y], s2] = freshVars(s, 1); s = s2; names.set(x, evar(`?${y.n}`) as Expr); }
      }
      const rename = (e: Expr): Expr => e.k === "var" ? names.get(e.name!) ?? e : e.k === "call" ? { ...e, args: e.args!.map(rename) } : e;
      return settle({ ...s, eqs: [...s.eqs, ...rel.eqs.map((e) => ({ lhs: rename(e.lhs), rhs: rename(e.rhs) }))] });
    };
  }

  return { apply, relationGoal };
}

const arity = (fn: Id) => { const t = SIGS[fn]?.(new Subst()); return t?.t === "fn" ? t.params.length : 0; };

// Builtins that are functions with no equations to give the solver: text,
// comparisons, choice. Numeric builtins go to the solver.
function isFunctionBuiltin(code: Code, fn: Id): boolean {
  return code.nodes[fn].kind === "builtin" && !NUMERIC[fn];
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
  const start: State = { sub: new Sub(), eqs: [], waits: [], next: 0, spend: opts.spend };
  const ports = portsOf(code, fn, Object.keys(known));
  const [vs, s] = freshVars(start, ports.length);
  ports.forEach((p, i) => { if (!(p in at)) at[p] = vs[i]; });
  for (const st of pull(it.relationGoal(fn, at)(s))) {
    const values = Object.fromEntries(ports.map((p) => [p, deep(at[p], st)]));
    const name = (n: number) => `_${n}`;
    const shown = (e: Expr): string => eshow(rn(e));
    const rn = (e: Expr): Expr => e.k === "var" && e.name!.startsWith("?") ? evar(name(+e.name!.slice(1))) as Expr : e.k === "call" ? { ...e, args: e.args!.map(rn) } : e;
    // An unknown that is a port is written as the port's name; a number
    // next to it gets its · back (the solver writes 5x).
    const portOf = new Map<number, string>();
    for (const p of ports) { const v = values[p]; if (v instanceof LVar && !portOf.has(v.n)) portOf.set(v.n, p === "out" ? "result" : opts.names?.[p] ?? p); }
    const named = (t: string) => powers(t.replace(/(\d)(_\d+)/g, "$1 · $2").replace(/_(\d+)/g, (m, n) => portOf.get(+n) ?? m));
    const residual = [
      ...tidy(everyEq(st), values).map((e) => `${shown(e.lhs)} = ${shown(e.rhs)}`),
      ...everyWait(st).map((w) => w.k === "test" || w.k === "compute" ? `${w.text}(${w.args.map((a) => showTerm(deep(a, st))).join(", ")})` : w.k === "later" ? w.text : w.k),
    ].map(named);
    yield { values, free: ports.filter((p) => hasVars(values[p])), residual };
  }
}

// Does some value make f true? This is `for some` run forward.
export function satisfiable(code: Code, f: unknown, opts: Options = {}): boolean {
  const it = interpreter(code, opts);
  const [[x], s] = freshVars({ sub: new Sub(), eqs: [], waits: [], next: 0, spend: opts.spend }, 1);
  for (const _ of pull(it.apply(fromValue(f), [x], boolT(true))(s))) return true;
  return false;
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
  return relationFor(code, fn).rel.ports;
}

// The solver writes x^2; the editor writes x², like units do.
export const powers = (t: string) => t.replace(/\^(\d+)(?![.\d])/g, (_, d: string) => d.split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c]).join(""));

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

