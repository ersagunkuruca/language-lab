// What std's builtins with Choice run (C251): every answer, as an array
// (none, one or several), by its op with `$` for `.`, as std-impl.ts's
// STD_MANY has it by id. std.ts says what each one is.

import type { Id } from "../model.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import * as A from "./algebraic.ts";
import * as RL from "./real.ts";
import { PAIR_V, SOME } from "./std-ids.ts";
import { ofAlg, toAlg, toReal, truth, type RealData } from "./std-values.ts";
import { arrayView, type ArrayValue } from "./array-view.ts";
import { held, Table, valueOf as heldValue } from "./table.ts";


export const int$quotient = I.quotient;
export const int$remainder = I.remainder;
export const int$power = I.power;
export const int$read = I.read;
export const int$wholePart = I.wholePart;
export const text$find = T.find;
export const text$code = T.code;
export const text$fromCode = T.fromCode;
export const text$readNumber = T.readNumber;
export const time$zoneOffset = (zone: string, i: { fields: unknown[] }) => T.zoneOffset(zone, i.fields[0] as number);
export const algebraic$divide = (a: { fields: unknown[] }, b: { fields: unknown[] }) => { const q = A.divide(toAlg(a), toAlg(b)); return q ? [ofAlg(q)] : []; };
export const algebraic$root = (a: { fields: unknown[] }, k: I.Int) => { const r = A.root(toAlg(a), Number(k)); return r ? [ofAlg(r)] : []; };
export const algebraic$sqrt = (a: { fields: unknown[] }) => { const r = A.root(toAlg(a), 2); return r ? [ofAlg(r)] : []; };
export const algebraic$fractionParts = (a: { fields: unknown[] }) => {
  const f = A.asFraction(toAlg(a));
  return f ? [{ tag: PAIR_V, fields: f.map(I.norm) }] : [];
};
export const real$less = (a: RealData, b: RealData, fuel: I.Int) => { const c = RL.compare(toReal(a), toReal(b), Number(fuel)); return c === null ? [] : [truth(c < 0)]; };
export const valueOf = (o: { tag: Id; fields: unknown[] }) => (o.tag === SOME ? [o.fields[0]] : []);
export const array$at = (arr: ArrayValue, i: I.Int) => { const v = arrayView(arr), k = Number(i); return Number.isInteger(k) && k >= 0 && k < v.n ? [v.buf.items[v.start + k]] : []; };
export const array$first = (arr: ArrayValue) => { const v = arrayView(arr); return v.n > 0 ? [v.buf.items[v.start]] : []; };
export const table$at = (t: Table, key: unknown) => { const h = held(key); return t.m.has(h) ? [heldValue(t.m.get(h))] : []; };
