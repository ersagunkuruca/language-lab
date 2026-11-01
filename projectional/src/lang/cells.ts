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

import type { Value } from "./run.ts";

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
export const CELL = Symbol("cell");
export const nodeOf = (v: Value): CellNode | null => (typeof v === "function" ? ((v as unknown as Record<symbol, CellNode>)[CELL] ?? null) : null);

// A place inside a cell's value (L98, STABLE-REFERENCES.md §1): item i of
// a list or field i of a record, outermost first. A path is a value of the
// language, made by `path`, `item path` and `then path` (std.ts), and
// compared by identity like a cell; the cell's handler applies an edit at
// one and wakes only the readers whose path meets it.
export type Step = { item: number } | { field: number };
export const PATH = Symbol("path");
export const stepsOf = (v: Value): Step[] | null => (typeof v === "function" ? ((v as unknown as Record<symbol, Step[]>)[PATH] ?? null) : null);
export const pathValue = (steps: Step[]): Value => Object.assign(() => { throw new Error("a path is used by read at and the edits, not called"); }, { [PATH]: steps }) as unknown as Value;
// How a list is taken apart and made: cons cells in the evaluator, the
// compiled code's own lists in JS.
export interface Lists {
  from: (v: Value) => Value[];
  to: (xs: Value[]) => Value;
  // Given, each hands its rows tracked views of their items (L99): the
  // tags of a list's two cases, and how to tell a list from a record.
  views?: { cons: string; nil: string; isList: (v: Value) => boolean };
}
type Data = { tag: string; fields: Value[] };
const keyOf = (steps: Step[]) => steps.map((s) => ("item" in s ? `i${s.item}/` : `f${s.field}/`)).join("");
// The part of v at steps, or undefined when there is no such item.
export function partAt(v: Value, steps: Step[], lists: Lists): Value | undefined {
  for (const s of steps) {
    if ("field" in s) v = (v as unknown as Data).fields[s.field];
    else { const xs = lists.from(v); if (!(s.item >= 0 && s.item < xs.length)) return undefined; v = xs[s.item]; }
  }
  return v;
}
// v with change(part) at steps, copying only the path down to it; v itself
// when there is no such item or change gives undefined.
export function changeAt(v: Value, steps: Step[], change: (part: Value) => Value | undefined, lists: Lists): Value {
  if (!steps.length) return change(v) ?? v;
  const [s, ...rest] = steps;
  if ("field" in s) {
    const d = v as unknown as Data, inner = changeAt(d.fields[s.field], rest, change, lists);
    if (inner === d.fields[s.field]) return v;
    const fields = d.fields.slice();
    fields[s.field] = inner;
    return { ...d, fields } as unknown as Value;
  }
  const xs = lists.from(v);
  if (!(s.item >= 0 && s.item < xs.length)) return v;
  const inner = changeAt(xs[s.item], rest, change, lists);
  if (inner === xs[s.item]) return v;
  const ys = xs.slice();
  ys[s.item] = inner;
  return lists.to(ys);
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
const keyIs = (a: Step[], b: Step[]) => a.length <= b.length && a.every((s, i) => ("item" in s ? "item" in b[i] && b[i].item === (s as { item: number }).item : "field" in b[i] && (b[i] as { field: number }).field === s.field));
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
  constructor(ready: Promise<unknown>, what: string) {
    super(`still waiting for ${what}`);
    this.ready = ready;
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
  onWrite: ((place: number, v: Value) => void) | null = null;

  constructor(same: (a: Value, b: Value) => boolean = Object.is) {
    this.same = same;
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
  cell(initial: Value, label = "cell"): Value {
    const n = this.node(null, this.plainOf(initial), label), c = this.wrap(n), place = this.made++;
    this.order.set(n, place);
    this.onCell?.(c, place);
    this.kept?.push({ cell: c, first: n.value as Value });
    return c;
  }

  // Solid's createMemo, lazy: nothing runs until the first read.
  formula(compute: () => Value, label = "formula"): Value {
    return this.wrap(this.node(compute, undefined, label));
  }

  read(c: Value, at?: Step[]): Value {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
    return this.readNode(n, at);
  }

  private readNode(n: CellNode, at?: Step[]): Value {
    // The reader depends on it even if computing it stops part way, so it
    // runs again when what the formula read changes.
    const r = this.current;
    if (r) {
      const first = !r.sources.includes(n);
      if (first) { r.sources.push(n); n.observers.add(r); }
      // A read of a place adds the place; a whole read, or a place read
      // after one, keeps the reader waking at every change.
      if (at && n.compute === null && (first || r.paths?.has(n))) (r.paths ??= new Map()).set(n, [...(r.paths.get(n) ?? []), keyOf(at)]);
      else r.paths?.delete(n);
    }
    if (n.compute) this.update(n);
    if (n.error !== undefined) throw n.error;
    return n.value as Value;
  }

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
    // An edit (at given) copied its new part out of views already.
    if (at === undefined) v = this.plainOf(v);
    if (this.same(n.value as Value, v)) return;
    if (this.journal) { const was = n.value as Value; this.journal.undo.push(() => this.write(c, was)); }
    n.value = v;
    if (this.onWrite) this.onWrite(this.order.get(n)!, v);
    // A change at a place wakes the readers of that place, of a place
    // inside it and of one around it; the rest read elsewhere (L98).
    // A place read through a view wakes only for an edit there or around
    // it; and a row's places don't wake when its list only moved it.
    const key = at && keyOf(at);
    if (what && at && what.kind !== "write") for (const o of n.observers) o.shift?.(what, at);
    const hits = (seen: Seen) => {
      if (!seen.row) return keyIs(at!, seen.rel);
      const place = placeOf(seen.row);
      // An insert, remove or move in a list around the row's item only
      // moves it (or drops it, which its each does).
      if (!place || (what && what.kind !== "write" && at!.length < place.length)) return false;
      return keyIs(at!, [...place, ...seen.rel]);
    };
    for (const o of n.observers) {
      if (o.edits !== undefined) o.edits = what && o.edits ? [...o.edits, what] : null;
      const ps = key === undefined ? undefined : o.paths?.get(n);
      if (!ps || ps.some((p) => p.startsWith(key!) || key!.startsWith(p)) || o.views?.get(n)?.some(hits)) {
        this.mark(o, DIRTY);
        if (o.rowOf && !o.rowOf.disposed) this.mark(o.rowOf, DIRTY);
      }
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
    const old = n.value as Value, next = changeAt(old, at, (part) => { const v = change(part); return v === undefined ? v : this.plainOf(v); }, lists);
    if (next !== old) this.write(c, next, at, what);
  }

  // What's at a place in a cell's value, read as a reader of that place
  // only; undefined when there's no such item.
  readAt(c: Value, at: Step[], lists: Lists): Value | undefined {
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
      if (typeof x !== "object" || x === null) return x;
      const seen = VIEWS.get(x as unknown as object);
      if (seen) return seen();
      if (lists.views!.isList(x)) {
        const xs = lists.from(x), ys = xs.map(out);
        return ys.some((y, i) => y !== xs[i]) ? lists.to(ys) : x;
      }
      const d = x as unknown as Data, fields = d.fields.map(out);
      return fields.some((f, i) => f !== d.fields[i]) ? ({ ...d, fields } as unknown as Value) : x;
    };
    return out(v);
  }

  // Solid's createEffect: run now, and again whenever a cell it read
  // changes. Watchers are how the outside world (a page) observes cells.
  watch(run: () => void, label = "watcher"): CellNode {
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
      throw e;
    } finally {
      this.journal = null;
      if (--this.batching === 0) this.flush();
    }
  }
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
    return this.mapRows(nodeOf(items), null, f, list, label);
  }

  // `each` over a list inside a cell's value (each of): a row's item's
  // steps, say, handed to it as a view. Its rows follow the edits of that
  // list as each's follow the cell's, and it reads only that list, so a
  // step added makes one row and leaves the item's own row as it was.
  // Over a plain list, the list mapped once.
  eachOf(items: Value, f: (item: Value) => Value, list: Lists, label = "each of"): Value {
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
      return { rows: next.map((r, i) => (r ? { ...r, item: xs[i] } : row(xs[i], i, made))), gone };
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
          rows = xs.map((item, at) => {
            const i = old.findIndex((r) => this.same(r.item, item));
            return i >= 0 ? old.splice(i, 1)[0] : row(item, at, made);
          });
          gone = old;
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

  private recompute(n: CellNode): void {
    for (const s of n.sources) s.observers.delete(n);
    n.sources = [];
    n.paths = undefined;
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
    if (first || !this.same(n.value as Value, v)) {
      n.value = v;
      if (!first) for (const o of n.observers) o.state = DIRTY;
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
type Kept = NonNullable<Cells["kept"]>;
export function handOver(a: Kept, b: Kept, to: Pick<Cells, "write" | "batch">): number {
  const moves: [Value, Value][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const n = nodeOf(a[i].cell);
    if (!n || n.disposed) continue;
    const now = n.value as Value;
    if (plainSame(a[i].first, b[i].first) && plainSame(now, now) && !plainSame(now, a[i].first)) moves.push([b[i].cell, now]);
  }
  to.batch(() => { for (const [c, v] of moves) to.write(c, v); });
  return moves.length;
}
// The same plain data: numbers (NaN the same as NaN), strings, whole
// numbers, and data with the same tag and the same fields. Never true
// with a function in it.
function plainSame(a: unknown, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" || typeof a === "string" || typeof a === "bigint" || typeof a === "boolean") return Object.is(a, b) || a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => plainSame(x, b[i]));
  if (!a || typeof a !== "object" || !b || Array.isArray(b)) return false;
  const x = a as { tag?: unknown; fields?: unknown[] }, y = b as { tag?: unknown; fields?: unknown[] };
  return typeof x.tag === "string" && x.tag === y.tag && Array.isArray(x.fields) && Array.isArray(y.fields) && x.fields.length === y.fields.length && x.fields.every((f, i) => plainSame(f, y.fields![i]));
}
