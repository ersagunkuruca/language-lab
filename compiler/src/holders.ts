// One holder, decided per value (C327f, the holders half of
// ALLOCATIONS-2026-11-24's per-value analysis), on the lowered IR every
// printer reads. A `replace at` whose array nobody else can see again is
// written in place (`replaceOwned`), whatever other arrays of its type do.
// one-holder.ts decides by type, for the whole program, so one array of a
// type with two holders keeps every replace of that type a version
// (mnist's gradient beside its parameters, C334).
//
// Two questions, both by the order the code runs:
//
// - **Where the value came from** (its holders on arrival): a new array
//   (`empty`, `of`, a range) has one; a replace, push or push front gives
//   back the one it was given; a record made here holds what it was made
//   of, field by field; a call gives what its function gives back on every
//   path; a parameter has what every call of its function gives it, when
//   its only callers are direct calls in the program. Anything else
//   (read out of data, captured, from the runtime or the world) may have
//   more than one.
// - **Whether the local holding it is used once** (linear, with borrows):
//   a local may be read (an item, a length, given to a function that only
//   reads it) any number of times, then given away once (replaced, put in
//   data, given to a function that keeps or changes it, answered); nothing
//   may use it after. A record taken apart gives each field away
//   separately. The two arms of an `if` or a match are separate paths;
//   everything else (a search's body and what it does otherwise, a
//   handler and its body) is one path, so a value changed in a search
//   that ran out isn't read again by what is tried next.
//
// Values start as having one holder and only move to more (a fixpoint, as
// in Perceus's and Lean 4's borrow inference over a program's functions).

import { isArray, isData, isFn, isRecord, kids, type CoreIR, type LType, type SExpr, type SFunc } from "./scalar.ts";

// The abstract holders of a value: one ("U"), maybe more ("S"), not yet
// known ("T", the start of the fixpoint), or a record's, field by field.
type AV = "T" | "U" | "S" | { f: AV[] };

const meet = (a: AV, b: AV): AV => {
  if (a === "T") return b;
  if (b === "T") return a;
  if (a === "S" || b === "S") return "S";
  if (a === "U" && b === "U") return "U";
  if (typeof a === "object" && typeof b === "object" && a.f.length === b.f.length) return { f: a.f.map((x, i) => meet(x, b.f[i])) };
  return "S";
};
const same = (a: AV, b: AV): boolean => (typeof a === "object" && typeof b === "object" ? a.f.length === b.f.length && a.f.every((x, i) => same(x, b.f[i])) : a === b);

const ARRAY_OP = /^array\.(\w+)\.a\d+$/;
// Only reading the array given first.
// A rest, a drop or a slice is another view on the buffer, which a replace
// in place sees (the runtime marks the buffer shared when it's made).
const READS = new Set(["length", "lengthb", "get", "getb", "at", "atb", "first", "items", "has", "peek", "rest", "drop", "slice"]);
// The runtime's maps on the threads (core-js.ts map.worth, map.pure, and
// c.ts's par:*) read the array they're given and make a new one.
const READS_RT = /^(map\.(worth|pure)$|par:)/;
// Making a new one.
const MAKES = new Set(["empty", "of", "ofItems", "from", "range", "rangeF", "concat"]);
// Giving back the one given first, changed.
const PASSES = new Set(["replaceAt", "replaceOwned", "push", "pushOwned", "pushFront", "pushFrontOwned"]);
const op = (e: SExpr): string | null => (e.k === "rt" ? ARRAY_OP.exec(e.fn)?.[1] ?? null : null);

export interface Holders {
  // The replaces whose array has one holder.
  owned: Set<SExpr>;
  // Whether what function i is given as input j always has one holder.
  one: (i: number, j: number) => boolean;
}

// takes: functions whose first input is to be counted as given away, not
// read (owned-arrays.ts's maps, asking whether each map could write into
// the array it was given).
export function holders(ir: CoreIR, roots: number[] = [], takes = new Set<number>()): Holders {
  const { funcs } = ir;
  // Functions only called directly: their parameters come from their
  // calls. Others (roots, closures' code, the runtime's) get anything.
  const outside = new Set<number>(roots);
  const called = new Set<number>();
  // Function types whose closures the runtime, the world or a root may be
  // handed (so may call): any type inside what they're given.
  const loose = new Set<string>();
  const seen = new Set<object>();
  const looseIn = (t: LType | null | undefined): void => {
    if (!t || typeof t !== "object" || seen.has(t)) return;
    seen.add(t);
    if (isFn(t)) { loose.add(t.key); t.params.forEach(looseIn); looseIn(t.result); return; }
    if (isRecord(t)) t.fields.forEach((x) => looseIn(x.t));
    else if (isData(t)) t.cases.forEach((c) => c.fields.forEach((x) => looseIn(x.t)));
    else if ("item" in t) looseIn(t.item);
    else if ("keyT" in t) { looseIn(t.keyT as LType); looseIn(t.value); }
  };
  // Each closure code's type.
  const codeOf = new Map<number, string>();
  const scan = (g: SFunc, e: SExpr) => {
    if (e.k === "call") called.add(e.fn);
    if (e.k === "closure") { codeOf.set(e.fn, e.t.key); if (e.d !== undefined) outside.add(e.d); }
    if (e.k === "rt") for (const m of e.fn.matchAll(/:(\d+)/g)) outside.add(Number(m[1]));
    if (e.k === "rt" || e.k === "world") {
      for (const a of e.args) { if (a.k === "closure") loose.add(a.t.key); else if (a.k === "local") looseIn(g.locals[a.i]); else loose.add("*"); }
      if (e.k === "world") looseIn(e.t);
    }
    kids(e).forEach((k) => scan(g, k));
  };
  funcs.forEach((g) => scan(g, g.body));
  for (const r of roots) { funcs[r]?.params.forEach(looseIn); looseIn(funcs[r]?.result); }
  const away = new Set([...(ir.awayMaps ?? []).map((a) => a.fn), ...(ir.threadSites ?? []).map((t) => t.at)]);
  // A closure's code is called only by the program's applies when its type
  // is never handed out: its inputs are what those give.
  const inner = (k: string) => !loose.has("*") && !loose.has(k);
  funcs.forEach((g, i) => {
    const code = codeOf.get(i);
    if (code !== undefined ? !inner(code) || called.has(i) : !called.has(i)) outside.add(i);
    if (away.has(g.def)) outside.add(i);
  });
  // The codes of each type the program's applies run.
  const codes = new Map<string, number[]>();
  for (const [c, k] of codeOf) (codes.get(k) ?? codes.set(k, []).get(k)!).push(c);

  // Parameters a function never looks at: not used, or only handed on to
  // its own calls of itself in the same place (a fold's input it ignores).
  const dead = funcs.map((g, i) => {
    const live = new Set<number>();
    const look = (e: SExpr) => {
      if (e.k === "local") live.add(e.i);
      if (e.k === "call" && e.fn === i) { e.args.forEach((a, j) => { if (!(a.k === "local" && a.i === j)) look(a); }); return; }
      kids(e).forEach(look);
    };
    look(g.body);
    return g.params.map((_, j) => !live.has(j));
  });
  // Which parameters a function only reads (borrows), to a fixpoint.
  const reads = funcs.map((g, i) => g.params.map((_, j) => !(j === 0 && takes.has(i))));
  // Each function's locals (whole) and record locals' fields used once.
  const once = funcs.map((g) => g.locals.map(() => true));
  const fieldOnce = funcs.map(() => new Map<string, boolean>());
  const params: AV[][] = funcs.map((g, i) => g.params.map((_, j) => (outside.has(i) || (codeOf.has(i) && j === 0) ? "S" : "T")));
  const results: AV[] = funcs.map(() => "T");

  let changed = true;
  const linear = (self: number) => {
    const g = funcs[self], whole = once[self], fields = fieldOnce[self];
    // State on a path: locals given away whole, and fields given away.
    type St = { gone: Set<number>; took: Set<string> };
    const off = (i: number) => { if (whole[i]) { whole[i] = false; changed = true; } };
    const offF = (k: string) => { if (fields.get(k) !== false) { fields.set(k, false); changed = true; } };
    const tookAny = (s: St, i: number) => [...s.took].filter((k) => k.startsWith(`${i}.`));
    const borrow = (i: number, s: St) => { if (s.gone.has(i)) off(i); for (const k of tookAny(s, i)) offF(k); };
    const give = (i: number, s: St) => { borrow(i, s); s.gone.add(i); };
    // A local given as two inputs of one call: the callee could read one
    // after changing the other.
    const twice = (xs: SExpr[], to?: number) => {
      const seen = new Set<number>();
      xs.forEach((x, j) => { if (x.k === "local" && !(to !== undefined && dead[to]?.[j])) { if (seen.has(x.i)) off(x.i); seen.add(x.i); } });
    };
    const walk = (e: SExpr, s: St, read: boolean): void => {
      switch (e.k) {
        case "local": return read ? borrow(e.i, s) : give(e.i, s);
        case "get": {
          if (e.rec.k === "local") { const k = `${e.rec.i}.${e.i}`; if (s.gone.has(e.rec.i) || s.took.has(k)) offF(k); s.took.add(k); return; }
          return walk(e.rec, s, false);
        }
        case "if": case "case": {
          walk(e.k === "if" ? e.cond : e.scrut, s, e.k === "if");
          const arms = e.k === "if" ? [e.then, e.else] : e.arms.filter((a): a is SExpr => !!a);
          const ends = arms.map((a) => { const t = { gone: new Set(s.gone), took: new Set(s.took) }; walk(a, t, false); return t; });
          for (const t of ends) { t.gone.forEach((x) => s.gone.add(x)); t.took.forEach((x) => s.took.add(x)); }
          return;
        }
        case "op": for (const a of e.args) walk(a, s, true); return;
        case "rt": { const o = op(e), r = (o !== null && READS.has(o)) || READS_RT.test(e.fn); twice(e.args); inputs(e.args.map((a) => [a, r]), s); return; }
        // An input the callee never looks at isn't a use (a local there
        // may be given away beside it).
        case "call": twice(e.args, e.fn); inputs(e.args.flatMap((a, j): [SExpr, boolean][] => (dead[e.fn]?.[j] && a.k === "local" ? [] : [[a, (reads[e.fn]?.[j] ?? false) || !!dead[e.fn]?.[j]]])), s); return;
        case "apply": twice([e.fn, ...e.args]); inputs(kids(e).map((k) => [k, false]), s); return;
        default: for (const k of kids(e)) walk(k, s, false);
      }
    };
    // A call's inputs, in order, but a local given whole is given when
    // the call runs, after every input is worked out: `replace(a, i,
    // item at(a, i))` reads a before giving it.
    const inputs = (xs: [SExpr, boolean][], s: St) => {
      for (const [a, read] of xs) if (read || a.k !== "local") walk(a, s, read);
      for (const [a, read] of xs) if (!read && a.k === "local") walk(a, s, false);
    };
    walk(g.body, { gone: new Set(), took: new Set() }, false);
    // A parameter only borrowed: never given away whole nor in part.
    const given = new Set<number>();
    const gives = (e: SExpr, read: boolean): void => {
      switch (e.k) {
        case "local": if (!read) given.add(e.i); return;
        case "get": if (e.rec.k === "local") { given.add(e.rec.i); return; } return gives(e.rec, false);
        case "if": gives(e.cond, true); gives(e.then, false); gives(e.else, false); return;
        case "op": for (const a of e.args) gives(a, true); return;
        case "rt": { const o = op(e), r = (o !== null && READS.has(o)) || READS_RT.test(e.fn); e.args.forEach((a) => gives(a, r)); return; }
        case "call": e.args.forEach((a, j) => gives(a, reads[e.fn]?.[j] ?? false)); return;
        default: for (const k of kids(e)) gives(k, false);
      }
    };
    gives(g.body, false);
    g.params.forEach((_, j) => { if (reads[self][j] && given.has(j)) { reads[self][j] = false; changed = true; } });
  };

  // The holders of e's value, with env the locals'.
  const av = (self: number, e: SExpr, env: AV[], at: (e: SExpr, v: AV) => void): AV => {
    const whole = once[self], fields = fieldOnce[self];
    const v = ((): AV => {
      switch (e.k) {
        case "local": return whole[e.i] ? env[e.i] ?? "S" : "S";
        case "let": env[e.i] = av(self, e.value, env, at); return av(self, e.body, env, at);
        case "if": av(self, e.cond, env, at); return meet(av(self, e.then, env, at), av(self, e.else, env, at));
        case "case": {
          av(self, e.scrut, env, at); env[e.s] = "S";
          return e.arms.reduce<AV>((m, a) => (a ? meet(m, av(self, a, env, at)) : m), "T");
        }
        case "get": {
          if (e.rec.k === "local") {
            const r = whole[e.rec.i] || fields.get(`${e.rec.i}.${e.i}`) !== false ? env[e.rec.i] : "S";
            // Not known yet: its fields aren't either.
            if (r === "T") return "T";
            return fields.get(`${e.rec.i}.${e.i}`) !== false && typeof r === "object" ? r.f[e.i] ?? "S" : "S";
          }
          const r = av(self, e.rec, env, at);
          return r === "T" ? "T" : typeof r === "object" ? r.f[e.i] ?? "S" : "S";
        }
        case "make": return { f: e.args.map((a) => av(self, a, env, at)) };
        // No value: the other paths decide.
        case "fail": case "abort": kids(e).forEach((k) => av(self, k, env, at)); return "T";
        case "call": {
          const xs = e.args.map((a) => av(self, a, env, at));
          xs.forEach((x, j) => { const p = params[e.fn]; if (p && !outside.has(e.fn)) { const m = meet(p[j], reads[e.fn][j] ? "S" : x); if (!same(m, p[j])) { p[j] = m; changed = true; } } });
          // A definition with no inputs is worked out once and kept, unless
          // it gives an array of a type something writes in place (core-js.ts
          // and wasm.ts `written`): made again at each call.
          return funcs[e.fn]?.params.length || (funcs[e.fn] && isArray(funcs[e.fn].result)) ? results[e.fn] : "S";
        }
        case "apply": {
          av(self, e.fn, env, at);
          const xs = e.args.map((a) => av(self, a, env, at));
          const cs = inner(e.t.key) ? codes.get(e.t.key) ?? [] : [];
          for (const c of cs) xs.forEach((x, j) => { const p = params[c]; if (p && !outside.has(c) && j + 1 < p.length) { const m = meet(p[j + 1], x); if (!same(m, p[j + 1])) { p[j + 1] = m; changed = true; } } });
          return cs.length ? cs.reduce<AV>((m, c) => meet(m, results[c]), "T") : "S";
        }
        case "rt": {
          const xs = e.args.map((a) => av(self, a, env, at));
          const o = op(e);
          return o !== null && MAKES.has(o) ? "U" : o !== null && PASSES.has(o) ? xs[0] : "S";
        }
        default: kids(e).forEach((k) => av(self, k, env, at)); return "S";
      }
    })();
    at(e, v);
    return v;
  };
  const body = (i: number, at: (e: SExpr, v: AV) => void) => {
    const g: SFunc = funcs[i];
    const env: AV[] = g.locals.map((_, j) => (j < g.params.length ? params[i][j] : "S"));
    return av(i, g.body, env, at);
  };
  // What each function only reads, and which locals are used once, first:
  // they don't hang on holders, and a parameter taken as only read while
  // that was still being worked out would count what it's given as shared
  // for good (moths' `filed`, given a new grid each tick).
  for (let rounds = 0; changed && rounds < 100; rounds++) {
    changed = false;
    funcs.forEach((_, i) => linear(i));
  }
  const none: Holders = { owned: new Set(), one: () => false };
  if (changed) return none;
  changed = true;
  for (let rounds = 0; changed && rounds < 100; rounds++) {
    changed = false;
    funcs.forEach((_, i) => {
      const r = meet(results[i], body(i, () => {}));
      if (!same(r, results[i])) { results[i] = r; changed = true; }
    });
  }
  // Each replace's array, as the fixpoint left it: it has one holder when
  // it arrived with one and the replace is the last that uses it.
  const owned = new Set<SExpr>();
  if (changed) return none;
  const vals = new Map<SExpr, AV>();
  funcs.forEach((_, i) => body(i, (e, v) => vals.set(e, v)));
  funcs.forEach((g) => {
    const look = (e: SExpr) => {
      if ((op(e) === "replaceAt" || op(e) === "push") && e.k === "rt" && vals.get(e.args[0]) === "U") owned.add(e);
      kids(e).forEach(look);
    };
    look(g.body);
  });
  return { owned, one: (i, j) => params[i]?.[j] === "U" };
}

// The replaces holders() finds, made `replaceOwned`, and the pushes it
// finds, marked for ownPushes to make `pushOwned` once columns.ts has read
// them as pushes (an array built by pushes may become columns); how many.
export function ownedPerValue(ir: CoreIR, roots: number[]): number {
  const owned = holders(ir, roots).owned;
  for (const e of owned) if (e.k === "rt") { if (op(e) === "push") e.own = true; else e.fn = e.fn.replace("array.replaceAt.", "array.replaceOwned."); }
  return owned.size;
}

// Those pushes, where they are still pushes onto an array (not made
// columns' own), as copied by the passes since.
export function ownPushes(ir: CoreIR): void {
  const look = (e: SExpr): void => { if (e.k === "rt" && e.own && op(e) === "push") e.fn = e.fn.replace("array.push.", "array.pushOwned."); kids(e).forEach(look); };
  ir.funcs.forEach((g) => look(g.body));
}
