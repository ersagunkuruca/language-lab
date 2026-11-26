import { ItemsList } from "./bytes.ts";
import * as T from "./text.ts";
import { CONS, NIL, PAIR_V } from "./std-ids.ts";

// A Map whose Int keys sit at their own slot of an array while they are
// close together (C215, as C58m's direct tables on C; influenced by Lua 5's
// array part for tables, Ierusalimschy, de Figueiredo, Celes): a read is
// one index, not a hash (pond's food, cells 0 to 2303, read 25 times by
// each fish each tick). Compiled JS makes one for each table of Int keys
// (core-js.ts tableSpec). The array starts at a key `b`, so keys a counter
// gives out and that are removed as they go (swarm's motes, C60) slide up
// it: a key past its end moves the live ones to a new array from the least
// of them. A key goes in the array while the live keys and it span at most
// twice the keys there and 64; at the first that doesn't, its entries go to
// a Map (`o`) for good, as on C.
// Its entries are in key order, not the order put: every listing of a
// table sorts them or checks they are sorted (numberKeys).
const HOLE: unique symbol = Symbol("hole");
const UNDEF: unique symbol = Symbol("undefined");
const slot = (k: unknown): k is number => typeof k === "number" && (k | 0) === k && k >= 0;
export class DirectMap {
  // a[i] holds key b + i (C60: a counter's keys, some removed, slide up).
  a: unknown[] = [];
  b = 0;
  n = 0;
  o: Map<unknown, unknown> | null = null;
  constructor(from?: Iterable<[unknown, unknown]>) {
    if (from instanceof DirectMap && !from.o) { this.a = from.a.slice(); this.b = from.b; this.n = from.n; return; }
    if (from) for (const [k, v] of from) this.set(k, v);
  }
  get size(): number { return this.o ? this.o.size : this.n; }
  get(k: unknown): unknown {
    if (this.o) return this.o.get(k);
    if (slot(k)) { const v = this.a[k - this.b]; return v === HOLE || v === UNDEF ? undefined : v; }
    return undefined;
  }
  has(k: unknown): boolean {
    if (this.o) return this.o.has(k);
    if (!slot(k)) return false;
    const v = this.a[k - this.b];
    return v !== undefined && v !== HOLE;
  }
  set(k: unknown, v: unknown): this {
    if (this.o) { this.o.set(k, v); return this; }
    const x = v === undefined ? UNDEF : v;
    if (slot(k)) {
      const i = k - this.b, a = this.a;
      if (i >= 0 && i < a.length) { if (a[i] === HOLE) this.n++; a[i] = x; return this; }
      if (this.place(k)) { this.a[k - this.b] = x; this.n++; return this; }
    }
    // Its entries to a Map, for good.
    const o = new Map<unknown, unknown>();
    this.a.forEach((w, j) => { if (w !== HOLE) o.set(this.b + j, w === UNDEF ? undefined : w); });
    this.a = []; this.n = 0; this.b = 0;
    (this.o = o).set(k, v);
    return this;
  }
  // Room for key k, its live keys moved so the slots run from the least
  // live key (or k) on, with as many again free past them: false when
  // those are over twice the keys there and 64 apart.
  private place(k: number): boolean {
    const a = this.a;
    let f = 0, l = a.length - 1;
    if (this.n === 0) { f = 0; l = -1; } else { while (a[f] === HOLE) f++; while (a[l] === HOLE) l--; }
    const lo = this.n ? Math.min(k, this.b + f) : k, hi = this.n ? Math.max(k, this.b + l) : k;
    const width = hi - lo + 1;
    if (width > 2 * (this.n + 1) + 64) return false;
    // Room on the side k came from: past the end for keys going up, in
    // front for keys going down.
    const front = k < this.b + f && this.n ? width : 0;
    const len = Math.max(16, 2 * width + front);
    const na = new Array(len).fill(HOLE);
    const nb = lo - front;
    for (let j = f; j <= l; j++) na[this.b + j - nb] = a[j];
    this.a = na; this.b = nb;
    return true;
  }
  delete(k: unknown): boolean {
    if (this.o) return this.o.delete(k);
    if (!slot(k)) return false;
    const i = k - this.b;
    if (!(i >= 0 && i < this.a.length) || this.a[i] === HOLE) return false;
    this.a[i] = HOLE;
    this.n--;
    return true;
  }
  *entries(): IterableIterator<[unknown, unknown]> {
    if (this.o) { yield* this.o.entries(); return; }
    const a = this.a;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v !== HOLE) yield [this.b + i, v === UNDEF ? undefined : v]; }
  }
  *keys(): IterableIterator<unknown> { for (const [k] of this.entries()) yield k; }
  *values(): IterableIterator<unknown> { for (const [, v] of this.entries()) yield v; }
  [Symbol.iterator](): IterableIterator<[unknown, unknown]> { return this.entries(); }
  forEach(f: (v: unknown, k: unknown, m: this) => void): void { for (const [k, v] of this.entries()) f(v, k, this); }
}
// An empty direct table, and the value at an Int key of one (core-rt.ts),
// its own function so that its reads meet only DirectMaps.
export const directTable = (): Table => new Table(new DirectMap() as unknown as Map<unknown, unknown>, true);
export const directRead = (t: Table, key: unknown, none: unknown): unknown => { const m = t.m, v = m.get(key); return v === undefined && !m.has(key) ? none : v; };

// A Map whose keys are pairs of Ints and Texts, held by their two parts:
// a Map by the first part of Maps by the second (rota's `(person, day)`
// and `(day, shift)`: a read by the key's spelling was three Map reads,
// two to find the spelling kept by its parts and one by it, a quarter of
// rota's run). Compiled JS makes one for each table of such keys
// (core-js.ts tableSpec), whose reads and puts are given the pair itself,
// not its spelling; each entry keeps its key beside its value (`Keyed`),
// as a spelled one does, so it is listed the same way.
const first = (k: unknown): unknown => (k as { f0?: unknown; fields: unknown[] }).f0 ?? (k as { fields: unknown[] }).fields[0];
const second = (k: unknown): unknown => (k as { f1?: unknown; fields: unknown[] }).f1 ?? (k as { fields: unknown[] }).fields[1];
export class PairMap {
  o = new Map<unknown, Map<unknown, unknown>>();
  size = 0;
  constructor(from?: PairMap) { if (from) { for (const [a, m] of from.o) this.o.set(a, new Map(m)); this.size = from.size; } }
  get(k: unknown): unknown { return this.o.get(first(k))?.get(second(k)); }
  has(k: unknown): boolean { return this.o.get(first(k))?.has(second(k)) ?? false; }
  set(k: unknown, v: unknown): this {
    const a = first(k);
    let m = this.o.get(a);
    if (!m) this.o.set(a, (m = new Map()));
    const b = second(k);
    if (!m.has(b)) this.size++;
    m.set(b, v);
    return this;
  }
  delete(k: unknown): boolean {
    const m = this.o.get(first(k));
    if (!m || !m.delete(second(k))) return false;
    this.size--;
    return true;
  }
  *entries(): IterableIterator<[unknown, unknown]> { for (const m of this.o.values()) for (const v of m.values()) yield [keyOf(undefined, v), v]; }
  [Symbol.iterator](): IterableIterator<[unknown, unknown]> { return this.entries(); }
  *keys(): IterableIterator<unknown> { for (const [k] of this.entries()) yield k; }
  *values(): IterableIterator<unknown> { for (const [, v] of this.entries()) yield v; }
  forEach(f: (v: unknown, k: unknown, m: this) => void): void { for (const [k, v] of this.entries()) f(v, k, this); }
}
// An empty pair table, and its reads, puts and removes (core-rt.ts), given
// the pair as it is.
export const pairTable = (): Table => new Table(new PairMap() as unknown as Map<unknown, unknown>, true);
export const pairRead = (t: Table, key: unknown, none: unknown): unknown => { const m = t.m, v = m.get(key); return v === undefined && !m.has(key) ? none : valueOf(v); };
export const pairPut = (t: Table, key: unknown, v: unknown): Table => change(t, key, true, new Keyed(key, v));
export const pairRemove = (t: Table, key: unknown): Table => change(t, key, false);
export const pairPutOwned = (t: Table, key: unknown, v: unknown): Table => changeOwned(t, key, true, new Keyed(key, v));
export const pairRemoveOwned = (t: Table, key: unknown): Table => changeOwned(t, key, false);

// A hash table changed in place (C63b, IN-PLACE.md step 2): Map's
// representation, its keys Ints and Texts, the ones a JS Map holds by value
// (an Int has one spelling, int.ts), and tuples of them, held by their
// spelling (C63f). Its entries are in compare's order, so
// its meaning is the Map it stands for.
//
// Every version stays a value (C71): a put writes into the one JS Map and
// gives a new newest version, and the version it was given becomes the
// change that undoes it, pointing at the newest. Reading an older version
// first undoes the changes between, turning the chain round so that one is
// the newest (`reroot`). A map with one holder only ever reads its newest
// version, so each put is constant; a map read again after a change is
// still right, and pays for the changes it walks back over. Prior art:
// Baker's shallow binding for functional arrays ("Shallow binding makes
// functional arrays fast", 1991), as Conchon and Filliâtre's persistent
// arrays ("A persistent union-find data structure", 2007).
// `empty map` is a constant, one value every use shares: the empty table
// it stands for is `shared`, and a put or remove on it makes a new one, so
// maps started from it don't share one chain.
// No `tag`: it isn't a case of a data type, and nothing takes it apart.
export class Table {
  // The newest version holds the JS Map; an older one, the change from the
  // version after it: `key` was absent (had false) or `old`.
  cur: Map<unknown, unknown> | null;
  next: Table | null = null;
  key: unknown = undefined;
  had = false;
  old: unknown = undefined;
  readonly shared: boolean;
  // Its entries (a set's items) in compare's order, once listed: a
  // version's entries never change, so a map read many times (an index's
  // postings) is sorted once (C72).
  listed: unknown = undefined;
  // Its keys in compare's order, once listed, the same way.
  keyed: unknown = undefined;
  constructor(m: Map<unknown, unknown>, shared = false) { this.cur = m; this.shared = shared; }
  get m(): Map<unknown, unknown> { reroot(this); return this.cur!; }
}
// Make t the newest version: undo, from the newest back, each change
// between it and t, each undone one becoming the change that redoes it.
function reroot(t: Table) {
  if (t.cur) return;
  const path: Table[] = [];
  let x = t;
  while (!x.cur) { path.push(x); x = x.next!; }
  for (let i = path.length - 1; i >= 0; i--) {
    const y = path[i], m = x.cur!;
    const had = m.has(y.key), old = m.get(y.key);
    if (y.had) m.set(y.key, y.old); else m.delete(y.key);
    y.cur = m; y.next = null;
    x.cur = null; x.next = y; x.key = y.key; x.had = had; x.old = old;
    x = y;
  }
}
// A put (set) or remove: a new newest version, t the change back to it.
export function change(t: Table, key: unknown, set: boolean, v?: unknown): Table {
  if (t.shared) { const m = t.m instanceof DirectMap ? new DirectMap(t.m) as unknown as Map<unknown, unknown> : t.m instanceof PairMap ? new PairMap(t.m) as unknown as Map<unknown, unknown> : new Map(t.m); if (set) m.set(key, v); else m.delete(key); return new Table(m); }
  const m = t.m, had = m.has(key), old = m.get(key);
  if (!set && !had) return t;
  if (set) m.set(key, v); else m.delete(key);
  const n = new Table(m);
  t.cur = null; t.next = n; t.key = key; t.had = had; t.old = old;
  return n;
}
// The same where every table of the program has one holder
// (owned-tables.ts, compiler): nobody reads the version given again, so
// the change is written into it and it is given back, with no version
// made for the old one. The empty table every map starts from is shared,
// and an older version can't be one here but is still kept right.
export function changeOwned(t: Table, key: unknown, set: boolean, v?: unknown): Table {
  if (t.shared || !t.cur) return change(t, key, set, v);
  if (set) t.cur.set(key, v); else if (!t.cur.delete(key)) return t;
  t.listed = t.keyed = undefined;
  return t;
}
export const tablePutOwned = (t: Table, key: unknown, v: unknown): Table => { const h = held(key); return changeOwned(t, h, true, h === key ? v : new Keyed(key, v)); };
export const tableRemoveOwned = (t: Table, key: unknown): Table => changeOwned(t, held(key), false);
// compare's order on Ints, Texts and tuples of them (run.ts
// compareValues): a tuple part by part.
export const keyOrder = (a: unknown, b: unknown): number => {
  if (typeof a === "string") return a === b ? 0 : T.less(a, b as string) ? -1 : 1;
  if (typeof a === "object" && a !== null) {
    const x = (a as { fields: unknown[] }).fields, y = (b as { fields: unknown[] }).fields;
    for (let i = 0; i < x.length; i++) { const c = keyOrder(x[i], y[i]); if (c) return c; }
    return 0;
  }
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
};
// A tuple key (C63f) is held by its spelling, one per value: an Int's
// digits (an Int has one spelling, int.ts), a Text quoted, a tuple's parts
// in brackets. The table's keys are all of one type, so a spelling never
// meets a Text it could be mistaken for. Such an entry keeps the key itself
// beside its value (`Keyed`), for the entries; an Int or Text key is held
// as it is.
export class Keyed { key: unknown; value: unknown; constructor(key: unknown, value: unknown) { this.key = key; this.value = value; } }
// A Text is quoted as it is unless it holds a quote, a backslash or a
// control character (then as JSON spells it), and a tuple's parts joined
// as they are spelled, with nothing made for each part (I215: rota's
// `(day, shift)` keys spelled through JSON.stringify, map and join were a
// quarter of its run).
const plain = /^[^"\\\u0000-\u001f]*$/;
const spelling = (x: unknown): string => {
  if (typeof x === "string") return plain.test(x) ? `"${x}"` : JSON.stringify(x);
  if (typeof x !== "object" || x === null) return String(x);
  const fs = (x as { fields: unknown[] }).fields;
  let s = "(";
  for (let i = 0; i < fs.length; i++) s += (i ? "," : "") + spelling(fs[i]);
  return s + ")";
};
// A tuple of Ints and Texts is spelled once (I215 again, C289): its
// spelling is kept by its parts, so a read of a key met before makes no
// text, and gives the same text, whose hash is kept, to the table. rota's
// `(person, day)` and `(day, shift)` reads spelled a fresh text each time,
// a fifth of its run. Thrown away when it grows past `SPELT`.
const SPELT = 1 << 20;
let spelt = new Map<unknown, unknown>(), nSpelt = 0;
const kept = (fs: unknown[]): string | null => {
  let m = spelt;
  for (let i = 0; i < fs.length; i++) {
    const p = fs[i];
    if (typeof p !== "string" && typeof p !== "number") return null;
    let n = m.get(p);
    if (i === fs.length - 1) {
      if (n === undefined) {
        if (++nSpelt > SPELT) { spelt = new Map(); nSpelt = 0; return null; }
        n = spelling({ fields: fs });
        m.set(p, n);
      }
      return n as string;
    }
    if (n === undefined) m.set(p, (n = new Map()));
    m = n as Map<unknown, unknown>;
  }
  return null;
};
export const held = (key: unknown) => {
  if (typeof key !== "object" || key === null) return key;
  const fs = (key as { fields: unknown[] }).fields;
  return (fs.length && kept(fs)) || spelling(key);
};
export const valueOf = (v: unknown) => (v instanceof Keyed ? v.value : v);
// The value at key, or `none` when there is none: no list of answers made
// for each read (compiled JS's `value at`, core-rt.ts).
export const tableRead = (t: Table, key: unknown, none: unknown): unknown => { const h = held(key), v = t.m.get(h); return v === undefined && !t.m.has(h) ? none : valueOf(v); };
export const keyOf = (k: unknown, v: unknown) => (v instanceof Keyed ? v.key : k);
// A table whose keys are all plain numbers (Ints), listed without a
// comparison through keyOrder or a copy per entry: kept in the order they
// were put, which a counter's keys already are, so sorted only when they
// aren't (C58b', examples/swarm: listing its 2,000 keys each tick was a
// third of its run). Null for any other keys.
// The same for the keys alone: Int keys, put in order, as they are, as a
// list over one array (bytes.ts ItemsList), which `array of` reads in place.
// A DirectMap's keys and values, read off its array in order (C215).
function direct(m: Map<unknown, unknown>): { ks: number[]; vs: unknown[] } | null {
  if (!(m instanceof DirectMap) || m.o) return null;
  const ks: number[] = [], vs: unknown[] = [], a = m.a, b = m.b;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v !== HOLE) { ks.push(b + i); vs.push(v === UNDEF ? undefined : v); } }
  return { ks, vs };
}
export function numberKeys(m: Map<unknown, unknown>): object | null {
  if (m instanceof DirectMap && !m.o) {
    const ks: number[] = new Array(m.n), a = m.a, b = m.b;
    for (let i = 0, j = 0; j < ks.length; i++) if (a[i] !== HOLE) ks[j++] = b + i;
    return new ItemsList(ks, 0);
  }
  const ks: number[] = [];
  let sorted = true;
  for (const k of m.keys()) {
    if (typeof k !== "number") return null;
    if (sorted && ks.length && k < ks[ks.length - 1]) sorted = false;
    ks.push(k);
  }
  if (!sorted) ks.sort((a, b) => a - b);
  // A list over the array, its cells made only where it is walked.
  return new ItemsList(ks, 0);
}
export function numberEntries(m: Map<unknown, unknown>): object | null {
  const d = direct(m);
  const ks: number[] = d ? d.ks : [], vs: unknown[] = d ? d.vs : [];
  let sorted = true;
  if (!d) for (const [k, v] of m) {
    if (typeof k !== "number") return null;
    if (sorted && ks.length && k < ks[ks.length - 1]) sorted = false;
    ks.push(k); vs.push(v);
  }
  const at = sorted ? null : ks.map((_, i) => i).sort((a, b) => ks[a] - ks[b]);
  let out: object = { tag: NIL, fields: [] };
  for (let i = ks.length - 1; i >= 0; i--) { const j = at ? at[i] : i; out = { tag: CONS, fields: [{ tag: PAIR_V, fields: [ks[j], vs[j]] }, out] }; }
  return out;
}
