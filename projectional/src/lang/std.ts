// The standard library of the typed core: builtin types, a few data types
// written as ordinary typedef nodes (Bool, List, Pair, Unit), and builtins
// with their type signatures. Everything has a stable id so programs can
// refer to it, exactly like prelude.ts.

import type { Code, Id, Node } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B, impl } from "../prelude.ts";
import { CELL, CELLS, UPDATE, CHOICE, CONSOLE, DIVERGE, FILES, INT, NETWORK, NUMBER, STRING, type Subst, type Type } from "./types.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";

const nodes: Node[] = [];
const node = (n: Node) => (nodes.push(n), n.id);
const names: Names = {};
const named = (id: Id, name: string) => ((names[id] = name), id);

// --- builtin types and effects (named nodes, so they can be referenced)
for (const [id, name] of [[NUMBER, "Number"], [STRING, "Text"], [INT, "Int"], [CELL, "Cell"]]) named(node({ id, kind: "builtin", op: id }), name);
for (const [id, name] of [[CHOICE, "Choice"], [CONSOLE, "Console"], [DIVERGE, "Diverge"], [FILES, "Files"], [CELLS, "Cells"], [UPDATE, "Update"], [NETWORK, "Network"]]) named(node({ id, kind: "builtin", op: id }), name);

// --- data types, as code. A typedef's params are binders; fields point at
// type expressions. An effect is written the same way (`effect`): its
// variants are operations, and an operation's third entry is the type it
// returns (none: it never returns).
type TypeOf = (p: Id[], self: Id) => Id;
function typedef(id: Id, name: string, params: string[], variants: [string, [string, TypeOf][], TypeOf?][], effect = false) {
  const ps = params.map((p) => named(node({ id: `${id}.${p}`, kind: "binder" }), p));
  const vs = variants.map(([vname, fields, returns]) => {
    const vid = `${id}.${vname}`;
    const fs = fields.map(([fname, ty]) => named(node({ id: `${vid}.${fname}`, kind: "field", type: ty(ps, id) }), fname));
    return named(node({ id: vid, kind: "variant", fields: fs, ...(returns ? { returns: returns(ps, id) } : {}) }), vname);
  });
  node({ id: `${id}.type`, kind: "typedef", params: ps, variants: vs, ...(effect ? { effect: true as const } : {}) });
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

// The data form of Choice: a value that may be missing, for storing what
// a Choice computes (LANGUAGE.md, "Optional"). `optional` turns a Choice
// into one, `value of` turns one back.
export const OPTIONAL = typedef("std.optional", "Optional", ["a"], [
  ["none", []],
  ["some", [["value", ([a]) => tref(a)]]],
]);
export const NONE = "std.optional.none", SOME = "std.optional.some";

// Effects written in the language itself, the way a program writes its own.
// Abort ends a computation with a reason; a match with an `abort(reason)`
// case catches it. Log is debug output: not a world effect (it may run
// under Choice), and when nothing handles it the runtime writes it to
// standard error.
export const ABORT = typedef("std.abort", "Abort", [], [["abort", [["reason", () => tref(STRING)]]]], true);
export const LOG = typedef("std.log", "Log", [], [["log", [["line", () => tref(STRING)]], () => tref(UNIT)]], true);
export const ABORT_OP = "std.abort.abort", LOG_OP = "std.log.log";
// Random: `random()` is a Number in [0, 1). Like Log it isn't a world
// effect: drawing a number changes nothing outside the program, so a search
// may draw. `seeded(seed, action)` answers it with the same numbers every
// run (random.ts); a match can answer it too (a test's fixed value), and
// what nothing handles, the world answers.
export const RANDOM = typedef("std.random", "Random", [], [["random", [], () => tref(NUMBER)]], true);
export const RANDOM_OP = "std.random.random";
// Time: `now()` is the time in milliseconds since 1970 (UTC). Reading the
// clock changes nothing, so like Random it may run under Choice, and a
// match can answer it (a test's fixed clock). In a page, a part that reads
// it runs again every animation frame (browser.ts), so a clock is a part
// that shows `now()`. Wait: `wait(ms)` pauses the program, on the command
// line. Its own effect, so a page, whose parts and handlers may not wait,
// says so in their types.
export const TIME = typedef("std.time", "Time", [], [["now", [], () => tref(NUMBER)]], true);
export const WAIT = typedef("std.wait", "Wait", [], [["wait", [["milliseconds", () => tref(NUMBER)]], () => tref(UNIT)]], true);
export const NOW_OP = "std.time.now", WAIT_OP = "std.wait.wait";

// A page (WEB.md): an ordinary rose tree, whose changing parts are
// functions the page runs in watchers (src/lang/html.ts). Views may read
// cells, the clock and the web (a view that fetches has to catch its
// Abort itself, and shows what it showed until the reply comes); event handlers may also write cells, print, and use files (the
// browser keeps those in localStorage), and so may abort (the page logs it). Buttons, rows and fields are
// functions that build `element`s, not more variants.
const tfun = (params: Id[], result: Id, effects: Id[]) => node({ id: `std.t${tn++}`, kind: "tfun", params, result, effects });
export const EVENT = typedef("std.event", "Event", [], [
  ["event", [["value", () => tref(STRING)], ["key", () => tref(STRING)]]],
]);
export const ATTRIBUTE = typedef("std.attribute", "Attribute", [], [
  ["property", [["name", () => tref(STRING)], ["value", () => tfun([], tref(STRING), [CELLS, DIVERGE, TIME, NETWORK])]]],
  ["on", [["event", () => tref(STRING)], ["then", () => tfun([tref(EVENT)], tref(UNIT), [CELLS, UPDATE, CONSOLE, FILES, ABORT, TIME, NETWORK])]]],
]);
export const HTML = typedef("std.html", "Html", [], [
  ["element", [["tag", () => tref(STRING)], ["attributes", () => tref(LIST, tref(ATTRIBUTE))], ["children", (_, self) => tref(LIST, tref(self))]]],
  ["text", [["shows", () => tfun([], tref(STRING), [CELLS, DIVERGE, TIME, NETWORK])]]],
  ["part", [["view", (_, self) => tfun([], tref(self), [CELLS, DIVERGE, TIME, NETWORK])]]],
]);
export const HTML_V = { element: "std.html.element", text: "std.html.text", part: "std.html.part", property: "std.attribute.property", on: "std.attribute.on", event: "std.event.event" } as const;

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
const optional = (a: Type): Type => ({ t: "con", id: OPTIONAL, args: [a] });
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
  // The at-most-one sibling of all: the first answer as some(answer), or
  // none. This is how a Choice becomes data that can be stored.
  optional: builtin("optional", "optional", (s) => { const a = s.fresh(), e = s.freshRow(); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], optional(a), e); }),
  // ... and back: the value, or no answer at all.
  valueOf: builtin("valueOf", "value of", (s) => { const a = s.fresh(); return fn([optional(a)], a, s.freshRow([CHOICE])); }),
  // Random's handler that gives the same numbers for the same seed.
  seeded: builtin("seeded", "seeded", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([num, fn([], a, { effs: [RANDOM], tail: e.tail })], a, e);
  }),
  // Turns "might not terminate" into "might fail": at most n calls to
  // possibly-divergent definitions, then fail.
  fuel: builtin("fuel", "with fuel", (s) => {
    const a = s.fresh(), e = s.freshRow();
    return fn([num, fn([], a, { effs: [DIVERGE], tail: e.tail })], a, { effs: [CHOICE], tail: e.tail });
  }),
};

STD_MANY[S.valueOf] = (o: { tag: Id; fields: unknown[] }) => (o.tag === SOME ? [o.fields[0]] : []);

// The world: the console, files. Their implementations are the runtime's
// (run.ts `World`), which is the only handler world effects have. Those
// that can go wrong (a missing file) abort with the reason.
const world = (op: string, name: string, params: Type[], ret: Type, effs: Id[]) => builtin(op, name, (s) => fn(params, ret, s.freshRow(effs)));
export const IO = {
  printError: world("io.printError", "print error", [str], unit, [CONSOLE]),
  readInput: world("io.readInput", "read input", [], str, [CONSOLE, ABORT]),
  readLine: world("io.readLine", "read line", [], optional(str), [CONSOLE, ABORT]),
  readFile: world("io.readFile", "read file", [str], str, [FILES, ABORT]),
  writeFile: world("io.writeFile", "write file", [str, str], unit, [FILES, ABORT]),
  appendFile: world("io.appendFile", "add to file", [str, str], unit, [FILES, ABORT]),
  fileExists: world("io.fileExists", "file exists", [str], bool, [FILES]),
  listFolder: world("io.listFolder", "list folder", [str], list(str), [FILES, ABORT]),
  // The body of a GET, as text. Aborts when it can't be had (no network,
  // a status that isn't 2xx). Fetched once per address per run.
  fetchText: world("io.fetchText", "fetch text", [str], str, [NETWORK, ABORT]),
};

// Cells (src/lang/cells.ts, LANGUAGE.md "Cells"): Solid.js's signals and
// memos as an effect. `cell` makes one you write, `formula` one computed
// from others when first read and remembered until a cell it read
// changes. Reading is the operation the runtime's handler tracks. A
// formula's computation runs later, at some read, so the effects it may
// have are the handler's own: Cells, and Diverge (a lazy producer of
// endless data is recursion the checker can't see end). Not Update: a
// formula reads, it doesn't write. Writing is Update, a world effect.
const cellOf = (a: Type): Type => ({ t: "con", id: CELL, args: [a] });
export const CELL_OPS = {
  cell: builtin("cells.cell", "cell", (s) => { const a = s.fresh(); return fn([a], cellOf(a), s.freshRow([CELLS])); }),
  formula: builtin("cells.formula", "formula", (s) => { const a = s.fresh(); return fn([fn([], a, { effs: [CELLS, DIVERGE], tail: null })], cellOf(a), s.freshRow([CELLS])); }),
  read: builtin("cells.read", "read", (s) => { const a = s.fresh(); return fn([cellOf(a)], a, s.freshRow([CELLS])); }),
  write: builtin("cells.write", "write", (s) => { const a = s.fresh(); return fn([cellOf(a), a], unit, s.freshRow([UPDATE])); }),
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

export const std: Code = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), defs: [BOOL, UNIT, LIST, PAIR, OPTIONAL, ABORT, LOG, RANDOM, TIME, WAIT, EVENT, ATTRIBUTE, HTML] };
export const stdNames: Names = { ...names, [B.sqrt]: "sqrt", [B.pow]: "power" };

// Operations where the grouping doesn't change the answer. A chain of one
// of them, a ++ (b ++ c), is shown as the one call it means, with every
// operand side by side, however the tree pairs them up: a view, like a
// list drawn as [x, y] (the program keeps its pairs). `keep` stops at an
// inner call that has to stay visible on its own (a graph's named dot).
export const ASSOCIATIVE = new Set<Id>([B.add, B.mul, S.and, S.or, S.concat]);
export function chainOperands(code: Code, id: Id, keep: (id: Id) => boolean = () => false): Id[] | null {
  const head = (n: Node | undefined) => (n?.kind === "call" && n.args.length === 2 ? code.nodes[n.fn] : undefined);
  const f = head(code.nodes[id]);
  if (f?.kind !== "ref" || !ASSOCIATIVE.has(f.target)) return null;
  const op = f.target;
  const out: Id[] = [];
  const walk = (a: Id) => {
    const g = head(code.nodes[a]);
    if (a !== id && (g?.kind !== "ref" || g.target !== op || keep(a))) { out.push(a); return; }
    for (const b of (code.nodes[a] as { args: Id[] }).args) walk(b);
  };
  walk(id);
  return out.length > 2 ? out : null;
}
