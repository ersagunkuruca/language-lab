import { madeItem } from "./over.ts";
import type { Id } from "../model.ts";
import { ItemsList } from "./bytes.ts";
import type * as I from "./int.ts";
import { ARRAY_TAG } from "./std-ids.ts";
import { itemsOf } from "./std-values.ts";

// Arrays (BACKLOG C30d, REPRESENTATIONS.md step 5): a list's items side by
// side, so an item is read by its position in constant time. An array is
// a view, a start and a length, on a buffer with free room at both ends,
// so adding an item at either end, and taking the array after the first
// item, are amortised constant, and a view's items are never copied to
// make another view. Adding writes into the free slot just past the
// view's end (or just before its start) when no other view has taken it,
// as the buffer keeps its lowest and highest used slots, and copies the
// view's items into a new buffer otherwise, so every array still never
// changes. The evaluator and compiled JS (compiler/src/runtime.js) share
// these. Ersagun's design, a two-ended array list from one of his Unity C#
// projects; prior art: deques as ring buffers, gap buffers, Go's slices,
// which share their backing array the same way at one end, and arrays as
// a list's representation, as Clojure's vectors and Haskell's Data.Vector
// stand for sequences. `items of array` is the meaning (Array a → List a).
//
// `fields` is the { tag, fields: [n, item₀, …] } value equal, compare and
// show walk, the count first so they tell [1] from [1, 2] and order
// shorter arrays first; it is made once, when first read.
//
// An item replaced (C93c) is written into the buffer too, so a replace is
// constant: the views on the buffer as it was point at a version that
// records the change instead, the slot and what it held, and reading one
// of those first undoes the changes back to it, as a Map's hash table
// does (Table below: Baker's shallow binding, "Shallow binding makes
// functional arrays fast", 1991). A list kept by one holder only reads
// its newest version, so each replace stays constant.
type Buffer = { items: unknown[]; lo: number; hi: number };
// The newest version holds the buffer; an older one, the change from the
// version after it: `slot` held `old`.
// `shared`: another view was made on this version's buffer (a rest, a
// push into its room), so it is never written in place (replaceOwned).
type Version = { cur: Buffer | null; next: Version | null; slot: number; old: unknown; shared?: true };
const versionOf = (b: Buffer): Version => ({ cur: b, next: null, slot: 0, old: undefined });
function rerootArray(t: Version) {
  if (t.cur) return;
  const path: Version[] = [];
  let x = t;
  while (!x.cur) { path.push(x); x = x.next!; }
  for (let i = path.length - 1; i >= 0; i--) {
    const y = path[i], b = x.cur!, was = b.items[y.slot];
    b.items[y.slot] = y.old;
    y.cur = b; y.next = null;
    x.cur = null; x.next = y; x.slot = y.slot; x.old = was;
    x = y;
  }
}
export class ArrayView {
  // Fields set in the constructor only, in one order, and the tag on the
  // prototype, as the core IR's own records are (C93: a replace makes a
  // view, so its shape is on machine's every step).
  declare readonly tag: typeof ARRAY_TAG;
  declare readonly ver: Version;
  declare readonly start: number;
  declare readonly n: number;
  declare private f: unknown[] | null;
  // Its rest, when that was copied out of a much bigger buffer (I106c).
  declare rest: ArrayView | null;
  constructor(ver: Version, start: number, n: number) { this.ver = ver; this.start = start; this.n = n; this.f = null; this.rest = null; }
  // The buffer as this view's version has it.
  get buf(): Buffer { if (!this.ver.cur) rerootArray(this.ver); return this.ver.cur!; }
  get fields(): unknown[] { return (this.f ??= [this.n, ...this.buf.items.slice(this.start, this.start + this.n)]); }
  toJSON() { return { tag: this.tag, fields: this.fields }; }
}
(ArrayView.prototype as { tag: string }).tag = ARRAY_TAG;
export type ArrayValue = ArrayView | { tag: Id; fields: unknown[] };
// A buffer holding xs[from, to) in its middle, with room for as many
// again on each side. The room holds 0, not undefined: V8 keeps a JS
// array of numbers unboxed, a Float64 a slot, only while it holds nothing
// else, and one undefined made every Float64 written into it a number
// object of its own (C303: mnist's Adam pass over 10,000 digits 5.1 s,
// 3.4 s with 0, a tenth of it the collector's). Arrays of other values
// read only their own slots, so they don't tell.
export const arrayOf = (xs: unknown[], from = 0, to = xs.length): ArrayView => {
  const n = to - from, room = Math.max(4, n), items = new Array(n + 2 * room).fill(0);
  for (let i = 0; i < n; i++) items[room + i] = xs[from + i];
  return new ArrayView(versionOf({ items, lo: room, hi: room + n }), room, n);
};
// An array made of a list (`array of`): a byte a slot (a Uint8Array, with
// no room at its ends) while every item is an Int from 0 to 255, as the
// byte array bytes-array.ts picks is (L189f1); otherwise as arrayOf. A
// push or an item that isn't a byte copies or widens it (pushBack,
// replaceIn), so it is the same array either way.
const isByte = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255 && !Object.is(x, -0);
const byteArray = (b: Uint8Array): ArrayView => new ArrayView(versionOf({ items: b as unknown as unknown[], lo: 0, hi: b.length }), 0, b.length);
export const arrayOfItems = (l: { tag: Id; fields: unknown[] }): ArrayView => {
  if (l instanceof ItemsList && l.b instanceof Uint8Array) return byteArray(l.b.slice(l.i));
  // A list over a whole JS array (a table's keys) is read in place.
  const xs = l instanceof ItemsList && l.i === 0 && Array.isArray(l.b) ? l.b : itemsOf(l);
  return xs.length >= 16 && xs.every(isByte) ? byteArray(Uint8Array.from(xs as number[])) : arrayOf(xs);
};
// `array of range(n)`, filled with no list made (the core IR's
// JavaScript, range-choices.ts rangeArrays, C228): what arrayOfItems
// makes of that list, a byte a slot from 16 to 256 items.
export const rangeArray = (n: number): ArrayView => {
  const k = Math.max(0, n);
  if (k >= 16 && k <= 256) { const b = new Uint8Array(k); for (let i = 0; i < k; i++) b[i] = i; return byteArray(b); }
  // No room at its ends: a push copies it, as onto a byte array.
  const xs = new Array<number>(k);
  for (let i = 0; i < k; i++) { madeItem(i); xs[i] = i; }
  return new ArrayView(versionOf({ items: xs, lo: 0, hi: k }), 0, k);
};
// Either kind of array value: a view, or { tag, fields } made elsewhere
// (a value read back from JSON).
export const arrayView = (a: ArrayValue): ArrayView => (a instanceof ArrayView ? a : arrayOf(a.fields, 1));
export const pushBack = (a: ArrayValue, x: unknown): ArrayView => {
  const v = arrayView(a), b = v.buf, end = v.start + v.n;
  if (end === b.hi && end < b.items.length) { b.items[end] = x; b.hi++; v.ver.shared = true; return new ArrayView(v.ver, v.start, v.n + 1); }
  const w = arrayOf(b.items, v.start, end);
  w.buf.items[w.start + w.n] = x; w.buf.hi++;
  return new ArrayView(w.ver, w.start, w.n + 1);
};
export const pushFront = (a: ArrayValue, x: unknown): ArrayView => {
  const v = arrayView(a), b = v.buf;
  if (v.start === b.lo && v.start > 0) { b.items[v.start - 1] = x; b.lo--; v.ver.shared = true; return new ArrayView(v.ver, v.start - 1, v.n + 1); }
  // Copied with its room in front, where the pushes are going: twice as
  // many again, and 16 from empty, so an array built item by item from
  // the back (a block of samples) is copied a few times, not at 4, 8, 16….
  const n = v.n, room = Math.max(16, 2 * n), items = new Array(room + n + 4).fill(0);
  for (let i = 0; i < n; i++) items[room + i] = b.items[v.start + i];
  items[room - 1] = x;
  return new ArrayView(versionOf({ items, lo: room - 1, hi: room + n }), room - 1, n + 1);
};
// pushFront on a view nobody else holds (C196, compiler/src/
// owned-pushes.ts): its start moved back into the free slot in front, no
// new view made. The plain push where it is empty (the empty array is
// shared) or has no room there.
export const pushFrontOwned = (a: ArrayValue, x: unknown): ArrayView => {
  if (!(a instanceof ArrayView) || a.n === 0 || a.rest) return pushFront(a, x);
  const b = a.ver.cur;
  if (!b || a.start !== b.lo || a.start === 0) return pushFront(a, x);
  b.items[a.start - 1] = x; b.lo--;
  const v = a as unknown as { start: number; n: number; f: unknown };
  v.start--; v.n++; v.f = null;
  return a;
};
// A push to the back of a view nobody else holds (C327f, compiler/src/
// holders.ts): written into the room after it as `push` does, but the
// view given isn't marked as sharing its buffer, since nothing reads it
// again; a later owned replace then writes in place, not a version. The
// view itself grows, as pushFrontOwned's does, no new view a push (L271c:
// a fill pushing each item made one each); an empty one may be shared,
// so it gets a view of its own. Full, it moves to a buffer twice as long
// with all its room after it, since what's pushed at the back stays so.
export const pushOwned = (a: ArrayValue, x: unknown): ArrayView => {
  if (!(a instanceof ArrayView) || a.rest || !a.ver.cur) return pushBack(a, x);
  const b = a.ver.cur, end = a.start + a.n;
  if (end !== b.hi) return pushBack(a, x);
  if (end >= b.items.length) {
    const n = a.n, items = new Array(2 * n + 8).fill(0);
    for (let i = 0; i < n; i++) items[i] = b.items[a.start + i];
    items[n] = x;
    return new ArrayView(versionOf({ items, lo: 0, hi: n + 1 }), 0, n + 1);
  }
  b.items[end] = x; b.hi++;
  if (a.n === 0) return new ArrayView(a.ver, a.start, 1);
  const v = a as unknown as { n: number; f: unknown };
  v.n++; v.f = null;
  return a;
};
// A rest is a view on the same buffer, so a list taken apart item by item
// would keep its whole first buffer however little is left (Go's slices
// leak so, I106c). Where what's left is under a quarter of a big buffer,
// the rest is copied into one of its own instead: n items copied once
// after at least 3n rests, so still constant per rest, and kept on the
// view, so matching the same view again copies nothing.
export const restOf = (a: ArrayValue): ArrayView => {
  const v = arrayView(a);
  if (v.n === 0) return v;
  if (v.rest) return v.rest;
  const size = v.ver.cur ? v.ver.cur.items.length : v.buf.items.length;
  if (size > 256 && (v.n - 1) * 4 < size) return (v.rest = arrayOf(v.buf.items, v.start + 1, v.start + v.n));
  v.ver.shared = true;
  return new ArrayView(v.ver, v.start + 1, v.n - 1);
};
// `count` items from position `from`, each clamped to the array, as a
// view on the same buffer (C221): `drop` and `take` of a list stored as
// an array, in one step where the list's walk `from` items. A few items
// (under 64) of a big buffer are copied out, so a window doesn't keep a
// whole track alive (as a rest, I106c); more stay a view, since copying
// them would make a drop as long as the list (trek's windows, C221).
export const sliceOf = (a: ArrayValue, from: I.Int, count: I.Int): ArrayView => {
  const v = arrayView(a), n = v.n;
  const f = Math.max(0, Math.min(n, Number(from))), c = Math.max(0, Math.min(n - f, Number(count)));
  if (f === 0 && c === n) return v;
  const size = v.ver.cur ? v.ver.cur.items.length : v.buf.items.length;
  if (size > 256 && c < 64) return arrayOf(v.buf.items, v.start + f, v.start + f + c);
  v.ver.shared = true;
  return new ArrayView(v.ver, v.start + f, c);
};
// The item at position i replaced by x (C93c), or the array as it is
// outside it, as `replace at` on a list: written into the buffer, and the
// version given becomes the change back.
export const replaceIn = (a: ArrayValue, i: I.Int, x: unknown): ArrayView => {
  const v = a instanceof ArrayView ? a : arrayView(a), k = typeof i === "number" ? i : Number(i);
  if (!(k >= 0 && k < v.n && Math.floor(k) === k)) return v;
  const t = v.ver;
  if (!t.cur) rerootArray(t);
  const b = t.cur!, slot = v.start + k, items = b.items;
  // Views on the older version may reroot through this one.
  const newest: Version = t.shared ? { cur: b, next: null, slot: 0, old: undefined, shared: true } : { cur: b, next: null, slot: 0, old: undefined };
  t.cur = null; t.next = newest; t.slot = slot; t.old = items[slot];
  if (items instanceof Uint8Array && !isByte(x)) b.items = Array.from(items);
  b.items[slot] = x;
  return new ArrayView(newest, v.start, v.n);
};
// replaceIn where nobody else holds the array (C93 s4): one-holder.ts found
// every array of its item type has one holder, so the view given is read
// no more and its slot is written in place; unless another view shares the
// buffer (a rest, a push into its room), when it is replaceIn.
//
// A view whose version is no longer the newest, since a view of an older
// one was read since (a map written into the array it reads: strings'
// inverse fft on a spectrum another view shares, C278), is copied out
// into a buffer of its own first, n once: as replaceIn, each read of the
// older view would undo every change since, n a read.
export const replaceOwned = (a: ArrayValue, i: I.Int, x: unknown): ArrayView => {
  let v = a instanceof ArrayView ? a : arrayView(a), t = v.ver;
  const k = typeof i === "number" ? i : Number(i);
  if (!(k >= 0 && k < v.n && Math.floor(k) === k)) return v;
  if (!t.cur && !v.rest) { v = arrayOf(v.buf.items, v.start, v.start + v.n); t = v.ver; }
  if (t.shared || !t.cur || v.rest) return replaceIn(v, i, x);
  const b = t.cur;
  if (b.items instanceof Uint8Array && !isByte(x)) b.items = Array.from(b.items);
  b.items[v.start + k] = x;
  return v;
};
export const itemsIn = (a: ArrayValue): unknown[] => { const v = arrayView(a); return v.buf.items.slice(v.start, v.start + v.n); };
// An empty array with room behind for n pushes (C303): what fill-arrays.ts's
// `filled` starts from in the core IR's JavaScript, where n is known, so
// filling it item by item copies nothing; from the shared empty array an
// array of 25,000 items was copied twelve times, a fifth of mnist's Adam
// pass. Room for a million at most: past that the pushes copy as usual.
export const emptyFor = (n: number): ArrayView => {
  const k = Math.min(Math.max(4, Number(n) || 0), 1 << 20);
  return new ArrayView(versionOf({ items: new Array(4 + k).fill(0), lo: 4, hi: 4 }), 4, 0);
};
