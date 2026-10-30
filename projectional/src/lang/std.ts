// The standard library of the typed core: builtin types, a few data types
// written as ordinary typedef nodes (Bool, List, Pair, Unit), and builtins
// with their type signatures. Everything has a stable id so programs can
// refer to it, exactly like prelude.ts.

import { discharge } from "./ledger.ts";
import type { Code, Id, Node, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { B, impl } from "../prelude.ts";
import { CELL, PATH, CELLS, UPDATE, CHOICE, CONSOLE, DIVERGE, FILES, INT, NETWORK, NUMBER, STRING, type Row, type Subst, type Type } from "./types.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import * as A from "./algebraic.ts";

const nodes: Node[] = [];
const node = (n: Node) => (nodes.push(n), n.id);
const names: Names = {};
const named = (id: Id, name: string) => ((names[id] = name), id);

// --- builtin types and effects (named nodes, so they can be referenced)
for (const [id, name] of [[NUMBER, "Float64"], [STRING, "Text"], [INT, "Int"], [CELL, "Cell"], [PATH, "Path"]]) named(node({ id, kind: "builtin", op: id }), name);
for (const [id, name] of [[CHOICE, "Choice"], [CONSOLE, "Console"], [DIVERGE, "Diverge"], [FILES, "Files"], [CELLS, "Cells"], [UPDATE, "Update"], [NETWORK, "Network"]]) named(node({ id, kind: "builtin", op: id }), name);

// --- data types, as code. A typedef's params are binders; fields point at
// type expressions. An effect is written the same way (`effect`): its
// variants are operations, and an operation's third entry is the type it
// returns (none: it never returns).
type TypeOf = (p: Id[], self: Id) => Id;
function typedef(id: Id, name: string, params: string[], variants: [string, [string, TypeOf][], TypeOf?][], effect = false, iface = false, unique?: string) {
  const ps = params.map((p) => named(node({ id: `${id}.${p}`, kind: "binder" }), p));
  const vs = variants.map(([vname, fields, returns]) => {
    const vid = `${id}.${vname}`;
    const fs = fields.map(([fname, ty]) => named(node({ id: `${vid}.${fname}`, kind: "field", type: ty(ps, id) }), fname));
    return named(node({ id: vid, kind: "variant", fields: fs, ...(returns ? { returns: returns(ps, id) } : {}) }), vname);
  });
  node({ id: `${id}.type`, kind: "typedef", params: ps, variants: vs, ...(effect ? { effect: true as const } : {}), ...(iface ? { interface: true as const } : {}), ...(unique ? { unique } : {}) });
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
// Random: `random()` is a Float64 in [0, 1). Like Log it isn't a world
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
// What a page's parts may do, named once: a view (a text, a part, an
// attribute's value) may read; a handler may also write and act on the
// world. Both rows are closed, because the page runtime is what runs them
// later, after `main` has returned, so no handler in the program is around
// them: an effect of the program's own is handled inside the view or the
// handler. Adding a runtime effect to pages is a change to these two lines.
// Log is in both: a log line is for whoever debugs the page, not the page,
// so a view may log (each time it runs, which is what debugging a view
// wants to see), where it may not print.
export const PAGE_VIEW: readonly Id[] = discharge("a page's text, part or attribute value", [CELLS, DIVERGE, TIME, NETWORK, LOG],
  "the page runtime runs a view in a watcher, under a step budget, after main has returned; a log line goes to the browser's console, once per run");
export const PAGE_HANDLER: readonly Id[] = discharge("a page's event handler", [CELLS, UPDATE, CONSOLE, FILES, ABORT, DIVERGE, TIME, NETWORK, RANDOM, LOG],
  "the page runtime runs a handler when its event comes, under a step budget, and logs an Abort; a log line goes to the browser's console");
// A sound (AUDIO.md): a function from a block of samples to the block to
// play, made by a function that makes its cells. The runtime runs the
// block function on the audio thread, 375 times a second, so its row is
// closed and has nothing that waits or prints: its cells (read and
// written), noise (Random, which the runtime seeds, so a render repeats)
// and a step budget. The
// maker runs once, and in the browser once more in the audio thread, so it
// may only make cells: both runs must make the same ones.
export const AUDIO_BLOCK: readonly Id[] = discharge("a sound's block function", [CELLS, UPDATE, RANDOM, DIVERGE],
  "the audio runtime runs it on each block, under a step budget, with Random seeded; a block that doesn't finish plays silence");
export const AUDIO_MAKER: readonly Id[] = discharge("a sound's maker", [CELLS, DIVERGE],
  "the audio runtime runs it once to get the block function, and in a page once more in the audio thread, so it may only make cells");
export const EVENT = typedef("std.event", "Event", [], [
  ["event", [["value", () => tref(STRING)], ["key", () => tref(STRING)]]],
]);
// Where a sound's samples come from (AUDIO.md): the microphone, or a
// recording the page fetches by its address and plays over and over.
export const INPUT = typedef("std.input", "Input", [], [
  ["microphone", []],
  ["recording", [["address", () => tref(STRING)]]],
]);
export const ATTRIBUTE = typedef("std.attribute", "Attribute", [], [
  ["property", [["name", () => tref(STRING)], ["value", () => tfun([], tref(STRING), [...PAGE_VIEW])]]],
  ["on", [["event", () => tref(STRING)], ["then", () => tfun([tref(EVENT)], tref(UNIT), [...PAGE_HANDLER])]]],
  // A sound played from an input when the element is clicked, and stopped
  // when it's clicked again (AUDIO.md, A2).
  ["listen", [["to", () => tref(INPUT)], ["play", () => tfun([tref(LIST, tref(NUMBER))], tref(LIST, tref(NUMBER)), [...AUDIO_BLOCK])]]],
]);
export const HTML = typedef("std.html", "Html", [], [
  ["element", [["tag", () => tref(STRING)], ["attributes", () => tref(LIST, tref(ATTRIBUTE))], ["children", (_, self) => tref(LIST, tref(self))]]],
  ["text", [["shows", () => tfun([], tref(STRING), [...PAGE_VIEW])]]],
  ["part", [["view", (_, self) => tfun([], tref(self), [...PAGE_VIEW])]]],
]);
// Fractions (NUMBERS.md stage 1, LANGUAGE-REVIEW-2026-10-24 L39): exact,
// a quotient of two Ints kept in lowest terms with the bottom positive, so
// every fraction has one spelling and `equal` and hashes stay right. Last
// among the types here, so the ids of the type expressions above don't
// move. Its arithmetic is the prelude's (src/lang/prelude-source.ts),
// which the one generic `+` resolves to (src/lang/arith.ts).
export const RATIONAL = typedef("std.rational", "Rational", [], [
  ["ratio", [["top", () => tref(INT)], ["bottom", () => tref(INT)]]],
]);
export const RATIO = "std.rational.ratio";
// Complex numbers (NUMBERS.md, LANGUAGE-REVIEW-2026-10-24 L40): one case of
// two Float64s, re + im·i. A record of Float64s, so the parts builtins and
// the vectors module work on it (its magnitude is |z|), but a number type
// of its own: · is the complex product, which is the prelude's like
// Rational's, and there is no <. After Rational, so ids above don't move.
export const COMPLEX = typedef("std.complex", "Complex", [], [
  ["complex", [["re", () => tref(NUMBER)], ["im", () => tref(NUMBER)]]],
]);
export const COMPLEX_V = "std.complex.complex";
// What `compare` answers (L66): a before b, the same, or after.
export const ORDER = typedef("std.order", "Order", [], [["before", []], ["same", []], ["after", []]]);
export const ORDER_V = { before: "std.order.before", same: "std.order.same", after: "std.order.after" } as const;
// The data form of Abort, as Optional is of Choice (L67): a run that may
// have been refused, kept with its reason so it can go in a list or a
// record. The prelude's `attempt` turns an Abort into one, `value or
// abort` turns one back. Rust's Result is the influence; here the effect
// is the default and the data the exception.
export const OUTCOME = typedef("std.outcome", "Outcome", ["a"], [
  ["done", [["value", ([a]) => tref(a)]]],
  ["refused", [["reason", () => tref(STRING)]]],
]);
export const OUTCOME_V = { done: "std.outcome.done", refused: "std.outcome.refused" } as const;
// Maps and sets (L65, DATA-STRUCTURES.md): ordinary data with one spelling,
// the entries sorted by key in compare's order with no key twice, the
// items sorted with none twice. So equal, show, compare and hashing need
// no special case, and a fold goes in key order. The prelude builds them
// and keeps the spelling; how they are stored is a representation (L76).
export const MAP = typedef("std.map", "Map", ["k", "v"], [
  ["map of", [["entries", ([k, v]) => tref(LIST, tref(PAIR, tref(k), tref(v)))]]],
]);
export const SET_TYPE = typedef("std.set", "Set", ["k"], [
  ["set of", [["items", ([k]) => tref(LIST, tref(k))]]],
]);
export const MAP_V = "std.map.map of", SET_V = "std.set.set of";
// One line of an algebra's multiplication table (ALGEBRA-TABLES.md): two
// basis elements and their product, as values of the type itself, so
// Complex's i · i = −1 is times(i, i, −1). The prelude's `table product`
// multiplies by a list of them.
export const TABLE_ENTRY = typedef("std.tableEntry", "Table entry", ["a"], [
  ["times", [["left", ([a]) => tref(a)], ["right", ([a]) => tref(a)], ["gives", ([a]) => tref(a)]]],
]);
export const TIMES_V = "std.tableEntry.times";
// Algebraic numbers (EXACT-REALS.md, BACKLOG L88): a number held by the
// equation it solves, √2 as the root of x² − 2 between 1 and 2. Its
// minimal polynomial's coefficients (constant first) and which real root it
// is, from the smallest at 0: one spelling per number, so `equal` is
// right. Its arithmetic is src/lang/algebraic.ts, the builtins below.
export const ALGEBRAIC = typedef("std.algebraic", "Algebraic", [], [
  ["algebraic", [["polynomial", () => tref(LIST, tref(INT))], ["root", () => tref(INT)]]],
]);
export const ALGEBRAIC_V = "std.algebraic.algebraic";
// Trig, the first interface (INTERFACES.md, BACKLOG L40f): sin, cos, tan,
// exp and log at any type that has them. Float64's implementation is the
// prelude's `trig at float64`, its builtins; dual numbers are next. A use
// is resolved to the type's own function before anything runs (arith.ts).
const TRIG_NAMES = ["sin", "cos", "tan", "exp", "log"] as const;
export const TRIG = typedef("std.trig", "Trig", ["a"], [
  ["trig", TRIG_NAMES.map((op): [string, TypeOf] => [op, ([a]) => tfun([tref(a)], tref(a), [])])],
], false, true);
export const TRIG_V = "std.trig.trig";
export const TRIG_OPS = Object.fromEntries(TRIG_NAMES.map((op) => [op, `${TRIG_V}.${op}`])) as Record<(typeof TRIG_NAMES)[number], Id>;
// Trig's polar (POLAR.md, BACKLOG L97c): a field with results, the
// predicate polar(length, angle, x, y) read as (length, angle) → x, y. A
// use is a solve of it, `x, y = polar(r, t)`, resolved like any field to
// what the type gives. Its type's nodes have ids of their own, so the ids
// after Trig don't move.
export const TRIG_POLAR = `${TRIG_V}.polar`;
{
  const port = (i: number) => node({ id: `${TRIG_POLAR}.t${i}`, kind: "tref", target: `${TRIG}.a`, args: [] });
  const type = node({ id: `${TRIG_POLAR}.type`, kind: "tfun", params: [0, 1, 2, 3].map(port), result: node({ id: `${TRIG_POLAR}.t4`, kind: "tref", target: BOOL, args: [] }), effects: [] });
  named(node({ id: TRIG_POLAR, kind: "field", type, results: [2, 3], ports: ["length", "angle", "x", "y"] }), "polar");
  (nodes.find((n) => n.id === TRIG_V) as NodeOf<"variant">).fields.push(TRIG_POLAR);
}
// And its other direction, unpolar: the same four ports read as (x, y) →
// length, angle (L97c2), atan2 and the length of a vector at once.
export const TRIG_UNPOLAR = `${TRIG_V}.unpolar`;
{
  const port = (i: number) => node({ id: `${TRIG_UNPOLAR}.t${i}`, kind: "tref", target: `${TRIG}.a`, args: [] });
  const type = node({ id: `${TRIG_UNPOLAR}.type`, kind: "tfun", params: [0, 1, 2, 3].map(port), result: node({ id: `${TRIG_UNPOLAR}.t4`, kind: "tref", target: BOOL, args: [] }), effects: [] });
  named(node({ id: TRIG_UNPOLAR, kind: "field", type, results: [0, 1], ports: ["length", "angle", "x", "y"] }), "unpolar");
  (nodes.find((n) => n.id === TRIG_V) as NodeOf<"variant">).fields.push(TRIG_UNPOLAR);
}
// asin and acos (POLAR.md, L97c3): angles read off unpolar, (a) -> a like
// sin and cos.
export const TRIG_ASIN = `${TRIG_V}.asin`, TRIG_ACOS = `${TRIG_V}.acos`;
for (const [id, name] of [[TRIG_ASIN, "asin"], [TRIG_ACOS, "acos"]]) {
  const type = node({ id: `${id}.type`, kind: "tfun", params: [node({ id: `${id}.t0`, kind: "tref", target: `${TRIG}.a`, args: [] })], result: node({ id: `${id}.t1`, kind: "tref", target: `${TRIG}.a`, args: [] }), effects: [] });
  named(node({ id, kind: "field", type }), name);
  (nodes.find((n) => n.id === TRIG_V) as NodeOf<"variant">).fields.push(id);
}
// Dual numbers (INTERFACES.md step 3, BACKLOG L40g): value + slope·ε with
// ε² = 0, so f(dual(x, 1)) carries f′(x) along with f(x). A record of two
// Float64s, like Complex: + and − part by part, · the product rule (the
// prelude's), no <, and Trig by the chain rule. After Trig, so ids above
// don't move.
export const DUAL = typedef("std.dual", "Dual", [], [
  ["dual", [["value", () => tref(NUMBER)], ["slope", () => tref(NUMBER)]]],
// the same shape as Complex, so it says it is its own type
], false, false, "dual numbers");
export const DUAL_V = "std.dual.dual";
// The one + − · −x and < as interfaces (INTERFACES.md step 4, BACKLOG L40h):
// the generic builtins (ARITH) are these fields' operations, so a type of
// your own joins them with an implementation, `arithmetic at quaternion =
// arithmetic(…)`. Each number type's own are the prelude's implementations;
// a record of Float64s with none does + − part by part, as before.
const binary = ([a]: Id[]) => tfun([tref(a), tref(a)], tref(a), []);
export const ARITHMETIC = typedef("std.arithmetic", "Arithmetic", ["a"], [
  ["arithmetic", [["add", binary], ["subtract", binary], ["multiply", binary], ["negate", ([a]) => tfun([tref(a)], tref(a), [])]]],
], false, true);
export const ARITHMETIC_V = "std.arithmetic.arithmetic";
export const ORDERED = typedef("std.ordered", "Ordered", ["a"], [
  ["ordered", [["less", ([a]) => tfun([tref(a), tref(a)], tref(BOOL), [])]]],
], false, true);
export const ORDERED_V = "std.ordered.ordered";
// Fixed (FIXED-POINT.md, BACKLOG L89): a number counted in steps of 2⁻³²,
// an Int of steps, so it has the same bits on every target and the same
// step size everywhere in a big world. + − · < are the prelude's, Int
// arithmetic with · rounded down; a literal at Fixed is its digits rounded
// once to the nearest step. After Ordered, so ids above don't move.
export const FIXED = typedef("std.fixed", "Fixed", [], [
  ["fixed", [["steps", () => tref(INT)]]],
], false, false, "fixed-point numbers");
export const FIXED_V = "std.fixed.fixed";
// Small matrices (BACKLOG L44): Mat2, Mat3 and Mat4, records of Float64s
// in rows (m11, m12, …). + − part by part, · the matrix product from the
// matrix-unit table (E_ij · E_jl = E_il, the prelude's matrix table), and
// a literal is that many times the identity, so 2 + m adds 2 down the
// diagonal. After Fixed, so ids above don't move.
const matrix = (n: number) => typedef(`std.mat${n}`, `Mat${n}`, [], [
  [`mat${n}`, Array.from({ length: n * n }, (_, i): [string, TypeOf] => [`m${Math.floor(i / n) + 1}${(i % n) + 1}`, () => tref(NUMBER)])],
], false, false, `${n} × ${n} matrices`);
export const MAT2 = matrix(2), MAT3 = matrix(3), MAT4 = matrix(4);
export const MAT_V = { 2: "std.mat2.mat2", 3: "std.mat3.mat3", 4: "std.mat4.mat4" } as const;
// The constructors whose types have a rule, private to the library that
// keeps it (the prelude; REVIEW-2026-10-26.md §2): `set of([3, 1, 3])`,
// `ratio(2, 4)` and `ratio(1, 0)` would break it. What to use instead,
// for the checker's message.
export const SMART: Record<Id, string> = { [RATIO]: "fraction or as fraction", [ALGEBRAIC_V]: "as algebraic or square root", [MAP_V]: "empty map, as map or put", [SET_V]: "empty set, as set or add item" };
for (const v of Object.keys(SMART)) (nodes.find((n) => n.id === v) as NodeOf<"variant">).private = true;
export const HTML_V = { element: "std.html.element", text: "std.html.text", part: "std.html.part", property: "std.attribute.property", on: "std.attribute.on", listen: "std.attribute.listen", event: "std.event.event", microphone: "std.input.microphone", recording: "std.input.recording" } as const;

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
// A partial builtin: Choice with no answer or one, never more (the compiler
// relies on it: compiler/src/compile.ts `$partial`, GAPS.md G24).
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

// What a search's function does besides Choice: never the world, since it
// runs on paths the search abandons or repeats (LANGUAGE.md, "The world and
// Choice"). The checker puts the call's row around it instead of making
// them one (infer.ts, SEARCHES), so code beside the search may still act.
const searchRow = (s: Subst): Row => { const e = s.freshRow(); s.noWorld.add(e.tail!); return e; };

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
  // The nearest binary32 value (ties to even): what a GPU holds. The job
  // of every Float64 operation in the Float32 representation (NUMBERS.md).
  float32: builtin("float32", "round to Float32", pure([num], num), Math.fround),
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
  // An implementation's field left to the interface's ways (WAYS.md, L96):
  // arith.ts puts the cheapest way that ends in given code in its place,
  // so nothing ever runs this.
  byItsWays: builtin("byItsWays", "by its ways", (s) => s.fresh()),
  // A function's derivative, read off its graph (src/lang/derive.ts). Where
  // the slope can't be read (the function goes through floor, or takes
  // apart data built from its input) there is none, so the derivative may
  // fail: Choice. (Unless the checker can see f and read all its slopes:
  // infer.ts types that derivative(f) without Choice.)
  derivative: builtin("derivative", "derivative", (s) => {
    const e = s.freshRow();
    return fn([fn([num], num, e)], fn([num], num, { effs: [CHOICE], tail: e.tail }), s.freshRow());
  }),
  // A function of a point's (or any record of Float64s') gradient: the
  // record of its derivatives along each part, so the normal of a surface
  // f(p) = 0 is unit(gradient(f)(p)). Choice as for derivative, and
  // dropped the same way when the checker can read every slope.
  gradient: builtin("gradient", "gradient", (s) => {
    const r = s.fresh(false, true), e = s.freshRow();
    return fn([fn([r], num, e)], fn([r], r, { effs: [CHOICE], tail: e.tail }), s.freshRow());
  }),
  // Parts: a record of Float64s (Float64 itself, or one case whose fields are
  // all Float64s: a point, a colour) taken part by part, so arithmetic on
  // points and colours is written once, for all of them (the prelude's
  // vector operations). The function must be pure: it runs once per part.
  // On a GPU these are vector operations (compiler/src/wgsl.ts).
  mapParts: builtin("mapParts", "map parts", (s) => { const r = s.fresh(false, true); return fn([fn([num], num, { effs: [], tail: null }), r], r, s.freshRow()); }),
  zipParts: builtin("zipParts", "zip parts", (s) => { const r = s.fresh(false, true); return fn([fn([num, num], num, { effs: [], tail: null }), r, r], r, s.freshRow()); }),
  total: builtin("total", "total", (s) => fn([s.fresh(false, true)], num, s.freshRow())),
  // Console
  print: builtin("print", "print", (s) => fn([str], unit, s.freshRow([CONSOLE]))),
  // Handlers. Each takes thunks and removes an effect from them.
  all: builtin("all", "all", (s) => { const a = s.fresh(), e = searchRow(s); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], list(a), e); }),
  count: builtin("count", "count", (s) => { const a = s.fresh(), e = searchRow(s); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], num, e); }),
  // The default runs after the search, not under it: it may act, and the
  // call does what either does.
  first: builtin("first", "first", (s) => {
    const a = s.fresh(), e = searchRow(s), d = s.freshRow();
    s.subs.push({ from: e, to: d });
    return fn([fn([], a, { effs: [CHOICE], tail: e.tail }), fn([], a, d)], a, d);
  }),
  // The at-most-one sibling of all: the first answer as some(answer), or
  // none. This is how a Choice becomes data that can be stored.
  optional: builtin("optional", "optional", (s) => { const a = s.fresh(), e = searchRow(s); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], optional(a), e); }),
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
const pathOf = (whole: Type, part: Type): Type => ({ t: "con", id: PATH, args: [whole, part] });
export const CELL_OPS = {
  cell: builtin("cells.cell", "cell", (s) => { const a = s.fresh(); return fn([a], cellOf(a), s.freshRow([CELLS])); }),
  formula: builtin("cells.formula", "formula", (s) => { const a = s.fresh(); return fn([fn([], a, { effs: [CELLS, DIVERGE], tail: null })], cellOf(a), s.freshRow([CELLS])); }),
  // A list's items mapped one by one, as a formula: an item still there
  // keeps what f made of it (cells.ts each; a page keeps its row).
  each: builtin("cells.each", "each", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([cellOf(list(a)), fn([a], b, { effs: [CELLS, DIVERGE], tail: null })], cellOf(list(b)), s.freshRow([CELLS]));
  }),
  // The same over a list inside a cell, as a row has it (its item's
  // steps): a step added or moved makes or moves one row of this, and
  // the row it's in isn't made again. Over a plain list, mapped once.
  eachOf: builtin("cells.eachOf", "each of", (s) => {
    const a = s.fresh(), b = s.fresh();
    return fn([list(a), fn([a], b, { effs: [CELLS, DIVERGE], tail: null })], cellOf(list(b)), s.freshRow([CELLS]));
  }),
  read: builtin("cells.read", "read", (s) => { const a = s.fresh(); return fn([cellOf(a)], a, s.freshRow([CELLS, DIVERGE])); }),
  write: builtin("cells.write", "write", (s) => { const a = s.fresh(); return fn([cellOf(a), a], unit, s.freshRow([UPDATE])); }),
  // Places and edits at them (L98, STABLE-REFERENCES.md §1). A path names
  // a place inside a cell's value: `path(f)` from a field or a path of
  // fields written in place ((t) ↦ t is the whole), `item path(p, i)` item
  // i of the list at p, `then path(p, q)` q inside p. An edit at a place
  // copies only the way down to it and wakes only the readers of that
  // place, of places inside it and of places around it; `read at` is a
  // reader of one place. A place that isn't there: read at has no answer
  // and an edit changes nothing.
  path: builtin("cells.path", "path", (s) => { const r = s.fresh(), a = s.fresh(); return fn([fn([r], a, s.freshRow())], pathOf(r, a), s.freshRow()); }),
  itemPath: builtin("cells.itemPath", "item path", (s) => { const w = s.fresh(), a = s.fresh(); return fn([pathOf(w, list(a)), int], pathOf(w, a), s.freshRow()); }),
  thenPath: builtin("cells.thenPath", "then path", (s) => { const a = s.fresh(), b = s.fresh(), c = s.fresh(); return fn([pathOf(a, b), pathOf(b, c)], pathOf(a, c), s.freshRow()); }),
  readAt: builtin("cells.readAt", "read at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, b)], b, s.freshRow([CELLS, DIVERGE, CHOICE])); }),
  writeAt: builtin("cells.writeAt", "write at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, b), b], unit, s.freshRow([UPDATE])); }),
  insertAt: builtin("cells.insertAt", "insert at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, list(b)), int, b], unit, s.freshRow([UPDATE])); }),
  removeAt: builtin("cells.removeAt", "remove at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, list(b)), int], unit, s.freshRow([UPDATE])); }),
  moveAt: builtin("cells.moveAt", "move at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, list(b)), int, int], unit, s.freshRow([UPDATE])); }),
};

// The builtins that run a function they're given and keep one of its
// effects inside (the ledger, ledger.ts). Their types say so; the test
// checks each type drops exactly what its row here says.
discharge("all, count", [CHOICE], "every answer, collected into a list or counted", [S.all, S.count]);
discharge("first", [CHOICE], "the first answer, or the default when there's none", [S.first]);
discharge("optional", [CHOICE], "the first answer as some(answer), or none", [S.optional]);
discharge("with fuel", [DIVERGE], "at most n calls that may not end, then no answer: Diverge becomes Choice", [S.fuel]);
discharge("seeded", [RANDOM], "the same numbers for the same seed, from a generator in the program", [S.seeded]);
discharge("formula, each", [DIVERGE], "a formula runs when it's read, so read has Diverge instead", [CELL_OPS.formula, CELL_OPS.each, CELL_OPS.eachOf]);

// Int: whole numbers that never overflow. Same names as Float64's, because
// names are presentation (NUMBERS.md stage 2): the palette offers the one
// whose types fit. Division and powers can have no answer, so they're
// Choice rather than a crash or a NaN.
export const INT_OPS = {
  add: builtin("int.add", "add", pure([int, int], int), I.add),
  sub: builtin("int.sub", "subtract", pure([int, int], int), I.sub),
  mul: builtin("int.mul", "multiply", pure([int, int], int), I.mul),
  neg: builtin("int.neg", "negate", pure([int], int), I.neg),
  abs: builtin("int.abs", "abs", pure([int], int), I.abs),
  shiftDown: builtin("int.shiftDown", "shifted down", pure([int, int], int), I.shiftDown),
  less: builtin("int.less", "less than", pure([int, int], bool), (a: I.Int, b: I.Int) => truth(I.less(a, b))),
  quotient: choice("int.quotient", "quotient", [int, int], int, I.quotient),
  remainder: choice("int.remainder", "remainder", [int, int], int, I.remainder),
  power: choice("int.power", "power", [int, int], int, I.power),
  // Both divided by their greatest common divisor, the bottom made positive:
  // a fraction's one spelling. Total: (n, 0) gives (±1, 0) and (0, 0) stays.
  lowestTerms: builtin("int.lowestTerms", "lowest terms", pure([int, int], { t: "con", id: PAIR, args: [int, int] }), (a: I.Int, b: I.Int) => {
    const [t, u] = I.lowestTerms(a, b);
    return { tag: "std.pair.pair", fields: [t, u] };
  }),
  show: builtin("int.show", "show", pure([int], str), I.show),
  read: choice("int.read", "read whole number", [str], int, I.read),
  toNumber: builtin("int.toNumber", "as float64", pure([int], num), I.toNumber),
  wholePart: choice("int.wholePart", "whole part", [num], int, I.wholePart),
  // 0, 1, …, n − 1. A list of a billion items is a billion cells, so this
  // is for sizes that fit in memory, like everything else.
  range: builtin("int.range", "range", pure([int], list(int)), (n: I.Int) => {
    let l: object = { tag: "std.list.nil", fields: [] };
    for (let i = Number(n) - 1; i >= 0; i--) l = { tag: "std.list.cons", fields: [i, l] };
    return l;
  }),
};

// One + for every number type (NUMBERS.md, "One `+` for every number
// system"): each of these works on any number type (Float64, Int, or a
// record of Float64s; `less than` on Float64 or Int), and the program is
// resolved to the type's own operation before anything runs it
// (src/lang/arith.ts), so they have no implementation of their own: the
// one here says so if a caller forgot to resolve.
const unresolved = (name: string) => () => { throw new Error(`the generic ${name} must be resolved to its type's own operation first (arith.ts)`); };
const generic = (op: string, name: string, arity: 1 | 2, kind: "arith" | "ordered" = "arith") =>
  builtin(`arith.${op}`, name, (s) => {
    const a = s.fresh(false, false, kind);
    return fn(arity === 1 ? [a] : [a, a], kind === "ordered" ? bool : a, s.freshRow());
  }, unresolved(name));
export const ARITH = {
  add: generic("add", "add", 2),
  sub: generic("sub", "subtract", 2),
  mul: generic("mul", "multiply", 2),
  neg: generic("neg", "negate", 1),
  less: generic("less", "less than", 2, "ordered"),
};
// Which interface's field each generic operation is (INTERFACES.md step 4).
export const ARITH_FIELD: Record<Id, { iface: Id; field: Id }> = {
  [ARITH.add]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.add` },
  [ARITH.sub]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.subtract` },
  [ARITH.mul]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.multiply` },
  [ARITH.neg]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.negate` },
  [ARITH.less]: { iface: ORDERED, field: `${ORDERED_V}.less` },
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

// Algebraic's operations (src/lang/algebraic.ts). The one + − · −x <
// resolves to these at Algebraic (arith.ts); a literal there is `fraction`.
const alg: Type = { t: "con", id: "std.algebraic", args: [] };
const rational: Type = { t: "con", id: "std.rational", args: [] };
export const toAlg = (v: { fields: unknown[] }): A.Algebraic => ({ p: itemsOf(v.fields[0] as { tag: Id; fields: unknown[] }).map((c) => BigInt(c as I.Int)), k: Number(v.fields[1]) });
export const ofAlg = (x: A.Algebraic) => ({ tag: ALGEBRAIC_V, fields: [listOf(x.p.map(I.norm)), x.k] });
const one = (f: (...xs: A.Algebraic[]) => A.Algebraic) => (...vs: { fields: unknown[] }[]) => ofAlg(f(...vs.map(toAlg)));
export const ALGEBRAIC_OPS = {
  add: builtin("algebraic.add", "add", pure([alg, alg], alg), one(A.add)),
  sub: builtin("algebraic.sub", "subtract", pure([alg, alg], alg), one(A.subtract)),
  mul: builtin("algebraic.mul", "multiply", pure([alg, alg], alg), one(A.multiply)),
  neg: builtin("algebraic.neg", "negate", pure([alg], alg), one(A.negate)),
  less: builtin("algebraic.less", "less than", pure([alg, alg], bool), (a: { fields: unknown[] }, b: { fields: unknown[] }) => truth(A.less(toAlg(a), toAlg(b)))),
  divide: choice("algebraic.divide", "divide", [alg, alg], alg, (a: { fields: unknown[] }, b: { fields: unknown[] }) => { const q = A.divide(toAlg(a), toAlg(b)); return q ? [ofAlg(q)] : []; }),
  // The real k-th root: the positive one for an even k, none of a negative
  // number then.
  root: choice("algebraic.root", "root", [alg, int], alg, (a: { fields: unknown[] }, k: I.Int) => { const r = A.root(toAlg(a), Number(k)); return r ? [ofAlg(r)] : []; }),
  sqrt: choice("algebraic.sqrt", "square root", [alg], alg, (a: { fields: unknown[] }) => { const r = A.root(toAlg(a), 2); return r ? [ofAlg(r)] : []; }),
  // top/bottom, which a literal at Algebraic becomes (the checker has made
  // sure bottom isn't 0). Not offered: `as algebraic` is.
  fraction: builtin("algebraic.fraction", "algebraic fraction", pure([int, int], alg), (n: I.Int, d: I.Int) => ofAlg(A.fraction(BigInt(n), BigInt(d)))),
  ofRational: builtin("algebraic.ofRational", "as algebraic", pure([rational], alg), (r: { fields: I.Int[] }) => ofAlg(A.fraction(BigInt(r.fields[0]), BigInt(r.fields[1])))),
  // The fraction it is, when it is one: √2 · √2 is 2.
  asFraction: choice("algebraic.asFraction", "as fraction", [alg], rational, (a: { fields: unknown[] }) => {
    const f = A.asFraction(toAlg(a));
    return f ? [{ tag: RATIO, fields: f.map(I.norm) }] : [];
  }),
  digits: builtin("algebraic.digits", "digits", pure([alg, int], str), (a: { fields: unknown[] }, n: I.Int) => A.digits(toAlg(a), Number(n))),
  toNumber: builtin("algebraic.toNumber", "as float64", pure([alg], num), (a: { fields: unknown[] }) => A.toNumber(toAlg(a))),
  show: builtin("algebraic.show", "show", pure([alg], str), (a: { fields: unknown[] }) => A.show(toAlg(a))),
};


// show for any plain value: [1, 2, 3], circle(2), "text". Cases print
// with the program's names, which the runtime is given (names are
// presentation, so they're an input to the run, like the console). Float64's
// own show stays: run backwards, it is what reads numbers.
export const SHOW_ANY = builtin("showAny", "show", (s) => fn([s.fresh(true)], str, s.freshRow()));
// The order on plain data (L66, run.ts compareValues): numbers by value,
// text by code point, cases in the order their type declares them, then
// fields left to right. Plain data only, like `equal`.
export const COMPARE = builtin("compare", "compare", (s) => { const a = s.fresh(true); return fn([a, a], { t: "con", id: "std.order", args: [] }, s.freshRow()); });

// Records: set(field, record, value) is the record with that field changed.
// `field` is a field, or a path of fields (p ↦ p.address.city), which the
// checker insists on; the update is that path run backwards, with every
// other field kept (src/lang/records.ts).
export const SET = builtin("set", "set", (s) => {
  const r = s.fresh(), a = s.fresh();
  return fn([fn([r], a, s.freshRow()), r, a], r, s.freshRow());
});

export const std: Code = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), defs: [BOOL, UNIT, LIST, PAIR, OPTIONAL, ABORT, LOG, RANDOM, TIME, WAIT, EVENT, INPUT, ATTRIBUTE, HTML, RATIONAL, COMPLEX, ORDER, OUTCOME, MAP, SET_TYPE, TABLE_ENTRY, ALGEBRAIC, TRIG, DUAL, ARITHMETIC, ORDERED, FIXED, MAT2, MAT3, MAT4] };
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
