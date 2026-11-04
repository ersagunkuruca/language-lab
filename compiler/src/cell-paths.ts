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
import type { CoreIR, DType, SExpr } from "./scalar.ts";

type Src = { o: number; at: string };
type Clo = { fn: number; caps: Abs[] };
type Abs = { srcs: Src[]; clos: Clo[] };

const NONE: Abs = { srcs: [], clos: [] };
const READ = `host:${CELL_OPS.read}`;
// Past these a value's source is given up (needed whole there), so the
// work stays bounded: steps deep, places per read, functions and inputs
// worked out per round.
const DEEP = 8, PLACES = 16, CALLS = 20000;

const join = (a: Abs, b: Abs): Abs => (a === NONE ? b : b === NONE ? a : { srcs: [...a.srcs, ...b.srcs.filter((s) => !a.srcs.some((t) => t.o === s.o && t.at === s.at))], clos: [...a.clos, ...b.clos.filter((c) => !a.clos.includes(c))] });
const sig = (a: Abs, depth = 0): string => `${a.srcs.map((s) => `${s.o}:${s.at}`).sort().join(" ")}|${depth > 3 ? "…" : a.clos.map((c) => `${c.fn}(${c.caps.map((x) => sig(x, depth + 1)).join(",")})`).sort().join(" ")}`;
const isList = (t: DType) => t.def === LIST;

// The places each read's value is used at: keys, or null for the whole
// value. Then every read whose places are all known is rewritten in place.
export function trackReads(ir: CoreIR): number {
  const sites = new Map<SExpr, number>();
  const needs: (Set<string> | null)[] = [];
  let changed = false;
  const need = (a: Abs, only: boolean) => {
    for (const s of a.srcs) {
      const n = needs[s.o];
      if (n === null) continue;
      const key = s.at + (only ? "=" : "");
      if (n.has(key)) continue;
      changed = true;
      if (n.size >= PLACES || key === "") needs[s.o] = null;
      else n.add(key);
    }
    for (const c of a.clos) for (const x of c.caps) need(x, false);
  };
  const step = (a: Abs, k: string): Abs => {
    if (!a.srcs.length) return NONE;
    const srcs: Src[] = [];
    for (const s of a.srcs) {
      const at = s.at + k;
      if (at.split("/").length > DEEP) need({ srcs: [s], clos: [] }, false);
      else srcs.push({ o: s.o, at });
    }
    return { srcs, clos: [] };
  };

  // What a call of fn with these inputs gives, as last worked out.
  let results = new Map<string, Abs>(), next = new Map<string, Abs>();
  let calls = 0;
  const call = (fn: number, args: Abs[]): Abs => {
    const key = `${fn}#${args.map((a) => sig(a)).join(";")}`;
    const done = next.get(key);
    if (done) return done;
    if (++calls > CALLS) throw new GiveUp();
    next.set(key, results.get(key) ?? NONE);
    const r = body(fn, args);
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
            if (o === undefined) { o = needs.push(new Set()) - 1; sites.set(e, o); }
            for (const x of xs) need(x, false);
            return { srcs: [{ o, at: "" }], clos: [] };
          }
          for (const x of xs) need(x, false);
          return NONE;
        }
        case "op": case "make": case "new": case "world": case "abort": {
          for (const x of kids(e)) need(ev(x), false);
          return NONE;
        }
        case "list": { for (const x of e.items) need(ev(x), false); return NONE; }
        case "if": { need(ev(e.cond), false); return join(ev(e.then), ev(e.else)); }
        case "let": { env[e.i] = ev(e.value); return ev(e.body); }
        case "call": return call(e.fn, e.args.map(ev));
        case "get": return step(ev(e.rec), `f${e.i}/`);
        case "field": {
          const r = ev(e.rec);
          if (isList(e.t) && e.t.cases[e.c]?.variant === CONS) return e.i === 0 ? step(r, "*/") : step(r, "");
          return step(r, `f${e.i}/`);
        }
        case "tag": { need(ev(e.rec), true); return NONE; }
        case "case": {
          const v = ev(e.scrut);
          need(v, true);
          env[e.s] = v;
          return e.arms.reduce((a: Abs, x) => (x ? join(a, ev(x)) : a), NONE);
        }
        case "closure": return { srcs: [], clos: [{ fn: e.fn, caps: e.caps.map(ev) }] };
        case "cap": return (env[0]?.clos ?? []).reduce((a: Abs, c) => join(a, c.caps[e.i] ?? NONE), NONE);
        case "apply": {
          const g = ev(e.fn), xs = e.args.map(ev);
          need({ srcs: g.srcs, clos: [] }, false);
          if (!g.clos.length) { for (const x of xs) need(x, false); return NONE; }
          return g.clos.reduce((a: Abs, c) => join(a, call(c.fn, [{ srcs: [], clos: [c] }, ...xs])), NONE);
        }
        case "budget": return join(ev(e.body), ev(e.otherwise));
        case "attempt": { env[e.res] = ev(e.body); return join(ev(e.ok), ev(e.otherwise)); }
        case "handle": return join(ev(e.body), ev(e.arm));
        case "set": { ev(e.rec); need(ev(e.value), false); return ev(e.then); }
        case "search": { env[e.res] = ev(e.body); return e.dflt ? ev(e.dflt) : NONE; }
        case "choose": { need(ev(e.list), false); return NONE; }
        default: throw new GiveUp();
      }
    };
    void f;
    return ev(f.body);
  };

  try {
    for (let round = 0; round < 50; round++) {
      changed = false;
      calls = 0;
      next = new Map();
      // Every function as called from outside, with inputs it can't see
      // into: what it gives back is used whole there.
      for (let i = 0; i < ir.funcs.length; i++) need(call(i, ir.funcs[i].params.map(() => NONE)), false);
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
    e.fn = `readPaths:${keys.size ? [...keys].join(",") : "="}`;
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
