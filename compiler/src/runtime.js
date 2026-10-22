// What compiled programs link against. Small on purpose: everything the
// compiler can decide before running is already in the generated code, so
// this file only holds what has to happen at run time.
//
// Values have the same shape as in the evaluator (projectional/src/lang/
// run.ts): numbers, strings, functions, and data as { tag, fields }, so the
// two can be compared directly and can call each other.

import { plan, stream } from '../../invertible/src/relation.js';

export const TRUE = 'std.bool.true', FALSE = 'std.bool.false';
export const CONS = 'std.list.cons', NIL = 'std.list.nil';
export const $T = { tag: TRUE, fields: [] };
export const $F = { tag: FALSE, fields: [] };
export const $unit = { tag: 'std.unit.unit', fields: [] };
export const $nil = { tag: NIL, fields: [] };
export const $bool = (b) => (b ? $T : $F);
export const $cons = (h, t) => ({ tag: CONS, fields: [h, t] });

export function $toList(xs) {
  let l = $nil;
  for (let i = xs.length - 1; i >= 0; i--) l = $cons(xs[i], l);
  return l;
}

export function $range(n) {
  let l = $nil;
  for (let i = Math.max(0, n) - 1; i >= 0; i--) l = $cons(i, l);
  return l;
}

// Numbers are equal to the precision floats carry, as in the evaluator.
export const $near = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));

// With its own stack, so two long lists can be compared.
export function $eq(a, b) {
  const todo = [a, b];
  while (todo.length) {
    const y = todo.pop(), x = todo.pop();
    if (typeof x === 'number' && typeof y === 'number') { if (!$near(x, y)) return false; continue; }
    if (typeof x !== 'object' || typeof y !== 'object') { if (x !== y) return false; continue; }
    if (x.tag !== y.tag) return false;
    for (let i = x.fields.length - 1; i >= 0; i--) todo.push(x.fields[i], y.fields[i]);
  }
  return true;
}

// Int and text (projectional/src/lang/int.ts, text.ts), and the std
// builtins compiled code calls by id.
export * as $int from '../../projectional/src/lang/int.ts';
export * as $text from '../../projectional/src/lang/text.ts';
export { STD_IMPL as $impl, STD_MANY as $many } from '../../projectional/src/lang/std.ts';
export { setPath as $setPath } from '../../projectional/src/lang/records.ts';
import { showValue } from '../../projectional/src/lang/run.ts';
export const $showAny = (v, names) => showValue(v, null, names);

export const $show = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e9) / 1e9));
export const $mod = (a, b) => ((a % b) + b) % b;

// ---- handlers, for when the thunks aren't written in place ---------------
// (When they are, the compiler inlines the handler as a loop and none of
// these run.) A Choice function is a generator function; a function
// without Choice returns its one value.

export function $first(f, g) { for (const x of f()) return x; return g(); }
export function* $firstS(f, g) { for (const x of f()) { yield x; return; } yield* g(); }
export function $all(f) { return $toList([...f()]); }
export function $count(f) { let n = 0; for (const _ of f()) n++; return n; }

// ---- Diverge and fuel ----------------------------------------------------
// Each call into a definition the checker couldn't prove terminating spends
// one unit of the innermost active fuel. Running out is a failure: in code
// with Choice the call just yields nothing; in code without Choice it throws
// OUT, which the handler turns into "no result".

export const OUT = { outOfFuel: true };
const fuel = [];
export const $spend = () => !fuel.length || --fuel[fuel.length - 1].left >= 0;
export function $spendOrThrow() { if (!$spend()) throw OUT; }

// The frame is active exactly while the body is running, as in the
// evaluator, so a lazily consumed body still counts its own calls.
export function* $fuel(n, body, streams) {
  const frame = { left: n };
  if (!streams) {
    fuel.push(frame);
    let v;
    try { v = body(); } catch (e) { if (e === OUT) return; throw e; } finally { fuel.pop(); }
    yield v;
    return;
  }
  const it = body()[Symbol.iterator]();
  for (;;) {
    fuel.push(frame);
    let r;
    try { r = it.next(); } catch (e) { if (e === OUT) return; throw e; } finally { fuel.pop(); }
    if (r.done) return;
    yield r.value;
  }
}

// ---- relations -----------------------------------------------------------
// A solve whose plan the compiler couldn't turn into straight-line code
// (tearing, Newton, periodic branches, a degenerate 0·x = 0 case) runs the
// solver here, with the plan worked out once when the program loads.

export function $planned(rel, known) {
  return { rel, plan: plan(rel, known) };
}

export function* $solveRuntime({ rel, plan: p }, values, binds) {
  for (const s of stream(rel, p, values)) {
    const out = binds.map((b) => s.values[b]);
    if (out.some((x) => x === null || x === undefined)) continue;
    yield out;
  }
}

// Same rounding and finiteness rules as invertible/src/relation.js, so a
// compiled solve gives exactly the numbers the solver gives.
export const $ok = Number.isFinite;
export const $clean = (x) => (Math.abs(x) < 1e-12 ? 0 : +x.toPrecision(12));
export const $key = (xs) => xs.map((x) => Math.round(x * 1e8)).join();
export const $close = (l, r) => $ok(l) && $ok(r) && Math.abs(l - r) <= 1e-9 * (1 + Math.abs(l) + Math.abs(r));

// ---- the rest of what generated code uses ----------------------------------

export function* $oneOf(xs) { for (let l = xs; l.tag === CONS; l = l.fields[1]) yield l.fields[0]; }
export function* $fail() {}
// A function without Choice, passed where a Choice function is expected.
export function $lift(f) {
  const g = function* (...a) { yield f(...a); };
  if (f[META]) Object.defineProperty(g, META, { value: f[META] });
  return g;
}
export function $one(results) {
  for (const x of results) return x;
  throw new Error('a solve with exactly one answer had none (a non-finite number?)');
}
// Folds over nested data (a rose tree's List Tree): the trees inside a
// field, and the field rebuilt from their folded values.
export { spread as $spread } from '../../projectional/src/lang/nested.ts';
export const $self = (v) => ({ children: [v], rebuild: (r) => r[0] });
// With Choice: every combination of the children's folded values.
export function* $foldNested(fold, part) {
  const go = function* (i, acc) {
    if (i === part.children.length) { yield part.rebuild(acc); return; }
    for (const r of fold(part.children[i])) yield* go(i + 1, [...acc, r]);
  };
  yield* go(0, []);
}
export function $hole(id) { throw new Error(`the program reached a hole (${id})`); }

let printer = (s) => console.log(s);
export function $setPrint(p) { printer = p; }
export function $print(s) { printer(s); return $unit; }
export { FN as $FN } from '../../invertible/src/expr.js';

// ---- effects a program defines (projectional/LANGUAGE.md) -----------------
// Handlers are a stack. Performing an operation finds the nearest handler
// of its effect. An operation that returns calls that handler's case with
// the stack cut back to below the handler (cases run outside their own
// handler), and its value is the answer. One that never returns throws an
// Escape that the handler's match catches; the case then runs there, after
// the stack is unwound. No continuation is ever captured, which is what the
// two shapes of operation buy (Koka and Effekt compile tail-resumptive and
// abortive handlers the same way).

import { Aborted } from '../../projectional/src/lang/run.ts';
import { ABORT, ABORT_OP, LOG_OP, NONE, SOME } from '../../projectional/src/lang/std.ts';
export { Aborted as $Aborted };

const handlers = [];
class Escape {
  constructor(handler, op, args) { this.handler = handler; this.op = op; this.args = args; }
}

export function $perform(effect, op, args) {
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    if (h.effect !== effect) continue;
    if (!(op in h.answers)) throw new Escape(h, op, args);
    const above = handlers.splice(i);
    try { return h.answers[op](...args); } finally { handlers.push(...above); }
  }
  // What the program doesn't handle, the runtime does: Log goes to standard
  // error and an Abort ends the run.
  if (op === LOG_OP) { (world.log ?? printer)(args[0]); return $unit; }
  if (op === ABORT_OP) throw new Aborted(args[0]);
  throw new Error(`nothing handles ${op}`);
}

// A match handling `effect` around a computation with one result.
export function $handle(effect, answers, escapes, body) {
  const h = { effect, answers }, at = handlers.length;
  handlers.push(h);
  try { return body(); } catch (e) {
    if (!(e instanceof Escape) || e.handler !== h) throw e;
    handlers.length = at;
    return escapes[e.op](...e.args);
  } finally { handlers.length = at; }
}

// ... around a computation with Choice: the handler is on the stack while
// the computation runs, which is during each step of its generator. An
// escape ends it, alternatives and all, with the case's results.
export function* $handleS(effect, answers, escapes, body) {
  const h = { effect, answers };
  const it = body()[Symbol.iterator]();
  for (;;) {
    const at = handlers.length;
    handlers.push(h);
    let r;
    try { r = it.next(); } catch (e) {
      handlers.length = at;
      if (!(e instanceof Escape) || e.handler !== h) throw e;
      yield* escapes[e.op](...e.args);
      return;
    } finally { handlers.length = at; }
    if (r.done) return;
    yield r.value;
  }
}

// ---- the world ---------------------------------------------------------------
// The world effects' one handler. A program compiled for the command line
// sets Node's (projectional/src/lang/world.ts); without one, the
// operations abort saying so. Failures are an Abort where they were called.

let world = {};
export function $setWorld(w) { world = w ?? {}; }
const fallible = (k) => (...args) => {
  const f = world[k];
  let v;
  try {
    if (!f) throw new Error(`this runtime can't ${k}`);
    v = f.apply(world, args);
  } catch (e) { return $perform(ABORT, ABORT_OP, [e.message]); }
  return v;
};
const some = (v) => (v === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [v] });
export const $io = {
  printError: (s) => { (world.error ?? printer)(s); return $unit; },
  readInput: fallible('input'),
  readLine: (...a) => some(fallible('readLine')(...a)),
  readFile: fallible('readFile'),
  writeFile: (p, t) => (fallible('writeFile')(p, t), $unit),
  appendFile: (p, t) => (fallible('appendFile')(p, t), $unit),
  fileExists: (p) => $bool(!!world.fileExists?.(p)),
  listFolder: (p) => $toList(fallible('listFolder')(p)),
};

// Cells' handler: one per program, or the one the host gives (a page that
// watches cells shares its own).
import { Cells } from '../../projectional/src/lang/cells.ts';
let cells = null;
export const $cells = () => (cells ??= new Cells($eq));
export function $setCells(c) { cells = c; }

// optional: the first answer as some(answer), or none.
export function $optional(f) { for (const x of f()) return { tag: SOME, fields: [x] }; return { tag: NONE, fields: [] }; }

// ---- reflection: functions that are looked inside at run time -------------
// The relational interpreter (relate.ts) runs a function backwards from its
// nodes, and `derivative` builds a new function from them. Both are
// interpreters over the node table, so a program that uses them carries
// its node table, and its functions carry the node they came from (the
// evaluator's META). Making these directions compile too is the next stage
// (projectional/COMPILER.md).

import { META, makeRunner } from '../../projectional/src/lang/run.ts';
import { relate, satisfiable, toValue } from '../../projectional/src/lang/relate.ts';
import { ownerOfTypeParts } from '../../projectional/src/model.ts';

export function $loadProgram(code, divergent) {
  let runner;
  return {
    code,
    // The evaluator, for functions made while the program runs (derivatives).
    runner: () => (runner ??= makeRunner(code, { divergent: new Set(divergent), owner: ownerOfTypeParts(code) }, { print: (s) => printer(s) })),
  };
}

// Remember where a compiled function came from: its lambda node, and the
// values it closed over (made only when something asks).
export function $meta(f, lambda, env) {
  Object.defineProperty(f, META, { value: { lambda, get env() { return new Map(env ? env() : []); } } });
  return f;
}

// The evaluator calls every function as a stream of results; compiled
// functions without Choice return one value.
export function $toEval(f, streams) {
  if (streams || typeof f !== 'function') return f;
  const g = (...a) => [f(...a)];
  if (f[META]) Object.defineProperty(g, META, { value: f[META] });
  return g;
}

function fromEval(g, streams) {
  if (streams) return g;
  const f = (...a) => {
    for (const x of g(...a)) return x;
    throw new Error('a function without Choice gave no result');
  };
  if (g[META]) Object.defineProperty(f, META, { value: g[META] });
  return f;
}

export function* $relate(program, fn, known, binds) {
  for (const sol of relate(program.code, fn, known, { spend: $spend })) {
    const out = binds.map((b) => toValue(sol.values[b]));
    if (out.some((v) => v === undefined)) continue; // not pinned down: not an answer
    yield out;
  }
}

// for some: is there a value that makes f true? The relational interpreter
// searches, as it does for the evaluator.
export const $exists = (program, f) => $bool(satisfiable(program.code, f));

export function $derivative(program, f, streams) {
  const derivative = program.runner().value('builtin.derivative');
  for (const g of derivative(f)) return fromEval(g, streams);
  throw new Error('no derivative');
}
