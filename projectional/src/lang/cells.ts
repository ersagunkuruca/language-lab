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
}

// A cell, as a value of the language: a function value (so equality is
// identity, and the checker treats `Cell a` as not plain) that carries its
// node. Calling it is a mistake the checker prevents: cells are read with
// `read`.
export const CELL = Symbol("cell");
export const nodeOf = (v: Value): CellNode | null => (typeof v === "function" ? ((v as unknown as Record<symbol, CellNode>)[CELL] ?? null) : null);

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

export class Cells {
  private current: CellNode | null = null;
  private owner: CellNode | null = null;
  private queue: CellNode[] = [];
  private batching = 0;
  // Every formula and watcher run, for showing what work was done.
  runs = 0;
  onRun: ((node: CellNode) => void) | null = null;
  // How each watcher's update runs, the formulas it checks included: a page
  // gives each one its own step budget (html.ts).
  around: (update: () => void) => void = (update) => update();
  private same: (a: Value, b: Value) => boolean;

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
    return this.wrap(this.node(null, initial, label));
  }

  // Solid's createMemo, lazy: nothing runs until the first read.
  formula(compute: () => Value, label = "formula"): Value {
    return this.wrap(this.node(compute, undefined, label));
  }

  read(c: Value): Value {
    const n = nodeOf(c);
    if (!n) throw new Error("read needs a cell");
    // The reader depends on it even if computing it stops part way, so it
    // runs again when what the formula read changes.
    if (this.current && !this.current.sources.includes(n)) {
      this.current.sources.push(n);
      n.observers.add(this.current);
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

  write(c: Value, v: Value): void {
    const n = nodeOf(c);
    if (!n) throw new Error("write needs a cell");
    if (n.compute) throw new Error("a formula can't be written: write the cells it reads");
    if (this.same(n.value as Value, v)) return;
    n.value = v;
    for (const o of n.observers) this.mark(o, DIRTY);
    if (!this.batching) this.flush();
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

  dispose(n: CellNode): void {
    n.disposed = true;
    for (const s of n.sources) s.observers.delete(n);
    n.sources = [];
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
