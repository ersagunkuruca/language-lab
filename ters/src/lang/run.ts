// The evaluator for the typed core, effects included.
//
// Every expression evaluates to a lazy stream of results. Pure code produces
// exactly one. `one of` produces several, `fail` none, and a call runs its
// function once for every combination of results of its parts, in order.
// That is all Choice is: backtracking search, the same as the relation
// solver's branches (canonical first, more on demand). The handlers just
// consume the stream: `first` takes the first result (or runs the fallback),
// `all` collects, `count` counts, `optional` keeps the first as data.
// Diverge is handled by the runtime, or turned into failure by `with fuel`.
//
// Effects a program defines are performed by calling an operation, and
// handled by a match on the operations (infer.ts `handle`): performing
// looks up the continuation for the nearest such match. The world effects
// (Console, Files) have one handler, the runtime's `World`; Log, Abort,
// Random, Time and Wait, when nothing in the program handles them, go to it too.

import { bytesValue, plainBytes } from "./bytes.ts";
import { plainRequest, responseValue, type PlainRequest, type PlainResponse } from "./network.ts";
import { bordered } from "./border.ts";
import { answerKeys, givenInOrder } from "./ports.ts";
import { dependencies, subtree, type Code, type Id, type NodeOf, type Use, useTarget, isCall, type Call, isUse, bindsOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl, preludeNames } from "../prelude.ts";
import { PRELUDE_DEFS } from "./prelude-ids.ts";
import { readByDescent } from "./descent.ts";
import type { Info } from "./infer.ts";
import { derivativeLambda, gradientLambda } from "./derive.ts";
import { fieldShapes, shapeOf, spread, type Shape } from "./nested.ts";
import { resolveArithmetic } from "./arith.ts";
import { worldTimers } from "./timers.ts";
import { relate, satisfiable, toValue, type Reading } from "./relate.ts";
import { planSolve, solutions } from "./solve.ts";
import { oneAnswer } from "./modes.ts";
import { computedForward } from "./directions.ts";
import { discharge } from "./ledger.ts";
import * as Alg from "./algebraic.ts";
import { hostLocale, hostZone } from "./text.ts";
import { SIGS, ArrayView, FILE_OPS, KEPT_FILES, tupleVariant, floatText, LOCALE_V, MY_LOCALE_OP, MY_ZONE_OP, RELEASE_V, SETTINGS, WORLD_OPS, EXTENDED_V, ALGEBRAIC_V, ARRAY_TAG, ABORT, ABORT_OP, CELL_OPS, COMPARE, CONS, FALSE, HTML, IO, LOG, LOG_OP, CHECK_OP, NIL, NONE, NOW_OP, ORDER_V, RANDOM, RANDOM_OP, S, SET, SHOW_ANY, shownImplementations, implementationsOf, ORDERED, CASE_NAME, SOME, STD_IMPL, STD_MANY, stdNames, TIME, TRUE, UNIT_V, WAIT, WAIT_OP, AWAIT, AWAIT_OP, START_TIMER_OP, TICKET_V } from "./std.ts";
import { intLit } from "./int.ts";
import { answerFromHost, effectOfOperation, hostedEffects, pureEffect, pureHosts, stdHosted, type Hosts } from "./hosts.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import { Cells, NoValue, Pending, changeAt, listEdits, nodeOf, pathValue, stepsOf } from "./cells.ts";
import { seededGenerator, worldRandom, type Generator as RandomGenerator } from "./random.ts";
import { fieldIndex, fieldPath, placePath, setPath } from "./records.ts";
import { CELLS, CHOICE, DIVERGE, INT, NETWORK, Subst, WORLD, type Type } from "./types.ts";

export interface Data { tag: Id; fields: Value[] }
export type Fn = (...args: Value[]) => Iterable<Value>;
// An Int is a number while it's a safe integer, a bigint beyond (int.ts).
export type Value = number | bigint | string | Data | Fn;

export const bool = (b: boolean): Data => ({ tag: b ? TRUE : FALSE, fields: [] });
export const unit: Data = { tag: UNIT_V, fields: [] };
export const toList = (xs: Value[]): Data => xs.reduceRight<Data>((tail, x) => ({ tag: CONS, fields: [x, tail] }), { tag: NIL, fields: [] });
export function fromList(v: Value): Value[] {
  const out: Value[] = [];
  for (let d = v as Data; d.tag === CONS; d = d.fields[1] as Data) out.push(d.fields[0]);
  return out;
}
const LISTS = { from: fromList, to: toList as (xs: Value[]) => Value };
// What each needs to hand its rows tracked views (cells.ts, L99).
const LIST_VIEWS = { cons: CONS, nil: NIL, isList: (v: Value) => typeof v === "object" && (v.tag === CONS || v.tag === NIL) };
// The evaluator's lists with them, as Cells compares values by (C162).
export const LIST_SHAPE = { ...LISTS, views: LIST_VIEWS };

// Cells' operations on a handler (cells.ts), by builtin id, for every
// runner of a program's values: the evaluator's here, and JavaScript
// printed from the core IR (compiler/src/core-js.ts). `call` runs a
// function the program gave and answers its value, or throws NoValue. A
// read with no answer (a formula that gave none, or no item at a place)
// is undefined. `path` is the evaluator's alone: it looks inside the
// function it is given.
export function cellOps(cells: Cells, call: (f: Value, ...xs: Value[]) => Value): Record<Id, (...xs: Value[]) => Value | undefined> {
  const listsHere = LIST_SHAPE;
  const noValue = (f: () => Value) => { try { return f(); } catch (e) { if (e instanceof NoValue) return undefined; throw e; } };
  return {
    [CELL_OPS.cell]: (v) => cells.cell(v),
    [CELL_OPS.formula]: (f) => cells.formula(() => call(f)),
    [CELL_OPS.each]: (items, f) => cells.each(items, (x) => call(f, x), listsHere),
    [CELL_OPS.eachOf]: (items, f) => cells.eachOf(items, (x) => call(f, x), listsHere),
    // A formula that gave no value (it ran out of `with fuel`) is a read
    // with no answer; it is computed again at the next read.
    [CELL_OPS.read]: (c) => noValue(() => cells.read(c)),
    [CELL_OPS.write]: (c, v) => (cells.write(c, v), unit),
    [CELL_OPS.itemPath]: (p, i) => pathValue([...stepsOf(p)!, { item: Number(i) }]),
    [CELL_OPS.thenPath]: (p, q) => pathValue([...stepsOf(p)!, ...stepsOf(q)!]),
    [CELL_OPS.keyPath]: (p, by, k) => pathValue([...stepsOf(p)!, { key: k, by: stepsOf(by)! }]),
    [CELL_OPS.readAt]: (c, p) => noValue(() => cells.readAt(c, stepsOf(p)!, LISTS) as Value),
    [CELL_OPS.writeAt]: (c, p, v) => (cells.edit(c, stepsOf(p)!, () => v, LISTS), unit),
    [CELL_OPS.changed]: (v, p, x) => changeAt(v, stepsOf(p)!, () => x, LISTS),
    [CELL_OPS.insertAt]: (c, p, i, v) => (cells.edit(c, stepsOf(p)!, (l) => toList(listEdits.insert(fromList(l), Number(i), v)), LISTS, { at: stepsOf(p)!, kind: "insert", i: Number(i) }), unit),
    [CELL_OPS.removeAt]: (c, p, i) => (cells.edit(c, stepsOf(p)!, (l) => { const xs = listEdits.remove(fromList(l), Number(i)); return xs && toList(xs); }, LISTS, { at: stepsOf(p)!, kind: "remove", i: Number(i) }), unit),
    [CELL_OPS.moveAt]: (c, p, a, b) => (cells.edit(c, stepsOf(p)!, (l) => { const xs = listEdits.move(fromList(l), Number(a), Number(b)); return xs && toList(xs); }, LISTS, { at: stepsOf(p)!, kind: "move", from: Number(a), to: Number(b) }), unit),
  };
}

// Whether a solve has exactly one answer (oneAnswer, MODES.md), or results
// each computed from the inputs (directions.ts): its first is the answer.
export const solvesOnce = (code: Code, n: Use): boolean => (planSolve(code, n).mode === "relational" ? oneAnswer(code, n) : computedForward(code, n));
// A solve's answers (a relation run some way, L41): each the values of
// its binds, in order. A relation run backwards is the relational
// interpreter's (relate.ts); one the solver plans, its equations' (solve.ts).
// The evaluator's, and JavaScript printed from the core IR's (core-js.ts).
const PRELUDE_NAMES = { ...preludeNames, ...Object.fromEntries(Object.entries(PRELUDE_DEFS).map(([k, v]) => [v, k])) };
export function* solveAnswers(code: Code, n: Use, known: Record<string, unknown>, opts: { spend?: () => boolean; names?: Names; stuck?: (r: Reading) => void; info?: Info; shown?: (v: Data) => string | undefined; ordered?: (x: Data, y: Data) => number | undefined } = {}): Generator<Value[]> {
  const p = planSolve(code, n);
  if (p.mode === "relational") {
    // A printer run backwards reads by descent, in one pass (C110 s6),
    // and says where a line with no reading stopped (L70c).
    const read = readByDescent(code, n, known, { ...PRELUDE_NAMES, ...opts.names }, opts.stuck);
    if (read) { yield* read; return; }
    for (const sol of relate(code, useTarget(code.nodes, n), known, opts)) {
      const bound = answerKeys(code, n).map((k) => toValue(sol.values[k]));
      if (bound.some((v) => v === undefined)) continue; // not pinned down: not an answer
      yield bound as Value[];
    }
    return;
  }
  // A predicate's out = true isn't one of the solver's ports.
  const values = Object.fromEntries(p.known.map((k) => [k, known[k] as number]));
  for (const sol of solutions(p.rel!, values)) {
    // A port the equations leave free has no value: not a solution.
    if (answerKeys(code, n).some((k) => sol[k] === null || sol[k] === undefined)) continue;
    yield answerKeys(code, n).map((k) => sol[k]!);
  }
}

// Two numbers near enough that the solver takes one for the other when it
// checks an answer it found (relate.ts unify): floats only approximate
// reals, and √2 squared is 2.0000000000000004. `equal` is exact
// (`sameNumber` below); this tolerance is the solver's alone (L197).
// Only a finite gap is near: past the largest float the tolerance itself is
// ∞, which would make ∞ equal to −∞, and 1e308 to ∞ (BACKLOG L81).
export const close = (a: number, b: number) => {
  const gap = Math.abs(a - b);
  return a === b || (gap < Infinity && gap <= 1e-9 * (1 + Math.abs(a) + Math.abs(b)));
};

// How `equal` compares two numbers, one rule for every type, whichever way
// a program runs: the evaluator and compiled (runtime.js $sameNumber, and
// scalar.ts for WASM and the GPU). Exactly, as `compare` orders them and
// map keys are told apart (Ersagun's decision 2026-11-03, SPEC.md S1,
// L197). It used to be within `close`, which isn't transitive, so it
// wasn't an equivalence on Float64s and disagreed with `compare`. The
// tolerance stays where the solver checks an answer it found (relate.ts
// unify). NOTES.md "Equality".
export const sameNumber = (a: number, b: number) => a === b;
// The program's `equal`: an overflow reaching it stops (SPEC §3.3, L218),
// comparing is a use. The runtime's own comparisons (a cell written back
// with what it holds) aren't the program's, and don't stop.
export const usedSameNumber = (a: number, b: number) => (a - a !== 0 || b - b !== 0 ? overflowed() : a === b);

// With its own stack, so two long lists can be compared.
export function equal(a: Value, b: Value, same = sameNumber): boolean {
  const todo: [Value, Value][] = [[a, b]];
  for (let p; (p = todo.pop());) {
    const [x, y] = p;
    if (typeof x === "number" && typeof y === "number") { if (!same(x, y)) return false; continue; }
    if (typeof x !== "object" || typeof y !== "object") { if (x !== y) return false; continue; }
    // The same value on both sides is equal to itself, whatever is inside
    // (a cell written back with what it holds, C85).
    if (x === y) continue;
    if (x.tag !== y.tag) return false;
    // Arrays of different lengths, told apart before their items are
    // copied out (an array's first field is its length).
    if (x instanceof ArrayView && y instanceof ArrayView && x.n !== y.n) return false;
    for (let i = x.fields.length - 1; i >= 0; i--) todo.push([x.fields[i], y.fields[i]]);
  }
  return true;
}

// How two Float64s are ordered: exactly, and totally. Unlike `equal`'s
// nearness this is an order a sorted list, a set or a map's keys can rely
// on (REVIEW-2026-10-26.md §1.1): every Float64 is before, the same as or
// after every other, and "the same" is transitive. −0 and 0 are the same,
// unlike IEEE 754's totalOrder, because `equal` says so and nothing a
// program does tells them apart. Every Float64 is finite (L125a); compiled
// code checks an overflow late, and this is one of the places (L125c).
export const numberOrder = (a: number, b: number): number =>
  a - a !== 0 || b - b !== 0 ? overflowed() : a < b ? -1 : a > b ? 1 : 0;
// An overflow compiled code finds late (L125c), as the evaluator's
// finiteFloat would have said at the operation.
export const overflowed = (): never => { throw new Aborted("the answer is too big for a Float64 (overflow)"); };

// The order on plain data (L66): numbers by value (Int and Float64;
// Float64 exactly, numberOrder), text by code point, a value of a type with
// an Ordered implementation by its `less` (`by`, the runner's orderedBy:
// Rational and Algebraic are the prelude's, L204g; stdOrdered without one, Algebraic only), and other cases by
// their declaration order (`order`: a variant's place in its type,
// variantOrder), then their fields left to right, so lists go
// lexicographically with [] first. OCaml's `compare` and Erlang's term
// order (prior art). -1, 0 or 1. Where `equal` is near on Float64s, this
// is exact: 0.1 + 0.2 is after 0.3, and equal to it.
export function compareValues(a: Value, b: Value, order: Map<Id, number>, by: (x: Data, y: Data) => number | undefined = stdOrdered): number {
  const todo: [Value, Value][] = [[a, b]];
  for (let p; (p = todo.pop());) {
    const [x, y] = p;
    if (typeof x === "number" && typeof y === "number") { const c = numberOrder(x, y); if (c) return c; continue; }
    if (typeof x === "bigint" || typeof y === "bigint") { if (x !== y) return (x as bigint) < (y as bigint) ? -1 : 1; continue; }
    if (typeof x === "string" && typeof y === "string") { if (x !== y) return T.less(x, y) ? -1 : 1; continue; }
    if (typeof x !== "object" || typeof y !== "object") continue;
    const c = by(x, y);
    if (c !== undefined) { if (c) return c; continue; }
    if (x.tag !== y.tag) return (order.get(x.tag) ?? 0) < (order.get(y.tag) ?? 0) ? -1 : 1;
    for (let i = x.fields.length - 1; i >= 0; i--) todo.push([x.fields[i], y.fields[i]]);
  }
  return 0;
}

// Algebraic's order where no runner's orderedBy is given, the same as the
// prelude's implementation. Rational has none here: its order is its
// Ordered implementation's (L207f2), as a module's type's is.
export function stdOrdered(x: Data, y: Data): number | undefined {
  if (x.tag === ALGEBRAIC_V && y.tag === ALGEBRAIC_V) return Alg.compare(algebraicOf(x), algebraicOf(y));
  return undefined;
}

// An Algebraic value as algebraic.ts reads it.
const algebraicOf = (v: Data): Alg.Algebraic => ({ p: fromList(v.fields[0]).map((c) => BigInt(c as I.Int)), k: Number(v.fields[1]) });

// Each case's place in its type, for compareValues.
export function variantOrder(code: Code): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const n of Object.values(code.nodes)) if (n.kind === "typedef") n.variants.forEach((v, i) => out.set(v, i));
  return out;
}
export const ORDER_VALUES = [ORDER_V.before, ORDER_V.same, ORDER_V.after].map((tag) => ({ tag, fields: [] as Value[] }));

// Function values remember the node they came from (a lambda and the
// variables it closed over, or a builtin, constructor or projection), so the
// relational interpreter and `derivative` can look inside them.
export const META = Symbol("node");
const tag = <F extends Fn>(f: F, meta: { lambda: Id; readonly env: Map<Id, Value> } | { prim: Id }): F => Object.assign(f, { [META]: meta });

interface Fuel { left: number }

// A page runs each update (a view, a text, a handler) under a step budget:
// the same count as `with fuel` (one per call into a definition the checker
// couldn't prove ends), outside any `with fuel`. Running out isn't a
// failure the program can catch, as `with fuel`'s is; the update stops and
// the page says so. The compiled runtime spends from the same budget.
export class OutOfSteps extends Error {
  constructor() { super("didn't finish"); }
}
export const PAGE_STEPS = 1_000_000;
let page: Fuel | null = null;
// Compiled code's count of deep calls (compiler/src/runtime.js, $rec):
// put back after each update, which may have been cut off midway.
export const depth = { d: 0 };
export function withSteps<T>(n: number, f: () => T): T {
  const saved = page, d = depth.d;
  page = { left: n };
  try { return f(); } finally { page = saved; depth.d = d; }
}
// One step outside any `with fuel`: free, except under a page's budget.
export const spendStep = () => { if (page && --page.left < 0) throw new OutOfSteps(); };
// A page's budget as it is now (null: none), and set (C61 c′: what a
// map's runs on workers spent comes off it).
export const stepsLeft = (): number | null => (page ? page.left : null);
export const setStepsLeft = (n: number): void => { if (page) page.left = n; };
// f under a budget of n steps of its own, `used` told how many it spent,
// whether it ends, aborts or runs out (C61 c′: a run on a page's worker).
export function counted<T>(n: number, f: () => T, used: { n: number }): T {
  const saved = page, d = depth.d, fuel = { left: n };
  page = fuel;
  try { return f(); } finally { used.n = n - fuel.left; page = saved; depth.d = d; }
}
// The variables in scope, as a linked list: binding one more shares the
// rest, so a call costs one cell per parameter, not a copy of the scope.
type Env = { b: Id; v: Value; up: Env } | null;
const lookup = (env: Env, b: Id): Value | undefined => {
  for (let e = env; e; e = e.up) if (e.b === b) return e.v;
  return undefined;
};
// What a closure says it is (META): its lambda, and its scope as a map,
// made only when asked. A class, not an object with a getter per closure:
// making those was most of the cost of making a closure (L118c). It is
// also what the evaluator runs the closure by: its node and its scope.
class LambdaMeta {
  readonly lambda: Id;
  readonly node: NodeOf<"lambda">;
  readonly scope: Env;
  // The runner that made it: another runner's closure (main's run's
  // derivative, passed to a helper's Run) is called as a function, since
  // its nodes may not be this runner's (I196).
  readonly by: object;
  constructor(node: NodeOf<"lambda">, scope: Env, by: object) { this.lambda = node.id; this.node = node; this.scope = scope; this.by = by; }
  get env() { return toMap(this.scope); }
}
const toMap = (env: Env) => {
  const out = new Map<Id, Value>(), cells: { b: Id; v: Value }[] = [];
  for (let e = env; e; e = e.up) cells.push(e);
  for (let i = cells.length - 1; i >= 0; i--) out.set(cells[i].b, cells[i].v);
  return out;
};
const fromMap = (m: Map<Id, Value>): Env => { let e: Env = null; for (const [b, v] of m) e = { b, v, up: e }; return e; };
interface HandlerFrame { t: "handler"; h: Id; acc: Value[]; otherwise: Value; base: number; fuel: Fuel | null; next: Frame | null }
// A match handling an effect, waiting for its computation. `base`: the
// choice points there were when it started, which an operation that never
// returns cuts back to.
// `release`: its release case (L213a), run once when it ends.
// A named handler's name (L213b): what its binder holds while the handled
// computation runs, the token an operation given it is answered by.
class HandlerName {}
interface HandleFrame { t: "handle"; effect: Id; arms: Map<Id, NodeOf<"arm">>; done: Id | null; release: NodeOf<"arm"> | null; env: Env; base: number; fuel: Fuel | null; next: Frame | null; name?: HandlerName }
// An arm of a fold: the fields with folded values, and whether each holds
// the type nested in a container (List Tree) rather than directly.
interface FoldArm { arm: NodeOf<"arm">; rec: number[]; nested: boolean[]; shapes: (Shape | null)[] }
interface FoldCtx { arms: Map<Id, FoldArm>; env: Env }
// The children of one value to fold first, and how their results become
// the arm's folded values.
interface Kids { kids: Data[]; folded: (results: Value[]) => Value[] }
// The children folded so far, newest first. Shared, not copied, between the
// frames that wait for the next child, so a value with n children costs n
// steps, not n² (a choice may resume a frame more than once).
type Done = { v: Value; n: number; up: Done } | null
type Frame = { next: Frame | null } & (
  | { t: "parts"; ids: Id[]; i: number; vals: Value[]; env: Env; n: Call | Use }
  | { t: "match"; n: NodeOf<"match">; env: Env }
  | { t: "fold"; n: NodeOf<"fold">; env: Env }
  | { t: "foldChild"; ctx: FoldCtx; d: Data; arm: FoldArm; kids: Kids; results: Done }
  | { t: "fuelExit"; saved: Fuel | null }
  // `seeded`: answers Random's `random()` from its generator.
  | { t: "seeded"; effect: Id; gen: RandomGenerator }
  // A handler's answer on its way back to where the operation was
  // performed. Looking for a handler from here skips to outside `handler`:
  // a case runs outside the match it belongs to.
  | { t: "answer"; handler: HandleFrame }
  // A handler's release on its way (L213a): `release` runs `body` and then
  // gives what came to it (`keep`); `seq` runs `body` after what came
  // before, the value dropped, a release itself when `release` is set.
  | { t: "release"; body: Id; env: Env }
  | { t: "keep"; v: Value }
  | { t: "seq"; body: Id; env: Env; release: boolean }
  | HandlerFrame
  | HandleFrame
);
type Choice = { barrier: HandlerFrame } | { it: Iterator<unknown>; k: Frame | null; fuel: Fuel | null; use: (x: unknown) => void };

export interface Runtime {
  print: (line: string) => void;
  // The names `show` prints cases with; std's if not given.
  names?: Names;
  // The rest of the world, for programs that use it (world.ts has Node's).
  // Without one, those operations abort saying so.
  world?: Partial<World>;
  // The handler of Cells (cells.ts). Without one, each run gets its own,
  // which still computes formulas on demand and remembers them.
  cells?: Cells;
  // false runs every library definition as written, never its host way
  // (library/hosts.ts, L206); test/jets.test.ts compares the two.
  libraryHosts?: boolean;
  // Told each time a function written as a lambda is called, with the
  // values it's called with (the editor seeds a definition's Run with them).
  // `copy`: the lambda entered, when it's a copy at another number type.
  entered?: (lambda: Id, args: Value[], copy: Id) => void;
  // Check's handler when the program has none (`ters test`, tests.ts):
  // each expect, whether it held, and what it says.
  check?: (holds: boolean, what: string) => void;
  // Told when a function run backwards from a known text finds no
  // reading, how far it got (L70c, relate.ts Reading; stuckReading words
  // it): the editor marks the place in the text.
  stuck?: (r: Reading) => void;
  // The host's answers to the program's own effects (hosts.ts, FOREIGN.md):
  // hosts/js.js's default export, by operation id.
  hosts?: Hosts;
}

// What the world effects do. A failure throws, with a message that becomes
// the reason the program's Abort is given.
export interface World {
  error(line: string): void;
  // Log's handler when the program has none.
  log(line: string): void;
  input(): string;
  readLine(): string | null;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  appendFile(path: string, text: string): void;
  fileExists(path: string): boolean;
  listFolder(path: string): string[];
  // A file's bytes as they are, and bytes written (L189c, bytes.ts).
  readBytes?(path: string): Uint8Array;
  writeBytes?(path: string, bytes: Uint8Array): void;
  // A file kept open by `with open file` (L213c): opened for reading from
  // its start and adding lines at its end (created if it isn't there), by
  // a number; its next line without the line break, null at the end.
  openFile?(path: string): number;
  fileLine?(file: number): string | null;
  fileAddLine?(file: number, text: string): void;
  // Its next count bytes from where the reading is (fewer at the end,
  // none after), lines and bytes read from one place, and bytes added at
  // its end (L213c2).
  fileBytes?(file: number, count: number): Uint8Array | null;
  fileAddBytes?(file: number, bytes: Uint8Array): void;
  closeFile?(file: number): void;
  // Random's answer when the program has no handler: a Float64 in [0, 1).
  random(): number;
  // The seed, 32 bits, of the generator a compiled program draws Random's
  // numbers from (C136), asked at its first draw. A world without it gives
  // the host's; one that has it gets the seed logged (C172c, C172d).
  randomSeed?(): number;
  // Settings' (L214b2): the user's language as a BCP 47 tag. A world
  // without one answers the host's (Intl).
  locale?(): string;
  // And the user's time zone, an IANA name (L188d2).
  timeZone?(): string;
  // Time's and Wait's: milliseconds since 1970, and pausing.
  now(): number;
  wait(ms: number): void;
  // Network's: the body of a GET, once per address (the world remembers).
  fetchText(url: string): string;
  // A GET started in the background (L150b): what to ask, later, for its
  // body, its failure, or null while it is on its way. A world without it
  // fetches when the fetch starts.
  startFetch?(url: string): () => { text: string } | { error: string } | null;
  // A request with its method, headers and body, and its response (L191),
  // once per request (the world remembers).
  sendRequest?(request: PlainRequest): PlainResponse;
}

// An Abort that nothing in the program handled.
export class Aborted extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

// A Float64 operation's answer, which must be finite (L125a). Why there
// is none, when it isn't: no answer mathematically (x / 0, the square root
// of a negative), or one too big to hold (overflow).
export function noAnswer(op: string, args: number[]): string | null {
  const [a, b] = args;
  return op === "div" && b === 0 ? "x / 0 has no answer"
    : op === "mod" && b === 0 ? "x mod 0 has no answer"
    : op === "sqrt" && a < 0 ? "the square root of a negative number has no answer"
    : op === "log" && a <= 0 ? "the log of 0 or less has no answer"
    : op === "pow" && a === 0 && b < 0 ? "0 to a negative power has no answer"
    : op === "pow" && a < 0 && !Number.isInteger(b) ? "a negative number to a fractional power has no answer"
    : null;
}
// The answers of a Float64 operation: none where it has none (`/`, `sqrt`,
// `log`, `^` and `mod` carry Choice for it, L125b). An overflow stops the
// program only when its value is used (SPEC §3.3, Ersagun 2026-11-03,
// L218): until then it is carried as IEEE's ∞ or NaN, which + − · keep,
// so an overflow nothing uses never stops, on any engine. An operation
// that would turn one back into a finite number (1 / ∞, exp(−∞), 0 · ∞'s
// neighbours, ∞ mod x) uses it, and so do comparing, showing and
// converting (sameNumber, numberOrder, showValue). The stop is one no
// handler catches (R8 §1, L166).
export function finiteFloat(op: string, r: number, args: number[]): Iterable<number> {
  // Only numbers are carried: anything else here (a fraction where the
  // definition, as written, adds Float64s) is a wrong input, a stop.
  if (!args.every((x) => typeof x === "number")) throw new Aborted("a Float64 operation was given something that isn't a Float64");
  if (Number.isFinite(r)) return args.every((x) => x - x === 0) ? [r] : overflowed();
  if (args.every((x) => x - x === 0) && noAnswer(op, args)) return [];
  return [r];
}

// resolveArithmetic's answer for a version of the code and its check: the
// editor makes a runner for each of a definition's traces when it opens
// (its values, main's run for its seed, a backward search), and resolving
// calc took about a second each time (I158). What it gives isn't changed
// after (makeRunner copies the nodes before writing).
// Keyed by the program and its check only: the names change only the
// wording of a refusal (thrown, so not kept) and the names it gives back,
// which no caller here reads.
const resolved = new WeakMap<Code, WeakMap<Info, { code: Code; info: Info }>>();
export function resolvedFor(code: Code, info: Info, names: Names | undefined): { code: Code; info: Info } {
  let byInfo = resolved.get(code);
  if (!byInfo) resolved.set(code, (byInfo = new WeakMap()));
  let r = byInfo.get(info);
  if (!r) { const { code: c, info: i } = resolveArithmetic(code, info, names ?? {}); byInfo.set(info, (r = { code: c, info: i })); resolvedAlready(c, i); }
  return r;
}
// A program resolved already, or made from one without new arithmetic
// (relate.ts `filled` binds a bare use's ports), resolves to itself:
// resolving it again found nothing to do, after scanning every node of it
// and the library (T14i: 150 ms for each search's runner in swapAndUndo).
// What resolvedFor has for this version of the code and its check, if it
// has worked it out (or been told it is resolved already).
export const resolvedKnown = (code: Code, info: Info | undefined): { code: Code; info: Info } | undefined => (info ? resolved.get(code)?.get(info) : undefined);
export function resolvedAlready(code: Code, info: Info): void {
  let byInfo = resolved.get(code);
  if (!byInfo) resolved.set(code, (byInfo = new WeakMap()));
  if (!byInfo.has(info)) byInfo.set(info, { code, info });
}

export function makeRunner(code: Code, info: Info, rt: Runtime) {
  // Whether a handler with a release has been entered (L213a): until one
  // is, a failure has no releases to look for on its way out.
  let releasing = false;
  // The generic + resolved to each type's own (arith.ts); a program
  // without one is unchanged.
  ({ code, info } = resolvedFor(code, info, rt.names));
  // A copy at another number type is entered as the lambda it copies.
  const copyOf = info.copyOf;
  // `derivative` writes new code into our own copy of the node table, made
  // when it first does (copying every node for each runner was 20 ms, and
  // the editor makes several when a definition opens). A solve written in
  // the program is read on the code as resolved, which every run shares,
  // so what is worked out about it once (its mode, modes.ts solveMode; its
  // plans) is kept between runs (I179: opening board's `stage from key`
  // worked its modes out again, 0.1 s).
  const shared = code;
  // Whether a derivative has written new nodes into the copy, which the
  // check doesn't have.
  let wrote = false;
  const writable = () => {
    if (wrote) return;
    wrote = true;
    code = { nodes: { ...code.nodes }, defs: code.defs };
    // It is resolved: a solve inside the run (relate.ts interpreter) reads
    // this copy, and resolving it again walked every node twice a solve
    // (I176: about 1.2 s opening board's `stage from key`).
    resolvedAlready(code, info);
  };
  const defs = new Map<Id, Value>();
  const one = (x: Value): Iterable<Value> => [x];
  // Closures made by this runner, so the machine can enter them directly
  // instead of calling them as JS functions.
  const mine = {};
  const closureOf = (f: Value): LambdaMeta | undefined => { const m = typeof f === "function" ? (f as unknown as Record<symbol, unknown>)[META] : undefined; return m instanceof LambdaMeta && m.by === mine ? m : undefined; };
  // The innermost `with fuel` frame, for code the machine calls out to (a
  // builtin that calls back in): each machine starts from it.
  let ambient: Fuel | null = null;

  const cells = rt.cells ?? new Cells(equal);
  // The one result of a pure function (the parts builtins take only those).
  const only = (f: Fn, ...xs: Value[]): Value => { for (const v of f(...xs)) return v; throw new Error("a pure function gave no value"); };
  // A value of a type with a Shown implementation (std.ts SHOWN, L205)
  // shows through it: the implementation's `show`, run here.
  const showns = shownImplementations(info);
  const shownBy = showns.size ? (v: Data): string | undefined => {
    const d = showns.get(info.owner.get(v.tag) ?? "");
    if (!d) return undefined;
    const show = (refValue(d, null) as Data).fields[0] as Fn;
    for (const t of show(v)) return t as string;
    return undefined;
  } : undefined;
  // A value of a type with an Ordered implementation (std.ts ORDERED,
  // L204g) is ordered by it in `compare`: before when less, after when
  // the other is less, else the same.
  const ordereds = implementationsOf(info, ORDERED);
  const orderedBy = ordereds.size ? (x: Data, y: Data): number | undefined => {
    const d = ordereds.get(info.owner.get(x.tag) ?? "");
    if (!d || info.owner.get(y.tag) !== info.owner.get(x.tag)) return undefined;
    const less = (refValue(d, null) as Data).fields[0] as Fn;
    return (only(less, x, y) as Data).tag === TRUE ? -1 : (only(less, y, x) as Data).tag === TRUE ? 1 : 0;
  } : stdOrdered;
  const builtins: Record<Id, Fn> = {};
  let cmpOrder: Map<Id, number> | undefined;
  // Float64 is the finite floats with one zero (FLOAT-VALUES-2026-11-01.md,
  // L125a, L125b): an operation with no answer at its inputs fails (its
  // Choice), and an overflow is an Abort, performed where it was.
  for (const [op, f] of Object.entries(impl)) builtins[`builtin.${op}`] = op === "atan2"
    ? (y, x) => finiteFloat(op, f((y as number) + 0, (x as number) + 0), [y as number, x as number]) // −0 is 0: atan2(−0, −1) is π
    : (...a) => finiteFloat(op, f(...(a as number[])), a as number[]);
  for (const [id, f] of Object.entries(STD_IMPL)) builtins[id] = id === S.mod || id === S.abs || id === S.floor || id === S.float32
    ? (...a) => finiteFloat(id === S.mod ? "mod" : id, f(...a) as number, a as number[])
    : (...a) => one(f(...a));
  for (const [id, f] of Object.entries(STD_MANY)) builtins[id] = (...a) => f(...a);
  Object.assign(builtins, {
    [S.less]: (a, b) => one(bool(numberOrder(a as number, b as number) < 0)),
    // Showing an overflow uses it (L218).
    [S.show]: (x) => ((x as number) - (x as number) === 0 ? one(floatText(x as number)) : overflowed()),
    [S.stop]: (why) => { throw new Aborted(why as string); },
    [S.equal]: (a, b) => one(bool(equal(a, b, usedSameNumber))),
    [COMPARE]: (a, b) => one(ORDER_VALUES[compareValues(a, b, (cmpOrder ??= variantOrder(code)), orderedBy) + 1]),
    [S.and]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.or]: (a, b) => one(bool((a as Data).tag === TRUE || (b as Data).tag === TRUE)),
    [S.not]: (a) => one(bool((a as Data).tag !== TRUE)),
    [S.range]: (n) => one(toList(Array.from({ length: Math.max(0, n as number) }, (_, i) => i))),
    [S.oneOf]: (xs) => fromList(xs),
    // With the run's own check, which this copy has until a derivative
    // writes nodes into it (I190: each `for some` checked the whole program
    // again, 1.4 s of the editor's 120 ms run of Numbers' main).
    [S.exists]: (f) => one(bool(satisfiable(code, f, wrote ? {} : { info, names: rt.names }))),
    [S.hence]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.fail]: () => [],
    // A record of Float64s, part by part. Float64 is a record of one part.
    [S.mapParts]: (f, r) => one(typeof r === "number" ? only(f as Fn, r) : { tag: (r as Data).tag, fields: (r as Data).fields.map((x) => only(f as Fn, x)) }),
    [S.zipParts]: (f, a, b) => one(typeof a === "number" ? only(f as Fn, a, b) : { tag: (a as Data).tag, fields: (a as Data).fields.map((x, i) => only(f as Fn, x, (b as Data).fields[i])) }),
    [S.unitParts]: (r) => one(typeof r === "number" ? toList([1]) : toList((r as Data).fields.map((_, i) => ({ tag: (r as Data).tag, fields: (r as Data).fields.map((__, j) => (i === j ? 1 : 0)) })))),
    [S.total]: (r) => one(typeof r === "number" ? r : ((r as Data).fields as number[]).reduce((x, y) => x + y)),
    [S.print]: (s) => (rt.print(s as string), one(unit)),
    [IO.printError]: (s) => (world("error")(s as string), one(unit)),
    [IO.readInput]: () => one(world("input")()),
    [IO.readLine]: () => { const l = world("readLine")(); return one(l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l] }); },
    [IO.readFile]: (p) => one(world("readFile")(p as string)),
    [IO.writeFile]: (p, t) => (world("writeFile")(p as string, t as string), one(unit)),
    [IO.appendFile]: (p, t) => (world("appendFile")(p as string, t as string), one(unit)),
    [IO.fileExists]: (p) => one(bool(world("fileExists")(p as string))),
    [IO.listFolder]: (p) => one(toList(world("listFolder")(p as string))),
    [IO.readBytes]: (p) => one(bytesValue(world("readBytes")!(p as string)) as Value),
    [IO.writeBytes]: (p, b) => (world("writeBytes")!(p as string, plainBytes(b)), one(unit)),
    [IO.fetchText]: (u) => one(world("fetchText")(u as string)),
    [IO.sendRequest]: (r) => one(responseValue(world("sendRequest")!(plainRequest(r))) as Value),
    // In the background where the world can (L150b): a ticket ready when
    // the body has come. Otherwise fetched now, so the ticket is ready at
    // once on any clock (L150).
    [IO.startFetch]: (u) => one(rt.world?.startFetch ? timers.fetch(world("startFetch")!(u as string)) : { tag: TICKET_V.timer, fields: [0, world("fetchText")(u as string)] }),
    // Cells' operations (cellOps, below), the evaluator's way: a stream.
    ...Object.fromEntries(Object.entries(cellOps(cells, (f, ...xs) => { for (const v of (f as Fn)(...xs)) return v; throw new NoValue("gave no value"); })).map(([id, f]) => [id, (...xs: Value[]) => { const v = f(...xs); return v === undefined ? [] : one(v); }])),
    // Places and edits at them (L98, cells.ts).
    [CELL_OPS.path]: (get) => {
      const m = (get as unknown as Record<symbol, { lambda?: Id; prim?: Id }>)[META];
      const path = m?.prim ? [m.prim] : m?.lambda ? placePath(code, m.lambda) : null;
      if (!path) throw new Error("path needs a field, a path of fields, or (t) ↦ t");
      return one(pathValue(path.map((f) => ({ field: fieldIndex(code, f) }))));
    },
    [SHOW_ANY]: (v) => one(showValue(v, code, rt.names ?? stdNames, true, shownBy)),
    [CASE_NAME]: (v) => one(caseName(v, rt.names ?? stdNames)),
    [SET]: (get, record, value) => {
      const m = (get as unknown as Record<symbol, { lambda?: Id; prim?: Id }>)[META];
      const path = m?.prim ? [m.prim] : m?.lambda ? fieldPath(code, m.lambda) : null;
      if (!path) throw new Error("set needs a field, or a path of fields");
      return one(setPath(record as Data, path.map((f) => fieldIndex(code, f)), value));
    },
    // The handlers are run by the machine itself (see `apply`); these are
    // for when something outside it calls them.
    [S.all]: function* (body) { yield toList([...(body as Fn)()]); },
    [S.count]: function* (body) { let n = 0; for (const _ of (body as Fn)()) n++; yield n; },
    [S.first]: function* (body, otherwise) {
      for (const x of (body as Fn)()) { yield x; return; }
      yield* (otherwise as Fn)();
    },
    [S.optional]: function* (body) {
      for (const x of (body as Fn)()) { yield { tag: SOME, fields: [x] }; return; }
      yield { tag: NONE, fields: [] };
    },
    [S.fuel]: (n, body) => run((m) => m.handle(S.fuel, [n, body])),
    [S.seeded]: (seed, body) => run((m) => m.handle(S.seeded, [seed, body])),
    // Every function value carries its node, so this can always look inside.
    [S.derivative]: (f) => {
      const m = (f as unknown as Record<symbol, { lambda: Id; env: Map<Id, Value> } | { prim: Id }>)[META];
      writable();
      return run((machine) => machine.eval(derivativeLambda(code, m), fromMap("env" in m ? m.env : new Map())));
    },
    // The record a gradient is over is known once there's a point to take
    // it at; over a Float64 it's the derivative.
    [S.gradient]: (f) => {
      const m = (f as unknown as Record<symbol, { lambda: Id; env: Map<Id, Value> } | { prim: Id }>)[META];
      const env = fromMap("env" in m ? m.env : new Map());
      writable();
      return one(function* (p: Value) {
        const lambda = typeof p === "number" || !("lambda" in m) ? derivativeLambda(code, m) : gradientLambda(code, m, (p as Data).tag);
        for (const g of run((machine) => machine.eval(lambda, env))) yield* (g as Fn)(p);
      } as Fn);
    },
  } satisfies Record<Id, Fn>);
  for (const [id, f] of Object.entries(builtins)) tag(f, { prim: id });
  const HANDLED = new Map<Fn, Id>([S.all, S.count, S.first, S.optional, S.fuel, S.seeded].map((h) => [builtins[h], h]));
  // Builtins that touch the world and can fail: a failure is an Abort,
  // performed where they were called.
  const hosted = hostedEffects(code, rt.hosts);
  const timers = worldTimers((m) => { throw new Aborted(m); });
  const FALLIBLE = new Set<Fn>([...Object.keys(impl).map((op) => `builtin.${op}`), S.mod, S.float32, IO.readFile, IO.writeFile, IO.appendFile, IO.listFolder, IO.readBytes, IO.writeBytes, IO.readInput, IO.readLine, IO.fetchText, IO.startFetch, IO.sendRequest].map((id) => builtins[id]));
  function world<K extends keyof World>(k: K): World[K] {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" || k === "log" ? "write to standard error" : k}`); }) as unknown as World[K];
    return bordered(rt.world!, k, f);
  }
  // Operations of effects, as function values.
  const effectOf = (variant: Id): Id | null => {
    const def = info.owner.get(variant);
    const body = def ? (code.nodes[def] as NodeOf<"def">).body : null;
    return body && (code.nodes[body] as NodeOf<"typedef">).effect ? def! : null;
  };
  const operations = new Map<Fn, Id>();
  const worldOps = new Map<Fn, Id>(Object.entries(WORLD_OPS).map(([b, op]) => [builtins[b], op]));
  // ... and back: an operation performed by name that nothing handles is
  // answered by the world as its builtin is (L145).
  const worldBuiltins = new Map<Id, Fn>(Object.entries(WORLD_OPS).map(([b, op]) => [op, builtins[b]]));
  // The rests of computations whose operation is answered later
  // (ANSWERED-LATER.md): the frames from the perform up to its handler and
  // the choice points made since the handler began, kept as a function
  // value that may be called once.
  interface Rest { top: Frame | null; h: HandleFrame; cps: Choice[]; fuel: Fuel | null; used: boolean; op: Id }
  const rests = new WeakMap<Fn, Rest>();
  const restOf = (r: Rest): Fn => {
    const f = ((...args: Value[]) => run((m) => m.apply(f, args))) as Fn;
    rests.set(f, r);
    return f;
  };

  // ---- running directly (L118c)
  //
  // A function that, as it is called, does nothing but compute (no search,
  // no operation, no handler, nothing of the world) runs as plain
  // JavaScript on the JavaScript stack, not step by step on the machine
  // below: tens of times fewer allocations. It is tried first, and the
  // moment it would need the machine (a choice, a failure, an operation, a
  // handler, a solve, a fold, a builtin that acts on the world, the
  // JavaScript stack running out) it stops, having done nothing anyone can
  // see, and the call starts again on the machine. A function whose type
  // says it does more than compute never tries, and one that keeps
  // stopping stops trying.
  const NEED = new Error("needs the machine");
  // The builtins that only compute (their type's row has at most a choice
  // and diverging: one that gives no value or several stops the run), and
  // the library's host ways, which are pure.
  const pureFns = new Set<Fn>(), pureJets = new WeakSet<Fn>();
  for (const [id, f] of Object.entries(builtins)) {
    const t = SIGS[id]?.(new Subst());
    if (t?.t === "fn" && t.eff.effs.every((e) => e === CHOICE || e === DIVERGE) && !HANDLED.has(f) && !worldOps.has(f)) pureFns.add(f);
  }
  const statically = new Map<Id, boolean>();
  // Whether a lambda's type says it does something besides compute.
  const acts = (n: NodeOf<"lambda">): boolean => {
    let a = statically.get(n.id);
    if (a === undefined) {
      const t0 = info.typeOf?.get(n.id), t = t0 && info.subst.resolve(t0);
      // An Abort too (L118d2): one met stops the direct run, and the
      // machine runs the call again, so the program's handlers see it.
      a = !t || t.t !== "fn" || info.subst.resolveRow(t.eff).effs.some((e) => e !== DIVERGE && e !== ABORT);
      statically.set(n.id, a);
    }
    return a;
  };
  // Tries and stops of each lambda: one that stops often stays on the machine.
  const tries = new Map<Id, { n: number; stops: number }>();
  const machineOnly = new Set<Id>();
  const stopped = (lambda: Id) => {
    const t = tries.get(lambda) ?? { n: 0, stops: 0 };
    t.stops++;
    if (t.stops > 4 && t.stops * 4 > t.n) machineOnly.add(lambda);
  };
  const directly = (n: NodeOf<"lambda">) => !machineOnly.has(n.id) && !acts(n);
  const single = (r: Iterable<Value>): Value => {
    if (Array.isArray(r)) { if (r.length === 1) return r[0]; throw NEED; }
    const it = r[Symbol.iterator](), a = it.next();
    if (a.done || !it.next().done) throw NEED;
    return a.value;
  };
  // How deep in direct runs this is: a machine started inside one (a
  // builtin or host way calling a function back) may act on nothing
  // either, so its world builtins and operations stop the run too, before
  // they act.
  let directDepth = 0;
  const builtinFns = new Set<Fn>(Object.values(builtins));
  const enter = (c: LambdaMeta, args: Value[]): Value => {
    const t = tries.get(c.lambda);
    if (t) t.n++; else tries.set(c.lambda, { n: 1, stops: 0 });
    rt.entered?.(copyOf?.get(c.lambda) ?? c.lambda, args, c.lambda);
    directDepth++;
    try { return direct(c.node.body, bind(c.scope, c.node.params, args)); }
    catch (e) {
      if (e instanceof Aborted && aborts(c.node)) e = NEED;
      if (e === NEED || e instanceof RangeError) stopped(c.lambda);
      throw e;
    }
    finally { directDepth--; }
  };
  // Whether a lambda's row has Abort (an abort in its direct run goes to the machine).
  const aborting = new Map<Id, boolean>();
  const aborts = (n: NodeOf<"lambda">): boolean => {
    let a = aborting.get(n.id);
    if (a === undefined) { const t0 = info.typeOf?.get(n.id), t = t0 && info.subst.resolve(t0); a = !!t && t.t === "fn" && info.subst.resolveRow(t.eff).effs.includes(ABORT); aborting.set(n.id, a); }
    return a;
  };
  const callDirect = (f: Value, args: Value[]): Value => {
    const c = closureOf(f);
    if (c && directly(c.node)) return enter(c, args);
    const h = HANDLED.get(f as Fn);
    if (h && SEARCHES.has(h)) { try { return handledDirect(h, args); } catch (e) { if (e !== NEED && !(e instanceof RangeError)) throw e; } }
    if (pureFns.has(f as Fn) || pureJets.has(f as Fn) || h) {
      let r: Iterable<Value>;
      try { r = (f as Fn)(...args); } catch (e) { if (e instanceof OutOfSteps || e instanceof Aborted) throw e; throw NEED; }
      return single(r);
    }
    // Another function on a machine of its own; nothing else (a rest of
    // an operation runs once, so it can't be tried).
    if (c) return single(run((m) => m.apply(f, args)));
    throw NEED;
  };
  // Each node is made once into a JavaScript function of its scope (closure
  // compilation): no looking the node up, no switch on its kind, per run.
  type Direct = (env: Env) => Value;
  const compiled = new Map<Id, Direct>();
  const direct = (id: Id, env: Env): Value => (compiled.get(id) ?? compile(id))(env);
  const needs: Direct = () => { throw NEED; };
  // Whether a scope given from outside (ev) binds something besides binders.
  let looseScopes = false;
  const compile = (id: Id): Direct => {
    const d = compileNode(id);
    compiled.set(id, d);
    return d;
  };
  const compiledOf = (id: Id): Direct => compiled.get(id) ?? compile(id);
  function compileNode(id: Id): Direct {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": { const v = n.of === INT ? intLit(n.value) : n.value; return () => v; }
      case "ref": {
        const target = n.target, t = code.nodes[target];
        // A definition or a builtin isn't in a scope (only binders are,
        // unless a caller's map put one there): not looked for in it, and
        // its value kept here. Looking through the whole scope and missing
        // was most of agent's own time.
        if (t?.kind === "def" || t?.kind === "builtin") {
          let v: Value | undefined;
          return (env) => (looseScopes ? refValue(target, env) : (v ??= refValue(target, null)));
        }
        // A constructor or a field isn't in a scope either (L118d3).
        if (t?.kind === "variant" || t?.kind === "field") return (env) => refValue(target, looseScopes ? env : null);
        // A binder: its scope walked here, not through refValue (L118d3).
        return (env) => {
          for (let e = env; e; e = e.up) if (e.b === target) return e.v;
          return refValue(target, null);
        };
      }
      case "lambda": return (env) => closure(n, env);
      case "call": {
        if (isUse(n)) return needs;
        const head = code.nodes[n.fn], k = n.args.length;
        const steps = head.kind === "ref" && info.divergent.has(head.target);
        // Made when first run: a node's parts are made as they're reached.
        let args: Direct[] | undefined;
        const argsOf = () => (args ??= n.args.map(compiledOf));
        if (head.kind === "lambda") {
          let body: Direct | undefined;
          const params = head.params;
          return (env) => {
            const as = argsOf(), vs = new Array<Value>(k);
            for (let i = 0; i < k; i++) vs[i] = as[i](env);
            return (body ??= compiledOf(head.body))(bind(env, params, vs));
          };
        }
        let fn: Direct | undefined;
        // A field read or a record made, done here, not by calling the
        // part's function value (L118d3); a scope from outside may bind
        // the name, so then the call is made as written.
        const target = head.kind === "ref" ? head.target : undefined, part = target ? code.nodes[target] : undefined;
        if (part?.kind === "field" && k === 1) {
          const v = info.owner.get(target!)!;
          const variant = (code.nodes[(code.nodes[v] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
          const i = (code.nodes[variant] as NodeOf<"variant">).fields.indexOf(target!);
          return (env) => {
            if (looseScopes) return callDirect((fn ??= compiledOf(n.fn))(env), [argsOf()[0](env)]);
            return (argsOf()[0](env) as Data).fields[i];
          };
        }
        if (part?.kind === "variant" && !effectOf(target!) && part.fields.length === k && k > 0) {
          const tg = target!;
          return (env) => {
            const as = argsOf(), vs = new Array<Value>(k);
            for (let i = 0; i < k; i++) vs[i] = as[i](env);
            if (looseScopes) return callDirect((fn ??= compiledOf(n.fn))(env), vs);
            return { tag: tg, fields: vs };
          };
        }
        return (env) => {
          if (steps) spendStep();
          const f = (fn ??= compiledOf(n.fn))(env), as = argsOf(), vs = new Array<Value>(k);
          for (let i = 0; i < k; i++) vs[i] = as[i](env);
          return callDirect(f, vs);
        };
      }
      case "match": {
        if (handlerOf(n)) return needs;
        let scrutinee: Direct | undefined, otherwise: Direct | undefined;
        const arms = new Map<Id, { binds: Id[]; body: Direct | undefined; id: Id }>();
        for (const [tag, arm] of matchArms(n)) arms.set(tag, { binds: arm.binds, body: undefined, id: arm.body });
        return (env) => {
          const d = (scrutinee ??= compiledOf(n.scrutinee))(env) as Data, arm = arms.get(d.tag);
          if (arm) return (arm.body ??= compiledOf(arm.id))(bind(env, arm.binds, d.fields));
          return (otherwise ??= compiledOf(n.otherwise!))(env);
        };
      }
      // The rest (a fold, a solve, ...) on a machine of its own, which
      // stops this run if it would act.
      // A fold, children before their parent as the machine folds them
      // (foldValue), on the JavaScript stack. Each fold had a machine of its
      // own: Spacetime's `clifford product` folds a 16-part list, 13,000
      // times for `path`'s 400 steps (I189).
      case "fold": {
        let scrutinee: Direct | undefined;
        const bodies = new Map<Id, Direct>();
        return (env) => {
          const arms = foldArms(n);
          const go = (d: Data): Value => {
            const arm = arms.get(d.tag)!, kids = kidsOf(arm, d), m = kids.kids.length;
            const rs = new Array<Value>(m);
            for (let i = 0; i < m; i++) rs[i] = go(kids.kids[i]);
            const folded = kids.folded(rs);
            let inner = bind(env, arm.arm.binds, d.fields);
            for (let k = 0; k < arm.rec.length; k++) inner = { b: arm.arm.results[arm.rec[k]]!, v: folded[k], up: inner };
            let body = bodies.get(arm.arm.id);
            if (!body) bodies.set(arm.arm.id, (body = compiledOf(arm.arm.body)));
            return body(inner);
          };
          return go((scrutinee ??= compiledOf(n.scrutinee))(env) as Data);
        };
      }
      default: return (env) => single(run((m) => m.eval(id, env)));
    }
  }

  // A search run directly (L118d): the body of a `first`, `optional`,
  // `all` or `count` whose type says it only computes and chooses runs as
  // JavaScript too, each node made once into a function of its scope and of
  // what to do with each of its values (a success continuation), so a
  // choice is a loop over its alternatives and a failure is a return.
  // Each says whether to stop (`first` has its value). Anything it
  // can't do stops it as the direct run stops (NEED), having done nothing
  // anyone sees, and the handler runs on the machine.
  type K = (v: Value) => boolean;
  type Search = (env: Env, k: K) => boolean;
  const searches = new Map<Id, Search>();
  const search = (id: Id, env: Env, k: K): boolean => (searches.get(id) ?? searchOf(id))(env, k);
  const searchOf = (id: Id): Search => { const d = searchNode(id); searches.set(id, d); return d; };
  const searchingNeeds: Search = () => { throw NEED; };
  // Whether a lambda's type says it only computes and chooses.
  const choosing = new Map<Id, boolean>();
  const chooses = (n: NodeOf<"lambda">): boolean => {
    let a = choosing.get(n.id);
    if (a === undefined) {
      const t0 = info.typeOf?.get(n.id), t = t0 && info.subst.resolve(t0);
      a = !!t && t.t === "fn" && info.subst.resolveRow(t.eff).effs.every((e) => e === DIVERGE || e === CHOICE || e === ABORT);
      choosing.set(n.id, a);
    }
    return a;
  };
  // The values of a call, each given to k in the order the machine finds them.
  const callSearch = (f: Value, args: Value[], k: K): boolean => {
    const c = closureOf(f);
    if (c && !machineOnly.has(c.lambda)) {
      if (!acts(c.node)) return k(enter(c, args));
      if (chooses(c.node)) {
        rt.entered?.(copyOf?.get(c.lambda) ?? c.lambda, args, c.lambda);
        return search(c.node.body, bind(c.scope, c.node.params, args), k);
      }
    }
    if (pureFns.has(f as Fn) || pureJets.has(f as Fn)) {
      let r: Iterable<Value>;
      try { r = (f as Fn)(...args); } catch (e) { if (e instanceof OutOfSteps || e instanceof Aborted) throw e; throw NEED; }
      if (Array.isArray(r)) { for (let i = 0; i < r.length; i++) if (k(r[i])) return true; return false; }
      for (const v of r) if (k(v)) return true;
      return false;
    }
    const h = HANDLED.get(f as Fn);
    if (h) return k(handledDirect(h, args));
    throw NEED;
  };
  // A node whose one value is worked out directly, as searchNode's first case.
  const simple = (id: Id): boolean => { const k = code.nodes[id]?.kind; return k === "lit" || k === "ref" || k === "lambda"; };
  function searchNode(id: Id): Search {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": case "ref": case "lambda": { const d = compiledOf(id); return (env, k) => k(d(env)); }
      case "call": {
        if (isUse(n)) return searchingNeeds;
        const head = code.nodes[n.fn], count = n.args.length, argIds = n.args;
        const steps = head.kind === "ref" && info.divergent.has(head.target);
        // An argument with one value (a literal, a name, a function) is
        // worked out directly, not through a continuation: fewer frames a
        // level, so a search that recurses deeply fits JavaScript's stack.
        const one = argIds.map((a) => (simple(a) ? compiledOf(a) : null));
        // The arguments' values, left to right, each one's alternatives in turn.
        const each = (env: Env, i: number, vs: Value[], done: (vs: Value[]) => boolean): boolean => {
          for (; i < count && one[i]; i++) vs[i] = one[i]!(env);
          if (i === count) return done(vs.slice());
          return search(argIds[i], env, (v) => { vs[i] = v; return each(env, i + 1, vs, done); });
        };
        if (head.kind === "lambda") {
          const params = head.params, body = head.body;
          return (env, k) => each(env, 0, new Array<Value>(count), (vs) => search(body, bind(env, params, vs), k));
        }
        const fn = n.fn;
        if (simple(fn)) {
          const f0 = compiledOf(fn);
          if (one.every((d) => d)) return (env, k) => {
            if (steps) spendStep();
            const f = f0(env), vs = new Array<Value>(count);
            for (let i = 0; i < count; i++) vs[i] = one[i]!(env);
            return callSearch(f, vs, k);
          };
          return (env, k) => { if (steps) spendStep(); const f = f0(env); return each(env, 0, new Array<Value>(count), (vs) => callSearch(f, vs, k)); };
        }
        return (env, k) => {
          if (steps) spendStep();
          return search(fn, env, (f) => each(env, 0, new Array<Value>(count), (vs) => callSearch(f, vs, k)));
        };
      }
      case "match": {
        if (handlerOf(n)) return searchingNeeds;
        const arms = matchArms(n), scrutinee = n.scrutinee, otherwise = n.otherwise;
        if (simple(scrutinee)) {
          const sd = compiledOf(scrutinee);
          return (env, k) => {
            const d = sd(env) as Data, arm = arms.get(d.tag);
            if (arm) return search(arm.body, bind(env, arm.binds, d.fields), k);
            return search(otherwise!, env, k);
          };
        }
        return (env, k) => search(scrutinee, env, (d) => {
          const arm = arms.get((d as Data).tag);
          if (arm) return search(arm.body, bind(env, arm.binds, (d as Data).fields), k);
          return search(otherwise!, env, k);
        });
      }
      // The rest on a machine of its own, every value it gives.
      default: return (env, k) => { for (const v of run((m) => m.eval(id, env))) if (k(v)) return true; return false; };
    }
  }
  // `first`, `optional`, `all` or `count` of a body that only computes and
  // chooses, run directly; NEED when it can't be.
  const SEARCHES = new Set<Id>([S.first, S.optional, S.all, S.count]);
  const handledDirect = (h: Id, args: Value[]): Value => {
    const body = closureOf(args[0]);
    if (!SEARCHES.has(h) || !body || machineOnly.has(body.lambda) || !chooses(body.node)) throw NEED;
    const t = tries.get(body.lambda);
    if (t) t.n++; else tries.set(body.lambda, { n: 1, stops: 0 });
    directDepth++;
    try {
      if (h === S.first || h === S.optional) {
        let found: Value | undefined;
        if (callSearch(args[0], [], (v) => { found = v; return true; })) return h === S.optional ? { tag: SOME, fields: [found!] } : found!;
        return h === S.optional ? { tag: NONE, fields: [] } : callDirect(args[1], []);
      }
      if (h === S.all) { const all: Value[] = []; callSearch(args[0], [], (v) => { all.push(v); return false; }); return toList(all); }
      let count = 0;
      callSearch(args[0], [], () => { count++; return false; });
      return count;
    } catch (e) {
      // An abort goes to the machine, which runs the search again (L118d2).
      if (e instanceof Aborted && aborts(body.node)) e = NEED;
      if (e === NEED || e instanceof RangeError) stopped(body.lambda);
      throw e;
    }
    finally { directDepth--; }
  };

  const closure = (n: NodeOf<"lambda">, env: Env): Fn => {
    const f = (...args: Value[]) => run((m) => m.apply(f, args));
    (f as unknown as Record<symbol, unknown>)[META] = new LambdaMeta(n, env, mine);
    return f;
  };

  // ---- the machine
  //
  // A small-step machine with its continuation and its choice points on the
  // heap, so neither a deep recursion nor a long fold uses the JS stack.
  // The continuation `k` is a linked list of frames, each saying what to do
  // with the value being returned. It is never mutated, so a choice point
  // can keep it and resume it later: that is all backtracking is. A choice
  // point holds an iterator of the remaining alternatives; failing pulls
  // the next one from the newest choice point. A handler pushes a barrier
  // below its body's choice points: `first` cuts back to it, `all` and
  // `count` fail until the search reaches it, and reaching it ends the body.
  function* run(start: (m: Machine) => void): Generator<Value> {
    const m = new Machine(ambient);
    start(m);
    yield* going(m);
  }
  // How many machines are going inside one another (a builtin that calls a
  // function value starts another). Only the outermost can be kept when a
  // page's fetch isn't here yet: an inner one's caller is JavaScript's stack.
  let depth = 0;
  function* going(m: Machine): Generator<Value> {
    while (true) {
      let v: Value | typeof DONE;
      depth++;
      try { v = m.go(); } finally { depth--; }
      if (v === DONE) return;
      yield v as Value;
      m.fail();
    }
  }

  const DONE = Symbol("done");
  const EVAL = 0, RET = 1, FAIL = 2;

  class Machine {
    mode = EVAL;
    id: Id = "";
    env: Env = null;
    val: Value = 0;
    k: Frame | null = null;
    fuel: Fuel | null;
    cps: Choice[] = [];
    constructor(fuel: Fuel | null) { this.fuel = fuel; }

    eval(id: Id, env: Env) { this.mode = EVAL; this.id = id; this.env = env; }
    ret(v: Value) { this.mode = RET; this.val = v; }
    fail() { this.mode = FAIL; }
    push(f: Frame) { f.next = this.k; this.k = f; }

    // Call a function value with its arguments, in the current continuation.
    apply(f: Value, args: Value[]): void {
      const rest = rests.get(f as Fn);
      if (rest) return this.resumeRest(rest, args[0]);
      const c = closureOf(f);
      if (c) {
        // Directly first, where nothing counts fuel (L118c).
        if (!this.fuel && directly(c.node)) {
          try { return this.ret(enter(c, args)); } catch (e) { if (e !== NEED && !(e instanceof RangeError)) throw e; }
        }
        rt.entered?.(copyOf?.get(c.lambda) ?? c.lambda, args, c.lambda);
        return this.eval(c.node.body, bind(c.scope, c.node.params, args));
      }
      const h = HANDLED.get(f as Fn);
      if (h) {
        // A search run directly first (L118d).
        if (!this.fuel && SEARCHES.has(h)) { try { return this.ret(handledDirect(h, args)); } catch (e) { if (e !== NEED && !(e instanceof RangeError)) throw e; } }
        return this.handle(h, args);
      }
      if (directDepth && builtinFns.has(f as Fn) && !pureFns.has(f as Fn)) throw NEED;
      const op = operations.get(f as Fn);
      if (op) return this.perform(op, args);
      // A builtin that acts on the world performs its effect's operation
      // when a match handles that effect (HOSTS.md, L55); otherwise the
      // world answers, below.
      const wop = worldOps.get(f as Fn);
      if (wop && this.handled(effectOf(wop)!)) return this.perform(wop, args);
      ambient = this.fuel;
      if (FALLIBLE.has(f as Fn)) {
        let r: Iterable<Value>;
        // Not here yet isn't a failure: the page asks again later.
        // A page's fetch that hasn't come keeps this machine where it is
        // (L59): resuming asks again, and the rest of the run goes on from
        // here, so nothing before the fetch runs twice.
        try { r = (f as Fn)(...args); } catch (e) {
          if (e instanceof Pending) {
            if (depth === 1 && e.resume === undefined) { let used = false; e.resume = () => { if (used) throw new Error("a page's run was resumed twice"); used = true; this.apply(f, args); return going(this); }; }
            else if (depth > 1) e.resume = null;
            throw e;
          }
          if (e instanceof OutOfSteps || e instanceof Aborted) throw e;
          return this.perform(ABORT_OP, [(e as Error).message]);
        }
        return this.from(r, (x) => this.ret(x as Value));
      }
      this.from((f as Fn)(...args), (x) => this.ret(x as Value));
    }

    // Perform an operation: find the nearest match handling its effect,
    // skipping the ones whose cases are running (their own effects go
    // further out). An operation that returns is answered and the
    // computation carries on; one that doesn't ends the handled computation,
    // with its alternatives (a cut, as in Prolog's catch/3).
    // Whether a match around here handles the effect.
    handled(effect: Id): boolean {
      let f = this.k;
      while (f && !(f.t === "handle" && f.effect === effect && !f.name)) f = f.t === "answer" ? f.handler.next : f.next;
      return !!f;
    }

    perform(op: Id, args: Value[]) {
      if (directDepth) throw NEED;
      const effect = effectOf(op)!;
      let f = this.k;
      // Given a handler's name first, that handler answers it; otherwise
      // the innermost handler of the effect that has no name.
      const name = args[0] instanceof HandlerName ? args[0] : null;
      if (name) args = args.slice(1);
      if (name) while (f && !(f.t === "handle" && f.name === name)) f = f.t === "answer" ? f.handler.next : f.next;
      else while (f && !((f.t === "handle" || f.t === "seeded") && f.effect === effect && !(f.t === "handle" && f.name))) f = f.t === "answer" ? f.handler.next : f.next;
      if (!f) return this.unhandled(op, args);
      if (f.t === "seeded") return this.ret(f.gen.next());
      const h = f as HandleFrame;
      const arm = h.arms.get(op)!;
      const variant = code.nodes[op] as NodeOf<"variant">;
      // Answered later: the case runs outside the match, as for one that
      // never returns, and is given the rest to resume once, or drop. A
      // case that leaves the rest out answers at once (L63).
      if (variant.returns && arm.binds.length === variant.fields.length + 1) {
        const rest = restOf({ top: this.k, h, cps: this.cps.splice(h.base), fuel: this.fuel, used: false, op });
        this.k = h.next;
        this.fuel = h.fuel;
        return this.eval(arm.body, bind(h.env, arm.binds, [...args, rest]));
      }
      const env = bind(h.env, arm.binds, args);
      if (variant.returns) {
        this.push({ t: "answer", handler: h, next: null });
        return this.eval(arm.body, env);
      }
      // The handlers between here and h end now, their releases first,
      // innermost first (L213a); then the case; then h's own release.
      const inner: HandleFrame[] = [];
      for (let g = this.k; g && g !== h; g = g.t === "answer" ? g.handler.next : g.next) if (g.t === "handle" && g.release) inner.push(g);
      this.cps.length = h.base;
      this.k = h.next;
      this.fuel = h.fuel;
      if (h.release) this.push({ t: "release", body: h.release.body, env: h.env, next: null });
      if (!inner.length) return this.eval(arm.body, env);
      this.push({ t: "seq", body: arm.body, env, release: false, next: null });
      for (let i = inner.length - 1; i >= 1; i--) this.push({ t: "seq", body: inner[i].release!.body, env: inner[i].env, release: true, next: null });
      this.eval(inner[0].release!.body, inner[0].env);
    }

    // Resume a kept rest with the answer: its frames go on top of the
    // caller's, its handler again at their bottom (deep), its choice points
    // back on the stack. A rest runs once.
    resumeRest(r: Rest, answer: Value) {
      // Under a direct try (a machine of its own for a closure the direct
      // run called), the try may yet fall back and run again: the rest
      // waits for the machine that runs once (crew's scheduler).
      if (directDepth) throw NEED;
      if (r.used) throw new Error(`the rest of ${rt.names?.[r.op] ?? stdNames[r.op] ?? r.op} was resumed a second time: a rest runs once`);
      r.used = true;
      const shift = this.cps.length - r.h.base;
      for (let f = r.top; f; f = f.next) {
        if (f.t === "handle" || f.t === "handler") f.base += shift;
        if (f === r.h) break;
      }
      r.h.next = this.k;
      r.h.fuel = this.fuel;
      this.cps.push(...r.cps);
      this.k = r.top;
      this.fuel = r.fuel;
      this.ret(answer);
    }

    // What the program leaves unhandled, the runtime handles: Log goes to
    // standard error, an Abort ends the run, and the world draws Random's
    // numbers, reads the clock and waits.
    unhandled(op: Id, args: Value[]): void {
      // One of std's world operations the program's hosts/js.js answers
      // (L69d1): its entry, by the operation's id, in place of the
      // world's, checked at the border as a program's own; the effect
      // stays in every row.
      if (rt.hosts && stdHosted(op, rt.hosts)) {
        let v: Value;
        try { v = answerFromHost(code, rt.names ?? {}, rt.hosts, op, args) as Value; } catch (e) { return this.perform(ABORT_OP, [(e as Error).message]); }
        return this.ret(v);
      }
      if (op === LOG_OP) return ((rt.world?.log ?? rt.print)(args[0] as string), this.ret(unit));
      if (op === ABORT_OP) throw new Aborted(args[0] as string);
      if (op === RANDOM_OP) return this.ret((rt.world?.random ?? worldRandom)());
      if (op === NOW_OP) return this.ret((rt.world?.now ?? Date.now)());
      if (op === MY_LOCALE_OP) return this.ret({ tag: LOCALE_V, fields: [(rt.world?.locale ?? hostLocale)()] });
      if (op === MY_ZONE_OP) return this.ret((rt.world?.timeZone ?? hostZone)());
      // A file the prelude's `with open file` keeps open (L213c): by its
      // number, which only the library holds. What goes wrong is an answer
      // (none, false), so the prelude says why where it was opened.
      if (op === FILE_OPS.open) { try { return this.ret({ tag: SOME, fields: [world("openFile")!(args[0] as string)] }); } catch { return this.ret({ tag: NONE, fields: [] }); } }
      if (op === FILE_OPS.line) { let l: string | null = null; try { l = world("fileLine")!(args[0] as number); } catch { /* none */ } return this.ret(l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l.normalize("NFC")] }); }
      if (op === FILE_OPS.addLine) { try { world("fileAddLine")!(args[0] as number, args[1] as string); return this.ret(bool(true)); } catch { return this.ret(bool(false)); } }
      if (op === FILE_OPS.bytes) { let b: Uint8Array | null = null; try { b = world("fileBytes")!(args[0] as number, Math.max(0, Number(args[1]))); } catch { /* none */ } return this.ret(bytesValue(b ?? new Uint8Array(0)) as Value); }
      if (op === FILE_OPS.addBytes) { try { world("fileAddBytes")!(args[0] as number, plainBytes(args[1])); return this.ret(bool(true)); } catch { return this.ret(bool(false)); } }
      if (op === FILE_OPS.close) { try { world("closeFile")!(args[0] as number); } catch { /* closing can't fail */ } return this.ret(unit); }
      // A page's handler waits by stopping here (C40): the world throws
      // Pending, and the run goes on from here when it's ready, answered.
      if (op === WAIT_OP) {
        try { world("wait")(args[0] as number); } catch (e) { this.paused(e, () => this.ret(unit)); }
        return this.ret(unit);
      }
      // Console's, Files' and Network's operations (L145): as their builtins.
      const builtin = worldBuiltins.get(op);
      if (builtin) return this.apply(builtin, args);
      // Waiting (L71c): the world's timers (timers.ts, which the compiled
      // program's main uses too).
      if (op === START_TIMER_OP) return this.ret(timers.start((rt.world?.now ?? Date.now)(), args[0] as number));
      if (op === AWAIT_OP) {
        const clock = rt.world?.now ?? Date.now, t = args[0] as Data;
        let now = clock(), w: { at: number; first?: number };
        // A fetch that failed is an Abort where it is awaited.
        try { w = timers.when(t, now); } catch (e) { if (e instanceof Aborted) return this.perform(ABORT_OP, [e.reason]); throw e; }
        // A fetch still on its way: look again every few milliseconds, or
        // at a timer's deadline if that comes first (L150b).
        // On a page the wait stops the run (C40): it goes on from here
        // when ready, looking again at a fetch still on its way, and
        // otherwise answered as the timer's deadline has passed.
        const answer = (w: { at: number; first?: number }) => (w.first !== undefined ? this.apply(t.fields[1], [w.first]) : this.ret(t.tag === TICKET_V.timer || t.tag === TICKET_V.at ? t.fields[1] : timers.value(t) ?? unit));
        try {
          while (w.at > now && timers.pending(t)) { world("wait")(Math.min(5, w.at - now)); now = clock(); w = timers.when(t, now); }
        } catch (e) {
          if (e instanceof Aborted) return this.perform(ABORT_OP, [e.reason]);
          this.paused(e, () => this.unhandled(op, args));
        }
        if (w.at > now) { const at = w; try { world("wait")(w.at - now); } catch (e) { this.paused(e, () => answer(at)); } }
        return answer(w);
      }
      if (op === CHECK_OP && rt.check) return (rt.check((args[0] as Data).tag === TRUE, args[1] as string), this.ret(unit));
      // A program's own effect, answered by its host (L69a); a missing or
      // wrong answer is an Abort, performed where the operation was.
      // A pure effect's (L69d2) is in no row, so nothing checked for its
      // host before the run: one missing is an Abort here, with the reason.
      const eff = effectOfOperation(code, op);
      if (eff && (hosted.has(eff) || pureEffect(code, eff))) {
        let v: Value;
        try { v = answerFromHost(code, rt.names ?? {}, rt.hosts ?? {}, op, args) as Value; } catch (e) { return this.perform(ABORT_OP, [(e as Error).message]); }
        return this.ret(v);
      }
      throw new Error(`nothing handles ${rt.names?.[op] ?? stdNames[op] ?? op}`);
    }

    // A Pending from the world, rethrown: in a page's run (depth 1) with
    // how to go on from here once it's ready (L59, C40), inside a builtin's
    // call with none. Anything else is rethrown as it is.
    paused(e: unknown, then: () => void): never {
      if (e instanceof Pending) {
        if (depth === 1 && e.resume === undefined) { let used = false; e.resume = () => { if (used) throw new Error("a page's run was resumed twice"); used = true; then(); return going(this); }; }
        else if (depth > 1) e.resume = null;
      }
      throw e;
    }

    handle(h: Id, args: Value[]): void {
      if (h === S.fuel) {
        this.push({ t: "fuelExit", saved: this.fuel, next: null });
        this.fuel = { left: args[0] as number };
        return this.apply(args[1], []);
      }
      if (h === S.seeded) {
        this.push({ t: "seeded", effect: RANDOM, gen: seededGenerator(args[0] as number), next: null });
        return this.apply(args[1], []);
      }
      const frame: HandlerFrame = { t: "handler", h, acc: [], otherwise: args[1], base: this.cps.length, fuel: this.fuel, next: null };
      this.cps.push({ barrier: frame });
      this.push(frame);
      this.apply(args[0], []);
    }

    // Continue with the first of a stream of alternatives, and leave a choice
    // point for the rest. A stream of exactly one (an array, from a builtin)
    // makes no choice point.
    from<T>(xs: Iterable<T>, use: (x: T) => void) {
      if (Array.isArray(xs) && xs.length <= 1) return xs.length ? use(xs[0]) : this.fail();
      const it = xs[Symbol.iterator]();
      const r = it.next();
      if (r.done) return this.fail();
      this.cps.push({ it, k: this.k, fuel: this.fuel, use: use as (x: unknown) => void });
      use(r.value);
    }

    // Run until a value reaches the end of the continuation, or nothing is left.
    // An exit nothing in the program catches (an Abort at the top, the
    // stop, a step budget spent) ends every handler still open here: their
    // releases run, innermost first, before it goes on out (L213a). A page
    // waiting (Pending) hasn't ended anything.
    go(): Value | typeof DONE {
      try { return this.going(); } catch (e) {
        if (!(e instanceof Pending)) this.releaseAll();
        throw e;
      }
    }
    releaseAll() {
      this.releaseUntil(null);
      this.k = null;
    }
    // The releases of the handlers open between here and `stop` (a frame of
    // this continuation, or null for all of them), innermost first. A
    // failure leaves for its choice point this way, so a `with fuel`
    // running out ends the handlers inside it (L213a); a path abandoned
    // after its value, or one whose frames are gone, has none to run.
    releaseUntil(stop: Frame | null) {
      const todo: { body: Id; env: Env }[] = [];
      if (!releasing) return;
      let f = this.k;
      for (; f && f !== stop; f = f.next) {
        if (f.t === "handle" && f.release) todo.push({ body: f.release.body, env: f.env });
        else if (f.t === "release" || (f.t === "seq" && f.release)) todo.push({ body: f.body, env: f.env });
      }
      if (f !== stop) return;
      for (const r of todo) {
        const m = new Machine(null);
        m.eval(r.body, r.env);
        try { m.go(); } catch { /* the exit going out is the one to report */ }
      }
    }
    going(): Value | typeof DONE {
      while (true) {
        if (this.mode === EVAL) this.step();
        else if (this.mode === RET) {
          const f = this.k;
          if (!f) return this.val;
          this.k = f.next;
          this.resume(f);
        } else {
          const cp = this.cps[this.cps.length - 1];
          if (!cp) return DONE;
          if ("barrier" in cp) {
            this.cps.pop();
            const f = cp.barrier;
            this.releaseUntil(f);
            this.k = f.next;
            this.fuel = f.fuel;
            if (f.h === S.all) this.ret(toList(f.acc));
            else if (f.h === S.count) this.ret(f.acc.length);
            else if (f.h === S.optional) this.ret({ tag: NONE, fields: [] });
            else this.apply(f.otherwise, []);
            continue;
          }
          // The stream's next answer is searched for under the fuel it
          // was made under: a search resumed after its `with fuel` body
          // gave a first answer still spends from it (I174).
          ambient = cp.fuel;
          this.fuel = cp.fuel;
          const r = cp.it.next();
          if (r.done) { this.cps.pop(); continue; }
          this.releaseUntil(cp.k);
          this.k = cp.k;
          this.fuel = cp.fuel;
          cp.use(r.value);
        }
      }
    }

    // Values that need no step: literals, variables, lambdas.
    atom(id: Id, env: Env): Value | undefined {
      const n = code.nodes[id];
      if (n.kind === "lit") return n.of === INT ? intLit(n.value) : n.value;
      if (n.kind === "ref") return refValue(n.target, env);
      if (n.kind === "lambda") return closure(n, env);
      return undefined;
    }

    step() {
      const id = this.id, env = this.env;
      const n = code.nodes[id];
      switch (n.kind) {
        case "lit": case "ref": case "lambda": return this.ret(this.atom(id, env)!);
        case "call": {
          if (isUse(n)) return this.parts(givenInOrder(code, n).map((k) => n.given[k]), 0, [], env, n);
          const head = code.nodes[n.fn];
          const target = head.kind === "ref" ? head.target : null;
          // Each call into a possibly-divergent definition spends fuel, if a
          // `with fuel` handler is active. Out of fuel means no result.
          if (target && info.divergent.has(target)) {
            if (!this.fuel) spendStep();
            else if (--this.fuel.left < 0) return this.fail();
          }
          // A lambda written in place (a let, a dot) is entered, not made.
          if (head.kind === "lambda") return this.parts(n.args, 0, [], env, n);
          return this.parts([n.fn, ...n.args], 0, [], env, n);
        }
        case "match": case "fold": {
          const h = n.kind === "match" ? handlerOf(n) : null;
          const named = h && n.kind === "match" ? n.name : undefined, token = named ? new HandlerName() : undefined;
          if (h) this.push({ t: "handle", effect: h.effect, arms: h.arms, done: (n as NodeOf<"match">).otherwise, release: h.release, env, base: this.cps.length, fuel: this.fuel, next: null, ...(token ? { name: token } : {}) });
          else this.push({ t: n.kind, n, env, next: null } as Frame);
          return this.eval(n.scrutinee, named ? bind(env, [named], [token as unknown as Value]) : env);
        }
        case "hole": throw new Error("the program reached a hole");
        default: throw new Error(`can't evaluate a ${n.kind}`);
      }
    }

    // Evaluate the parts of a call (or a solve's givens) left to right,
    // earlier choices varying slowest.
    parts(ids: Id[], i: number, vals: Value[], env: Env, n: Call | Use) {
      for (; i < ids.length; i++) {
        const a = this.atom(ids[i], env);
        if (a === undefined) {
          // (Not copied: resuming copies, and nothing here adds to vals after.)
          this.push({ t: "parts", ids, i, vals, env, n, next: null });
          return this.eval(ids[i], env);
        }
        vals.push(a);
      }
      if (isCall(n)) {
        const head = code.nodes[n.fn];
        if (head.kind === "lambda") return this.eval(head.body, bind(env, head.params, vals));
        return this.apply(vals[0], vals.slice(1));
      }
      this.solve(n, vals, env);
    }

    resume(f: Frame) {
      const v = this.val;
      switch (f.t) {
        case "parts": return this.parts(f.ids, f.i + 1, [...f.vals, v], f.env, f.n);
        case "match": {
          const d = v as Data;
          const arm = matchArms(f.n).get(d.tag);
          if (arm) return this.eval(arm.body, bind(f.env, arm.binds, d.fields));
          return this.eval(f.n.otherwise!, f.env);
        }
        // Children are folded before their parent (bottom-up), as a fold
        // does: the first recursive field of the value is folded, then the
        // next, then the arm runs with their results. The frames waiting
        // for children are the stack, on the heap.
        case "fold": return this.foldValue({ arms: foldArms(f.n), env: f.env }, v as Data);
        case "foldChild": {
          const results: Done = { v, n: (f.results?.n ?? 0) + 1, up: f.results };
          if (results.n < f.kids.kids.length) {
            this.push({ ...f, results, next: null });
            return this.foldValue(f.ctx, f.kids.kids[results.n]);
          }
          const all: Value[] = new Array(results.n);
          for (let r: Done = results; r; r = r.up) all[r.n - 1] = r.v;
          return this.foldBody(f.ctx, f.d, f.arm, f.kids.folded(all));
        }
        case "handler":
          if (f.h === S.first || f.h === S.optional) {
            this.cps.length = f.base;
            this.fuel = f.fuel;
            return this.ret(f.h === S.optional ? { tag: SOME, fields: [v] } : v);
          }
          f.acc.push(v);
          return this.fail();
        case "fuelExit":
          this.fuel = f.saved;
          return this.ret(v);
        case "seeded": return this.ret(v);
        // The computation a handler watched has its value: that's the
        // match's value, or what its normal finish makes of it (L57),
        // outside the handler. An answer goes back to where it was asked for.
        // With a release (L213a), it runs after the normal finish, and the
        // match's value is what the finish gave.
        case "handle":
          if (f.release) {
            if (!f.done) { this.push({ t: "keep", v, next: null }); return this.eval(f.release.body, f.env); }
            this.push({ t: "release", body: f.release.body, env: f.env, next: null });
          }
          return f.done ? this.apply(this.atom(f.done, f.env)!, [v]) : this.ret(v);
        case "answer": return this.ret(v);
        case "release": this.push({ t: "keep", v, next: null }); return this.eval(f.body, f.env);
        case "keep": return this.ret(f.v);
        case "seq": return this.eval(f.body, f.env);
      }
    }

    // Walk down the first recursive field until a case without one, leaving
    // a frame at each level.
    foldValue(ctx: FoldCtx, d: Data) {
      for (;;) {
        const arm = ctx.arms.get(d.tag)!;
        const kids = kidsOf(arm, d);
        if (!kids.kids.length) return this.foldBody(ctx, d, arm, kids.folded([]));
        this.push({ t: "foldChild", ctx, d, arm, kids, results: null, next: null });
        d = kids.kids[0];
      }
    }

    foldBody(ctx: FoldCtx, d: Data, arm: FoldArm, folded: Value[]) {
      let inner = bind(ctx.env, arm.arm.binds, d.fields);
      arm.rec.forEach((i, k) => (inner = { b: arm.arm.results[i]!, v: folded[k], up: inner }));
      this.eval(arm.arm.body, inner);
    }

    solve(n: Use, vals: Value[], env: Env) {
      const keys = givenInOrder(code, n);
      const known = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
      const fuel = () => this.fuel;
      // Each step that might unfold forever spends the innermost fuel.
      const spend = () => { const f = fuel(); return !(f && --f.left < 0); };
      // A solve with exactly one answer (oneAnswer, MODES.md), or results
      // each computed from the inputs (directions.ts), leaves no choice
      // point: its first answer is the answer.
      const at = shared.nodes[n.id] === n ? shared : code;
      let answers: Iterable<Value[]> = solveAnswers(at, n, known, { spend, names: rt.names, stuck: rt.stuck, info, shown: shownBy, ordered: orderedBy });
      if (solvesOnce(at, n)) {
        const r = (answers as Generator<Value[]>).next();
        if (r.done) throw new Error(`solving ${rt.names?.[useTarget(code.nodes, n)] ?? useTarget(code.nodes, n)} this way gives exactly one answer, and it gave none`);
        answers = [r.value];
      }
      // With no body (L211d) the use is its answer: the one port, or the
      // tuple of them in port order.
      if (n.body === undefined) this.from(answers, (bound) => this.ret(bound.length === 1 ? bound[0] : { tag: tupleVariant(bound.length), fields: bound as Value[] }));
      else this.from(answers, (bound) => this.eval(n.body!, bind(env, Object.values(bindsOf(n)), bound as Value[])));
    }
  }

  // A match whose cases are an effect's operations is a handler.
  const handlers = new Map<Id, { effect: Id; arms: Map<Id, NodeOf<"arm">>; release: NodeOf<"arm"> | null } | null>();
  const handlerOf = (n: NodeOf<"match">) => {
    if (!handlers.has(n.id)) {
      const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
      const effect = arms.length ? effectOf(arms[0].variant) : null;
      const release = arms.find((a) => a.variant === RELEASE_V) ?? null;
      if (release) releasing = true;
      handlers.set(n.id, effect ? { effect, arms: new Map(arms.filter((a) => a !== release).map((a) => [a.variant, a])), release } : null);
    }
    return handlers.get(n.id)!;
  };

  // The arms of a fold by variant, with the indices of the recursive fields.
  const armsOf = new Map<Id, Map<Id, FoldArm>>();
  const foldArms = (n: NodeOf<"fold">) => {
    if (!armsOf.has(n.id)) armsOf.set(n.id, new Map(n.arms.map((a) => {
      const arm = code.nodes[a] as NodeOf<"arm">;
      const def = info.owner.get(arm.variant)!;
      const shapes = fieldShapes(code, def, arm.variant);
      const rec = arm.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      const fields = (code.nodes[arm.variant] as NodeOf<"variant">).fields;
      const nested = rec.map((i) => shapes[i] === "nested");
      return [arm.variant, { arm, rec, nested, shapes: rec.map((i, k) => (nested[k] ? shapeOf(code, def, (code.nodes[fields[i]] as NodeOf<"field">).type) : null)) }];
    })));
    return armsOf.get(n.id)!;
  };
  const kidsOf = (arm: FoldArm, d: Data): Kids => {
    if (!arm.nested.includes(true)) return { kids: arm.rec.map((i) => d.fields[i] as Data), folded: (r) => r };
    const parts = arm.rec.map((i, k) => arm.nested[k]
      ? spread<Data>(arm.shapes[k]!, d.fields[i])
      : { children: [d.fields[i] as Data], rebuild: (r: unknown[]) => r[0] });
    return {
      kids: parts.flatMap((p) => p.children),
      folded: (results) => {
        let at = 0;
        return parts.map((p) => p.rebuild(results.slice(at, (at += p.children.length))) as Value);
      },
    };
  };

  // Each match's arms by case, found once (L118c: a list of them made at
  // every match was a good part of the machine's garbage).
  const armsKept = new Map<Id, Map<Id, NodeOf<"arm">>>();
  const matchArms = (n: NodeOf<"match">) => {
    let m = armsKept.get(n.id);
    if (!m) {
      m = new Map();
      for (const a of n.arms) { const arm = code.nodes[a] as NodeOf<"arm">; if (!m.has(arm.variant)) m.set(arm.variant, arm); }
      armsKept.set(n.id, m);
    }
    return m;
  };
  const ev = (id: Id, env: Map<Id, Value>): Generator<Value> => {
    for (const b of env.keys()) if (code.nodes[b]?.kind !== "binder") looseScopes = true;
    return run((m) => m.eval(id, fromMap(env)));
  };

  // Constructors and projections as function values, made once each.
  const parts = new Map<Id, Fn>();

  const bind = (env: Env, binders: Id[], values: Value[]): Env => {
    for (let i = 0; i < binders.length; i++) env = { b: binders[i], v: values[i], up: env };
    return env;
  };

  function refValue(target: Id, env: Env): Value {
    const local = lookup(env, target);
    if (local !== undefined) return local;
    const t = code.nodes[target];
    switch (t.kind) {
      case "def": {
        if (!defs.has(target)) {
          // Definition values are pure (the checker sees to it), so exactly
          // one result.
          for (const v of run((m) => m.eval(t.body!, null))) { defs.set(target, v); if (typeof v === "function") defOf.set(v, target); break; }
          // A library definition with a host way runs it (library/hosts.ts).
          const jet = rt.libraryHosts === false ? undefined : pureHosts[target], self = defs.get(target);
          if (jet && typeof self === "function") { const j = jet(self as Fn); defs.set(target, j); defOf.set(j, target); pureJets.add(j); }
        }
        return defs.get(target)!;
      }
      case "builtin":
        if (!builtins[target]) throw new Error(`no implementation for ${target}`);
        return builtins[target];
      case "variant":
        if (effectOf(target)) {
          if (!parts.has(target)) {
            const op = tag((...args: Value[]) => run((m) => m.perform(target, args)), { prim: target });
            operations.set(op, target);
            parts.set(target, op);
          }
          return parts.get(target)!;
        }
        if (!t.fields.length) return { tag: target, fields: [] };
        if (!parts.has(target)) { const make = tag((...fields: Value[]) => one({ tag: target, fields }), { prim: target }); parts.set(target, make); pureJets.add(make); }
        return parts.get(target)!;
      case "field": {
        if (!parts.has(target)) {
          const v = info.owner.get(target)!;
          const variant = (code.nodes[(code.nodes[v] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
          const i = (code.nodes[variant] as NodeOf<"variant">).fields.indexOf(target);
          const get = tag((d) => one((d as Data).fields[i]), { prim: target });
          parts.set(target, get);
          pureJets.add(get);
        }
        return parts.get(target)!;
      }
      default: throw new Error(`unbound ${target}`);
    }
  }

  return {
    ev,
    // The program as it runs: the generic arithmetic resolved, lets lifted,
    // tuples spread (resolveArithmetic). A caller walking the program as
    // written (trace.ts) asks it for a node it changed.
    code,
    // What each node of a copy at another number type copies.
    copyOf,
    value: (def: Id) => refValue(def, null),
    // How a value of a type with a Shown implementation shows (L205c):
    // what `show any` and a search's show any give it, for a host showing
    // values (the editor's chips, ters test's answers) to show them the same.
    shown: shownBy,
    // Call a function value and stream its results. An answer handed out
    // to the host is used (SPEC §3.3, L218): one with an overflow in it
    // stops, as compiled code's does.
    call: function* (f: Value, ...args: Value[]) { for (const v of (f as Fn)(...args) as Iterable<Value>) yield handedOut(v); },
  };
}

// A Float64 leaving the program: finite, or the stop. Only an answer that
// is a number is looked at: walking a list or a record handed out would
// make every answer cost its size (rep-costs.test.ts), so an overflow
// inside one leaves as IEEE's ∞ (C156 says what compiled code does).
const handedOut = (v: Value): Value => (typeof v === "number" && v - v !== 0 ? overflowed() : v);

// Run an action (a definition of type () -> ...). Only effects the runtime
// can handle may be left: the world's, Diverge, Log, Random, Time, Wait and
// Abort (which ends the run with Aborted). Anything else (an unhandled Choice) is reported
// before anything runs.
export function runMain(code: Code, info: Info, def: Id, rt: Runtime = { print: (s) => console.log(s) }): Value {
  const t = info.typeOf.get(def);
  if (!t || t.t === "fn" && t.params.length) throw new Error("only an action or a value (no inputs) can be run");
  // A value runs as what it is: nothing to call, and nothing it prints.
  if (t.t !== "fn") {
    const problem = typeError(code, info, def, rt.names ?? {});
    if (problem) throw new Error(problem);
    return makeRunner(code, info, rt).value(def);
  }
  return start(code, info, def, t, [], rt);
}

function start(code: Code, info: Info, def: Id, t: Type, args: Value[], rt: Runtime): Value {
  const problem = typeError(code, info, def, rt.names ?? {}) ?? leftover(t, rt.names ?? {}, hostedEffects(code, rt.hosts));
  if (problem) throw new Error(problem);
  const r = makeRunner(code, info, rt.cells || tracks(code, def) ? rt : { ...rt, cells: new Cells(equal, true) });
  for (const v of r.call(r.value(def), ...args)) return v;
  throw new Error("no result");
}
// Whether what `def` reaches reads cells reactively: a formula, an each
// or a page's watcher. When nothing does, its cells are kept plainly, the
// State handler's way (cells.ts `plain`, L99e).
const REACTIVE: readonly Id[] = [CELL_OPS.formula, CELL_OPS.each, CELL_OPS.eachOf];
export function tracks(code: Code, def: Id): boolean {
  const reached = new Set(dependencies(code, def));
  return REACTIVE.some((op) => reached.has(op));
}
// A program that doesn't type-check isn't run: what it would do is
// whatever the evaluator happens to do with values of the wrong type (a
// probe printed NaN). Only errors in what `def` reaches count, so a broken
// definition elsewhere in the program doesn't stop this one.
function typeError(code: Code, info: Info, def: Id, names: Names): string | null {
  if (!info.errors.length) return null;
  for (const d of [def, ...dependencies(code, def)]) {
    if (code.nodes[d]?.kind !== "def") continue;
    const own = new Set(subtree(code, d));
    const e = info.errors.find((e) => own.has(e.id));
    if (e) return `can't run: ${names[d] ?? stdNames[d] ?? d} doesn't type-check (${e.message})`;
  }
  return null;
}
export const RUNTIME_HANDLES: readonly Id[] = discharge("a program's main", [...WORLD, CELLS, DIVERGE, NETWORK, LOG, ABORT, RANDOM, TIME, WAIT, AWAIT, SETTINGS, KEPT_FILES],
  "the runtime handles them around main: the world, cells, the clock, timers and the web; an Abort ends the program with its reason");
// The effects of a function's type that something in the program has to
// handle before it can run: an unhandled Choice, effects you declared.
export const needsHandling = (t: Type & { t: "fn" }): Id[] => t.eff.effs.filter((e) => !RUNTIME_HANDLES.includes(e));

// Why an action can't be run as it is: an effect only the program could
// handle is left over. Null when it can.
function leftover(t: Type, names: Names, hosted: Set<Id> = new Set()): string | null {
  if (t.t !== "fn") return "not a function";
  const extra = needsHandling(t).filter((e) => !hosted.has(e));
  if (!extra.length) return null;
  return `unhandled effect: ${extra.map((e) => names[e] ?? e).join(", ")}; ${extra.includes(CHOICE) ? "wrap it in first, all, count or optional" : "handle it with a match on its operations"}`;
}

// Can `def` be a command-line main? Null if it can, else why not.
// `hosted`: effects a host answers (hosts.ts, FOREIGN.md), which main may
// leave unhandled.
export function mainProblem(info: Info, def: Id, names: Names = {}, hosted: Set<Id> = new Set()): string | null {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length > 1) return "main takes the arguments (a list of texts), or nothing";
  return leftover(t, names, hosted);
}

// Can `def` be a page's main (WEB.md, `ters build-web`)? It takes nothing
// and returns the page, an Html. Null if it can, else why not.
export function pageProblem(info: Info, def: Id, names: Names = {}): string | null {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) return "a page's main takes nothing and returns the page (an Html)";
  const ret = info.subst.zonk(t.ret);
  if (ret.t !== "con" || ret.id !== HTML) return "a page's main returns the page (an Html)";
  return leftover(t, names);
}

// A main that is a value, not a function (lockstep's text, T7e15): run
// from the command line, it prints what it is (a text as itself, anything
// else as show gives it) and exits with 0.
export function valueMain(info: Info, def: Id): boolean {
  const t = info.typeOf.get(def);
  return !!t && t.t !== "fn";
}

// A program run from the command line (cli/ters.ts): `main` takes the
// arguments as a list of texts, or nothing, and returns the exit code (an
// Int or a Float64), or anything else for 0. An Abort that nothing handles
// prints its reason to standard error and exits with 1. A main that is a
// value prints it (valueMain).
export function runProgram(code: Code, info: Info, def: Id, args: string[], rt: Runtime): number {
  const t = info.typeOf.get(def);
  if (t && t.t !== "fn") {
    const problem = typeError(code, info, def, rt.names ?? {});
    if (problem) throw new Error(problem);
    try {
      const v = makeRunner(code, info, rt.cells || tracks(code, def) ? rt : { ...rt, cells: new Cells(equal, true) }).value(def);
      rt.print(typeof v === "string" ? v : showerFor(code, info, rt.names ?? {})(v, true));
      return 0;
    } catch (e) {
      if (!(e instanceof Aborted)) throw e;
      (rt.world?.error ?? rt.print)(e.reason);
      return 1;
    }
  }
  if (!t || t.t !== "fn" || t.params.length > 1) throw new Error("main takes the arguments (a list of texts), or nothing");
  try {
    const v = start(code, info, def, t, t.params.length ? [toList(args)] : [], rt);
    return typeof v === "number" || typeof v === "bigint" ? Number(v) : 0;
  } catch (e) {
    if (!(e instanceof Aborted)) throw e;
    (rt.world?.error ?? rt.print)(e.reason);
    return 1;
  }
}

// A definition named where a value is typed (values.ts): `{ tag:
// DEF_VALUE, fields: [its id] }` until a run looks it up. A definition's
// function value remembers which definition it is, so it shows by name.
export const DEF_VALUE = "@definition";
const defOf = new WeakMap<object, Id>();
export const definedAs = (v: Value): Id | undefined => (typeof v === "function" ? defOf.get(v) : undefined);

// `asNumber` shows an Extended as the number it stands for: what `show`
// gives, the Run panel and a wire's value (L153). Without it a value shows
// as the constructor it is built from.
// `shown`, given, shows a value of a type with a Shown implementation
// (L205) through it, Rational, Complex and Fixed among them; without it
// they show as the constructor too.
// Shows values as this program's `show any` does (L205c): a type of the
// program's own with a Shown implementation shows its own way. Made once
// per check, used for every value.
export function showerFor(code: Code, info: Info, names: Names): (v: Value, asNumber?: boolean) => string {
  const shown = makeRunner(code, info, { print: () => {}, names }).shown;
  return (v, asNumber = false) => showValue(v, code, names, asNumber, shown);
}
export function showValue(v: Value, code: Code, names: Names, asNumber = false, shown?: (v: Data) => string | undefined): string {
  const go = (x: Value) => showValue(x, code, names, asNumber, shown);
  if (shown && typeof v === "object" && v !== null && typeof v !== "function" && "tag" in v) { const t = shown(v); if (t !== undefined) return t; }
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number") return v - v === 0 ? floatText(v) : overflowed();
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return nodeOf(v) ? "<cell>" : "<function>";
  if (v.tag === ARRAY_TAG) return `array [${v.fields.slice(1).map((x) => go(x)).join(", ")}]`;
  if (v.tag === CONS || v.tag === NIL) return `[${fromList(v).map((x) => go(x)).join(", ")}]`;
  // Rational, Complex and Fixed show through their Shown (the prelude's,
  // given as `shown`); without it they show as what they're built from,
  // ratio(1, 3), which parseValue reads back (a seed, L205). Algebraic is
  // host code, with no Shown of its own.
  if (v.tag === ALGEBRAIC_V) return Alg.show(algebraicOf(v));
  // An Extended number reads as the number, or −∞ and +∞, through its own
  // Shown (the prelude's, C139).
  // A tuple reads as its type does, (1, "a") for an (Int, Text) (L143).
  if (TUPLE_TAG.test(v.tag)) return `(${v.fields.map((x) => go(x)).join(", ")})`;
  const name = names[v.tag] ?? v.tag;
  return v.fields.length ? `${name}(${v.fields.map((x) => go(x)).join(", ")})` : name;
}
const TUPLE_TAG = /^std\.tuple[2-8]\.tuple$/;
// The name of the case a value was made by (std.ts CASE_NAME): "" for a
// number, a text, an array (Array has no cases) or a cell.
export function caseName(v: Value, names: Names): string {
  if (typeof v !== "object" || v === null || v.tag === ARRAY_TAG) return "";
  return names[v.tag] ?? v.tag;
}

