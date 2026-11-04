// Words as machine words (C150e and C150f, steps 2 and 3 of
// docs/design/numbers/MACHINE-WORDS-2026-11-03.md): a record's Int field
// that known-bits.ts proves is always under 2³² is stored as a 32-bit
// machine word (an i32 holding the bits, read unsigned), and a word's
// operation that masks its answer back into the word becomes the
// machine's wrapping operation, so the Int in between is never made.
//
//   - Building the record narrows the Int (free: the bound is proved);
//     reading the field widens it, unless what reads it takes a word.
//   - A local let to such a field is a word too; its other uses widen it.
//   - `(a op b) bits and 2³²−1` on two words, for + − ×, is the wrapping
//     op; negate and shifts the same; and, or, xor of two words need no
//     mask; `less` of two words is the unsigned compare.
//
// Only records (one case): the runtime never builds one, so every value
// put in a record's field is one known-bits.ts saw. A data type's field
// isn't (int.range builds List Int). For WebAssembly and C, where an Int
// is a tagged value and each step on it a call; core JS keeps the
// evaluator's values, which the host reads (lowerScalar skips it there).
// Word64 stays an Int for now: a word past 2⁶³ doesn't fit either's i64.

import type { CoreIR, LType, RType, SExpr, SFunc } from "./scalar.ts";
import { isRecord, kids, mapKids } from "./scalar.ts";
import { fieldKey, knownBits } from "./known-bits.ts";

const TOP32 = (1n << 32n) - 1n;
const WIDEN = "word32.widen", NARROW = "word32.narrow";

const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
type Rt = Extract<SExpr, { k: "rt" }>;
// The word an Int is widened from, if it is.
const under = (e: SExpr): SExpr | null => (e.k === "rt" && e.fn === WIDEN ? e.args[0] : null);
const isRt = (e: SExpr, fn: string): e is Rt => e.k === "rt" && e.fn === fn;
const widen = (x: SExpr): SExpr => rt(WIDEN, x);

// The word under an Int known to fit: what a mask back into 32 bits, or a
// narrowing, can use without making the Int.
function narrow(x: SExpr): SExpr {
  const w = under(x);
  if (w) return w;
  if (x.k === "rt" && x.args.length === 2) {
    const [a, b] = x.args, wa = under(a), wb = under(b);
    if (wa && wb && x.fn === "int.bitAnd") return { k: "op", op: "uand", args: [wa, wb] };
    if (wa && wb && x.fn === "int.bitOr") return { k: "op", op: "uor", args: [wa, wb] };
    if (wa && wb && x.fn === "int.bitXor") return { k: "op", op: "uxor", args: [wa, wb] };
    if (x.fn === "int.bitAnd" && b.k === "int" && b.v === TOP32) {
      if (wa) return wa;
      if (a.k === "rt" && a.args.length === 2 && under(a.args[0])) {
        const p = under(a.args[0])!, q = a.args[1], wq = under(q);
        const op = ({ "int.add": "uadd", "int.sub": "usub", "int.mul": "umul" } as Record<string, "uadd" | "usub" | "umul">)[a.fn];
        if (op && wq) return { k: "op", op, args: [p, wq] };
        // A count written as a literal shifting up is a negative literal.
        if (a.fn === "int.shiftDown") return rt("word32.shiftDown", p, isRt(q, "int.neg") && q.args[0].k === "int" ? { k: "int", v: -q.args[0].v } : q);
      }
      if (isRt(a, "int.neg") && under(a.args[0])) return { k: "op", op: "uneg", args: [under(a.args[0])!] };
    }
  }
  return rt(NARROW, x);
}

export function machineWords(ir: CoreIR): void {
  const kb = knownBits(ir);
  // The fields stored as words, by fieldKey.
  const words = new Set<string>();
  for (const r of ir.records) r.fields.forEach((f, i) => {
    const b = kb.fields.get(fieldKey(r, 0, i));
    if (f.t === "int" && b !== undefined && b !== null && b <= TOP32) words.add(fieldKey(r, 0, i));
  });
  if (!words.size) return;
  const isWord = (t: RType, i: number) => words.has(fieldKey(t, 0, i));
  // Every copy of a record's type the IR holds says its field is a word.
  const seen = new Set<object>();
  const retype = (t: unknown) => {
    if (typeof t !== "object" || t === null || seen.has(t)) return;
    seen.add(t);
    if (isRecord(t as LType)) (t as RType).fields.forEach((f, i) => { if (isWord(t as RType, i)) f.t = "i32"; });
    for (const v of Object.values(t)) retype(v);
  };
  [ir.records, ir.data, ir.arrays, ir.tables, ir.fns, ir.shapes].forEach(retype);
  ir.funcs.forEach((f) => [f.params, f.locals, f.result, f.answer].forEach(retype));
  for (const f of ir.funcs) {
    // Locals only ever let to a word field (and not bound any other way).
    const lets = new Map<number, boolean>(), other = new Set<number>();
    const look = (e: SExpr) => {
      if ("t" in e) retype(e.t);
      if (e.k === "let") lets.set(e.i, (lets.get(e.i) ?? true) && e.value.k === "get" && isWord(e.value.t, e.value.i));
      if (e.k === "case") other.add(e.s);
      if (e.k === "attempt" || e.k === "search" || e.k === "budget") other.add(e.res);
      if (e.k === "apply") other.add(e.tmp);
      if (e.k === "list") { other.add(e.item); other.add(e.acc); }
      if (e.k === "handle") other.add(e.reason);
      kids(e).forEach(look);
    };
    look(f.body);
    const wordLocal = new Set([...lets].filter(([i, w]) => w && i >= f.params.length && !other.has(i)).map(([i]) => i));
    wordLocal.forEach((i) => { f.locals[i] = "i32"; });
    f.body = rewrite(f, f.body, wordLocal, isWord);
  }
}

function rewrite(f: SFunc, e: SExpr, wordLocal: Set<number>, isWord: (t: RType, i: number) => boolean): SExpr {
  const go = (x: SExpr) => rewrite(f, x, wordLocal, isWord);
  const r = mapKids(e, go);
  switch (r.k) {
    case "local": return wordLocal.has(r.i) ? widen(r) : r;
    case "get": return isWord(r.t, r.i) ? widen(r) : r;
    case "let": return wordLocal.has(r.i) ? { ...r, value: narrow(r.value) } : r;
    case "make": return { ...r, args: r.args.map((x, i) => (isWord(r.t, i) ? narrow(x) : x)) };
    case "set": return isWord(r.t, r.i) ? { ...r, value: narrow(r.value) } : r;
    case "rt": {
      const [a, b] = r.args;
      const wa = a && under(a), wb = b && under(b);
      if (r.fn === "int.less" && wa && wb) return { k: "op", op: "uless", args: [wa, wb] };
      return r;
    }
    default: return r;
  }
}
