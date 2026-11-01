// What compiled programs link against. Small on purpose: everything the
// compiler can decide before running is already in the generated code, so
// this file only holds what has to happen at run time.
//
// Values have the same shape as in the evaluator (ters/src/lang/
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
// The list an `$into` copy writes, as a new array (a view's array, P4).
export function $intoArray(f, ...args) {
  const d = [];
  f(d, ...args);
  return d;
}
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
  for (let i = Math.max(0, $fin(n)) - 1; i >= 0; i--) l = $cons(i, l);
  return l;
}

// Float64s are equal to the precision floats carry, as in the evaluator.
// Only a finite gap is near (run.ts close): ∞ isn't −∞.
export const $near = (a, b) => {
  const gap = Math.abs(a - b);
  return a === b || (gap < Infinity && gap <= 1e-9 * (1 + Math.abs(a) + Math.abs(b)));
};

// `equal` on two numbers, one rule on every type, as in the evaluator
// (run.ts `sameNumber`): whole numbers exactly, others near.
// run.ts sameNumber: near on every JS number; an Int past 2^28 is a BigInt.
export const $sameNumber = (a, b) => $near($fin(a), $fin(b));

// A Float64 is finite (L125c, FLOAT-VALUES-2026-11-01.md §2), as in the
// evaluator (run.ts finiteFloat), with its reasons. No answer is checked on
// the argument: $div, $sqrt, $log, $pow, $mod. An overflow is checked late,
// with $fin, where a non-finite value could vanish or decide something
// (builtins.ts says where); before then IEEE keeps it ∞ or NaN, and an
// overflow nothing uses isn't reported (Haskell's imprecise exceptions).
// Only an overflow makes one, so that's the reason $fin gives.
// An Abort performed where the operation was, as in the evaluator, so a
// handler of Abort in the program gets it.
const $stop = (why) => $perform(ABORT, ABORT_OP, [why]);
// run.ts's own late checks (numberOrder, showValue) throw; the same Abort.
const performed = (f) => (...xs) => { try { return f(...xs); } catch (e) { if (e instanceof Aborted) return $stop(e.reason); throw e; } };
const OVERFLOW = 'the answer is too big for a Float64 (overflow)';
export const $fin = (x) => (x - x === 0 ? x : $stop(OVERFLOW));
export const $div = (a, b) => (b === 0 ? $stop('x / 0 has no answer') : a / $fin(b));
export const $sqrt = (a) => (a < 0 ? $stop('the square root of a negative number has no answer') : Math.sqrt(a));
export const $log = (a) => (a <= 0 ? $stop('the log of 0 or less has no answer') : Math.log(a));
export const $pow = (a, b) => {
  const r = a ** b;
  if (r - r === 0 && a - a === 0 && b - b === 0) return r;
  return a === 0 && b < 0 ? $stop('0 to a negative power has no answer')
    : a < 0 && b - b === 0 && !Number.isInteger(b) ? $stop('a negative number to a fractional power has no answer')
    : $stop(OVERFLOW);
};

// The same where the call isn't known to have an answer (L125c3): no
// answer is $no, the Choice the evaluator gives (L125b), which the nearest
// first, optional, all or count sees. An overflow still stops.
export const $divN = (a, b) => (b === 0 ? $no : a / $fin(b));
export const $sqrtN = (a) => (a < 0 ? $no : Math.sqrt(a));
export const $logN = (a) => (a <= 0 ? $no : Math.log(a));
export const $powN = (a, b) => {
  const r = a ** b;
  if (r - r === 0 && a - a === 0 && b - b === 0) return r;
  return (a === 0 && b < 0) || (a < 0 && b - b === 0 && !Number.isInteger(b)) ? $no : $stop(OVERFLOW);
};

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

// Int and text (ters/src/lang/int.ts, text.ts), and the std
// builtins compiled code calls by id.
export * as $int from '../../ters/src/lang/int.ts';
export * as $text from '../../ters/src/lang/text.ts';
import { CELL_OPS, INT_OPS, STD_IMPL, STD_MANY } from '../../ters/src/lang/std.ts';

// Arrays (std.ts ARRAY_OPS, C30d): views on a buffer with free room at
// both ends, the same as the evaluator's (std.ts ArrayView).
export const $impl = STD_IMPL;
// The Choice builtins: std.ts's, and read at (L98), which reads the
// runtime's cells (below), so it can't live in std.ts.
const readAt = (c, p) => { const v = $cells().readAt(c, stepsOf(p), $listArrays); return v === undefined ? [] : [v]; };
export const $many = { ...STD_MANY, [CELL_OPS.readAt]: readAt };
// A Choice builtin's answer, or $no: each has at most one (GAPS.md G24).
export const $partial = Object.fromEntries(Object.entries($many).map(([id, f]) => [id, (...xs) => { const a = f(...xs); return a.length ? a[0] : $no; }]));
// A Float64 made a whole number is a conversion: it must be finite (L125c).
{ const whole = $partial[INT_OPS.wholePart]; $partial[INT_OPS.wholePart] = (x) => whole($fin(x)); }
export { setPath as $setPath } from '../../ters/src/lang/records.ts';
import { showValue, compareValues, ORDER_VALUES } from '../../ters/src/lang/run.ts';
export const $showAny = performed((v, names) => showValue(v, null, names));
// `compare` (L66): `order` is each case's place in its type (compile.ts
// writes it as $order), so cases compare as in the evaluator.
export const $compare = performed((a, b, order) => ORDER_VALUES[compareValues(a, b, order) + 1]);
// `compare` at its type (compile.ts, GAPS.md M4): -1, 0 or 1. An Int has
// one spelling (a number while small, a BigInt beyond), and < works across
// the two. A text by code point: `<` on code units agrees unless one of
// them has a character past the basic plane.
export const $ORDER = ORDER_VALUES;
export const $compareN = performed(compareValues);
import { numberOrder } from '../../ters/src/lang/run.ts';
export const $numberOrder = (a, b) => (a - a !== 0 || b - b !== 0 ? $stop(OVERFLOW) : numberOrder(a, b));
export const $intOrder = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
import { less as textLess } from '../../ters/src/lang/text.ts';
export const $textOrder = (a, b) => {
  if (a === b) return 0;
  for (let i = 0, n = Math.min(a.length, b.length); i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x !== y) return x < 0xd800 || y < 0xd800 ? (x < y ? -1 : 1) : textLess(a, b) ? -1 : 1;
  }
  return a.length < b.length ? -1 : 1;
};

export const $show = (x) => (Number.isInteger(x) ? String(x) : String(Math.round($fin(x) * 1e9) / 1e9));
export const $mod = (a, b) => (b === 0 ? $stop('x mod 0 has no answer') : ((a % $fin(b)) + b) % b);
export const $modN = (a, b) => (b === 0 ? $no : ((a % $fin(b)) + b) % b);
// A record of Float64s part by part (std.ts); a Float64 is one part.
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
export { depth as $rec } from '../../ters/src/lang/run.ts';
import { depth as $rec } from '../../ters/src/lang/run.ts';
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
// A call the checker found always answered (L125b): its one answer, from a
// copy that gives a stream or the answer or $no.
export function $answered(r) {
  if (r !== null && typeof r === 'object' && typeof r.next === 'function') { for (const x of r) return x; r = $no; }
  if (r === $no) $stop('a call found always answered had no answer');
  return r;
}
export const $stream0 = (f) => function* (...a) { const r = f(...a); if (r !== $no) yield r; };
export function $one(results) {
  for (const x of results) return x;
  throw new Error('a solve with exactly one answer had none (a non-finite number?)');
}
// Folds over nested data (a rose tree's List Tree): the trees inside a
// field, and the field rebuilt from their folded values.
export { spread as $spread } from '../../ters/src/lang/nested.ts';
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
let printing = null;
export function $print(s) { return (printing ??= acting(S.print, (t) => (printer(t), $unit)))(s); }
export { FN as $FN } from '../../invertible/src/expr.js';

// ---- effects a program defines (docs/language/LANGUAGE.md) -----------------
// Handlers are a stack. Performing an operation finds the nearest handler
// of its effect. An operation that returns calls that handler's case with
// the stack cut back to below the handler (cases run outside their own
// handler), and its value is the answer. One that never returns throws an
// Escape that the handler's match catches; the case then runs there, after
// the stack is unwound. No continuation is ever captured, which is what the
// two shapes of operation buy (Koka and Effekt compile tail-resumptive and
// abortive handlers the same way).

import { Aborted, OutOfSteps, spendStep } from '../../ters/src/lang/run.ts';
import { ABORT, ABORT_OP, IO, LOG_OP, NONE, NOW_OP, RANDOM, RANDOM_OP, S, SOME, WAIT_OP, WORLD_OPS } from '../../ters/src/lang/std.ts';
import { CONSOLE, FILES, NETWORK } from '../../ters/src/lang/types.ts';
import { seededGenerator, worldRandom } from '../../ters/src/lang/random.ts';
export { Aborted as $Aborted };

const handlers = [];
class Escape {
  constructor(handler, op, args) { this.handler = handler; this.op = op; this.args = args; }
}

export function $perform(effect, op, args) {
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    if (h.effect !== effect || h.hidden) continue;
    if (!(op in h.answers)) throw new Escape(h, op, args);
    // Cases that perform nothing (C64, compile.ts performsNothing): no
    // handler could be seen from them, so none is hidden.
    if (h.quiet) return h.answers[op](...args);
    // The case runs outside its own handler: it and the ones above it are
    // hidden while it does, by a count rather than by taking them off the
    // stack, which cost two arrays an operation (Pig's games: 1.6x).
    const top = handlers.length;
    for (let j = i; j < top; j++) handlers[j].hidden = (handlers[j].hidden ?? 0) + 1;
    try { return h.answers[op](...args); } finally { for (let j = i; j < top; j++) handlers[j].hidden--; }
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

// Random where nothing in the program handles it: the world's (C64d).
// Set with the world, so a draw is one call.
export let $random = worldRandom;

// A match handling `effect` around a computation with one result.
export function $handle(effect, answers, escapes, body, quiet = false) {
  const h = { effect, answers, quiet }, at = handlers.length;
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

// Operations answered later (ANSWERED-LATER.md, C40). Code that may
// perform one is a generator; performing yields a $Later, which passes up
// through the `yield*` of every call to the handler's driver. A case for it
// gets the rest: a function that resumes the generator with the answer,
// under the same handler (deep), once. A generator can't be resumed twice
// from one point, which is the one-shot rule; a second call says so, as
// the evaluator does.
class Later {
  constructor(effect, op, args) { this.effect = effect; this.op = op; this.args = args; }
}
export const $later = (effect, op, args) => new Later(effect, op, args);
// Is what a search's generator gave a wait rather than an answer? (C40: a
// search that waits yields both, and whoever walks it passes waits on.)
export const $isLater = (x) => x instanceof Later;
// `done`: the case for the normal finish (L57), given the computation's
// value however many rests ran before it, and not an escape's.
export function $handleL(effect, later, ops, answers, escapes, body, done = null) {
  const h = { effect, answers }, it = body();
  const run = (send) => {
    const at = handlers.length, d = $rec.d;
    handlers.push(h);
    let r;
    try { r = it.next(send); } catch (e) {
      handlers.length = at;
      if (!(e instanceof Escape) || e.handler !== h) throw e;
      $rec.d = d;
      return escapes[e.op](...e.args);
    } finally { handlers.length = at; }
    if (r.done) return done ? done(r.value) : r.value;
    const m = r.value;
    if (!(m instanceof Later) || m.effect !== effect || !(m.op in later)) throw new Error(`nothing handles ${m.op ?? m}`);
    let used = false;
    const rest = (v) => {
      if (used) throw new Error(`the rest of ${ops[m.op]} was resumed a second time: a rest runs once`);
      used = true;
      return run(v);
    };
    return later[m.op](...m.args, rest);
  };
  return run(undefined);
}

// ... where the match itself waits on another handler's operation: a
// generator too, which passes on what isn't its own (and the answer back
// in), and whose cases and rest are generators. A case answered at once
// is a plain function, answered in place as $handle's are.
// (`done` is a generator here when it waits too, `doneWaits`.)
export function* $handleLG(effect, later, ops, answers, escapes, body, done = null, doneWaits = false) {
  const h = { effect, answers }, it = body();
  function* run(send) {
    for (;;) {
      const at = handlers.length, d = $rec.d;
      handlers.push(h);
      let r;
      try { r = it.next(send); } catch (e) {
        handlers.length = at;
        if (!(e instanceof Escape) || e.handler !== h) throw e;
        $rec.d = d;
        return yield* escapes[e.op](...e.args);
      } finally { handlers.length = at; }
      if (r.done) return !done ? r.value : doneWaits ? yield* done(r.value) : done(r.value);
      const m = r.value;
      if (m instanceof Later && m.effect === effect && m.op in later) {
        let used = false;
        const rest = function* (v) {
          if (used) throw new Error(`the rest of ${ops[m.op]} was resumed a second time: a rest runs once`);
          used = true;
          return yield* run(v);
        };
        return yield* later[m.op](...m.args, rest);
      }
      send = yield m;
    }
  }
  return yield* run(undefined);
}

// `seeded`: Random answered from a generator (ters/src/lang/random.ts,
// the evaluator's too, so both give the same numbers), around a computation
// with one result or with Choice.
const draws = (seed) => { const g = seededGenerator(seed); return { [RANDOM_OP]: () => g.next() }; };
export const $seeded = (seed, body) => $handle(RANDOM, draws(seed), {}, body);
export const $seededS = (seed, body) => $handleS(RANDOM, draws(seed), {}, body);

// ---- the world ---------------------------------------------------------------
// The world effects' one handler. A program compiled for the command line
// sets Node's (ters/src/lang/world.ts); without one, the
// operations abort saying so. Failures are an Abort where they were called.

let world = {};
export function $setWorld(w) { world = w ?? {}; $random = world.random ?? worldRandom; }
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
// A builtin that acts on the world performs its effect's operation when a
// match handles that effect (HOSTS.md, L55); otherwise the world answers.
const effectOfOp = (op) => [CONSOLE, FILES, NETWORK].find((e) => op.startsWith(`${e}.`));
function acting(builtin, world) {
  const op = WORLD_OPS[builtin], effect = effectOfOp(op);
  return (...a) => (handlers.some((h) => h.effect === effect && !h.hidden) ? $perform(effect, op, a) : world(...a));
}
export const $io = {
  printError: acting(IO.printError, (s) => { (world.error ?? printer)(s); return $unit; }),
  readInput: acting(IO.readInput, fallible('input')),
  readLine: acting(IO.readLine, (...a) => some(fallible('readLine')(...a))),
  readFile: acting(IO.readFile, fallible('readFile')),
  writeFile: acting(IO.writeFile, (p, t) => (fallible('writeFile')(p, t), $unit)),
  appendFile: acting(IO.appendFile, (p, t) => (fallible('appendFile')(p, t), $unit)),
  fileExists: acting(IO.fileExists, (p) => $bool(!!world.fileExists?.(p))),
  listFolder: acting(IO.listFolder, (p) => $toList(fallible('listFolder')(p))),
  fetchText: acting(IO.fetchText, fallible('fetchText')),
};

// Cells' handler: one per program, or the one the host gives (a page that
// watches cells shares its own).
import { Cells, Pending, listEdits, pathValue, stepsOf } from '../../ters/src/lang/cells.ts';
let cells = null;
export const $cells = () => (cells ??= new Cells($eq));
export function $setCells(c) { cells = c; }
// Places and edits at them (L98): a path is cells.ts's, and an edit is the
// handler's, with the compiled code's lists.
export const $path = {
  item: (p, i) => pathValue([...stepsOf(p), { item: Number(i) }]),
  then: (p, q) => pathValue([...stepsOf(p), ...stepsOf(q)]),
  of: (steps) => pathValue(steps),
  write: (c, p, v) => ($cells().edit(c, stepsOf(p), () => v, $listArrays), $unit),
  insert: (c, p, i, v) => ($cells().edit(c, stepsOf(p), (l) => $toList(listEdits.insert($fromList(l), Number(i), v)), $listArrays, { at: stepsOf(p), kind: 'insert', i: Number(i) }), $unit),
  remove: (c, p, i) => ($cells().edit(c, stepsOf(p), (l) => { const xs = listEdits.remove($fromList(l), Number(i)); return xs && $toList(xs); }, $listArrays, { at: stepsOf(p), kind: 'remove', i: Number(i) }), $unit),
  move: (c, p, a, b) => ($cells().edit(c, stepsOf(p), (l) => { const xs = listEdits.move($fromList(l), Number(a), Number(b)); return xs && $toList(xs); }, $listArrays, { at: stepsOf(p), kind: 'move', from: Number(a), to: Number(b) }), $unit),
};

// optional: the first answer as some(answer), or none.
export function $optional(f) { for (const x of f()) return { tag: SOME, fields: [x] }; return { tag: NONE, fields: [] }; }

// ---- reflection: functions that are looked inside at run time -------------
// The relational interpreter (relate.ts) runs a function backwards from its
// nodes, and `derivative` builds a new function from them. Both are
// interpreters over the node table, so a program that uses them carries
// its node table, and its functions carry the node they came from (the
// evaluator's META). Making these directions compile too is the next stage
// (docs/design/targets/COMPILER.md).

import { META, makeRunner } from '../../ters/src/lang/run.ts';
import { relate, satisfiable, toValue } from '../../ters/src/lang/relate.ts';
import { ownerOfTypeParts } from '../../ters/src/model.ts';

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
