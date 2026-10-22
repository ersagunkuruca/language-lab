// The standard library of the typed core: builtin types, a few data types
// written as ordinary typedef nodes (Bool, List, Pair, Unit), and builtins
// with their type signatures. Everything has a stable id so programs can
// refer to it, exactly like prelude.ts.

import type { Code, Id, Node } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B, impl } from "../prelude.ts";
import { CHOICE, CONSOLE, DIVERGE, NUMBER, STRING, type Subst, type Type } from "./types.ts";

const nodes: Node[] = [];
const node = (n: Node) => (nodes.push(n), n.id);
const names: Names = {};
const named = (id: Id, name: string) => ((names[id] = name), id);

// --- builtin types and effects (named nodes, so they can be referenced)
for (const [id, name] of [[NUMBER, "Number"], [STRING, "Text"]]) named(node({ id, kind: "builtin", op: id }), name);
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
const bool: Type = { t: "con", id: BOOL, args: [] };
const unit: Type = { t: "con", id: UNIT, args: [] };
const list = (a: Type): Type => ({ t: "con", id: LIST, args: [a] });
const fn = (params: Type[], ret: Type, eff: { effs: Id[]; tail: number | null }): Type => ({ t: "fn", params, ret, eff });

export const SIGS: Record<Id, Sig> = {};
export const STD_IMPL: Record<Id, (...xs: any[]) => any> = {};

function builtin(op: string, name: string, sig: Sig, f?: (...xs: any[]) => any) {
  const id = `builtin.${op}`;
  named(node({ id, kind: "builtin", op }), name);
  SIGS[id] = sig;
  if (f) STD_IMPL[id] = f;
  return id;
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

export const std: Code = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), defs: [BOOL, UNIT, LIST, PAIR] };
export const stdNames: Names = { ...names, [B.sqrt]: "sqrt", [B.pow]: "power" };
