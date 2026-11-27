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

import { madeItem } from "./over.ts";
import { type Data, type Fn, type Value, bool, unit, toList, fromList, cellOps, sameNumber, usedSameNumber, equal, numberOrder, overflowed, META, type Fuel, OutOfSteps, depth, spendStep, counted, pageOver, type FileFacts, fileInfoValue, Aborted, finiteFloat } from "./run-values.ts";
import { bytesValue, plainBytes } from "./bytes.ts";
import { plainRequest, responseValue, type PlainRequest, type PlainResponse } from "./network.ts";
import { bordered } from "./border.ts";
import { answerKeys, givenInOrder } from "./ports.ts";
import { nodesOfKindIn, dependencies, subtree, type Code, type Id, type NodeOf, type Use, useTarget, isCall, type Call, isUse, bindsOf, copyNodes, nodeValues, ownNodes } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl, preludeNames } from "../prelude.ts";
import { PRELUDE_DEFS } from "./prelude-ids.ts";
import { readByDescent } from "./descent.ts";
import { infer, type Info } from "./infer.ts";
import { derivativeLambda, gradientLambda, NotDifferentiable } from "./derive.ts";
import { arrayGradientLambda, expandArrayGradients, gradientOver } from "./pullback.ts";
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
import { ARRAY_OPS, ASK_PERMISSION_OP, PERMISSIONS, ENV_OP, ENVIRONMENT, PAIR_V, TENSOR, TENSOR_V } from "./std-ids.ts";
import { COMPUTE_ONLY, FILE_OPS, KEPT_FILES, LOCALE_V, MY_LOCALE_OP, MY_LATENCY_OP, MY_ZONE_OP, RELEASE_V, SETTINGS, WORLD_OPS, EXTENDED_V, ALGEBRAIC_V, ARRAY_TAG, ABORT, ABORT_OP, CELL_OPS, COMPARE, CONS, FALSE, HTML, IO, LOG, LOG_OP, CHECK_OP, NIL, NONE, NOW_OP, ORDER_V, RANDOM, RANDOM_OP, S, SET, SHOW_ANY, ORDERED, CASE_NAME, SOME, stdNames, TIME, TRUE, UNIT_V, WAIT, WAIT_OP, AWAIT, AWAIT_OP, START_TIMER_OP, TICKET_V } from "./std-ids.ts";
import { tupleVariant } from "./std-values.ts";
import { ArrayView, sortedBy, type ArrayValue } from "./array-view.ts";
import { floatText, shownImplementations, implementationsOf } from "./std-values.ts";
import { STD_IMPL, STD_MANY } from "./std-impl.ts";
import { intLit } from "./int.ts";
import { answeredEffects, jsHostHas, supported } from "./supports.ts";
import { answerFromHost, effectOfOperation, hostedEffects, pureEffect, pureHosts, stdHosted, type Hosts } from "./hosts.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import { Cells, NoValue, Pending, nodeOf, pathValue } from "./cells.ts";
import { seededGenerator, worldRandom, type Generator as RandomGenerator } from "./random.ts";
import { fieldIndex, fieldPath, placePath, setPath } from "./records.ts";
import { ARRAY, CELLS, CHOICE, DIVERGE, INT, NETWORK, NUMBER, Subst, WORLD, type Type } from "./types.ts";
import { reachedImplementing } from "./reached.ts";

// A program's values and a page's budget (run-values.ts), as every runner's.
export { type Data, type Fn, type Value, bool, unit, toList, fromList, LIST_SHAPE, LIST_SHAPE_BOOLS, cellOps, sameNumber, usedSameNumber, equal, numberOrder, overflowed, META, type Fuel, OutOfSteps, PAGE_STEPS, depth, withSteps, spendStep, stepsLeft, setStepsLeft, counted, pageOver, type FileFacts, fileInfoValue, Aborted, noAnswer, finiteFloat } from "./run-values.ts";


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
  for (const n of nodesOfKindIn(code.nodes, "typedef")) if (n.kind === "typedef") n.variants.forEach((v, i) => out.set(v, i));
  return out;
}
export const ORDER_VALUES = [ORDER_V.before, ORDER_V.same, ORDER_V.after].map((tag) => ({ tag, fields: [] as Value[] }));

const tag = <F extends Fn>(f: F, meta: { lambda: Id; readonly env: Map<Id, Value> } | { prim: Id }): F => Object.assign(f, { [META]: meta });

// The evaluator's machine steps, counted to ask a page's deadline (I310).
let machineTicks = 0;
// The direct search's calls, counted for the same (I310).
let searchTicks = 0;
// How many it has taken so far: work, for a caller weighing a run (C255).
export const evaluatorTicks = (): number => machineTicks;
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
  // What its runner knows of its lambda (run.ts Lam), found once.
  lam: unknown = undefined;
  constructor(node: NodeOf<"lambda">, scope: Env, by: object) { this.lambda = node.id; this.node = node; this.scope = scope; this.by = by; }
  get env() { return toMap(this.scope); }
}
// A call made last in a body run directly, for `enter` to make next (L281a).
// One made in a part of a constructor in the last place comes back with
// the value built around it so far: `top` the outermost, and the part
// (`hole`'s field `at`) where what the call gives goes (L281b).
// A builtin's one value at its inputs, or SLOW when the builtin itself
// must say (run.ts `fast`, L281j).
type Fast = (a: Value, b?: Value) => Value;
const SLOW = Symbol("slow") as unknown as Value;
class TailCall {
  readonly c: LambdaMeta;
  readonly args: Value[];
  top: Data | null = null;
  hole: Data | null = null;
  at = 0;
  constructor(c: LambdaMeta, args: Value[]) { this.c = c; this.args = args; }
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
  // `and` or `or` with its first input worked out (L259): a value tagged
  // `by` decides it, else the second input is its value.
  | { t: "decide"; by: Id; rest: Id; env: Env }
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
  // Told when a definition's value starts and stops being worked out, the
  // first time it is asked for (a constant: mnist-page's digits, made from
  // 74 KB of text once and kept).
  valuing?: (def: Id, on: boolean) => void;
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
  // Counted while the run goes (L280d, cli/choices.ts measuredLines): each
  // call node listed, by the job it is, and what it gave now and then.
  measure?: Measure;
}
// A run's measurements: the calls to count, by node, each the job it
// counts as; `gave` told what a call was given and gave at its 1st, 2nd,
// 4th, … call and every 4096th after.
export interface Measure { calls: ReadonlyMap<Id, string>; counts: Map<string, number>; gave: (job: string, v: unknown) => void }

// What the world effects do. A failure throws, with a message that becomes
// the reason the program's Abort is given.
// An environment variable's answer as Optional Text (L253), NFC as all
// text that comes in.
export const environmentValue = (v: string | null): Value => (v === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [v.normalize("NFC")] });

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
  // A file's kind, size in bytes and modified time in seconds since 1970
  // (L282), read without following a link.
  fileInfo?(path: string): FileFacts;
  // A file or folder to the platform's own app (L283).
  openOutside?(path: string): void;
  // A file's bytes as they are, and bytes written (L189c, bytes.ts).
  readBytes?(path: string): Uint8Array;
  writeBytes?(path: string, bytes: Uint8Array): void;
  // A file handed to the person to keep, and one they choose (L271): a
  // world without them has no person to hand one to or ask.
  offerFile?(name: string, bytes: Uint8Array): void;
  askForFile?(kinds: string): Uint8Array;
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
  // Permissions' (L236, std.ts): whether the person gave this one. A world
  // without it answers yes, as a command line has no such dialog.
  askPermission?(what: string): boolean;
  // Settings' sound latency (C260): seconds from a sample coming in to it
  // being heard, as the platform reports them. A world without it reports
  // none: 0.
  soundLatency?(): number;
  // Environment's (L253): a variable's value, null where it isn't set. A
  // world without it has none set.
  environmentVariable?(name: string): string | null;
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


// resolveArithmetic's answer for a version of the code and its check: the
// editor makes a runner for each of a definition's traces when it opens
// (its values, main's run for its seed, a backward search), and resolving
// calc took about a second each time (I158). What it gives isn't changed
// after (makeRunner copies the nodes before writing).
// Keyed by the program and its check only: the names change only the
// wording of a refusal (thrown, so not kept) and the names it gives back,
// which no caller here reads.
const resolved = new WeakMap<Code, WeakMap<Info, { code: Code; info: Info }>>();
// Whether the program's own code uses gradient (or value and gradient).
const asksGradient = (code: Code) => ownNodes(code).some((n) => n.kind === "ref" && (n.target === S.gradient || n.target === S.valueAndGradient));
export function resolvedFor(code: Code, info: Info, names: Names | undefined): { code: Code; info: Info } {
  let byInfo = resolved.get(code);
  if (!byInfo) resolved.set(code, (byInfo = new WeakMap()));
  let r = byInfo.get(info);
  if (!r) {
    // gradient(f) over an array of another Number (Dual), made ahead and
    // checked again (pullback.ts): its pass back's arithmetic is then
    // resolved with the rest, which code made as it runs isn't.
    // gradient(f) over an array of another Number, or over a record
    // (one pass back for all its fields, as compiled: pullback.ts).
    const overOther = (call: Id) => { const o = gradientOver(code, info, call); return !!o && (o.of === ARRAY || o.of === TENSOR ? !!o.item && o.item !== NUMBER : o.of !== NUMBER); };
    const grads = asksGradient(code) ? expandArrayGradients(code, names ?? {}, info, overOther) : { code, names: names ?? {}, expanded: [] };
    // The check again holds no pins: the code here may be resolved already
    // (lowered, its generic < written at Float64 as its one use needs),
    // which the library's pins, of the definitions as written, refuse.
    const [from, check] = grads.expanded.length ? [grads.code, infer(grads.code, grads.names, undefined, { ...info.options, pins: undefined })] : [code, info];
    const { code: c, info: i } = resolveArithmetic(from, check, grads.names);
    byInfo.set(info, (r = { code: c, info: i }));
    resolvedAlready(c, i);
  }
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
    code = { nodes: copyNodes(code.nodes), defs: code.defs };
    // It is resolved: a solve inside the run (relate.ts interpreter) reads
    // this copy, and resolving it again walked every node twice a solve
    // (I176: about 1.2 s opening board's `stage from key`).
    resolvedAlready(code, info);
  };
  const defs = new Map<Id, Value>();
  // `and` and `or` work out their second input only when the first doesn't
  // decide (BACKLOG L259, Ersagun 2026-11-14), as nearly every language
  // does: `t > 0 and x / t > 1` is false when t is 0, not no answer, and
  // `false and member(x, xs)` is one false, not one for each member. The
  // value that decides a call to one of them, or null for another call.
  // Prior art: McCarthy's conditional `and` and `or` (1960), C's && and ||.
  const shortCircuitOf = (n: Call): Id | null => {
    const h = n.args.length === 2 ? code.nodes[n.fn] : undefined;
    return h?.kind !== "ref" ? null : h.target === S.and ? FALSE : h.target === S.or ? TRUE : null;
  };
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
  // Each builtin's one value, where it has exactly one, worked out with
  // no list made around it (L281j): a direct run calls these. SLOW where
  // the inputs need the builtin itself (an overflow, a failure, anything
  // but numbers), which then runs as ever.
  const fast = new Map<Fn, Fast>();
  const finite1 = (f: (a: number) => number): Fast => (a) => { if (typeof a === "number" && a - a === 0) { const r = f(a); if (r - r === 0) return r; } return SLOW; };
  const finite2 = (f: (a: number, b: number) => number): Fast => (a, b) => { if (typeof a === "number" && typeof b === "number" && a - a === 0 && b - b === 0) { const r = f(a, b); if (r - r === 0) return r; } return SLOW; };
  const finiteFast = (f: (...a: number[]) => number) => (f.length === 1 ? finite1(f) : f.length === 2 ? finite2(f) : undefined);
  for (const [op, f] of Object.entries(impl)) {
    const b: Fn = builtins[`builtin.${op}`] = op === "atan2"
      ? (y, x) => finiteFloat(op, f((y as number) + 0, (x as number) + 0), [y as number, x as number]) // −0 is 0: atan2(−0, −1) is π
      : (...a) => finiteFloat(op, f(...(a as number[])), a as number[]);
    const q = op === "atan2" ? undefined : finiteFast(f as (...a: number[]) => number);
    if (q) fast.set(b, q);
  }
  for (const [id, f] of Object.entries(STD_IMPL)) {
    const floats = id === S.mod || id === S.abs || id === S.floor || id === S.float32;
    const b: Fn = builtins[id] = floats
      ? (...a) => finiteFloat(id === S.mod ? "mod" : id, f(...a) as number, a as number[])
      : (...a) => one(f(...a));
    const q = floats ? finiteFast(f as (...a: number[]) => number) : (f as Fast);
    if (q) fast.set(b, q);
  }
  for (const [id, f] of Object.entries(STD_MANY)) builtins[id] = (...a) => f(...a);
  // gradient(f): the record it is over is known once there's a point to
  // take it at; over a Float64 it's the derivative.
  const gradientOf = (f: Value): Fn => {
    const m = (f as unknown as Record<symbol, { lambda: Id; env: Map<Id, Value> } | { prim: Id }>)[META];
    const env = fromMap("env" in m ? m.env : new Map());
    writable();
    return function* (p: Value) {
      // At an array, in one pass back (pullback.ts, L285); where a slope
      // can't be read there, there is none.
      // Over another Number, only as made ahead (resolvedFor).
      if (p instanceof ArrayView && p.n > 0 && typeof p.buf.items[p.start] !== "number") throw new Error("gradient over an array of another Number than Float64 needs its function written where gradient is called");
      let lambda: Id;
      try {
        lambda = typeof p === "number" || !("lambda" in m) ? derivativeLambda(code, m) : p instanceof ArrayView || (p as Data).tag === TENSOR_V ? arrayGradientLambda(code, m.lambda, (id) => info.copyOf?.get(id) ?? id, info) : gradientLambda(code, m, (p as Data).tag);
      } catch (e) { if (e instanceof NotDifferentiable) return; throw e; }
      for (const g of run((machine) => machine.eval(lambda, env))) yield* (g as Fn)(p);
    } as Fn;
  };
  const ones: Record<Id, (...xs: Value[]) => Value> = {
    [S.less]: (a, b) => bool(numberOrder(a as number, b as number) < 0),
    [S.equal]: (a, b) => bool(equal(a, b, usedSameNumber)),
    [S.and]: (a, b) => bool((a as Data).tag === TRUE && (b as Data).tag === TRUE),
    [S.or]: (a, b) => bool((a as Data).tag === TRUE || (b as Data).tag === TRUE),
    [S.not]: (a) => bool((a as Data).tag !== TRUE),
  };
  Object.assign(builtins, {
    [S.less]: (a, b) => one(ones[S.less](a, b)),
    // Showing an overflow uses it (L218).
    [S.show]: (x) => ((x as number) - (x as number) === 0 ? one(floatText(x as number)) : overflowed()),
    [S.stop]: (why) => { throw new Aborted(why as string); },
    [S.equal]: (a, b) => one(ones[S.equal](a, b)),
    [COMPARE]: (a, b) => one(ORDER_VALUES[compareValues(a, b, (cmpOrder ??= variantOrder(code)), orderedBy) + 1]),
    [ARRAY_OPS.sorted]: (a) => one(sortedBy(a as ArrayValue, (x, y) => compareValues(x as Value, y as Value, (cmpOrder ??= variantOrder(code)), orderedBy)) as unknown as Value),
    [S.and]: (a, b) => one(ones[S.and](a, b)),
    [S.or]: (a, b) => one(ones[S.or](a, b)),
    [S.not]: (a) => one(ones[S.not](a)),
    [S.range]: (n) => one(toList(Array.from({ length: Math.max(0, n as number) }, (_, i) => (madeItem(i), i)))),
    [S.oneOf]: (xs) => fromList(xs),
    // With the run's own check, which this copy has until a derivative
    // writes nodes into it (I190: each `for some` checked the whole program
    // again, 1.4 s of the editor's 120 ms run of Numbers' main).
    [S.exists]: (f) => one(bool(satisfiable(code, f, wrote ? {} : { info, names: rt.names }))),
    // Answered by this run's host (supports.ts, L234), from the function's
    // type: a command folds it before the run, the editor asks here.
    [S.supports]: (f) => {
      const m = (f as unknown as Record<symbol, { lambda?: Id; prim?: Id }>)[META];
      return one(bool(!m?.lambda || supported(info.typeOf.get(m.lambda), code, answeredEffects(code, jsHostHas(rt.hosts)))));
    },
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
    [IO.fileInfo]: (p) => one(fileInfoValue(world("fileInfo")!(p as string))),
    [IO.openOutside]: (p) => (world("openOutside")!(p as string), one(unit)),
    [IO.readBytes]: (p) => one(bytesValue(world("readBytes")!(p as string)) as Value),
    [IO.writeBytes]: (p, b) => (world("writeBytes")!(p as string, plainBytes(b)), one(unit)),
    [IO.offerFile]: (n, b) => (world("offerFile")!(n as string, plainBytes(b)), one(unit)),
    [IO.askForFile]: (k) => one(bytesValue(world("askForFile")!(k as string)) as Value),
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
    // An action's value, or `shown` while what it asked for hasn't come
    // (L255): its run is a builtin's call, so a wait there is taken back.
    [S.whileWaiting]: function* (body, shown) {
      let got: Value[];
      try { got = [...(body as Fn)()]; } catch (e) { if (e instanceof Pending) { yield shown; return; } throw e; }
      yield* got;
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
    [S.gradient]: (f) => one(gradientOf(f)),
    // f(p) and gradient(f)(p), each of f's answers with each slope.
    [S.valueAndGradient]: (f) => one(function* (p: Value) {
      const g = gradientOf(f);
      for (const v of (f as Fn)(p)) for (const d of g(p)) yield { tag: PAIR_V, fields: [v, d] };
    } as Fn),
  } satisfies Record<Id, Fn>);
  for (const id of Object.keys(ones)) fast.set(builtins[id], ones[id] as Fast);
  for (const [id, f] of Object.entries(builtins)) tag(f, { prim: id });
  const HANDLED = new Map<Fn, Id>([S.all, S.count, S.first, S.optional, S.fuel, S.seeded].map((h) => [builtins[h], h]));
  // Builtins that touch the world and can fail: a failure is an Abort,
  // performed where they were called.
  const hosted = hostedEffects(code, rt.hosts);
  const timers = worldTimers((m) => { throw new Aborted(m); });
  const FALLIBLE = new Set<Fn>([...Object.keys(impl).map((op) => `builtin.${op}`), S.mod, S.float32, IO.readFile, IO.writeFile, IO.appendFile, IO.listFolder, IO.fileInfo, IO.openOutside, IO.readBytes, IO.offerFile, IO.askForFile, IO.writeBytes, IO.readInput, IO.readLine, IO.fetchText, IO.startFetch, IO.sendRequest].map((id) => builtins[id]));
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
  // A direct run stopped after calls made last: the machine goes on from
  // the last call (enter, I369).
  class ResumeAt { c: LambdaMeta; args: Value[]; constructor(c: LambdaMeta, args: Value[]) { this.c = c; this.args = args; } }
  // A direct run that gives no value (a `fail`, a builtin with none): the
  // run has no choice points, so the call it is in has none either, and
  // where it began fails (the machine's choice point) or a search's branch
  // does (L281d).
  const FAILED = new Error("no value");
  // The builtins that only compute (their type's row has at most a choice
  // and diverging: one that gives no value or several stops the run), and
  // the library's host ways, which are pure.
  const pureFns = new Set<Fn>(), pureJets = new WeakSet<Fn>();
  const computeOnly = new Set(COMPUTE_ONLY);
  for (const [id, f] of Object.entries(builtins)) if (computeOnly.has(id) && !HANDLED.has(f) && !worldOps.has(f)) pureFns.add(f);
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
  // What is known of each lambda, kept on its closures so that a call
  // looks nothing up (L281f): its tries and stops (one that stops often
  // stays on the machine), what its type says, and its body made.
  type Lam = { n: number; stops: number; only: boolean; acts: boolean; chooses: boolean; body: Direct | undefined; search: Search | undefined };
  const lams = new Map<Id, Lam>();
  const lamOf = (c: LambdaMeta): Lam => {
    let l = c.lam as Lam | undefined;
    if (l) return l;
    l = lams.get(c.lambda);
    if (!l) lams.set(c.lambda, l = { n: 0, stops: 0, only: false, acts: acts(c.node), chooses: chooses(c.node), body: undefined, search: undefined });
    return (c.lam = l);
  };
  const stopped = (c: LambdaMeta) => {
    const t = lamOf(c);
    t.stops++;
    if (t.stops > 4 && t.stops * 4 > t.n) t.only = true;
  };
  // Whether a call runs directly: one that only computes, or, when nothing
  // counts fuel, one that may fail too (failsAtMost below).
  const runsDirect = (c: LambdaMeta, fuel: Fuel | null): boolean => { const l = lamOf(c); return !l.only && (!l.acts || (!fuel && l.chooses)); };
  const single = (r: Iterable<Value>): Value => {
    if (Array.isArray(r)) { if (r.length === 1) return r[0]; throw r.length ? NEED : FAILED; }
    const it = r[Symbol.iterator](), a = it.next();
    if (a.done) throw FAILED;
    if (!it.next().done) throw NEED;
    return a.value;
  };
  // A function whose type says it may fail but never gives two values
  // runs directly when nothing counts fuel: one that may choose stops at
  // its first choice (NEED), one that fails gives FAILED. `lookup entry`
  // and `value at` ran on the machine (pond's page, 2.3 million calls).
  // How deep in direct runs this is: a machine started inside one (a
  // builtin or host way calling a function back) may act on nothing
  // either, so its world builtins and operations stop the run too, before
  // they act.
  let directDepth = 0;
  // The `with fuel` a direct run spends from (L281c): each call into a
  // definition that may not end spends one, as on the machine. Running out
  // stops the run, and the machine runs the call again from the fuel there
  // was, so it runs out where the machine does.
  let directFuel: Fuel | null = null;
  const spendDirect = () => { if (directFuel) { if (--directFuel.left < 0) throw NEED; } else spendStep(); };
  const underFuel = <T,>(fuel: Fuel, f: () => T): T => {
    const left = fuel.left, was = directFuel, around = ambient;
    directFuel = fuel; ambient = fuel;
    // (A failure, which spends as the machine would only from the same
    // place, runs again on the machine too.)
    try { return f(); } catch (e) { fuel.left = left; throw e === FAILED ? NEED : e; } finally { directFuel = was; ambient = around; }
  };
  // Of the searches, those whose spending doesn't hang on the order they
  // look in (every answer is looked for), run directly under fuel too.
  const searchesUnder = (h: Id, fuel: Fuel | null) => SEARCHES.has(h) && (!fuel || h === S.all || h === S.count);
  const builtinFns = new Set<Fn>(Object.values(builtins));
  // A call in a body's last place to a function that runs directly too
  // comes back here as a TailCall, and is made in the same loop, not on
  // the JavaScript stack: a function calling itself last (`copies onto`
  // making a looper's minutes-long tape a sample at a time) runs as a
  // loop, however many times it calls itself (L281a).
  // A call made last inside a constructor (`cons(change(item), map(rest,
  // change))`) is made in the loop too, and what it gives is put in the
  // constructor's part, so `map` over a list of any length runs as a loop
  // (L281b; tail recursion modulo cons, prior art: Friedman and Wise 1975,
  // OCaml's [@tail_mod_cons]).
  const enter = (c0: LambdaMeta, args0: Value[], resumable = false): Value => {
    let c = c0, args = args0;
    // What the call gives, and the part still to fill in it, if any.
    let result: Value = 0, hole: Data | null = null, at = 0, moved = false;
    directDepth++;
    try {
      while (true) {
        const l = lamOf(c);
        l.n++;
        rt.entered?.(copyOf?.get(c.lambda) ?? c.lambda, args, c.lambda);
        const r = (l.body ??= compiledLastOf(c.node.body))(bind(c.scope, c.node.params, args));
        if (!(r instanceof TailCall)) {
          if (!hole) return r;
          hole.fields[at] = r;
          return result;
        }
        if (r.top) {
          if (hole) hole.fields[at] = r.top; else result = r.top;
          hole = r.hole; at = r.at;
        }
        c = r.c; args = r.args; moved = true;
      }
    }
    catch (e) {
      const stops = e === NEED || e instanceof RangeError;
      if (e instanceof Aborted && aborts(c0.node)) e = NEED;
      if (e === NEED || e instanceof RangeError) { stopped(c0); if (c !== c0) stopped(c); }
      // Stopped after calls made last: those gave nothing anyone can see,
      // so what is left is the call made last, run on a machine of its own
      // (what it gives put where it goes, L281b). Starting again from the
      // first call, agent's search ran its first 3,000 steps again on each
      // stop: 29,000 steps became over 86,000 (I368). Under fuel, from the
      // first, which spends as the machine does.
      // The machine that called goes on from it (ResumeAt), with its
      // handlers and its choices: a machine of its own here ran each
      // nested stop again inside the last (json's parses never ended,
      // I370). Not with a part still to fill, nor from inside another
      // direct run, whose call wasn't made last: those start again.
      if (stops && moved && resumable && !hole) throw new ResumeAt(c, args);
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
    if (c && runsDirect(c, directFuel)) return enter(c, args);
    const q = fast.get(f as Fn);
    if (q) { const v = args.length === 1 ? q(args[0]) : args.length === 2 ? q(args[0], args[1]) : SLOW; if (v !== SLOW) return v; }
    const h = HANDLED.get(f as Fn);
    if (h && searchesUnder(h, directFuel)) {
      // Under fuel the whole run goes to the machine, which runs out where
      // it should (a machine of its own here would end only its part).
      try { return handledDirect(h, args); } catch (e) { if (e !== NEED && !(e instanceof RangeError)) throw e; if (directFuel) throw NEED; }
    }
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
  // Nodes in a body's last place, made apart: their calls to functions
  // that run directly give a TailCall for `enter` to make (L281a).
  const compiledLast = new Map<Id, Direct>();
  const needs: Direct = () => { throw NEED; };
  // Whether a scope given from outside (ev) binds something besides binders.
  let looseScopes = false;
  // A match or fold measured (L280d): counted, and now and then what it
  // takes apart sized.
  const measuredAt = (id: Id): ((v: Value) => void) | undefined => {
    const m = rt.measure, job = m?.calls.get(id);
    if (!m || job === undefined) return undefined;
    return (v) => {
      const c = (m.counts.get(job) ?? 0) + 1;
      m.counts.set(job, c);
      if ((c & (c - 1)) === 0 || (c & 4095) === 0) m.gave(job, v);
    };
  };
  const compile = (id: Id): Direct => {
    const d = compileNode(id);
    compiled.set(id, d);
    return d;
  };
  const compiledOf = (id: Id): Direct => compiled.get(id) ?? compile(id);
  const compileLast = (id: Id): Direct => {
    const d = compileNode(id, true);
    compiledLast.set(id, d);
    return d;
  };
  const compiledLastOf = (id: Id): Direct => compiledLast.get(id) ?? compileLast(id);
  // `last`: whether the node is in its body's last place (what it gives is
  // what the body gives).
  function compileNode(id: Id, last = false): Direct {
    // Its parts in the last place too, made as it is.
    const partOf = last ? compiledLastOf : compiledOf;
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
        // Its value is kept too: a constructor's function, or the value of
        // one with no parts, which nothing changes (L281h).
        if (t?.kind === "variant" || t?.kind === "field") {
          let v: Value | undefined;
          return (env) => (looseScopes ? refValue(target, env) : (v ??= refValue(target, null)));
        }
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
        // `and` and `or` work out their second input only when the first
        // doesn't decide (L259, short-circuit.ts).
        const sc = shortCircuitOf(n);
        if (sc !== null) {
          let second: Direct | undefined;
          return (env) => { const x = argsOf()[0](env) as Data; return x.tag === sc ? x : (second ??= partOf(n.args[1]))(env); };
        }
        // A call measured (L280d): counted, and now and then what it was
        // given and what it gave.
        const m = rt.measure, job = m?.calls.get(id);
        if (m && job !== undefined) {
          let f: Direct | undefined;
          return (env) => {
            if (steps) spendDirect();
            const g = (f ??= compiledOf(n.fn))(env), as = argsOf(), vs = new Array<Value>(k);
            for (let i = 0; i < k; i++) vs[i] = as[i](env);
            const c = (m.counts.get(job) ?? 0) + 1;
            m.counts.set(job, c);
            const v = callDirect(g, vs);
            if ((c & (c - 1)) === 0 || (c & 4095) === 0) for (const x of [v, ...vs]) m.gave(job, x);
            return v;
          };
        }
        if (head.kind === "lambda") {
          let body: Direct | undefined;
          const params = head.params;
          return (env) => {
            const as = argsOf(), vs = new Array<Value>(k);
            for (let i = 0; i < k; i++) vs[i] = as[i](env);
            return (body ??= partOf(head.body))(bind(env, params, vs));
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
          // In the last place, its last part that's a call is worked out
          // last, in the last place too (L281b).
          let j = -1;
          if (last) for (let i = k - 1; i >= 0 && j < 0; i--) if (code.nodes[n.args[i]].kind !== "lit" && code.nodes[n.args[i]].kind !== "ref" && code.nodes[n.args[i]].kind !== "lambda") j = i;
          if (j >= 0) {
            let lastPart: Direct | undefined;
            return (env) => {
              const as = argsOf(), vs = new Array<Value>(k);
              for (let i = 0; i < k; i++) if (i !== j) vs[i] = as[i](env);
              if (looseScopes) { vs[j] = as[j](env); return callDirect((fn ??= compiledOf(n.fn))(env), vs); }
              const r = (lastPart ??= compiledLastOf(n.args[j]))(env);
              const d: Data = { tag: tg, fields: vs };
              if (!(r instanceof TailCall)) { vs[j] = r; return d; }
              vs[j] = r.top ?? 0;
              if (!r.top) { r.hole = d; r.at = j; }
              r.top = d;
              return r as unknown as Value;
            };
          }
          return (env) => {
            const as = argsOf(), vs = new Array<Value>(k);
            for (let i = 0; i < k; i++) vs[i] = as[i](env);
            if (looseScopes) return callDirect((fn ??= compiledOf(n.fn))(env), vs);
            return { tag: tg, fields: vs };
          };
        }
        // A builtin with one value, called with no list of inputs made
        // (L281j); the general call where it can't say.
        const b0 = part?.kind === "builtin" ? builtins[target!] : undefined, q = b0 && (k === 1 || k === 2) ? fast.get(b0) : undefined;
        if (q && !steps) {
          const general: Direct = (env) => { const f = (fn ??= compiledOf(n.fn))(env), as = argsOf(), vs = new Array<Value>(k); for (let i = 0; i < k; i++) vs[i] = as[i](env); return callDirect(f, vs); };
          if (k === 1) return (env) => {
            if (looseScopes) return general(env);
            const a = argsOf()[0](env), v = q(a);
            return v !== SLOW ? v : callDirect(b0!, [a]);
          };
          return (env) => {
            if (looseScopes) return general(env);
            const as = argsOf(), a = as[0](env), b = as[1](env), v = q(a, b);
            return v !== SLOW ? v : callDirect(b0!, [a, b]);
          };
        }
        if (last) return (env) => {
          if (steps) spendDirect();
          const f = (fn ??= compiledOf(n.fn))(env), as = argsOf(), vs = new Array<Value>(k);
          for (let i = 0; i < k; i++) vs[i] = as[i](env);
          const c = closureOf(f);
          return c && runsDirect(c, directFuel) ? (new TailCall(c, vs) as unknown as Value) : callDirect(f, vs);
        };
        return (env) => {
          if (steps) spendDirect();
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
        const seen = measuredAt(id);
        return (env) => {
          const d = (scrutinee ??= compiledOf(n.scrutinee))(env) as Data, arm = arms.get(d.tag);
          if (seen) seen(d);
          if (arm) return (arm.body ??= partOf(arm.id))(bind(env, arm.binds, d.fields));
          return (otherwise ??= partOf(n.otherwise!))(env);
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
        const bodies = new Map<Id, Direct>(), seen = measuredAt(id);
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
          const d = (scrutinee ??= compiledOf(n.scrutinee))(env) as Data;
          if (seen) seen(d);
          return go(d);
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
  const searchOf = (id: Id): Search => { const d = searchNode(id); searches.set(id, d); return d; };
  const searchingNeeds: Search = () => { throw NEED; };
  // A node's search, found when first run and kept where it is run.
  const searchAt = (id: Id): (() => Search) => { let d: Search | undefined; return () => (d ??= searches.get(id) ?? searchOf(id)); };
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
    // A page's deadline here too: a search through definitions that end
    // spends no step and runs no machine (Countdown's view, 0.5 s before
    // its first ask; Check main 11-23 saw 2.4 s).
    if ((++searchTicks & 1023) === 0 && pageOver()) throw new OutOfSteps();
    const c = closureOf(f);
    const l = c && lamOf(c);
    if (l && !l.only) {
      if (!l.acts) { let v: Value; try { v = enter(c!, args); } catch (e) { if (e === FAILED) return false; throw e; } return k(v); }
      if (l.chooses) {
        rt.entered?.(copyOf?.get(c!.lambda) ?? c!.lambda, args, c!.lambda);
        return (l.search ??= searches.get(c!.node.body) ?? searchOf(c!.node.body))(bind(c!.scope, c!.node.params, args), k);
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
    if (h) { let v: Value; try { v = handledDirect(h, args); } catch (e) { if (e === FAILED) return false; throw e; } return k(v); }
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
        const one = argIds.map((a) => (simple(a) ? compiledOf(a) : null)), sArgs = argIds.map(searchAt);
        // The arguments' values, left to right, each one's alternatives in turn.
        const each = (env: Env, i: number, vs: Value[], done: (vs: Value[]) => boolean): boolean => {
          for (; i < count && one[i]; i++) vs[i] = one[i]!(env);
          if (i === count) return done(vs.slice());
          return sArgs[i]()(env, (v) => { vs[i] = v; return each(env, i + 1, vs, done); });
        };
        const sc = shortCircuitOf(n);
        if (sc !== null) return (env, k) => sArgs[0]()(env, (x) => ((x as Data).tag === sc ? k(x) : sArgs[1]()(env, k)));
        if (head.kind === "lambda") {
          const params = head.params, body = searchAt(head.body);
          return (env, k) => each(env, 0, new Array<Value>(count), (vs) => body()(bind(env, params, vs), k));
        }
        const fn = n.fn;
        if (simple(fn)) {
          const f0 = compiledOf(fn);
          if (one.every((d) => d)) return (env, k) => {
            if (steps) spendDirect();
            const f = f0(env), vs = new Array<Value>(count);
            for (let i = 0; i < count; i++) vs[i] = one[i]!(env);
            return callSearch(f, vs, k);
          };
          // A step for each call, once its inputs are chosen (I293).
          return (env, k) => { const f = f0(env); return each(env, 0, new Array<Value>(count), (vs) => { if (steps) spendDirect(); return callSearch(f, vs, k); }); };
        }
        const sFn = searchAt(fn);
        return (env, k) => sFn()(env, (f) => each(env, 0, new Array<Value>(count), (vs) => { if (steps) spendDirect(); return callSearch(f, vs, k); }));
      }
      case "match": {
        if (handlerOf(n)) return searchingNeeds;
        const scrutinee = n.scrutinee, otherwise = n.otherwise == null ? undefined : searchAt(n.otherwise);
        const arms = new Map([...matchArms(n)].map(([tag, arm]) => [tag, { binds: arm.binds, body: searchAt(arm.body) }]));
        if (simple(scrutinee)) {
          const sd = compiledOf(scrutinee);
          return (env, k) => {
            const d = sd(env) as Data, arm = arms.get(d.tag);
            if (arm) return arm.body()(bind(env, arm.binds, d.fields), k);
            return otherwise!()(env, k);
          };
        }
        const sScrutinee = searchAt(scrutinee);
        return (env, k) => sScrutinee()(env, (d) => {
          const arm = arms.get((d as Data).tag);
          if (arm) return arm.body()(bind(env, arm.binds, (d as Data).fields), k);
          return otherwise!()(env, k);
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
    if (!SEARCHES.has(h) || !body || lamOf(body).only || !lamOf(body).chooses) throw NEED;
    lamOf(body).n++;
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
      if (e === NEED || e instanceof RangeError) stopped(body);
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
  // A run no machine is going around (a call from outside: a page's part,
  // a test's) is under no `with fuel`: the innermost one the last builtin
  // call left behind is someone else's, perhaps run out (I295: countdown's
  // search had no answers after a run its fuel cut off).
  function* run(start: (m: Machine) => void): Generator<Value> {
    const m = new Machine(depth === 0 ? null : ambient);
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
    // Running out of a `with fuel` ends its whole action, with no answer
    // (SPEC 5.6, I294): the choice points made inside it go, an `all` or
    // `count` inside it among them, so none gives what it had so far.
    outOfFuel() {
      // A machine inside a direct run under fuel (L281c) can't end the
      // whole action: the run stops, and the machine around runs it.
      if (directFuel) throw NEED;
      const b = this.fuel?.base;
      if (b !== undefined && this.cps.length > b) this.cps.length = b;
      this.fail();
    }
    push(f: Frame) { f.next = this.k; this.k = f; }

    // Call a function value with its arguments, in the current continuation.
    apply(f: Value, args: Value[]): void {
      const rest = rests.get(f as Fn);
      if (rest) return this.resumeRest(rest, args[0]);
      const c = closureOf(f);
      if (c) {
        // Directly first (L118c), spending from its fuel (L281c).
        const fuel = this.fuel;
        if (runsDirect(c, fuel)) {
          try { return this.ret(fuel ? underFuel(fuel, () => enter(c, args)) : enter(c, args, true)); } catch (e) {
            if (e === FAILED) return this.fail();
            if (e instanceof ResumeAt) { rt.entered?.(copyOf?.get(e.c.lambda) ?? e.c.lambda, e.args, e.c.lambda); return this.eval(e.c.node.body, bind(e.c.scope, e.c.node.params, e.args)); }
            if (e !== NEED && !(e instanceof RangeError)) throw e;
          }
        }
        rt.entered?.(copyOf?.get(c.lambda) ?? c.lambda, args, c.lambda);
        return this.eval(c.node.body, bind(c.scope, c.node.params, args));
      }
      const h = HANDLED.get(f as Fn);
      if (h) {
        // A search run directly first (L118d).
        const fuel = this.fuel;
        if (searchesUnder(h, fuel)) { try { return this.ret(fuel ? underFuel(fuel, () => handledDirect(h, args)) : handledDirect(h, args)); } catch (e) { if (e === FAILED) return this.fail(); if (e !== NEED && !(e instanceof RangeError)) throw e; } }
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
      if (op === MY_LATENCY_OP) return this.ret(rt.world?.soundLatency?.() ?? 0);
      if (op === ASK_PERMISSION_OP) return this.ret(bool((rt.world?.askPermission ?? (() => true))(args[0] as string)));
      if (op === ENV_OP) return this.ret(environmentValue(rt.world?.environmentVariable?.(args[0] as string) ?? null));
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
        this.fuel = { left: args[0] as number, base: this.cps.length };
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
        // A page's deadline, where no step is spent (I310: a view of
        // Countdown's searched for 1.2 s through definitions that end).
        if ((++machineTicks & 4095) === 0 && pageOver()) throw new OutOfSteps();
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
          const sc = shortCircuitOf(n);
          if (sc !== null) { this.push({ t: "decide", by: sc, rest: n.args[1], env, next: null }); return this.eval(n.args[0], env); }
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
        // Each call into a possibly-divergent definition spends fuel, if a
        // `with fuel` handler is active. Out of fuel means no result. Once
        // its inputs are worked out, so a call made again for each answer
        // of a choice in them spends each time (I293: countdown's
        // `results(choices(numbers))`, 326 calls and one step).
        if (head.kind === "ref" && info.divergent.has(head.target)) {
          if (!this.fuel) spendStep();
          else if (--this.fuel.left < 0) return this.outOfFuel();
        }
        // A call measured (L280d), made in an action: counted, and now and
        // then what it was given (what it gives comes later, to its frame).
        const m = rt.measure, job = m?.calls.get(n.id);
        if (m && job !== undefined) {
          const c = (m.counts.get(job) ?? 0) + 1;
          m.counts.set(job, c);
          if ((c & (c - 1)) === 0 || (c & 4095) === 0) for (let i = 1; i < vals.length; i++) m.gave(job, vals[i]);
        }
        return this.apply(vals[0], vals.slice(1));
      }
      this.solve(n, vals, env);
    }

    resume(f: Frame) {
      const v = this.val;
      // A match or fold measured (L280d), its value taken apart now.
      if ((f.t === "match" || f.t === "fold") && rt.measure) { const m = rt.measure, job = m.calls.get(f.n.id); if (job !== undefined) { const c = (m.counts.get(job) ?? 0) + 1; m.counts.set(job, c); if ((c & (c - 1)) === 0 || (c & 4095) === 0) m.gave(job, v); } }
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
        case "decide": return (v as Data).tag === f.by ? this.ret(v) : this.eval(f.rest, f.env);
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
          rt.valuing?.(target, true);
          try { for (const v of run((m) => m.eval(t.body!, null))) { defs.set(target, v); if (typeof v === "function") defOf.set(v, target); break; } } finally { rt.valuing?.(target, false); }
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
const REACTIVE: readonly Id[] = [CELL_OPS.formula, CELL_OPS.each, CELL_OPS.eachArray, CELL_OPS.eachOf];
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
export const RUNTIME_HANDLES: readonly Id[] = discharge("a program's main", [...WORLD, CELLS, DIVERGE, NETWORK, LOG, ABORT, RANDOM, TIME, WAIT, AWAIT, SETTINGS, PERMISSIONS, ENVIRONMENT, KEPT_FILES],
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
// `hosted`: effects a host answers while main builds the page (a native
// app's hosts/c.c or hosts/android.java, C204).
export function pageProblem(info: Info, def: Id, names: Names = {}, hosted: Set<Id> = new Set()): string | null {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) return "a page's main takes nothing and returns the page (an Html)";
  const ret = info.subst.zonk(t.ret);
  if (ret.t !== "con" || ret.id !== HTML) return "a page's main returns the page (an Html)";
  return leftover(t, names, hosted);
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
// Run on what main reaches (reached.ts, L265), as the compiler lowers it:
// resolving the whole program typed every library body when a step before
// it (an embedding put in) left the library's kept resolving unusable,
// about 4 s for numbers. Once per program, check and main, so a program
// run many times keeps its resolving (resolvedFor).
const reachedRuns = new WeakMap<Code, WeakMap<Info, Map<Id, Code>>>();
function reachedRun(code: Code, info: Info, def: Id): Code {
  let byInfo = reachedRuns.get(code);
  if (!byInfo) reachedRuns.set(code, (byInfo = new WeakMap()));
  let byDef = byInfo.get(info);
  if (!byDef) byInfo.set(info, (byDef = new Map()));
  let r = byDef.get(def);
  if (!r) byDef.set(def, (r = reachedImplementing(code, [def], info)));
  return r;
}

export function runProgram(code: Code, info: Info, def: Id, args: string[], rt: Runtime): number {
  code = reachedRun(code, info, def);
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

