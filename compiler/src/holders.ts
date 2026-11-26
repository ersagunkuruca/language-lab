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
//   its only callers are direct calls in the program. An array has its
//   items' holders too, as a list does: an item read from a slot that is
//   then replaced (a map in place) has what the array gave it. Anything else
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

import { isArray, isTable, isData, isFn, isRecord, kids, type CoreIR, type LType, type SExpr, type SFunc } from "./scalar.ts";

// The abstract holders of a value: one ("U"), maybe more ("S"), not yet
// known ("T", the start of the fixpoint), a record's, field by field, or
// a value of a data type (a list) with one holder, `it` what is in it
// (each item, and whatever its cases hold but more of the type).
type AV = "T" | "U" | "S" | { f: AV[] } | { it: AV };
// (An array with one holder is { it }, what its items have.)

const meet = (a: AV, b: AV): AV => {
  if (a === "T") return b;
  if (b === "T") return a;
  if (a === "S" || b === "S") return "S";
  if (a === "U" && b === "U") return "U";
  if (typeof a === "object" && typeof b === "object") {
    if ("f" in a && "f" in b && a.f.length === b.f.length) return { f: a.f.map((x, i) => meet(x, b.f[i])) };
    if ("it" in a && "it" in b) return { it: meet(a.it, b.it) };
  }
  return "S";
};
const same = (a: AV, b: AV): boolean => {
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if ("f" in a && "f" in b) return a.f.length === b.f.length && a.f.every((x, i) => same(x, b.f[i]));
  return "it" in a && "it" in b && same(a.it, b.it);
};
// Kept a few levels deep: a type holding another that holds it would
// nest without end.
const capped = (v: AV, n = 6): AV => (typeof v !== "object" ? v : n === 0 ? "S" : "f" in v ? { f: v.f.map((x) => capped(x, n - 1)) } : { it: capped(v.it, n - 1) });
// What a call may lend its answer, as the caller then knows it shared: a
// local, or a local's field.
const lendable = (a: SExpr) => a.k === "local" || ((a.k === "get" || a.k === "field") && a.rec.k === "local");
const fieldsOf = (r: AV): AV[] | null => (typeof r === "object" && "f" in r ? r.f : null);
// One holder: a table's, or an array's (with what its items have).
const one = (v: AV | undefined) => v === "U" || (typeof v === "object" && "it" in v);
const uses = (e: SExpr, a: number): boolean => (e.k === "local" && e.i === a) || kids(e).some((k) => uses(k, a));
// Whether e replaces the item at local j of local a before anything else
// happens to a, on every path: through lets, and a call's inputs, the
// replace one of them and a in no other.
const replacedAt = (e: SExpr, a: number, j: number): boolean => {
  const at = (x: SExpr) => x.k === "rt" && (op(x) === "replaceAt" || op(x) === "replaceOwned") && x.args[0]?.k === "local" && x.args[0].i === a && x.args[1]?.k === "local" && x.args[1].i === j && !x.args.slice(1).some((y) => uses(y, a));
  if (at(e)) return true;
  if (e.k === "let") return !uses(e.value, a) && replacedAt(e.body, a, j);
  if (e.k === "call") { const ks = e.args.filter((x) => uses(x, a)); return ks.length === 1 && replacedAt(ks[0], a, j); }
  return false;
};

// Holding nothing written in place (no array, table or record, in it or
// in what it holds): it may be held anywhere (a number, a text, a list of
// texts, a function, whose captures are read as shared).
const writable = (t: LType, seen: Set<object>): boolean => {
  if (typeof t !== "object") return t === "host";
  if (isArray(t) || isTable(t) || isRecord(t)) return true;
  if (!isData(t) || seen.has(t)) return false;
  seen.add(t);
  return t.cases.some((c) => c.fields.some((x) => writable(x.t, seen)));
};
const plainOf = new Map<LType, boolean>();
const plain = (t: LType | undefined) => {
  if (t === undefined) return false;
  let p = plainOf.get(t);
  if (p === undefined) plainOf.set(t, (p = !writable(t, new Set())));
  return p;
};

const flat = (t: LType | undefined) => t !== undefined && isRecord(t) && t.fields.every((x) => plain(x.t));
// The local a record is made from fields of, when every field of its type
// it is given is that local's.
const fieldOf = (a: SExpr, key: string, y?: number) => a.k === "get" && a.t.key === key && a.rec.k === "local" && (y === undefined || a.rec.i === y);
const rebuilds = (e: SExpr & { k: "make" }): number | null => {
  const ys = e.args.flatMap((a) => (a.k === "get" && a.t.key === e.t.key ? [a.rec.k === "local" ? a.rec.i : -1] : []));
  return ys.length && ys.every((y) => y >= 0 && y === ys[0]) ? ys[0] : null;
};

const ARRAY_OP = /^array\.(\w+)\.a\d+$/;
// Only reading the array given first.
// A rest, a drop or a slice is another view on the buffer, which a replace
// in place sees (the runtime marks the buffer shared when it's made).
const READS = new Set(["length", "lengthb", "get", "getb", "at", "atb", "first", "items", "has", "peek", "rest", "drop", "slice", "t:has", "t:size", "t:at", "t:atb", "t:atv", "t:entries", "t:keys"]);
// The runtime's maps on the threads (core-js.ts map.worth, map.pure, and
// c.ts's par:*) read the array they're given and make a new one.
const READS_RT = /^(map\.(worth|pure)$|par:)/;
// Making a new one.
<<<<<<< HEAD
const MAKES = new Set(["empty", "of", "ofItems", "from", "range", "rangeF", "concat", "stridedProducts", "stridedProductsDual", "t:empty"]);
=======
const MAKES = new Set(["empty", "of", "ofItems", "from", "range", "rangeF", "concat", "stridedProducts", "t:empty"]);
>>>>>>> 5573bc27365828e137347a2a6e8d8b70b76d1540
// Giving back the one given first, changed.
const PASSES = new Set(["replaceAt", "replaceOwned", "push", "pushOwned", "pushFront", "pushFrontOwned", "t:put", "t:remove", "t:putOwned", "t:removeOwned"]);
// A table's (a map's or a hash set's, C63h) runtime functions, as `t:…`:
// a put or a remove gives back the table it was given, changed; the rest
// read it (an old version read again is rerooted, std.ts, but reads as
// it did).
const TABLE_OP = /^table\.(\w+)\.t\d+(?:\.e\d+)?(?:\.a\d+)?$/;
const op = (e: SExpr): string | null => {
  if (e.k !== "rt") return null;
  const a = ARRAY_OP.exec(e.fn);
  if (a) return a[1];
  const t = TABLE_OP.exec(e.fn);
  return t ? `t:${t[1]}` : null;
};

export interface Holders {
  // The replaces, pushes, puts and removes whose array or table has one
  // holder, the last to use it.
  owned: Set<SExpr>;
  // Whether what function i is given as input j always has one holder.
  one: (i: number, j: number) => boolean;
  // The records made from fields of one local of their type that has one
  // holder, none of those fields read again (owned-records.ts writes such
  // a make into the local when it is last in its function).
  into: Set<SExpr>;
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
  // What a value handed out may hold, from what it is made of: a
  // closure, or any of the types of the locals, calls and fields it reads
  // (a literal holds none; what the runtime or the world gives is theirs).
  const handed = (g: SFunc, a: SExpr): void => {
    switch (a.k) {
      case "closure": loose.add(a.t.key); return;
      case "local": return looseIn(g.locals[a.i]);
      case "call": return looseIn(funcs[a.fn]?.result);
      case "apply": return looseIn(a.t.result);
      case "get": return looseIn(a.t.fields[a.i]?.t);
      case "field": return looseIn(a.t.cases[a.c]?.fields[a.i]?.t);
      case "cap": return looseIn(ir.shapes[a.shape]?.caps[a.i]);
      case "let": return handed(g, a.body);
      case "if": handed(g, a.then); return handed(g, a.else);
      case "case": a.arms.forEach((x) => x && handed(g, x)); return;
      // Made by the runtime from what it was given, already counted.
      case "rt": case "world": case "op": return;
    }
    kids(a).forEach((k) => handed(g, k));
  };
  const unreached = new Set<number>();
  // Definitions a printer runs by their sites.
  const sited = new Set<string>([...(ir.drawSites ?? []).flatMap((d) => [d.at, d.vertex, d.fragment]), ...(ir.sharedSites ?? []).map((d) => d.at), ...(ir.nearSites ?? []).map((d) => d.at)].filter((x): x is string => !!x));
  // Each closure code's type.
  const codeOf = new Map<number, string>();
  // The functions each function's `both`s run.
  const bothOf = new Map<number, number[]>();
  // Who looks at what each function works out (its calls' callers, a
  // closure code's makers and appliers, a `both`'s), to work only on what
  // a change reaches.
  const callers = funcs.map(() => new Set<number>());
  const applies = funcs.map(() => new Set<string>());
  const edges = funcs.map((): number[] => []);
  const codesOf = (k: string) => [...codeOf].flatMap(([c, t]) => (t === k ? [c] : []));
  const scan = (g: SFunc, e: SExpr, self = funcs.indexOf(g)) => {
    if (e.k === "rt" && e.fn === "both.pure") { const c = e.args[0]; (bothOf.get(self) ?? bothOf.set(self, []).get(self)!).push(c?.k === "closure" ? c.fn : -1); if (c?.k === "closure") callers[c.fn]?.add(self); }
    if (e.k === "call") { called.add(e.fn); callers[e.fn]?.add(self); edges[self]?.push(e.fn); }
    if (e.k === "apply") applies[self].add(e.t.key);
    if (e.k === "closure") { codeOf.set(e.fn, e.t.key); callers[e.fn]?.add(self); edges[self]?.push(e.fn); if (e.d !== undefined) outside.add(e.d); }
    // A function the runtime is handed by its number (a whole part of the
    // name: not the digits an id starts with, as `handleK:8li2…`).
    if (e.k === "rt") for (const m of e.fn.matchAll(/:(\d+)(?=:|$)/g)) outside.add(Number(m[1]));
    if (e.k === "rt" || e.k === "world") {
      for (const a of e.args) handed(g, a);
      if (e.k === "world") looseIn(e.t);
    }
    kids(e).forEach((k) => scan(g, k, self));
  };
  funcs.forEach((g) => scan(g, g.body));
  for (const r of roots) { funcs[r]?.params.forEach(looseIn); looseIn(funcs[r]?.result); }
  const away = new Set([...(ir.awayMaps ?? []).map((a) => a.fn), ...(ir.threadSites ?? []).map((t) => t.at)]);
  // A closure's code is called only by the program's applies when its type
  // is never handed out: its inputs are what those give.
  const inner = (k: string) => !loose.has("*") && !loose.has(k);
  // Reached from the roots (and what the runtime, the threads and the
  // printers run) by calls, closures made and `both`s: a function only
  // its own copies call (a map's fold left unused by its specialised copy)
  // gives nothing to a closure's code.
  const reach = new Set<number>();
  if (roots.length) {
    const todo = funcs.flatMap((g, i) => (outside.has(i) || away.has(g.def) || sited.has(g.def) ? [i] : []));
    for (const r of todo) reach.add(r);
    while (todo.length) {
      const i = todo.pop()!;
      for (const c of edges[i] ?? []) if (!reach.has(c)) { reach.add(c); todo.push(c); }
      // A closure's code is run by the applies of its type.
      for (const k of applies[i]) for (const c of codesOf(k)) if (!reach.has(c)) { reach.add(c); todo.push(c); }
    }
  }
  funcs.forEach((g, i) => {
    const code = codeOf.get(i);
    // Nothing calls it: not looked at (what it would give a closure's
    // code isn't given).
    if (roots.length ? !reach.has(i) : code === undefined && !called.has(i) && !outside.has(i) && !away.has(g.def) && !sited.has(g.def)) unreached.add(i);
    if (code !== undefined ? !inner(code) : !called.has(i)) outside.add(i);
    if (away.has(g.def)) outside.add(i);
  });
  // The codes of each type the program's applies run.
  const codes = new Map<string, number[]>();
  for (const [c, k] of codeOf) (codes.get(k) ?? codes.set(k, []).get(k)!).push(c);
  applies.forEach((ks, f) => ks.forEach((k) => (codes.get(k) ?? []).forEach((c) => callers[c].add(f))));

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
  // And which it only reads or gives back part of (lends to its answer):
  // the caller still holds it, and the answer shares it.
  const lends = reads.map((r) => [...r]);
  // Each function's locals (whole) and record locals' fields used once.
  const once = funcs.map((g) => g.locals.map(() => true));
  const fieldOnce = funcs.map(() => new Map<string, boolean>());
  // What each closure code gives away of what it captured.
  const capGiven = funcs.map(() => new Set<number>());
  const params: AV[][] = funcs.map((g, i) => g.params.map((_, j) => (outside.has(i) || (codeOf.has(i) && j === 0) ? "S" : "T")));
  const results: AV[] = funcs.map(() => "T");

  // Set when what a function's callers read of it changed: what it only
  // reads, lends, or gives of what it captured; its inputs' holders.
  let spread = false;
  const wake = (i: number) => { if (!queued.has(i)) { queued.add(i); queue.push(i); } };
  let queue: number[] = [];
  const queued = new Set<number>();
  const next = () => { const i = queue[head++]; if (head > 4096 && head * 2 > queue.length) { queue = queue.slice(head); head = 0; } queued.delete(i); return i; };
  let head = 0;
  const linear = (self: number) => {
    const g = funcs[self], whole = once[self], fields = fieldOnce[self];
    // State on a path: locals given away whole, and fields given away.
    // What a path added is logged, so the arms of a match each start from
    // the state before it without copying it.
    type St = { gone: Set<number>; took: Map<number, Set<number>>; log: number[] };
    const goes = (s: St, i: number) => { if (!s.gone.has(i)) { s.gone.add(i); s.log.push(i, -1); } };
    const took = (s: St, i: number, f: number) => s.took.get(i)?.has(f) ?? false;
    const takes = (s: St, i: number, f: number) => { let t = s.took.get(i); if (!t) s.took.set(i, (t = new Set())); if (!t.has(f)) { t.add(f); s.log.push(i, f); } };
    const off = (i: number) => { whole[i] = false; };
    const offF = (k: string) => { fields.set(k, false); };
    const borrow = (i: number, s: St) => { if (s.gone.has(i)) off(i); s.took.get(i)?.forEach((f) => offF(`${i}.${f}`)); };
    const give = (i: number, s: St) => { borrow(i, s); goes(s, i); };
    // A local given as two inputs of one call: the callee could read one
    // after changing the other.
    const twice = (xs: SExpr[], to?: number) => {
      const seen = new Set<number>();
      // A closure among them holds what it captured while the call runs.
      xs.forEach((x, j) => {
        if (to !== undefined && dead[to]?.[j]) return;
        for (const y of x.k === "closure" ? x.caps : [x]) if (y.k === "local") { if (seen.has(y.i)) off(y.i); seen.add(y.i); }
      });
    };
    const walk = (e: SExpr, s: St, read: boolean): void => {
      switch (e.k) {
        case "local": return plain(g.locals[e.i]) ? undefined : read ? borrow(e.i, s) : give(e.i, s);
        case "get": {
          // A field only read is borrowed, as a local is.
          if (e.rec.k === "local") { const k = `${e.rec.i}.${e.i}`; if (plain(e.t.fields[e.i]?.t)) return; if (s.gone.has(e.rec.i) || took(s, e.rec.i, e.i)) offF(k); if (!read) takes(s, e.rec.i, e.i); return; }
          return walk(e.rec, s, false);
        }
        // So is a case's field, the match's local its value.
        case "field": {
          if (e.rec.k === "local") { const k = `${e.rec.i}.${e.i}`; if (plain(e.t.cases[e.c]?.fields[e.i]?.t)) return; if (s.gone.has(e.rec.i) || took(s, e.rec.i, e.i)) offF(k); if (!read) takes(s, e.rec.i, e.i); return; }
          return walk(e.rec, s, false);
        }
        case "if": case "case": {
          // A match only looks at its value; its arms take its fields.
          walk(e.k === "if" ? e.cond : e.scrut, s, e.k === "if" || e.scrut.k === "local");
          const arms = e.k === "if" ? [e.then, e.else] : e.arms.filter((a): a is SExpr => !!a);
          const start = s.log.length, ends: number[] = [];
          for (const a of arms) {
            walk(a, s, false);
            for (let j = start; j < s.log.length; j += 2) { const i = s.log[j], f = s.log[j + 1]; ends.push(i, f); if (f < 0) s.gone.delete(i); else s.took.get(i)?.delete(f); }
            s.log.length = start;
          }
          for (let j = 0; j < ends.length; j += 2) if (ends[j + 1] < 0) goes(s, ends[j]); else takes(s, ends[j], ends[j + 1]);
          return;
        }
        case "op": for (const a of e.args) walk(a, s, true); return;
        // A closure capturing a record of plain fields captures a copy
        // where the record is written in place (owned-records.ts).
        // So does one given to a function that only reads (calls) it, whose
        // code only reads what it captured: it is gone when the call ends.
        case "closure": e.caps.forEach((c, k) => walk(c, s, (c.k === "local" && flat(g.locals[c.i])) || (read && !capGiven[e.fn]?.has(k)))); return;
        case "rt": { const o = op(e), r = (o !== null && READS.has(o)) || READS_RT.test(e.fn); twice(e.args); inputs(e.args.map((a) => [a, r]), s); return; }
        // An input the callee never looks at isn't a use (a local there
        // may be given away beside it).
        case "call": twice(e.args, e.fn); inputs(e.args.flatMap((a, j): [SExpr, boolean][] => (dead[e.fn]?.[j] && a.k === "local" ? [] : [[a, (reads[e.fn]?.[j] ?? false) || (!!lends[e.fn]?.[j] && lendable(a)) || !!dead[e.fn]?.[j]]])), s); return;
        // Calling a function only reads it.
        case "apply": twice([e.fn, ...e.args]); inputs([[e.fn, true], ...e.args.map((a): [SExpr, boolean] => [a, false])], s); return;
        // A record made from fields of one local of its type may be written
        // into it (owned-records.ts): that gives the local, whole; its
        // fields named there go with it.
        case "make": {
          const y = rebuilds(e);
          if (y === null) { inputs(e.args.map((a) => [a, false]), s); return; }
          inputs(e.args.flatMap((a): [SExpr, boolean][] => (fieldOf(a, e.t.key, y) ? [] : [[a, false]])), s);
          for (const a of e.args) if (fieldOf(a, e.t.key, y)) walk(a, s, false);
          if (s.gone.has(y)) off(y);
          goes(s, y);
          return;
        }
        default: for (const k of kids(e)) walk(k, s, false);
      }
    };
    // A call's inputs, in order, but a local given whole is given when
    // the call runs, after every input is worked out: `replace(a, i,
    // item at(a, i))` reads a before giving it.
    // So is a local's field: a record made of a machine's fields and one
    // worked out from the machine reads them first.
    const handed = (a: SExpr) => a.k === "local" || (a.k === "get" && a.rec.k === "local");
    const inputs = (xs: [SExpr, boolean][], s: St) => {
      for (const [a, read] of xs) if (read || !handed(a)) walk(a, s, read);
      for (const [a, read] of xs) if (!read && handed(a)) walk(a, s, false);
    };
    walk(g.body, { gone: new Set(), took: new Map(), log: [] }, false);
    // A parameter only borrowed: never given away whole nor in part.
    const given = new Set<number>(), lent = new Set<number>();
    // How a value is used: only read (0), part of what the function gives
    // back (1), or given away otherwise (2). A part read out of a value is
    // used as the value only where the part is (a let's local, a match's),
    // and a number, a Bool or a text never: `first` of a set of texts only
    // reads the set; of a set of records, it lends it to its answer.
    const gives = (e: SExpr, m: 0 | 1 | 2): void => {
      const by = (x: number): 0 | 1 | 2 => (given.has(x) ? 2 : lent.has(x) ? 1 : 0);
      switch (e.k) {
        case "local": if (m && !plain(g.locals[e.i])) (m === 2 ? given : lent).add(e.i); return;
        case "get": case "field": {
          const t = e.k === "get" ? e.t.fields[e.i]?.t : e.t.cases[e.c]?.fields[e.i]?.t;
          return gives(e.rec, plain(t) ? 0 : m);
        }
        case "make": { const y = rebuilds(e); if (y !== null) given.add(y); for (const a of e.args) gives(a, m); return; }
        case "new": for (const a of e.args) gives(a, m); return;
        case "let": gives(e.body, m); return gives(e.value, by(e.i));
        case "case": e.arms.forEach((a) => a && gives(a, m)); return gives(e.scrut, by(e.s));
        case "if": gives(e.cond, 0); gives(e.then, m); gives(e.else, m); return;
        case "op": for (const a of e.args) gives(a, 0); return;
        case "apply": gives(e.fn, 0); for (const a of e.args) gives(a, 2); return;
        case "cap": if (m && !plain(ir.shapes[e.shape]?.caps[e.i]) && !capGiven[self].has(e.i)) { capGiven[self].add(e.i); spread = true; } return;
        case "rt": { const o = op(e), r = (o !== null && READS.has(o)) || READS_RT.test(e.fn); e.args.forEach((a) => gives(a, r ? 0 : 2)); return; }
        case "call": e.args.forEach((a, j) => gives(a, reads[e.fn]?.[j] ? 0 : lends[e.fn]?.[j] ? m : 2)); return;
        default: for (const k of kids(e)) gives(k, 2);
      }
    };
    gives(g.body, 1);
    g.params.forEach((_, j) => {
      if (reads[self][j] && (given.has(j) || lent.has(j))) { reads[self][j] = false; spread = true; }
      if (lends[self][j] && given.has(j)) { lends[self][j] = false; spread = true; }
    });
  };

  // How many times local a is used on the way through f that uses it most
  // (one arm of an if or a case): whole, with its fields (j null), or
  // only whole (fieldsToo false); or field j of it. Its case being read
  // isn't a use: it holds nothing.
  const usesKept = new Map<string, number>();
  const usesIn = (f: number, a: number, j: number | null, fieldsToo = true): number => {
    const key = `${f}:${a}:${j}:${fieldsToo}`;
    const known = usesKept.get(key);
    if (known !== undefined) return known;
    const n = (e: SExpr): number => {
      if (e.k === "local") return e.i === a && j === null ? 1 : 0;
      if ((e.k === "get" || e.k === "field") && e.rec.k === "local" && e.rec.i === a) return j === null ? (fieldsToo ? 1 : 0) : e.i === j ? 1 : 0;
      if (e.k === "if") return n(e.cond) + Math.max(n(e.then), n(e.else));
      if (e.k === "tag" && e.rec.k === "local") return 0;
      if (e.k === "case") return (e.scrut.k === "local" ? 0 : n(e.scrut)) + e.arms.reduce((m, x) => Math.max(m, x ? n(x) : 0), 0);
      return kids(e).reduce((m, k) => m + n(k), 0);
    };
    const v = n(funcs[f].body);
    usesKept.set(key, v);
    return v;
  };
  // The holders of e's value, with env the locals'.
  const av = (self: number, e: SExpr, env: AV[], at: (e: SExpr, v: AV, env: AV[]) => void): AV => {
    const whole = once[self], fields = fieldOnce[self];
    // A local used only here (or a field of one, read only here), handed
    // to a function that only reads it or lends it to its answer: no one
    // holds it after, so what the function takes out of it keeps its
    // holders (List.turned of the list a map built, its items then moved).
    const dies = (a: SExpr): boolean =>
      (a.k === "local" && !plain(funcs[self].locals[a.i]) && usesIn(self, a.i, null) === 1) ||
      ((a.k === "get" || a.k === "field") && a.rec.k === "local" && usesIn(self, a.rec.i, null, false) === 0 && usesIn(self, a.rec.i, a.i) === 1);
    const v = ((): AV => {
      switch (e.k) {
        case "local": return whole[e.i] ? env[e.i] ?? "S" : "S";
        case "let": {
          env[e.i] = av(self, e.value, env, at);
          // An item read of an array with one holder whose slot is then
          // replaced, as a map in place does: the item's holders are the
          // ones the array gave it, the array no longer holding it.
          const v = e.value;
          if (v.k === "rt" && op(v) === "get" && v.args[0]?.k === "local" && v.args[1]?.k === "local" && whole[v.args[0].i]) {
            // (Not known yet while the array isn't.)
            const a = env[v.args[0].i];
            if ((a === "T" || (typeof a === "object" && "it" in a)) && replacedAt(e.body, v.args[0].i, v.args[1].i)) env[e.i] = a === "T" ? "T" : a.it;
          }
          return av(self, e.body, env, at);
        }
        case "if": av(self, e.cond, env, at); return meet(av(self, e.then, env, at), av(self, e.else, env, at));
        case "case": {
          env[e.s] = av(self, e.scrut, env, at);
          return e.arms.reduce<AV>((m, a) => (a ? meet(m, av(self, a, env, at)) : m), "T");
        }
        case "get": {
          if (e.rec.k === "local") {
            const r = whole[e.rec.i] || fields.get(`${e.rec.i}.${e.i}`) !== false ? env[e.rec.i] : "S";
            // Not known yet: its fields aren't either.
            if (r === "T") return "T";
            return fields.get(`${e.rec.i}.${e.i}`) !== false ? fieldsOf(r)?.[e.i] ?? "S" : "S";
          }
          const r = av(self, e.rec, env, at);
          return r === "T" ? "T" : fieldsOf(r)?.[e.i] ?? "S";
        }
        // A case's field: more of the type is the value's own kind, the
        // rest what is in it.
        case "field": {
          const one = e.rec.k !== "local" || whole[e.rec.i] || fields.get(`${e.rec.i}.${e.i}`) !== false;
          const r = e.rec.k === "local" ? (one ? env[e.rec.i] ?? "S" : "S") : av(self, e.rec, env, at);
          if (r === "T") return "T";
          if (typeof r !== "object" || !("it" in r) || (e.rec.k === "local" && fields.get(`${e.rec.i}.${e.i}`) === false)) return "S";
          const t = e.t.cases[e.c]?.fields[e.i]?.t;
          return typeof t === "object" && isData(t) && t.key === e.t.key ? r : r.it;
        }
        case "new": {
          const fs = e.t.cases[e.c]?.fields ?? [];
          let it: AV = "T";
          for (const [i, a] of e.args.entries()) {
            const x = av(self, a, env, at), t = fs[i]?.t;
            if (typeof t === "object" && isData(t) && t.key === e.t.key) { if (x === "T") continue; if (typeof x !== "object" || !("it" in x)) { it = "S"; continue; } it = meet(it, x.it); } else if (!plain(t)) it = meet(it, x);
          }
          return capped({ it });
        }
        case "make": return capped({ f: e.args.map((a) => av(self, a, env, at)) });
        // No value: the other paths decide.
        case "fail": case "abort": kids(e).forEach((k) => av(self, k, env, at)); return "T";
        case "call": {
          const xs = e.args.map((a) => av(self, a, env, at));
          xs.forEach((x, j) => { const p = params[e.fn]; if (p && !outside.has(e.fn)) { const m = meet(p[j], !dies(e.args[j]) && (reads[e.fn][j] || (lends[e.fn][j] && lendable(e.args[j]))) ? "S" : x); if (!same(m, p[j])) { p[j] = m; wake(e.fn); } } });
          // What it lent its answer is shared with the answer from here on:
          // a local, or a local's field.
          e.args.forEach((a, j) => {
            if (reads[e.fn]?.[j] || !lends[e.fn]?.[j] || dies(a)) return;
            if (a.k === "local") env[a.i] = "S";
            else if (a.k === "get" && a.rec.k === "local") { const r = env[a.rec.i], fs = fieldsOf(r); if (fs) env[a.rec.i] = { f: fs.map((y, i) => (i === a.i ? "S" : y)) }; }
            else if (a.k === "field" && a.rec.k === "local") env[a.rec.i] = "S";
          });
          // A definition with no inputs is worked out once and kept, unless
          // it gives an array or a table of a type something writes in place
          // (core-js.ts and wasm.ts `written`; wasm.ts keeps no table):
          // made again at each call.
          return funcs[e.fn]?.params.length || (funcs[e.fn] && (isArray(funcs[e.fn].result) || isTable(funcs[e.fn].result))) ? results[e.fn] : "S";
        }
        case "apply": {
          av(self, e.fn, env, at);
          const xs = e.args.map((a) => av(self, a, env, at));
          const cs = inner(e.t.key) ? codes.get(e.t.key) ?? [] : [];
          for (const c of cs) xs.forEach((x, j) => { const p = params[c]; if (p && !outside.has(c) && j + 1 < p.length) { const m = meet(p[j + 1], x); if (!same(m, p[j + 1])) { p[j + 1] = m; wake(c); } } });
          return cs.length ? cs.reduce<AV>((m, c) => meet(m, results[c]), "T") : "S";
        }
        case "rt": {
          const xs = e.args.map((a) => av(self, a, env, at));
          const o = op(e);
          // `both` runs its function twice, on the threads or here: each
          // answer is what the function gives (a copy, from a worker).
          if (e.fn === "both.pure" || e.fn === "both.second") { const cs = bothOf.get(self) ?? [-1]; return cs.reduce<AV>((m, c) => meet(m, results[c] ?? "S"), "T"); }
          // An array: one holder, and what its items have (C327f part 4d).
          if (e.fn.startsWith("array.")) {
            if (o === "empty") return { it: "T" };
            if (o === "of") return { it: typeof xs[0] === "object" && "it" in xs[0] ? xs[0].it : xs[0] === "T" ? "T" : "S" };
            if (o === "ofItems") return { it: xs.reduce<AV>((m, x) => meet(m, x), "T") };
            if (o !== null && MAKES.has(o)) return { it: "S" };
            if (o !== null && PASSES.has(o)) return typeof xs[0] === "object" && "it" in xs[0] ? { it: capped(meet(xs[0].it, xs[xs.length - 1] ?? "S")) } : xs[0];
            return "S";
          }
          return o !== null && MAKES.has(o) ? "U" : o !== null && PASSES.has(o) ? xs[0] : "S";
        }
        default: kids(e).forEach((k) => av(self, k, env, at)); return "S";
      }
    })();
    at(e, v, env);
    return v;
  };
  const body = (i: number, at: (e: SExpr, v: AV, env: AV[]) => void) => {
    const g: SFunc = funcs[i];
    const env: AV[] = g.locals.map((_, j) => (j < g.params.length ? params[i][j] : "S"));
    return av(i, g.body, env, at);
  };
  // What each function only reads, and which locals are used once, first:
  // they don't hang on holders, and a parameter taken as only read while
  // that was still being worked out would count what it's given as shared
  // for good (moths' `filed`, given a new grid each tick).
  const none: Holders = { owned: new Set(), one: () => false, into: new Set() };
  const budget = () => 100 * funcs.length + 100;
  const reached = (i: number) => !unreached.has(i);
  funcs.forEach((_, i) => { if (reached(i)) wake(i); });
  for (let n = 0; head < queue.length; n++) {
    if (n > budget()) return none;
    const i = next();
    spread = false;
    linear(i);
    if (spread) callers[i].forEach((c) => { if (reached(c)) wake(c); });
  }
  funcs.forEach((_, i) => { if (!unreached.has(i)) wake(i); });
  for (let n = 0; head < queue.length; n++) {
    if (n > budget()) return none;
    const i = next();
    const r = meet(results[i], body(i, () => {}));
    if (!same(r, results[i])) { results[i] = r; callers[i].forEach((c) => { if (!unreached.has(c)) wake(c); }); }
  }
  // Each replace's array, as the fixpoint left it: it has one holder when
  // it arrived with one and the replace is the last that uses it.
  const owned = new Set<SExpr>();
  const vals = new Map<SExpr, AV>();
  const into = new Set<SExpr>();
  funcs.forEach((_, i) => !unreached.has(i) && body(i, (e, v, env) => {
    vals.set(e, v);
    if (e.k !== "make") return;
    const y = rebuilds(e);
    if (y === null) return;
    const ys = e.args.flatMap((a) => (a.k === "get" && fieldOf(a, e.t.key, y) ? [{ f: a.i }] : []));
    if (once[i][y] && fieldsOf(env[y]) !== null && ys.every((x) => fieldOnce[i].get(`${y}.${x.f}`) !== false)) into.add(e);
  }));
  funcs.forEach((g) => {
    const look = (e: SExpr) => {
      if ((op(e) === "replaceAt" || op(e) === "push" || op(e) === "t:put" || op(e) === "t:remove") && e.k === "rt" && one(vals.get(e.args[0]))) owned.add(e);
      kids(e).forEach(look);
    };
    look(g.body);
  });
  return { owned, one: (i, j) => one(params[i]?.[j]), into };
}

// The replaces holders() finds, made `replaceOwned`, and the pushes it
// finds, marked for ownPushes to make `pushOwned` once columns.ts has read
// them as pushes (an array built by pushes may become columns); how many.
export function ownedPerValue(ir: CoreIR, roots: number[], shared?: () => Holders): number {
  const owned = (shared ?? (() => holders(ir, roots)))().owned;
  for (const e of owned) if (e.k === "rt") { if (op(e) === "push") e.own = true; else if (op(e) === "replaceAt") e.fn = e.fn.replace("array.replaceAt.", "array.replaceOwned."); }
  return owned.size;
}

// holders() of these roots, worked out when first asked and kept: the
// passes after mapsInPlace read one answer (owned-arrays.ts, ownedPerValue,
// owned-tables.ts, and on WebAssembly owned-records.ts), as what they
// change between them (a replace made replaceOwned, a push marked own)
// changes nothing holders() reads. owned-pushes.ts puts calls in place,
// after which holders() knows more, so a pass after it asks again.
// `keep` gives it an answer already worked out: mapsInPlace's, where it
// wrote every map it found in place, the map then giving its array away
// as it was counted to.
export type SharedHolders = (() => Holders) & { keep: (h: Holders) => void };
export function sharedHolders(ir: CoreIR, roots: number[]): SharedHolders {
  let h: Holders | undefined;
  return Object.assign(() => (h ??= holders(ir, roots)), { keep: (x: Holders) => { h ??= x; } });
}

// Those pushes, where they are still pushes onto an array (not made
// columns' own), as copied by the passes since.
export function ownPushes(ir: CoreIR): void {
  const look = (e: SExpr): void => { if (e.k === "rt" && e.own && op(e) === "push") e.fn = e.fn.replace("array.push.", "array.pushOwned."); kids(e).forEach(look); };
  ir.funcs.forEach((g) => look(g.body));
}
