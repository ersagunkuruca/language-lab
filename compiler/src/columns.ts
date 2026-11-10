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

import { kids, mapKids, type AType, type CoreIR, type LType, type RType, type SExpr, type SFunc } from "./scalar.ts";

type Local = Extract<SExpr, { k: "local" }>;
const loc = (i: number): Local => ({ k: "local", i });
const isLocal = (e: SExpr | undefined, i?: number): e is Local => e?.k === "local" && (i === undefined || e.i === i);
const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
const isRecord = (t: LType | undefined): t is RType => typeof t === "object" && t !== null && "fields" in t && !("cases" in t);
const isArray = (t: LType | undefined, a: AType) => typeof t === "object" && t !== null && (t as { key?: string }).key === a.key;

// The ops on an array type that columns keep, by name.
const KEPT = /^array\.(get|length|empty|replaceOwned|pushFrontOwned|replaceAt|pushFront)\.a(\d+)$/;
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

export function columns(ir: CoreIR, roots: number[]): number {
  let n = 0;
  for (const a of ir.arrays) {
    const r = a.item;
    if (!isRecord(r) || !r.fields.length) continue;
    if (stored(ir, a, r, roots)) n++;
  }
  return n;
}

function stored(ir: CoreIR, a: AType, r: RType, roots: number[]): boolean {
  const suffix = `.a${a.index}`;
  const ofA = (fn: string) => fn.endsWith(suffix) && /^array\./.test(fn);
  if (!ir.funcs.some((f) => found(f.body, (e) => e.k === "rt" && e.fn === `array.get${suffix}`))) return false;
  // A copy to work on: nothing changes unless every use is one columns keep.
  const funcs = ir.funcs.map((f) => ({ ...f, locals: [...f.locals], ...(f.binders ? { binders: [...f.binders] } : {}) }));
  const work: CoreIR = { ...ir, funcs };
  const live = reached(work, roots);

  // Maps that may share on workers run in turn.
  const inTurn = (e: SExpr): SExpr => {
    const x = mapKids(e, inTurn);
    return x.k === "if" && x.cond.k === "rt" && x.cond.fn === "map.worth" && arrayOf(x.cond.args[0]) ? x.else : x;
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

  // Every use of a, and of an item read of it, is one columns keep?
  for (const i of now) {
    const f = funcs[i];
    fnNow = f;
    const items = new Map<number, true>();
    const fold = folds.get(i);
    let ok = true;
    const bad = () => { ok = false; };
    const isItem = (e: SExpr) => e.k === "local" && items.has(e.i);
    let terminal: SExpr | undefined;
    if (fold) { terminal = fold.put.args[fold.put.args.length - 1]; while (terminal.k === "let") terminal = terminal.body; }
    const walk = (e: SExpr, under?: SExpr): void => {
      if (!ok) return;
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
          // An item read only field by field, or written into.
          if (isItem(e) && !(under?.k === "get" && under.rec === e)) return bad();
          return;
        case "make":
          if (e.into !== undefined && items.has(e.into) && e !== terminal) return bad();
          break;
        case "rt":
          if (ofA(e.fn)) {
            const m = KEPT.exec(e.fn);
            if (!m) return bad();
            if (m[1] === "get" && under?.k !== "let") return bad();
            if (/^(push|replace)/.test(m[1]) && !(fold && fold.put === e)) return bad();
            if (m[1] === "empty" && ![...entries.values()].some((x) => x.call.args[2] === e || x.call.args[0] === e)) return bad();
            for (const x of e.args) walk(x, e);
            return;
          }
          if (e.args.some(arrayOf)) return bad();
          break;
        case "world": case "apply": case "closure": case "new": case "list":
          if ((e.k === "closure" ? e.caps : e.k === "list" ? e.items : e.args).some((x: SExpr) => arrayOf(x) || isItem(x))) return bad();
          break;
        case "call":
          if (e.args.some(isItem)) return bad();
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
    const go = (e: SExpr): SExpr => {
      if (e.k === "let" && e.value.k === "rt" && e.value.fn === `array.get${suffix}`) {
        at.set(e.i, { x: e.value.args[0] as Local, j: e.value.args[1] as Local });
        return go(e.body);
      }
      if (e.k === "let" && e.value.k === "local" && at.has(e.value.i)) { at.set(e.i, at.get(e.value.i)!); return go(e.body); }
      if (e.k === "get" && e.rec.k === "local" && at.has(e.rec.i)) { const p = at.get(e.rec.i)!; return rt(`array.cget${e.i}${suffix}`, p.x, p.j); }
      if (e.k === "rt" && e.fn === `array.length${suffix}`) return rt(`array.clength${suffix}`, ...e.args.map(go));
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
    const written = (c: SExpr, j: Local, v: SExpr, replaces: boolean): SExpr => {
      const lets: { i: number; value: SExpr }[] = [];
      let x = v;
      while (x.k === "let") {
        if (x.value.k === "local" && at.has(x.value.i)) at.set(x.i, at.get(x.value.i)!);
        lets.push({ i: x.i, value: x.value });
        x = x.body;
      }
      let ks: number[], vals: SExpr[];
      if (x.k === "make") {
        // Made from the item at j of the array it is put into (the map's
        // own, owned-arrays.ts): the fields it keeps are there already.
        const from = x.into !== undefined ? at.get(x.into) : undefined;
        const same = replaces && from && from.j.i === j.i && fold && from.x.i === fold.from ? new Set(x.same ?? []) : new Set<number>();
        ks = r.fields.map((_, k) => k).filter((k) => !same.has(k));
        vals = ks.map((k) => x.k === "make" ? x.args[k] : x);
      } else {
        const t = f.locals.push(r) - 1;
        lets.push({ i: t, value: x });
        ks = r.fields.map((_, k) => k);
        vals = ks.map((k): SExpr => ({ k: "get", rec: loc(t), t: r, i: k }));
      }
      // The lets first (an item read in them still says what it said).
      const body: SExpr = rt(`array.cset${ks.join("_")}${suffix}`, c, j, ...vals);
      return go(lets.reduceRight<SExpr>((b, l) => ({ k: "let", i: l.i, value: l.value, body: b }), body));
    };
    f.body = unread(go(f.body));
  }
  ir.funcs.splice(0, ir.funcs.length, ...funcs);
  return true;
}

// A let of a column's read (or a local) that nothing reads, gone: the
// fields an item carries but its loop doesn't read stay out of the cache.
function unread(e: SExpr): SExpr {
  const x = mapKids(e, unread);
  if (x.k !== "let") return x;
  const cheap = x.value.k === "local" || (x.value.k === "rt" && x.value.fn.startsWith("array.cget"));
  return cheap && !found(x.body, (y) => y.k === "local" && y.i === x.i) ? x.body : x;
}
