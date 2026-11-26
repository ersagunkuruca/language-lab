// The passes after the scalar lowering taken again for an edit of a
// number (plan doc "Incremental compile after edits", L266af): a lowering
// that differs from the last one these passes ran on only in some
// numbers' values, each in its class (whole or not, its sign, whether 0:
// what literals-again.ts and class-key.ts tell apart), takes their last
// answer with the new numbers put in. The passes never change an
// expression in place, and keep a literal they don't rewrite as the same
// object, so each number of the lowering given is found in their answer
// by identity.
// A pass that decides by a number's value (a step of 1, a range's
// magnitude, a sum that cancels, two calls with the same inputs) says so
// with readValue: a change to one it read runs the passes again; so does
// one whose old value is in a number the passes made (a copy, or one
// worked out), as literals-again.ts has it.
// Kept from the last time they ran, not from the last time they were
// taken again: each later edit is compared with that lowering.
import type { CoreIR, SExpr } from "./scalar.ts";
import { keptMap } from "../../ters/src/kept.ts";

let reading: Set<SExpr> | null = null;
// A pass read e's value (a number's) to decide what it writes.
export const readValue = (e: SExpr): void => { reading?.add(e); };
// Whether reads are being told (a pass may skip working them out).
export const tracking = (): boolean => reading !== null;
// A pass read every number, or numbers of the program's own (linear-calls.ts
// works out matrices from definitions): no edit of a number takes the
// passes again.
let readEvery = false;
export const readAll = (): void => { if (reading) readEvery = true; };
// What run read, told on to the passes around it too.
export function readsIn<T>(run: () => T): { out: T; reads: Set<SExpr> } {
  const outer = reading, mine = new Set<SExpr>();
  reading = mine;
  try { return { out: run(), reads: mine }; } finally { reading = outer; if (outer) for (const r of mine) outer.add(r); }
}
// How many times the passes were taken again (the tests).
export let passesAgainCount = 0;

type Leaf = Extract<SExpr, { k: "num" | "int" }>;
type Kept = { given: CoreIR; types: string; tokens: Map<object, string>; out: CoreIR; reads: Set<SExpr>; made: Set<string> };
const kept = keptMap<string, Kept>();

const isType = (v: object) => "key" in v && !("k" in v);
const isLeaf = (v: object): v is Leaf => "k" in v && ((v as SExpr).k === "num" || (v as SExpr).k === "int") && "v" in v;
const leafText = (e: Leaf) => `${e.k}:${String(e.v)}`;
const classOf = (e: Leaf) => { const x = Number(e.v); return Object.is(x, -0) ? "-0" : `${e.k === "int" || Number.isInteger(x) ? "i" : "f"}${Math.sign(x)}`; };
// Fields compared or copied as they are: the program and its check, which
// the passes read but don't change, and which the lowering given carries.
const OWN = new Set(["code", "info"]);

// Each type of the lowering a token by its place, and the types written
// out with those tokens (the passes mark types, so the text is taken
// before they run).
export function typesOf(ir: CoreIR): { text: string; tokens: Map<object, string> } {
  const tokens = new Map<object, string>();
  const lists: [string, object[]][] = [["r", ir.records], ["d", ir.data], ["a", ir.arrays], ["t", ir.tables], ["f", ir.fns], ["e", ir.escapes]];
  for (const [p, ts] of lists) ts.forEach((t, i) => { if (!tokens.has(t)) tokens.set(t, `${p}${i}`); });
  const parts: string[] = [];
  for (const [, ts] of lists) for (const t of ts) {
    parts.push(JSON.stringify(t, function (k, v) {
      if (typeof v === "bigint") return `${v}n`;
      if (v && typeof v === "object" && k !== "" && isType(v)) return tokens.get(v) ?? `?${(v as { key: string }).key}`;
      return v;
    }));
  }
  return { text: parts.join("\n"), tokens };
}

// a (given now) and b (given last) the same but for some numbers' values,
// each in its class: those numbers, b's to a's; null where they differ.
function sameButNumbers(a: unknown, b: unknown, ta: Map<object, string>, tb: Map<object, string>, pairs: Map<SExpr, Leaf>, seen: Map<object, object>): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return Number.isNaN(a as number) && Number.isNaN(b as number);
  const x = a as object, y = b as object;
  if (seen.get(x) === y) return true;
  if (Array.isArray(x)) {
    if (!Array.isArray(y) || x.length !== y.length) return false;
    seen.set(x, y);
    for (let i = 0; i < x.length; i++) if (!sameButNumbers(x[i], y[i], ta, tb, pairs, seen)) return false;
    return true;
  }
  if (Array.isArray(y)) return false;
  if (ta.has(x) || tb.has(y)) return ta.get(x) !== undefined && ta.get(x) === tb.get(y);
  if (x instanceof Map || x instanceof Set) {
    if (!(y instanceof Map || y instanceof Set) || x.constructor !== y.constructor || x.size !== y.size) return false;
    return sameButNumbers([...x], [...(y as Map<unknown, unknown>)], ta, tb, pairs, seen);
  }
  if (isLeaf(x)) {
    if (!isLeaf(y) || x.k !== y.k) return false;
    if (Object.is(x.v, y.v) && Object.keys(x).length === Object.keys(y).length) return true;
    if (classOf(x) !== classOf(y) || Object.keys(x).length !== 2 || Object.keys(y).length !== 2) return false;
    pairs.set(y, x);
    return true;
  }
  if (isType(x) || isType(y)) return false;
  const kx = Object.keys(x), ky = Object.keys(y);
  if (kx.length !== ky.length) return false;
  seen.set(x, y);
  for (const k of kx) {
    if (OWN.has(k) && x === a) continue;
    if (!(k in y)) return false;
    if (!sameButNumbers((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], ta, tb, pairs, seen)) return false;
  }
  return true;
}
// Every number leaf in the lowering, but its program and check.
const leavesOf = (ir: CoreIR) => { const out = new Set<SExpr>(), seen = new Set<object>(); for (const [k, v] of Object.entries(ir)) if (!OWN.has(k)) leavesIn(v, out, seen); return out; };
const LISTS = ["records", "data", "arrays", "tables", "fns", "shapes", "escapes"] as const;
// A copy the passes may set bodies in and push to.
const fresh = (ir: CoreIR): CoreIR => { const c = { ...ir, funcs: ir.funcs.map((f) => ({ ...f })) } as CoreIR; for (const k of LISTS) (c as unknown as Record<string, unknown>)[k] = [...ir[k]]; return c; };
// Every number leaf in v.
function leavesIn(v: unknown, out: Set<SExpr>, seen = new Set<object>()): Set<SExpr> {
  if (!v || typeof v !== "object" || seen.has(v)) return out;
  seen.add(v);
  if (Array.isArray(v)) { for (const x of v) leavesIn(x, out, seen); return out; }
  if (v instanceof Map || v instanceof Set) { for (const x of v) leavesIn(x, out, seen); return out; }
  if (isType(v)) return out;
  if (isLeaf(v)) { out.add(v); return out; }
  for (const x of Object.values(v)) leavesIn(x, out, seen);
  return out;
}

// v with each leaf `pairs` names put in, copied along the way down to it
// (nothing is changed in place: the answer kept stays as it was).
function patched(v: unknown, pairs: Map<SExpr, Leaf>, memo: Map<object, unknown>): unknown {
  if (!v || typeof v !== "object") return v;
  if (memo.has(v)) return memo.get(v);
  if (isType(v)) return v;
  const leaf = pairs.get(v as SExpr);
  if (leaf) return leaf;
  let out: unknown = v;
  if (Array.isArray(v)) {
    let copy: unknown[] | null = null;
    v.forEach((x, i) => { const y = patched(x, pairs, memo); if (y !== x) (copy ??= [...v])[i] = y; });
    out = copy ?? v;
  } else if (!(v instanceof Map || v instanceof Set)) {
    let copy: Record<string, unknown> | null = null;
    for (const [k, x] of Object.entries(v)) {
      const y = patched(x, pairs, memo);
      if (y !== x) (copy ??= { ...(v as Record<string, unknown>) })[k] = y;
    }
    out = copy ?? v;
  }
  memo.set(v, out);
  return out;
}

// `place`: the passes and what else they read (the roots).
export function passesAgain(place: string, given: CoreIR, run: (ir: CoreIR) => CoreIR): CoreIR {
  const t = typesOf(given);
  const was = kept.get(place);
  if (was && was.types === t.text) {
    const pairs = new Map<SExpr, Leaf>();
    if (sameButNumbers(given, was.given, t.tokens, was.tokens, pairs, new Map()) && [...pairs].every(([old]) => !was.reads.has(old) && !was.made.has(leafText(old as Leaf)))) {
      passesAgainCount++;
      const memo = new Map<object, unknown>();
      const out = { ...was.out, code: given.code, info: given.info } as CoreIR;
      for (const [k, v] of Object.entries(was.out)) if (!OWN.has(k)) (out as unknown as Record<string, unknown>)[k] = patched(v, pairs, memo);
      // A copy, as the passes after these set bodies and push to lists.
      return fresh(out);
    }
  }
  // The lowering given, as these passes are given it: they set functions'
  // bodies and push to its lists, so those are copied first.
  const snapshot = fresh(given);
  const every = readEvery;
  readEvery = false;
  let out: CoreIR, reads: Set<SExpr>, all: boolean;
  try { ({ out, reads } = readsIn(() => run(given))); } finally { all = readEvery; readEvery = every || readEvery; }
  const mine = leavesOf(snapshot), made = new Set<string>();
  for (const l of leavesOf(out)) if (!mine.has(l)) made.add(leafText(l as Leaf));
  if (kept.size >= 8 && !kept.has(place)) kept.clear();
  if (all) { kept.delete(place); return out; }
  kept.set(place, { given: snapshot, types: t.text, tokens: t.tokens, out: fresh(out), reads, made });
  return out;
}
