// The library's host ways for its pure definitions (L206): native code
// that computes exactly what a definition says, operation for operation in
// the same order, so its answers are the same bits. The definition stays
// the meaning, and anything the host way doesn't take (a part that isn't
// a Float64) runs the definition itself. Each is declared here by the
// definition's name, beside the library's other host code (collation.ts,
// graphemes.ts); library.ts finds the definition, and test/jets.test.ts
// checks each against it. A changed definition keeps its host way only
// while that test passes.
//
// Prior art: Urbit's jets (native code standing in for Nock formulas,
// checked against them); Unison's builtins; Gleam's `@external` beside a
// definition. CREDITS.md.

import type { PureHost } from "../src/lang/hosts.ts";
import type { Value } from "../src/lang/run.ts";
import { CONS, FALSE, NIL, PAIR_V, TRUE } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

type Data = { tag: Id; fields: Value[] };
const nums = (v: Value): number[] | null => {
  const f = (v as Data)?.fields;
  if (!Array.isArray(f)) return null;
  for (let i = 0; i < f.length; i++) if (typeof f[i] !== "number") return null;
  return f as number[];
};

// `table product` (ALGEBRA-TABLES.md): a fold over the
// table's lines, each line `times(e, f, g)` adding (a along e)·(b along f)
// times g to the rest's sum, where x along e is x and e multiplied part by
// part and added left to right. The fold builds the sum from the last line
// back, starting from a's shape with every part 0.
// A table read once: values don't change, so each line's e, f and g are
// checked and kept by the table's identity.
// Each line's e and f are kept as an index into the table's distinct ones
// (a 16-part algebra's 256 lines have 16 of each), so each x along e is
// worked out once a product; and g's parts that aren't 0, since adding
// w · 0 to the sum leaves it as it is while w is finite (the sum starts at
// +0 and is never -0). The parts are summed in place, in the same order.
type Line = { e: number; f: number; g: Data; gs: number[]; nz: number[] };
type Lines = { lines: Line[]; es: number[][]; fs: number[][] };
const tables = new WeakMap<object, Lines | null>();
function linesOf(table: Value): Lines | null {
  if (typeof table !== "object" || table === null) return null;
  const kept = tables.get(table);
  if (kept !== undefined) return kept;
  const es: number[][] = [], fs: number[][] = [], ek = new Map<string, number>(), fk = new Map<string, number>();
  const at = (v: number[], all: number[][], keys: Map<string, number>) => {
    const k = v.map((x) => (Object.is(x, -0) ? "-0" : String(x))).join(",");
    let i = keys.get(k);
    if (i === undefined) { i = all.length; all.push(v); keys.set(k, i); }
    return i;
  };
  let lines: Line[] | null = [];
  let d = table as Data;
  for (; d?.tag === CONS; d = d.fields[1] as Data) {
    const [e, f, g] = (d.fields[0] as Data).fields;
    const ev = nums(e), fv = nums(f), gv = nums(g);
    if (!ev || !fv || !gv) { lines = null; break; }
    lines.push({ e: at(ev, es, ek), f: at(fv, fs, fk), g: g as Data, gs: gv, nz: gv.flatMap((x, i) => (x === 0 ? [] : [i])) });
  }
  if (lines && d?.tag !== NIL) lines = null;
  const out = lines && { lines, es, fs };
  tables.set(table, out);
  return out;
}
function tableProduct(table: Value, a: Value, b: Value): Value | null {
  const av = nums(a), bv = nums(b);
  const t = av && bv ? linesOf(table) : null;
  if (!av || !bv || !t) return null;
  const along = (x: number[], e: number[]) => { let s = x[0] * e[0]; for (let i = 1; i < x.length; i++) s = s + x[i] * e[i]; return s; };
  if (t.es.some((e) => e.length !== av.length) || t.fs.some((f) => f.length !== bv.length)) return null;
  const ae = t.es.map((e) => along(av, e)), bf = t.fs.map((f) => along(bv, f));
  const { lines } = t;
  const acc = av.map(() => 0);
  let shape: Data = { tag: (a as Data).tag, fields: acc };
  for (let l = lines.length - 1; l >= 0; l--) {
    const { e, f, g, gs, nz } = lines[l];
    const w = ae[e] * bf[f];
    if (acc.length !== gs.length) return null;
    if (Number.isFinite(w)) for (const i of nz) acc[i] = w * gs[i] + acc[i];
    else for (let i = 0; i < gs.length; i++) acc[i] = w * gs[i] + acc[i];
    shape = g;
  }
  return { ...shape, fields: acc };
}

// By the definition's name in the library.
// The map and set helpers' walk down a sorted list of (key, value), where
// every key is a finite number or a tuple of them: compared as compare
// compares them (run.ts compareValues: numbers exactly, a tuple part by
// part), so the same answers in a loop of JavaScript (I195: agent's search
// keeps the cells it reached in a map, its queue by (cost, order)). Any
// other key: as written.
const order = (a: Value | undefined, b: Value | undefined): number | null => {
  if (typeof a === "number" && typeof b === "number") return a - a !== 0 || b - b !== 0 ? null : a < b ? -1 : a > b ? 1 : 0;
  const x = a as Data, y = b as Data;
  if (x?.tag !== PAIR_V || y?.tag !== PAIR_V) return null;
  for (let i = 0; i < 2; i++) { const c = order(x.fields[i], y.fields[i]); if (c !== 0) return c; }
  return 0;
};
const keyOf = (item: Value): Value | undefined => ((item as Data)?.tag === PAIR_V ? (item as Data).fields[0] : undefined);
function putEntry(list: Value, key: Value, value: Value): Value | null {
  const before: Value[] = [];
  let d = list as Data, c: number | null = 1;
  for (; d?.tag === CONS; d = d.fields[1] as Data) {
    c = order(key, keyOf(d.fields[0]));
    if (c === null) return null;
    if (c <= 0) break;
    before.push(d.fields[0]);
  }
  if (d?.tag !== CONS && d?.tag !== NIL) return null;
  if (d.tag === NIL && order(key, key) === null) return null;
  const entry: Data = { tag: PAIR_V, fields: [key, value] };
  let out: Data = { tag: CONS, fields: [entry, d.tag === CONS && c === 0 ? d.fields[1] : d] };
  for (let i = before.length - 1; i >= 0; i--) out = { tag: CONS, fields: [before[i], out] };
  return out;
}
function entriesHave(list: Value, key: Value): boolean | null {
  for (let d = list as Data; ; d = d.fields[1] as Data) {
    if (d?.tag === NIL) return false;
    if (d?.tag !== CONS) return null;
    const c = order(key, keyOf(d.fields[0]));
    if (c === null) return null;
    if (c < 0) return false;
    if (c === 0) return true;
  }
}
// A list's item at a position, as written: down the list.
function itemAt(list: Value, position: Value, otherwise: Value): Value | null {
  if (typeof position !== "number") return null;
  let d = list as Data;
  for (let i = position; d?.tag === CONS; d = d.fields[1] as Data, i--) if (i < 1) return i < 0 ? otherwise : d.fields[0];
  return d?.tag === NIL ? otherwise : null;
}

export const LIBRARY_HOSTS: Record<string, PureHost> = {
  "item at": (self) => (list, position, otherwise) => {
    const v = itemAt(list, position, otherwise);
    return v === null ? self(list, position, otherwise) : [v];
  },
  "put entry": (self) => (list, key, value) => {
    const v = putEntry(list, key, value);
    return v === null ? self(list, key, value) : [v];
  },
  "entries have": (self) => (list, key) => {
    const v = entriesHave(list, key);
    return v === null ? self(list, key) : [{ tag: v ? TRUE : FALSE, fields: [] }];
  },
  "table product": (self) => (table, a, b) => {
    const v = tableProduct(table, a, b);
    return v === null ? self(table, a, b) : [v];
  },
};
