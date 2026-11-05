// The library's host ways for its pure definitions (L206): native code
// that computes exactly what a definition says, operation for operation in
// the same order, so its answers are the same bits. The definition stays
// the meaning, and anything the host way doesn't take (a part that isn't
// a Float64) runs the definition itself. Each is declared here by the
// definition's name, beside the library's other host code (collation.ts,
// graphemes.ts); library.ts finds the definition, and test/jets.test.ts
// checks each against it. A changed definition keeps its host way only
// while that test passes.
//
// Prior art: Urbit's jets (native code standing in for Nock formulas,
// checked against them); Unison's builtins; Gleam's `@external` beside a
// definition. CREDITS.md.

import type { PureHost } from "../src/lang/hosts.ts";
import type { Value } from "../src/lang/run.ts";
import { CONS, NIL } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

type Data = { tag: Id; fields: Value[] };
const nums = (v: Value): number[] | null => {
  const f = (v as Data)?.fields;
  if (!Array.isArray(f)) return null;
  for (let i = 0; i < f.length; i++) if (typeof f[i] !== "number") return null;
  return f as number[];
};

// `table product` (ALGEBRA-TABLES.md): a fold over the
// table's lines, each line `times(e, f, g)` adding (a along e)·(b along f)
// times g to the rest's sum, where x along e is x and e multiplied part by
// part and added left to right. The fold builds the sum from the last line
// back, starting from a's shape with every part 0.
// A table read once: values don't change, so each line's e, f and g are
// checked and kept by the table's identity.
type Line = { e: number[]; f: number[]; g: Data; gs: number[] };
const tables = new WeakMap<object, Line[] | null>();
function linesOf(table: Value): Line[] | null {
  if (typeof table !== "object" || table === null) return null;
  const kept = tables.get(table);
  if (kept !== undefined) return kept;
  let lines: Line[] | null = [];
  let d = table as Data;
  for (; d?.tag === CONS; d = d.fields[1] as Data) {
    const [e, f, g] = (d.fields[0] as Data).fields;
    const ev = nums(e), fv = nums(f), gv = nums(g);
    if (!ev || !fv || !gv) { lines = null; break; }
    lines.push({ e: ev, f: fv, g: g as Data, gs: gv });
  }
  if (lines && d?.tag !== NIL) lines = null;
  tables.set(table, lines);
  return lines;
}
function tableProduct(table: Value, a: Value, b: Value): Value | null {
  const av = nums(a), bv = nums(b);
  const lines = av && bv ? linesOf(table) : null;
  if (!av || !bv || !lines) return null;
  const along = (x: number[], e: number[]) => { let s = x[0] * e[0]; for (let i = 1; i < x.length; i++) s = s + x[i] * e[i]; return s; };
  let acc: Data = { tag: (a as Data).tag, fields: av.map(() => 0) };
  for (let l = lines.length - 1; l >= 0; l--) {
    const { e, f, g, gs } = lines[l];
    if (e.length !== av.length || f.length !== bv.length) return null;
    const w = along(av, e) * along(bv, f);
    const rest = acc.fields as number[];
    if (rest.length !== gs.length) return null;
    const out = new Array<number>(gs.length);
    for (let i = 0; i < gs.length; i++) out[i] = w * gs[i] + rest[i];
    acc = { ...g, fields: out };
  }
  return acc;
}

// By the definition's name in the library.
export const LIBRARY_HOSTS: Record<string, PureHost> = {
  "table product": (self) => (table, a, b) => {
    const v = tableProduct(table, a, b);
    return v === null ? self(table, a, b) : [v];
  },
};
