// The runtime of JavaScript printed from the core IR (C137c, core-js.ts
// prints it): what a printed program calls as R, apart from the printer,
// so a page or module carries only this (C149). A builtin's runtime
// function is named with the builtin's id where it has one (the printer
// reads scalar.ts's tables), so nothing here needs the compiler.

import { CONS, FALSE, HASH_SET_OPS, NIL, NONE, S, SOME, STD_IMPL, STD_MANY, TABLE_OPS, TRUE } from "../../ters/src/lang/std.ts";
import { META, cellOps, equal, solveAnswers, toList, type Runtime, type Value, type World } from "../../ters/src/lang/run.ts";
import { Cells, NoValue } from "../../ters/src/lang/cells.ts";
import { NoAnswer } from "../../ters/src/lang/html.ts";
import { satisfiable } from "../../ters/src/lang/relate.ts";
import { givenInOrder } from "../../ters/src/lang/ports.ts";
import { worldRandom } from "../../ters/src/lang/random.ts";
import * as I from "../../ters/src/lang/int.ts";
import * as T from "../../ters/src/lang/text.ts";
import { useTarget, type Code, type Id, type Use } from "../../ters/src/model.ts";
import { STOPS } from "./stops.ts";

export class Unsupported extends Error {}
export class Stopped extends Error {}
export class Aborted { reason: unknown; esc: number; constructor(reason: unknown, esc: number) { this.reason = reason; this.esc = esc; } }
export const FAIL = { fail: true }, OUT = { out: true };

const big = (x: I.Int) => BigInt(x);
// UTF-8 as a browser has it too (a page's script, C137c9).
const UTF8 = new TextEncoder();
const OWN: Record<string, (...xs: never[]) => unknown> = {
  "int.equal": (a: I.Int, b: I.Int) => a === b,
  "int.less": (a: I.Int, b: I.Int) => a < b,
  "text.equal": (a: string, b: string) => a === b,
  "text.less": (a: string, b: string) => T.less(a, b),
  "text.quoted": (t: string) => JSON.stringify(t),
  "int.exact": (a: I.Int, b: I.Int) => I.norm(big(a) / big(b)),
  "int.gcd": (a: I.Int, b: I.Int) => { let x = big(a) < 0n ? -big(a) : big(a), y = big(b) < 0n ? -big(b) : big(b); while (y) [x, y] = [y, x % y]; return I.norm(x); },
  // run.ts's, which the evaluator has outside std.ts.
  "number.range": (n: number) => toList(Array.from({ length: Math.max(0, n) }, (_, i) => i)),
  "text.size": (t: string) => UTF8.encode(t).length,
  "text.bytes": (t: string, a: number, b: number) => new TextDecoder().decode(UTF8.encode(t).subarray(a, b)),
  // Where the character that ends at byte i (> 0) starts.
  "text.before": (t: string, i: number) => { const b = UTF8.encode(t); do i--; while (i > 0 && (b[i] & 0xc0) === 0x80); return i; },
};
// A Table or Hash set (C63h, C63i) is the evaluator's (std.ts Table: a
// Map with Baker's versions), a record key given as the evaluator's
// record and taken back from its entries.
const TABLE = /^table\.(\w+)\.t(\d+)(?:\.e\d+)?$/;
// What the runtime needs of the program's tables, as plain data a module
// can carry: whether each is a Hash set.
export interface TableSpec { set: boolean }
function tableFn(op: string, t: TableSpec): (...xs: unknown[]) => unknown {
  const bool = (v: unknown) => (v as { tag: Id }).tag === TRUE;
  const impl = (id: Id) => STD_IMPL[id] as (...xs: unknown[]) => unknown;
  switch (op) {
    case "empty": return () => impl(TABLE_OPS.empty)();
    case "put": return (m, k, v) => impl(TABLE_OPS.put)(m, k, v);
    case "remove": return (m, k) => impl(TABLE_OPS.remove)(m, k);
    case "has": return (m, k) => bool(impl(TABLE_OPS.has)(m, k));
    case "size": return (m) => impl(TABLE_OPS.size)(m);
    case "at": return (m, k) => { const r = STD_MANY[TABLE_OPS.at](m, k); if (!r.length) throw FAIL; return r[0]; };
    case "entries": return t.set ? (m) => impl(HASH_SET_OPS.items)(m) : (m) => impl(TABLE_OPS.entries)(m);
  }
  return () => { throw new Unsupported(`table.${op}`); };
}
// Random under seeded (C106): random.ts's xoshiro128** seeded by
// SplitMix32, its four words in r, as WebAssembly's globals $r0 to $r3.
function randFns(r: Uint32Array): Record<string, (...xs: never[]) => unknown> {
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const mix = (z: number) => { let x = z; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
  const word = () => {
    const [a, b] = [r[0], r[1]], out = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0, t = b << 9;
    r[2] ^= a; r[3] ^= b; r[1] ^= r[2]; r[0] ^= r[3]; r[2] ^= t; r[3] = rotl(r[3], 11);
    return out;
  };
  return {
    "rand.seed": (seed: number) => { let z = Math.floor(seed) >>> 0; for (let i = 0; i < 4; i++) { z = (z + 0x9e3779b9) >>> 0; r[i] = mix(z); } return 0; },
    "rand.next": () => ((word() >>> 5) * 67108864 + (word() >>> 6)) / 9007199254740992,
    "rand.s0": () => r[0], "rand.s1": () => r[1], "rand.s2": () => r[2], "rand.s3": () => r[3],
    "rand.unset": () => !(r[0] | r[1] | r[2] | r[3]),
    "rand.restore": (a: number, b: number, c: number, d: number) => { r.set([a, b, c, d]); return 0; },
  };
}
// `builtin`: the evaluator's builtin it is, and whether it gives a Bool,
// as the printer read them (core-js.ts builtinOf).
export type BuiltinOf = [Id, boolean];
function rtFn(name: string, builtin?: BuiltinOf, tables?: TableSpec[], rand?: Record<string, (...xs: never[]) => unknown>, cells?: Record<Id, (...xs: Value[]) => Value | undefined>, code?: Code, spend?: () => boolean): (...xs: unknown[]) => unknown {
  if (name.startsWith("host:")) return hostFn(name, cells);
  if (name.startsWith("solve:")) return solveFn(name.slice(6), code, false, spend);
  if (name.startsWith("solveAll:")) return solveFn(name.slice(9), code, true, spend);
  if (name === "exists") return (f) => { if (!code) throw new Unsupported("for some without the program"); return satisfiable(code, f); };
  if (name.startsWith("pick:")) { const [, j, bool] = name.split(":"); return (xs) => { const v = (xs as Value[])[Number(j)]; return bool ? (v as unknown) === true || (v as { tag?: Id }).tag === TRUE : v; }; }
  const tm = TABLE.exec(name);
  if (tm && tables) return tableFn(tm[1], tables[Number(tm[2])]);
  if (rand?.[name]) return rand[name] as (...xs: unknown[]) => unknown;
  const base = name.replace(/\.a\d+$/, "");
  if (OWN[base]) return OWN[base] as (...xs: unknown[]) => unknown;
  const id = builtin?.[0];
  const one = id ? STD_IMPL[id] : undefined, many = id ? STD_MANY[id] : undefined;
  if (!one && !many) return () => { throw new Unsupported(name); };
  const out = builtin![1] ? (v: unknown) => (typeof v === "object" && v !== null && "tag" in v ? (v as { tag: Id }).tag === TRUE : v) : (v: unknown) => v;
  // array.get's place is an i32; array.at's an Int.
  const conv = base === "array.get" ? (xs: unknown[]) => [xs[0], I.norm(BigInt(xs[1] as number))] : (xs: unknown[]) => xs;
  if (one) return (...xs) => out(one(...conv(xs)));
  return (...xs) => { const r = many!(...conv(xs)); if (!r.length) throw FAIL; return out(r[0]); };
}

// A builtin the core IR has no lowering for (C137c7, scalar.ts host):
// the evaluator's own, by its id, a Bool given turned to the evaluator's
// and one given back (`:bool`) turned back; no answer is FAIL.
function hostFn(name: string, cells?: Record<Id, (...xs: Value[]) => Value | undefined>): (...xs: unknown[]) => unknown {
  const [, id, bool] = name.split(":");
  const out = bool ? (v: unknown) => v === true || (v as { tag?: Id }).tag === TRUE : (v: unknown) => v;
  const cell = cells?.[id];
  if (cell) return (...xs) => { const v = cell(...(xs.map(inn) as Value[])); if (v === undefined) throw FAIL; return out(v); };
  const one = STD_IMPL[id], many = STD_MANY[id];
  if (one) return (...xs) => out(one(...xs.map(inn)));
  if (many) return (...xs) => { const r = many(...xs.map(inn)); if (!r.length) throw FAIL; return out(r[0]); };
  return () => { throw new Unsupported(name); };
}
// A relation run some way with one answer (C137c11, scalar.ts solveUse):
// the evaluator's solve on the program's code, its first answer's values.
// `spend`: one step of the printed program's budget, as the evaluator's
// solve spends its innermost fuel; false ends the search there.
function solveFn(id: Id, code?: Code, all = false, spend?: () => boolean): (...xs: unknown[]) => unknown {
  if (!code) return () => { throw new Unsupported(`solve ${id} without the program`); };
  const n = code.nodes[id] as Use, keys = givenInOrder(code, n);
  const answers = (xs: unknown[]) => solveAnswers(code, n, Object.fromEntries(keys.map((k, i) => [k, inn(xs[i])])), { spend });
  // Every answer, a List of them (`solveAll`) made as it is read: a
  // periodic solution (an angle) has no end, and `one of` it stops at the
  // first that the rest of the search takes, as the evaluator's does.
  if (all) return (...xs) => lazyList(answers(xs));
  return (...xs) => {
    for (const bound of answers(xs)) return bound;
    throw new Error(`solving ${useTarget(code.nodes, n)} this way gives exactly one answer, and it gave none`);
  };
}
class LazyCell {
  private cell?: { tag: Id; fields: unknown[] };
  private it: Iterator<unknown>;
  constructor(it: Iterator<unknown>) { this.it = it; }
  private get forced() { if (!this.cell) { const r = this.it.next(); this.cell = r.done ? { tag: NIL, fields: [] } : { tag: CONS, fields: [r.value, new LazyCell(this.it)] }; } return this.cell; }
  get tag() { return this.forced.tag; }
  get fields() { return this.forced.fields; }
}
const lazyList = (it: Iterator<unknown>) => new LazyCell(it);
const inn = (x: unknown) => (typeof x === "boolean" ? { tag: x ? TRUE : FALSE, fields: [] } : x);
// Cells' operations (run.ts cellOps) on the runtime's handler, calling the
// program's closures: no answer is a formula with no value.
function cellFns(cells: Cells) {
  return cellOps(cells, (f, ...xs) => {
    try { return inn((f as unknown as (...a: unknown[]) => unknown)(...xs)) as Value; } catch (e) { if (e === FAIL) throw new NoValue("gave no value"); throw e; }
  });
}

export const RUNTIME = {
  FAIL, OUT, Aborted, Unsupported,
  fail: (): never => { throw FAIL; },
  // A printed partial function says it has no answer by giving FAIL
  // (C137c15), which is cheap; where that answer is used inside an
  // expression, or by the evaluator's runtime, it is thrown, as before.
  ck: <T>(v: T): T => { if ((v as unknown) === FAIL) throw FAIL; return v; },
  // A function value applied: a printed closure's code directly, so its
  // FAIL comes back as a value; any other function (the evaluator's) by
  // calling it, its thrown FAIL taken as the value.
  ap: (f: { code?: (...xs: unknown[]) => unknown } & ((...xs: unknown[]) => unknown), ...xs: unknown[]) => {
    if (f.code) return f.code(f, ...xs);
    try { return f(...xs); } catch (e) { if (e === FAIL) return FAIL; throw e; }
  },
  stop: (i: number): never => { throw new Stopped(STOPS[i]); },
  mod: (a: number, b: number) => ((a % b) + b) % b,
  unsupported: (what: string): never => { throw new Unsupported(what); },
  int: (s: string) => I.norm(BigInt(s)),
  // A data value's case number, for `tag`.
  caseOf: (x: { tag: Id }, variants: Id[]) => variants.indexOf(x.tag),
  // A closure: a function of its inputs, calling its code with itself
  // first, holding what it captured, so the evaluator's runtime (a page,
  // the library) calls it as any function.
  // `src` (C137c13): the lambda it came from and the binders its captures
  // are, or the builtin, as the evaluator's closures carry (run.ts META),
  // so the evaluator's solver can look inside one it is given.
  closure: (code: (...xs: unknown[]) => unknown, caps: unknown[], src?: { lambda: Id; binders: Id[]; bools: number[] } | { prim: Id }) => {
    const c: ((...xs: unknown[]) => unknown) & { caps: unknown[]; code: typeof code } = Object.assign((...xs: unknown[]) => RUNTIME.ck(code(c, ...xs)), { caps, code });
    if (src) Object.assign(c, { [META]: "prim" in src ? src : { lambda: src.lambda, env: new Map(src.binders.map((b, j) => [b, src.bools.includes(j) ? { tag: caps[j] ? TRUE : FALSE, fields: [] } : caps[j]])) } });
    return c;
  },
  show: STD_IMPL[S.show],
};

// The world's operations (scalar.ts WORLD_OPS) over the evaluator's
// Runtime, as wasm.ts's worldOf: one that fails aborts with its reason.
function worldFn(op: string, rt: Runtime): (...xs: unknown[]) => unknown {
  const w = <K extends keyof World>(k: K): World[K] => {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" ? "write to standard error" : k}`); }) as unknown as World[K];
    return f.bind(rt.world) as World[K];
  };
  const tried = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof Aborted) throw e; throw new Aborted((e as Error).message, 0); } };
  switch (op) {
    case "randomSeed": return () => Math.floor(Math.random() * 4294967296);
    // A stop with a reason (L51c): the program ends, as an overflow's stop.
    case "stopWith": return (why) => { throw new Stopped(why as string); };
    case "now": return () => (rt.world?.now ?? Date.now)();
    case "random": return () => (rt.world?.random ?? worldRandom)();
    case "print": return (s) => { rt.print(s as string); return []; };
    case "printError": return (s) => { w("error")(s as string); return []; };
    case "readInput": return () => tried(() => w("input")());
    case "readLine": return () => tried(() => { const l = w("readLine")(); return l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l] }; });
    case "readFile": return (p) => tried(() => w("readFile")(p as string));
    case "writeFile": return (p, s) => tried(() => { w("writeFile")(p as string, s as string); return []; });
    case "appendFile": return (p, s) => tried(() => { w("appendFile")(p as string, s as string); return []; });
    case "fileExists": return (p) => w("fileExists")(p as string);
    case "listFolder": return (p) => tried(() => toList(w("listFolder")(p as string)));
  }
  return () => { throw new Unsupported(`world ${op}`); };
}

// What the printed functions are given as R: the runtime, the tables'
// and the world's operations, a fresh generator.
export function coreRuntime(tables: TableSpec[], worlds: string[], rt: Runtime, code?: Code) {
  const rand = randFns(new Uint32Array(4)), cells = cellFns(rt.cells ?? new Cells(equal));
  let spend = () => true;
  return { ...RUNTIME, spending: (f: () => boolean) => { spend = f; }, rt: (n: string, b?: BuiltinOf) => rtFn(n, b, tables, rand, cells, code, () => spend()), worlds: worlds.map((op) => worldFn(op, rt)), abort: (reason: unknown, esc: number): never => { throw new Aborted(reason, esc); } };
}

// How the evaluator's runtime (a page's mount, html.ts) calls a function
// printed here: its value, no answer being html.ts's NoAnswer.
export const coreCall = (f: Value, ...xs: Value[]): Value => {
  try { return (f as unknown as (...a: Value[]) => Value)(...xs); } catch (e) { if (e === FAIL) throw new NoAnswer(); throw e; }
};

// What running a main needs to know of it: whether it takes the
// arguments, and what it gives.
export interface MainSpec { args: boolean; result: "f64" | "int" | "other" }
// Runs a main as wasm.ts's runMain does: given the arguments as a List of
// Texts if it takes them; an abort or a stop nobody handles is written to
// standard error, and the exit code is 1.
export function runCoreFn(fn: (...xs: unknown[]) => unknown, m: MainSpec, args: string[], rt: Runtime): number {
  const err = rt.world?.error ?? rt.print;
  let v: unknown;
  try { v = fn(...(m.args ? [toList(args)] : [])); } catch (e) {
    if (e instanceof Aborted) { err(String(e.reason)); return 1; }
    if (e instanceof Stopped) { err(e.message); return 1; }
    if (e === FAIL) throw new Error("main had no answer");
    throw e;
  }
  return m.result === "other" ? 0 : Number(v);
}
