// A replace in an array written in place where nobody else can see the
// array it was given (C93 s4, IN-PLACE.md): machine's registers and memory,
// replaced at every step, where a version note for the old array and the
// GC's keeping it cost a third of primes' time (BACKLOG C93's measures).
//
// one-holder.ts says, from the program alone, whether every array of an
// item type has one holder: changed by `replace in array` and nothing else
// may read it after. Then that type's replaces are the runtime's
// replaceOwned, which writes the slot in place unless another view shares
// the buffer (a rest, a push into its room: std.ts marks the version), and
// otherwise is replaceIn. Ints, Float64s and Texts as items.
//
// With `maps` (JavaScript, C60), an `array map` whose items keep their
// type, of an array whose every value has one holder (the map counting
// as a change of it), writes each item's answer into the slot it came
// from: drift's motes, moved a hundred times, each step making no new
// array. The map's fold walks from the back, reading slot i before it
// writes it and never after, so the items it reads are the ones given.

import type { Code, Id } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { oneHolder } from "../../ters/src/lang/one-holder.ts";
import { ARRAY_OPS } from "../../ters/src/lang/std.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { ARRAY, INT, NUMBER, STRING } from "../../ters/src/lang/types.ts";
import { kids, type CoreIR, type SExpr } from "./scalar.ts";

const REPLACE = /^array\.replaceAt\.a(\d+)$/;

export function ownedArrays(ir: CoreIR, code: Code, info: Info, names: Record<Id, string>, main: Id, maps = false): number {
  const n = maps ? mapsInPlace(ir, code, info, names, main) : 0;
  // The array types a replace is made in.
  const used = new Set<number>();
  const scan = (e: SExpr) => { if (e.k === "rt") { const m = REPLACE.exec(e.fn); if (m) used.add(Number(m[1])); } kids(e).forEach(scan); };
  ir.funcs.forEach((f) => scan(f.body));
  if (!used.size) return n;
  const ops = ARRAY_OPS as Record<string, Id>;
  const jobs = new Set(Object.values(ops)), changes = new Map([[ops.replaceAt, 0]]);
  const owned = new Set<number>();
  for (const a of used) {
    const t = ir.arrays[a]?.item;
    const item = t === "int" || t === "int32" ? INT : t === "f64" ? NUMBER : t === "text" ? STRING : undefined;
    if (item && oneHolder(code, info, main, new Set([ARRAY]), jobs, changes, names, item).ok) owned.add(a);
  }
  if (!owned.size) return n;
  let total = n;
  const put = (e: SExpr) => {
    if (e.k === "rt") { const m = REPLACE.exec(e.fn); if (m && owned.has(Number(m[1]))) { e.fn = `array.replaceOwned.a${m[1]}`; total++; } }
    kids(e).forEach(put);
  };
  ir.funcs.forEach((f) => put(f.body));
  return total;
}

// An `array map` as lowered: `map(a, by)` calls its fold with the array,
// its length, an empty array and `by`; the fold, given (a, i, made, by),
// is `if i = 0 then made else let j = i - 1; let x = a[j]; fold(a, j,
// push front(made, by(x)), by)`. When the array read and the array made
// are of one type, and every array of it has one holder, the map gives
// the fold its own array to make, and each push front becomes the
// replace of slot j.
function mapsInPlace(ir: CoreIR, code: Code, info: Info, names: Record<Id, string>, main: Id): number {
  const def = preludeDef("array map");
  if (!def) return 0;
  const found: { entry: Extract<SExpr, { k: "call" }>; push: Extract<SExpr, { k: "rt" }>; j: number; a: number }[] = [];
  for (const f of ir.funcs) {
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
    found.push({ entry: b, push, j: lj.i, a: t! });
  }
  if (!found.length) return 0;
  const ops = ARRAY_OPS as Record<string, Id>;
  const jobs = new Set([...Object.values(ops), def]), changes = new Map([[ops.replaceAt, 0], [def, 0]]);
  const owned = new Map<number, boolean>();
  const ownedOf = (a: number): boolean => {
    if (!owned.has(a)) {
      const t = ir.arrays[a]?.item;
      const item = t === "int" || t === "int32" ? INT : t === "f64" ? NUMBER : t === "text" ? STRING : typeof t === "object" && t !== null && "def" in t ? (t as { def: Id }).def : undefined;
      owned.set(a, !!item && oneHolder(code, info, main, new Set([ARRAY]), jobs, changes, names, item).ok);
    }
    return owned.get(a)!;
  };
  let n = 0;
  for (const m of found) {
    if (!ownedOf(m.a)) continue;
    m.entry.args[2] = { k: "local", i: 0 };
    Object.assign(m.push, { fn: `array.replaceOwned.a${m.a}`, args: [m.push.args[0], { k: "local", i: m.j }, m.push.args[1]] });
    n++;
  }
  return n;
}
