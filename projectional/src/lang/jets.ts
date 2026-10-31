// Host ways for library definitions the evaluator spends its time in
// (BACKLOG L118, a faster evaluator). A jet is a definition of the
// language run by native code that computes exactly what the definition
// says, operation for operation in the same order, so its answers are the
// same bits; the definition stays the meaning, and anything the jet
// doesn't take (a part that isn't a Float64) runs the definition itself.
// test/jets.test.ts checks each jet against its definition, and that the
// library's id is still the one named here: a changed definition has a new
// hash, so its jet stops applying until it is written again.
//
// Prior art: Urbit's jets (native code standing in for Nock formulas,
// recognised by hash, checked against them); Unison's builtins by hash.
// CREDITS.md.

import type { Id } from "../model.ts";
import type { Value } from "./run.ts";
import { CONS, NIL } from "./std.ts";

type Data = { tag: Id; fields: Value[] };
const nums = (v: Value): number[] | null => {
  const f = (v as Data)?.fields;
  return Array.isArray(f) && f.every((x) => typeof x === "number") ? (f as number[]) : null;
};

// The prelude's `table product` (ALGEBRA-TABLES.md): a fold over the
// table's lines, each line `times(e, f, g)` adding (a along e)·(b along f)
// times g to the rest's sum, where x along e is x and e multiplied part by
// part and added left to right. The fold builds the sum from the last line
// back, starting from a's shape with every part 0.
export const TABLE_PRODUCT = "@ilortmfvkbjt9bs8q02goksirf";
function tableProduct(table: Value, a: Value, b: Value): Value | null {
  const av = nums(a), bv = nums(b);
  if (!av || !bv) return null;
  const lines: [number[], number[], Data][] = [];
  let d = table as Data;
  for (; d?.tag === CONS; d = d.fields[1] as Data) {
    const line = d.fields[0] as Data;
    const [e, f, g] = line.fields;
    const ev = nums(e), fv = nums(f), gv = nums(g);
    if (!ev || !fv || !gv || ev.length !== av.length || fv.length !== bv.length) return null;
    lines.push([ev, fv, g as Data]);
  }
  if (d?.tag !== NIL) return null;
  const along = (x: number[], e: number[]) => { let s = x[0] * e[0]; for (let i = 1; i < x.length; i++) s = s + x[i] * e[i]; return s; };
  let acc: Data = { ...(a as Data), fields: av.map(() => 0) };
  for (let l = lines.length - 1; l >= 0; l--) {
    const [e, f, g] = lines[l];
    const w = along(av, e) * along(bv, f);
    const gs = g.fields as number[], rest = acc.fields as number[];
    if (rest.length !== gs.length) return null;
    acc = { ...g, fields: gs.map((x, i) => w * x + rest[i]) };
  }
  return acc;
}

// By definition id: given the definition's own value, the value to run.
export const JETS: Record<Id, (self: (...xs: Value[]) => Iterable<Value>) => (...xs: Value[]) => Iterable<Value>> = {
  [TABLE_PRODUCT]: (self) => (table, a, b) => {
    const v = tableProduct(table, a, b);
    return v === null ? self(table, a, b) : [v];
  },
};
