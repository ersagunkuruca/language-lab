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
import { impl } from "../prelude.ts";
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
import { tupleVariant, floatText, WORLD_OPS, EXTENDED_V, ALGEBRAIC_V, ARRAY_TAG, ABORT, ABORT_OP, CELL_OPS, COMPARE, COMPLEX_V, FIXED_V, CONS, FALSE, HTML, IO, LOG, LOG_OP, CHECK_OP, NIL, NONE, NOW_OP, ORDER_V, RATIO, RANDOM, RANDOM_OP, S, SET, SHOW_ANY, shownImplementations, CASE_NAME, SOME, STD_IMPL, STD_MANY, stdNames, TIME, TRUE, UNIT_V, WAIT, WAIT_OP, AWAIT, AWAIT_OP, START_TIMER_OP, TICKET_V } from "./std.ts";
import { intLit } from "./int.ts";
import { JETS } from "./jets.ts";
import { answerFromHost, effectOfOperation, hostedEffects, type Hosts } from "./hosts.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import { Cells, NoValue, Pending, changeAt, listEdits, nodeOf, pathValue, stepsOf } from "./cells.ts";
import { seededGenerator, worldRandom, type Generator as RandomGenerator } from "./random.ts";
import { fieldIndex, fieldPath, placePath, setPath } from "./records.ts";
import { CELLS, CHOICE, DIVERGE, INT, NETWORK, WORLD, type Type } from "./types.ts";

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

// Cells' operations on a handler (cells.ts), by builtin id, for every
// runner of a program's values: the evaluator's here, and JavaScript
// printed from the core IR (compiler/src/core-js.ts). `call` runs a
// function the program gave and answers its value, or throws NoValue. A
// read with no answer (a formula that gave none, or no item at a place)
// is undefined. `path` is the evaluator's alone: it looks inside the
// function it is given.
export function cellOps(cells: Cells, call: (f: Value, ...xs: Value[]) => Value): Record<Id, (...xs: Value[]) => Value | undefined> {
  const listsHere = { ...LISTS, views: LIST_VIEWS };
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
export function* solveAnswers(code: Code, n: Use, known: Record<string, unknown>, opts: { spend?: () => boolean; names?: Names; stuck?: (r: Reading) => void; info?: Info; shown?: (v: Data) => string | undefined } = {}): Generator<Value[]> {
  const p = planSolve(code, n);
  if (p.mode === "relational") {
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

// The order on plain data (L66): numbers by value (Int, Float64 and
// fractions; Float64 exactly, numberOrder), text by code point, and other
// cases by their declaration order (`order`: a variant's place in its
// type, variantOrder), then their fields left to right, so lists go
// lexicographically with [] first. OCaml's `compare` and Erlang's term
// order (prior art). -1, 0 or 1. Where `equal` is near on Float64s, this
// is exact: 0.1 + 0.2 is after 0.3, and equal to it.
export function compareValues(a: Value, b: Value, order: Map<Id, number>): number {
  const todo: [Value, Value][] = [[a, b]];
  for (let p; (p = todo.pop());) {
    const [x, y] = p;
    if (typeof x === "number" && typeof y === "number") { const c = numberOrder(x, y); if (c) return c; continue; }
    if (typeof x === "bigint" || typeof y === "bigint") { if (x !== y) return (x as bigint) < (y as bigint) ? -1 : 1; continue; }
    if (typeof x === "string" && typeof y === "string") { if (x !== y) return T.less(x, y) ? -1 : 1; continue; }
    if (typeof x !== "object" || typeof y !== "object") continue;
    if (x.tag === RATIO && y.tag === RATIO) {
      const l = I.mul(x.fields[0] as I.Int, y.fields[1] as I.Int), r = I.mul(y.fields[0] as I.Int, x.fields[1] as I.Int);
      if (l !== r) return I.less(l, r) ? -1 : 1;
      continue;
    }
    if (x.tag === ALGEBRAIC_V && y.tag === ALGEBRAIC_V) { const c = Alg.compare(algebraicOf(x), algebraicOf(y)); if (c) return c; continue; }
    if (x.tag !== y.tag) return (order.get(x.tag) ?? 0) < (order.get(y.tag) ?? 0) ? -1 : 1;
    for (let i = x.fields.length - 1; i >= 0; i--) todo.push([x.fields[i], y.fields[i]]);
  }
  return 0;
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
// The variables in scope, as a linked list: binding one more shares the
// rest, so a call costs one cell per parameter, not a copy of the scope.
type Env = { b: Id; v: Value; up: Env } | null;
const lookup = (env: Env, b: Id): Value | undefined => {
  for (let e = env; e; e = e.up) if (e.b === b) return e.v;
  return undefined;
};
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
interface HandleFrame { t: "handle"; effect: Id; arms: Map<Id, NodeOf<"arm">>; done: Id | null; env: Env; base: number; fuel: Fuel | null; next: Frame | null }
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
  // false runs every library definition as written, never its jet
  // (jets.ts); test/jets.test.ts compares the two.
  jets?: boolean;
  // Told each time a function written as a lambda is called, with the
  // values it's called with (the editor seeds a definition's Run with them).
  // `copy`: the lambda entered, when it's a copy at another number type.
  entered?: (lambda: Id, args: Value[], copy: Id) => void;
  // Check's handler when the program has none (`lab test`, tests.ts):
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
  // Random's answer when the program has no handler: a Float64 in [0, 1).
  random(): number;
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
  if (!r) { const { code: c, info: i } = resolveArithmetic(code, info, names ?? {}); byInfo.set(info, (r = { code: c, info: i })); }
  return r;
}

export function makeRunner(code: Code, info: Info, rt: Runtime) {
  // The generic + resolved to each type's own (arith.ts); a program
  // without one is unchanged.
  ({ code, info } = resolvedFor(code, info, rt.names));
  // A copy at another number type is entered as the lambda it copies.
  const copyOf = info.copyOf;
  // Our own copy of the node table: `derivative` writes new code into it.
  code = { nodes: { ...code.nodes }, defs: code.defs };
  const defs = new Map<Id, Value>();
  const one = (x: Value): Iterable<Value> => [x];
  // Closures made by this runner, so the machine can enter them directly
  // instead of calling them as JS functions.
  const closures = new WeakMap<Fn, { lambda: NodeOf<"lambda">; env: Env }>();
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
    [COMPARE]: (a, b) => one(ORDER_VALUES[compareValues(a, b, (cmpOrder ??= variantOrder(code))) + 1]),
    [S.and]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.or]: (a, b) => one(bool((a as Data).tag === TRUE || (b as Data).tag === TRUE)),
    [S.not]: (a) => one(bool((a as Data).tag !== TRUE)),
    [S.range]: (n) => one(toList(Array.from({ length: Math.max(0, n as number) }, (_, i) => i))),
    [S.oneOf]: (xs) => fromList(xs),
    [S.exists]: (f) => one(bool(satisfiable(code, f))),
    [S.hence]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.fail]: () => [],
    // A record of Float64s, part by part. Float64 is a record of one part.
    [S.mapParts]: (f, r) => one(typeof r === "number" ? only(f as Fn, r) : { ...(r as Data), fields: (r as Data).fields.map((x) => only(f as Fn, x)) }),
    [S.zipParts]: (f, a, b) => one(typeof a === "number" ? only(f as Fn, a, b) : { ...(a as Data), fields: (a as Data).fields.map((x, i) => only(f as Fn, x, (b as Data).fields[i])) }),
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
      return run((machine) => machine.eval(derivativeLambda(code, m), fromMap("env" in m ? m.env : new Map())));
    },
    // The record a gradient is over is known once there's a point to take
    // it at; over a Float64 it's the derivative.
    [S.gradient]: (f) => {
      const m = (f as unknown as Record<symbol, { lambda: Id; env: Map<Id, Value> } | { prim: Id }>)[META];
      const env = fromMap("env" in m ? m.env : new Map());
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

  const closure = (n: NodeOf<"lambda">, env: Env): Fn => {
    const f = tag((...args: Value[]) => run((m) => m.apply(f, args)), { lambda: n.id, get env() { return toMap(env); } });
    closures.set(f, { lambda: n, env });
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
      const c = closures.get(f as Fn);
      if (c) {
        rt.entered?.(copyOf?.get(c.lambda.id) ?? c.lambda.id, args, c.lambda.id);
        return this.eval(c.lambda.body, bind(c.env, c.lambda.params, args));
      }
      const h = HANDLED.get(f as Fn);
      if (h) return this.handle(h, args);
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
      while (f && !(f.t === "handle" && f.effect === effect)) f = f.t === "answer" ? f.handler.next : f.next;
      return !!f;
    }

    perform(op: Id, args: Value[]) {
      const effect = effectOf(op)!;
      let f = this.k;
      while (f && !((f.t === "handle" || f.t === "seeded") && f.effect === effect)) f = f.t === "answer" ? f.handler.next : f.next;
      if (!f) return this.unhandled(op, args);
      if (f.t === "seeded") return this.ret(f.gen.next());
      const h = f as HandleFrame;
      const arm = h.arms.get(op)!;
      const variant = code.nodes[op] as NodeOf<"variant">;
      // Answered later: the case runs outside the match, as for one that
      // never returns, and is given the rest to resume once, or drop. A
      // case that leaves the rest out answers at once (L63).
      if (variant.later && variant.returns && arm.binds.length === variant.fields.length + 1) {
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
      this.cps.length = h.base;
      this.k = h.next;
      this.fuel = h.fuel;
      this.eval(arm.body, env);
    }

    // Resume a kept rest with the answer: its frames go on top of the
    // caller's, its handler again at their bottom (deep), its choice points
    // back on the stack. A rest runs once.
    resumeRest(r: Rest, answer: Value) {
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
      if (op === LOG_OP) return ((rt.world?.log ?? rt.print)(args[0] as string), this.ret(unit));
      if (op === ABORT_OP) throw new Aborted(args[0] as string);
      if (op === RANDOM_OP) return this.ret((rt.world?.random ?? worldRandom)());
      if (op === NOW_OP) return this.ret((rt.world?.now ?? Date.now)());
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
      if (rt.hosts && hosted.has(effectOfOperation(code, op) ?? "")) {
        let v: Value;
        try { v = answerFromHost(code, rt.names ?? {}, rt.hosts, op, args) as Value; } catch (e) { return this.perform(ABORT_OP, [(e as Error).message]); }
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
    go(): Value | typeof DONE {
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
            this.k = f.next;
            this.fuel = f.fuel;
            if (f.h === S.all) this.ret(toList(f.acc));
            else if (f.h === S.count) this.ret(f.acc.length);
            else if (f.h === S.optional) this.ret({ tag: NONE, fields: [] });
            else this.apply(f.otherwise, []);
            continue;
          }
          ambient = cp.fuel;
          const r = cp.it.next();
          if (r.done) { this.cps.pop(); continue; }
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
          if (h) this.push({ t: "handle", effect: h.effect, arms: h.arms, done: (n as NodeOf<"match">).otherwise, env, base: this.cps.length, fuel: this.fuel, next: null });
          else this.push({ t: n.kind, n, env, next: null } as Frame);
          return this.eval(n.scrutinee, env);
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
          this.push({ t: "parts", ids, i, vals: [...vals], env, n, next: null });
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
          const arm = f.n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === d.tag);
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
        case "handle": return f.done ? this.apply(this.atom(f.done, f.env)!, [v]) : this.ret(v);
        case "answer": return this.ret(v);
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
      let answers: Iterable<Value[]> = solveAnswers(code, n, known, { spend, names: rt.names, stuck: rt.stuck, info, shown: shownBy });
      if (solvesOnce(code, n)) {
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
  const handlers = new Map<Id, { effect: Id; arms: Map<Id, NodeOf<"arm">> } | null>();
  const handlerOf = (n: NodeOf<"match">) => {
    if (!handlers.has(n.id)) {
      const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
      const effect = arms.length ? effectOf(arms[0].variant) : null;
      handlers.set(n.id, effect ? { effect, arms: new Map(arms.map((a) => [a.variant, a])) } : null);
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

  const ev = (id: Id, env: Map<Id, Value>): Generator<Value> => run((m) => m.eval(id, fromMap(env)));

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
          // A library definition with a host way runs it (jets.ts).
          const jet = rt.jets === false ? undefined : JETS[target], self = defs.get(target);
          if (jet && typeof self === "function") { const j = jet(self as Fn); defs.set(target, j); defOf.set(j, target); }
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
        if (!parts.has(target)) parts.set(target, tag((...fields: Value[]) => one({ tag: target, fields }), { prim: target }));
        return parts.get(target)!;
      case "field": {
        if (!parts.has(target)) {
          const v = info.owner.get(target)!;
          const variant = (code.nodes[(code.nodes[v] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
          const i = (code.nodes[variant] as NodeOf<"variant">).fields.indexOf(target);
          parts.set(target, tag((d) => one((d as Data).fields[i]), { prim: target }));
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
    // values (the editor's chips, lab test's answers) to show them the same.
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
export const RUNTIME_HANDLES: readonly Id[] = discharge("a program's main", [...WORLD, CELLS, DIVERGE, NETWORK, LOG, ABORT, RANDOM, TIME, WAIT, AWAIT],
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
export function mainProblem(info: Info, def: Id, names: Names = {}): string | null {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length > 1) return "main takes the arguments (a list of texts), or nothing";
  return leftover(t, names);
}

// Can `def` be a page's main (WEB.md, `lab build-web`)? It takes nothing
// and returns the page, an Html. Null if it can, else why not.
export function pageProblem(info: Info, def: Id, names: Names = {}): string | null {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) return "a page's main takes nothing and returns the page (an Html)";
  const ret = info.subst.zonk(t.ret);
  if (ret.t !== "con" || ret.id !== HTML) return "a page's main returns the page (an Html)";
  return leftover(t, names);
}

// A program run from the command line (cli/lab.ts): `main` takes the
// arguments as a list of texts, or nothing, and returns the exit code (an
// Int or a Float64), or anything else for 0. An Abort that nothing handles
// prints its reason to standard error and exits with 1.
export function runProgram(code: Code, info: Info, def: Id, args: string[], rt: Runtime): number {
  const t = info.typeOf.get(def);
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

// A Fixed's steps of 2⁻³² as `show fixed` writes them: the shortest
// decimal that reads back to the same steps (Steele and White's
// free-format digits, 1990), the prelude's `fraction digits` in BigInts.
function fixedText(steps: bigint): string {
  const neg = steps < 0n, s = neg ? -steps : steps;
  const whole = s >> 32n, fraction = s & 0xffffffffn, unit = 1n << 33n;
  let text = "";
  for (let r = 2n * fraction, m = 1n, i = 0; fraction && i < 10; i++) {
    const r10 = r * 10n, m10 = m * 10n, d = r10 >> 33n, rest = r10 - (d << 33n);
    const low = rest < m10, high = unit - m10 < rest;
    if (low || high) { text += String(low && (!high || 2n * rest < unit) ? d : d + 1n); break; }
    text += String(d); r = rest; m = m10;
  }
  return `${neg ? "-" : ""}${whole}${text ? `.${text}` : ""}`;
}

// `asNumber` shows a Fixed or an Extended as the number it stands for:
// what `show` gives, the Run panel and a wire's value (L153). Without it a
// value shows as the constructor it is built from.
// `shown`, given, shows a value of a type with a Shown implementation
// (L205) through it; without it (the editor's chips, relate.ts) the
// prelude's number types show the same way by their tags below.
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
  // Float64 types show as numbers, as `show fraction` and `show complex` do.
  if (v.tag === RATIO) { const [top, bottom] = v.fields.map((x) => go(x)); return bottom === "1" ? top : `${top}/${bottom}`; }
  if (v.tag === ALGEBRAIC_V) return Alg.show(algebraicOf(v));
  if (v.tag === COMPLEX_V) { const [re, im] = v.fields as number[]; return `${go(re)} ${im < 0 ? "−" : "+"} ${go(Math.abs(im))}i`; }
  if (asNumber && v.tag === FIXED_V && (typeof v.fields[0] === "number" || typeof v.fields[0] === "bigint")) return fixedText(BigInt(v.fields[0]));
  // An Extended number reads as the number, or −∞ and +∞ (L125d).
  if (asNumber && v.tag === EXTENDED_V.finite) return go(v.fields[0]);
  if (asNumber && (v.tag === EXTENDED_V.minus || v.tag === EXTENDED_V.plus)) return v.tag === EXTENDED_V.minus ? "−∞" : "+∞";
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

