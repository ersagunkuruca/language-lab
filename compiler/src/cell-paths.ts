// Reads tracked by the compiler (C162, CELL-READERS-2026-11-03.md "C162:
// how the compiler finds the paths"): for each read of a cell on the core
// IR, the places of the value read that the code goes on to use, found by
// following the value through fields, list matches, calls and closures
// whose function is known. A read whose uses are all found becomes
// `readPaths:<keys>` (core-rt.ts), which waits on those places only
// (cells.ts readPaths and meets); one whose value is used whole somewhere
// stays a plain read. The evaluator keeps its whole reads: the same
// meaning, at another speed.
//
// A value's sources: a read and the steps from it, as cells.ts keys
// (`f<i>/` a field, `*/` any item of a list, a list's rest the list
// again). A use needs the place whole (an operation, a comparison, a host
// builtin, being put into a new value, returned from a function called
// from outside), or the place only (`=`: a match on its case, a list's
// length), or nothing (taking a field). A call is followed into its
// function with what each input holds, a closure with a known function
// into that function where it's applied, as 1-CFA does (Shivers 1991);
// each function and what it's given is worked out once a round, and the
// rounds go on until nothing more is needed. Prior art: Svelte's
// compile-time dependencies; access paths in alias analysis (Landi and
// Ryder 1992).

import { CONS, LIST } from "../../ters/src/lang/std.ts";
import { CELL_OPS } from "../../ters/src/lang/std.ts";
import type { CoreIR, DType, LType, SExpr } from "./scalar.ts";
import { kids as allKids } from "./scalar.ts";
import { keptMap } from "../../ters/src/kept.ts";

// `t`: the type of the value at that place, by key, where it's known.
type Src = { o: number; at: string; t?: string };
type Clo = { fn: number; caps: Abs[] };
// `held`: places read that are inside the value whole, put there by a
// constructor or a box (a list a filter kept them in). Taking the value
// apart where it may be one of them (its type is theirs, or isn't known)
// needs them whole; taking apart what holds them (the list, the box)
// doesn't; and a formula's answer keeps them (C162c).
// `bx`: the boxes it may be, each made at one place in one call.
type Abs = { srcs: Src[]; clos: Clo[]; held: Src[]; bx?: string[] };

const NONE: Abs = { srcs: [], clos: [], held: [] };
const READ = `host:${CELL_OPS.read}`, FORMULA = `host:${CELL_OPS.formula}`;
// Past these a value's source is given up (needed whole there), so the
// work stays bounded: steps deep, places per read, functions and inputs
// worked out per round.
const DEEP = 8, PLACES = 16, CALLS = 20000;
// Calls worked out inside one another, each with inputs of its own: past
// this many it gives up too, before the stack does (pond-page went 649
// deep, which overflowed it, until each place was kept once: 19 now).
const NESTED = 300;

// Each place once: with a place twice, a list built item by item (a
// reverse's accumulator) held one more copy of it each call, so each
// call looked new and pond-page's went 649 deep (C259).
const union = (a: Src[], b: Src[]) => { const out: Src[] = []; for (const s of [...a, ...b]) if (!out.some((t) => t.o === s.o && t.at === s.at)) out.push(s); return out; };
const join = (a: Abs, b: Abs): Abs => (a === NONE ? b : b === NONE ? a : { srcs: union(a.srcs, b.srcs), clos: [...a.clos, ...b.clos.filter((c) => !a.clos.includes(c))], held: union(a.held, b.held), ...(a.bx || b.bx ? { bx: [...new Set([...(a.bx ?? []), ...(b.bx ?? [])])] } : {}) });
const sig = (a: Abs, depth = 0): string => `${a.srcs.map((s) => `${s.o}:${s.at}`).sort().join(" ")}|${a.held.map((s) => `${s.o}:${s.at}`).sort().join(" ")}|${(a.bx ?? []).join(" ")}|${depth > 3 ? "…" : a.clos.map((c) => `${c.fn}(${c.caps.map((x) => sig(x, depth + 1)).join(",")})`).sort().join(" ")}`;
const isList = (t: DType) => t.def === LIST;
// Whether a place is inside one already needed whole (one without `=`).
const covers = (n: Set<string>, key: string) => { for (const k of n) if (!k.endsWith("=") && k !== key && key.startsWith(k)) return true; return false; };
// Places past PLACES given up a step at a time, deepest first: each taken
// at its first d steps, whole there, until few enough are left; none left
// (every place the read's top) is the value whole (C259: pond-page's
// fish are read at more places of each item than PLACES, so the read was
// whole; now it waits on the items).
function widened(n: Set<string>): Set<string> | null {
  const steps = (k: string) => k.replace(/=$/, "").split("/").filter(Boolean);
  for (let d = Math.max(...[...n].map((k) => steps(k).length)) - 1; d > 0; d--) {
    const out = new Set<string>();
    for (const k of n) { const p = steps(k); out.add(p.length > d ? `${p.slice(0, d).join("/")}/` : k); }
    for (const k of [...out]) if (covers(out, k)) out.delete(k);
    if (out.size <= PLACES / 2) return out;
  }
  return null;
}
const keyOf = (t: LType) => (typeof t === "string" ? t : t.key);

// Kept between compiles (plan doc "Incremental compile after edits"):
// what is worked out here never reads a number, a text or a truth value
// written in the program, nor a function's definition, binders or
// lambda. So the lowered program with those left out, each type by its
// key, is the key, and an edit of a number (greenhouse-page: 0.8 s of a
// 3.7 s compile here) finds what each read became again, by its place
// among the reads the key met.
const LIT = new Set(["num", "int", "text", "bool"]);
const isType = (v: object) => "key" in v && !("k" in v);
const keptReads = keptMap<string, { fns: (string | null)[]; n: number }>();
function readsKey(ir: CoreIR): { key: string; reads: (SExpr & { k: "rt" })[] } {
  const reads: (SExpr & { k: "rt" })[] = [];
  const own = (ts: object[]) => ts.map((t) => { const { key, ...rest } = t as { key: string }; return { type: key, ...rest }; });
  const key = JSON.stringify([ir.funcs, ir.shapes, ...[ir.records, ir.arrays, ir.tables, ir.fns, ir.data, ir.escapes].map(own)], function (this: Record<string, unknown>, k, v) {
    if (typeof v === "bigint") return null;
    if (k === "binders" || k === "lambda" || ("body" in this && "locals" in this && k === "def")) return null;
    if (v && typeof v === "object") {
      if (isType(v)) return (v as { key: string }).key;
      const e = v as SExpr;
      if (LIT.has(e.k) && "v" in e) return { k: e.k };
      if (e.k === "rt" && e.fn === READ) reads.push(e);
    }
    return v;
  });
  return { key, reads };
}

// The places each read's value is used at: keys, or null for the whole
// value. Then every read whose places are all known is rewritten in place.
export function trackReads(ir: CoreIR): number {
  const { key, reads } = readsKey(ir);
  const was = keptReads.get(key);
  if (was && was.fns.length === reads.length) {
    was.fns.forEach((f, i) => { if (f !== null) reads[i].fn = f; });
    return was.n;
  }
  const n = trackReadsIn(ir);
  if (keptReads.size >= 4) keptReads.clear();
  keptReads.set(key, { fns: reads.map((e) => (e.fn === READ ? null : e.fn)), n });
  return n;
}
function trackReadsIn(ir: CoreIR): number {
  const sites = new Map<SExpr, number>();
  const needs: (Set<string> | null)[] = [];
  // The places a formula's answer holds as they are, by read.
  const kept: Set<string>[] = [];
  let changed = false;
  const need = (a: Abs, only: boolean) => {
    for (const s of [...a.srcs, ...a.held.map((h) => ({ ...h, whole: true }))]) {
      const n = needs[s.o];
      if (n === null) continue;
      const key = s.at + (only && !("whole" in s) ? "=" : "");
      if (n.has(key) || covers(n, key)) continue;
      changed = true;
      if (key === "") { needs[s.o] = null; continue; }
      n.add(key);
      if (n.size > PLACES) { const w = widened(n); needs[s.o] = w; }
    }
    for (const c of a.clos) for (const x of c.caps) need(x, false);
  };
  // A formula's answer: what it holds of a read, as it is.
  const keep = (a: Abs) => {
    for (const s of [...a.srcs, ...a.held]) {
      if (needs[s.o] === null || kept[s.o].has(s.at)) continue;
      if (kept[s.o].size >= PLACES) { need({ srcs: [s], clos: [], held: [] }, false); continue; }
      kept[s.o].add(s.at);
      changed = true;
    }
    for (const c of a.clos) for (const x of c.caps) need(x, false);
  };
  // Of what a is held whole, what a value of type `t` taken apart may be
  // (needed whole), and the rest, which only holds it.
  const apart = (a: Abs, t: LType): Src[] => {
    if (!a.held.length) return a.held;
    const k = keyOf(t), into = a.held.filter((h) => h.t === undefined || h.t === k);
    if (into.length) need({ srcs: [], clos: [], held: into }, false);
    return into.length ? a.held.filter((h) => !into.includes(h)) : a.held;
  };
  // A part of a, of type `t` (the value being taken apart is `of`). A
  // part of what holds a place whole, of that place's type, may be that
  // place itself (an item of the list a filter kept): read from there on.
  const step = (a: Abs, k: string, of: LType, t: LType): Abs => {
    const tk = keyOf(t), rest = apart(a, of);
    const held = rest.filter((h) => h.t !== tk);
    const srcs: Src[] = rest.filter((h) => h.t === tk);
    for (const s of a.srcs) {
      const at = s.at + k;
      if (at.split("/").length > DEEP) need({ srcs: [s], clos: [], held: [] }, false);
      else srcs.push({ o: s.o, at, t: keyOf(t) });
    }
    return srcs.length || held.length ? { srcs: union(srcs, []), clos: [], held } : NONE;
  };
  // What each box (a record the lowering sets, W4d) was given, by where
  // and in which call it was made.
  const boxes = new Map<string, Src[]>();
  const madeAt = new Map<SExpr, number>();
  let ctx = "";

  // What a call of fn with these inputs gives, as last worked out.
  let results = new Map<string, Abs>(), next = new Map<string, Abs>();
  let calls = 0, nested = 0;
  const call = (fn: number, args: Abs[]): Abs => {
    const key = `${fn}#${args.map((a) => sig(a)).join(";")}`;
    const done = next.get(key);
    if (done) return done;
    if (++calls > CALLS) throw new GiveUp();
    next.set(key, results.get(key) ?? NONE);
    if (++nested > NESTED) throw new GiveUp();
    const outer = ctx;
    ctx = key;
    let r: Abs;
    try { r = body(fn, args); } finally { ctx = outer; nested--; }
    if (sig(r) !== sig(results.get(key) ?? NONE)) changed = true;
    next.set(key, r);
    return r;
  };
  const body = (fn: number, args: Abs[]): Abs => {
    const f = ir.funcs[fn];
    const env: Abs[] = [...args];
    const ev = (e: SExpr): Abs => {
      switch (e.k) {
        case "num": case "int": case "text": case "bool": case "zero": case "fail": return NONE;
        case "local": return env[e.i] ?? NONE;
        case "rt": {
          const xs = e.args.map(ev);
          if (e.fn === READ) {
            let o = sites.get(e);
            if (o === undefined) { o = needs.push(new Set()) - 1; kept.push(new Set()); sites.set(e, o); }
            for (const x of xs) need(x, false);
            return { srcs: [{ o, at: "" }], clos: [], held: [] };
          }
          // A choice's items cut to a piece's (C43g, branches-rt.ts
          // chooseSplit): some of the same items, read as the list is.
          if (e.fn === "choose.split") return xs[0] ?? NONE;
          // A list held as an array (C354): read as the list is, an item by
          // its position any item (`*/`), its length its case, a slice or
          // its items the same list; one made holds what it's given whole.
          const arr = /^array\.(\w+)\.a(\d+)$/.exec(e.fn), at = arr && ir.arrays.find((a) => a.index === Number(arr[2]));
          if (arr && at) {
            const [a, ...more] = xs;
            const as = at as unknown as LType;
            switch (arr[1]) {
              case "length": { for (const x of more) need(x, false); need({ ...a, held: [] }, true); apart(a, as); return NONE; }
              case "get": case "at": case "first": { for (const x of more) need(x, false); return step(a, "*/", as, at.item); }
              case "slice": case "rest": case "items": { for (const x of more) need(x, false); return a; }
              case "empty": case "push": case "pushOwned": case "pushFront": case "pushFrontOwned": case "replaceOwned": case "replace": {
                let held: Src[] = [];
                xs.forEach((x, i) => {
                  for (const c of x.clos) for (const y of c.caps) need(y, false);
                  if ((arr[1] === "replaceOwned" || arr[1] === "replace") && i === 1) need(x, false);
                  else held = union(held, union(x.srcs, x.held));
                });
                return held.length ? { srcs: [], clos: [], held } : NONE;
              }
            }
          }
          for (const x of xs) need(x, false);
          return NONE;
        }
        case "op": case "world": case "abort": {
          for (const x of kids(e)) need(ev(x), false);
          return NONE;
        }
        // A value made of others holds them whole.
        case "make": case "new": case "list": {
          let held: Src[] = [];
          for (const x of e.k === "list" ? e.items : e.args) {
            const a = ev(x);
            for (const c of a.clos) for (const y of c.caps) need(y, false);
            held = union(held, union(a.srcs, a.held));
          }
          if (e.k === "make" && e.t.mutable) {
            let m = madeAt.get(e);
            if (m === undefined) madeAt.set(e, (m = madeAt.size));
            return { srcs: [], clos: [], held, bx: [`${m}@${ctx}`] };
          }
          return held.length ? { srcs: [], clos: [], held } : NONE;
        }
        // A map, keep, fold or test shared out where it is worth it
        // (map.worth, C42, C43) computes what its else does in turn, so
        // the else says what is read, as columns.ts and zero-parts.ts take
        // it (I219: the shared one's list and closure counted as used whole).
        case "if": {
          if (e.cond.k === "rt" && e.cond.fn === "map.worth") return ev(e.else);
          need(ev(e.cond), false);
          return join(ev(e.then), ev(e.else));
        }
        case "let": { env[e.i] = ev(e.value); return ev(e.body); }
        case "call": return call(e.fn, e.args.map(ev));
        case "get": {
          const rec = ev(e.rec), r = step(rec, `f${e.i}/`, e.t, e.t.fields[e.i].t);
          const box = (rec.bx ?? []).flatMap((b) => boxes.get(b) ?? []);
          return box.length ? join(r, { srcs: [], clos: [], held: box }) : r;
        }
        case "field": {
          const r = ev(e.rec), ft = e.t.cases[e.c]?.fields[e.i]?.t ?? e.t;
          if (isList(e.t) && e.t.cases[e.c]?.variant === CONS) return e.i === 0 ? step(r, "*/", e.t, ft) : step(r, "", e.t, e.t);
          return step(r, `f${e.i}/`, e.t, ft);
        }
        case "tag": { const v = ev(e.rec); need({ ...v, held: [] }, true); apart(v, e.t); return NONE; }
        case "case": {
          const v = ev(e.scrut);
          need({ ...v, held: [] }, true);
          apart(v, e.t);
          env[e.s] = v;
          return e.arms.reduce((a: Abs, x) => (x ? join(a, ev(x)) : a), NONE);
        }
        case "closure": return { srcs: [], clos: [{ fn: e.fn, caps: e.caps.map(ev) }], held: [] };
        case "cap": return (env[0]?.clos ?? []).reduce((a: Abs, c) => join(a, c.caps[e.i] ?? NONE), NONE);
        case "apply": {
          const g = ev(e.fn), xs = e.args.map(ev);
          need({ srcs: g.srcs, clos: [], held: g.held }, false);
          if (!g.clos.length) { for (const x of xs) need(x, false); return NONE; }
          return g.clos.reduce((a: Abs, c) => join(a, call(c.fn, [{ srcs: [], clos: [c], held: [] }, ...xs])), NONE);
        }
        case "budget": return join(ev(e.body), ev(e.otherwise));
        case "attempt": { env[e.res] = ev(e.body); return join(ev(e.ok), ev(e.otherwise)); }
        case "handle": return join(ev(e.body), ev(e.arm));
        case "released": return join(ev(e.body), ev(e.release));
        case "set": {
          const rec = ev(e.rec), v = ev(e.value);
          for (const c of v.clos) for (const y of c.caps) need(y, false);
          for (const b of rec.bx ?? []) {
            const was = boxes.get(b) ?? [], now = union(was, union(v.srcs, v.held));
            if (now.length !== was.length) { boxes.set(b, now); changed = true; }
          }
          return ev(e.then);
        }
        case "search": { env[e.res] = ev(e.body); return e.dflt ? ev(e.dflt) : NONE; }
        case "choose": { need(ev(e.list), false); return NONE; }
        default: throw new GiveUp();
      }
    };
    void f;
    return ev(f.body);
  };

  // The functions a formula runs: its answer keeps what it holds.
  const formulas = new Set<number>();
  const scan = (e: SExpr) => {
    if (e.k === "rt" && e.fn === FORMULA && e.args[0]?.k === "closure") formulas.add(e.args[0].fn);
    for (const x of allKids(e)) scan(x);
  };
  for (const f of ir.funcs) scan(f.body);
  try {
    for (let round = 0; round < 50; round++) {
      changed = false;
      calls = 0;
      next = new Map();
      // Every function as called from outside, with inputs it can't see
      // into: what it gives back is used whole there.
      for (let i = 0; i < ir.funcs.length; i++) { const r = call(i, ir.funcs[i].params.map(() => NONE)); if (formulas.has(i)) keep(r); else need(r, false); }
      results = next;
      if (!changed) break;
      if (round === 49) return 0;
    }
  } catch (e) {
    if (e instanceof GiveUp) return 0;
    throw e;
  }
  let n = 0;
  for (const [e, o] of sites) {
    const keys = needs[o];
    if (!keys || e.k !== "rt") continue;
    e.fn = `readPaths:${keys.size ? [...keys].join(",") : "="}${kept[o].size ? `|${[...kept[o]].join(",")}` : ""}`;
    n++;
  }
  return n;
}

class GiveUp extends Error {}

function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "make": case "new": case "world": return e.args;
    case "abort": return [e.reason];
    default: return [];
  }
}
