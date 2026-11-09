// The runtime of JavaScript printed from the core IR (C137c, core-js.ts
// prints it): what a printed program calls as R, apart from the printer,
// so a page or module carries only this (C149). A builtin's runtime
// function is named with the builtin's id where it has one (the printer
// reads scalar.ts's tables), so nothing here needs the compiler.

import { bordered } from "../../ters/src/lang/border.ts";
import { ArrayView, arrayView, replaceOwned, CONS, FALSE, HASH_SET_OPS, LOCALE_V, NIL, NONE, S, SOME, STD_IMPL, STD_MANY, TABLE_OPS, tableRead, TICKET_V, TRUE, type Table } from "../../ters/src/lang/std.ts";
import { hostLocale, hostZone } from "../../ters/src/lang/text.ts";
import { plainRequest, responseValue } from "../../ters/src/lang/network.ts";
import { LIST_SHAPE, META, cellOps, equal, finiteFloat, spendStep, unit, type Data, toList, type Runtime, type Value, type World } from "../../ters/src/lang/run.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { answerByShapes, type HostOp } from "../../ters/src/lang/hosts.ts";
import { Cells, NoValue, Pending } from "../../ters/src/lang/cells.ts";
import { worldTimers, type Timers } from "../../ters/src/lang/timers.ts";
import { NoAnswer } from "../../ters/src/lang/html.ts";
import { worldRandom } from "../../ters/src/lang/random.ts";
import * as I from "../../ters/src/lang/int.ts";
import { bytesValue, plainBytes } from "../../ters/src/lang/bytes.ts";
import * as T from "../../ters/src/lang/text.ts";
import type { Code, Id } from "../../ters/src/model.ts";
import { reasonOf, STOPS } from "./stops.ts";
import { impl } from "../../ters/src/prelude.ts";

export class Unsupported extends Error {}
// `node` and `def`: where in the program it stopped (C143), when the
// printed program says; `defName`, the definition's name, which a run of
// main prints after the reason (C143b).
export class Stopped extends Error { node?: Id; def?: Id; defName?: string; constructor(why: string, at?: { node: Id; def: Id; name?: string }, name?: string) { super(why); if (at) { this.node = at.node; this.def = at.def; if (at.name) this.defName = at.name; } else if (name) this.defName = name; } }
export class Aborted { reason: unknown; esc: number; constructor(reason: unknown, esc: number) { this.reason = reason; this.esc = esc; } }
export const FAIL = { fail: true }, OUT = { out: true };

const big = (x: I.Int) => BigInt(x);
// UTF-8 as a browser has it too (a page's script, C137c9).
let utf8: TextEncoder | undefined;
const UTF8 = { encode: (t: string) => (utf8 ??= new TextEncoder()).encode(t) };
// Text is indexed by UTF-8 bytes, as WebAssembly and C have it (scalar.ts).
// A parser asks for pieces of the same text again and again, so the last
// text's bytes are kept, and a text with no character past ASCII is its
// own bytes (calc: 40 to 2 times the hand-written one, C137d11).
let decoder: TextDecoder | undefined, lastText: string | undefined, lastBytes: Uint8Array | undefined, lastAscii = false;
const known = (t: string) => { if (t !== lastText) { lastText = t; lastAscii = !/[^\x00-\x7f]/.test(t); lastBytes = undefined; } };
const ascii = (t: string) => (known(t), lastAscii);
const utf8Of = (t: string) => (known(t), (lastBytes ??= UTF8.encode(t)));
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
  "text.size": (t: string) => (ascii(t) ? t.length : utf8Of(t).length),
  "text.bytes": (t: string, a: number, b: number) => (ascii(t) ? t.slice(a, b) : (decoder ??= new TextDecoder()).decode(utf8Of(t).subarray(a, b))),
  // Where the character that ends at byte i (> 0) starts.
  // An item by its place, read in the buffer (C30 s2: an array's fold
  // reads each item so, where wrapping the place as a BigInt for std's
  // array.at was an eighth of chapters' run).
  // `item at` read in the buffer too, with no answer thrown, not a list
  // of answers made for each read (C93: machine's registers and memory).
  "array.at": (a: Parameters<typeof arrayView>[0], k: I.Int) => { const v = arrayView(a), i = Number(k); if (!(Number.isInteger(i) && i >= 0 && i < v.n)) throw FAIL; return v.buf.items[v.start + i]; },
  // The first item, read in place (C196: an array's match reads it once
  // an item), not a list of its answers.
  "array.first": (a: Parameters<typeof arrayView>[0]) => { const v = arrayView(a); if (v.n === 0) throw FAIL; return v.buf.items[v.start]; },
  "array.get": (a: Parameters<typeof arrayView>[0], k: number) => { const v = arrayView(a), i = Number(k); if (!(i >= 0 && i < v.n)) throw FAIL; return v.buf.items[v.start + i]; },
  // The array's items from place k on, a view of the same buffer (C30 s2b:
  // the rest an array's fold hands its arm, scalar.ts restAsView).
  "array.from": (a: Parameters<typeof arrayView>[0], k: number) => { const v = arrayView(a), i = Number(k); if (!(i >= 0 && i <= v.n)) throw FAIL; (v.ver as { shared?: true }).shared = true; return new ArrayView(v.ver, v.start + i, v.n - i); },
  "text.before": (t: string, i: number) => { if (ascii(t)) return i - 1; const b = utf8Of(t); do i--; while (i > 0 && (b[i] & 0xc0) === 0x80); return i; },
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
    case "at": return (m, k) => { const v = tableRead(m as Table, k, FAIL); if (v === FAIL) throw FAIL; return v; };
    // The same, no answer given back as FAIL, not thrown: printed where
    // the caller checks it (core-js.ts, C59).
    case "atv": return (m, k) => tableRead(m as Table, k, FAIL);
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
type Cases = ((...xs: unknown[]) => unknown)[];
// One stack of the handlers open, of every effect (C185): a perform finds
// the nearest of its effect and takes it and every one inside it off
// while its case runs, as the evaluator's machine does, and the rest it
// gives a case puts them all back. `k`: where what the handler gives goes,
// changed by each rest a case runs (deep handlers). `ks`: the cases that
// are given where their answer goes, last (continuation passing).
// `abort`: a handler of Abort around a wait (core-js.ts `handle`), its
// case as a function.
// `box`: a handler called and returning keeps its value there.
type Frame = Cases & { e: string; k?: (v: unknown) => unknown; box?: { v: unknown }; now?: Set<number>; ks?: Set<number>; seeded?: true; abort?: (x: unknown) => unknown };
const nearest = (s: Frame[], e: string) => { for (let i = s.length - 1; i >= 0; i--) if (s[i].e === e) return i; return -1; };
// A handler whose cases may take the rest (scalar.ts handleOps `later`,
// C137c24): the code it handles takes the rest of its run, and its value
// goes where the frame's `k` says. Called and returning (`out` unset):
// that k keeps it, and it is what the call gives; else `out` is where it
// goes (a handler inside a function that waits, C185), and the code's own
// answer is what the call gives.
function handleK(name: string, handlers: Frame[]): (...xs: unknown[]) => unknown {
  const [, e, at, finTag, how, cs] = name.split(":"), now = new Set((at ?? "").split(",").filter(Boolean).map(Number));
  const ks = new Set((cs ?? "").split(",").filter(Boolean).map(Number)), fk = finTag === "-" ? undefined : finTag;
  return (body, ...cases) => {
    const out = name.endsWith(":out") ? cases.pop() as (v: unknown) => unknown : undefined;
    // A case for the normal finish (C180): run on the code's value with
    // this handler off, what it gives being what the handler gives
    // (given where that goes when it waits, `finK`).
    const fin = fk ? cases.pop() : undefined;
    // Called and returning: one box, which whatever ends last (the code,
    // or a case) leaves the handler's value in.
    const box = { v: undefined as unknown };
    const frame = Object.assign(cases as Cases, { e, now, ks, box: out ? undefined : box, k: out ?? ((v: unknown) => { box.v = v; return true; }) }) as Frame;
    const end = (x: unknown) => {
      if (x === FAIL) return out ? FAIL : frame.k!(x);
      const i = handlers.lastIndexOf(frame);
      handlers.splice(i, 1);
      try { return fk === "finK" ? RUNTIME.ap(fin as never, x, frame.k) : frame.k!(fin ? RUNTIME.ap(fin as never, x) : x); } finally { handlers.splice(i, 0, frame); }
    };
    const n = handlers.length;
    handlers.push(frame);
    let r: unknown;
    try {
      if (how === "d") { const v = (body as () => unknown)(); r = end(v); } else r = (body as { code: (...xs: unknown[]) => unknown }).code(body, end);
    } finally { handlers.length = n; }
    return out ? r : box.v;
  };
}
function rtFn(name: string, builtin?: BuiltinOf, tables?: TableSpec[], rand?: Record<string, (...xs: never[]) => unknown>, cells?: Record<Id, (...xs: Value[]) => Value | undefined>, code?: Code, spend?: () => boolean, info?: Info, rt?: Runtime, handlers: Frame[] = [], hostOps?: HostOps): (...xs: unknown[]) => unknown {
  if (name.startsWith("host:")) return hostFn(name, cells);
  // A replace where every array of its type has one holder (C93 s4,
  // core-js.ts lowerCore): written in place.
  if (name.startsWith("array.replaceOwned.")) return replaceOwned as (...xs: unknown[]) => unknown;
  // A program's own effect whose cases answer in place (scalar.ts
  // handleOps, C137): a handler pushes its cases while the code it handles
  // runs, and a perform calls the nearest one's, with it popped while the
  // case runs, as the evaluator's machine finds the nearest handler.
  // Prior art: dynamically bound handlers for tail-resumptive operations
  // (Koka's evidence vectors; Xie and Leijen, ICFP 2021).
  if (name.startsWith("handleOps:")) {
    const e = name.split(":")[1];
    // A case for the normal finish (C180) runs on the value once the
    // handler is off.
    const finished = name.endsWith(":fin");
    return (body, ...cases) => {
      const fin = finished ? cases.pop() : undefined;
      const n = handlers.length;
      handlers.push(Object.assign(cases as Cases, { e }));
      let v: unknown;
      try { v = (body as () => unknown)(); } finally { handlers.length = n; }
      return fin && v !== FAIL ? RUNTIME.ap(fin as never, v) : v;
    };
  }
  // A program's own effect answered later (C137c24): handleK above.
  // Prior art: CPS for effect handlers (Hillerström and Lindley), here
  // only for the performers of such an effect (selective, as Koka and
  // Effekt).
  if (name.startsWith("handleK:")) return handleK(name, handlers);
  // A handler of Abort around several answers or a wait (C182): whether
  // the rest outside it is running.
  if (name === "rest.in") return (f) => { (f as { inRest: boolean }).inRest = true; return true; };
  if (name === "rest.out") return (f) => { (f as { inRest: boolean }).inRest = false; return true; };
  // A seeded generator (C183) is the nearest handler of Random while its
  // body runs: a draw then isn't a handler's of the program's.
  if (name.startsWith("seeded.in:")) { const e = name.slice(10); return () => { handlers.push(Object.assign([], { e, seeded: true as const })); return true; }; }
  if (name.startsWith("seeded.out:")) { const e = name.slice(11); return () => { const i = nearest(handlers, e); if (i >= 0) handlers.splice(i, 1); return true; }; }
  if (name.startsWith("handled:")) { const e = name.slice(8); return () => { const i = nearest(handlers, e); return i >= 0 && !handlers[i].seeded; }; }
  if (name.startsWith("perform:")) {
    const [, e, op, bool] = name.split(":");
    // The program's own operation nothing in it handles: its host's
    // answer (hosts/js.js, FOREIGN.md), checked at the border as the
    // evaluator checks it, a wrong one being the program's Abort (C137d5).
    const host = hostOps?.[`${e}:${op}`];
    return (...xs) => {
      const i = nearest(handlers, e);
      if (i < 0 && host) {
        let v: unknown;
        try { v = answerByShapes(host, rt?.hosts ?? {}, host.op, xs.map(inn) as Value[]); } catch (err) { throw new Aborted((err as Error).message, 0); }
        return bool ? (v as Data).tag === TRUE : v;
      }
      if (i < 0) throw new Error(`nothing handles ${code?.nodes[e] ? e : "the operation"}`);
      const off = handlers.splice(i);
      try { return off[0][Number(op)](...xs); } finally { handlers.push(...off); }
    };
  }
  if (/^(derive|solve|solveOne|solveAll):|^exists$/.test(name)) {
    // The evaluator's solver (core-solve.ts), which a printed program
    // takes in only when it solves: it carries the library.
    if (!SOLVER) return () => { throw new Unsupported(`${name} without core-solve.ts`); };
    if (name.startsWith("derive:")) return SOLVER.derive(name.slice(7), code, info, rt);
    if (name.startsWith("solve:")) return SOLVER.solve(name.slice(6), code, false, spend);
    if (name.startsWith("solveAll:")) return SOLVER.solve(name.slice(9), code, true, spend);
    // One answer or none (C184): the first of them, or no answer here.
    if (name.startsWith("solveOne:")) { const all = SOLVER.solve(name.slice(9), code, true, spend); return (...xs) => { const l = all(...xs) as Data; if (l.tag === NIL) throw FAIL; return l.fields[0]; }; }
    return (f) => { if (!code) throw new Unsupported("for some without the program"); return SOLVER!.exists(code, f); };
  }
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
  // A builtin whose values cross as they are is bound as itself (C170b):
  // no wrapper spreading its arguments on every call.
  if (one && !builtin![1] && base !== "array.get") return one as (...xs: unknown[]) => unknown;
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
// What core-solve.ts gives, once it is imported.
export type Solver = {
  derive: (id: Id, code?: Code, info?: Info, rt?: Runtime) => (...xs: unknown[]) => unknown;
  solve: (id: Id, code?: Code, all?: boolean, spend?: () => boolean) => (...xs: unknown[]) => unknown;
  exists: (code: Code, f: unknown) => unknown;
};
let SOLVER: Solver | undefined;
export const useSolver = (s: Solver) => { SOLVER = s; };
export const inn = (x: unknown) => (typeof x === "boolean" ? { tag: x ? TRUE : FALSE, fields: [] } : x);
// A List made as it is read (`solveAll`): a periodic solution (an angle)
// has no end, and `one of` it stops at the first that the rest of the
// search takes, as the evaluator's does.
class LazyCell {
  private cell?: { tag: Id; fields: unknown[] };
  private it: Iterator<unknown>;
  constructor(it: Iterator<unknown>) { this.it = it; }
  private get forced() { if (!this.cell) { const r = this.it.next(); this.cell = r.done ? { tag: NIL, fields: [] } : { tag: CONS, fields: [r.value, new LazyCell(this.it)] }; } return this.cell; }
  get tag() { return this.forced.tag; }
  get fields() { return this.forced.fields; }
}
export const lazyList = (it: Iterator<unknown>): unknown => new LazyCell(it);
// A solve whose plan the compiler wrote out (C167a, core-solve.ts
// solverPlan): `make`, given what plans call (plan-rt.js, which a printed
// program takes in only when it has one: usePlans), gives each answer's
// binds. Every answer as a List (`all`), or the first; `none` says the
// solve gave none.
let PLANS: Record<string, unknown> | undefined;
export const usePlans = (p: Record<string, unknown>) => { PLANS = p; };
// `all` "one": a solve of one answer or none, the first or no answer (C184).
export const planned = (make: (p: Record<string, unknown>) => (...xs: unknown[]) => Iterable<unknown>, all: boolean | "one", none: string, own = false) => {
  if (!PLANS && !own) return () => { throw new Unsupported("a written-out solve without plan-rt.js"); };
  const answers = make(PLANS ?? {}) as ((...xs: unknown[]) => Iterable<unknown>) & { one?: (...xs: unknown[]) => unknown; no?: unknown; wrap?: boolean };
  // Answers a written-out plan gave all at once, an array, are the List
  // made at once (C137d22); the evaluator's solver's, made as it is read.
  const listed = (r: Iterable<unknown>) => {
    if (!Array.isArray(r)) return lazyList(r[Symbol.iterator]());
    let l: unknown = { tag: NIL, fields: [] };
    for (let i = r.length - 1; i >= 0; i--) l = { tag: CONS, fields: [r[i], l] };
    return l;
  };
  if (all === "one") {
    // A plan written straight through (`one`): its answer with no list.
    const { one, no, wrap } = answers;
    if (one) return (...xs: unknown[]) => { const r = one(...xs); if (r === no) throw FAIL; return wrap ? [r] : r; };
    return (...xs: unknown[]) => { for (const bound of answers(...xs)) return bound; throw FAIL; };
  }
  return all ? (...xs: unknown[]) => listed(answers(...xs)) : (...xs: unknown[]) => { for (const bound of answers(...xs)) return bound; throw new Error(none); };
};
// Cells' operations (run.ts cellOps) on the runtime's handler, calling the
// program's closures: no answer is a formula with no value.
function cellFns(cells: Cells) {
  return cellOps(cells, (f, ...xs) => {
    try { return inn((f as unknown as (...a: unknown[]) => unknown)(...xs)) as Value; } catch (e) { if (e === FAIL) throw new NoValue("gave no value"); throw e; }
  });
}

// A relational solve's mode plan written out (C167b, core-solve.ts
// modePlan): `make` gets $no, $eq, $int, the builtins it runs forward
// (each its first answer, or $no) and its literals, and gives `solve$`,
// every answer's binds in an array.
const NO_ANSWER = Symbol("no answer");
const forwardBuiltin = (id: Id) => {
  // A Float64 operation (prelude.ts), as the evaluator runs it: no answer
  // where there is none (x / 0), carried as ∞ where it overflows.
  const op = id.startsWith("builtin.") ? id.slice(8) : "";
  if (op in impl) {
    const f = (impl as Record<string, (...a: number[]) => number>)[op];
    // A finite answer of finite numbers is the answer, with no iterator.
    return (...xs: unknown[]) => {
      const r = f(...(xs as number[]));
      if (r - r === 0 && (xs as number[]).every((x) => x - x === 0)) return r;
      for (const v of finiteFloat(op, r, xs as number[])) return v;
      return NO_ANSWER;
    };
  }
  const one = STD_IMPL[id], many = STD_MANY[id];
  if (one) return (...xs: unknown[]) => one(...(xs as Value[]));
  if (many) return (...xs: unknown[]) => { const r = many(...(xs as Value[])); return r.length ? r[0] : NO_ANSWER; };
  return () => { throw new Unsupported(id); };
};
export const moded = (make: (...a: unknown[]) => (...xs: unknown[]) => Iterable<unknown>, forwards: Id[], consts: unknown[], all: boolean | "one", none: string) => {
  const solve = make(NO_ANSWER, equal, { add: I.add, sub: I.sub, neg: I.neg }, forwards.map(forwardBuiltin), consts) as ((...xs: unknown[]) => Iterable<unknown>) & { one?: (...xs: unknown[]) => unknown; wrap?: boolean };
  if (all === "one" && solve.one) { const { one, wrap } = solve; return (...xs: unknown[]) => { const r = one(...xs.map(inn)); if (r === NO_ANSWER) throw FAIL; return wrap ? [r] : r; }; }
  return planned(() => (...xs: unknown[]) => solve(...xs.map(inn)), all, none, true);
};
export const RUNTIME = {
  FAIL, OUT, Aborted, Pending, Unsupported, planned, moded,
  fail: (): never => { throw FAIL; },
  // A step of a definition that may not finish: free, except under a
  // page's budget (run.ts withSteps), where running out is the part's
  // "didn't finish" (C179).
  step: spendStep,
  // A printed partial function says it has no answer by giving FAIL
  // (C137c15), which is cheap; where that answer is used inside an
  // expression, or by the evaluator's runtime, it is thrown, as before.
  ck: <T>(v: T): T => { if ((v as unknown) === FAIL) throw FAIL; return v; },
  // Runs a heap copy (core-js.ts, C137c18): each yield names a heap copy
  // to call and its inputs, whose answer (or exception) goes back in where
  // it yielded; the calls waiting are an array, not frames on the stack.
  // runtime.js's $drive, for compiled JS.
  drive: (g: Generator<[(...xs: unknown[]) => Generator, unknown[]], unknown, unknown>): unknown => {
    const stack: Generator[] = [g];
    let v: unknown, thrown = false;
    for (;;) {
      const top = stack[stack.length - 1];
      let r: IteratorResult<unknown, unknown>;
      try { r = thrown ? top.throw(v) : top.next(v); } catch (e) {
        stack.pop();
        if (!stack.length) throw e;
        v = e;
        thrown = true;
        continue;
      }
      thrown = false;
      if (r.done) {
        stack.pop();
        v = r.value;
        if (!stack.length) return v;
      } else {
        const [fn, xs] = r.value as [(...xs: unknown[]) => Generator, unknown[]];
        stack.push(fn(...xs));
        v = undefined;
      }
    }
  },
  // A function value applied: a printed closure's code directly, so its
  // FAIL comes back as a value; any other function (the evaluator's) by
  // calling it, its thrown FAIL taken as the value.
  ap: (f: { code?: (...xs: unknown[]) => unknown } & ((...xs: unknown[]) => unknown), ...xs: unknown[]) => {
    if (f.code) return f.code(f, ...xs);
    try { return f(...xs); } catch (e) { if (e === FAIL) return FAIL; throw e; }
  },
  // A closure applied from a heap copy (L72e1d): its code's heap copy, if
  // it has one, run by R.drive; otherwise as R.ap.
  aph: function* (f: { code?: ((...xs: unknown[]) => unknown) & { h?: (...xs: unknown[]) => Generator } } & ((...xs: unknown[]) => unknown), ...xs: unknown[]): Generator<[(...xs: unknown[]) => Generator, unknown[]], unknown, unknown> {
    const h = f.code?.h;
    if (h) return yield [h, [f, ...xs]];
    return RUNTIME.ap(f, ...xs);
  },
  // What a handler of Abort around a wait does with what its body threw
  // (C182): its case, or, for a page's wait, the same once the run is
  // resumed there, inside the handler as the evaluator's machine has it.
  caught: (x: unknown, h: (x: unknown) => unknown): unknown => {
    if (x instanceof Pending && x.resume) {
      const go = x.resume;
      x.resume = () => { try { return go(); } catch (y) { RUNTIME.caught(y, h); return []; } };
    }
    if (x instanceof Pending) throw x;
    return h(x);
  },
  // What comes after an attempt whose body waits (C181, core-js.ts): for
  // a page's wait, run once the run resumed there is done, on what it
  // gave; always thrown on.
  // `spent`: running out of fuel is no answer there too.
  later: (x: unknown, after: (v: unknown) => unknown, spent?: boolean): never => {
    if (x instanceof Pending && x.resume) {
      const go = x.resume;
      x.resume = () => {
        let v: unknown;
        try { v = [...go()][0]; } catch (y) { if (y === FAIL || (spent && y === OUT)) v = FAIL; else RUNTIME.later(y, after, spent); }
        return [after(v)];
      };
    }
    throw x;
  },
  // A budget whose code waits (C181, core-js.ts): for a page's wait, the
  // run resumed there goes on with the budget's fuel as it was, `swap`
  // putting it in and the outside's back; running out is no answer.
  fuelLater: (x: unknown, inner: number, swap: (v: number) => number): never => {
    if (x instanceof Pending && x.resume) {
      const go = x.resume;
      x.resume = () => {
        const outer = swap(inner);
        try { return go(); } catch (y) {
          if (y === OUT || y === FAIL) return [FAIL];
          // Waiting again: the fuel it has now kept for that resume.
          if (y instanceof Pending) RUNTIME.fuelLater(y, swap(outer), swap);
          throw y;
        } finally { swap(outer); }
      };
    }
    throw x;
  },
  // A module's stop has its definition's name and no ids (core-js.ts moduleTags).
  stop: (i: number, node?: Id | 0, def?: Id | 0, name?: string): never => { throw new Stopped(reasonOf(i), node && def ? { node, def, name } : undefined, name); },
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
  // `rest` (C40 step 4): its code takes the rest of the run last, as a
  // page handler that waits does; called from outside, the rest keeps
  // the answer, and a wait goes on by it later (core-rt.ts worldFn).
  closure: (code: (...xs: unknown[]) => unknown, caps: unknown[], src?: { lambda: Id; binders: Id[]; bools: number[] } | { prim: Id }, rest?: boolean) => {
    // Called from outside (a page's mount, the host): the first answer,
    // and none is FAIL.
    const whole = (...xs: unknown[]) => { let out: unknown = FAIL; RUNTIME.ck(code(c, ...xs, (v: unknown) => { out = v; return true; })); if (out === FAIL) throw FAIL; return out; };
    // Its fields set one by one, not by Object.assign: a closure is made
    // per call of a several-answer function (Countdown's rest of the
    // search), and every one then has the same shape (C137d25).
    const c = (rest ? whole : (...xs: unknown[]) => RUNTIME.ck(code(c, ...xs))) as ((...xs: unknown[]) => unknown) & { caps: unknown[]; code: typeof code };
    c.caps = caps;
    c.code = code;
    if (src) Object.assign(c, { [META]: "prim" in src ? src : { lambda: src.lambda, env: new Map(src.binders.map((b, j) => [b, src.bools.includes(j) ? { tag: caps[j] ? TRUE : FALSE, fields: [] } : caps[j]])) } });
    return c;
  },
  show: STD_IMPL[S.show],
};

// The world's operations (scalar.ts WORLD_OPS) over the evaluator's
// Runtime, as wasm.ts's worldOf: one that fails aborts with its reason.
// A page handler's wait or await (C40 step 4, PAGE-WAITS-2026-11-03.md)
// is given the rest of the handler, k: where the world can wait (Node's
// sleeps) k runs now; a page's world throws Pending instead, which keeps
// how to go on, so html.ts lands what the handler did so far and, once
// it's ready, runs the rest as a step of its own. As the evaluator's
// (run.ts `unhandled` and `paused`), awaiting a fetch on its way looks
// again every few milliseconds.
function worldFn(op: string, rt: Runtime, timers: Timers, handlers: Frame[]): (...xs: unknown[]) => unknown {
  // An operation answered later (handleK above): the case gets the rest.
  // A handler inside a function that waits (C185): given where its value goes.
  if (op.startsWith("handleK:")) return handleK(op, handlers);
  if (op.startsWith("perform:")) {
    const [, e, i_] = op.split(":");
    // std's Await, which the program handles somewhere (C180): with no
    // handler of the program's open, the world's await and timers.
    // Wait and Time likewise: the world's wait, and its clock.
    const world = e === "std.await" ? [worldFn("await", rt, timers, handlers), worldFn("startTimer", rt, timers, handlers)]
      : e === "std.wait" ? [worldFn("wait", rt, timers, handlers)] : e === "std.time" ? [worldFn("now", rt, timers, handlers)] : undefined;
    return (...xs) => {
      const k = xs.pop(), i = nearest(handlers, e);
      if (i < 0 && world) return e === "std.time" ? RUNTIME.ap(k as never, world[0]()) : i_ === "0" ? world[0](xs[0], k) : RUNTIME.ap(k as never, world[1](xs[0]));
      if (i < 0) throw new Error(`nothing handles ${e}`);
      // The handler and those inside it, off while the case runs; the
      // rest puts them back, and is told where the handler's value goes
      // (or keeps it, called and returning).
      const off = handlers.splice(i) as Frame[], frame = off[0], kk = frame.k!;
      // A rest runs once, as the evaluator's (run.ts).
      // A rest run while its case runs, called and returning: what the
      // code's rest answered (FAIL: a search in it goes on to its next
      // choice), which the perform answers.
      let used = false, answered: unknown = true;
      const rest = (y: unknown, kr?: (v: unknown) => unknown) => {
        if (used) throw new Error("the rest of the operation was resumed a second time: a rest runs once");
        used = true;
        // (A case called and returning, in a handler that isn't: the
        // handler's value from here kept for it.)
        const box = frame.box ?? { v: undefined as unknown };
        if (kr) frame.k = kr;
        else if (!frame.box) frame.k = (v: unknown) => { box.v = v; return true; };
        const n = handlers.length;
        handlers.push(...off);
        try {
          const r = RUNTIME.ap(k as never, y);
          if (!kr) answered = r;
          return kr ? r : box.v;
        } catch (x0) {
          // What the rest threw, to the handlers of Abort it was inside
          // when this kept it, innermost first, as their try/catch would
          // have had it, each with those outside it put back.
          let x = x0;
          for (let j = off.length - 1; j >= 0; j--) {
            const h = off[j].abort;
            if (!h) continue;
            handlers.length = n;
            handlers.push(...off.slice(0, j));
            try { const r = RUNTIME.caught(x, h); if (!kr) answered = r; return kr ? r : box.v; } catch (y2) { x = y2; }
          }
          throw x;
        } finally { handlers.length = n; }
      };
      const j = Number(i_), c = frame[j];
      try {
        // A case that leaves the rest out answers at once (L63, L229e).
        if (frame.now?.has(j)) return frame.ks?.has(j) ? RUNTIME.ap(c as never, ...xs, (v: unknown) => rest(v, kk)) : frame.box ? (rest(c(...xs)), answered) : rest(c(...xs), kk);
        if (frame.ks?.has(j)) return RUNTIME.ap(c as never, ...xs, rest, kk);
        const v = c(...xs, rest);
        if (!frame.box) return kk(v);
        frame.box.v = v;
        return answered;
      } finally { handlers.push(...off); }
    };
  }
  const w = <K extends keyof World>(k: K): World[K] => {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" ? "write to standard error" : k}`); }) as unknown as World[K];
    // Text from the world enters in NFC (L214a), as the evaluator's.
    return bordered(rt.world!, k, f);
  };
  // A page's wait (Pending) isn't a failure: it goes past the program's
  // handlers to the page, which keeps what it showed (C179).
  const tried = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof Aborted || e instanceof Pending) throw e; throw new Aborted((e as Error).message, 0); } };
  const clock = () => (rt.world?.now ?? Date.now)();
  const sleep = (ms: number) => w("wait")(ms);
  const paused = (e: unknown, then: () => unknown): never => {
    if (e instanceof Pending && e.resume === undefined) { let used = false; e.resume = () => { if (used) throw new Error("a page's run was resumed twice"); used = true; return [then()]; }; }
    throw e;
  };
  const awaited = (t: Data, k: unknown): unknown => {
    let now = clock(), at = timers.when(t, now);
    const answer = (a: { at: number; first?: number }) => RUNTIME.ap(k as never, a.first !== undefined ? (t.fields[1] as (x: number) => unknown)(a.first) : t.tag === TICKET_V.timer || t.tag === TICKET_V.at ? t.fields[1] : timers.value(t) ?? unit);
    try {
      while (at.at > now && timers.pending(t)) { sleep(Math.min(5, at.at - now)); now = clock(); at = timers.when(t, now); }
    } catch (e) { paused(e, () => awaited(t, k)); }
    if (at.at > now) { const a = at; try { sleep(at.at - now); } catch (e) { paused(e, () => answer(a)); } }
    return answer(at);
  };
  switch (op) {
    case "startTimer": return (ms) => timers.start(clock(), ms as number);
    case "wait": return (ms, k) => { try { sleep(ms as number); } catch (e) { paused(e, () => RUNTIME.ap(k as never, unit)); } return RUNTIME.ap(k as never, unit); };
    case "await": return (t, k) => awaited(t as Data, k);
    case "randomSeed": return () => (rt.world?.randomSeed ?? (() => Math.floor(Math.random() * 4294967296)))();
    // A stop with a reason (L51c): the program ends, as an overflow's stop.
    case "stopWith": return (why) => { throw new Stopped(why as string); };
    // The clock the program's hosts/js.js answers in place of the world's
    // (L69d1), checked at the border as the evaluator checks it.
    case "now": return () => {
      const host = (rt.hosts as Record<string, (() => unknown) | undefined> | undefined)?.["std.time.now"];
      if (!host) return (rt.world?.now ?? Date.now)();
      let v: unknown;
      try { v = host(); } catch (e) { throw new Aborted((e as Error).message, 0); }
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Aborted(`the host's now gave ${JSON.stringify(v) ?? String(v)}, not a finite number`, 0);
      return v;
    };
    case "myLocale": return () => ({ tag: LOCALE_V, fields: [(rt.world?.locale ?? hostLocale)()] });
    case "myTimeZone": return () => (rt.world?.timeZone ?? hostZone)();
    case "fetchText": return (u) => tried(() => w("fetchText")(u as string));
    // A fetch as a ticket (L150b, C182), as run.ts starts one: in the
    // background where the world can, else fetched now and ready at once.
    case "startFetch": return (u) => tried(() => rt.world?.startFetch ? timers.fetch(w("startFetch")!(u as string)) : { tag: TICKET_V.timer, fields: [0, w("fetchText")(u as string)] });
    case "sendRequest": return (r) => tried(() => responseValue(w("sendRequest")!(plainRequest(r))));
    case "random": return () => (rt.world?.random ?? worldRandom)();
    case "print": return (s) => { rt.print(s as string); return []; };
    // The files `with open file` keeps open (L213c3), as run.ts answers
    // them: what goes wrong is an answer (none, false), never a throw.
    case "keptOpen": return (p) => { try { return { tag: SOME, fields: [w("openFile")!(p as string)] }; } catch { return { tag: NONE, fields: [] }; } };
    case "keptLine": return (f) => { let l: string | null = null; try { l = w("fileLine")!(Number(f)); } catch { /* none */ } return l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l.normalize("NFC")] }; };
    case "keptAddLine": return (f, s) => { try { w("fileAddLine")!(Number(f), s as string); return true; } catch { return false; } };
    case "keptBytes": return (f, n) => { let b: Uint8Array | null = null; try { b = w("fileBytes")!(Number(f), Math.max(0, Number(n))); } catch { /* none */ } return bytesValue(b ?? new Uint8Array(0)); };
    case "keptAddBytes": return (f, b) => { try { w("fileAddBytes")!(Number(f), plainBytes(b)); return true; } catch { return false; } };
    case "keptClose": return (f) => { try { w("closeFile")!(Number(f)); } catch { /* closing can't fail */ } return []; };
    case "log": return (s) => { (rt.world?.log ?? rt.print)(s as string); return []; };
    case "printError": return (s) => { w("error")(s as string); return []; };
    case "readInput": return () => tried(() => w("input")());
    case "readLine": return () => tried(() => { const l = w("readLine")(); return l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l] }; });
    case "readFile": return (p) => tried(() => w("readFile")(p as string));
    case "writeFile": return (p, s) => tried(() => { w("writeFile")(p as string, s as string); return []; });
    case "appendFile": return (p, s) => tried(() => { w("appendFile")(p as string, s as string); return []; });
    case "fileExists": return (p) => w("fileExists")(p as string);
    case "readBytes": return (p) => tried(() => bytesValue(w("readBytes")!(p as string)));
    case "writeBytes": return (p, b) => tried(() => { w("writeBytes")!(p as string, plainBytes(b)); return []; });
    // A zone's offset (L188), NaN for a zone the host doesn't know.
    case "zoneOffset": return (z, s) => T.zoneOffset(z as string, s as number)[0] ?? NaN;
    case "listFolder": return (p) => tried(() => toList(w("listFolder")(p as string)));
  }
  return () => { throw new Unsupported(`world ${op}`); };
}

// What the printed functions are given as R: the runtime, the tables'
// and the world's operations, a fresh generator.
// `info`: the checker's, where the program is loaded in the same process.
// `hostOps`: the program's own operations a host may answer, by
// `effect:index` (core-js.ts hostOpsOf).
export type HostOps = Record<string, HostOp & { op: Id }>;
export function coreRuntime(tables: TableSpec[], worlds: string[], rt: Runtime, code?: Code, info?: Info, hostOps?: HostOps) {
  const held = rt.cells ?? new Cells(equal), rand = randFns(new Uint32Array(4)), cells = cellFns(held);
  // A read the compiler followed (cell-paths.ts, C162): it waits on the
  // places its value is used at only.
  const readPaths = (n: string) => {
    // `readPaths:<needed>|<kept>`: the places a formula's answer holds as
    // they are after the bar (C162c).
    const [need, keep] = n.slice("readPaths:".length).split("|");
    const keys = need.split(","), kept = keep ? keep.split(",") : [];
    held.knowLists(LIST_SHAPE);
    return (c: unknown) => { try { return held.readPaths(c as Value, keys, kept); } catch (e) { if (e instanceof NoValue) throw FAIL; throw e; } };
  };
  const timers = worldTimers((m) => { throw new Aborted(m, 0); });
  let spend = () => true;
  const handlers: Frame[] = [];
  // A handler of Abort around a wait (C185, core-js.ts): on the stack of
  // handlers while its code runs, `hout` taking it (and what's inside it) off.
  const hin = (f: Frame) => handlers.push(Object.assign(f, { e: "" })) - 1, hout = (n: number) => { handlers.length = Math.min(handlers.length, n); return true; };
  return { ...RUNTIME, hin, hout, spending: (f: () => boolean) => { spend = f; }, rt: (n: string, b?: BuiltinOf) => n.startsWith("readPaths:") ? readPaths(n) : rtFn(n, b, tables, rand, cells, code, () => spend(), info, rt, handlers, hostOps), worlds: worlds.map((op) => worldFn(op, rt, timers, handlers)), abort: (reason: unknown, esc: number): never => { throw new Aborted(reason, esc); } };
}

// How the evaluator's runtime (a page's mount, html.ts) calls a function
// printed here: its value, no answer being html.ts's NoAnswer.
export const coreCall = (f: Value, ...xs: Value[]): Value => {
  try { return (f as unknown as (...a: Value[]) => Value)(...xs); } catch (e) { if (e === FAIL) throw new NoAnswer(); throw e; }
};

// What running a main needs to know of it: whether it takes the
// arguments, and what it gives.
// `rest`: it takes the rest of its run last (a main that waits, C40), given
// one that keeps the answer.
export interface MainSpec { args: boolean; result: "f64" | "int" | "other"; rest?: true }
// Runs a main as wasm.ts's runMain does: given the arguments as a List of
// Texts if it takes them; an abort or a stop nobody handles is written to
// standard error, and the exit code is 1.
export function runCoreFn(fn: (...xs: unknown[]) => unknown, m: MainSpec, args: string[], rt: Runtime): number {
  const err = rt.world?.error ?? rt.print;
  let v: unknown;
  try {
    const xs = m.args ? [toList(args)] : [];
    if (m.rest) fn(...xs, (x: unknown) => { v = x; return true; });
    else v = fn(...xs);
  } catch (e) {
    if (e instanceof Aborted) { err(String(e.reason)); return 1; }
    if (e instanceof Stopped) { err(e.defName ? `${e.message} (in ${e.defName})` : e.message); return 1; }
    if (e === FAIL) throw new Error("main had no answer");
    throw e;
  }
  return m.result === "other" ? 0 : Number(v);
}
