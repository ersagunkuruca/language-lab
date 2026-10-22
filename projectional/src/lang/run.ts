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
// (Console, Files) have one handler, the runtime's `World`; Log and Abort,
// when nothing in the program handles them, go to it too.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import type { Info } from "./infer.ts";
import { derivativeLambda } from "./derive.ts";
import { fieldShapes, shapeOf, spread, type Shape } from "./nested.ts";
import { relate, satisfiable, toValue } from "./relate.ts";
import { planSolve, solutions } from "./solve.ts";
import { ABORT, ABORT_OP, CELL_OPS, CONS, FALSE, IO, LOG, LOG_OP, NIL, NONE, S, SET, SHOW_ANY, SOME, STD_IMPL, STD_MANY, stdNames, TRUE, UNIT_V } from "./std.ts";
import { intLit } from "./int.ts";
import { Cells, NoValue, nodeOf } from "./cells.ts";
import { fieldIndex, fieldPath, setPath } from "./records.ts";
import { CELLS, CHOICE, DIVERGE, INT, WORLD, type Type } from "./types.ts";

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

// Numbers stand for reals and floats only approximate them, so two numbers
// are equal when they agree to the precision floats carry. Otherwise a
// predicate like distance = speed·time + ½·g·time² would be false for the
// very values the solver found for it.
export const close = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));

// With its own stack, so two long lists can be compared.
export function equal(a: Value, b: Value): boolean {
  const todo: [Value, Value][] = [[a, b]];
  for (let p; (p = todo.pop());) {
    const [x, y] = p;
    if (typeof x === "number" && typeof y === "number") { if (!close(x, y)) return false; continue; }
    if (typeof x !== "object" || typeof y !== "object") { if (x !== y) return false; continue; }
    if (x.tag !== y.tag) return false;
    for (let i = x.fields.length - 1; i >= 0; i--) todo.push([x.fields[i], y.fields[i]]);
  }
  return true;
}

// Function values remember the node they came from (a lambda and the
// variables it closed over, or a builtin, constructor or projection), so the
// relational interpreter and `derivative` can look inside them.
export const META = Symbol("node");
const tag = <F extends Fn>(f: F, meta: { lambda: Id; readonly env: Map<Id, Value> } | { prim: Id }): F => Object.assign(f, { [META]: meta });

interface Fuel { left: number }
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
interface HandleFrame { t: "handle"; effect: Id; arms: Map<Id, NodeOf<"arm">>; env: Env; base: number; fuel: Fuel | null; next: Frame | null }
// An arm of a fold: the fields with folded values, and whether each holds
// the type nested in a container (List Tree) rather than directly.
interface FoldArm { arm: NodeOf<"arm">; rec: number[]; nested: boolean[]; shapes: (Shape | null)[] }
interface FoldCtx { arms: Map<Id, FoldArm>; env: Env }
// The children of one value to fold first, and how their results become
// the arm's folded values.
interface Kids { kids: Data[]; folded: (results: Value[]) => Value[] }
type Frame = { next: Frame | null } & (
  | { t: "parts"; ids: Id[]; i: number; vals: Value[]; env: Env; n: NodeOf<"call"> | NodeOf<"solve"> }
  | { t: "match"; n: NodeOf<"match">; env: Env }
  | { t: "fold"; n: NodeOf<"fold">; env: Env }
  | { t: "foldChild"; ctx: FoldCtx; d: Data; arm: FoldArm; kids: Kids; results: Value[] }
  | { t: "fuelExit"; saved: Fuel | null }
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
}

// An Abort that nothing in the program handled.
export class Aborted extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export function makeRunner(code: Code, info: Info, rt: Runtime) {
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
  const builtins: Record<Id, Fn> = {};
  for (const [op, f] of Object.entries(impl)) builtins[`builtin.${op}`] = (...a) => one(f(...(a as number[])));
  for (const [id, f] of Object.entries(STD_IMPL)) builtins[id] = (...a) => one(f(...a));
  for (const [id, f] of Object.entries(STD_MANY)) builtins[id] = (...a) => f(...a);
  Object.assign(builtins, {
    [S.less]: (a, b) => one(bool((a as number) < (b as number))),
    [S.equal]: (a, b) => one(bool(equal(a, b))),
    [S.and]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.or]: (a, b) => one(bool((a as Data).tag === TRUE || (b as Data).tag === TRUE)),
    [S.not]: (a) => one(bool((a as Data).tag !== TRUE)),
    [S.range]: (n) => one(toList(Array.from({ length: Math.max(0, n as number) }, (_, i) => i))),
    [S.oneOf]: (xs) => fromList(xs),
    [S.exists]: (f) => one(bool(satisfiable(code, f))),
    [S.hence]: (a, b) => one(bool((a as Data).tag === TRUE && (b as Data).tag === TRUE)),
    [S.fail]: () => [],
    [S.print]: (s) => (rt.print(s as string), one(unit)),
    [IO.printError]: (s) => (world("error")(s as string), one(unit)),
    [IO.readInput]: () => one(world("input")()),
    [IO.readLine]: () => { const l = world("readLine")(); return one(l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l] }); },
    [IO.readFile]: (p) => one(world("readFile")(p as string)),
    [IO.writeFile]: (p, t) => (world("writeFile")(p as string, t as string), one(unit)),
    [IO.appendFile]: (p, t) => (world("appendFile")(p as string, t as string), one(unit)),
    [IO.fileExists]: (p) => one(bool(world("fileExists")(p as string))),
    [IO.listFolder]: (p) => one(toList(world("listFolder")(p as string))),
    [CELL_OPS.cell]: (v) => one(cells.cell(v)),
    [CELL_OPS.formula]: (f) => one(cells.formula(() => {
      for (const v of (f as Fn)()) return v;
      throw new NoValue("this formula gave no value");
    })),
    // A formula that gave no value (it ran out of `with fuel`) is a read
    // with no answer; it is computed again at the next read.
    [CELL_OPS.read]: (c) => {
      try { return one(cells.read(c)); } catch (e) { if (e instanceof NoValue) return []; throw e; }
    },
    [CELL_OPS.write]: (c, v) => (cells.write(c, v), one(unit)),
    [SHOW_ANY]: (v) => one(showValue(v, code, rt.names ?? stdNames)),
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
    // Every function value carries its node, so this can always look inside.
    [S.derivative]: (f) => {
      const m = (f as unknown as Record<symbol, { lambda: Id; env: Map<Id, Value> } | { prim: Id }>)[META];
      return run((machine) => machine.eval(derivativeLambda(code, m), fromMap("env" in m ? m.env : new Map())));
    },
  } satisfies Record<Id, Fn>);
  for (const [id, f] of Object.entries(builtins)) tag(f, { prim: id });
  const HANDLED = new Map<Fn, Id>([S.all, S.count, S.first, S.optional, S.fuel].map((h) => [builtins[h], h]));
  // Builtins that touch the world and can fail: a failure is an Abort,
  // performed where they were called.
  const FALLIBLE = new Set<Fn>([IO.readFile, IO.writeFile, IO.appendFile, IO.listFolder, IO.readInput, IO.readLine].map((id) => builtins[id]));
  function world<K extends keyof World>(k: K): World[K] {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" || k === "log" ? "write to standard error" : k}`); }) as unknown as World[K];
    return f.bind(rt.world) as World[K];
  }
  // Operations of effects, as function values.
  const effectOf = (variant: Id): Id | null => {
    const def = info.owner.get(variant);
    const body = def ? (code.nodes[def] as NodeOf<"def">).body : null;
    return body && (code.nodes[body] as NodeOf<"typedef">).effect ? def! : null;
  };
  const operations = new Map<Fn, Id>();

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
    while (true) {
      const v = m.go();
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
    apply(f: Value, args: Value[]) {
      const c = closures.get(f as Fn);
      if (c) {
        return this.eval(c.lambda.body, bind(c.env, c.lambda.params, args));
      }
      const h = HANDLED.get(f as Fn);
      if (h) return this.handle(h, args);
      const op = operations.get(f as Fn);
      if (op) return this.perform(op, args);
      ambient = this.fuel;
      if (FALLIBLE.has(f as Fn)) {
        let r: Iterable<Value>;
        try { r = (f as Fn)(...args); } catch (e) { return this.perform(ABORT_OP, [(e as Error).message]); }
        return this.from(r, (x) => this.ret(x as Value));
      }
      this.from((f as Fn)(...args), (x) => this.ret(x as Value));
    }

    // Perform an operation: find the nearest match handling its effect,
    // skipping the ones whose cases are running (their own effects go
    // further out). An operation that returns is answered and the
    // computation carries on; one that doesn't ends the handled computation,
    // with its alternatives (a cut, as in Prolog's catch/3).
    perform(op: Id, args: Value[]) {
      const effect = effectOf(op)!;
      let f = this.k;
      while (f && !(f.t === "handle" && f.effect === effect)) f = f.t === "answer" ? f.handler.next : f.next;
      if (!f) return this.unhandled(op, args);
      const h = f as HandleFrame;
      const arm = h.arms.get(op)!;
      const env = bind(h.env, arm.binds, args);
      if ((code.nodes[op] as NodeOf<"variant">).returns) {
        this.push({ t: "answer", handler: h, next: null });
        return this.eval(arm.body, env);
      }
      this.cps.length = h.base;
      this.k = h.next;
      this.fuel = h.fuel;
      this.eval(arm.body, env);
    }

    // What the program leaves unhandled, the runtime handles: Log goes to
    // standard error and an Abort ends the run.
    unhandled(op: Id, args: Value[]) {
      if (op === LOG_OP) return ((rt.world?.log ?? rt.print)(args[0] as string), this.ret(unit));
      if (op === ABORT_OP) throw new Aborted(args[0] as string);
      throw new Error(`nothing handles ${op}`);
    }

    handle(h: Id, args: Value[]) {
      if (h === S.fuel) {
        this.push({ t: "fuelExit", saved: this.fuel, next: null });
        this.fuel = { left: args[0] as number };
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
          const head = code.nodes[n.fn];
          const target = head.kind === "ref" ? head.target : null;
          // Each call into a possibly-divergent definition spends fuel, if a
          // `with fuel` handler is active. Out of fuel means no result.
          if (target && info.divergent.has(target) && this.fuel && --this.fuel.left < 0) return this.fail();
          // A lambda written in place (a let, a dot) is entered, not made.
          if (head.kind === "lambda") return this.parts(n.args, 0, [], env, n);
          return this.parts([n.fn, ...n.args], 0, [], env, n);
        }
        case "match": case "fold": {
          const h = n.kind === "match" ? handlerOf(n) : null;
          if (h) this.push({ t: "handle", effect: h.effect, arms: h.arms, env, base: this.cps.length, fuel: this.fuel, next: null });
          else this.push({ t: n.kind, n, env, next: null } as Frame);
          return this.eval(n.scrutinee, env);
        }
        case "solve":
          return this.parts(Object.values(n.given), 0, [], env, n);
        case "hole": throw new Error("the program reached a hole");
        default: throw new Error(`can't evaluate a ${n.kind}`);
      }
    }

    // Evaluate the parts of a call (or a solve's givens) left to right,
    // earlier choices varying slowest.
    parts(ids: Id[], i: number, vals: Value[], env: Env, n: NodeOf<"call"> | NodeOf<"solve">) {
      for (; i < ids.length; i++) {
        const a = this.atom(ids[i], env);
        if (a === undefined) {
          this.push({ t: "parts", ids, i, vals: [...vals], env, n, next: null });
          return this.eval(ids[i], env);
        }
        vals.push(a);
      }
      if (n.kind === "call") {
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
          const results = [...f.results, v];
          if (results.length < f.kids.kids.length) {
            this.push({ ...f, results, next: null });
            return this.foldValue(f.ctx, f.kids.kids[results.length]);
          }
          return this.foldBody(f.ctx, f.d, f.arm, f.kids.folded(results));
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
        // The computation a handler watched has its value: that's the
        // match's value. An answer goes back to where it was asked for.
        case "handle": case "answer": return this.ret(v);
      }
    }

    // Walk down the first recursive field until a case without one, leaving
    // a frame at each level.
    foldValue(ctx: FoldCtx, d: Data) {
      for (;;) {
        const arm = ctx.arms.get(d.tag)!;
        const kids = kidsOf(arm, d);
        if (!kids.kids.length) return this.foldBody(ctx, d, arm, kids.folded([]));
        this.push({ t: "foldChild", ctx, d, arm, kids, results: [], next: null });
        d = kids.kids[0];
      }
    }

    foldBody(ctx: FoldCtx, d: Data, arm: FoldArm, folded: Value[]) {
      let inner = bind(ctx.env, arm.arm.binds, d.fields);
      arm.rec.forEach((i, k) => (inner = { b: arm.arm.results[i]!, v: folded[k], up: inner }));
      this.eval(arm.arm.body, inner);
    }

    solve(n: NodeOf<"solve">, vals: Value[], env: Env) {
      const keys = Object.keys(n.given);
      const known = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
      const p = planSolve(code, n);
      const fuel = () => this.fuel;
      const bodies = function* (): Generator<Value[]> {
        if (p.mode === "relational") {
          // Each step that might unfold forever spends the innermost fuel.
          const spend = () => { const f = fuel(); return !(f && --f.left < 0); };
          for (const sol of relate(code, n.fn, known, { spend, names: rt.names })) {
            const bound = Object.keys(n.binds).map((k) => toValue(sol.values[k]));
            if (bound.some((v) => v === undefined)) continue; // not pinned down: not an answer
            yield bound as Value[];
          }
          return;
        }
          // A predicate's out = true isn't one of the solver's ports.
        const values = Object.fromEntries(p.known.map((k) => [k, known[k] as number]));
        for (const sol of solutions(p.rel!, values)) {
          // A port the equations leave free has no value: not a solution.
          if (Object.keys(n.binds).some((k) => sol[k] === null || sol[k] === undefined)) continue;
          yield Object.keys(n.binds).map((k) => sol[k]!);
        }
      };
      this.from(bodies(), (bound) => this.eval(n.body, bind(env, Object.values(n.binds), bound)));
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
          for (const v of run((m) => m.eval(t.body!, null))) { defs.set(target, v); break; }
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
    value: (def: Id) => refValue(def, null),
    // Call a function value and stream its results.
    call: (f: Value, ...args: Value[]) => (f as Fn)(...args),
  };
}

// Run an action (a definition of type () -> ...). Only effects the runtime
// can handle may be left: the world's, Diverge, Log and Abort (which ends
// the run with Aborted). Anything else (an unhandled Choice) is reported
// before anything runs.
export function runMain(code: Code, info: Info, def: Id, rt: Runtime = { print: (s) => console.log(s) }): Value {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) throw new Error("only an action (a function with no inputs) can be run");
  return start(code, info, def, t, [], rt);
}

function start(code: Code, info: Info, def: Id, t: Type, args: Value[], rt: Runtime): Value {
  if (t.t !== "fn") throw new Error("not a function");
  const extra = t.eff.effs.filter((e) => !RUNTIME_HANDLES.includes(e));
  if (extra.length) throw new Error(`unhandled effect: ${extra.join(", ")}; ${extra.includes(CHOICE) ? "wrap it in first, all, count or optional" : "handle it with a match on its operations"}`);
  const r = makeRunner(code, info, rt);
  for (const v of r.call(r.value(def), ...args)) return v;
  throw new Error("no result");
}
const RUNTIME_HANDLES = [...WORLD, CELLS, DIVERGE, LOG, ABORT];

// A program run from the command line (cli/lab.ts): `main` takes the
// arguments as a list of texts, or nothing, and returns the exit code (an
// Int or a Number), or anything else for 0. An Abort that nothing handles
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

export function showValue(v: Value, code: Code, names: Names): string {
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return nodeOf(v) ? "<cell>" : "<function>";
  if (v.tag === CONS || v.tag === NIL) return `[${fromList(v).map((x) => showValue(x, code, names)).join(", ")}]`;
  const name = names[v.tag] ?? v.tag;
  return v.fields.length ? `${name}(${v.fields.map((x) => showValue(x, code, names)).join(", ")})` : name;
}

