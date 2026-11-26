// A replace in an array written in place where nobody else can see the
// array it was given (C93 s4, IN-PLACE.md): machine's registers and memory,
// replaced at every step, where a version note for the old array and the
// GC's keeping it cost a third of primes' time (BACKLOG C93's measures).
//
// holders.ts says, per value, whether the array a replace is given has
// one holder and the replace is the last to use it (C327f: it decided by
// type before, one-holder.ts over the program's source). Then the replace
// is the runtime's replaceOwned, which writes the slot in place unless
// another view shares the buffer (a rest, a push into its room: std.ts
// marks the version), and otherwise is replaceIn.
//
// With `maps` (JavaScript, C60), an `array map` whose items keep their
// type, of an array with one holder that the map is the last to use,
// writes each item's answer into the slot it came from: drift's motes,
// moved a hundred times, each step making no new array. The map's fold
// walks from the back, reading slot i before it writes it and never
// after, so the items it reads are the ones given.

import type { Id } from "../../ters/src/model.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { holders, type Holders } from "./holders.ts";
import { isArray, kids, type CoreIR, type SExpr } from "./scalar.ts";

// The program's functions called from outside: main's own.
const rootsOf = (ir: CoreIR, main: Id) => ir.funcs.flatMap((g, i) => (g.def === main && !g.inner ? [i] : []));

// shared: holders() of main's functions, worked out once (after the maps)
// for the passes that read it (holders.ts sharedHolders).
export function ownedArrays(ir: CoreIR, main: Id, maps = false, shared?: () => Holders): number {
  const roots = rootsOf(ir, main);
  let n = maps ? mapsInPlace(ir, roots) : 0;
  for (const e of (shared ?? (() => holders(ir, roots)))().owned) if (e.k === "rt" && REPLACE.test(e.fn)) { e.fn = e.fn.replace(REPLACE, "array.replaceOwned.a$1"); n++; }
  return n;
}

const REPLACE = /^array\.replaceAt\.a(\d+)$/;

// An `array map` as lowered: `map(a, by)` calls its fold with the array,
// its length, an empty array and `by`; the fold, given (a, i, made, by),
// is `if i = 0 then made else let j = i - 1; let x = a[j]; fold(a, j,
// push front(made, by(x)), by)`. When the array read and the array made
// are of one type, and the array given has one holder and the map is the
// last to use it (holders.ts, the map counted as giving it away), the
// map gives the fold its own array to make, and each push front becomes
// the replace of slot j: the fold reads slot j before it writes it.
function mapsInPlace(ir: CoreIR, roots: number[]): number {
  const found = mapFolds(ir);
  if (!found.length) return 0;
  const maps = new Set(found.map((m) => m.map));
  const h = holders(ir, roots, maps);
  let n = 0;
  for (const m of found) {
    if (!h.one(m.map, 0)) continue;
    m.entry.args[2] = { k: "local", i: 0 };
    Object.assign(m.push, { fn: `array.replaceOwned.a${m.a}`, args: [m.push.args[0], { k: "local", i: m.j }, m.push.args[1]] });
    n++;
  }
  return n;
}

// Where arrays are counted (C, C60 c2): the same maps, each writing into
// the array it was given, which a replace does in place when nothing else
// counts it (c.ts replaceAt, Perceus's reuse) and in a copy otherwise, so
// no proof of one holder is needed. The fold reads each item from the
// array it writes, and is given an empty array where it read before, so
// the array it writes is counted once.
export function mapsInPlaceCounted(ir: CoreIR): number {
  let n = 0;
  for (const m of mapFolds(ir)) {
    const empty = m.entry.args[2];
    m.entry.args[2] = m.entry.args[0];
    m.entry.args[0] = empty;
    m.get.args[0] = { k: "local", i: 2 };
    Object.assign(m.push, { fn: `array.replaceAt.a${m.a}`, args: [m.push.args[0], { k: "local", i: m.j }, m.push.args[1]] });
    n++;
  }
  return n;
}

function mapFolds(ir: CoreIR) {
  const def = preludeDef("array map");
  if (!def) return [];
  const found: { map: number; entry: Extract<SExpr, { k: "call" }>; push: Extract<SExpr, { k: "rt" }>; get: Extract<SExpr, { k: "rt" }>; j: number; a: number }[] = [];
  for (const [fi, f] of ir.funcs.entries()) {
    const b = f.body;
    if (f.def !== def || b.k !== "call" || b.args.length !== 4) continue;
    const [a, len, empty, by] = b.args;
    const at = (e: SExpr, op: string) => e.k === "rt" && e.fn.startsWith(`array.${op}.a`) ? Number(e.fn.slice(`array.${op}.a`.length)) : null;
    if (a.k !== "local" || a.i !== 0 || by.k !== "local" || by.i !== 1 || at(empty, "empty") === null) continue;
    if (len.k !== "rt" || at(len, "length") === null || len.args[0]?.k !== "local" || (len.args[0] as { i: number }).i !== 0) continue;
    const fold = ir.funcs[b.fn];
    const fb = fold?.body;
    if (fb?.k !== "if" || fb.then.k !== "local" || fb.then.i !== 2) continue;
    const lj = fb.else;
    if (lj.k !== "let" || lj.value.k !== "rt" || lj.value.fn !== "int.sub" || lj.value.args[0]?.k !== "local" || (lj.value.args[0] as { i: number }).i !== 1) continue;
    const lx = lj.body;
    if (lx.k !== "let" || lx.value.k !== "rt" || at(lx.value, "get") === null) continue;
    const get = lx.value;
    if (get.args[0]?.k !== "local" || (get.args[0] as { i: number }).i !== 0 || get.args[1]?.k !== "local" || (get.args[1] as { i: number }).i !== lj.i) continue;
    const again = lx.body;
    if (again.k !== "call" || again.fn !== b.fn || again.args.length !== 4) continue;
    const [a2, j2, push, by2] = again.args;
    if (a2.k !== "local" || a2.i !== 0 || j2.k !== "local" || j2.i !== lj.i || by2.k !== "local" || by2.i !== 3) continue;
    if (push.k !== "rt" || at(push, "pushFront") === null || push.args[0]?.k !== "local" || (push.args[0] as { i: number }).i !== 2) continue;
    const t = at(get, "get");
    if (t !== at(push, "pushFront") || t !== at(empty, "empty")) continue;
    found.push({ map: fi, entry: b, push, get, j: lj.i, a: t! });
  }
  return found;
}
