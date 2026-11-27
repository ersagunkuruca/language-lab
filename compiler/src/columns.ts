// An array of records stored as columns, an array per field (C60,
// docs/design/data/COLUMNS.md), as a data-oriented C programmer would
// write it: drift's motes moved by `x[i] += vx[i]`, with no object per
// mote and only the fields read brought into the cache.
//
// An array type whose items are a record is stored so when every use of
// it is one of: its length; an item read at a position and then only read
// field by field (directly or in a small function given it, put in place
// here); the item at a position replaced by one made from it (owned-records.ts
// wrote it into the item, owned-arrays.ts the map into its array), which
// writes only the fields that change; and the array made by a map from
// another array, which writes each item's fields at its position. A map
// that may share its items on workers (map.worth) runs in turn instead.
// Anything else, an item leaving whole or the array given to the runtime,
// keeps the array as rows. On JavaScript (core-js.ts prints the `array.c…`
// functions inline) a Float64 field is a Float64Array, any other an Array;
// on C (c.ts) the items stay a buffer of structs, each field written in
// its slot where nothing else counts the array.

//
// `whole` (JavaScript, G3d): an item may also leave whole (given to a
// function, kept in a closure, read with `item at`'s check), and is then
// made from its columns where it is read; a record held in a field is
// stored as a column per leaf field (a bird's place, three Float64Arrays),
// so no item is an object holding objects, each Float64 boxed, spread
// over the heap (the moths', the flock's). V8 takes the record made from
// the columns apart again where it only reads its fields (escape
// analysis). An array captured by a closure given to a call stays columns.

import { isFloat32, kids, mapKids, type AType, type CoreIR, type DType, type LType, type RType, type SExpr, type SFunc } from "./scalar.ts";

type Local = Extract<SExpr, { k: "local" }>;
const loc = (i: number): Local => ({ k: "local", i });
const isLocal = (e: SExpr | undefined, i?: number): e is Local => e?.k === "local" && (i === undefined || e.i === i);
const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
const isRecord = (t: LType | undefined): t is RType => typeof t === "object" && t !== null && "fields" in t && !("cases" in t);
const isArray = (t: LType | undefined, a: AType) => typeof t === "object" && t !== null && (t as { key?: string }).key === a.key;

// The ops on an array type that columns keep, by name.
const KEPT = /^array\.(get|at|length|empty|slice|of|replaceOwned|pushFrontOwned|replaceAt|pushFront|push)\.a(\d+)$/;
const PUSH = /^array\.pushFront(Owned)?\.a\d+$/, REPLACE = /^array\.replace(Owned|At)\.a\d+$/;

// A map's fold as lowered (owned-arrays.ts): f(a, i, made, by) is `if i = 0
// then made else let j = i - 1; let x = a[j]; f(a, j, put(made, …), by)`.
// `from`: the local its items are read from, the array it puts into (2,
// where arrays are counted: owned-arrays.ts mapsInPlaceCounted) or not.
interface Fold { fold: number; j: number; put: Extract<SExpr, { k: "rt" }>; from: number }
function foldOf(ir: CoreIR, g: number): Fold | null {
  const b = ir.funcs[g].body;
  if (b.k !== "if" || !isLocal(b.then, 2)) return null;
  const lj = b.else;
  if (lj.k !== "let" || lj.value.k !== "rt" || lj.value.fn !== "int.sub" || !isLocal(lj.value.args[0], 1)) return null;
  const lx = lj.body;
  if (lx.k !== "let" || lx.value.k !== "rt" || !/^array\.get\.a\d+$/.test(lx.value.fn) || !(isLocal(lx.value.args[0], 0) || isLocal(lx.value.args[0], 2)) || !isLocal(lx.value.args[1], lj.i)) return null;
  const again = lx.body;
  if (again.k !== "call" || again.fn !== g || again.args.length !== 4 || !isLocal(again.args[0], 0) || !isLocal(again.args[1], lj.i) || !isLocal(again.args[3], 3)) return null;
  const put = again.args[2];
  if (put.k !== "rt" || !isLocal(put.args[0], 2)) return null;
  if (PUSH.test(put.fn) && put.args.length === 2) return { fold: g, j: lj.i, put, from: (lx.value.args[0] as Local).i };
  if (REPLACE.test(put.fn) && put.args.length === 3 && isLocal(put.args[1], lj.i)) return { fold: g, j: lj.i, put, from: (lx.value.args[0] as Local).i };
  return null;
}

const callsItself = (e: SExpr, g: number): boolean => (e.k === "call" && e.fn === g) || kids(e).some((x) => callsItself(x, g));
// The functions a function that calls itself calls, at any depth.
const calls = (e: SExpr, out: Set<number>): Set<number> => { if (e.k === "call") out.add(e.fn); kids(e).forEach((x) => calls(x, out)); return out; };
function loopsReach(funcs: CoreIR["funcs"]): Set<number> {
  const out = new Set<number>(), callees = funcs.map((g) => calls(g.body, new Set()));
  const go = (i: number) => { for (const j of callees[i]) if (!out.has(j)) { out.add(j); go(j); } };
  funcs.forEach((_, i) => { if (callees[i].has(i)) go(i); });
  return out;
}

// The functions run from the roots: calls and closures' code.
function reached(ir: CoreIR, roots: number[]): Set<number> {
  const seen = new Set<number>();
  const go = (i: number) => {
    if (seen.has(i)) return;
    seen.add(i);
    const w = (e: SExpr) => { if (e.k === "call" || e.k === "closure") go(e.fn); kids(e).forEach(w); };
    w(ir.funcs[i].body);
  };
  roots.forEach(go);
  return seen;
}

// mapLocals, and a make written into a local too.
function renamed(e: SExpr, m: (i: number) => number): SExpr {
  const r = mapKids(e, (x) => renamed(x, m));
  switch (r.k) {
    case "local": return { k: "local", i: m(r.i) };
    case "let": return { ...r, i: m(r.i) };
    case "make": return r.into === undefined ? r : { ...r, into: m(r.into) };
    case "case": return { ...r, s: m(r.s) };
    case "attempt": case "search": return { ...r, res: m(r.res) };
    case "apply": return { ...r, tmp: m(r.tmp) };
    case "list": return { ...r, item: m(r.item), acc: m(r.acc) };
    case "handle": return { ...r, reason: m(r.reason), save: m(r.save), ...(r.frame !== undefined ? { frame: m(r.frame) } : {}) };
    case "budget": return { ...r, save: m(r.save), res: m(r.res) };
    default: return r;
  }
}

// A function small and plain enough to put in place: lets, reads of
// fields, records made and arithmetic, reading no capture.
const PLAIN = new Set(["num", "int", "text", "bool", "local", "op", "let", "make", "get", "call"]);
const plain = (e: SExpr): boolean => PLAIN.has(e.k) && kids(e).every(plain);
const size = (e: SExpr): number => 1 + kids(e).reduce((n, k) => n + size(k), 0);
// One read of an array's item, after lets of locals (the prelude's `item
// read`).
const oneRead = (e: SExpr): boolean => (e.k === "let" && e.value.k === "local" ? oneRead(e.body) : e.k === "rt" && /^array\.(at|get)\.a\d+$/.test(e.fn) && e.args.every((x) => x.k === "local"));

// Calls of small plain functions put in place in f, where they take an
// item or make one that goes into an array: what columns need to see.
function inlined(ir: CoreIR, f: SFunc, self: number, wanted: (e: Extract<SExpr, { k: "call" }>) => boolean): void {
  for (let round = 0; round < 3; round++) {
    let changed = false;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      if (r.k !== "call" || r.cps || r.fn === self || !wanted(r)) return r;
      const g = ir.funcs[r.fn];
      if (g.multi || !(plain(g.body) || oneRead(g.body)) || size(g.body) > 200 || found(g.body, (x) => x.k === "call" && x.fn === r.fn)) return r;
      const at = g.locals.map((t) => f.locals.push(t) - 1);
      changed = true;
      return r.args.reduceRight<SExpr>((body, value, j) => ({ k: "let", i: at[j], value, body }), renamed(g.body, (i) => at[i]));
    };
    f.body = put(f.body);
    if (!changed) return;
  }
}
const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

// A record's leaf fields, each by its path of field positions: a field
// holding a record (not one changed in place) is its own leaves.
// Deep (whole), an `Optional` field (G1b3, a data type of a case with no
// fields and a case of one, whose value is a plain number or a record of
// them: a moth's `velocity: Optional Vec`) is a column of whether it is
// that case (`opt`, its index `some`), then that value's leaves, by a
// path through it of −1.
// `narrow`: a Float32's value, a column of binary32s where the target has
// them (C309).
export type Leaf = { path: number[]; t: LType; opt?: DType; some?: number; narrow?: true };
const PLAIN_LEAF = new Set<LType>(["f64", "int", "i32"]);
export function optionalOf(t: LType): { d: DType; some: number; v: LType } | null {
  if (!isData(t) || t.cases.length !== 2) return null;
  const some = t.cases.findIndex((c) => c.fields.length === 1);
  if (some < 0 || t.cases[1 - some].fields.length) return null;
  const v = t.cases[some].fields[0].t;
  const plain = PLAIN_LEAF.has(v) || (isRecord(v) && !v.mutable && v.fields.length > 0 && v.fields.every((x) => PLAIN_LEAF.has(x.t)));
  return plain ? { d: t, some, v } : null;
}
export function leavesOf(r: RType, deep: boolean, at: number[] = []): Leaf[] {
  const narrow = isFloat32(r) ? { narrow: true as const } : {};
  return r.fields.flatMap((x, k): Leaf[] => {
    if (deep && isRecord(x.t) && !x.t.mutable && x.t.fields.length) return leavesOf(x.t, deep, [...at, k]);
    const o = deep ? optionalOf(x.t) : null;
    if (o) return [{ path: [...at, k], t: "i32", opt: o.d, some: o.some }, ...(isRecord(o.v) ? o.v.fields.map((y, m) => ({ path: [...at, k, -1, m], t: y.t, ...(isFloat32(o.v) ? { narrow: true as const } : {}) })) : [{ path: [...at, k, -1], t: o.v }])];
    return [{ path: [...at, k], t: x.t, ...narrow }];
  });
}
// A case of one record and a case of none (`Optional Thing`), and the
// leaves of an array of it: its column of which, then the record's.
function slotOf(t: LType): { d: DType; some: number; v: RType } | null {
  if (!isData(t) || t.cases.length !== 2) return null;
  const some = t.cases.findIndex((c) => c.fields.length === 1);
  if (some < 0 || t.cases[1 - some].fields.length) return null;
  const v = t.cases[some].fields[0].t;
  return isRecord(v) && !v.mutable && v.fields.length ? { d: t, some, v } : null;
}
function slotLeaves(d: DType): Leaf[] {
  const o = slotOf(d)!;
  return [{ path: [], t: "i32", opt: d, some: o.some }, ...leavesOf(o.v, true, [-1])];
}
const isData = (t: LType | undefined): t is DType => typeof t === "object" && t !== null && "cases" in t;
// What a column holds where the field is not that case.
const zeroOf = (t: LType): SExpr => (t === "f64" ? { k: "num", v: 0 } : t === "int" ? { k: "int", v: 0n } : { k: "bool", v: false });

// `plain`: only records of plain fields (Float64, Int, Text, Bool), the
// columns WebAssembly keeps (wasm.ts colScan): there a record holding an
// array or a record stays a row (pack's, read by position since G3a), but
// a Float32 field is a column of binary32s (C309).
// `grow` (JavaScript, G1b2): an array built by pushes in a loop from an
// empty one (`keep`'s, kept-items.ts) is columns too, growing as it is
// pushed onto; any empty array is columns with room to grow.
export function columns(ir: CoreIR, roots: number[], opts: { plain?: boolean; whole?: boolean; grow?: boolean } = {}): number {
  let n = 0;
  // The runtime's functions each function calls (read again once columns
  // change the functions), so an array no function reads an item of
  // costs no walk.
  let rts: Map<string, Set<number>> | null = null, live: Set<number> | null = null;
  const rtsOf = () => {
    if (rts) return rts;
    rts = new Map();
    live = reached(ir, roots);
    ir.funcs.forEach((f, i) => { const w = (e: SExpr) => { if (e.k === "rt") { let s = rts!.get(e.fn); if (!s) rts!.set(e.fn, (s = new Set())); s.add(i); } kids(e).forEach(w); }; w(f.body); });
    return rts;
  };
  for (const a of ir.arrays) {
    const r = a.item;
    // An array of a case of one record, whole and growing (G1b4: a pool's
    // slots, `Optional Thing`): whether each item is that case, and its
    // record's leaves.
    const slots = opts.whole && opts.grow ? slotOf(r) : null;
    if (!slots && (!isRecord(r) || !r.fields.length)) continue;
    // A Float32 field too (C309): its value a column of binary32s; and a
    // record of Float64s, a column each (C362: a moth's place).
    if (opts.plain && isRecord(r) && r.fields.some((x) => !["f64", "int", "text", "i32"].includes(x.t as string) && !(isRecord(x.t) && (isFloat32(x.t) || x.t.fields.every((y) => y.t === "f64"))))) continue;
    if (stored(ir, a, r as RType | DType, roots, !!opts.whole, !!opts.grow, rtsOf(), live!, !!opts.whole || !!opts.plain, !!opts.plain)) { n++; rts = null; }
  }
  return n;
}

// `deep`: a record in a field a column per leaf (whole, or plain, where
// such a field is a Float32's or a record of Float64s: C362). `plain`:
// WebAssembly's columns, with fewer ops than JavaScript's.
function stored(ir: CoreIR, a: AType, r: RType | DType, roots: number[], whole: boolean, grow: boolean, rts: Map<string, Set<number>>, live: Set<number>, deep: boolean, plain = false): boolean {
  const leaves = isRecord(r) ? leavesOf(r, deep) : slotLeaves(r);
  const leafAt = (path: number[]) => leaves.findIndex((l) => l.path.length === path.length && l.path.every((x, k) => x === path[k]));
  const suffix = `.a${a.index}`;
  const ofA = (fn: string) => fn.endsWith(suffix) && /^array\./.test(fn);
  // Read by position (`get`), or whole by `item at` (C342: the prelude's
  // strided contraction sum reads its items so).
  if (!rts.get(`array.get${suffix}`)?.size && !(whole && rts.get(`array.at${suffix}`)?.size)) return false;
  // A copy to work on: nothing changes unless every use is one columns keep.
  const funcs = ir.funcs.map((f) => ({ ...f, locals: [...f.locals], ...(f.binders ? { binders: [...f.binders] } : {}) }));
  const work: CoreIR = { ...ir, funcs };

  // Maps that may share on workers run in turn: over one of these arrays,
  // or making one (pack's `code tree`, mapping a map's entries to pairs: the
  // workers' answer was a plain array where its columns were read, C233).
  const inTurn = (e: SExpr): SExpr => {
    const x = mapKids(e, inTurn);
    return x.k === "if" && x.cond.k === "rt" && x.cond.fn === "map.worth" && (arrayOf(x.cond.args[0]) || isArray(x.t, a)) ? x.else : x;
  };
  let fnNow: SFunc = funcs[0];
  let inLoops: Set<number> | undefined;
  const arrayOf = (e: SExpr | undefined): boolean =>
    !!e && ((e.k === "local" && isArray(fnNow.locals[e.i], a)) || (e.k === "call" && isArray(funcs[e.fn].result, a)) || (e.k === "rt" && ofA(e.fn) && !e.fn.startsWith("array.get") && !e.fn.startsWith("array.length")) || (e.k === "let" && arrayOf(e.body)));
  const worth = rts.get("map.worth");
  for (const i of live) if (worth?.has(i)) { fnNow = funcs[i]; funcs[i].body = inTurn(funcs[i].body); }
  const now = [...live].some((i) => worth?.has(i)) ? reached(work, roots) : live;

  // Small functions given an item, or making one to put, put in place.
  for (const i of now) {
    const f = funcs[i];
    const items = new Set<number>();
    const w = (e: SExpr) => { if (e.k === "let" && e.value.k === "rt" && e.value.fn === `array.get${suffix}`) items.add(e.i); kids(e).forEach(w); };
    w(f.body);
    const puts = found(f.body, (e) => e.k === "rt" && ofA(e.fn) && (PUSH.test(e.fn) || REPLACE.test(e.fn)));
    const makes = (c: Extract<SExpr, { k: "call" }>) => { const t = funcs[c.fn].result; return isRecord(t) && isRecord(r) && t.key === r.key; };
    // And a function that is one read of an item (the prelude's `item
    // read`, C342), so the loop calling it reads the columns itself.
    const reads = (c: Extract<SExpr, { k: "call" }>) => { let b = funcs[c.fn].body; while (b.k === "let") b = b.body; return whole && oneRead(funcs[c.fn].body) && b.k === "rt" && ofA(b.fn); };
    if (items.size || puts || whole) inlined(work, f, i, (c) => (puts && makes(c)) || c.args.some((x) => isLocal(x) && items.has(x.i)) || reads(c));
  }

  // The folds of maps putting into an array of a, and their entries.
  const folds = new Map<number, Fold>();
  const entries = new Map<number, { call: Extract<SExpr, { k: "call" }>; fold: Fold }>();
  for (const i of now) {
    const b = funcs[i].body;
    if (b.k !== "call" || b.args.length !== 4) continue;
    const fd = foldOf(work, b.fn);
    if (!fd || !ofA(fd.put.fn)) continue;
    const [x, len, made, by] = b.args;
    if (!isLocal(by, 1) || len.k !== "rt" || !/^array\.length\.a\d+$/.test(len.fn) || !isLocal(len.args[0], 0)) continue;
    const empty = (e: SExpr) => e.k === "rt" && e.fn === `array.empty${suffix}`;
    // A new array of the map's answers (a, n, empty, by), or the map's own
    // array: (a, n, a, by) read from a, or (empty, n, a, by) read from it.
    const fresh = isLocal(x, 0) && empty(made) && PUSH.test(fd.put.fn) && fd.from === 0;
    const same = REPLACE.test(fd.put.fn) && ((isLocal(x, 0) && isLocal(made, 0) && fd.from === 0 && fd.put.fn.startsWith("array.replaceOwned")) || (empty(x) && isLocal(made, 0) && fd.from === 2));
    if (!fresh && !same) continue;
    folds.set(b.fn, fd);
    entries.set(i, { call: b, fold: fd });
  }

  // Loops building an array by pushes, from an empty one (G1b2): the
  // pushes onto the array they carry, which nothing else holds.
  const pushes = grow ? builtBy(funcs, now, a, suffix) : new Set<SExpr>();

  // Every use of a, and of an item read of it, is one columns keep?
  // An array given to a host: a local, or a list of its items.
  const given = (x: SExpr) => isLocal(x) || (x.k === "rt" && x.fn === `array.items${suffix}`);
  for (const i of now) {
    const f = funcs[i];
    fnNow = f;
    const items = new Map<number, true>();
    const fold = folds.get(i);
    let ok = true;
    const bad = () => { if (ok && typeof process !== "undefined" && process.env.COLUMNS_WHY) console.error("columns:", r.name, "kept rows, for", e0?.k === "rt" ? e0.fn : e0?.k, "in", funcs[i].name); ok = false; };
    let e0: SExpr | undefined;
    const isItem = (e: SExpr) => e.k === "local" && items.has(e.i);
    let terminal: SExpr | undefined;
    if (fold) { terminal = fold.put.args[fold.put.args.length - 1]; while (terminal.k === "let") terminal = terminal.body; }
    const walk = (e: SExpr, under?: SExpr): void => {
      if (!ok) return;
      e0 = e;
      switch (e.k) {
        case "let":
          if (e.value.k === "rt" && e.value.fn === `array.get${suffix}`) {
            if (!isLocal(e.value.args[0]) || !isLocal(e.value.args[1])) return bad();
            items.set(e.i, true);
            walk(e.value.args[0], e.value);
            walk(e.body);
            return;
          }
          if (isItem(e.value)) { items.set(e.i, true); walk(e.body); return; }
          break;
        case "local":
          // An item read only field by field, or written into (or, whole,
          // made from its columns where it is read).
          if (isItem(e) && !whole && !(under?.k === "get" && under.rec === e)) return bad();
          return;
        case "make":
          if (e.into !== undefined && items.has(e.into) && e !== terminal) return bad();
          break;
        case "rt":
          if (ofA(e.fn)) {
            const m = KEPT.exec(e.fn);
            if (!m) return bad();
            if (m[1] === "get" && under?.k !== "let") return bad();
            if (m[1] === "at" && (!whole || !isLocal(e.args[0]))) return bad();
            // A slice (JavaScript, whole): its columns copied (C342: mnist's
            // weights as a Tensor, a slice of its parameters).
            if (m[1] === "slice" && !whole) return bad();
            // And made of a list's items, each a record of plain fields
            // (C342: a tensor transposed, `array of(map(indices, …))`).
            if (m[1] === "of" && (!whole || !isRecord(r) || leaves.some((l) => l.path.length !== 1 || l.opt))) return bad();
            // Growing, a replace or a put in front of an array held
            // elsewhere too: on a copy of its columns (G1b4: a pool's slot
            // given an item, at a lamp hung or taken).
            const copied = grow && /^(replaceAt|replaceOwned|pushFront|pushFrontOwned)$/.test(m[1]);
            // Not in a function that calls itself (C286): a copy a step is
            // the whole array again each step, where rows put an item in
            // front in its room or replace it with a version note (crew's
            // list of tasks as an array, built from the back: 2,000 tasks
            // 1.19 s, 0.24 s as rows).
            // Nor a replace in one a loop calls, at any depth (swarm-pool: a mote put in a free
            // slot of the pool, each of the thousands made a tick a copy of
            // every column, 92 s against 1.5 s as rows with version notes).
            // A put in front grows the array, as greenhouse's pool when no
            // slot is free, and keeps its copy (rows there cost 12 -> 14 s).
            if (copied && !(fold && fold.put === e) && !pushes.has(e) && (callsItself(f.body, i) || m[1].startsWith("replace") && (inLoops ??= loopsReach(funcs)).has(i))) return bad();
            if (/^(push|replace)/.test(m[1]) && !(fold && fold.put === e) && !pushes.has(e) && !copied) return bad();
            if (m[1] === "empty" && !grow && ![...entries.values()].some((x) => x.call.args[2] === e || x.call.args[0] === e)) return bad();
            for (const x of e.args) walk(x, e);
            return;
          }
          // Given whole to a host (C348: the flock page's birds to the
          // frame's draw), as rows made there from the columns.
          if (e.args.some(arrayOf)) {
            if (!(whole && e.fn.startsWith("host:") && isRecord(r) && !leaves.some((l) => l.opt) && e.args.every((x) => !arrayOf(x) || given(x)))) return bad();
            for (const x of e.args) if (!arrayOf(x)) walk(x, e); else if (x.k === "rt") walk(x.args[0], x);
            return;
          }
          break;
        case "world": case "apply": case "closure": case "new": case "list":
          // Whole, a closure may keep the array and one applied may be
          // given it: their code is reached from the roots and kept to
          // columns too. Items are made where read. Not on WebAssembly
          // (plain): flock's birds kept by its grid's closures measured
          // 8% slower as columns there (C362).
          if (whole && !plain && (e.k === "closure" || e.k === "apply")) break;
          if ((e.k === "closure" ? e.caps : e.k === "list" ? e.items : e.args).some((x: SExpr) => arrayOf(x) || (!whole && isItem(x)))) return bad();
          break;
        case "call":
          if (!whole && e.args.some(isItem)) return bad();
          break;
        case "get":
          walk(e.rec, e);
          return;
      }
      for (const k of kids(e)) walk(k, e);
    };
    walk(f.body);
    if (!ok) return false;
  }

  // Written as columns.
  for (const i of now) {
    const f = funcs[i];
    fnNow = f;
    const at = new Map<number, { x: Local; j: Local }>();
    const entry = entries.get(i), fold = folds.get(i);
    // The record (or the record in a field, by its path) at j of x, made
    // from its columns.
    const madeAt = (x: Local, j: Local, t: RType, path: number[]): SExpr =>
      ({ k: "make", t, args: t.fields.map((fd, k) => { const l = leafAt([...path, k]); return l >= 0 ? leafRead(x, j, l) : madeAt(x, j, fd.t as RType, [...path, k]); }) });
    // A leaf's column read; an `Optional` made from its own (G1b3): that
    // case, of its value's leaves, where its column says so.
    const leafRead = (x: Local, j: Local, l: number): SExpr => {
      const lf = leaves[l];
      if (!lf.opt) return rt(`array.cget${l}${suffix}`, x, j);
      const v = lf.opt.cases[lf.some!].fields[0].t;
      const value = isRecord(v) ? madeAt(x, j, v, [...lf.path, -1]) : rt(`array.cget${leafAt([...lf.path, -1])}${suffix}`, x, j);
      return { k: "if", cond: rt(`array.cget${l}${suffix}`, x, j), then: { k: "new", t: lf.opt, c: lf.some!, args: [value] }, else: { k: "new", t: lf.opt, c: 1 - lf.some!, args: [] }, t: lf.opt };
    };
    // The item at j of x: a record made, or a slot (G1b4).
    const itemAt = (x: Local, j: Local): SExpr => (isRecord(r) ? madeAt(x, j, r, []) : leafRead(x, j, 0));
    // A read of a field of a record at a path in an item.
    const fieldAt = (p: { x: Local; j: Local }, path: number[], t: RType): SExpr => {
      const l = leafAt(path);
      return l >= 0 ? leafRead(p.x, p.j, l) : madeAt(p.x, p.j, t, path);
    };
    // A get of a get … of an item: its path, or null.
    const pathOf = (e: SExpr): { p: { x: Local; j: Local }; path: number[] } | null => {
      if (e.k === "local" && at.has(e.i)) return { p: at.get(e.i)!, path: [] };
      if (e.k === "get") { const q = pathOf(e.rec); return q && (deep || !q.path.length) ? { p: q.p, path: [...q.path, e.i] } : null; }
      return null;
    };
    const go = (e: SExpr): SExpr => {
      if (e.k === "let" && e.value.k === "rt" && e.value.fn === `array.get${suffix}`) {
        at.set(e.i, { x: e.value.args[0] as Local, j: e.value.args[1] as Local });
        // Whole, the item made too, for where it leaves (dropped when
        // nothing reads it).
        return whole ? { ...e, value: itemAt(e.value.args[0] as Local, e.value.args[1] as Local), body: go(e.body) } : go(e.body);
      }
      // `item at`, checked: made from its columns, or no answer.
      if (e.k === "rt" && e.fn === `array.at${suffix}`) {
        const x = go(e.args[0]) as Local, jv = go(e.args[1]), j = f.locals.push("int") - 1;
        return { k: "let", i: j, value: jv, body: { k: "if", cond: rt(`array.cin${suffix}`, x, loc(j)), then: itemAt(x, loc(j)), else: { k: "fail" }, t: r } };
      }
      if (e.k === "let" && e.value.k === "local" && at.has(e.value.i)) { at.set(e.i, at.get(e.value.i)!); return whole ? { ...e, body: go(e.body) } : go(e.body); }
      if (e.k === "get") {
        const q = pathOf(e);
        if (q) {
          // The record it reads into: the item's, or the record in a field.
          let t = r as RType;
          for (const k of q.path.slice(0, -1)) t = t.fields[k].t as RType;
          return fieldAt(q.p, q.path, t.fields[q.path[q.path.length - 1]].t as RType);
        }
      }
      if (e.k === "rt" && e.fn === `array.length${suffix}`) return rt(`array.clength${suffix}`, ...e.args.map(go));
      if (e.k === "rt" && e.fn === `array.slice${suffix}`) return rt(`array.cslice${suffix}`, ...e.args.map(go));
      if (e.k === "rt" && e.fn === `array.of${suffix}`) return rt(`array.cof${suffix}`, ...e.args.map(go));
      // Pushed onto where a loop builds it; empty, with room to grow.
      if (e.k === "rt" && pushes.has(e)) return written(e.args[0], null, e.args[1], false);
      // A call of `array nil` too: a function of no inputs is worked out
      // once (core-js.ts), and each loop pushes onto an array of its own.
      if (grow && e.k === "call" && !e.cps && e.args.length === 0 && pushes.size && (b0 => b0.k === "rt" && b0.fn === `array.empty${suffix}`)(funcs[e.fn].body)) return rt(`array.cbuild${suffix}`);
      if (grow && e.k === "rt" && e.fn === `array.empty${suffix}` && ![...entries.values()].some((x) => x.call.args[2] === e || x.call.args[0] === e)) return rt(`array.cbuild${suffix}`);
      if (e.k === "rt" && fold && e === fold.put) return written(e.args[0], loc(fold.j), e.args[e.args.length - 1], REPLACE.test(e.fn));
      // A copy written into (above): the item replaced, or one more in front.
      if (grow && e.k === "rt" && /^array\.(replaceAt|replaceOwned|pushFront|pushFrontOwned)\./.test(e.fn) && ofA(e.fn)) {
        const front = e.fn.startsWith("array.pushFront"), j = f.locals.push("f64") - 1, c = f.locals.push(a as unknown as LType) - 1;
        const copy = rt(front ? `array.cfront${suffix}` : `array.ccopy${suffix}`, go(e.args[0]));
        return { k: "let", i: j, value: front ? { k: "num", v: 0 } : go(e.args[1]), body: { k: "let", i: c, value: copy, body: written(loc(c), loc(j), e.args[e.args.length - 1], false) } };
      }
      if (whole && e.k === "rt" && e.fn.startsWith("host:") && e.args.some(arrayOf)) return { ...e, args: e.args.map((x) => (!arrayOf(x) ? go(x) : x.k === "rt" ? { ...x, args: [rt(`array.crows${suffix}`, go(x.args[0]))] } : rt(`array.crows${suffix}`, go(x)))) };
      if (entry && e === entry.call) {
        const made = e.args[2];
        const args = made.k === "rt" && made.fn === `array.empty${suffix}` ? [e.args[0], e.args[1], rt(`array.cnew${suffix}`, e.args[1]), e.args[3]] : e.args;
        return { ...e, args: args.map(go) };
      }
      return mapKids(e, go);
    };
    // The record v put at position j of c: its fields written there, only
    // those it changes where it was made from the item it replaces.
    const written = (c: SExpr, j: Local | null, v: SExpr, replaces: boolean): SExpr => {
      const lets: { i: number; value: SExpr }[] = [];
      let x = v;
      while (x.k === "let") {
        if (x.value.k === "local" && at.has(x.value.i)) at.set(x.i, at.get(x.value.i)!);
        lets.push({ i: x.i, value: x.value });
        x = x.body;
      }
      let same = new Set<number>();
      if (x.k === "make") {
        // Made from the item at j of the array it is put into (the map's
        // own, owned-arrays.ts): the fields it keeps are there already.
        const from = x.into !== undefined ? at.get(x.into) : undefined;
        if (replaces && j && from && from.j.i === j.i && fold && from.x.i === fold.from) same = new Set(x.same ?? []);
      }
      // The value at a leaf's path in v: a part of a record made here, or
      // read from a let of it.
      const named = new Map<SExpr, Local>();
      // Through an `Optional` (G1b3): whether it is that case, or that
      // case's value, read by a match where it isn't made here (inside one,
      // `arm`, nothing is named: what it reads is bound there).
      // v once, in a let, where more than one leaf reads it.
      const once = (v: SExpr, t: LType, arm: boolean): SExpr => {
        let l: SExpr | undefined = v.k === "local" || arm ? v : named.get(v);
        // (Its value no tail call any more, where it was one: `moth at`
        // put in a map's closure, its call given whole.)
        if (!l) { const ti = f.locals.push(t) - 1; lets.push({ i: ti, value: (v.k === "call" || v.k === "apply") && v.tail ? { ...v, tail: false } : v }); l = loc(ti); named.set(v, l as Local); }
        return l;
      };
      const partOf = (v: SExpr, path: number[], t: LType, lf: Leaf, arm = false): SExpr => {
        if (!path.length) {
          if (!lf.opt) return v;
          if (v.k === "new") return { k: "bool", v: v.c === lf.some };
          v = once(v, lf.opt, arm);
          return { k: "case", scrut: v, s: f.locals.push(lf.opt) - 1, t: lf.opt, result: "i32", arms: lf.opt.cases.map((_, c) => ({ k: "bool", v: c === lf.some })) };
        }
        const [step, ...rest] = path;
        if (step === -1) {
          const d = t as DType, some = d.cases.findIndex((c) => c.fields.length === 1), vt = d.cases[some].fields[0].t;
          if (v.k === "new") return v.c === some ? partOf(v.args[0], rest, vt, lf, arm) : zeroOf(lf.t);
          v = once(v, d, arm);
          const si = f.locals.push(d) - 1;
          return { k: "case", scrut: v, s: si, t: d, result: lf.t, arms: d.cases.map((_, c) => (c === some ? partOf({ k: "field", rec: loc(si), t: d, c, i: 0 }, rest, vt, lf, true) : zeroOf(lf.t))) };
        }
        const rt0 = t as RType;
        if (v.k === "make") return partOf(v.args[step], rest, rt0.fields[step].t, lf, arm);
        return partOf({ k: "get", rec: once(v, t, arm), t: rt0, i: step }, rest, rt0.fields[step].t, lf, arm);
      };
      const ks = leaves.map((_, k) => k).filter((k) => !same.has(leaves[k].path[0]));
      const vals = ks.map((k) => partOf(x, leaves[k].path, r, leaves[k]));
      // The lets first (an item read in them still says what it said).
      const body: SExpr = j ? rt(`array.cset${ks.join("_")}${suffix}`, c, j, ...vals) : rt(`array.cpush${suffix}`, c, ...vals);
      return go(lets.reduceRight<SExpr>((b, l) => ({ k: "let", i: l.i, value: l.value, body: b }), body));
    };
    f.body = unread(go(f.body));
  }
  // WebAssembly (plain) has a column's make, length, check, reads and
  // writes (wasm.ts COL_FN); an array needing more stays rows there.
  if (plain) { const more = (e: SExpr): boolean => (e.k === "rt" && e.fn.endsWith(suffix) && /^array\.c(slice|of|rows|build|front|copy|push)\./.test(e.fn)) || kids(e).some(more); if (funcs.some((g) => more(g.body))) return false; }
  ir.funcs.splice(0, ir.funcs.length, ...funcs);
  if (whole) a.leaves = leaves.map((l) => l.t);
  if (leaves.some((l) => l.narrow)) a.narrow = leaves.map((l) => !!l.narrow);
  return true;
}

// A let of a column's read (or a local) that nothing reads, gone: the
// fields an item carries but its loop doesn't read stay out of the cache.
function unread(e: SExpr): SExpr {
  const x = mapKids(e, unread);
  if (x.k !== "let") return x;
  // Reads only, so dropping one changes nothing: of columns (an item's
  // Optional field remade from them too, G1b4), and records made of them.
  const read = (v: SExpr): boolean =>
    v.k === "local" || v.k === "num" || v.k === "int" || v.k === "bool" ||
    (v.k === "rt" && /^array\.c(get\d*|in|length)\./.test(v.fn)) ||
    ((v.k === "make" || v.k === "new") && v.args.every(read)) ||
    (v.k === "if" && read(v.cond) && read(v.then) && read(v.else)) ||
    (v.k === "let" && read(v.value) && read(v.body));
  const cheap = read(x.value);
  return cheap && !found(x.body, (y) => y.k === "local" && y.i === x.i) ? x.body : x;
}

// The pushes of loops building an array of a by pushes from an empty one
// (G1b2), each onto the array the loop carries: a function whose input p
// is such an array, read only as pushed onto, given to its next round
// (as it is, or pushed onto), or given back; and every call of it from
// elsewhere given an empty array there, new, so that nothing else holds
// the array pushed onto. `keep`'s loop (kept-items.ts):
//   L(a, i, out, …) = if … then let o = attempt V ok push(out, v) else out;
//                     L(a, i + 1, o, …) else out
function builtBy(funcs: SFunc[], now: Set<number>, a: AType, suffix: string): Set<SExpr> {
  const pushes = new Set<SExpr>();
  const PUSHED = `array.push${suffix}`, EMPTY = `array.empty${suffix}`;
  // A function whose body is an empty array of a (`array nil`).
  const empties = new Set([...now].filter((i) => { const b = funcs[i].body; return b.k === "rt" && b.fn === EMPTY; }));
  const isEmpty = (e: SExpr) => (e.k === "rt" && e.fn === EMPTY) || (e.k === "call" && !e.cps && empties.has(e.fn));
  // How many calls of i give it a new empty array at p, or −1 when one
  // doesn't.
  const givenNew = (i: number, p: number, depth: number): number => {
    let given = 0;
    for (const j of now) {
      if (j === i) continue;
      const g = funcs[j];
      const once = (l: number) => { let n = 0; found(g.body, (y) => { if (isLocal(y, l)) n++; return false; }); return n === 1; };
      const fresh = (x: SExpr): boolean => isEmpty(x) || (x.k === "local" && once(x.i) && (found(g.body, (y) => y.k === "let" && y.i === x.i && isEmpty(y.value)) || (x.i < g.params.length && depth < 3 && givenNew(j, x.i, depth + 1) >= 0)));
      let bad = false;
      found(g.body, (y) => { if (y.k === "call" && y.fn === i) { given++; if (!fresh(y.args[p])) bad = true; } return false; });
      if (bad) return -1;
    }
    return given;
  };
  for (const i of now) {
    const f = funcs[i];
    for (let p = 0; p < f.params.length; p++) {
      if (!isArray(f.params[p], a)) continue;
      const mine = new Set<SExpr>();
      // A value given to the next round at p: the array, a push onto it,
      // an attempt answering one or the array, or a let of one of those.
      const lets = new Map<number, SExpr>();
      let ok = true;
      const next = (v: SExpr): boolean => {
        if (isLocal(v, p)) return true;
        { const u = v as SExpr; if (u.k === "local" && lets.has(u.i)) { const x = lets.get(u.i)!; lets.delete(u.i); return next(x); } }
        if (v.k === "rt" && v.fn === PUSHED && isLocal(v.args[0], p) && !found(v.args[1], (y) => isLocal(y, p))) { mine.add(v); return true; }
        if (v.k === "attempt" && !found(v.body, (y) => isLocal(y, p))) return next(v.ok) && next(v.otherwise);
        return false;
      };
      const walk = (e: SExpr, tail: boolean): void => {
        if (!ok) return;
        if (tail && isLocal(e, p)) return;
        if (e.k === "local" && (e.i === p || lets.has(e.i))) { ok = false; return; }
        if (e.k === "let" && found(e.value, (y) => isLocal(y, p))) {
          // A round's value, used once, as the next round's at p.
          lets.set(e.i, e.value);
          walk(e.body, tail);
          if (lets.has(e.i)) ok = false;
          return;
        }
        if (e.k === "call" && e.fn === i && !e.cps) {
          if (!e.tail || !next(e.args[p])) { ok = false; return; }
          e.args.forEach((x, k) => k !== p && walk(x, false));
          return;
        }
        if (e.k === "if") { walk(e.cond, false); walk(e.then, tail); walk(e.else, tail); return; }
        if (e.k === "let") { walk(e.value, false); walk(e.body, tail); return; }
        kids(e).forEach((x) => walk(x, false));
      };
      walk(f.body, true);
      if (!ok || !mine.size) continue;
      // Every call from elsewhere given a new empty array at p (or an
      // input of a function every call of which is given one there).
      if (ok && givenNew(i, p, 0) > 0) mine.forEach((x) => pushes.add(x));
    }
  }
  return pushes;
}
