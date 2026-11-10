// Parts known to be 0 (L43, GRADES.md "In the compiler"): which Float64
// parts of the core IR's values are always 0, worked out over the whole
// lowered program, and the arithmetic on them dropped. Bounce passes
// positions (vectors), turns (rotors) and spins (bivectors) as one 8-part
// type in lists of bodies, through map and fold; the masks of the program
// as written (grades.ts valueMasks) don't reach through those, so its step
// multiplied all 8 parts of each. Here the reading is of the lowered
// program, where every type is known:
//
// - by field: a record's fields, and a data type's cases' fields, each
//   have their own parts (a body's position is a vector, its turn a rotor),
//   and a list is one summary of all its items;
// - by call: a function is read once for each place it is called from,
//   and copied for each different set of inputs (a vector's `plus` isn't a
//   rotor's); a copy that drops nothing more than another is that one;
// - through closures: a closure's code is given what every apply of its
//   type gives, and every part when the runtime may call it (a page's
//   handlers, anything handed to the world);
// - through cells: a cell gives back what was put in it;
// - by cancellation: a sum of products that is 0 as a polynomial (the
//   trivector part of a vector reflected in a vector), and the
//   exponential's rule (exp of a bivector is a rotor), which the series
//   run over the algebra's table can't show.
//
// 0 is exact here, as the masks are (GRADES.md): 0 · x is 0 and the term
// is dropped, as staging drops it (stage.ts `later`). On Bounce every
// value gets its mask (positions and velocities vectors, spins bivectors,
// turns rotors): its compiled program multiplies 751 times instead of
// 1914, and a step of the solid world takes about a third less (L43).
// Then each value is held in a record of only its masked parts (L43f2,
// narrowing below): half the time of every part, all told.

import type { Id } from "../../ters/src/model.ts";
import { algebrasOf, type Algebra } from "../../ters/src/lang/grades.ts";
import { EMBEDDING } from "../../ters/src/lang/std.ts";
import type { CoreIR, DType, FType, LType, RType, SExpr, SFunc } from "./scalar.ts";
import { OPS, isData, isFn, isRecord, kids, mapKids, mapLocals, tidied } from "./scalar.ts";

// What a value may be: null nothing yet (no value reaches here), false a
// Float64 that is always 0, true anything, or a record's fields, or a data
// type's cases (null: a case never made). A field of the data type's own
// type (a list's rest) is the same summary: SELF.
type Abs = null | boolean | { f: Abs[] } | { c: (Abs[] | null)[] } | typeof SELF;
const SELF = "self" as const;

const DEPTH = 6;

function join(a: Abs, b: Abs): Abs {
  if (a === null) return b;
  if (b === null) return a;
  if (a === true || b === true) return true;
  if (a === false && b === false) return false;
  if (a === SELF || b === SELF) return a === b ? a : true;
  if (typeof a === "object" && typeof b === "object") {
    if ("f" in a && "f" in b && a.f.length === b.f.length) return { f: a.f.map((x, i) => join(x, b.f[i])) };
    if ("c" in a && "c" in b && a.c.length === b.c.length) return { c: a.c.map((x, i) => (x === null ? b.c[i] : b.c[i] === null ? x : x.map((y, j) => join(y, b.c[i]![j])))) };
  }
  return true;
}
const key = (a: Abs | Abs[]) => JSON.stringify(a);
// The same abstract value (key's equality, without writing it out).
function same(a: Abs, b: Abs): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ("f" in a) return "f" in b && a.f.length === b.f.length && a.f.every((x, i) => same(x, b.f[i]));
  if (!("c" in b) || a.c.length !== b.c.length) return false;
  return a.c.every((x, i) => { const y = b.c[i]; return x === null || y === null ? x === y : x.length === y.length && x.every((z, j) => same(z, y[j])); });
}
// A function type's key, whether or not it may have no answer.
const fkey = (t: FType) => t.key.replace(/!$/, "");

// Part i of a record, case c's field i of a data value.
function fieldOf(rec: Abs, i: number): Abs {
  if (rec === null) return null;
  if (typeof rec === "object" && "f" in rec) return rec.f[i] === undefined ? true : rec.f[i];
  return true;
}
function caseField(d: Abs, c: number, i: number): Abs {
  if (d === null) return null;
  if (typeof d === "object" && "c" in d) {
    const fs = d.c[c];
    if (!fs) return null;
    const x = fs[i];
    return x === SELF ? d : x === undefined ? true : x;
  }
  return true;
}
function newOf(t: DType, c: number, args: Abs[]): Abs {
  // The fields of t's own type are the summary itself.
  const own = t.cases[c].fields.map((x) => x.t === t || (isData(x.t) && x.t.key === t.key));
  let d: Abs = { c: t.cases.map((cs, j) => (j === c ? cs.fields.map((_, i) => (own[i] ? SELF : args[i])) : null)) };
  for (let i = 0; i < args.length; i++) if (own[i]) d = join(d, args[i]);
  return d;
}
// The depth of an abs, to keep nesting finite (a list of trees of lists).
function depth(a: Abs): number {
  if (a === null || typeof a !== "object") return 0;
  if ("f" in a) return 1 + Math.max(0, ...a.f.map(depth));
  return 1 + Math.max(0, ...a.c.map((fs) => (fs ? Math.max(0, ...fs.map(depth)) : 0)));
}
const capped = (a: Abs): Abs => (depth(a) > DEPTH ? true : a);

// A polynomial: each product of variables (their names, sorted, joined)
// and its coefficient. Too many terms: not worked out.
type Poly = Map<string, number>;
const POLY = 3000;
function plusP(a: Poly, b: Poly, sign: number): Poly {
  const out = new Map(a);
  for (const [m, c] of b) { const x = (out.get(m) ?? 0) + sign * c; if (x === 0) out.delete(m); else out.set(m, x); }
  return out;
}
function timesP(a: Poly, b: Poly): Poly | null {
  if (a.size * b.size > POLY * 4) return null;
  const out: Poly = new Map();
  for (const [m, c] of a) for (const [n, d] of b) {
    const k = [...(m ? m.split("*") : []), ...(n ? n.split("*") : [])].sort().join("*");
    const x = (out.get(k) ?? 0) + c * d;
    if (x === 0) out.delete(k); else out.set(k, x);
  }
  return out;
}

// `dirty`: to be read again (given more, or what it read grew); `readers`:
// the copies that read its answer.
interface Inst { fn: number; params: Abs[]; result: Abs; index: number; dirty: boolean; readers: Set<Inst> }

// A small function of arithmetic on records (the vectors module's plus,
// minus and scale at a multivector type) put where it's called, so the
// cancellation below sees through it: minus(a b, b a)'s trivector part is
// 0 only when both products are in view.
const LEAF = new Set(["num", "local", "op", "let", "make", "get"]);
function inlineLeaves(funcs: SFunc[]): SFunc[] {
  const size = (e: SExpr): number => 1 + kids(e).reduce((n, x) => n + size(x), 0);
  // Functions that do nothing but compute (no world, runtime, fail, abort,
  // closure called, fuel spent), calling only such functions.
  const QUIET = new Set(["local", "num", "int", "bool", "text", "get", "field", "op", "make", "new", "list", "tag", "cap", "closure", "let", "if", "case", "call", "zero"]);
  const quiet = funcs.map((f) => !f.partial && !f.multi && !f.spends && !f.budgeted);
  const callsOf = funcs.map((f) => { const out: number[] = []; let ok = true; const w = (e: SExpr) => { if (!QUIET.has(e.k) || (e.k === "call" && e.cps)) ok = false; if (e.k === "call") out.push(e.fn); kids(e).forEach(w); }; w(f.body); return ok ? out : null; });
  callsOf.forEach((c, i) => { if (!c) quiet[i] = false; });
  for (let again = true; again;) { again = false; callsOf.forEach((c, i) => { if (quiet[i] && c!.some((j) => !quiet[j])) { quiet[i] = false; again = true; } }); }
  // The same, but for having no answer (`fail`, a partial function): in a
  // function that is all such, the order of what it computes can't be seen,
  // only whether it has an answer.
  const CALM = new Set([...QUIET, "fail"]);
  const calm = funcs.map((f) => !f.multi && !f.spends && !f.budgeted);
  const callsOf2 = funcs.map((f) => { const out: number[] = []; let ok = true; const w = (e: SExpr) => { if (!CALM.has(e.k) || (e.k === "call" && e.cps)) ok = false; if (e.k === "call") out.push(e.fn); kids(e).forEach(w); }; w(f.body); return ok ? out : null; });
  callsOf2.forEach((c, i) => { if (!c) calm[i] = false; });
  for (let again = true; again;) { again = false; callsOf2.forEach((c, i) => { if (calm[i] && c!.some((j) => !calm[j])) { calm[i] = false; again = true; } }); }
  const still = (e: SExpr): boolean => (["local", "num", "get", "field", "op", "make", "cap", "let"].includes(e.k) || (e.k === "if" && !!e.check) || (e.k === "call" && quiet[e.fn] && !e.cps)) && kids(e).every(still);
  const leafy = (e: SExpr): boolean => LEAF.has(e.k) && kids(e).every(leafy);
  const leaf = funcs.map((f) => !f.partial && !f.multi && !f.spends && !f.budgeted && !f.value && leafy(f.body) && size(f.body) < 400);
  return funcs.map((g, gi) => {
    if (!kidsHaveLeafCall(g.body)) return g;
    const free = calm[gi];
    const locals = [...g.locals];
    let put_n = 0;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      // Only given values that can't run anything (a let goes before what
      // it is in, where a printer puts it: an effect would move).
      if (r.k !== "call" || !leaf[r.fn] || r.cps || (!free && !r.args.every(still))) return r;
      put_n++;
      const f = funcs[r.fn], at = locals.length;
      locals.push(...f.locals);
      let body = mapLocals(f.body, (i) => i + at);
      for (let j = r.args.length - 1; j >= 0; j--) body = { k: "let", i: at + j, value: r.args[j], body };
      return body;
    };
    function kidsHaveLeafCall(e: SExpr): boolean { return (e.k === "call" && leaf[e.fn]) || kids(e).some(kidsHaveLeafCall); }
    const body = put(g.body);
    return put_n ? { ...g, locals, body } : g;
  });
}

// A map, keep, first where or count shared on worker threads where its
// items are worth it (C42, C43, scalar.ts `map.worth`) hands its function
// to the runtime, whose closures may be given anything: every function of
// that type, and what it calls, would lose its masks (Bounce's outlines,
// 128 multiplications for 28, through the points of a box's corners as
// well as its multivectors). In a program with an algebra the map as
// compiled is kept, so the parts stay known.
function unshared(algebras: Map<Id, Algebra>): (f: SFunc) => SFunc {
  const put = (e: SExpr): SExpr => {
    const r = mapKids(e, put);
    return r.k === "if" && r.cond.k === "rt" && r.cond.fn === "map.worth" ? r.else : r;
  };
  return (f) => (algebras.size ? { ...f, body: put(f.body) } : f);
}

// A switch from the environment, where there is one: the editor runs
// this in a browser, which has no `process`.
export const envSet = (k: string): boolean => typeof process !== "undefined" && !!process.env?.[k];

export function zeroParts(ir0: CoreIR, roots: number[]): { ir: CoreIR; copies: number; dropped: number } {
  const algebras = new Map<Id, Algebra>();
  try { for (const a of algebrasOf(ir0.code, ir0.info).values()) algebras.set(a.variant, a); } catch { /* no algebras */ }
  const ir: CoreIR = { ...ir0, funcs: inlineLeaves(ir0.funcs.map(unshared(algebras))) };
  const funcs = ir.funcs;
  // A closure's code, by its function type: what every apply of that type
  // may call.
  const codesOf = new Map<string, Set<number>>();
  const closureCode = new Set<number>();
  const scan = (e: SExpr) => {
    if (e.k === "closure") { closureCode.add(e.fn); (codesOf.get(fkey(e.t)) ?? codesOf.set(fkey(e.t), new Set()).get(fkey(e.t))!).add(e.fn); }
    kids(e).forEach(scan);
  };
  funcs.forEach((f) => scan(f.body));
  // Function types the runtime or the world may call (handed to them, or
  // in what a root takes or gives): their closures' inputs are anything.
  const wide = new Set<string>();
  const fnTypesIn = (t: LType, seen = new Set<object>()) => {
    if (typeof t !== "object" || seen.has(t)) return;
    seen.add(t);
    if (isFn(t)) { wide.add(fkey(t)); t.params.forEach((p) => fnTypesIn(p, seen)); fnTypesIn(t.result, seen); return; }
    if (isRecord(t)) t.fields.forEach((x) => fnTypesIn(x.t, seen));
    else if (isData(t)) t.cases.forEach((c) => c.fields.forEach((x) => fnTypesIn(x.t, seen)));
    else if ("item" in t) fnTypesIn(t.item, seen);
    else if ("keyT" in t) { fnTypesIn(t.keyT as LType, seen); fnTypesIn(t.value, seen); }
  };
  // An expression's type, where it is at hand.
  const typeOf = (f: SFunc, e: SExpr): LType | null => {
    switch (e.k) {
      case "num": return "f64";
      case "local": return f.locals[e.i] ?? null;
      case "closure": case "cap": return e.k === "closure" ? e.t : ir.shapes[e.shape]?.caps[e.i] ?? null;
      case "make": case "new": case "list": return e.t;
      case "get": return e.t.fields[e.i]?.t ?? null;
      case "field": return e.t.cases[e.c]?.fields[e.i]?.t ?? null;
      case "call": return funcs[e.fn]?.result ?? null;
      case "apply": return e.t.result;
      case "let": return typeOf(f, e.body);
      case "if": case "budget": case "attempt": case "handle": case "released": case "world": return e.t;
      case "case": return e.result;
      case "rt": return e.host?.t ?? null;
      case "op": return OPS[e.op].t;
      case "bool": return "i32";
      case "text": return "text";
      case "int": return "int";
      case "zero": return e.t;
      default: return null;
    }
  };
  const scanWorld = (f: SFunc, e: SExpr) => {
    if (e.k === "rt" || e.k === "world") for (const a of e.args) { const t = typeOf(f, a); if (t) fnTypesIn(t); else wideAll(a); }
    kids(e).forEach((x) => scanWorld(f, x));
  };
  // An argument whose type isn't at hand: every closure inside it.
  const wideAll = (e: SExpr) => { if (e.k === "closure") wide.add(fkey(e.t)); kids(e).forEach(wideAll); };
  funcs.forEach((f) => scanWorld(f, f.body));
  for (const r of roots) { funcs[r].params.forEach((p) => fnTypesIn(p)); fnTypesIn(funcs[r].result); }
  // A closure held in a mutable record (a box) or an array may be called
  // from anywhere: its type too.
  for (const t of ir.records) if (t.mutable) t.fields.forEach((x) => fnTypesIn(x.t));
  for (const a of ir.arrays) fnTypesIn(a.item);
  for (const t of ir.tables) fnTypesIn(t.value);

  // Copies of each function, by what they're given.
  const insts: Inst[] = [];
  const byKey = new Map<string, Inst>();
  const ofFn = new Map<number, Inst[]>();
  let changed = true;
  const newInst = (fn: number, params: Abs[]): Inst => {
    const i: Inst = { fn, params, result: null, index: -1, dirty: true, readers: new Set() };
    insts.push(i);
    (ofFn.get(fn) ?? ofFn.set(fn, []).get(fn)!).push(i);
    changed = true;
    return i;
  };
  const grow = (i: Inst, args: Abs[]) => {
    args.forEach((a, j) => { const now = capped(join(i.params[j] ?? null, a)); if (!same(now, i.params[j] ?? null)) { i.params[j] = now; i.dirty = true; changed = true; } });
  };
  // One copy per place it's called from (and one for a closure's code,
  // one for a root), given what that place gives in every copy of its
  // caller: monotone, and as many as the program has calls. Copies given
  // the same are one again at the end.
  const sites = new WeakMap<SExpr, number>();
  const siteOf = (e: SExpr) => sites.get(e) ?? (sites.set(e, sites_n++), sites_n - 1);
  let sites_n = 0;
  const instFor = (fn: number, args: Abs[], site: string): Inst => {
    const k = closureCode.has(fn) ? `c${fn}` : `${fn}@${site}`;
    let i = byKey.get(k);
    if (!i) { i = newInst(fn, funcs[fn].params.map(() => null)); byKey.set(k, i); }
    grow(i, args);
    return i;
  };
  for (const r of roots) instFor(r, funcs[r].params.map(() => true), "root");
  // Closure codes the runtime calls: every input anything.
  for (const [t, codes] of codesOf) if (wide.has(t)) for (const c of codes) instFor(c, funcs[c].params.map(() => true), "world");
  // What cells are given, by type: a cell gives back only what was put in
  // it (builtin.cells), so what a cell read may be is what every value of
  // its type put in a cell may be. Anything else the runtime gives is
  // anything.
  const given = new Map<string, Abs>();
  const tkey = (t: LType) => (typeof t === "string" ? t : t.key);
  // A value of a type not at hand: a cell may give back anything.
  let lost = false;
  const handed = (t: LType | null, a: Abs) => {
    if (!t) { if (!lost) { lost = true; changed = true; for (const i of insts) i.dirty = true; } return; }
    const k = tkey(t), was = given.get(k) ?? null, now = capped(join(was, a));
    if (!same(now, was)) { given.set(k, now); changed = true; for (const i of givenReaders.get(k) ?? []) i.dirty = true; }
  };
  const CELL_READ = /^host:builtin\.cells\.read$/, CELL_PUT = /^host:builtin\.cells\.(cell|write)$/;
  const caps = ir.shapes.map((s) => s.caps.map((): Abs => null));
  const capReaders = ir.shapes.map((s) => s.caps.map(() => new Set<Inst>()));
  const givenReaders = new Map<string, Set<Inst>>();
  const growCap = (shape: number, i: number, a: Abs) => {
    const now = capped(join(caps[shape][i], a));
    if (!same(now, caps[shape][i])) { caps[shape][i] = now; changed = true; for (const r of capReaders[shape][i]) r.dirty = true; }
  };

  // A body read with its inputs: what each expression may be. `at`, when
  // given, is told each call's copy and each expression's value (the last
  // round, for the rewrite).
  const read = (me: Inst, at?: { call: (e: SExpr, i: Inst) => void; value: (e: SExpr, a: Abs) => void }): Abs => {
    const f = funcs[me.fn];
    const env: Abs[] = f.locals.map((_, i) => (i < f.params.length ? me.params[i] ?? null : null));
    let grew = false;
    const set = (i: number, a: Abs) => { const now = capped(join(env[i], a)); if (!same(now, env[i])) { env[i] = now; grew = true; } };
    // Exact cancellation: a sum of products that is 0 as a polynomial in
    // what it reads (a velocity turned round by a reflection keeps no
    // trivector part: the terms that would give one cancel), parts known
    // 0 left out. A let read is its value; anything else is a variable.
    const lets = new Map<number, SExpr | null>();
    const last = new Map<SExpr, Abs>();
    const polys = new Map<SExpr, Poly | null>();
    const atoms = new WeakMap<SExpr, string>();
    let atomN = 0;
    const atom = (e: SExpr): Poly => {
      const path = (x: SExpr): string | null => (x.k === "local" ? `l${x.i}` : x.k === "get" ? (((p) => (p ? `${p}.${x.i}` : null))(path(x.rec))) : null);
      const name = path(e) ?? atoms.get(e) ?? (atoms.set(e, `#${atomN++}`), atoms.get(e)!);
      return new Map([[name, 1]]);
    };
    const poly = (e: SExpr): Poly | null => {
      if (polys.has(e)) return polys.get(e)!;
      const p = poly0(e);
      polys.set(e, p && p.size > POLY ? null : p);
      return polys.get(e)!;
    };
    const poly0 = (e: SExpr): Poly | null => {
      if (last.get(e) === false) return new Map();
      switch (e.k) {
        case "num": return Object.is(e.v, 0) || Object.is(e.v, -0) ? new Map() : new Map([["", e.v]]);
        case "local": { const v = lets.get(e.i); return v ? poly(v) : atom(e); }
        // A part of a record made right here is what it was made of.
        case "get": { const m = madeOf(e.rec); return m ? poly(m.args[e.i]) : atom(e); }
        case "op": {
          const ps = e.args.map(poly);
          if (ps.some((p) => !p)) return null;
          switch (e.op) {
            case "add": return plusP(ps[0]!, ps[1]!, 1);
            case "sub": return plusP(ps[0]!, ps[1]!, -1);
            case "neg": return plusP(new Map(), ps[0]!, -1);
            case "mul": return timesP(ps[0]!, ps[1]!);
            default: return atom(e);
          }
        }
        default: return atom(e);
      }
    };
    const madeOf = (e: SExpr): Extract<SExpr, { k: "make" }> | null => {
      for (let n = 0; n < 64; n++) {
        if (e.k === "make") return e;
        if (e.k === "local") { const v = lets.get(e.i); if (!v) return null; e = v; continue; }
        if (e.k === "let") { e = e.body; continue; }
        return null;
      }
      return null;
    };
    const cancels = (e: SExpr): boolean => { const p = poly(e); return !!p && p.size === 0; };
    const ev = (e: SExpr): Abs => {
      const v = ev0(e);
      last.set(e, v);
      at?.value(e, v);
      return v;
    };
    const ev0 = (e: SExpr): Abs => {
      switch (e.k) {
        case "num": return Object.is(e.v, 0) ? false : true;
        case "local": return env[e.i];
        case "op": {
          const xs = e.args.map(ev);
          const z = (a: Abs) => a === false;
          switch (e.op) {
            case "mul": return xs.some((x) => x === null) ? null : xs.some(z) ? false : true;
            case "div": return xs[0] === null ? null : z(xs[0]) ? false : true;
            case "add": case "sub": return xs.some((x) => x === null) ? null : xs.every(z) ? false : true;
            case "neg": return xs[0];
            default: return true;
          }
        }
        case "let": { set(e.i, ev(e.value)); lets.set(e.i, lets.has(e.i) && lets.get(e.i) !== e.value ? null : e.value); return ev(e.body); }
        case "if": { ev(e.cond); return join(ev(e.then), ev(e.else)); }
        // A box (a mutable record) is set elsewhere: anything.
        case "make": {
          const xs = e.args.map(ev);
          if (e.t.mutable) return true;
          // Only a multivector's parts cancel: elsewhere x + c − c may be
          // there for its rounding (fdlibm's sin), which the law changes.
          if (algebras.get(e.t.variant)) e.args.forEach((a, j) => { if (xs[j] === true && (a.k === "op" || a.k === "local") && cancels(a)) { xs[j] = false; last.set(a, false); at?.value(a, false); } });
          return { f: xs };
        }
        case "get": { const r = ev(e.rec); return e.t.mutable ? true : fieldOf(r, e.i); }
        case "new": return capped(newOf(e.t, e.c, e.args.map(ev)));
        case "field": return caseField(ev(e.rec), e.c, e.i);
        case "list": {
          let item: Abs = null;
          for (const x of e.items) item = join(item, ev(x));
          const nil = e.t.cases.findIndex((c) => !c.fields.length);
          let d: Abs = { c: e.t.cases.map((cs, j) => (j === nil ? [] : j === e.c ? cs.fields.map((x) => (x.t === e.t || (isData(x.t) && x.t.key === e.t.key) ? SELF : item)) : null)) };
          d = capped(d);
          set(e.item, item);
          set(e.acc, d);
          return d;
        }
        case "case": {
          const s = ev(e.scrut);
          set(e.s, s);
          let out: Abs = null;
          e.arms.forEach((a) => { if (a) out = join(out, ev(a)); });
          return out;
        }
        case "call": {
          const args = e.args.map(ev);
          // Round a loop: the same copy, given more.
          if (e.tail && e.fn === me.fn) { grow(me, args); at?.call(e, me); me.readers.add(me); return me.result; }
          const i = instFor(e.fn, args, String(siteOf(e)));
          at?.call(e, i);
          i.readers.add(me);
          return i.result;
        }
        case "closure": {
          e.caps.forEach((c, i) => growCap(e.shape, i, ev(c)));
          return true;
        }
        case "cap": capReaders[e.shape][e.i].add(me); return caps[e.shape][e.i];
        case "apply": {
          ev(e.fn);
          const args = e.args.map(ev);
          set(e.tmp, true);
          let out: Abs = null;
          for (const c of codesOf.get(fkey(e.t)) ?? []) { const i = instFor(c, [true, ...args], "apply"); i.readers.add(me); out = join(out, i.result); }
          // A closure no code here makes (from the runtime): anything.
          return codesOf.has(fkey(e.t)) ? out : true;
        }
        case "attempt": { set(e.res, ev(e.body)); return join(ev(e.ok), ev(e.otherwise)); }
        case "search": { ev(e.body); if (e.dflt) ev(e.dflt); set(e.res, true); return true; }
        case "budget": { set(e.save, true); const b = ev(e.body); set(e.res, b); return join(b, ev(e.otherwise)); }
        case "handle": { set(e.save, true); set(e.reason, true); return join(ev(e.body), ev(e.arm)); }
        case "released": { if (e.st !== undefined) set(e.st, true); const b = ev(e.body); ev(e.release); return b; }
        case "set": { ev(e.rec); ev(e.value); return ev(e.then); }
        case "fail": return null;
        case "abort": ev(e.reason); return null;
        case "rt": case "world": {
          const into = e.k === "rt" && CELL_PUT.test(e.fn);
          e.args.forEach((a) => { const v = ev(a); if (into) handed(typeOf(f, a), v); });
          const t = e.k === "rt" ? e.host?.t : e.t;
          if (e.k === "rt" && CELL_READ.test(e.fn) && t && !lost) { const k = tkey(t); (givenReaders.get(k) ?? givenReaders.set(k, new Set()).get(k)!).add(me); return given.get(k) ?? null; }
          return true;
        }
        default: kids(e).forEach(ev); return true;
      }
    };
    // Locals set more than once (round a loop, an arm each) only grow, so
    // the body is read until they stop.
    let r: Abs = null;
    for (let n = 0; n < 8; n++) {
      grew = false;
      polys.clear();
      r = ev(f.body);
      if (!grew) break;
    }
    return r;
  };

  // The exponential's rule, which reading its code (a series over the
  // algebra's table, run when the program runs) can't give: exp(x) is in
  // what 1 and x's parts make under the product (grades.ts "exp"), so the
  // exponential of a bivector is even, a rotor.
  const EXP = /^clifford exp( at |$)/;
  const ruled = (i: Inst, r: Abs): Abs => {
    const f = funcs[i.fn];
    if (!EXP.test(f.name) || f.params.length !== 1 || !isRecord(f.result) || r === null) return r;
    const alg = algebras.get(f.result.variant), x = i.params[0];
    if (!alg || alg.record || !x || typeof x !== "object" || !("f" in x)) return r;
    const one = alg.blades.findIndex((b) => b.length === 0);
    let m = (1 << one) | x.f.reduce<number>((a, p, j) => (p === false || p === null ? a : a | (1 << j)), 0);
    for (;;) {
      let y = m;
      for (let a = 0; a < alg.parts; a++) if ((m >> a) & 1) for (let b = 0; b < alg.parts; b++) if ((m >> b) & 1) y |= alg.pair("product", a, b);
      if (y === m) break;
      m = y;
    }
    const fields = typeof r === "object" && "f" in r ? r.f : f.result.fields.map((): Abs => true);
    return { f: fields.map((p, j) => ((m >> j) & 1 ? p : p === null ? null : false)) };
  };
  let rounds = 0;
  while (changed && rounds < 200) {
    changed = false;
    rounds++;
    for (let n = 0; n < insts.length; n++) {
      const i = insts[n];
      // Only a copy given more, or one whose reads grew, reads again.
      if (!i.dirty) continue;
      i.dirty = false;
      const r = capped(join(i.result, ruled(i, read(i))));
      if (!same(r, i.result)) { i.result = r; changed = true; for (const x of i.readers) x.dirty = true; }
    }
  }
  // Not settled: nothing is said.
  if (changed) return { ir: ir0, copies: 0, dropped: 0 };

  // Copies given the same are one: each group's place, the first of a
  // function's keeping its own (a root's, the one given every input), the
  // others after.
  const out: SFunc[] = funcs.slice();
  const groups: Inst[] = [];
  for (const [fn, list] of ofFn) {
    const byParams = new Map<string, Inst>();
    for (const i of list) { const k = key(i.params); const g = byParams.get(k); if (g) i.index = -2 - groups.indexOf(g); else { byParams.set(k, i); groups.push(i); } }
    const firsts = [...byParams.values()];
    const own = roots.includes(fn) ? firsts.find((i) => i.params.every((p) => p === true)) ?? firsts[0] : firsts[0];
    own.index = fn;
    for (const i of firsts) if (i !== own) { i.index = out.length; out.push(funcs[fn]); }
    for (const i of list) if (i.index <= -2) i.index = groups[-2 - i.index].index;
  }
  let dropped = 0;
  // Each copy read once more, for what each expression may be.
  const reads = groups.map((i) => {
    const calls = new Map<SExpr, number>();
    const values = new Map<SExpr, Abs>();
    read(i, { call: (e, c) => calls.set(e, c.index), value: (e, a) => { const was = values.has(e) ? values.get(e)! : null; values.set(e, join(was, a)); } });
    return { calls, values };
  });
  // The 0s put for parts known to be 0, which a smaller record leaves out.
  const zeros = new Set<SExpr>();
  groups.forEach((i, n) => {
    const { calls, values } = reads[n];
    const f = funcs[i.fn];
    const pure = (e: SExpr): boolean => ["local", "num", "get", "field", "cap"].includes(e.k) && kids(e).every(pure) || (e.k === "op" && kids(e).every(pure));
    const zero: SExpr = { k: "num", v: 0 };
    zeros.add(zero);
    // Only a 0 put here is dropped from a sum: a 0 the program adds itself
    // may be there to make −0 into 0 (atan2 reads them apart).
    const isZero = (e: SExpr) => e === zero;
    const rw = (e: SExpr): SExpr => {
      // A Float64 read that is always 0.
      if ((e.k === "get" || e.k === "field" || e.k === "local" || e.k === "cap" || e.k === "op") && values.get(e) === false && pure(e)) { dropped++; return zero; }
      // A finiteness check (x − x is 0 only for a finite x) is kept as written.
      const r0 = e.k === "if" && e.check ? { ...e, then: rw(e.then), else: rw(e.else) } : mapKids(e, rw);
      const r: SExpr = r0.k === "call" && calls.has(e) ? { ...r0, fn: calls.get(e)! } : r0;
      if (r.k === "op") {
        const [a, b] = r.args;
        switch (r.op) {
          case "mul": if ((isZero(a) && pure(b)) || (isZero(b) && pure(a))) { dropped++; return zero; } break;
          case "div": if (isZero(a) && pure(b)) { dropped++; return zero; } break;
          case "add": if (isZero(a)) return b; if (isZero(b)) return a; break;
          case "sub": if (isZero(b)) return a; break;
          case "neg": if (isZero(a)) return zero; break;
        }
      }
      return r;
    };
    out[i.index] = { ...f, body: rw(f.body) };
  });

  // A smaller record per mask (L43f2): a multivector whose parts known to
  // be 0 are left out holds only the others, so a vector of the 3D
  // projective algebra is 4 numbers, not 16. Each value's record is the
  // one its type says: a function's inputs and answer have the mask of
  // what its copy is given and gives, a field of a record or a data type
  // the mask of everything put there in the whole program (so a list of
  // bodies is never copied), a let the mask of what it is set to. Where
  // two meet (an argument, a field, an arm's answer), the value is copied
  // into the other's record: wider, with 0s, or narrower, leaving out
  // parts that are 0 there. What the runtime or the world is given or
  // gives, and what a page's handlers take, keep every part.
  const narrowed = new Map<string, { base: RType; m: number }>();
  if (!envSet("NO_NARROW")) {
    // A multivector, or a record a declared embedding maps into (L209,
    // EMBEDDINGS.md): a Complex in the image of Float64's is one with no
    // imaginary part, its mask the real part's.
    const embedded = new Set<string>();
    for (const [k] of ir.info.implementations ?? []) {
      if (!k.startsWith(`${EMBEDDING}|`)) continue;
      try { const t = JSON.parse(k.slice(EMBEDDING.length + 1)); const to = t?.args?.[1]; if (to?.t === "con") embedded.add(to.id); } catch { /* not a type */ }
    }
    const algT = (t: RType) => !t.mutable && (algebras.has(t.variant) || embedded.has(t.def)) && t.fields.length > 0 && t.fields.length <= 30 && t.fields.every((x) => x.t === "f64");
    const full = (A: RType) => 2 ** A.fields.length - 1;
    const baseOf = (t: LType | null | undefined): RType | null => {
      if (!t || typeof t !== "object" || !isRecord(t)) return null;
      const n = narrowed.get(t.key);
      return n ? n.base : algT(t) ? t : null;
    };
    const maskOfT = (t: RType) => narrowed.get(t.key)?.m ?? full(t);
    const made = new Map<string, RType>();
    const narrow = (A: RType, m: number): RType => {
      if (m === full(A)) return A;
      const k = `${A.key}~${m}`;
      let r = made.get(k);
      if (!r) { r = { key: k, name: A.name, def: A.def, variant: A.variant, fields: A.fields.filter((_, j) => (m >> j) & 1) }; made.set(k, r); narrowed.set(k, { base: A, m }); }
      return r;
    };
    const maskOf = (a: Abs, A: RType): number => (a === null ? 0 : typeof a === "object" && "f" in a ? a.f.reduce<number>((m, x, j) => (x === false || x === null ? m : m | (1 << j)), 0) : full(A));
    const pos = (m: number, j: number) => { let n = 0; for (let b = 0; b < j; b++) if ((m >> b) & 1) n++; return n; };
    // A part that is 0 where it's made: one put here, or written (a +0,
    // which a part left out reads back as exactly), maybe under lets of
    // reads (a leaf put in place).
    const still = (e: SExpr): boolean => ["local", "num", "get", "field", "cap", "op"].includes(e.k) && kids(e).every(still);
    const isZ = (e: SExpr): boolean => zeros.has(e) || (e.k === "num" && Object.is(e.v, 0)) || (e.k === "let" && still(e.value) && isZ(e.body));
    const isCont = (t: LType | null): t is RType | DType => !!t && typeof t === "object" && ((isRecord(t) && !algT(t)) || isData(t));

    // Types whose values the runtime or the world sees or makes keep every
    // part, with every type inside them.
    const exposed = new Set<string>();
    let unknown = false;
    const seenX = new Set<object>();
    const expose = (t: LType | null | undefined): void => {
      if (!t || typeof t !== "object" || seenX.has(t)) return;
      seenX.add(t);
      if (isFn(t)) { t.params.forEach((p) => expose(p)); expose(t.result); if (t.answer) expose(t.answer); return; }
      if (isRecord(t)) { exposed.add(t.key); t.fields.forEach((x) => expose(x.t)); }
      else if (isData(t)) { exposed.add(t.key); t.cases.forEach((c) => c.fields.forEach((x) => expose(x.t))); }
      else if ("item" in t) expose(t.item);
      else if ("keyT" in t) { expose(t.keyT as LType); expose(t.value); }
    };
    // A cell only holds what it's given (builtin.cells cell, write and
    // read): unless the program takes cells' values apart by path, or
    // edits a list in one, what's in them isn't the runtime's to read.
    const CELLS = /^host:builtin\.cells\./;
    const otherCells = funcs.some((f) => { const w = (e: SExpr): boolean => (e.k === "rt" && CELLS.test(e.fn) && !CELL_PUT.test(e.fn) && !CELL_READ.test(e.fn)) || kids(e).some(w); return w(f.body); });
    const scanX = (f: SFunc, e: SExpr) => {
      const held = e.k === "rt" && !otherCells && (CELL_PUT.test(e.fn) || CELL_READ.test(e.fn));
      if ((e.k === "rt" || e.k === "world") && !held) {
        // What the runtime gives is its own: only the program's values
        // need a type at hand.
        for (const a of e.args) { const t = typeOf(f, a); if (t) expose(t); else if (a.k !== "rt" && a.k !== "world") unknown = true; }
        expose(e.k === "rt" ? e.host?.t : e.t);
        if (e.k === "world") e.ins?.forEach((t) => expose(t));
      }
      if (e.k === "search") { expose(e.t); expose(e.bt); }
      kids(e).forEach((x) => scanX(f, x));
    };
    funcs.forEach((f) => scanX(f, f.body));
    for (const r of roots) { funcs[r].params.forEach((p) => expose(p)); expose(funcs[r].result); }
    for (const t of ir.fns) if (wide.has(fkey(t)) || t.several || t.chooses || t.answer) expose(t);
    for (const t of ir.records) if (t.mutable) expose(t);
    ir.arrays.forEach((t) => expose(t)); ir.tables.forEach((t) => expose(t)); ir.escapes.forEach((t) => expose(t));
    funcs.forEach((f) => { if (f.multi) { f.params.forEach((p) => expose(p)); expose(f.result); if (f.answer) expose(f.answer); } });

    if (!unknown) {
      // What every value of each record and data type may be, over the
      // whole program.
      const joined = new Map<string, Abs>();
      groups.forEach((i, n) => {
        const f = funcs[i.fn];
        for (const [e, a] of reads[n].values) { const t = typeOf(f, e); if (isCont(t)) joined.set(t.key, join(joined.has(t.key) ? joined.get(t.key)! : null, a)); }
      });
      // Every record and data type object, by key.
      const objs = new Map<string, (RType | DType)[]>();
      const seenT = new Set<object>();
      const collect = (t: LType | null | undefined): void => {
        if (!t || typeof t !== "object" || seenT.has(t)) return;
        seenT.add(t);
        if (isFn(t)) { t.params.forEach((p) => collect(p)); collect(t.result); return; }
        if (isCont(t)) (objs.get(t.key) ?? objs.set(t.key, []).get(t.key)!).push(t);
        if (isRecord(t)) t.fields.forEach((x) => collect(x.t));
        else if (isData(t)) t.cases.forEach((c) => c.fields.forEach((x) => collect(x.t)));
        else if ("item" in t) collect(t.item);
        else if ("keyT" in t) { collect(t.keyT as LType); collect(t.value); }
      };
      const collectE = (e: SExpr) => {
        if ("t" in e && typeof e.t === "object") collect(e.t as LType);
        if (e.k === "case") collect(e.result);
        if (e.k === "rt") collect(e.host?.t);
        kids(e).forEach(collectE);
      };
      ir.records.forEach((t) => collect(t)); ir.data.forEach((t) => collect(t)); ir.fns.forEach((t) => collect(t));
      ir.shapes.forEach((s) => s.caps.forEach((t) => collect(t)));
      out.forEach((f) => { f.params.forEach((t) => collect(t)); f.locals.forEach((t) => collect(t)); collect(f.result); collectE(f.body); });
      // Their fields' records, from what was put there.
      const sets: [{ t: LType }, RType][] = [];
      for (const [k, list] of objs) {
        if (exposed.has(k) || !joined.has(k)) continue;
        const J = joined.get(k)!, t0 = list[0];
        if (isRecord(t0)) t0.fields.forEach((x, i) => { const A = baseOf(x.t); if (A) for (const o of list) sets.push([(o as RType).fields[i], narrow(A, maskOf(fieldOf(J, i), A))]); });
        else t0.cases.forEach((c, ci) => c.fields.forEach((x, i) => { const A = baseOf(x.t); if (A) for (const o of list) sets.push([(o as DType).cases[ci].fields[i], narrow(A, maskOf(caseField(J, ci, i), A))]); }));
      }
      for (const [x, t] of sets) x.t = t;
      // A closure's captures, from what every closure of its shape
      // captured; the runtime's closures (its solver reads them) keep all.
      ir.shapes = ir.shapes.map((s, si) => (wide.has(fkey(s.t)) ? s : { ...s, caps: s.caps.map((t, i) => { const A = baseOf(t); return A ? narrow(A, maskOf(caps[si][i], A)) : t; }) }));
      // A function type's inputs and answer, from every closure code of it.
      const fnSig = new Map<string, { params: LType[]; result: LType }>();
      const codeKey = new Map<number, string>();
      for (const [k, codes] of codesOf) {
        const cs = [...codes], g = funcs[cs[0]];
        cs.forEach((c) => codeKey.set(c, k));
        const ft = ir.fns.find((t) => fkey(t) === k);
        const whole = wide.has(k) || !ft || ft.several || ft.chooses || ft.answer || cs.some((c) => funcs[c].multi || funcs[c].params.length !== g.params.length);
        const of = (t: LType, pick: (i: Inst) => Abs): LType => {
          const A = baseOf(t);
          if (!A || whole) return t;
          let a: Abs = null;
          for (const c of cs) { const i = byKey.get(`c${c}`); if (i) a = join(a, pick(i)); }
          return narrow(A, maskOf(a, A));
        };
        fnSig.set(k, { params: g.params.slice(1).map((p, j) => of(p, (i) => i.params[j + 1] ?? null)), result: of(g.result, (i) => i.result) });
      }
      // Each copy's inputs and answer.
      for (const i of groups) {
        const f = out[i.index];
        if ((roots.includes(i.fn) && i.index === i.fn) || f.multi || f.value) continue;
        const k = codeKey.get(i.fn);
        if (k !== undefined) {
          const s = fnSig.get(k)!;
          out[i.index] = { ...f, params: [f.params[0], ...s.params], result: s.result };
          continue;
        }
        const of = (t: LType, a: Abs) => { const A = baseOf(t); return A ? narrow(A, maskOf(a, A)) : t; };
        out[i.index] = { ...f, params: f.params.map((p, j) => of(p, i.params[j] ?? null)), result: of(f.result, i.result) };
      }

      // Every body, given those: each value's record, and a copy where
      // two meet.
      const narrowBody = (f: SFunc): SFunc => {
        const locals = f.locals.map((t, j) => (j < f.params.length ? f.params[j] : t));
        const base = locals.length;
        // Locals set by a let (or an attempt's or a budget's answer):
        // their record is what they're set to.
        const letLike = new Set<number>();
        const scanL = (e: SExpr) => {
          const i = e.k === "let" ? e.i : e.k === "attempt" || e.k === "budget" ? e.res : -1;
          if (i >= f.params.length && baseOf(locals[i])) letLike.add(i);
          kids(e).forEach(scanL);
        };
        scanL(f.body);
        const lr = new Map<number, RType>();
        type R = RType | null | undefined;
        const J = (a: R, b: R): R => (a === undefined ? b : b === undefined ? a : a === null ? b : b === null ? a : a.key === b.key ? a : narrow(baseOf(a)!, maskOfT(a) | maskOfT(b)));
        const alg = (t: LType | null | undefined): R => (baseOf(t) ? (t as RType) : undefined);
        let memo = new WeakMap<SExpr, R>();
        const ty = (e: SExpr): R => {
          if (memo.has(e)) return memo.get(e);
          const r = ty0(e);
          memo.set(e, r);
          return r;
        };
        const ty0 = (e: SExpr): R => {
          switch (e.k) {
            case "local": return letLike.has(e.i) ? lr.get(e.i) ?? null : alg(locals[e.i]);
            case "make": return alg(e.t);
            case "get": return alg(e.t.fields[e.i]?.t);
            case "field": return alg(e.t.cases[e.c]?.fields[e.i]?.t);
            case "call": return alg(out[e.fn].result);
            case "apply": return alg(fnSig.get(fkey(e.t))?.result ?? e.t.result);
            case "cap": return alg(ir.shapes[e.shape].caps[e.i]);
            case "let": return ty(e.body);
            case "if": return J(ty(e.then), ty(e.else));
            case "case": return e.arms.reduce<R>((r, a) => (a ? J(r, ty(a)) : r), null);
            case "attempt": return J(ty(e.ok), ty(e.otherwise));
            case "budget": return J(ty(e.body), ty(e.otherwise));
            case "handle": return J(ty(e.body), ty(e.arm));
            case "released": return ty(e.body);
            case "set": return ty(e.then);
            case "rt": return alg(e.host?.t);
            case "world": return alg(e.t);
            case "zero": return alg(e.t);
            case "fail": case "abort": return null;
            default: return undefined;
          }
        };
        // e as a value of record `to`.
        const conv = (e: SExpr, to: LType | null | undefined): SExpr => {
          const A = baseOf(to);
          if (!A) return e;
          const from = ty(e);
          if (!from || from.key === (to as RType).key) return e;
          const mf = maskOfT(from), mt = maskOfT(to as RType), into = narrow(A, mt);
          const bits: number[] = [];
          for (let j = 0; j < A.fields.length; j++) if ((mt >> j) & 1) bits.push(j);
          // Made right here: its parts, when what's left out is only 0s.
          const had: number[] = [];
          for (let j = 0; j < A.fields.length; j++) if ((mf >> j) & 1) had.push(j);
          if (e.k === "make" && e.args.every((x, n) => x.k === "num" || (mt >> had[n]) & 1)) {
            return { k: "make", t: into, args: bits.map((j) => ((mf >> j) & 1 ? e.args[pos(mf, j)] : { k: "num", v: 0 })) };
          }
          const parts = (x: SExpr): SExpr[] => bits.map((j) => ((mf >> j) & 1 ? { k: "get", rec: x, t: from, i: pos(mf, j) } : { k: "num", v: 0 }));
          if (e.k === "local") return { k: "make", t: into, args: parts(e) };
          const tmp = locals.push(from) - 1;
          return { k: "let", i: tmp, value: e, body: { k: "make", t: into, args: parts({ k: "local", i: tmp }) } };
        };
        let grew = false;
        const setLet = (i: number, v: SExpr) => {
          if (!letLike.has(i)) return;
          const now = J(lr.get(i) ?? null, ty(v));
          if (now && now.key !== lr.get(i)?.key) { lr.set(i, now); grew = true; }
        };
        // An expression with several answers (arms): each into their join.
        const arms = <T extends SExpr>(r: T, t: LType, set: (r: T, to: RType) => T): T => {
          const j = ty(r);
          if (!j || !baseOf(t)) return r;
          return set(r, j);
        };
        const nar = (e: SExpr): SExpr => {
          switch (e.k) {
            case "let": {
              const value = nar(e.value);
              setLet(e.i, value);
              return { ...e, value: letLike.has(e.i) ? conv(value, lr.get(e.i)) : conv(value, locals[e.i]), body: nar(e.body) };
            }
            case "make": {
              const args = e.args.map(nar);
              if (algT(e.t) && !narrowed.has(e.t.key)) {
                let m = 0;
                args.forEach((a, j) => { if (!isZ(a)) m |= 1 << j; });
                return { ...e, t: narrow(e.t, m), args: args.filter((a) => !isZ(a)) };
              }
              return { ...e, args: args.map((a, j) => conv(a, e.t.fields[j]?.t)) };
            }
            case "get": {
              const rec = nar(e.rec);
              const A = baseOf(e.t);
              if (!A) return { ...e, rec };
              const r = ty(rec);
              if (!r) return { ...e, rec };
              const m = maskOfT(r);
              if ((m >> e.i) & 1) return { ...e, rec, t: r, i: pos(m, e.i) };
              if (rec.k === "local" || rec.k === "cap") return { k: "num", v: 0 };
              const tmp = locals.push(r) - 1;
              return { k: "let", i: tmp, value: rec, body: { k: "num", v: 0 } };
            }
            case "new": { const args = e.args.map(nar); return { ...e, args: args.map((a, j) => conv(a, e.t.cases[e.c].fields[j]?.t)) }; }
            case "list": {
              const fs = e.t.cases[e.c].fields;
              const h = fs.findIndex((x) => !(x.t === e.t || (isData(x.t) && x.t.key === e.t.key)));
              if (h >= 0 && baseOf(fs[h].t)) locals[e.item] = fs[h].t;
              return { ...e, items: e.items.map((x) => conv(nar(x), h >= 0 ? fs[h].t : null)) };
            }
            case "set": { const rec = nar(e.rec), value = nar(e.value); return { ...e, rec, value: conv(value, e.t.fields[e.i]?.t), then: nar(e.then) }; }
            case "call": { const g = out[e.fn]; return { ...e, args: e.args.map((a, j) => conv(nar(a), g.params[j])) }; }
            case "closure": { const s = ir.shapes[e.shape]; return { ...e, caps: e.caps.map((a, j) => conv(nar(a), s.caps[j])) }; }
            case "apply": {
              const fn = nar(e.fn), s = fnSig.get(fkey(e.t));
              return { ...e, fn, args: e.args.map((a, j) => (s ? conv(nar(a), s.params[j]) : nar(a))) };
            }
            case "rt": case "world": return { ...e, args: e.args.map((a) => { const x = nar(a), t = ty(x); return t ? conv(x, baseOf(t)) : x; }) } as SExpr;
            case "if": {
              const r = { ...e, cond: nar(e.cond), then: nar(e.then), else: nar(e.else) };
              return arms(r, e.t, (r, to) => ({ ...r, t: to, then: conv(r.then, to), else: conv(r.else, to) }));
            }
            case "case": {
              const r = { ...e, scrut: nar(e.scrut), arms: e.arms.map((a) => a && nar(a)) };
              return arms(r, e.result, (r, to) => ({ ...r, result: to, arms: r.arms.map((a) => a && conv(a, to)) }));
            }
            case "attempt": {
              const body = nar(e.body);
              setLet(e.res, body);
              const r = { ...e, body: letLike.has(e.res) ? conv(body, lr.get(e.res)) : body, ok: nar(e.ok), otherwise: nar(e.otherwise) };
              return arms(r, e.t, (r, to) => ({ ...r, t: to, ok: conv(r.ok, to), otherwise: conv(r.otherwise, to) }));
            }
            case "budget": {
              const body = nar(e.body);
              setLet(e.res, body);
              const r = { ...e, body, otherwise: nar(e.otherwise) };
              // The answer is res's, and the budget's.
              const to = letLike.has(e.res) ? lr.get(e.res) : undefined;
              const r2 = to ? { ...r, body: conv(r.body, to), otherwise: conv(r.otherwise, to), t: to } : r;
              return to ? r2 : arms(r2, e.t, (r, t2) => ({ ...r, t: t2, body: conv(r.body, t2), otherwise: conv(r.otherwise, t2) }));
            }
            case "handle": {
              const r = { ...e, body: nar(e.body), arm: nar(e.arm) };
              return arms(r, e.t, (r, to) => ({ ...r, t: to, body: conv(r.body, to), arm: conv(r.arm, to) }));
            }
            case "released": {
              const r = { ...e, body: nar(e.body), release: nar(e.release) };
              return arms(r, e.t, (r, to) => ({ ...r, t: to }));
            }
            default: return mapKids(e, nar);
          }
        };
        let body = f.body;
        do {
          grew = false;
          locals.length = base;
          memo = new WeakMap();
          body = conv(nar(f.body), f.result);
        } while (grew);
        for (const [i, t] of lr) locals[i] = t;
        return { ...f, locals, body };
      };
      for (let n = 0; n < out.length; n++) out[n] = narrowBody(out[n]);
      // A record of one part is that number (L209): a Complex with no
      // imaginary part is a Float64.
      const one = (t: LType | null | undefined): t is RType => !!t && typeof t === "object" && isRecord(t) && narrowed.has(t.key) && t.fields.length === 1;
      const flat = (t: LType): LType => (one(t) ? "f64" : t);
      const unboxed = (e: SExpr): SExpr => {
        const r = mapKids(e, unboxed);
        switch (r.k) {
          case "make": return one(r.t) ? r.args[0] : r;
          case "get": return one(r.t) ? r.rec : r;
          case "zero": return one(r.t) ? { k: "num", v: 0 } : r;
          case "if": case "budget": case "attempt": case "handle": case "released": case "world": return one(r.t) ? { ...r, t: "f64" } as SExpr : r;
          case "case": return one(r.result) ? { ...r, result: "f64" } : r;
          default: return r;
        }
      };
      if ([...made.values()].some((t) => t.fields.length === 1)) {
        for (const [x] of sets) x.t = flat(x.t);
        ir.shapes = ir.shapes.map((s) => (s.caps.some(one) ? { ...s, caps: s.caps.map(flat) } : s));
        for (let n = 0; n < out.length; n++) { const f = out[n]; out[n] = { ...f, params: f.params.map(flat), locals: f.locals.map(flat), result: flat(f.result), body: unboxed(f.body) }; }
      }
      ir.records = [...ir.records, ...[...made.values()].filter((t) => t.fields.length !== 1)];
    }
  }
  for (const i of groups) out[i.index] = tidied(out[i.index], i.index);
  // A copy that came out the same as a copy given more (its calls made
  // the same first) is that one: nothing was dropped in it.
  const to = new Map<number, number>();
  const at = (n: number): number => { let m = n; while (to.has(m)) m = to.get(m)!; return m; };
  const shape = (e: SExpr): string => JSON.stringify(e, (k, v) => (typeof v === "bigint" ? `${v}n` : k === "fn" && typeof v === "number" ? at(v) : v && typeof v === "object" && "key" in v && !("k" in v) ? v.key : v));
  const wider = (a: Abs[], b: Abs[]) => a.every((x, j) => same(join(x, b[j]), x));
  for (let again = true; again;) {
    again = false;
    for (const [, list] of ofFn) {
      const gs = list.filter((g, n) => groups.includes(g) && list.indexOf(g) === n && !to.has(g.index));
      for (const g of gs) {
        if (g.index === g.fn) continue;
        // The whole function: its inputs' and answer's records too.
        const mine = shape(out[g.index] as unknown as SExpr);
        const w = gs.find((h) => h !== g && !to.has(h.index) && wider(h.params, g.params) && shape(out[h.index] as unknown as SExpr) === mine);
        if (w) { to.set(g.index, w.index); again = true; }
      }
    }
  }
  // Calls to a copy that is another now go there, and copies nothing
  // calls are dropped, the rest numbered again after the program's own.
  const used = new Set<number>(), seen = new Set<number>();
  const visit = (n: number) => { if (seen.has(n)) return; seen.add(n); const walk = (e: SExpr) => { if (e.k === "call" || e.k === "closure") { const m = at(e.fn); if (m >= funcs.length) used.add(m); visit(m); } kids(e).forEach(walk); }; walk(out[n].body); };
  for (let n = 0; n < funcs.length; n++) visit(n);
  const place = new Map<number, number>();
  const kept = [...used].sort((a, b) => a - b);
  kept.forEach((n, j) => place.set(n, funcs.length + j));
  const renumber = (n: number) => { const m = at(n); return m < funcs.length ? m : place.get(m)!; };
  const fix = (e: SExpr): SExpr => { const r = mapKids(e, fix); return r.k === "call" || r.k === "closure" ? { ...r, fn: renumber(r.fn) } : r; };
  const final = [...out.slice(0, funcs.length), ...kept.map((n) => out[n])].map((g) => ({ ...g, body: fix(g.body) }));
  return { ir: { ...ir, funcs: final }, copies: final.length - funcs.length, dropped };
}
