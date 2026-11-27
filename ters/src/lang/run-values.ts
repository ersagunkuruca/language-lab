// A program's values as every runner of it holds them, and a page's step
// budget: the evaluator's (run.ts), and JavaScript printed from the core IR
// (compiler/src/core-rt.ts), whose pages carry this and not the evaluator.
// Nothing here reads a program's nodes.

import { deadline, OutOfSteps } from "./over.ts";
import type { Id } from "../model.ts";
import { ArrayView, arrayOf, itemsIn } from "./array-view.ts";
import { Table } from "./table.ts";
import { ItemsList } from "./bytes.ts";
import { Cells, ITEM_OPS, NoValue, changeAt, itemPathOf, listEdits, pathValue, stepsOf } from "./cells.ts";
import { CELL_OPS, CONS, FALSE, FILE_INFO_V, FILE_KIND_V, INSTANT_V, NIL, TRUE, UNIT_V } from "./std-ids.ts";

export interface Data { tag: Id; fields: Value[] }
export type Fn = (...args: Value[]) => Iterable<Value>;
// An Int is a number while it's a safe integer, a bigint beyond (int.ts).
export type Value = number | bigint | string | Data | Fn;

export const bool = (b: boolean): Data => ({ tag: b ? TRUE : FALSE, fields: [] });
export const unit: Data = { tag: UNIT_V, fields: [] };
export const toList = (xs: Value[]): Data => xs.reduceRight<Data>((tail, x) => ({ tag: CONS, fields: [x, tail] }), { tag: NIL, fields: [] });
export function fromList(v: Value): Value[] {
  // A list read from an array's items (compiled code's `items of array`):
  // its items copied at once, not a cons cell made for each (C354).
  if (v instanceof ItemsList) return v.items() as Value[];
  const out: Value[] = [];
  for (let d = v as Data; d.tag === CONS; d = d.fields[1] as Data) out.push(d.fields[0]);
  return out;
}
const LISTS = { from: fromList, to: toList as (xs: Value[]) => Value };
// What each needs to hand its rows tracked views (cells.ts, L99).
const LIST_VIEWS = { cons: CONS, nil: NIL, isList: (v: Value) => typeof v === "object" && (v.tag === CONS || v.tag === NIL) };
// The evaluator's lists with them, as Cells compares values by (C162).
export const LIST_SHAPE = { ...LISTS, views: LIST_VIEWS };
// A list held as an array (C354, `array of List`): each in array maps its
// items, its rows given them as they are.
const ARRAY_LISTS = { from: (v: Value) => Array.from(itemsIn(v as unknown as ArrayView)) as Value[], to: (xs: Value[]) => arrayOf(xs) as unknown as Value };
// The same for compiled code's rows (I331): a Bool inside an item read as
// a boolean.
export const LIST_SHAPE_BOOLS = { ...LISTS, views: { ...LIST_VIEWS, bools: { t: TRUE, f: FALSE } } };

// Cells' operations on a handler (cells.ts), by builtin id, for every
// runner of a program's values: the evaluator's here, and JavaScript
// printed from the core IR (compiler/src/core-js.ts). `call` runs a
// function the program gave and answers its value, or throws NoValue. A
// read with no answer (a formula that gave none, or no item at a place)
// is undefined. `path` is the evaluator's alone: it looks inside the
// function it is given.
// `listsHere`: how each and each of hand their rows views (LIST_SHAPE_BOOLS
// for compiled rows of data holding a Bool, I331).
export function cellOps(cells: Cells, call: (f: Value, ...xs: Value[]) => Value, listsHere: typeof LIST_SHAPE = LIST_SHAPE): Record<Id, (...xs: Value[]) => Value | undefined> {
  const noValue = (f: () => Value) => { try { return f(); } catch (e) { if (e instanceof NoValue) return undefined; throw e; } };
  return {
    [CELL_OPS.cell]: (v) => cells.cell(v, "cell", listsHere),
    [CELL_OPS.formula]: (f) => cells.formula(() => call(f)),
    [CELL_OPS.each]: (items, f) => cells.each(items, (x) => call(f, x), listsHere),
    [CELL_OPS.eachArray]: (items, f) => cells.each(items, (x) => call(f, x), ARRAY_LISTS),
    [CELL_OPS.eachOf]: (items, f) => cells.eachOf(items, (x) => call(f, x), listsHere),
    // A formula that gave no value (it ran out of `with fuel`) is a read
    // with no answer; it is computed again at the next read.
    [CELL_OPS.read]: (c) => noValue(() => cells.read(c)),
    [CELL_OPS.write]: (c, v) => (cells.write(c, v), unit),
    [CELL_OPS.itemPath]: (p, i) => itemPathOf(p, Number(i)),
    [CELL_OPS.thenPath]: (p, q) => pathValue([...stepsOf(p)!, ...stepsOf(q)!]),
    [CELL_OPS.keyPath]: (p, by, k) => pathValue([...stepsOf(p)!, { key: k, by: stepsOf(by)! }]),
    [CELL_OPS.readAt]: (c, p) => noValue(() => cells.readAt(c, stepsOf(p)!, LISTS) as Value),
    [CELL_OPS.writeAt]: (c, p, v) => (cells.edit(c, stepsOf(p)!, () => v, LISTS), unit),
    // Read at and write at an item path given its parts (C273).
    [ITEM_OPS.readItem]: (c, p, i) => noValue(() => cells.readItem(c, stepsOf(p)!, Number(i), LISTS) as Value),
    [ITEM_OPS.writeItem]: (c, p, i, v) => (cells.writeItem(c, stepsOf(p)!, Number(i), v, LISTS), unit),
    [CELL_OPS.changed]: (v, p, x) => changeAt(v, stepsOf(p)!, () => x, LISTS),
    [CELL_OPS.insertAt]: (c, p, i, v) => (cells.edit(c, stepsOf(p)!, (l) => toList(listEdits.insert(fromList(l), Number(i), v)), LISTS, { at: stepsOf(p)!, kind: "insert", i: Number(i) }), unit),
    [CELL_OPS.removeAt]: (c, p, i) => (cells.edit(c, stepsOf(p)!, (l) => { const xs = listEdits.remove(fromList(l), Number(i)); return xs && toList(xs); }, LISTS, { at: stepsOf(p)!, kind: "remove", i: Number(i) }), unit),
    [CELL_OPS.moveAt]: (c, p, a, b) => (cells.edit(c, stepsOf(p)!, (l) => { const xs = listEdits.move(fromList(l), Number(a), Number(b)); return xs && toList(xs); }, LISTS, { at: stepsOf(p)!, kind: "move", from: Number(a), to: Number(b) }), unit),
  };
}

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
    // A map or set stored as a hash table (C63b, C63d; table.ts) has no
    // tag or fields: two are equal when they hold the same keys, each with
    // an equal value. Versions of one table share its JS Map, so x's
    // entries are listed before y is read.
    if (x instanceof Table || y instanceof Table) {
      if (!(x instanceof Table && y instanceof Table)) return false;
      const xs = [...x.m], ym = y.m;
      if (xs.length !== ym.size) return false;
      for (const [k, v] of xs) { if (!ym.has(k)) return false; todo.push([v as Value, ym.get(k) as Value]); }
      continue;
    }
    // An array of records kept as columns by the compiled code (columns.ts,
    // G3d), `{ n, c0, c1, … }`, a column per leaf field: equal when every
    // column is.
    if (!("fields" in x) || !("fields" in y)) {
      const u = x as unknown as Record<string, ArrayLike<Value>>, w = y as unknown as Record<string, ArrayLike<Value>>;
      if (!("n" in u && "n" in w) || u.n !== w.n) return false;
      for (const k in u) {
        if (k === "n") continue;
        const p = u[k], q = w[k];
        if (!q || p.length !== q.length) return false;
        for (let i = 0; i < p.length; i++) todo.push([p[i], q[i]]);
      }
      continue;
    }
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

// Function values remember the node they came from (a lambda and the
// variables it closed over, or a builtin, constructor or projection), so the
// relational interpreter and `derivative` can look inside them.
export const META = Symbol("node");

// `base`: how many choice points there were when the `with fuel` began.
// `over`: a page's deadline, asked every 1024 steps (I310).
export interface Fuel { left: number; base?: number; over?: () => boolean }

// A page runs each update (a view, a text, a handler) under a step budget:
// the same count as `with fuel` (one per call into a definition the checker
// couldn't prove ends), outside any `with fuel`. Running out isn't a
// failure the program can catch, as `with fuel`'s is; the update stops and
// the page says so. The compiled runtime spends from the same budget.
export { OutOfSteps };
export const PAGE_STEPS = 1_000_000;
let page: Fuel | null = null;
// Compiled code's count of deep calls (compiler/src/runtime.js, $rec):
// put back after each update, which may have been cut off midway.
export const depth = { d: 0 };
// `over`: the budget runs out when it says so too, for a caller that
// gives the page back on time (the editor's seeds run, I310: Countdown's
// search ran 1.2 s of steps between two calls the editor timed).
export function withSteps<T>(n: number, f: () => T, over?: () => boolean): T {
  const saved = page, d = depth.d, was = deadline.over;
  page = over ? { left: n, over } : { left: n };
  deadline.over = over;
  try { return f(); } finally { page = saved; depth.d = d; deadline.over = was; }
}
// One step outside any `with fuel`: free, except under a page's budget.
export const spendStep = () => { if (page && (--page.left < 0 || ((page.left & 1023) === 0 && page.over?.()))) throw new OutOfSteps(); };
// A page's budget as it is now (null: none), and set (C61 c′: what a
// map's runs on workers spent comes off it).
export const stepsLeft = (): number | null => (page ? page.left : null);
// Whether a page's deadline has come (I310): the evaluator asks every so
// many of its own steps.
export const pageOver = (): boolean => !!page?.over?.();
export const setStepsLeft = (n: number): void => { if (page) page.left = n; };
// f under a budget of n steps of its own, `used` told how many it spent,
// whether it ends, aborts or runs out (C61 c′: a run on a page's worker).
export function counted<T>(n: number, f: () => T, used: { n: number }): T {
  const saved = page, d = depth.d, fuel = { left: n }, was = deadline.over;
  page = fuel;
  deadline.over = undefined;
  try { return f(); } finally { used.n = n - fuel.left; page = saved; depth.d = d; deadline.over = was; }
}

// What a world says about a file (L282), and the File info it is.
export type FileFacts = { kind: "file" | "folder" | "link" | "special"; size: number; modified: number };
export const fileInfoValue = (x: FileFacts): Data => ({ tag: FILE_INFO_V, fields: [{ tag: FILE_KIND_V[x.kind], fields: [] }, x.size, { tag: INSTANT_V, fields: [x.modified] }] });

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
