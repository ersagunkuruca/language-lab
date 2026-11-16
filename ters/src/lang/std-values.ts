// The values std's builtins take and give, made and read the way the
// evaluator and compiled JavaScript both do (C251, out of std.ts): Bools,
// lists, a Float64's text, Algebraic and Real numbers, and which types
// implement an interface.
import type { Id } from "../model.ts";
import { ItemsList } from "./bytes.ts";
import * as I from "./int.ts";
import * as A from "./algebraic.ts";
import * as RL from "./real.ts";
import { ALGEBRAIC_V, REAL_V, SHOWN } from "./std-ids.ts";

export const truth = (b: boolean) => ({ tag: b ? "std.bool.true" : "std.bool.false", fields: [] });
// Lists as std builds them, for builtins that take or give one.
export const listOf = (xs: unknown[]) => xs.reduceRight<object>((tail, x) => ({ tag: "std.list.cons", fields: [x, tail] }), { tag: "std.list.nil", fields: [] });
export function itemsOf(l: { tag: Id; fields: unknown[] }): unknown[] {
  if (l instanceof ItemsList) return l.items();
  const out: unknown[] = [];
  for (let d = l; d.tag === "std.list.cons"; d = d.fields[1] as typeof l) out.push(d.fields[0]);
  return out;
}

// A Float64 as show writes it (BACKLOG L154, Ersagun 2026-11-02): to 9
// decimals, so a sum's last-bit noise doesn't show (0.1 + 0.2 is 0.3);
// but a nonzero number smaller than 10⁻⁶ in size, which 9 decimals would
// turn into 0 or one digit, gets the shortest text that reads back to it
// exactly (JavaScript's own, 1e-12), as Steele and White's and Ryū's
// shortest round trip.
export const floatText = (x: number): string =>
  Number.isInteger(x) ? String(x) : x !== 0 && Math.abs(x) < 1e-6 ? String(x) : String(Math.round(x * 1e9) / 1e9);

// Algebraic numbers to and from their data (algebraic.ts).
export const toAlg = (v: { fields: unknown[] }): A.Algebraic => ({ p: itemsOf(v.fields[0] as { tag: Id; fields: unknown[] }).map((c) => BigInt(c as I.Int)), k: Number(v.fields[1]) });
export const ofAlg = (x: A.Algebraic) => ({ tag: ALGEBRAIC_V, fields: [listOf(x.p.map(I.norm)), x.k] });
// A Real's data, and the Real it stands for, made once per value (real.ts).
export type RealData = { tag: Id; fields: unknown[] };
const reals = new WeakMap<object, RL.Real>();
export function toReal(v: RealData): RL.Real {
  let r = reals.get(v);
  if (r) return r;
  const [op, parts, top, bottom] = v.fields as [I.Int, RealData, I.Int, I.Int];
  const ps = itemsOf(parts as { tag: Id; fields: unknown[] }).map((p) => toReal(p as RealData));
  r = Number(op) === 0 ? RL.fraction(BigInt(top), BigInt(bottom)) : Number(op) === 4 ? RL.pi() : Number(op) === 5 ? RL.exp(ps[0]) : Number(op) === 6 ? RL.log(ps[0]) : Number(op) === 7 ? RL.sin(ps[0]) : Number(op) === 8 ? RL.cos(ps[0]) : Number(op) === 1 ? RL.add(ps[0], ps[1]) : Number(op) === 2 ? RL.negate(ps[0]) : RL.multiply(ps[0], ps[1]);
  reals.set(v, r);
  return r;
}
export const realOf = (op: number, parts: RealData[], top: I.Int = 0, bottom: I.Int = 1): RealData => ({ tag: REAL_V, fields: [op, listOf(parts), top, bottom] });

// Each type with a Shown implementation, and the definition implementing
// it: what `show any` shows a value of that type through, in the
// evaluator (run.ts) and in compiled code (C148).
export function shownImplementations(info: { implementations?: Map<string, Id> }): Map<Id, Id> {
  return implementationsOf(info, SHOWN);
}
// Each type with an implementation of the interface `iface`, and the
// definition giving it: Shown's for show any, Ordered's for compare (L204g).
export function implementationsOf(info: { implementations?: Map<string, Id> }, iface: Id): Map<Id, Id> {
  const out = new Map<Id, Id>();
  for (const [key, d] of info.implementations ?? []) {
    if (!key.startsWith(`${iface}|`)) continue;
    // One at a closed type, or with type parameters (L219), kept by its
    // type constructor alone (infer.ts genericKey): `Shown (Box a)`.
    const rest = key.slice(iface.length + 1);
    const m = rest.startsWith("@") ? [rest, rest.slice(1)] : /"t":"con","id":"([^"]+)"/.exec(rest);
    if (m && !out.has(m[1])) out.set(m[1], d);
  }
  return out;
}

// The tuples' ids (std.ts TUPLES): Tuple2 to Tuple8, their one case and
// its parts, `first` to `eighth`.
export const PART_NAMES = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
export function tupleType(n: number): Id { return `std.tuple${n}`; }
export const tupleVariant = (n: number): Id => `std.tuple${n}.tuple`;
export const tuplePart = (n: number, i: number): Id => `std.tuple${n}.tuple.${PART_NAMES[i]}`;
export const tupleSize = (id: Id): number | null => { const m = /^std\.tuple(\d)$/.exec(id); return m ? Number(m[1]) : null; };
