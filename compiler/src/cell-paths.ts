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

const union = (a: Src[], b: Src[]) => [...a, ...b.filter((s) => !a.some((t) => t.o === s.o && t.at === s.at))];
const join = (a: Abs, b: Abs): Abs => (a === NONE ? b : b === NONE ? a : { srcs: union(a.srcs, b.srcs), clos: [...a.clos, ...b.clos.filter((c) => !a.clos.includes(c))], held: union(a.held, b.held), ...(a.bx || b.bx ? { bx: [...new Set([...(a.bx ?? []), ...(b.bx ?? [])])] } : {}) });
const sig = (a: Abs, depth = 0): string => `${a.srcs.map((s) => `${s.o}:${s.at}`).sort().join(" ")}|${a.held.map((s) => `${s.o}:${s.at}`).sort().join(" ")}|${(a.bx ?? []).join(" ")}|${depth > 3 ? "…" : a.clos.map((c) => `${c.fn}(${c.caps.map((x) => sig(x, depth + 1)).join(",")})`).sort().join(" ")}`;
const isList = (t: DType) => t.def === LIST;
const keyOf = (t: LType) => (typeof t === "string" ? t : t.key);

// The places each read's value is used at: keys, or null for the whole
// value. Then every read whose places are all known is rewritten in place.
export function trackReads(ir: CoreIR): number {
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
      if (n.has(key)) continue;
      changed = true;
      if (n.size >= PLACES || key === "") needs[s.o] = null;
      else n.add(key);
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
    return srcs.length || held.length ? { srcs, clos: [], held } : NONE;
  };
  // What each box (a record the lowering sets, W4d) was given, by where
  // and in which call it was made.
  const boxes = new Map<string, Src[]>();
  const madeAt = new Map<SExpr, number>();
  let ctx = "";

  // What a call of fn with these inputs gives, as last worked out.
  let results = new Map<string, Abs>(), next = new Map<string, Abs>();
  let calls = 0;
  const call = (fn: number, args: Abs[]): Abs => {
    const key = `${fn}#${args.map((a) => sig(a)).join(";")}`;
    const done = next.get(key);
    if (done) return done;
    if (++calls > CALLS) throw new GiveUp();
    next.set(key, results.get(key) ?? NONE);
    const outer = ctx;
    ctx = key;
    let r: Abs;
    try { r = body(fn, args); } finally { ctx = outer; }
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
        case "if": { need(ev(e.cond), false); return join(ev(e.then), ev(e.else)); }
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
