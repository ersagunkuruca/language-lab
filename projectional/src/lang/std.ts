// The standard library of the typed core: builtin types, a few data types
// written as ordinary typedef nodes (Bool, List, Pair, Unit), and builtins
// with their type signatures. Everything has a stable id so programs can
// refer to it, exactly like prelude.ts.

import type { Code, Id, Node } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B, impl } from "../prelude.ts";
import { CHOICE, CONSOLE, DIVERGE, INT, NUMBER, STRING, type Subst, type Type } from "./types.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";

const nodes: Node[] = [];
const node = (n: Node) => (nodes.push(n), n.id);
const names: Names = {};
const named = (id: Id, name: string) => ((names[id] = name), id);

// --- builtin types and effects (named nodes, so they can be referenced)
for (const [id, name] of [[NUMBER, "Number"], [STRING, "Text"], [INT, "Int"]]) named(node({ id, kind: "builtin", op: id }), name);
for (const [id, name] of [[CHOICE, "Choice"], [CONSOLE, "Console"], [DIVERGE, "Diverge"]]) named(node({ id, kind: "builtin", op: id }), name);

// --- data types, as code. A typedef's params are binders; fields point at
// type expressions.
function typedef(id: Id, name: string, params: string[], variants: [string, [string, (p: Id[], self: Id) => Id][]][]) {
  const ps = params.map((p) => named(node({ id: `${id}.${p}`, kind: "binder" }), p));
  const vs = variants.map(([vname, fields]) => {
    const vid = `${id}.${vname}`;
    const fs = fields.map(([fname, ty]) => named(node({ id: `${vid}.${fname}`, kind: "field", type: ty(ps, id) }), fname));
    return named(node({ id: vid, kind: "variant", fields: fs }), vname);
  });
  node({ id: `${id}.type`, kind: "typedef", params: ps, variants: vs });
  return named(node({ id, kind: "def", body: `${id}.type` }), name);
}
let tn = 0;
const tref = (target: Id, ...args: Id[]) => node({ id: `std.t${tn++}`, kind: "tref", target, args });

export const BOOL = typedef("std.bool", "Bool", [], [["false", []], ["true", []]]);
export const UNIT = typedef("std.unit", "Unit", [], [["unit", []]]);
export const LIST = typedef("std.list", "List", ["a"], [
  ["nil", []],
  ["cons", [["head", ([a]) => tref(a)], ["tail", ([a], self) => tref(self, tref(a))]]],
]);
export const PAIR = typedef("std.pair", "Pair", ["a", "b"], [
  ["pair", [["fst", ([a]) => tref(a)], ["snd", ([, b]) => tref(b)]]],
]);

export const TRUE = "std.bool.true", FALSE = "std.bool.false", UNIT_V = "std.unit.unit";
export const NIL = "std.list.nil", CONS = "std.list.cons";
export const PAIR_V = "std.pair.pair", FIRST = "std.pair.pair.fst", SECOND = "std.pair.pair.snd";

// --- builtins. A signature builds a fresh type each time it's used, so the
// variables in it are automatically generalized.
type Sig = (s: Subst) => Type;
const num: Type = { t: "con", id: NUMBER, args: [] };
const str: Type = { t: "con", id: STRING, args: [] };
const int: Type = { t: "con", id: INT, args: [] };
const bool: Type = { t: "con", id: BOOL, args: [] };
const unit: Type = { t: "con", id: UNIT, args: [] };
const list = (a: Type): Type => ({ t: "con", id: LIST, args: [a] });
const fn = (params: Type[], ret: Type, eff: { effs: Id[]; tail: number | null }): Type => ({ t: "fn", params, ret, eff });

export const SIGS: Record<Id, Sig> = {};
export const STD_IMPL: Record<Id, (...xs: any[]) => any> = {};
// Builtins with Choice: every answer, as an array (none, one or several).
export const STD_MANY: Record<Id, (...xs: any[]) => any[]> = {};

function builtin(op: string, name: string, sig: Sig, f?: (...xs: any[]) => any) {
  const id = `builtin.${op}`;
  named(node({ id, kind: "builtin", op }), name);
  SIGS[id] = sig;
  if (f) STD_IMPL[id] = f;
  return id;
}
function choice(op: string, name: string, params: Type[], ret: Type, f: (...xs: any[]) => any[]) {
  const id = builtin(op, name, (s) => fn(params, ret, s.freshRow([CHOICE])));
  STD_MANY[id] = f;
  return id;
}

const truth = (b: boolean) => ({ tag: b ? "std.bool.true" : "std.bool.false", fields: [] });
// Lists as std builds them, for builtins that take or give one.
const listOf = (xs: unknown[]) => xs.reduceRight<object>((tail, x) => ({ tag: "std.list.cons", fields: [x, tail] }), { tag: "std.list.nil", fields: [] });
function itemsOf(l: { tag: Id; fields: unknown[] }): unknown[] {
  const out: unknown[] = [];
  for (let d = l; d.tag === "std.list.cons"; d = d.fields[1] as typeof l) out.push(d.fields[0]);
  return out;
}

// The numeric builtins from prelude.ts get types here; their code stays there.
for (const op of Object.keys(impl) as (keyof typeof impl)[]) {
  SIGS[B[op]] = (s) => fn(Array(impl[op].length).fill(num), num, s.freshRow());
}

const pure = (params: Type[], ret: Type): Sig => (s) => fn(params, ret, s.freshRow());

export const S = {
  less: builtin("less", "less than", pure([num, num], bool)),
  // Only plain data can be compared: two functions that do the same thing
  // can't be told equal, and comparing them by where they live isn't
  // equality.
  equal: builtin("equal", "equal", (s) => { const a = s.fresh(true); return fn([a, a], bool, s.freshRow()); }),
  and: builtin("and", "and", pure([bool, bool], bool)),
  or: builtin("or", "or", pure([bool, bool], bool)),
  not: builtin("not", "not", pure([bool], bool)),
  abs: builtin("abs", "abs", pure([num], num), Math.abs),
  floor: builtin("floor", "floor", pure([num], num), Math.floor),
  mod: builtin("mod", "mod", pure([num, num], num), (a: number, b: number) => ((a % b) + b) % b),
  concat: builtin("concat", "join text", pure([str, str], str), (a: string, b: string) => a + b),
  show: builtin("show", "show", pure([num], str), (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e9) / 1e9))),
  range: builtin("range", "range", pure([num], list(num))),
  // Choice: a computation that may have no answer, one, or many (Verse-ish).
  oneOf: builtin("oneOf", "one of", (s) => { const a = s.fresh(); return fn([list(a)], a, s.freshRow([CHOICE])); }),
  // Is there a value that makes this true? Its parameter is an unknown, the
  // way a wire inside a network was: `for some(length => …)`. Run forward
  // it searches (relate.ts); read as equations it is one more unknown.
  // a, hence b: both hold, and b follows from a. Run, it is `and`. Read as
  // equations, b's are marked as consequences: they give the solver more
  // ways in (x² + y² = r² reaches r from x and y in closed form) without
  // counting as constraints of their own, so they don't make a direction
  // look determined when it isn't.
  hence: builtin("hence", "hence", pure([bool, bool], bool)),
  exists: builtin("exists", "for some", (s) => { const a = s.fresh(), e = s.freshRow(); return fn([fn([a], bool, e)], bool, e); }),
  fail: builtin("fail", "fail", (s) => fn([], s.fresh(), s.freshRow([CHOICE]))),
  // A function's derivative, read off its graph (src/lang/derive.ts). Where
  // the slope can't be read (the function goes through floor, or takes
  // apart data built from its input) there is none, so the derivative may
  // fail: Choice.
  derivative: builtin("derivative", "derivative", (s) => {
    const e = s.freshRow();
    return fn([fn([num], num, e)], fn([num], num, { effs: [CHOICE], tail: e.tail }), s.freshRow());
  }),
  // Console
  print: builtin("print", "print", (s) => fn([str], unit, s.freshRow([CONSOLE]))),
  // Handlers. Each takes thunks and removes an effect from them.
  all: builtin("all", "all", (s) => { const a = s.fresh(), e = s.freshRow(); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], list(a), e); }),
  count: builtin("count", "count", (s) => { const a = s.fresh(), e = s.freshRow(); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], num, e); }),
  first: builtin("first", "first", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([fn([], a, { effs: [CHOICE], tail: e.tail }), fn([], a, e)], a, e);
  }),
  // Turns "might not terminate" into "might fail": at most n calls to
  // possibly-divergent definitions, then fail.
  fuel: builtin("fuel", "with fuel", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([num, fn([], a, { effs: [DIVERGE], tail: e.tail })], a, { effs: [CHOICE], tail: e.tail });
  }),
};

// Int: whole numbers that never overflow. Same names as Number's, because
// names are presentation (NUMBERS.md stage 2): the palette offers the one
// whose types fit. Division and powers can have no answer, so they're
// Choice rather than a crash or a NaN.
export const INT_OPS = {
  add: builtin("int.add", "add", pure([int, int], int), I.add),
  sub: builtin("int.sub", "subtract", pure([int, int], int), I.sub),
  mul: builtin("int.mul", "multiply", pure([int, int], int), I.mul),
  neg: builtin("int.neg", "negate", pure([int], int), I.neg),
  abs: builtin("int.abs", "abs", pure([int], int), I.abs),
  less: builtin("int.less", "less than", pure([int, int], bool), (a: I.Int, b: I.Int) => truth(I.less(a, b))),
  quotient: choice("int.quotient", "quotient", [int, int], int, I.quotient),
  remainder: choice("int.remainder", "remainder", [int, int], int, I.remainder),
  power: choice("int.power", "power", [int, int], int, I.power),
  show: builtin("int.show", "show", pure([int], str), I.show),
  read: choice("int.read", "read whole number", [str], int, I.read),
  toNumber: builtin("int.toNumber", "as number", pure([int], num), I.toNumber),
  wholePart: choice("int.wholePart", "whole part", [num], int, I.wholePart),
  // 0, 1, …, n − 1. A list of a billion items is a billion cells, so this
  // is for sizes that fit in memory, like everything else.
  range: builtin("int.range", "range", pure([int], list(int)), (n: I.Int) => {
    let l: object = { tag: "std.list.nil", fields: [] };
    for (let i = Number(n) - 1; i >= 0; i--) l = { tag: "std.list.cons", fields: [i, l] };
    return l;
  }),
};

// Text at real sizes (src/lang/text.ts). Positions count characters.
export const TEXT_OPS = {
  length: builtin("text.length", "length", pure([str], int), T.length),
  slice: builtin("text.slice", "slice", pure([str, int, int], str), T.slice),
  characters: builtin("text.characters", "characters", pure([str], list(str)), (t: string) => listOf(T.characters(t))),
  split: builtin("text.split", "split", pure([str, str], list(str)), (t: string, by: string) => listOf(T.split(t, by))),
  joinAll: builtin("text.joinAll", "join all", pure([list(str), str], str), (l: { tag: Id; fields: unknown[] }, by: string) => T.joinAll(itemsOf(l) as string[], by)),
  find: choice("text.find", "find", [str, str], int, T.find),
  less: builtin("text.less", "comes before", pure([str, str], bool), (a: string, b: string) => truth(T.less(a, b))),
  code: choice("text.code", "character code", [str], int, T.code),
  fromCode: choice("text.fromCode", "character", [int], str, T.fromCode),
};

// show for any plain value: [1, 2, 3], circle(2), "text". Cases print
// with the program's names, which the runtime is given (names are
// presentation, so they're an input to the run, like the console). Number's
// own show stays: run backwards, it is what reads numbers.
export const SHOW_ANY = builtin("showAny", "show", (s) => fn([s.fresh(true)], str, s.freshRow()));

// Records: set(field, record, value) is the record with that field changed.
// `field` is a field, or a path of fields (p ↦ p.address.city), which the
// checker insists on; the update is that path run backwards, with every
// other field kept (src/lang/records.ts).
export const SET = builtin("set", "set", (s) => {
  const r = s.fresh(), a = s.fresh();
  return fn([fn([r], a, s.freshRow()), r, a], r, s.freshRow());
});

export const std: Code = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), defs: [BOOL, UNIT, LIST, PAIR] };
export const stdNames: Names = { ...names, [B.sqrt]: "sqrt", [B.pow]: "power" };
