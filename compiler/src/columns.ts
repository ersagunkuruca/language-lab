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

import { kids, mapKids, type AType, type CoreIR, type LType, type RType, type SExpr, type SFunc } from "./scalar.ts";

type Local = Extract<SExpr, { k: "local" }>;
const loc = (i: number): Local => ({ k: "local", i });
const isLocal = (e: SExpr | undefined, i?: number): e is Local => e?.k === "local" && (i === undefined || e.i === i);
const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
const isRecord = (t: LType | undefined): t is RType => typeof t === "object" && t !== null && "fields" in t && !("cases" in t);
const isArray = (t: LType | undefined, a: AType) => typeof t === "object" && t !== null && (t as { key?: string }).key === a.key;

// The ops on an array type that columns keep, by name.
const KEPT = /^array\.(get|at|length|empty|replaceOwned|pushFrontOwned|replaceAt|pushFront|push)\.a(\d+)$/;
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

// Calls of small plain functions put in place in f, where they take an
// item or make one that goes into an array: what columns need to see.
function inlined(ir: CoreIR, f: SFunc, self: number, wanted: (e: Extract<SExpr, { k: "call" }>) => boolean): void {
  for (let round = 0; round < 3; round++) {
    let changed = false;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      if (r.k !== "call" || r.cps || r.fn === self || !wanted(r)) return r;
      const g = ir.funcs[r.fn];
      if (g.multi || !plain(g.body) || size(g.body) > 200 || found(g.body, (x) => x.k === "call" && x.fn === r.fn)) return r;
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
export type Leaf = { path: number[]; t: LType };
export function leavesOf(r: RType, deep: boolean, at: number[] = []): Leaf[] {
  return r.fields.flatMap((x, k) => (deep && isRecord(x.t) && !x.t.mutable && x.t.fields.length ? leavesOf(x.t, deep, [...at, k]) : [{ path: [...at, k], t: x.t }]));
}

// `plain`: only records of plain fields (Float64, Int, Text, Bool), the
// columns WebAssembly keeps (wasm.ts colScan): there a record holding an
// array or a record stays a row (pack's, read by position since G3a).
// `grow` (JavaScript, G1b2): an array built by pushes in a loop from an
// empty one (`keep`'s, kept-items.ts) is columns too, growing as it is
// pushed onto; any empty array is columns with room to grow.
export function columns(ir: CoreIR, roots: number[], opts: { plain?: boolean; whole?: boolean; grow?: boolean } = {}): number {
  let n = 0;
  for (const a of ir.arrays) {
    const r = a.item;
    if (!isRecord(r) || !r.fields.length) continue;
    if (opts.plain && r.fields.some((x) => !["f64", "int", "text", "i32"].includes(x.t as string))) continue;
    if (stored(ir, a, r, roots, !!opts.whole, !!opts.grow)) n++;
  }
  return n;
}

function stored(ir: CoreIR, a: AType, r: RType, roots: number[], whole: boolean, grow: boolean): boolean {
  const leaves = leavesOf(r, whole);
  const leafAt = (path: number[]) => leaves.findIndex((l) => l.path.length === path.length && l.path.every((x, k) => x === path[k]));
  const suffix = `.a${a.index}`;
  const ofA = (fn: string) => fn.endsWith(suffix) && /^array\./.test(fn);
  if (!ir.funcs.some((f) => found(f.body, (e) => e.k === "rt" && e.fn === `array.get${suffix}`))) return false;
  // A copy to work on: nothing changes unless every use is one columns keep.
  const funcs = ir.funcs.map((f) => ({ ...f, locals: [...f.locals], ...(f.binders ? { binders: [...f.binders] } : {}) }));
  const work: CoreIR = { ...ir, funcs };
  const live = reached(work, roots);

  // Maps that may share on workers run in turn: over one of these arrays,
  // or making one (pack's `code tree`, mapping a map's entries to pairs: the
  // workers' answer was a plain array where its columns were read, C233).
  const inTurn = (e: SExpr): SExpr => {
    const x = mapKids(e, inTurn);
    return x.k === "if" && x.cond.k === "rt" && x.cond.fn === "map.worth" && (arrayOf(x.cond.args[0]) || isArray(x.t, a)) ? x.else : x;
  };
  let fnNow: SFunc = funcs[0];
  const arrayOf = (e: SExpr | undefined): boolean =>
    !!e && ((e.k === "local" && isArray(fnNow.locals[e.i], a)) || (e.k === "call" && isArray(funcs[e.fn].result, a)) || (e.k === "rt" && ofA(e.fn) && !e.fn.startsWith("array.get") && !e.fn.startsWith("array.length")) || (e.k === "let" && arrayOf(e.body)));
  for (const i of live) { fnNow = funcs[i]; funcs[i].body = inTurn(funcs[i].body); }
  const now = reached(work, roots);

  // Small functions given an item, or making one to put, put in place.
  for (const i of now) {
    const f = funcs[i];
    const items = new Set<number>();
    const w = (e: SExpr) => { if (e.k === "let" && e.value.k === "rt" && e.value.fn === `array.get${suffix}`) items.add(e.i); kids(e).forEach(w); };
    w(f.body);
    const puts = found(f.body, (e) => e.k === "rt" && ofA(e.fn) && (PUSH.test(e.fn) || REPLACE.test(e.fn)));
    const makes = (c: Extract<SExpr, { k: "call" }>) => { const t = funcs[c.fn].result; return isRecord(t) && t.key === r.key; };
    if (items.size || puts) inlined(work, f, i, (c) => (puts && makes(c)) || c.args.some((x) => isLocal(x) && items.has(x.i)));
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
            if (/^(push|replace)/.test(m[1]) && !(fold && fold.put === e) && !pushes.has(e)) return bad();
            if (m[1] === "empty" && !grow && ![...entries.values()].some((x) => x.call.args[2] === e || x.call.args[0] === e)) return bad();
            for (const x of e.args) walk(x, e);
            return;
          }
          if (e.args.some(arrayOf)) return bad();
          break;
        case "world": case "apply": case "closure": case "new": case "list":
          // Whole, a closure may keep the array and one applied may be
          // given it: their code is reached from the roots and kept to
          // columns too. Items are made where read.
          if (whole && (e.k === "closure" || e.k === "apply")) break;
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
    const at = new Map<number, { x: Local; j: Local }>();
    const entry = entries.get(i), fold = folds.get(i);
    // The record (or the record in a field, by its path) at j of x, made
    // from its columns.
    const madeAt = (x: Local, j: Local, t: RType, path: number[]): SExpr =>
      ({ k: "make", t, args: t.fields.map((fd, k) => { const l = leafAt([...path, k]); return l >= 0 ? rt(`array.cget${l}${suffix}`, x, j) : madeAt(x, j, fd.t as RType, [...path, k]); }) });
    // A read of a field of a record at a path in an item.
    const fieldAt = (p: { x: Local; j: Local }, path: number[], t: RType): SExpr => {
      const l = leafAt(path);
      return l >= 0 ? rt(`array.cget${l}${suffix}`, p.x, p.j) : madeAt(p.x, p.j, t, path);
    };
    // A get of a get … of an item: its path, or null.
    const pathOf = (e: SExpr): { p: { x: Local; j: Local }; path: number[] } | null => {
      if (e.k === "local" && at.has(e.i)) return { p: at.get(e.i)!, path: [] };
      if (e.k === "get") { const q = pathOf(e.rec); return q && (whole || !q.path.length) ? { p: q.p, path: [...q.path, e.i] } : null; }
      return null;
    };
    const go = (e: SExpr): SExpr => {
      if (e.k === "let" && e.value.k === "rt" && e.value.fn === `array.get${suffix}`) {
        at.set(e.i, { x: e.value.args[0] as Local, j: e.value.args[1] as Local });
        // Whole, the item made too, for where it leaves (dropped when
        // nothing reads it).
        return whole ? { ...e, value: madeAt(e.value.args[0] as Local, e.value.args[1] as Local, r, []), body: go(e.body) } : go(e.body);
      }
      // `item at`, checked: made from its columns, or no answer.
      if (e.k === "rt" && e.fn === `array.at${suffix}`) {
        const x = go(e.args[0]) as Local, jv = go(e.args[1]), j = f.locals.push("int") - 1;
        return { k: "let", i: j, value: jv, body: { k: "if", cond: rt(`array.cin${suffix}`, x, loc(j)), then: madeAt(x, loc(j), r, []), else: { k: "fail" }, t: r } };
      }
      if (e.k === "let" && e.value.k === "local" && at.has(e.value.i)) { at.set(e.i, at.get(e.value.i)!); return whole ? { ...e, body: go(e.body) } : go(e.body); }
      if (e.k === "get") {
        const q = pathOf(e);
        if (q) {
          // The record it reads into: the item's, or the record in a field.
          let t: RType = r;
          for (const k of q.path.slice(0, -1)) t = t.fields[k].t as RType;
          return fieldAt(q.p, q.path, t.fields[q.path[q.path.length - 1]].t as RType);
        }
      }
      if (e.k === "rt" && e.fn === `array.length${suffix}`) return rt(`array.clength${suffix}`, ...e.args.map(go));
      // Pushed onto where a loop builds it; empty, with room to grow.
      if (e.k === "rt" && pushes.has(e)) return written(e.args[0], null, e.args[1], false);
      // A call of `array nil` too: a function of no inputs is worked out
      // once (core-js.ts), and each loop pushes onto an array of its own.
      if (grow && e.k === "call" && !e.cps && e.args.length === 0 && pushes.size && (b0 => b0.k === "rt" && b0.fn === `array.empty${suffix}`)(funcs[e.fn].body)) return rt(`array.cbuild${suffix}`);
      if (grow && e.k === "rt" && e.fn === `array.empty${suffix}` && ![...entries.values()].some((x) => x.call.args[2] === e || x.call.args[0] === e)) return rt(`array.cbuild${suffix}`);
      if (e.k === "rt" && fold && e === fold.put) return written(e.args[0], loc(fold.j), e.args[e.args.length - 1], REPLACE.test(e.fn));
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
      const partOf = (v: SExpr, path: number[], t: RType): SExpr => {
        if (!path.length) return v;
        if (v.k === "make") return partOf(v.args[path[0]], path.slice(1), t.fields[path[0]].t as RType);
        let l = v.k === "local" ? v : named.get(v);
        if (!l) { const ti = f.locals.push(t) - 1; lets.push({ i: ti, value: v }); l = loc(ti); named.set(v, l); }
        return partOf({ k: "get", rec: l, t, i: path[0] }, path.slice(1), t.fields[path[0]].t as RType);
      };
      const ks = leaves.map((_, k) => k).filter((k) => !same.has(leaves[k].path[0]));
      const vals = ks.map((k) => partOf(x, leaves[k].path, r));
      // The lets first (an item read in them still says what it said).
      const body: SExpr = j ? rt(`array.cset${ks.join("_")}${suffix}`, c, j, ...vals) : rt(`array.cpush${suffix}`, c, ...vals);
      return go(lets.reduceRight<SExpr>((b, l) => ({ k: "let", i: l.i, value: l.value, body: b }), body));
    };
    f.body = unread(go(f.body));
  }
  ir.funcs.splice(0, ir.funcs.length, ...funcs);
  if (whole) a.leaves = leaves.map((l) => l.t);
  return true;
}

// A let of a column's read (or a local) that nothing reads, gone: the
// fields an item carries but its loop doesn't read stay out of the cache.
function unread(e: SExpr): SExpr {
  const x = mapKids(e, unread);
  if (x.k !== "let") return x;
  const read = (v: SExpr): boolean => v.k === "local" || (v.k === "rt" && v.fn.startsWith("array.cget")) || (v.k === "make" && v.args.every(read));
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
