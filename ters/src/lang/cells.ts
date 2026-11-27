// The handler of the Cells effect: cells you write, formulas computed when
// read and remembered until something they read changes, and watchers that
// run again when that happens (LANGUAGE.md, "Cells: reactivity and values
// on demand").
//
// This is fine-grained reactivity as Solid.js does it (Ryan Carniato,
// https://www.solidjs.com, MIT; itself after S.js by Adam Haile): reading a
// cell inside a formula or a watcher records the dependency, so only what
// read a changed cell runs again, and a read that a branch skipped records
// nothing. The update order is the "push dirty marks, pull values"
// three-colour algorithm described by Milo (modderme) in "Super-charging
// fine-grained reactive performance" (2022,
// https://dev.to/modderme123/super-charging-fine-grained-reactive-performance-47ph,
// the Reactively library, MIT): a write marks its readers dirty and theirs
// "check"; a formula is brought up to date only when read, and a "check"
// one recomputes only if a source really changed. So nothing is computed
// twice and nothing is computed that nobody reads: that's what makes the
// same handler give lazy, remembered values (call-by-need), the other half
// of the thread. Adapton (Hammer, Phang, Hicks, Foster, PLDI 2014) is the
// paper that put demand-driven and incremental computation together.
//
// In the language, Cells is an effect like Console: `read` is an operation
// and this is its one handler, the runtime's. The tracking context Solid
// keeps in a global ("the current listener") is the dynamic scope of that
// handler, which is what a deep handler is.

import type { Value } from "./run-values.ts";
import { ArrayView, arrayOf, itemsIn, replaceIn } from "./array-view.ts";
import { CONS, NIL } from "./std-ids.ts";

const CLEAN = 0, CHECK = 1, DIRTY = 2;

export interface CellNode {
  value: Value | undefined;
  state: number;
  // A formula's or a watcher's computation; a written cell has none.
  compute: (() => Value) | null;
  sources: CellNode[];
  observers: Set<CellNode>;
  watcher: boolean;
  // Watchers and formulas made while this one ran: a watcher that runs
  // again first disposes of the ones its last run made (Solid's owners).
  owned: CellNode[];
  label: string;
  runs: number;
  disposed: boolean;
  // Why its last computation stopped (a page's step budget ran out): read,
  // it stops the same way, until a cell it read changes.
  error?: unknown;
  // What else goes when it's disposed (each's rows, below).
  onDispose?: () => void;
  // The paths it read in each source with read at (L98), as keys; a source
  // it read whole with read isn't here.
  paths?: Map<CellNode, string[]>;
  // A formula's places of a source that its answer holds as they are
  // (C162c, readPaths' kept keys): a change only inside one is put into
  // its last answer in place, by identity, instead of running it again.
  kept?: Map<CellNode, string[]>;
  // each's: the edits made to the list it maps since it last ran (L99),
  // or null once one came that it can't follow (a whole write).
  edits?: Edit[] | null;
  // The places it read in each source through a tracked view (L99): woken
  // only by an edit there or around it, never by one inside it.
  views?: Map<CellNode, Seen[]>;
  // each's, given each edit of a list as it's made, and where: its rows'
  // positions follow the edits of the list it maps.
  shift?: (what: Edit, at: Step[]) => void;
  // A row's root: the each it's a row of, woken with it.
  rowOf?: CellNode;
}

// A place a reader read through a view: `rel` from the row's item when
// `row` is given (its position kept up to date by each, so a row's
// places move with it), from the whole value otherwise. A row of an each
// over a list inside another row's item (each of) has `up`, the path of
// its list now, or null once that's gone.
type Spot = { i: number; up?: () => Step[] | null };
type Seen = { row: Spot | null; rel: Step[] };
// Where a row's item is now, from the whole value; null once it's gone.
const placeOf = (row: Spot): Step[] | null => {
  if (row.i < 0) return null;
  const up = row.up ? row.up() : [];
  return up && [...up, { item: row.i }];
};
// A list view's place: what `each of` follows.
type ListAt = { n: CellNode; row: Spot | null; rel: Step[] };
const LIST_AT = new WeakMap<object, ListAt>();

// What an edit did, for each (L99): at a place, a write, or in the list
// there an insert, a remove or a move.
export type Edit = { at: Step[]; kind: "write" } | { at: Step[]; kind: "insert" | "remove"; i: number } | { at: Step[]; kind: "move"; from: number; to: number };

// Each value `each` made, with the owner it was made under: a page that
// draws it again keeps what it drew the first time (html.ts).
export const KEPT = new WeakMap<object, CellNode>();

// A cell, as a value of the language: a function value (so equality is
// identity, and the checker treats `Cell a` as not plain) that carries its
// node. Calling it is a mistake the checker prevents: cells are read with
// `read`.
// Shared by every copy of this module (Symbol.for): the editor mounts the
// compiled page from its own bundle of the core runtime, and handOver
// there reads the interpreted page's cells, made by the editor's copy
// (I253; with a symbol of each copy's own, it read none of them).
export const CELL = Symbol.for("ters.cell");
export const nodeOf = (v: Value): CellNode | null => (typeof v === "function" ? ((v as unknown as Record<symbol, CellNode>)[CELL] ?? null) : null);

// A place inside a cell's value (L98, STABLE-REFERENCES.md §1): item i of
// a list or field i of a record, outermost first. A path is a value of the
// language, made by `path`, `item path` and `then path` (std.ts), and
// compared by identity like a cell; the cell's handler applies an edit at
// one and wakes only the readers whose path meets it.
// A keyed step (L98 keys) names the item of a list whose part at `by` is
// `key`. It is found when the path is used, so an edit by key reaches the
// same item after others were put in, taken out or moved before it.
export type Step = { item: number } | { field: number } | { key: Value; by: Step[] };
export const PATH = Symbol("path");
export const stepsOf = (v: Value): Step[] | null => (typeof v === "function" ? ((v as unknown as Record<symbol, Step[]>)[PATH] ?? null) : null);

// A list a cell holds, edited at its items (C261: a looper's tape, minutes
// of samples): kept as an array of its items the cell owns, each edit at
// an item written there in place, and made a list again only when it's
// read whole, once until the next edit. Prior art: copy-on-write with an
// owner (Clojure's transients, Swift's isKnownUniquelyReferenced); here
// the owner is the cell, and a whole read gets its own copy.
// Its items are a Float64Array while they are all numbers (samples): no
// object an item, nothing for the garbage collector to look through.
interface Tape { items: Value[] | Float64Array; lists: Lists; list: Value | undefined }
// Item i of the tape set to x, the numbers' array given up for a plain
// one when x isn't a number.
function setItem(t: Tape, i: number, x: Value): void {
  if (t.items instanceof Float64Array && typeof x !== "number") t.items = Array.from(t.items);
  (t.items as Value[])[i] = x;
}
const TAPE = Symbol("tape");
// A list of at least a tape's worth of items (a tenth of a second at 48 kHz).
const TAPE_FROM = 4800;
function longList(v: Value, views: NonNullable<Lists["views"]>): boolean {
  let d = v as unknown as Data, n = 0;
  for (; n < TAPE_FROM && d && typeof d === "object" && d.tag === views.cons; n++) d = d.fields[1] as unknown as Data;
  return n === TAPE_FROM;
}
const tapeOf = (n: CellNode): Tape | undefined => (n as CellNode & { [TAPE]?: Tape })[TAPE];
function taped(n: CellNode, lists: Lists): Tape {
  const had = tapeOf(n);
  if (had) return had;
  // Copied: a list's own array (lists kept as arrays) isn't the cell's.
  const xs = lists.from(n.value as Value);
  // Not kept as a list: the tape is what the cell holds from now on, and a
  // list as long as a tape is a great deal for the collector to mark.
  const t: Tape = { items: xs.every((x) => typeof x === "number") ? Float64Array.from(xs as number[]) : xs.slice(), lists, list: undefined };
  (n as CellNode & { [TAPE]?: Tape })[TAPE] = t;
  Object.defineProperty(n, "value", {
    configurable: true, enumerable: true,
    get: () => (t.list ??= lists.to(Array.from(t.items as ArrayLike<Value>))),
    // A whole value written: the tape is gone, the value kept as it is.
    set: (v: Value | undefined) => {
      delete (n as CellNode & { [TAPE]?: Tape })[TAPE];
      Object.defineProperty(n, "value", { value: v, writable: true, configurable: true, enumerable: true });
    },
  });
  return t;
}
// A function, opaque as a cell is, with its steps on it: set as a property,
// not by Object.assign, which costs twice as much (C270: a looper makes
// item paths each sample).
export const pathValue = (steps: Step[]): Value => {
  const p = () => { throw new Error("a path is used by read at and the edits, not called"); };
  (p as unknown as Record<symbol, Step[]>)[PATH] = steps;
  return p as unknown as Value;
};
// A read or write at item i of the list at a path, given the path and i
// (compiler/src/item-paths.ts, C273): no item path made.
export const ITEM_OPS = { readItem: "builtin.cells.readItem", writeItem: "builtin.cells.writeItem" } as const;
// Item i of the list at path p.
export const itemPathOf = (p: Value, i: number): Value => {
  const s = stepsOf(p)!;
  return pathValue(s.length === 0 ? [{ item: i }] : [...s, { item: i }]);
};
// How a list is taken apart and made: cons cells in the evaluator, the
// compiled code's own lists in JS.
export interface Lists {
  from: (v: Value) => Value[];
  to: (xs: Value[]) => Value;
  // Given, each hands its rows tracked views of their items (L99): the
  // tags of a list's two cases, and how to tell a list from a record.
  // `bools` (I331): a Bool read through a view is a boolean, as compiled
  // code holds one inside data, not the evaluator's case: its true and
  // false tags.
  views?: { cons: string; nil: string; isList: (v: Value) => boolean; bools?: { t: string; f: string } };
}
type Data = { tag: string; fields: Value[] };
// A list held as an array (C354, `array of List`): a list here whatever
// the shape, its items by position, an edit of one a replace in it.
const isArray = (v: unknown): v is ArrayView => v instanceof ArrayView;
const itemsOfList = (v: Value, lists: Lists): Value[] => (isArray(v) ? (itemsIn(v) as Value[]) : lists.from(v));
const arrayItem = (a: ArrayView, i: number): Value | undefined => (i >= 0 && i < a.n ? (a.buf.items[a.start + i] as Value) : undefined);
const keyOf = (steps: Step[]) => steps.map((s) => ("item" in s ? `i${s.item}/` : "field" in s ? `f${s.field}/` : "k/")).join("");
// Does a change at `key` meet a reader's path `p`? A change at the place,
// around it or inside it does. A path the compiler worked out (C162,
// readPaths) may also have `*/`, any item of a list, and end in `=`: the
// place only (a list's length, a value's case), which a change inside it
// leaves alone.
export function meets(p: string, key: string): boolean {
  if (!p.includes("*") && !p.endsWith("=")) return p.startsWith(key) || key.startsWith(p);
  const only = p.endsWith("="), ps = (only ? p.slice(0, -1) : p).split("/"), ks = key.split("/");
  ps.pop(); ks.pop();
  const n = Math.min(ps.length, ks.length);
  for (let i = 0; i < n; i++) if (ps[i] !== ks[i] && !(ps[i] === "*" && ks[i].startsWith("i"))) return false;
  return ks.length <= ps.length || !only;
}
// How many steps of a change at `key` are a kept place `p` (C162c), when
// the change is at it or inside it; -1 when it isn't.
function inside(p: string, key: string): number {
  const ps = p.split("/"), ks = key.split("/");
  ps.pop(); ks.pop();
  if (ks.length < ps.length) return -1;
  for (let i = 0; i < ps.length; i++) if (ps[i] !== ks[i] && !(ps[i] === "*" && ks[i].startsWith("i"))) return -1;
  return ps.length;
}
// v with each part that is `old` (the same object) made `now`, copying
// only the way down to it; v itself when it holds none.
// A list is its cons cells here, walked along their tails (a list's rest
// is no deeper), so only the cells down to the part are copied.
function replaced(v: Value, old: Value, now: Value, lists: Lists, depth: number): Value {
  if (v === old) return now;
  if (depth > 8 || typeof v !== "object" || v === null || !("fields" in v)) return v;
  if (isArray(v)) {
    const xs = itemsIn(v) as Value[];
    let ys: Value[] | null = null;
    xs.forEach((x, i) => { const y = replaced(x, old, now, lists, depth); if (y !== x) (ys ??= xs.slice())[i] = y; });
    return ys ? (arrayOf(ys) as unknown as Value) : v;
  }
  // Another value of the part's own case (another card) isn't looked into:
  // the compiler keeps a place only where the answer holds it whole, and
  // one of its kind taken apart is needed instead (cell-paths.ts), so the
  // part isn't inside one. Lists are walked.
  const d = v as unknown as Data, list = !!lists.views?.isList(v);
  if (d.tag === (old as unknown as Data).tag && !list) return v;
  let fields: Value[] | null = null;
  d.fields.forEach((x, i) => { const y = replaced(x, old, now, lists, list && i === d.fields.length - 1 ? depth : depth + 1); if (y !== x) (fields ??= d.fields.slice())[i] = y; });
  return fields ? ({ tag: d.tag, fields } as unknown as Value) : v;
}
// The part at steps, a list's items walked to along its cons cells when
// that's how lists are (partAt makes the whole list first).
function partOf(v: Value, steps: Step[], lists: Lists): Value | undefined {
  const views = lists.views;
  if (!views || steps.some((s) => "key" in s)) return partAt(v, steps, lists);
  for (const s of steps) {
    if (v === undefined || typeof v !== "object" || v === null || !("fields" in v)) return undefined;
    if ("field" in s) { v = (v as unknown as Data).fields[s.field]; continue; }
    if (isArray(v)) { v = arrayItem(v, (s as { item: number }).item) as Value; continue; }
    let d = v as unknown as Data;
    for (let i = 0; i < (s as { item: number }).item && d.tag === views.cons; i++) d = d.fields[1] as unknown as Data;
    if (d.tag !== views.cons) return undefined;
    v = d.fields[0];
  }
  return v;
}
// How many items of the list v are `x` itself.
function timesIn(v: Value, x: Value, lists: Lists): number {
  const views = lists.views;
  if (!views || isArray(v)) return itemsOfList(v, lists).filter((y) => y === x).length;
  let n = 0;
  for (let d = v as unknown as Data; d && d.tag === views.cons; d = d.fields[1] as unknown as Data) if (d.fields[0] === x) n++;
  return n;
}
// Plain data equal: what a key is compared by.
const sameData = (a: Value, b: Value): boolean => {
  if (a === b) return true;
  if (typeof a === "bigint" || typeof b === "bigint") return (typeof a === "bigint" || typeof a === "number") && (typeof b === "bigint" || typeof b === "number") && BigInt(a as never) === BigInt(b as never);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const d = a as unknown as Data, e = b as unknown as Data;
  return d.tag === e.tag && Array.isArray(d.fields) && Array.isArray(e.fields) && d.fields.length === e.fields.length && d.fields.every((x, i) => sameData(x, e.fields[i]));
};
// Where the item with the key is in xs, or -1.
const keyed = (xs: Value[], s: { key: Value; by: Step[] }, lists: Lists) => xs.findIndex((x) => { const k = partAt(x, s.by, lists); return k !== undefined && sameData(k, s.key); });
// The steps with each keyed one replaced by the item it finds in v now (-1,
// no item, when none has the key): the handler and its readers work with
// positions.
export function resolved(v: Value, steps: Step[], lists: Lists): Step[] {
  if (!steps.some((s) => "key" in s)) return steps;
  const out: Step[] = [];
  let here: Value | undefined = v;
  for (const s of steps) {
    const step: Step = "key" in s ? { item: here === undefined ? -1 : keyed(itemsOfList(here, lists), s, lists) } : s;
    out.push(step);
    here = here === undefined ? undefined : partAt(here, [step], lists);
  }
  return out;
}
// The part of v at steps, or undefined when there is no such item.
export function partAt(v: Value, steps: Step[], lists: Lists): Value | undefined {
  for (const s of steps) {
    if ("field" in s) v = (v as unknown as Data).fields[s.field];
    else if (isArray(v) && !("key" in s)) { const x = arrayItem(v, s.item); if (x === undefined) return undefined; v = x; }
    else { const xs = itemsOfList(v, lists), i = "key" in s ? keyed(xs, s, lists) : s.item; if (!(i >= 0 && i < xs.length)) return undefined; v = xs[i]; }
  }
  return v;
}
// v with change(part) at steps, copying only the path down to it; v itself
// when there is no such item or change gives undefined.
export function changeAt(v: Value, steps: Step[], change: (part: Value) => Value | undefined, lists: Lists): Value {
  if (!steps.length) return change(v) ?? v;
  const [first, ...rest] = steps;
  const s = "key" in first ? { item: keyed(itemsOfList(v, lists), first, lists) } : first;
  if ("field" in s) {
    const d = v as unknown as Data, inner = changeAt(d.fields[s.field], rest, change, lists);
    if (inner === d.fields[s.field]) return v;
    const fields = d.fields.slice();
    fields[s.field] = inner;
    return { tag: d.tag, fields } as unknown as Value;
  }
  if (isArray(v)) {
    const x = arrayItem(v, s.item);
    if (x === undefined) return v;
    const inner = changeAt(x, rest, change, lists);
    return inner === x ? v : (replaceIn(v, s.item, inner) as unknown as Value);
  }
  const xs = lists.from(v);
  if (!(s.item >= 0 && s.item < xs.length)) return v;
  const inner = changeAt(xs[s.item], rest, change, lists);
  if (inner === xs[s.item]) return v;
  const ys = xs.slice();
  ys[s.item] = inner;
  return lists.to(ys);
}
// The places where b differs from a, outermost first, or null when there
// are more than a few (then every reader wakes). Parts that are the same
// object are the same; a list whose length changed differs as a whole.
// Each place with the two parts there; `sure` when they can't be equal (a
// list whose length changed), so a write needn't compare them.
const MAX_DIFFERENCES = 16;
type Place = { at: Step[]; a: Value; b: Value; sure: boolean };
function differences(a: Value, b: Value, lists: Lists): Place[] | null {
  const out: Place[] = [];
  const views = lists.views;
  const go = (x: Value, y: Value, at: Step[]): boolean => {
    if (x === y) return true;
    if (isArray(x) && isArray(y)) {
      // Items by position, read from a copy of each (a version read in
      // turn with the other would be put back each item). One longer or
      // shorter differs as a whole.
      if (x.n !== y.n) { out.push({ at, a: x, b: y, sure: true }); return out.length <= MAX_DIFFERENCES; }
      const xs = itemsIn(x) as Value[], ys = itemsIn(y) as Value[];
      for (let i = 0; i < xs.length; i++) if (xs[i] !== ys[i] && !go(xs[i], ys[i], [...at, { item: i }])) return false;
      return true;
    }
    if (views && views.isList(x) && views.isList(y)) {
      // Walked together, the items that are the same object (all but one,
      // after a card is added) skipped without copying either list.
      const apart: [number, Value, Value][] = [];
      let p = x as unknown as Data, q = y as unknown as Data, i = 0;
      // One put in front (an undo list, latest first) or taken off it.
      if ((q.tag === views.cons && q.fields[1] === p) || (p.tag === views.cons && p.fields[1] === q)) { out.push({ at, a: x, b: y, sure: true }); return out.length <= MAX_DIFFERENCES; }
      for (; p !== q && p.tag === views.cons && q.tag === views.cons; i++, p = p.fields[1] as unknown as Data, q = q.fields[1] as unknown as Data) {
        if (p.fields[0] !== q.fields[0]) apart.push([i, p.fields[0], q.fields[0]]);
      }
      if (p === q || (p.tag !== views.cons && q.tag !== views.cons)) { for (const [i, u, w] of apart) if (!go(u, w, [...at, { item: i }])) return false; return true; }
      out.push({ at, a: x, b: y, sure: true });
      return out.length <= MAX_DIFFERENCES;
    } else if (typeof x === "object" && typeof y === "object" && x !== null && y !== null && "fields" in x && "fields" in y) {
      const d = x as unknown as Data, e = y as unknown as Data;
      if (d.tag === e.tag && d.fields.length === e.fields.length && !(views && (views.isList(x) || views.isList(y))) && !isArray(x) && !isArray(y)) {
        for (let i = 0; i < d.fields.length; i++) if (!go(d.fields[i], e.fields[i], [...at, { field: i }])) return false;
        return true;
      }
    }
    out.push({ at, a: x, b: y, sure: false });
    return out.length <= MAX_DIFFERENCES;
  };
  return go(a, b, []) ? out : null;
}

// The items b puts into the list a, as inserts, when b is a's items (the
// same objects) with some put in at one place; [] when b has a's items
// and no more. Null otherwise (not lists, any other change).
function inserted(a: Value, b: Value, lists: Lists): Edit[] | null {
  const views = lists.views;
  if (a !== b && isArray(a) && isArray(b)) return insertedInto(itemsIn(a) as Value[], itemsIn(b) as Value[]);
  if (a === b || !views || !views.isList(a) || !views.isList(b)) return null;
  // Put in at the end, the common case, walked without copying.
  let p = a as unknown as Data, q = b as unknown as Data, at = 0;
  for (; p !== q && p.tag === views.cons && q.tag === views.cons && p.fields[0] === q.fields[0]; at++) { p = p.fields[1] as unknown as Data; q = q.fields[1] as unknown as Data; }
  if (p === q) return [];
  if (p.tag !== views.cons) {
    const out: Edit[] = [];
    for (; q.tag === views.cons && out.length <= 32; q = q.fields[1] as unknown as Data) out.push({ at: [], kind: "insert", i: at++ });
    return out;
  }
  return insertedInto(lists.from(a), lists.from(b));
}
function insertedInto(xs: Value[], ys: Value[]): Edit[] | null {
  if (ys.length < xs.length) return null;
  let k = 0;
  while (k < xs.length && xs[k] === ys[k]) k++;
  let e = 0;
  while (e < xs.length - k && xs[xs.length - 1 - e] === ys[ys.length - 1 - e]) e++;
  if (k + e < xs.length) return null;
  const out: Edit[] = [];
  for (let i = k; i < ys.length - e; i++) out.push({ at: [], kind: "insert", i });
  return out;
}

// The three edits of a list: an item put in at i (at the end when i is past
// it), the item at i taken out, the item at `from` moved to `to`. A place
// that isn't there changes nothing.
export const listEdits = {
  insert: (xs: Value[], i: number, x: Value) => { const ys = xs.slice(); ys.splice(Math.max(0, Math.min(i, xs.length)), 0, x); return ys; },
  remove: (xs: Value[], i: number) => (i >= 0 && i < xs.length ? [...xs.slice(0, i), ...xs.slice(i + 1)] : undefined),
  move: (xs: Value[], from: number, to: number) => {
    if (!(from >= 0 && from < xs.length && to >= 0 && to < xs.length) || from === to) return undefined;
    const ys = xs.slice(), [x] = ys.splice(from, 1);
    ys.splice(to, 0, x);
    return ys;
  },
};

// Tracked views (L99, STABLE-REFERENCES.md §2): a value inside a cell, read
// as it is now. Reading a field or a list's case through one records that
// place for the reader, so an edit elsewhere leaves it asleep, as Solid's
// stores do (createStore, Ryan Carniato), and so does an edit deeper in:
// reading a record or list only hands on another view. Views stay inside
// the reactive part: whatever is written or made a formula's value is
// copied out of them first (plainOf), so a cell never holds another's view.
const VIEWS = new WeakMap<object, () => Value>();
// The values found to have no view inside (C287): a value doesn't change,
// so the state written again with one card more is walked only where it's
// new, not through every card and every step of its history.
const PLAIN = new WeakSet<object>();
const keyIs = (a: Step[], b: Step[]) => a.length <= b.length && a.every((s, i) => ("item" in s ? "item" in b[i] && b[i].item === (s as { item: number }).item : "field" in s && "field" in b[i] && (b[i] as { field: number }).field === s.field));
// Where a row is after an edit of the list its each maps; -1 once removed.
function shifted(i: number, e: Edit): number {
  if (i < 0) return i;
  if (e.kind === "insert") return i >= e.i ? i + 1 : i;
  if (e.kind === "remove") return i === e.i ? -1 : i > e.i ? i - 1 : i;
  if (e.kind === "move") {
    if (i === e.from) return e.to;
    if (e.from < e.to && i > e.from && i <= e.to) return i - 1;
    if (e.from > e.to && i >= e.to && i < e.from) return i + 1;
  }
  return i;
}

// A formula whose computation gave no value (it ran out of `with fuel`).
export class NoValue extends Error {}

// A value that isn't here yet (a page's `fetch text` waiting for its
// reply): what was asked stops, and `ready` settles when asking again will
// get further. A page's views keep what they showed and run again then
// (html.ts), like Solid's createResource and React's Suspense.
export class Pending extends Error {
  ready: Promise<unknown>;
  // Where the run stopped, kept (the evaluator's machine, L59): once ready,
  // this goes on from there and streams the run's values. Without it, the
  // run is taken back and runs again from the start (null: it stopped
  // inside a builtin's call, which can't be kept).
  resume?: (() => Iterable<unknown>) | null;
  // Whether asking again from the start gets further: a fetch's reply is
  // kept, so it does; a timer (C40) would start again, so it doesn't.
  again: boolean;
  // Held (C61 c′, a map on a page's workers): the page shows nothing and
  // takes no other event till the run goes on and ends, as if it hadn't
  // waited.
  hold?: boolean;
  constructor(ready: Promise<unknown>, what: string, again = true) {
    super(`still waiting for ${what}`);
    this.ready = ready;
    this.again = again;
  }
}

// What a page's attempt (Cells.attempt) undoes if taken back, and does if kept.
interface Journal { undo: (() => void)[]; later: (() => void)[] }

export class Cells {
  private current: CellNode | null = null;
  private owner: CellNode | null = null;
  private queue: CellNode[] = [];
  private batching = 0;
  // Every formula and watcher run, for showing what work was done.
  runs = 0;
  // Every row each made, the same (L99).
  rowsMade = 0;
  onRun: ((node: CellNode) => void) | null = null;
  // How each watcher's update runs, the formulas it checks included: a page
  // gives each one its own step budget (html.ts).
  around: (update: () => void) => void = (update) => update();
  private same: (a: Value, b: Value) => boolean;
  // Where a row's reads through its item's view go while each makes it.
  private row: CellNode | null = null;
  private shape: Lists | null = null;
  private compared: Lists | null = null;
  // Each cell's place in the order cells were made, told when it's made
  // and with each write: a page with sound sends its writes to the audio
  // thread's run of main, whose cells were made in the same order
  // (AUDIO.md, audio-page.ts).
  private made = 0;
  private order = new WeakMap<CellNode, number>();
  onCell: ((c: Value, place: number) => void) | null = null;
  // While a list, each cell made goes on it with the value it was made
  // with: the editor's preview hands what a page did across to the same
  // page compiled (handOver, below).
  kept: { cell: Value; first: Value }[] | null = null;
  // With `at`, v is the new part at that place (an edit, L98), not the
  // whole value.
  onWrite: ((place: number, v: Value, at?: Step[]) => void) | null = null;
  // The event a page's handler is running for (html.ts), the same object
  // through its retries and resumes, so the world remembers a fetch for
  // that event alone (L59c, browser.ts). Formulas and watchers run outside
  // any event: what a view fetched is the page's.
  event: object | null = null;

  // The plain State handler (STABLE-REFERENCES.md §2, L99e): for a program
  // with no formula, watcher, each or page, nothing ever reads a cell
  // reactively, so a write is a store and a read a load. Nothing is
  // compared, copied out of views (there are none) or diffed: writing a
  // list of n items costs 1, not n. Prior art: the State effect's handler
  // (std State, L16a), which this is.
  readonly plain: boolean;

  constructor(same: (a: Value, b: Value) => boolean = Object.is, plain = false) {
    this.same = same;
    this.plain = plain;
  }

  private node(compute: (() => Value) | null, value: Value | undefined, label: string, watcher = false): CellNode {
    const n: CellNode = { value, state: compute ? DIRTY : CLEAN, compute, sources: [], observers: new Set(), watcher, owned: [], label, runs: 0, disposed: false };
    if (this.owner) this.owner.owned.push(n);
    return n;
  }

  private wrap(n: CellNode): Value {
    const f = () => { throw new Error("a cell is read with read, not called"); };
    return Object.assign(f, { [CELL]: n }) as unknown as Value;
  }

  // Solid's createSignal.
  // `lists`: how the program's lists look; a long one (a looper's tape)
  // goes on a tape now, in main, not at its first edit in an audio block.
  cell(initial: Value, label = "cell", lists?: Lists): Value {
    const n = this.node(null, this.plain ? initial : this.plainOf(initial), label), c = this.wrap(n), place = this.made++;
    if (lists?.views && longList(n.value as Value, lists.views)) taped(n, lists);
    this.order.set(n, place);
    this.onCell?.(c, place);
    this.kept?.push({ cell: c, first: n.value as Value });
    return c;
  }

  // A cell of the runtime's own, not the program's (the platform's sound
  // latency, C260): it has no place among the cells, so nothing sends it
  // to the audio thread or hands it over, and making it moves no place.
  own(initial: Value, label = "own"): Value {
    return this.wrap(this.node(null, initial, label));
  }

  // Solid's createMemo, lazy: nothing runs until the first read.
  formula(compute: () => Value, label = "formula"): Value {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    return this.wrap(this.node(compute, undefined, label));
  }

  read(c: Value, at?: Step[]): Value {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
    return this.readNode(n, at);
  }

  // A read whose value the compiler followed (C162): the reader waits on
  // these places of it only (keys as keyOf makes them, with meets' `*/`
  // and `=`), as if it had read each with read at.
  // How lists look, so a whole new value is compared with the old one
  // place by place (`differences`) from the first write, not only once
  // `each` made a view: its readers of places then wake only for theirs.
  // Only for comparing: what's written is looked through for views only
  // once a view was made (plainOf).
  knowLists(lists: Lists): void { this.compared ??= lists; }

  readPaths(c: Value, keys: string[], kept: string[] = []): Value {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
    return this.readNode(n, undefined, keys, kept);
  }

  private readNode(n: CellNode, at?: Step[], keys?: string[], kept?: string[]): Value {
    this.track(n, at, keys, kept);
    return n.value as Value;
  }

  // The reader running reads n (at a place, or whole), and n is brought up
  // to date.
  private track(n: CellNode, at?: Step[], keys?: string[], kept?: string[]): void {
    if (this.plain) return;
    // The reader depends on it even if computing it stops part way, so it
    // runs again when what the formula read changes.
    const r = this.current;
    if (r) {
      const first = !r.sources.includes(n);
      if (first) { r.sources.push(n); n.observers.add(r); }
      // A read of a place adds the place; a whole read, or a place read
      // after one, keeps the reader waking at every change.
      if ((at || keys) && n.compute === null && (first || r.paths?.has(n))) {
        (r.paths ??= new Map()).set(n, [...(r.paths.get(n) ?? []), ...(keys ?? [keyOf(at!)])]);
        if (kept?.length && (first || r.kept?.has(n))) (r.kept ??= new Map()).set(n, [...(r.kept.get(n) ?? []), ...kept]);
        else r.kept?.delete(n);
      } else { r.paths?.delete(n); r.kept?.delete(n); }
    }
    if (n.compute) this.update(n);
    if (n.error !== undefined) throw n.error;
  }

  // Whether a view (a formula or watcher, or a row it makes) is running
  // outside any handler's event: what it reads of the world, the clock
  // on a frame above all, follows from the page as it is, so a page's log
  // keeps none of it and a replay answers it live (I265).
  inView(): boolean { return (this.current !== null || this.row !== null) && this.event === null; }

  // Look at a cell without becoming its reader (Solid's untrack).
  peek(c: Value): Value {
    const saved = this.current;
    this.current = null;
    try { return this.read(c); } finally { this.current = saved; }
  }

  write(c: Value, v: Value, at?: Step[], what?: Edit): void {
    const n = nodeOf(c);
    if (!n) throw new Error("write needs a cell");
    if (n.compute) throw new Error("a formula can't be written: write the cells it reads");
    if (this.plain) {
      if (this.journal) { const old = n.value as Value; this.journal.undo.push(() => { n.value = old; }); }
      n.value = v;
      if (this.onWrite) this.onWrite(this.order.get(n)!, v);
      return;
    }
    // The value it holds, written back: nothing to copy or compare (a
    // cell never holds a view, C85).
    if (at === undefined && v === n.value) return;
    // An edit (at given) copied its new part out of views already.
    if (at === undefined) v = this.plainOf(v);
    // Compared only where they differ (C287: the state written again with a
    // card more is the old one but for its list of cards, which is longer).
    const lists = this.shape ?? this.compared;
    const looked = at === undefined && n.value !== undefined && !!lists;
    const apart = looked ? differences(n.value as Value, v, lists!) : null;
    if (apart ? apart.every((p) => !p.sure && this.same(p.a, p.b)) : this.same(n.value as Value, v)) return;
    const was = at === undefined ? n.value as Value : undefined;
    if (this.journal) { const old = n.value as Value; this.journal.undo.push(() => this.write(c, old)); }
    n.value = v;
    if (this.onWrite) this.onWrite(this.order.get(n)!, v);
    this.wake(n, at, what, was, v, looked ? apart : undefined);
  }

  // `apart`: the places where was and v differ, when the write found them.
  private wake(n: CellNode, at: Step[] | undefined, what: Edit | undefined, was: Value | undefined, v: Value, apart?: Place[] | null): void {
    // A change at a place wakes the readers of that place, of a place
    // inside it and of one around it; the rest read elsewhere (L98).
    // A place read through a view wakes only for an edit there or around
    // it; and a row's places don't wake when its list only moved it.
    // A whole new value: the places where it differs from the old one,
    // what they share skipped, so only their readers wake (C86, as Solid's
    // `reconcile` diffs an immutable value into a store).
    const lists = this.shape ?? this.compared;
    const found = at || apart !== undefined ? apart : was !== undefined && lists ? differences(was, v, lists) : null;
    const ats = at ? [at] : found ? found.map((p) => p.at) : null;
    const keys = ats?.map(keyOf);
    if (what && at && what.kind !== "write") for (const o of n.observers) o.shift?.(what, at);
    const hits = (at: Step[]) => (seen: Seen) => {
      if (!seen.row) return keyIs(at, seen.rel);
      const place = placeOf(seen.row);
      // An insert, remove or move in a list around the row's item only
      // moves it (or drops it, which its each does).
      if (!place || (what && what.kind !== "write" && at.length < place.length)) return false;
      return keyIs(at, [...place, ...seen.rel]);
    };
    for (const o of n.observers) {
      // An each's edits since it last ran (L99), kept in its own array (it
      // takes them, leaving a new one). One that waits through many
      // writes, an item's steps while others are added, matches again when
      // it runs instead: copying or keeping every edit made adding an item
      // to a long outline grow with all the edits before it (L98c).
      if (o.edits) { if (what && o.edits.length < 32) o.edits.push(what); else o.edits = null; }
      const ps = keys === undefined ? undefined : o.paths?.get(n);
      if (!ps || keys!.some((key) => ps.some((p) => meets(p, key))) || ats!.some((at) => o.views?.get(n)?.some(hits(at)))) {
        this.mark(o, DIRTY);
        if (o.rowOf && !o.rowOf.disposed) this.mark(o.rowOf, DIRTY);
      } else if (was !== undefined && lists && o.kept?.has(n) && !this.patched(o, o.kept.get(n)!, ats!, keys!, was, v, lists)) this.mark(o, DIRTY);
    }
    if (!this.batching) this.flush();
  }

  // An edit at a place in a cell's value (L98): change(part) put there,
  // only that path copied, the readers of other places left asleep. The
  // readers of every place inside it wake too, so an insert, remove or move
  // in a list wakes the readers of its items, whose positions it shifts.
  // `what` says which edit it is, for each; a plain write at the place
  // when not given.
  edit(c: Value, at: Step[], change: (part: Value) => Value | undefined, lists: Lists, what: Edit = { at, kind: "write" }): void {
    const n = nodeOf(c);
    if (!n) throw new Error("an edit needs a cell");
    if (n.compute) throw new Error("a formula can't be written: write the cells it reads");
    // At an item of the list the cell holds (an item step first: the
    // value is a list, as the path's type says): in place, on its tape.
    const top = at[0];
    if (what.kind === "write" && top && "item" in top) return this.editTape(n, top.item, at, change, lists, what);
    const old = n.value as Value;
    if (at.some((s) => "key" in s)) { at = resolved(old, at, lists); what = { ...what, at }; }
    const next = changeAt(old, at, (part) => { const v = change(part); return v === undefined || this.plain ? v : this.plainOf(v); }, lists);
    if (next !== old) this.write(c, next, at, what);
  }

  private editTape(n: CellNode, i: number, at: Step[], change: (part: Value) => Value | undefined, lists: Lists, what: Edit): void {
    const t = taped(n, lists);
    if (!(i >= 0 && i < t.items.length)) return;
    const was = t.items[i], part = changeAt(was, at.slice(1), (x) => { const v = change(x); return v === undefined || this.plain ? v : this.plainOf(v); }, lists);
    if (part === was || (at.length === 1 && this.same(was, part))) return;
    if (this.journal) this.journal.undo.push(() => { const u = tapeOf(n); if (u) { setItem(u, i, was); u.list = undefined; } else this.edit(this.wrap(n), [{ item: i }], () => was, lists); });
    setItem(t, i, part);
    t.list = undefined;
    if (this.onWrite) this.onWrite(this.order.get(n)!, part, [{ item: i }]);
    if (!this.plain) this.wake(n, at, what, undefined, part);
  }

  // What's at item i of the list at `base` in a cell's value: readAt
  // there. A tape's item read outside any reader makes no steps (C273: a
  // looper reads its tape each sample).
  readItem(c: Value, base: Step[], i: number, lists: Lists): Value | undefined {
    const n = nodeOf(c), t = n && base.length === 0 ? tapeOf(n) : undefined;
    if (t && (this.plain || this.current === null) && !n!.compute && n!.error === undefined) return t.items[i];
    return this.readAt(c, [...base, { item: i }], lists);
  }

  // Item i of the list at `base` in a cell's value written: edit there.
  // On a tape no reader or journal waits on, in place with no path made
  // (C273).
  writeItem(c: Value, base: Step[], i: number, v: Value, lists: Lists): void {
    const n = nodeOf(c);
    if (n && base.length === 0 && !n.compute && !this.journal && n.observers.size === 0) {
      const t = taped(n, lists);
      if (!(i >= 0 && i < t.items.length)) return;
      const part = this.plain ? v : this.plainOf(v);
      if (this.same(t.items[i], part)) return;
      setItem(t, i, part);
      t.list = undefined;
      if (this.onWrite) this.onWrite(this.order.get(n)!, part, [{ item: i }]);
      if (!this.plain && !this.batching) this.flush();
      return;
    }
    this.edit(c, [...base, { item: i }], () => v, lists);
  }

  // Items from..from+count of the list a cell holds, without reading it
  // whole (what the audio thread sends the page of a tape it wrote).
  itemsAt(c: Value, from: number, count: number, lists: Lists): Value[] {
    const n = nodeOf(c);
    if (!n) throw new Error("itemsAt needs a cell");
    return Array.from(taped(n, lists).items.slice(from, from + count) as ArrayLike<Value>);
  }

  // The items of the list a cell holds while it's on a tape, else null:
  // what a page sends a sound of a tape, without making the list.
  tapeItems(c: Value): ArrayLike<Value> | null {
    const n = nodeOf(c), t = n && tapeOf(n);
    return t ? t.items : null;
  }

  // Items written at from, from, from + 1, … of the list a cell holds, in
  // place: one wake for all of them.
  writeItems(c: Value, from: number, xs: Value[], lists: Lists): void {
    const n = nodeOf(c);
    if (!n) throw new Error("writeItems needs a cell");
    const t = taped(n, lists), end = Math.min(t.items.length, from + xs.length);
    if (from < 0 || from >= end) return;
    for (let i = from; i < end; i++) setItem(t, i, xs[i - from]);
    t.list = undefined;
    if (this.onWrite) for (let i = from; i < end; i++) this.onWrite(this.order.get(n)!, t.items[i], [{ item: i }]);
    if (this.plain) return;
    // Readers of these items wake, and whole readers, after all of them.
    this.batching++;
    try { for (let i = from; i < end; i++) this.wake(n, [{ item: i }], { at: [{ item: i }], kind: "write" }, undefined, t.items[i]); } finally { this.batching--; }
    if (!this.batching) this.flush();
  }

  // What's at a place in a cell's value, read as a reader of that place
  // only; undefined when there's no such item.
  readAt(c: Value, at: Step[], lists: Lists): Value | undefined {
    const n = nodeOf(c), top = at[0], t = n && tapeOf(n);
    if (n && t && top && "item" in top) {
      this.track(n, at);
      const x = t.items[top.item];
      return x === undefined ? undefined : partAt(x, at.slice(1), lists);
    }
    if (at.some((s) => "key" in s)) at = resolved(this.peek(c), at, lists);
    return partAt(this.read(c, at), at, lists);
  }

  // The reader of a place read through a view: the formula or watcher
  // running, else the row each is making.
  private seen(n: CellNode, seen: Seen): void {
    const r = this.current ?? this.row;
    if (!r) return;
    if (!r.sources.includes(n)) { r.sources.push(n); n.observers.add(r); (r.paths ??= new Map()).set(n, []); }
    else if (!r.paths?.has(n)) return; // it read the whole value: it wakes at every change
    const vs = (r.views ??= new Map());
    const all = vs.get(n);
    if (all) all.push(seen); else vs.set(n, [seen]);
  }

  // A view of what's at `rel` (from the row's item when row is given) in
  // n's value. A record's fields and a list's items read through it are
  // views again; anything else read is a place the reader waits on.
  private view(n: CellNode, row: Spot | null, rel: Step[], lists: Lists): Value {
    const shape = lists.views!;
    const steps = () => { const place = row ? placeOf(row) : []; return place && [...place, ...rel]; };
    let last: Value | undefined;
    // What's there now; the last thing seen once the row is gone.
    const now = (): Value => {
      const at = steps(), v = at ? partAt(n.value as Value, at, lists) : undefined;
      if (v !== undefined) last = v;
      return last!;
    };
    const part = (inner: Step[], v: Value): Value => {
      const b = shape.bools, d = v as unknown as Data;
      if (b && typeof v === "object" && v !== null && (d.tag === b.t || d.tag === b.f) && d.fields.length === 0) { this.seen(n, { row, rel: inner }); return (d.tag === b.t) as unknown as Value; }
      if (typeof v === "object" && v !== null) return this.view(n, row, inner, lists);
      this.seen(n, { row, rel: inner });
      return v;
    };
    now();
    let made: Value;
    if (shape.isList(last!)) {
      // A list read case by case, as a list's code takes it apart: one
      // place for its cases (the list, which an insert, remove or move
      // edits), one per item.
      let held: Value | undefined, xs: Value[] = [];
      const items = () => { const l = now(); if (l !== held) { held = l; xs = lists.from(l); } return xs; };
      const from = (o: number): Value => {
        const fields = new Proxy([] as Value[], {
          get: (t, k) => {
            if (k === "length") return o < items().length ? 2 : 0;
            if (k === "0") return part([...rel, { item: o }], items()[o]);
            if (k === "1") return from(o + 1);
            return Reflect.get(t, k);
          },
        });
        const v = new Proxy({ tag: "", fields } as unknown as object, {
          get: (t, k) => {
            if (k === "tag") { this.seen(n, { row, rel }); return o < items().length ? shape.cons : shape.nil; }
            if (k === "fields") return fields;
            return Reflect.get(t, k);
          },
        }) as unknown as Value;
        VIEWS.set(v as unknown as object, () => lists.to(items().slice(o)));
        if (o === 0) LIST_AT.set(v as unknown as object, { n, row, rel });
        return v;
      };
      made = from(0);
    } else {
      const fields = new Proxy([] as Value[], {
        get: (t, k) => {
          const d = now() as unknown as Data;
          if (k === "length") return d.fields.length;
          if (typeof k === "string" && /^\d+$/.test(k)) return part([...rel, { field: Number(k) }], d.fields[Number(k)]);
          return Reflect.get(t, k);
        },
      });
      made = new Proxy({ tag: "", fields } as unknown as object, {
        get: (t, k) => {
          if (k === "tag") { this.seen(n, { row, rel }); return (now() as unknown as Data).tag; }
          if (k === "fields") return fields;
          return Reflect.get(t, k);
        },
      }) as unknown as Value;
      VIEWS.set(made as unknown as object, now);
    }
    this.shape = lists;
    return made;
  }

  // v with every view in it replaced by what it shows now.
  private plainOf(v: Value): Value {
    const lists = this.shape;
    if (!lists) return v;
    const out = (x: Value): Value => {
      if (typeof x !== "object" || x === null || PLAIN.has(x as unknown as object)) return x;
      const seen = VIEWS.get(x as unknown as object);
      if (seen) return seen();
      if (lists.views!.isList(x)) {
        const xs = lists.from(x), ys = xs.map(out);
        if (ys.some((y, i) => y !== xs[i])) return lists.to(ys);
      } else {
        const d = x as unknown as Data, fields = d.fields.map(out);
        if (fields.some((f, i) => f !== d.fields[i])) return { tag: d.tag, fields } as unknown as Value;
      }
      PLAIN.add(x as unknown as object);
      return x;
    };
    return out(v);
  }

  // Solid's createEffect: run now, and again whenever a cell it read
  // changes. Watchers are how the outside world (a page) observes cells.
  watch(run: () => void, label = "watcher"): CellNode {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    const n = this.node(() => { run(); return undefined as unknown as Value; }, undefined, label, true);
    this.update(n);
    return n;
  }

  // Several writes, then the watchers run once.
  batch<T>(f: () => T): T {
    this.batching++;
    try { return f(); } finally { if (--this.batching === 0) this.flush(); }
  }

  // A batch that may be taken back: when f throws an error `back` accepts,
  // every cell it wrote has its old value again, what it wrote elsewhere
  // is undone (undo), and what can't be undone (later: a printed line) never
  // happens. A page runs an event handler so: one that fetched what hasn't
  // come is abandoned and runs again when the reply lands, and an
  // abandoned run leaves nothing behind, as a path a search abandons
  // doesn't (EFFECTS-REVIEW-2026-10-24 §1.1, BACKLOG L52). Software
  // transactional memory's retry, in one thread (Harris, Marlow, Peyton
  // Jones and Herlihy, 2005).
  private journal: Journal | null = null;
  attempt<T>(f: () => T, back: (e: unknown) => boolean): T {
    if (this.journal) return f();
    const j: Journal = (this.journal = { undo: [], later: [] });
    this.batching++;
    try {
      const v = f();
      this.journal = null;
      for (const g of j.later) g();
      return v;
    } catch (e) {
      this.journal = null;
      if (back(e)) for (const g of j.undo.reverse()) g();
      else for (const g of j.later) g();
      // A held wait keeps the batch open till its run ends (release).
      if (e instanceof Pending && e.hold) this.batching++;
      throw e;
    } finally {
      this.journal = null;
      if (--this.batching === 0) this.flush();
    }
  }
  // A held wait's run has ended (C61 c′): the page shows what it did.
  release(): void { if (--this.batching === 0) this.flush(); }
  // Undone if the attempt this runs in is taken back.
  undo(g: () => void): void { this.journal?.undo.push(g); }
  // Now, or when the attempt this runs in is kept.
  later(g: () => void): void { if (this.journal) this.journal.later.push(g); else g(); }

  // A list mapped item by item, as a formula: an item that's still there
  // (equal to one from the last time) keeps what f made of it, and only new
  // items are mapped. f runs untracked, in an owner of its own per item, so
  // what it makes (cells, a page's watchers) lives as long as the item.
  // This is Solid's mapArray, which its <For> is built on. `list` turns the
  // language's lists into arrays and back.
  each(items: Value, f: (item: Value) => Value, list: Lists, label = "each"): Value {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    return this.mapRows(nodeOf(items), null, f, list, label);
  }

  // `each` over a list inside a cell's value (each of): a row's item's
  // steps, say, handed to it as a view. Its rows follow the edits of that
  // list as each's follow the cell's, and it reads only that list, so a
  // step added makes one row and leaves the item's own row as it was.
  // Over a plain list, the list mapped once.
  eachOf(items: Value, f: (item: Value) => Value, list: Lists, label = "each of"): Value {
    if (this.plain) throw new Error("cells kept plainly have no formulas, watchers or each");
    const at = typeof items === "object" && items !== null ? LIST_AT.get(items as unknown as object) : undefined;
    if (at && at.n.compute === null && !at.n.disposed) return this.mapRows(at.n, at, f, list, label);
    return this.mapRows(this.node(null, this.plainOf(items), label), null, f, list, label);
  }

  // each's rows over the list in `source`: its whole value, or the list
  // at `base` in it.
  private mapRows(source: CellNode | null, base: ListAt | null, f: (item: Value) => Value, list: Lists, label: string): Value {
    if (!source) throw new Error("each needs a cell");
    type Row = { item: Value; value: Value; root: CellNode; spot: Spot };
    let rows: Row[] = [];
    // Where the list is now: null once the row it's in is gone.
    const path = (): Step[] | null => {
      if (!base) return [];
      const place = base.row ? placeOf(base.row) : [];
      return place && [...place, ...base.rel];
    };
    const up = base ? path : undefined;
    // Over a cell, with views (L99): a row gets its item as a view, and
    // what it reads of it while being made is its root's, so an edit inside
    // the item makes the row again only when the row read that place; what
    // its watchers read is theirs.
    const viewing = !!list.views && source.compute === null;
    const row = (item: Value, i: number, made: CellNode[]): Row => {
      const root: CellNode = { value: undefined, state: CLEAN, compute: null, sources: [], observers: new Set(), watcher: false, owned: [], label: `${label} row`, runs: 0, disposed: false, rowOf: cell };
      made.push(root);
      const spot: Spot = { i, up };
      const [current, owner, reading] = [this.current, this.owner, this.row];
      this.current = null;
      this.owner = root;
      this.row = viewing ? root : null;
      let value: Value;
      // A text or number has no places inside: the row read all of it.
      const given = () => {
        if (!viewing) return item;
        if (typeof item === "object" && item !== null) return this.view(source, spot, [], list);
        this.seen(source, { row: spot, rel: [] });
        return item;
      };
      try { value = f(given()); } finally { this.current = current; this.owner = owner; this.row = reading; }
      if (typeof value === "object" && value !== null) KEPT.set(value, root);
      this.rowsMade++;
      return { item, value, root, spot };
    };
    // Driven by the edits (L99): when everything since the last run was an
    // edit of the list itself or of one item, each follows them, one row
    // made, moved or disposed per edit, and nothing is matched. Otherwise
    // (the first run, a whole write) items are matched by equality, as
    // Solid's mapArray does. Edits are taken from the list's own place;
    // one elsewhere in the cell is no row's, one around the list (its row
    // moved, say) is followed by matching.
    const follow = (all: Edit[], xs: Value[], made: CellNode[]): { rows: Row[]; gone: Row[] } | null => {
      const next = [...rows], gone: Row[] = [], here = path();
      if (!here) return null;
      const edits: Edit[] = [];
      for (const e of all) {
        if (!keyIs(here, e.at) && !keyIs(e.at, here)) continue;
        if (e.at.length < here.length) return null;
        edits.push({ ...e, at: e.at.slice(here.length) });
      }
      for (const e of edits) {
        if (e.at.length === 0 && e.kind === "insert") next.splice(Math.min(e.i, next.length), 0, null as unknown as Row);
        else if (e.at.length === 0 && e.kind === "remove") gone.push(...next.splice(e.i, 1).filter(Boolean));
        else if (e.at.length === 0 && e.kind === "move") next.splice(e.to, 0, next.splice(e.from, 1)[0]);
        else if (e.at.length > 0 && "item" in e.at[0]) {
          const i = e.at[0].item;
          // Its views show the edit already; only a row that read the
          // place while being made is made again.
          if (next[i] && viewing && next[i].root.state === CLEAN) continue;
          if (next[i]) gone.push(next[i]);
          next[i] = null as unknown as Row;
        }
        else return null;
      }
      if (next.length !== xs.length) return null;
      // The rows kept are given their items once every new one is made (a
      // run stopped part way leaves the rows as they were).
      const kept: number[] = [];
      for (let i = 0; i < next.length; i++) { if (!next[i]) next[i] = row(xs[i], i, made); else if (next[i].item !== xs[i]) kept.push(i); }
      for (const i of kept) next[i].item = xs[i];
      return { rows: next, gone };
    };
    const cell = this.node(() => {
      const old = [...rows], made: CellNode[] = [];
      const edits = cell.edits;
      cell.edits = [];
      let gone: Row[];
      try {
        // A list inside the value is read as a view reads it, its cases
        // only: an edit inside one of its items wakes this only through
        // the row that read that place.
        const here = path();
        if (base) this.seen(source, { row: base.row, rel: base.rel });
        const xs = here ? list.from(partAt(base ? (source.value as Value) : this.readNode(source), here, list) ?? list.to([])) : [];
        const followed = edits && edits.length && rows.length ? follow(edits, xs, made) : null;
        if (followed) { rows = followed.rows; gone = followed.gone; }
        else {
          // The rows that kept their place and their item first (C287: an
          // add at the end matched every row again, each with a call of
          // equal and a splice at the front of the old rows); the rest
          // by the same item, then an equal one.
          let k = 0;
          while (k < old.length && k < xs.length && old[k].item === xs[k]) k++;
          const rest = old.slice(k);
          rows = old.slice(0, k);
          for (let at = k; at < xs.length; at++) {
            const item = xs[at];
            let i = rest.findIndex((r) => r.item === item);
            if (i < 0) i = rest.findIndex((r) => this.same(r.item, item));
            rows.push(i >= 0 ? rest.splice(i, 1)[0] : row(item, at, made));
          }
          gone = rest;
        }
        rows.forEach((r, i) => { r.spot.i = i; });
      } catch (e) {
        // Stopped part way (out of steps, waiting): what it made goes, and
        // the rows stay as they were.
        made.forEach((r) => this.dispose(r));
        rows = old;
        cell.edits = null;
        throw e;
      }
      gone.forEach((r) => { r.spot.i = -1; this.dispose(r.root); });
      return list.to(rows.map((r) => r.value));
    }, undefined, label);
    cell.edits = null;
    // Between an edit and the next run, rows' places follow the edits, so
    // a view read in between reads its own item.
    if (viewing) cell.shift = (what, at) => {
      const here = path();
      if (here && here.length === at.length && keyIs(here, at)) for (const r of rows) r.spot.i = shifted(r.spot.i, what);
    };
    cell.onDispose = () => rows.forEach((r) => this.dispose(r.root));
    return this.wrap(cell);
  }

  // Run with `owner` as the owner of what's made (a kept row drawn again).
  under<T>(owner: CellNode, run: () => T): T {
    const saved = this.owner;
    this.owner = owner;
    try { return run(); } finally { this.owner = saved; }
  }

  dispose(n: CellNode): void {
    const also = n.onDispose;
    n.onDispose = undefined;
    also?.();
    n.disposed = true;
    for (const s of n.sources) s.observers.delete(n);
    n.sources = [];
    n.paths = undefined;
    n.views = undefined;
    n.owned.forEach((o) => this.dispose(o));
    n.owned = [];
  }

  private mark(n: CellNode, state: number): void {
    if (n.state >= state) return;
    if (n.state === CLEAN && n.watcher) this.queue.push(n);
    n.state = state;
    for (const o of n.observers) this.mark(o, CHECK);
  }

  private flush(): void {
    while (this.queue.length) {
      const n = this.queue.shift()!;
      if (!n.disposed) this.around(() => this.update(n));
    }
  }

  // Bring a formula or watcher up to date: a "check" one asks its sources
  // first, and recomputes only if one of them really changed.
  private update(n: CellNode): void {
    const event = this.event;
    this.event = null;
    try { this.updating(n); } finally { this.event = event; }
  }
  private updating(n: CellNode): void {
    if (n.state === CHECK) {
      for (const s of n.sources) {
        // A source that stops makes this one run again, and stop the same
        // way inside its own run, where a page can say so.
        if (s.compute) try { this.update(s); } catch { n.state = DIRTY; }
        // update(s) may have marked n dirty, which the type checker can't see.
        if ((n.state as number) === DIRTY) break;
      }
    }
    if (n.state === DIRTY) {
      const stopped = n.error !== undefined;
      try {
        this.recompute(n);
        // It has a value again: whoever read it last saw it stop.
        if (stopped) { n.error = undefined; for (const o of n.observers) o.state = DIRTY; }
      } catch (e) {
        if (e instanceof Pending) throw e;
        n.error = e;
        n.state = CLEAN;
        throw e;
      }
    }
    n.state = CLEAN;
  }

  // A change inside places a formula's answer holds as they were (kept),
  // outside what it looked at: each such part put into its last answer
  // where the old one was, found by identity, and its readers woken, as
  // if it had run again (C162c). An answer that doesn't hold the old part
  // stays as it is: what it looked at didn't change, so it would leave the
  // part out again. False when that can't be done: it hasn't an answer
  // now, the part isn't an object (a number is found by value, not by
  // identity), or the same part was at more than one place (then which
  // one it held can't be told).
  private patched(o: CellNode, kept: string[], ats: Step[][], keys: string[], was: Value, v: Value, lists: Lists): boolean {
    if (o.state !== CLEAN || o.error !== undefined || o.watcher || o.value === undefined) return false;
    let answer = o.value as Value;
    for (let k = 0; k < ats.length; k++) {
      const n = kept.map((p) => inside(p, keys[k])).find((x) => x >= 0);
      if (n === undefined) continue;
      const at = ats[k].slice(0, n), old = partOf(was, at, lists), now = partOf(v, at, lists);
      if (old === undefined || now === undefined || typeof old !== "object" || old === null) return false;
      // The one place of the old value that held it.
      if (at.length && "item" in at[at.length - 1]) {
        const up = partOf(was, at.slice(0, -1), lists);
        if (up === undefined || timesIn(up, old, lists) !== 1) return false;
      }
      answer = replaced(answer, old, now, lists, 0);
    }
    if (answer === o.value) return true;
    o.value = answer;
    for (const r of o.observers) this.mark(r, DIRTY);
    return true;
  }

  private recompute(n: CellNode): void {
    for (const s of n.sources) s.observers.delete(n);
    n.sources = [];
    n.paths = undefined;
    n.kept = undefined;
    n.views = undefined;
    n.owned.forEach((o) => this.dispose(o));
    n.owned = [];
    const [current, owner] = [this.current, this.owner];
    this.current = n;
    this.owner = n;
    let v: Value;
    try { v = n.compute!(); } finally { this.current = current; this.owner = owner; }
    n.runs++;
    this.runs++;
    this.onRun?.(n);
    const first = n.runs === 1;
    if (first) { n.value = v; return; }
    // A list that only gained items (C287: a card added, and the cards
    // shown are the old ones and it): its eaches follow the inserts, one
    // row made, instead of matching every row again.
    const lists = this.shape ?? this.compared;
    const grown = lists ? inserted(n.value as Value, v, lists) : null;
    if (grown && !grown.length) return;
    if (grown || !this.same(n.value as Value, v)) {
      n.value = v;
      for (const o of n.observers) {
        o.state = DIRTY;
        if (o.edits) { if (grown && o.edits.length + grown.length <= 32) o.edits.push(...grown); else o.edits = null; }
      }
    }
  }
}

// What a page did, handed to the same page started again (I109): the
// editor's preview shows a page interpreted at once and swaps in the
// compiled page a few seconds later. Both made their cells in the same
// order, so a cell of the first that changed since it was made is written
// to the second's cell at the same place. Only when both were made with
// the same value (so the two engines hold it the same way) and the value
// is plain data: a function or a cell inside can't be carried across.
// Returns how many were carried.
//
// `whole` (E279a): the two pages are two versions of a program, the
// second the first edited, so a cell's place says which it is only when
// both made as many cells. When they didn't (an edit added or took away
// a cell), nothing is carried and it returns -1: the page starts afresh.
// A cell made with another value than before (the edit changed it) starts
// from its new one, as above.
type Kept = NonNullable<Cells["kept"]>;
export function handOver(a: Kept, b: Kept, to: Pick<Cells, "write" | "batch">, whole = false): number {
  if (whole && a.length !== b.length) return -1;
  const moves: [Value, Value][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const n = nodeOf(a[i].cell);
    if (!n || n.disposed) continue;
    const now = n.value as Value;
    // The two engines may hold lists two ways (C354: the compiled page's
    // as arrays): what's carried is made the other's way.
    const way = listsWay(a[i].first, b[i].first);
    if (way === null) { if (plainSame(a[i].first, b[i].first) && plainSame(now, now) && !plainSame(now, a[i].first)) moves.push([b[i].cell, now]); continue; }
    if (plainSame(reshaped(a[i].first, b[i].first, way), b[i].first) && plainSame(now, now) && !plainSame(now, a[i].first)) moves.push([b[i].cell, reshaped(now, b[i].first, way) as Value]);
  }
  to.batch(() => { for (const [c, v] of moves) to.write(c, v); });
  return moves.length;
}
// A cell's value carried to the same cell of the same page in the other
// engine (I239f: a compiled page's snapshot taken up by the interpreted
// page), from what both were made with: unchanged, the other's own first
// value; changed to plain data, that data, when both were made with the
// same plain data. Null when it can't be carried.
export function carried(fromFirst: unknown, toFirst: Value, now: unknown): { value: Value } | null {
  if (now === fromFirst || plainSame(now, fromFirst)) return { value: toFirst };
  const way = listsWay(fromFirst, toFirst);
  if (way !== null) return plainSame(reshaped(fromFirst, toFirst, way), toFirst) && plainSame(now, now) ? { value: reshaped(now, toFirst, way) as Value } : null;
  return plainSame(fromFirst, toFirst) && plainSame(now, now) ? { value: now as Value } : null;
}
// Lists held two ways, a's cons cells where b has an array (true: made
// arrays) or the other way (false), found where both hold a list at the
// same place; null where they hold them the same way.
type ListData = { tag: string; fields: unknown[] };
const isCons = (v: unknown): v is ListData => typeof v === "object" && v !== null && !(v instanceof ArrayView) && ((v as ListData).tag === CONS || (v as ListData).tag === NIL);
function listsWay(a: unknown, b: unknown): boolean | null {
  const todo: unknown[] = [a, b];
  for (let steps = 0; todo.length && steps < 100000; steps++) {
    const y = todo.pop(), x = todo.pop();
    if (isCons(x) && y instanceof ArrayView) return true;
    if (x instanceof ArrayView && isCons(y)) return false;
    if (x instanceof ArrayView && y instanceof ArrayView) { if (x.n && y.n) todo.push(x.buf.items[x.start], y.buf.items[y.start]); continue; }
    if (isCons(x) && isCons(y)) { if (x.tag === CONS && y.tag === CONS) todo.push(x.fields[0], y.fields[0]); continue; }
    if (typeof x !== "object" || typeof y !== "object" || !x || !y) continue;
    const d = x as ListData, e = y as ListData;
    if (typeof d.tag === "string" && d.tag === e.tag && Array.isArray(d.fields) && Array.isArray(e.fields) && d.fields.length === e.fields.length) for (let i = 0; i < d.fields.length; i++) todo.push(d.fields[i], e.fields[i]);
  }
  return null;
}
// v with its lists held as `like` holds them where it holds one at that
// place, and elsewhere as arrays (`arrays`) or cons cells.
function reshaped(v: unknown, like: unknown, arrays: boolean): unknown {
  if (typeof v !== "object" || v === null) return v;
  const list = v instanceof ArrayView || isCons(v);
  if (list) {
    const guide = like instanceof ArrayView || isCons(like) ? like : undefined;
    const want = guide === undefined ? arrays : guide instanceof ArrayView;
    const g = guide instanceof ArrayView ? (guide.n ? guide.buf.items[guide.start] : undefined) : guide?.tag === CONS ? guide.fields[0] : undefined;
    const xs: unknown[] = [];
    if (v instanceof ArrayView) { for (const x of Array.from(itemsIn(v))) xs.push(reshaped(x, g, arrays)); }
    else for (let d = v as ListData; d.tag === CONS; d = d.fields[1] as ListData) xs.push(reshaped(d.fields[0], g, arrays));
    if (want) return arrayOf(xs);
    let l: unknown = { tag: NIL, fields: [] };
    for (let i = xs.length - 1; i >= 0; i--) l = { tag: CONS, fields: [xs[i], l] };
    return l;
  }
  const d = v as ListData, e = like as ListData | undefined;
  if (typeof d.tag !== "string" || !Array.isArray(d.fields)) return v;
  const same = !!e && typeof e === "object" && e.tag === d.tag && Array.isArray(e.fields) && e.fields.length === d.fields.length;
  let fields: unknown[] | null = null;
  d.fields.forEach((x, i) => { const y = reshaped(x, same ? e!.fields[i] : undefined, arrays); if (y !== x) (fields ??= d.fields.slice())[i] = y; });
  return fields ? { tag: d.tag, fields } : v;
}
// The same plain data: numbers (NaN the same as NaN), strings, whole
// numbers, and data with the same tag and the same fields. Never true
// with a function in it. Walked with a stack of its own, not by
// recursion (I348): the looper's recordings, lists of a few hundred
// thousand samples, overflowed the call stack, so each edit's compiled
// page failed to take over.
function plainSame(a: unknown, b: unknown): boolean {
  const todo: unknown[] = [a, b];
  while (todo.length) {
    const y = todo.pop(), x = todo.pop();
    if (typeof x !== typeof y) return false;
    if (typeof x === "number" || typeof x === "string" || typeof x === "bigint" || typeof x === "boolean") { if (!(Object.is(x, y) || x === y)) return false; continue; }
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return false;
      for (let i = x.length - 1; i >= 0; i--) todo.push(x[i], y[i]);
      continue;
    }
    if (!x || typeof x !== "object" || !y || Array.isArray(y)) return false;
    const d = x as { tag?: unknown; fields?: unknown[] }, e = y as { tag?: unknown; fields?: unknown[] };
    if (typeof d.tag !== "string" || d.tag !== e.tag || !Array.isArray(d.fields) || !Array.isArray(e.fields) || d.fields.length !== e.fields.length) return false;
    for (let i = d.fields.length - 1; i >= 0; i--) todo.push(d.fields[i], e.fields[i]);
  }
  return true;
}
