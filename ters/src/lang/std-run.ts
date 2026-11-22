// What std's builtins run (C251): each builtin with one answer, by its op
// with `$` for `.`, as std-impl.ts's STD_IMPL has it by id (`int$add` is
// builtin.int.add's). std.ts says what each one is, with its type; this
// module carries none of that, so a page carries only the builtins it
// calls. Those with several answers or none are std-run-many.ts's.

import type { Id } from "../model.ts";
import { ItemsList } from "./bytes.ts";
import { Pending } from "./cells.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import * as A from "./algebraic.ts";
import * as RL from "./real.ts";
import { FALSE, NONE, ORDER_V, PAIR_V, SOME, TRUE } from "./std-ids.ts";
import { floatText, itemsOf, listOf, ofAlg, realOf, toAlg, toReal, truth, type RealData } from "./std-values.ts";
import { ArrayView, arrayOf, arrayOfItems, arrayView, itemsIn, pushBack, pushFront, replaceIn, restOf, sliceOf, type ArrayValue } from "./array-view.ts";
import { change, held, keyOf, keyOrder, Keyed, numberEntries, numberKeys, Table, valueOf } from "./table.ts";

// A representation's job, as data the chooser reads (std.ts JOBS).
const made = (op: string) => (...xs: unknown[]) => ({ tag: `builtin.${op}`, fields: xs });

const unresolved = (name: string) => () => { throw new Error(`the generic ${name} must be resolved to its type's own operation first (arith.ts)`); };
let EMPTY_ARRAY: ArrayView | undefined;
const one = (f: (...xs: A.Algebraic[]) => A.Algebraic) => (...vs: { fields: unknown[] }[]) => ofAlg(f(...vs.map(toAlg)));
const open = (name: string) => () => { throw new Error(`${name} needs the value's data type and the fields' type known where it is used: give the definition that calls it those types`); };
const jsonOpen = (name: string) => () => { throw new Error(`${name} needs the value's type known where it is used`); };

export const list$of = (...xs: unknown[]) => listOf(xs);
export const abs = Math.abs;
export const floor = Math.floor;
export const float32 = Math.fround;
export const mod = (a: number, b: number) => ((a % b) + b) % b;
export const concat = (a: string, b: string) => a + b;
export const show = (x: number) => floatText(x);
export const whileWaiting = (body: () => unknown, shown: unknown) => { try { return body(); } catch (e) { if (e instanceof Pending) return shown; throw e; } };
export const representation$storeBy = /* @__PURE__ */ made("representation.storeBy");
export const int$add = I.add;
export const int$sub = I.sub;
export const int$mul = I.mul;
export const int$neg = I.neg;
export const int$abs = I.abs;
export const int$shiftDown = I.shiftDown;
export const int$bitAnd = I.bitAnd;
export const int$bitOr = I.bitOr;
export const int$bitXor = I.bitXor;
export const int$less = (a: I.Int, b: I.Int) => truth(I.less(a, b));
export const int$lowestTerms = (a: I.Int, b: I.Int) => {
  const [t, u] = I.lowestTerms(a, b);
  return { tag: PAIR_V, fields: [t, u] };
};
export const int$show = I.show;
export const int$toNumber = I.toNumber;
export const int$range = (n: I.Int) => {
  let l: object = { tag: "std.list.nil", fields: [] };
  for (let i = Number(n) - 1; i >= 0; i--) l = { tag: "std.list.cons", fields: [i, l] };
  return l;
};
export const text$length = T.length;
export const text$slice = T.slice;
export const text$characters = (t: string) => listOf(T.characters(t));
export const text$split = (t: string, by: string) => new ItemsList(T.split(t, by), 0);
export const text$joinAll = (l: { tag: Id; fields: unknown[] }, by: string) => T.joinAll(itemsOf(l) as string[], by);
export const text$less = (a: string, b: string) => truth(T.less(a, b));
export const text$normalized = (t: string) => t.normalize("NFC");
export const text$graphemes = (t: string) => listOf(T.graphemes(t));
export const text$graphemeCount = T.graphemeCount;
export const text$uppercase = (t: string, l: { fields: unknown[] }) => T.uppercase(t, l.fields[0] as string);
export const text$collate = (a: string, b: string, l: { fields: unknown[] }) => ({ tag: [ORDER_V.before, ORDER_V.same, ORDER_V.after][T.collate(a, b, l.fields[0] as string) + 1], fields: [] });
export const text$lowercase = (t: string, l: { fields: unknown[] }) => T.lowercase(t, l.fields[0] as string);
export const array$empty = () => (EMPTY_ARRAY ??= arrayOf([]));
export const array$of = (l: { tag: Id; fields: unknown[] }) => arrayOfItems(l);
export const array$items = (arr: ArrayValue) => new ItemsList(itemsIn(arr), 0);
export const array$length = (arr: ArrayValue) => arrayView(arr).n;
export const array$push = pushBack;
export const array$rest = restOf;
export const array$pushFront = pushFront;
export const array$slice = sliceOf;
export const array$replaceAt = replaceIn;
export const array$firstIfAny = (arr: ArrayValue) => {
  const v = arrayView(arr);
  return v.n > 0 ? { tag: SOME, fields: [v.buf.items[v.start]] } : { tag: NONE, fields: [] };
};
export const array$front = (arr: ArrayValue) => {
  const v = arrayView(arr);
  return v.n > 0 ? { tag: SOME, fields: [{ tag: PAIR_V, fields: [v.buf.items[v.start], restOf(arr)] }] } : { tag: NONE, fields: [] };
};
export const table$empty = () => new Table(new Map(), true);
export const table$put = (t: Table, key: unknown, v: unknown) => {
  const h = held(key);
  return change(t, h, true, h === key ? v : new Keyed(key, v));
};
export const table$remove = (t: Table, key: unknown) => change(t, held(key), false);
export const table$has = (t: Table, key: unknown) => ({ tag: t.m.has(held(key)) ? TRUE : FALSE, fields: [] });
export const table$size = (t: Table) => t.m.size;
export const table$entries = (t: Table) => (t.listed ??= numberEntries(t.m) ?? listOf([...t.m].map(([k, v]) => [keyOf(k, v), valueOf(v)]).sort(([a], [b]) => keyOrder(a, b)).map(([a, b]) => ({ tag: PAIR_V, fields: [a, b] }))));
export const table$keys = (t: Table) => (t.keyed ??= numberKeys(t.m) ?? listOf([...t.m].map(([k, v]) => keyOf(k, v)).sort(keyOrder)));
export const hashset$empty = () => new Table(new Map(), true);
export const hashset$add = (t: Table, x: unknown) => { const h = held(x); return change(t, h, true, h === x ? true : new Keyed(x, true)); };
export const hashset$remove = (t: Table, x: unknown) => change(t, held(x), false);
export const hashset$has = (t: Table, x: unknown) => ({ tag: t.m.has(held(x)) ? TRUE : FALSE, fields: [] });
export const hashset$size = (t: Table) => t.m.size;
export const hashset$items = (t: Table) => (t.listed ??= listOf([...t.m].map(([k, v]) => keyOf(k, v)).sort(keyOrder)));
export const algebraic$add = /* @__PURE__ */ one(A.add);
export const algebraic$sub = /* @__PURE__ */ one(A.subtract);
export const algebraic$mul = /* @__PURE__ */ one(A.multiply);
export const algebraic$neg = /* @__PURE__ */ one(A.negate);
export const algebraic$less = (a: { fields: unknown[] }, b: { fields: unknown[] }) => truth(A.less(toAlg(a), toAlg(b)));
export const algebraic$fraction = (n: I.Int, d: I.Int) => ofAlg(A.fraction(BigInt(n), BigInt(d)));
export const algebraic$digits = (a: { fields: unknown[] }, n: I.Int) => A.digits(toAlg(a), Number(n));
export const algebraic$toNumber = (a: { fields: unknown[] }) => A.toNumber(toAlg(a));
export const algebraic$show = (a: { fields: unknown[] }) => A.show(toAlg(a));
export const real$add = (a: RealData, b: RealData) => realOf(1, [a, b]);
export const real$sub = (a: RealData, b: RealData) => realOf(1, [a, realOf(2, [b])]);
export const real$mul = (a: RealData, b: RealData) => realOf(3, [a, b]);
export const real$neg = (a: RealData) => realOf(2, [a]);
export const real$fraction = (n: I.Int, d: I.Int) => realOf(0, [], n, d);
export const real$lessForever = (a: RealData, b: RealData) => truth(RL.compare(toReal(a), toReal(b), Infinity)! < 0);
export const real$pi = () => realOf(4, []);
export const real$exp = (x: RealData) => realOf(5, [x]);
export const real$log = (x: RealData) => realOf(6, [x]);
export const real$sin = (x: RealData) => realOf(7, [x]);
export const real$cos = (x: RealData) => realOf(8, [x]);
export const real$digits = (x: RealData, n: I.Int) => RL.digits(toReal(x), Number(n));
export const real$approximate = (x: RealData, p: I.Int) => I.norm(RL.approximate(toReal(x), Number(p)));
export const fields$mapped = /* @__PURE__ */ open("fields mapped");
export const fields$listed = /* @__PURE__ */ open("fields listed");
export const json$of = /* @__PURE__ */ jsonOpen("json of");
export const json$from = /* @__PURE__ */ jsonOpen("from json");
export const representation$job = /* @__PURE__ */ made("representation.job");
export const representation$asWritten = /* @__PURE__ */ made("representation.asWritten");
export const representation$matchBy = /* @__PURE__ */ made("representation.matchBy");
export const representation$foldBy = /* @__PURE__ */ made("representation.foldBy");
export const representation$matchAsWritten = /* @__PURE__ */ made("representation.matchAsWritten");
export const representation$foldAsWritten = /* @__PURE__ */ made("representation.foldAsWritten");
export const representation$foldOfItems = /* @__PURE__ */ made("representation.foldOfItems");
export const representation$carried = /* @__PURE__ */ made("representation.carried");
export const representation$equalBy = /* @__PURE__ */ made("representation.equalBy");
export const representation$showBy = /* @__PURE__ */ made("representation.showBy");
export const representation$compareBy = /* @__PURE__ */ made("representation.compareBy");
export const representation$headBy = /* @__PURE__ */ made("representation.headBy");
export const representation$hides = /* @__PURE__ */ made("representation.hides");
export const representation$inPlace = /* @__PURE__ */ made("representation.inPlace");
export const arith$add = /* @__PURE__ */ unresolved("add");
export const arith$sub = /* @__PURE__ */ unresolved("subtract");
export const arith$mul = /* @__PURE__ */ unresolved("multiply");
export const arith$neg = /* @__PURE__ */ unresolved("negate");
export const arith$less = /* @__PURE__ */ unresolved("less than");
export const arith$abs = /* @__PURE__ */ unresolved("abs");
// A draw (FRAMES.md, G9b): its mesh, instances and two functions, kept for
// the runtime that renders a frame; nothing in a program takes one apart.
// Compiled, a draw is also given its site and the values its functions
// read (G9c, compiler/src/gpu-draws.ts), as fields 4 and 5: what the
// GPU's pipeline for the site and its uniform are made from (gpu-frame.ts).
export const frame$draw = (mesh: unknown, instances: unknown, vertex: unknown, fragment: unknown, site?: number, ...caps: unknown[]) => ({ tag: "builtin.frame.draw", fields: site === undefined ? [mesh, instances, vertex, fragment] : [mesh, instances, vertex, fragment, site, caps] });
