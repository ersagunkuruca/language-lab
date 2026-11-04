// Known bits of an Int on the core IR (C150d, step 1 of
// docs/design/numbers/MACHINE-WORDS-2026-11-03.md): for each Int a bound
// m with 0 ≤ x ≤ m wherever it can be found, so that a field that always
// fits in n bits can later be stored as an n-bit machine word (C150e).
// A word's maker is private (prelude-source.ts wordDefs): every word is
// built by `bits and 2ⁿ−1`, or by and, or, xor of two words, so its field's
// bound is the join over its few construction sites.
//
//   - an int literal ≥ 0 is its own bound;
//   - `x bits and m` is at most m when m is (and at most x when x is);
//   - or and xor of two values under 2ⁿ stay under 2ⁿ;
//   - x shifted down by a count ≥ 0 is at most x;
//   - a branch is the larger of its arms', a let is its value's;
//   - a record's field read is the join over every value put there (made,
//     or set), a call's the join over its function's answers.
//
// Anything else has no bound (null). The join is worked out again until
// nothing changes: the bounds come from the literals and 2ⁿ−1, so there
// are finitely many. Nothing is printed differently yet.
//
// Prior art: LLVM's computeKnownBits and GCC's nonzero-bits tracking; a
// field's bound as the join over its writes is a field-sensitive,
// flow-insensitive analysis (Andersen 1994's shape, on numbers).

import type { CoreIR, SExpr } from "./scalar.ts";
import { kids } from "./scalar.ts";

export type Bound = bigint | null;

// What every Int field and answer of the program is bounded by, by field
// key (`fieldKey`) and by function index; a field nothing puts a value into
// is missing.
export interface KnownBits { fields: Map<string, Bound>; results: Bound[]; of: (fn: number, e: SExpr) => Bound }

export const fieldKey = (t: { key: string }, c: number, i: number) => `${t.key}#${c}.${i}`;

const join = (a: Bound | undefined, b: Bound): Bound => (a === undefined ? b : a === null || b === null ? null : a > b ? a : b);
const ones = (m: bigint): bigint => { let n = 0n; while (m > 0n) { m >>= 1n; n++; } return (1n << n) - 1n; };

export function knownBits(ir: CoreIR): KnownBits {
  const fields = new Map<string, Bound>();
  let results: Bound[] = ir.funcs.map(() => null);
  let next: (Bound | undefined)[] = [];
  let changed = true;
  const put = (key: string, b: Bound) => {
    const was = fields.get(key), now = join(was, b);
    if (now !== was) { fields.set(key, now); changed = true; }
  };
  // Each function's locals, as its lets give them.
  const locals: Map<number, Bound>[] = ir.funcs.map(() => new Map());
  const ev = (fn: number, e: SExpr): Bound => {
    const env = locals[fn];
    const all = () => { for (const x of kids(e)) ev(fn, x); };
    switch (e.k) {
      case "int": return e.v >= 0n ? e.v : null;
      case "local": return env.get(e.i) ?? null;
      case "let": { const v = ev(fn, e.value); env.set(e.i, v); return ev(fn, e.body); }
      case "if": { ev(fn, e.cond); return join(ev(fn, e.then), ev(fn, e.else)); }
      case "case": { ev(fn, e.scrut); let b: Bound | undefined; for (const a of e.arms) if (a) b = join(b, ev(fn, a)); return b ?? null; }
      case "make": { e.args.forEach((x, i) => put(fieldKey(e.t, 0, i), ev(fn, x))); return null; }
      case "new": { e.args.forEach((x, i) => put(fieldKey(e.t, e.c, i), ev(fn, x))); return null; }
      case "set": { ev(fn, e.rec); put(fieldKey(e.t, 0, e.i), ev(fn, e.value)); return ev(fn, e.then); }
      case "get": { ev(fn, e.rec); return fields.get(fieldKey(e.t, 0, e.i)) ?? null; }
      case "field": { ev(fn, e.rec); return fields.get(fieldKey(e.t, e.c, e.i)) ?? null; }
      case "call": { all(); return results[e.fn] ?? null; }
      case "rt": {
        const xs = e.args.map((x) => ev(fn, x));
        const [a, b] = xs;
        switch (e.fn) {
          case "int.bitAnd": {
            // A negative and a bound m ≥ 0 is still at most m (two's complement).
            const ms = [a, b].filter((x): x is bigint => x !== null);
            return ms.length ? ms.reduce((x, y) => (x < y ? x : y)) : null;
          }
          case "int.bitOr": case "int.bitXor": return a !== null && b !== null ? ones(a > b ? a : b) : null;
          case "int.shiftDown": return a !== null && b !== null ? a : null;
          // A machine word (machine-words.ts, C150e): the IR after it.
          case "word32.narrow": return a;
          case "word32.widen": case "word32.shiftDown": return (1n << 32n) - 1n;
          default: return null;
        }
      }
      case "op": all(); return /^u(add|sub|mul|neg|and|or|xor)$/.test(e.op) ? (1n << 32n) - 1n : null;
      default: all(); return null;
    }
  };
  for (let round = 0; changed && round < 100; round++) {
    changed = false;
    next = ir.funcs.map(() => undefined);
    ir.funcs.forEach((f, i) => { locals[i].clear(); next[i] = ev(i, f.body); });
    const got = next.map((b) => b ?? null);
    if (got.some((b, i) => b !== results[i])) { results = got; changed = true; }
  }
  return { fields, results, of: ev };
}
