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
export function $fromList(l) {
  const out = [];
  for (; l.tag === CONS; l = l.fields[1]) out.push(l.fields[0]);
  return out;
}
// Destination passing (compile.ts, `$into` copies; GAPS.md P4): a list's
// items pushed onto an array; a function that has an `$into` version
// writes its list straight into one.
export function $pushList(d, l) {
  for (; l.tag === CONS; l = l.fields[1]) d.push(l.fields[0]);
}
export const $withInto = (f, into) => ((f.$into = into), f);
export function $arrayOf(f, ...args) {
  if (!f.$into) return $fromList(f(...args));
  const d = [];
  f.$into(d, ...args);
  return d;
}
// How cells.ts each turns lists into arrays and back.
export const $listArrays = { from: $fromList, to: $toList };

// A list kept from the other end, { a, n }: the list a[n − 1], …, a[0]
// (compile.ts, `growable`; GAPS.md G21). Consing onto it pushes when nothing
// has pushed past n yet, and copies otherwise, so older lists don't change.
export function $snoc(v, x) {
  const a = v.n === v.a.length ? v.a : v.a.slice(0, v.n);
  a.push(x);
  return { a, n: v.n + 1 };
}
// Its items in list order.
export function $fromBack(v) {
  const out = new Array(v.n);
  for (let i = 0; i < v.n; i++) out[v.n - 1 - i] = v.a[i];
  return out;
}

export function $range(n) {
  let l = $nil;
  for (let i = Math.max(0, n) - 1; i >= 0; i--) l = $cons(i, l);
  return l;
}

// Numbers are equal to the precision floats carry, as in the evaluator.
export const $near = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));

// `equal` on two numbers, one rule on every type, as in the evaluator
// (run.ts `sameNumber`): whole numbers exactly, others near.
// run.ts sameNumber: near on every JS number; an Int past 2^28 is a BigInt.
export const $sameNumber = (a, b) => $near(a, b);

// With its own stack, so two long lists can be compared.
export function $eq(a, b) {
  // Text, numbers and other plain values answer at once, with no stack of
  // pairs to compare (GAPS.md G17).
  if (typeof a !== 'object') return typeof a === 'number' && typeof b === 'number' ? $sameNumber(a, b) : a === b;
  const same = $sameNumber;
  const todo = [a, b];
  while (todo.length) {
    const y = todo.pop(), x = todo.pop();
    if (typeof x === 'number' && typeof y === 'number') { if (!same(x, y)) return false; continue; }
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
// A Choice builtin's answer, or $no: each has at most one (GAPS.md G24).
import { STD_MANY } from '../../projectional/src/lang/std.ts';
export const $partial = Object.fromEntries(Object.entries(STD_MANY).map(([id, f]) => [id, (...xs) => { const a = f(...xs); return a.length ? a[0] : $no; }]));
export { setPath as $setPath } from '../../projectional/src/lang/records.ts';
import { showValue, compareValues, ORDER_VALUES } from '../../projectional/src/lang/run.ts';
export const $showAny = (v, names) => showValue(v, null, names);
// `compare` (L66): `order` is each case's place in its type (compile.ts
// writes it as $order), so cases compare as in the evaluator.
export const $compare = (a, b, order) => ORDER_VALUES[compareValues(a, b, order) + 1];

export const $show = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e9) / 1e9));
export const $mod = (a, b) => ((a % b) + b) % b;
// A record of Numbers part by part (std.ts); a Number is one part.
export const $mapParts = (f, r) => (typeof r === 'number' ? f(r) : { tag: r.tag, fields: r.fields.map((x) => f(x)) });
export const $zipParts = (f, a, b) => (typeof a === 'number' ? f(a, b) : { tag: a.tag, fields: a.fields.map((x, i) => f(x, b.fields[i])) });
export const $total = (r) => (typeof r === 'number' ? r : r.fields.reduce((x, y) => x + y));

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
// Outside any `with fuel`, a step is free, except under a page's budget
// (run.ts, withSteps), which throws when it runs out.
export const $spend = () => (fuel.length ? --fuel[fuel.length - 1].left >= 0 : (spendStep(), true));
export function $spendOrThrow() { if (!$spend()) throw OUT; }
export const $outOfFuel = (e) => e === OUT;

// ---- deep recursion (compile.ts, C21) ------------------------------------
// How many calls of definitions with a heap copy are on JavaScript's stack
// (run.ts keeps it, so a page's update starts where it was even when one
// is cut off). A catch that goes on puts back what it was at its try.
export { depth as $rec } from '../../projectional/src/lang/run.ts';
import { depth as $rec } from '../../projectional/src/lang/run.ts';
// Runs a heap copy: each yield names a heap copy to call and its arguments,
// whose answer (or exception) goes back in where it yielded. The calls
// waiting are an array here, not frames on the stack.
export function $drive(g) {
  const stack = [g];
  let v, thrown = false;
  for (;;) {
    const top = stack[stack.length - 1];
    let r;
    try { r = thrown ? top.throw(v) : top.next(v); } catch (e) {
      stack.pop();
      if (!stack.length) throw e;
      v = e;
      thrown = true;
      continue;
    }
    thrown = false;
    if (r.done) {
      stack.pop();
      v = r.value;
      if (!stack.length) return v;
    } else {
      stack.push(r.value[0](...r.value[1]));
      v = undefined;
    }
  }
}

// The frame is active exactly while the body is running, as in the
// evaluator, so a lazily consumed body still counts its own calls.
export function* $fuel(n, body, streams) {
  const frame = { left: n };
  if (!streams) {
    fuel.push(frame);
    let v;
    const d = $rec.d;
    try { v = body(); } catch (e) { if (e === OUT) { $rec.d = d; return; } throw e; } finally { fuel.pop(); }
    yield v;
    return;
  }
  const it = body()[Symbol.iterator]();
  for (;;) {
    fuel.push(frame);
    let r;
    const d = $rec.d;
    try { r = it.next(); } catch (e) { if (e === OUT) { $rec.d = d; return; } throw e; } finally { fuel.pop(); }
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
// $clean is the solver's +x.toPrecision(12), without the string: 12
// digits as a whole number n, then n over a power of ten, which division
// rounds correctly, as reading the digits back would. Where n might be a
// half away from where the product put it, or out of the powers' range,
// it asks toPrecision (the pedal's tanh was mostly this string: GAPS.md P1).
const TENS = Array.from({ length: 23 }, (_, i) => 10 ** i);
export const $clean = (x) => {
  const a = Math.abs(x);
  if (a < 1e-12) return 0;
  if (!(a < 1e22)) return +x.toPrecision(12);
  const k = 11 - Math.floor(Math.log10(a));
  if (k > 22 || k < -22) return +x.toPrecision(12);
  const t = k >= 0 ? a * TENS[k] : a / TENS[-k];
  if (Math.abs(t - Math.floor(t) - 0.5) < 1e-3 || t < 1e11 - 1 || t >= 1e12) return +x.toPrecision(12);
  const n = Math.round(t), r = k >= 0 ? n / TENS[k] : n * TENS[-k];
  return x < 0 ? -r : r;
};
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
// A Choice function with at most one answer returns it, or $no for none
// (GAPS.md G14). Where a stream of answers is needed, $stream0 makes one.
export const $no = Symbol('no answer');
export const $stream0 = (f) => function* (...a) { const r = f(...a); if (r !== $no) yield r; };
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

import { Aborted, OutOfSteps, spendStep } from '../../projectional/src/lang/run.ts';
import { ABORT, ABORT_OP, LOG_OP, NONE, NOW_OP, RANDOM, RANDOM_OP, SOME, WAIT_OP } from '../../projectional/src/lang/std.ts';
import { seededGenerator, worldRandom } from '../../projectional/src/lang/random.ts';
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
  // error, an Abort ends the run, and the world draws Random's numbers, reads
  // the clock and waits.
  if (op === LOG_OP) { (world.log ?? printer)(args[0]); return $unit; }
  if (op === ABORT_OP) throw new Aborted(args[0]);
  if (op === RANDOM_OP) return (world.random ?? worldRandom)();
  if (op === NOW_OP) return (world.now ?? Date.now)();
  if (op === WAIT_OP) {
    if (!world.wait) throw new Error("this runtime can't wait");
    world.wait(args[0]);
    return $unit;
  }
  throw new Error(`nothing handles ${op}`);
}

// A match handling `effect` around a computation with one result.
export function $handle(effect, answers, escapes, body) {
  const h = { effect, answers }, at = handlers.length;
  handlers.push(h);
  const d = $rec.d;
  try { return body(); } catch (e) {
    if (!(e instanceof Escape) || e.handler !== h) throw e;
    handlers.length = at;
    $rec.d = d;
    return escapes[e.op](...e.args);
  } finally { handlers.length = at; }
}

// A match whose cases all escape (none answers), compiled inline as a
// try/catch (GAPS.md G18): `$enter` before the body, `$caught` in the catch
// (rethrows what isn't this handler's, and cuts the stack back so the case
// runs outside it), `$leave` in the finally.
export function $enter(effect) { const h = { effect, answers: {}, at: handlers.length, d: $rec.d }; handlers.push(h); return h; }
export function $caught(e, h) {
  if (!(e instanceof Escape) || e.handler !== h) throw e;
  handlers.length = h.at;
  $rec.d = h.d;
  return e;
}
export function $leave(h) { handlers.length = h.at; }

// ... around a computation with Choice: the handler is on the stack while
// the computation runs, which is during each step of its generator. An
// escape ends it, alternatives and all, with the case's results.
export function* $handleS(effect, answers, escapes, body) {
  const h = { effect, answers };
  const it = body()[Symbol.iterator]();
  for (;;) {
    const at = handlers.length, d = $rec.d;
    handlers.push(h);
    let r;
    try { r = it.next(); } catch (e) {
      handlers.length = at;
      if (!(e instanceof Escape) || e.handler !== h) throw e;
      $rec.d = d;
      yield* escapes[e.op](...e.args);
      return;
    } finally { handlers.length = at; }
    if (r.done) return;
    yield r.value;
  }
}

// `seeded`: Random answered from a generator (projectional/src/lang/random.ts,
// the evaluator's too, so both give the same numbers), around a computation
// with one result or with Choice.
const draws = (seed) => { const g = seededGenerator(seed); return { [RANDOM_OP]: () => g.next() }; };
export const $seeded = (seed, body) => $handle(RANDOM, draws(seed), {}, body);
export const $seededS = (seed, body) => $handleS(RANDOM, draws(seed), {}, body);

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
  } catch (e) {
    // Not here yet isn't a failure: the page asks again later.
    if (e instanceof Pending || e instanceof OutOfSteps) throw e;
    return $perform(ABORT, ABORT_OP, [e.message]);
  }
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
  fetchText: fallible('fetchText'),
};

// Cells' handler: one per program, or the one the host gives (a page that
// watches cells shares its own).
import { Cells, Pending } from '../../projectional/src/lang/cells.ts';
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

// A builtin used as a value, marked with which one it is.
export function $prim(f, prim) {
  Object.defineProperty(f, META, { value: { prim } });
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

// derivative(f), or gradient(f) with which = 'builtin.gradient'.
export function $derivative(program, f, streams, which = 'builtin.derivative') {
  const derivative = program.runner().value(which);
  for (const g of derivative(f)) return fromEval(g, streams);
  throw new Error('no derivative');
}
