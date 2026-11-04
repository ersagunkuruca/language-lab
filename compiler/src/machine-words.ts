// Words as machine words (C150e and C150f, steps 2 and 3 of
// docs/design/numbers/MACHINE-WORDS-2026-11-03.md): a record's Int field
// that known-bits.ts proves is always under 2³² is stored as a 32-bit
// machine word (an i32 holding the bits, read unsigned), one under 2⁶⁴
// a 64-bit one (an i64), and a word's operation that masks its answer back into the word becomes the
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
// A field under 2⁶⁴ (Word64, C150h) is an i64 the same way, widened past
// 2⁶³ through limbs.

import type { CoreIR, LType, RType, SExpr, SFunc } from "./scalar.ts";
import { isRecord, kids, mapKids } from "./scalar.ts";
import { fieldKey, knownBits } from "./known-bits.ts";

type Width = 32 | 64;
const TOP: Record<Width, bigint> = { 32: (1n << 32n) - 1n, 64: (1n << 64n) - 1n };
// A word's machine type, and its operations' names.
const TYPE = { 32: "i32", 64: "i64" } as const;
const OP = {
  32: { add: "uadd", sub: "usub", mul: "umul", neg: "uneg", and: "uand", or: "uor", xor: "uxor", less: "uless" },
  64: { add: "u64add", sub: "u64sub", mul: "u64mul", neg: "u64neg", and: "u64and", or: "u64or", xor: "u64xor", less: "u64less" },
} as const;
const fn = (w: Width, name: string) => `word${w}.${name}`;

const rt = (f: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn: f, args });
type Rt = Extract<SExpr, { k: "rt" }>;
// The word of width w an Int is widened from, if it is.
const under = (e: SExpr, w: Width): SExpr | null => (e.k === "rt" && e.fn === fn(w, "widen") ? e.args[0] : null);
const isRt = (e: SExpr, f: string): e is Rt => e.k === "rt" && e.fn === f;
const widen = (x: SExpr, w: Width): SExpr => rt(fn(w, "widen"), x);
const op = (w: Width, o: keyof (typeof OP)[32], args: SExpr[]): SExpr => ({ k: "op", op: OP[w][o], args });

// The word under an Int known to fit w bits: what a mask back into w
// bits, or a narrowing, can use without making the Int.
function narrow(x: SExpr, w: Width): SExpr {
  const u = under(x, w);
  if (u) return u;
  if (x.k === "rt" && x.args.length === 2) {
    const [a, b] = x.args, wa = under(a, w), wb = under(b, w);
    if (wa && wb && x.fn === "int.bitAnd") return op(w, "and", [wa, wb]);
    if (wa && wb && x.fn === "int.bitOr") return op(w, "or", [wa, wb]);
    if (wa && wb && x.fn === "int.bitXor") return op(w, "xor", [wa, wb]);
    // Masked to 2ᵏ−1 within the word (Word8 and Word16 in an i32 too): the
    // wrapping op, then the machine's and with the mask.
    if (x.fn === "int.bitAnd" && b.k === "int" && b.v > 0n && b.v <= TOP[w] && (b.v & (b.v + 1n)) === 0n) {
      // A word written as a literal: its bits, worked out now.
      if (a.k === "int") return rt(fn(w, "narrow"), { k: "int", v: a.v & b.v });
      const full = wrapped(a, w);
      return b.v === TOP[w] ? full : op(w, "and", [full, rt(fn(w, "narrow"), b)]);
    }
  }
  return rt(fn(w, "narrow"), x);
}

// An Int a, kept to its low w bits: the machine's op where a is one on
// words, without making the Int.
function wrapped(a: SExpr, w: Width): SExpr {
  const wa = under(a, w);
  if (wa) return wa;
  if (a.k === "rt" && a.args.length === 2 && under(a.args[0], w)) {
    const p = under(a.args[0], w)!, q = a.args[1], wq = under(q, w);
    const o = ({ "int.add": "add", "int.sub": "sub", "int.mul": "mul" } as Record<string, "add" | "sub" | "mul">)[a.fn];
    if (o && wq) return op(w, o, [p, wq]);
    // A count written as a literal shifting up is a negative literal.
    if (a.fn === "int.shiftDown") return rt(fn(w, "shiftDown"), p, isRt(q, "int.neg") && q.args[0].k === "int" ? { k: "int", v: -q.args[0].v } : q);
  }
  if (isRt(a, "int.neg") && under(a.args[0], w)) return op(w, "neg", [under(a.args[0], w)!]);
  // Any other Int, kept to its low w bits without the and.
  return rt(fn(w, "wrap"), a);
}

export function machineWords(ir: CoreIR): void {
  const kb = knownBits(ir);
  // The fields stored as words, by fieldKey, with their widths.
  const words = new Map<string, Width>();
  for (const r of ir.records) r.fields.forEach((f, i) => {
    const b = kb.fields.get(fieldKey(r, 0, i));
    if (f.t === "int" && b !== undefined && b !== null && b <= TOP[64]) words.set(fieldKey(r, 0, i), b <= TOP[32] ? 32 : 64);
  });
  if (!words.size) return;
  const isWord = (t: RType, i: number): Width | undefined => words.get(fieldKey(t, 0, i));
  // Every copy of a record's type the IR holds says its field is a word.
  const seen = new Set<object>();
  const retype = (t: unknown) => {
    if (typeof t !== "object" || t === null || seen.has(t)) return;
    seen.add(t);
    if (isRecord(t as LType)) (t as RType).fields.forEach((f, i) => { const w = isWord(t as RType, i); if (w) f.t = TYPE[w]; });
    for (const v of Object.values(t)) retype(v);
  };
  [ir.records, ir.data, ir.arrays, ir.tables, ir.fns, ir.shapes].forEach(retype);
  ir.funcs.forEach((f) => [f.params, f.locals, f.result, f.answer].forEach(retype));
  for (const f of ir.funcs) {
    // Locals only ever let to a word field (and not bound any other way).
    const lets = new Map<number, Width | null>(), other = new Set<number>();
    const look = (e: SExpr) => {
      if ("t" in e) retype(e.t);
      if (e.k === "let") {
        const w = e.value.k === "get" ? isWord(e.value.t, e.value.i) ?? null : null, was = lets.get(e.i);
        lets.set(e.i, was === undefined || was === w ? w : null);
      }
      if (e.k === "case") other.add(e.s);
      if (e.k === "attempt" || e.k === "search" || e.k === "budget") other.add(e.res);
      if (e.k === "apply") other.add(e.tmp);
      if (e.k === "list") { other.add(e.item); other.add(e.acc); }
      if (e.k === "handle") other.add(e.reason);
      kids(e).forEach(look);
    };
    look(f.body);
    const wordLocal = new Map([...lets].filter((x): x is [number, Width] => x[1] !== null && x[0] >= f.params.length && !other.has(x[0])));
    wordLocal.forEach((w, i) => { f.locals[i] = TYPE[w]; });
    f.body = rewrite(f, f.body, wordLocal, isWord);
  }
  // A record of one word is that word (C150g): no struct is made for it,
  // and its make and get are nothing.
  const bare = new Map(ir.records.filter((r) => !r.mutable && r.fields.length === 1 && isWord(r, 0)).map((r) => [r.key, TYPE[isWord(r, 0)!]]));
  if (bare.size) unbox(ir, bare);
}

function unbox(ir: CoreIR, bare: Map<string, "i32" | "i64">): void {
  const isBare = (t: unknown): boolean => typeof t === "object" && t !== null && isRecord(t as LType) && bare.has((t as RType).key);
  const strip = (e: SExpr): SExpr => {
    const r = mapKids(e, strip);
    if (r.k === "make" && isBare(r.t)) return r.args[0];
    if (r.k === "get" && isBare(r.t)) return r.rec;
    return r;
  };
  ir.funcs.forEach((f) => { f.body = strip(f.body); });
  // Every place that names a bare record's type names its word instead: the
  // functions' types and bodies, and the types that hold one.
  const seen = new Set<object>();
  const swap = (o: unknown) => {
    if (typeof o !== "object" || o === null || seen.has(o)) return;
    seen.add(o);
    const x = o as Record<string, unknown>;
    for (const k of Object.keys(x)) {
      if (k === "src") continue;
      if (isBare(x[k])) x[k] = bare.get((x[k] as RType).key);
      else swap(x[k]);
    }
  };
  ir.records = ir.records.filter((r) => !bare.has(r.key));
  [ir.funcs, ir.records, ir.data, ir.arrays, ir.tables, ir.fns, ir.shapes, ir.escapes].forEach(swap);
}

function rewrite(f: SFunc, e: SExpr, wordLocal: Map<number, Width>, isWord: (t: RType, i: number) => Width | undefined): SExpr {
  const go = (x: SExpr) => rewrite(f, x, wordLocal, isWord);
  const r = mapKids(e, go);
  switch (r.k) {
    case "local": { const w = wordLocal.get(r.i); return w ? widen(r, w) : r; }
    case "get": { const w = isWord(r.t, r.i); return w ? widen(r, w) : r; }
    case "let": { const w = wordLocal.get(r.i); return w ? { ...r, value: narrow(r.value, w) } : r; }
    case "make": return { ...r, args: r.args.map((x, i) => { const w = isWord(r.t, i); return w ? narrow(x, w) : x; }) };
    case "set": { const w = isWord(r.t, r.i); return w ? { ...r, value: narrow(r.value, w) } : r; }
    case "rt": {
      const [a, b] = r.args;
      if (r.fn === "int.less" && a && b) for (const w of [32, 64] as const) {
        const wa = under(a, w), wb = under(b, w);
        if (wa && wb) return op(w, "less", [wa, wb]);
      }
      return r;
    }
    default: return r;
  }
}
