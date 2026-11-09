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

import type { Code, Id } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { oneHolder } from "../../ters/src/lang/one-holder.ts";
import { ARRAY_OPS } from "../../ters/src/lang/std.ts";
import { ARRAY, INT, NUMBER, STRING } from "../../ters/src/lang/types.ts";
import { kids, type CoreIR, type SExpr } from "./scalar.ts";

const REPLACE = /^array\.replaceAt\.a(\d+)$/;

export function ownedArrays(ir: CoreIR, code: Code, info: Info, names: Record<Id, string>, main: Id): number {
  // The array types a replace is made in.
  const used = new Set<number>();
  const scan = (e: SExpr) => { if (e.k === "rt") { const m = REPLACE.exec(e.fn); if (m) used.add(Number(m[1])); } kids(e).forEach(scan); };
  ir.funcs.forEach((f) => scan(f.body));
  if (!used.size) return 0;
  const ops = ARRAY_OPS as Record<string, Id>;
  const jobs = new Set(Object.values(ops)), changes = new Map([[ops.replaceAt, 0]]);
  const owned = new Set<number>();
  for (const a of used) {
    const t = ir.arrays[a]?.item;
    const item = t === "int" || t === "int32" ? INT : t === "f64" ? NUMBER : t === "text" ? STRING : undefined;
    if (item && oneHolder(code, info, main, new Set([ARRAY]), jobs, changes, names, item).ok) owned.add(a);
  }
  if (!owned.size) return 0;
  let n = 0;
  const put = (e: SExpr) => {
    if (e.k === "rt") { const m = REPLACE.exec(e.fn); if (m && owned.has(Number(m[1]))) { e.fn = `array.replaceOwned.a${m[1]}`; n++; } }
    kids(e).forEach(put);
  };
  ir.funcs.forEach((f) => put(f.body));
  return n;
}
