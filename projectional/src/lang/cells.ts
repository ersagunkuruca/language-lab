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
}

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
export interface Lists { from: (v: Value) => Value[]; to: (xs: Value[]) => Value }
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
  // Each cell's place in the order cells were made, told when it's made
  // and with each write: a page with sound sends its writes to the audio
  // thread's run of main, whose cells were made in the same order
  // (AUDIO.md, audio-page.ts).
  private made = 0;
  private order = new WeakMap<CellNode, number>();
  onCell: ((c: Value, place: number) => void) | null = null;
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
    const n = this.node(null, initial, label), c = this.wrap(n), place = this.made++;
    this.order.set(n, place);
    this.onCell?.(c, place);
    return c;
  }

  // Solid's createMemo, lazy: nothing runs until the first read.
  formula(compute: () => Value, label = "formula"): Value {
    return this.wrap(this.node(compute, undefined, label));
  }

  read(c: Value, at?: Step[]): Value {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
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
    if (this.same(n.value as Value, v)) return;
    if (this.journal) { const was = n.value as Value; this.journal.undo.push(() => this.write(c, was)); }
    n.value = v;
    if (this.onWrite) this.onWrite(this.order.get(n)!, v);
    // A change at a place wakes the readers of that place, of a place
    // inside it and of one around it; the rest read elsewhere (L98).
    const key = at && keyOf(at);
    for (const o of n.observers) {
      if (o.edits !== undefined) o.edits = what && o.edits ? [...o.edits, what] : null;
      const ps = key === undefined ? undefined : o.paths?.get(n);
      if (!ps || ps.some((p) => p.startsWith(key!) || key!.startsWith(p))) this.mark(o, DIRTY);
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
    const old = n.value as Value, next = changeAt(old, at, change, lists);
    if (next !== old) this.write(c, next, at, what);
  }

  // What's at a place in a cell's value, read as a reader of that place
  // only; undefined when there's no such item.
  readAt(c: Value, at: Step[], lists: Lists): Value | undefined {
    return partAt(this.read(c, at), at, lists);
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
  each(items: Value, f: (item: Value) => Value, list: { from: (v: Value) => Value[]; to: (xs: Value[]) => Value }, label = "each"): Value {
    type Row = { item: Value; value: Value; root: CellNode };
    let rows: Row[] = [];
    const row = (item: Value, made: CellNode[]): Row => {
      const root: CellNode = { value: undefined, state: CLEAN, compute: null, sources: [], observers: new Set(), watcher: false, owned: [], label: `${label} row`, runs: 0, disposed: false };
      made.push(root);
      const [current, owner] = [this.current, this.owner];
      this.current = null;
      this.owner = root;
      let value: Value;
      try { value = f(item); } finally { this.current = current; this.owner = owner; }
      if (typeof value === "object" && value !== null) KEPT.set(value, root);
      this.rowsMade++;
      return { item, value, root };
    };
    // Driven by the edits (L99): when everything since the last run was an
    // edit of the list itself or of one item, each follows them, one row
    // made, moved or disposed per edit, and nothing is matched. Otherwise
    // (the first run, a whole write) items are matched by equality, as
    // Solid's mapArray does.
    const follow = (edits: Edit[], xs: Value[], made: CellNode[]): { rows: Row[]; gone: Row[] } | null => {
      const next = [...rows], gone: Row[] = [];
      for (const e of edits) {
        if (e.at.length === 0 && e.kind === "insert") next.splice(Math.min(e.i, next.length), 0, null as unknown as Row);
        else if (e.at.length === 0 && e.kind === "remove") gone.push(...next.splice(e.i, 1).filter(Boolean));
        else if (e.at.length === 0 && e.kind === "move") next.splice(e.to, 0, next.splice(e.from, 1)[0]);
        else if (e.at.length > 0 && "item" in e.at[0]) { const i = e.at[0].item; if (next[i]) gone.push(next[i]); next[i] = null as unknown as Row; }
        else return null;
      }
      if (next.length !== xs.length) return null;
      return { rows: next.map((r, i) => r ?? row(xs[i], made)), gone };
    };
    const cell = this.node(() => {
      const old = [...rows], made: CellNode[] = [];
      const edits = cell.edits;
      cell.edits = [];
      let gone: Row[];
      try {
        const xs = list.from(this.read(items));
        const followed = edits && edits.length && rows.length ? follow(edits, xs, made) : null;
        if (followed) { rows = followed.rows; gone = followed.gone; }
        else {
          rows = xs.map((item) => {
            const i = old.findIndex((r) => this.same(r.item, item));
            return i >= 0 ? old.splice(i, 1)[0] : row(item, made);
          });
          gone = old;
        }
      } catch (e) {
        // Stopped part way (out of steps, waiting): what it made goes, and
        // the rows stay as they were.
        made.forEach((r) => this.dispose(r));
        rows = old;
        cell.edits = null;
        throw e;
      }
      gone.forEach((r) => this.dispose(r.root));
      return list.to(rows.map((r) => r.value));
    }, undefined, label);
    cell.edits = null;
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
