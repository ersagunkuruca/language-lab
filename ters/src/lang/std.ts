// The standard library of the typed core: builtin types, a few data types
// written as ordinary typedef nodes (Bool, List, Unit, the tuples), and builtins
// with their type signatures. Everything has a stable id so programs can
// refer to it, exactly like prelude.ts.

import { discharge } from "./ledger.ts";
import type { Code, Id, Node, NodeOf } from "../model.ts";
import { isCall, toTodaysShape } from "../model.ts";
import moved0 from "../../library/moved.json" with { type: "json" };
import type { Names } from "../presentation.ts";
import { B, impl } from "../prelude.ts";
import { MASK_TYPES, NAMED_ROWS, ARRAY, TABLE, HASH_SET, CELL, PATH, JOB, CELLS, UPDATE, CHOICE, CONSOLE, DIVERGE, FILES, INT, NETWORK, NUMBER, STRING, type Row, type Subst, type Type } from "./types.ts";
import * as I from "./int.ts";
import * as T from "./text.ts";
import * as A from "./algebraic.ts";

const nodes: Node[] = [];
const node = (n: Node) => (nodes.push(n), n.id);
const names: Names = {};
const named = (id: Id, name: string) => ((names[id] = name), id);

// --- builtin types and effects (named nodes, so they can be referenced)
for (const [id, name] of [[NUMBER, "Float64"], [STRING, "Text"], [INT, "Int"], [CELL, "Cell"], [PATH, "Path"], [JOB, "Job"], [ARRAY, "Array"], [TABLE, "Table"], [HASH_SET, "Hash set"]]) named(node({ id, kind: "builtin", op: id }), name);
for (const [id, { name }] of Object.entries(MASK_TYPES)) named(node({ id, kind: "builtin", op: id }), name);
// (Console, Files and Network are effects declared below, with operations.)
for (const [id, name] of [[CHOICE, "Choice"], [DIVERGE, "Diverge"], [CELLS, "Cells"], [UPDATE, "Update"]]) named(node({ id, kind: "builtin", op: id }), name);

// --- data types, as code. A typedef's params are binders; fields point at
// type expressions. An effect is written the same way (`effect`): its
// variants are operations, and an operation's third entry is the type it
// returns (none: it never returns).
type TypeOf = (p: Id[], self: Id) => Id;
// An operation's fourth entry: answered `later` (ANSWERED-LATER.md), and
// its `own` type variables (L71a), given to its types after the effect's.
type OpExtra = { later?: true; own?: string[] };
function typedef(id: Id, name: string, params: string[], variants: [string, [string, TypeOf][], TypeOf?, OpExtra?][], effect = false, iface = false, unique?: string) {
  const ps = params.map((p) => named(node({ id: `${id}.${p}`, kind: "binder" }), p));
  const vs = variants.map(([vname, fields, returns, extra]) => {
    const vid = `${id}.${vname}`;
    const mine = (extra?.own ?? []).map((p) => named(node({ id: `${vid}.${p}`, kind: "binder" }), p)), all = [...ps, ...mine];
    const fs = fields.map(([fname, ty]) => named(node({ id: `${vid}.${fname}`, kind: "field", type: ty(all, id) }), fname));
    return named(node({ id: vid, kind: "variant", fields: fs, ...(returns ? { returns: returns(all, id) } : {}), ...(extra?.later ? { later: true as const } : {}), ...(mine.length ? { params: mine } : {}) }), vname);
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
// Two values together is a Tuple2 (below; BACKLOG L139): std once had its
// own Pair beside it, and a saved program's ids for it read as Tuple2's
// (RENAMED_IDS). Its two trefs' numbers are kept, so the ones after them
// don't move.
export const PAIR = "std.tuple2";
tn += 2;

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
// Check (TESTS-IN-THE-LANGUAGE.md, BACKLOG T7a): a test is a definition
// that performs `expect(holds, what)`. Its handler decides what a failure
// means: `lab test` collects every one (a failing expect doesn't stop the
// test), the editor shows them on the definition. Not a world effect, so a
// test may search (Choice) and is checked on every path.
export const CHECK = typedef("std.check", "Check", [], [["expect", [["holds", () => tref(BOOL)], ["what", () => tref(STRING)]], () => tref(UNIT)]], true);
export const CHECK_OP = "std.check.expect";
// Time: `now()` is the time in milliseconds since 1970 (UTC). Reading the
// clock changes nothing, so like Random it may run under Choice, and a
// match can answer it (a test's fixed clock). In a page, a part that reads
// it runs again every animation frame (browser.ts), so a clock is a part
// that shows `now()`. Wait: `wait(ms)` pauses the program, on the command
// line. Its own effect, so a page's parts, which may not wait, say so in
// their types; a page's handlers may (C40, PAGE_HANDLER).
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
// Choice too (L125b, Ersagun 2026-11-01): a view with no answer, one that
// divides by 0, shows nothing there; a view only reads, so nothing is done
// on a path that is abandoned. A handler still handles its own Choice.
export const PAGE_VIEW: readonly Id[] = discharge("a page's text, part or attribute value", [CELLS, DIVERGE, TIME, NETWORK, LOG, CHOICE],
  "the page runtime runs a view in a watcher, under a step budget, after main has returned; a view with no answer shows nothing; a log line goes to the browser's console, once per run");
// A handler may wait (C40, PAGE-WAITS-2026-11-03.md, Ersagun 2026-11-04):
// `wait`, and `await` of a timer, a fetch or `any of`. What it wrote
// before a wait lands and shows then; it goes on when the wait is
// answered, the next stretch a step of its own. Another event meanwhile
// runs too, the two taking turns at their waits. Await is named by its
// id: it is defined further down.
export const PAGE_HANDLER: readonly Id[] = discharge("a page's event handler", [CELLS, UPDATE, CONSOLE, FILES, ABORT, DIVERGE, TIME, WAIT, "std.await", NETWORK, RANDOM, LOG],
  "the page runtime runs a handler when its event comes, under a step budget, and logs an Abort; a log line goes to the browser's console; a wait lands what the handler did so far, and the rest runs when it's answered");
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
// The hosts' rows by name (HOSTS.md, L58): Html's and Attribute's fields
// list them, so a view's type reads `() -[View]-> Text`, and the
// definitions are where the policy can be read. Each is the ledger's list,
// so what the type says and what the runtime handles are one list. Prior
// art: Koka's effect aliases (`alias io = <console, fsys, net, …>`).
const namedRow = (id: Id, name: string, effects: readonly Id[]) => {
  node({ id: `${id}.type`, kind: "typedef", params: [], variants: [], row: [...effects] });
  NAMED_ROWS.set(id, effects);
  return named(node({ id, kind: "def", body: `${id}.type` }), name);
};
export const VIEW_ROW = namedRow("std.row.view", "View", PAGE_VIEW);
export const HANDLER_ROW = namedRow("std.row.handler", "Handler", PAGE_HANDLER);
export const SOUND_ROW = namedRow("std.row.sound", "Sound", AUDIO_BLOCK);
export const EVENT = typedef("std.event", "Event", [], [
  ["event", [["value", () => tref(STRING)], ["key", () => tref(STRING)], ["x", () => tref(NUMBER)], ["y", () => tref(NUMBER)], ["seconds", () => tref(NUMBER)]]],
]);
// Where a sound's samples come from (AUDIO.md): the microphone, or a
// recording the page fetches by its address and plays over and over.
export const INPUT = typedef("std.input", "Input", [], [
  ["microphone", []],
  ["recording", [["address", () => tref(STRING)]]],
]);
export const ATTRIBUTE = typedef("std.attribute", "Attribute", [], [
  ["property", [["name", () => tref(STRING)], ["value", () => tfun([], tref(STRING), [VIEW_ROW])]]],
  ["on", [["event", () => tref(STRING)], ["then", () => tfun([tref(EVENT)], tref(UNIT), [HANDLER_ROW])]]],
  // A sound played from an input when the element is clicked, and stopped
  // when it's clicked again (AUDIO.md, A2).
  ["listen", [["to", () => tref(INPUT)], ["play", () => tfun([tref(LIST, tref(NUMBER))], tref(LIST, tref(NUMBER)), [SOUND_ROW])]]],
]);
export const HTML = typedef("std.html", "Html", [], [
  ["element", [["tag", () => tref(STRING)], ["attributes", () => tref(LIST, tref(ATTRIBUTE))], ["children", (_, self) => tref(LIST, tref(self))]]],
  ["text", [["shows", () => tfun([], tref(STRING), [VIEW_ROW])]]],
  ["part", [["view", (_, self) => tfun([], tref(self), [VIEW_ROW])]]],
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
  // log has no answer at 0 or below, so it may fail (L125b).
  ["trig", TRIG_NAMES.map((op): [string, TypeOf] => [op, ([a]) => tfun([tref(a)], tref(a), op === "log" ? [CHOICE] : [])])],
], false, true);
export const TRIG_V = "std.trig.trig";
export const TRIG_OPS = Object.fromEntries(TRIG_NAMES.map((op) => [op, `${TRIG_V}.${op}`])) as Record<(typeof TRIG_NAMES)[number], Id>;
// Trig's polar (POLAR.md, BACKLOG L97c): a field with results, typed as
// the plain function (length, angle) → x, y (L128d3), its ports named in
// that order. A use solves it, `x, y = polar(r, t)`, resolved like any
// field to what the type gives. Its type's nodes have ids of their own, so the ids
// after Trig don't move.
export const TRIG_POLAR = `${TRIG_V}.polar`;
{
  const port = (i: number) => node({ id: `${TRIG_POLAR}.t${i}`, kind: "tref", target: `${TRIG}.a`, args: [] });
  const type = node({ id: `${TRIG_POLAR}.type`, kind: "tfun", params: [0, 1].map(port), result: node({ id: `${TRIG_POLAR}.t4`, kind: "tref", target: tupleType(2), args: [2, 3].map(port) }), effects: [] });
  named(node({ id: TRIG_POLAR, kind: "field", type, ports: ["length", "angle", "x", "y"] }), "polar");
  (nodes.find((n) => n.id === TRIG_V) as NodeOf<"variant">).fields.push(TRIG_POLAR);
}
// And its other direction, unpolar: the same four ports as the function
// (x, y) → length, angle (L97c2), atan2 and the length of a vector at once.
export const TRIG_UNPOLAR = `${TRIG_V}.unpolar`;
{
  const port = (i: number) => node({ id: `${TRIG_UNPOLAR}.t${i}`, kind: "tref", target: `${TRIG}.a`, args: [] });
  const type = node({ id: `${TRIG_UNPOLAR}.type`, kind: "tfun", params: [0, 1].map(port), result: node({ id: `${TRIG_UNPOLAR}.t4`, kind: "tref", target: tupleType(2), args: [2, 3].map(port) }), effects: [] });
  named(node({ id: TRIG_UNPOLAR, kind: "field", type, ports: ["x", "y", "length", "angle"] }), "unpolar");
  (nodes.find((n) => n.id === TRIG_V) as NodeOf<"variant">).fields.push(TRIG_UNPOLAR);
}
// asin and acos (POLAR.md, L97c3): angles read off unpolar, (a) -[Choice]-> a:
// no answer outside −1 to 1 (L125b).
export const TRIG_ASIN = `${TRIG_V}.asin`, TRIG_ACOS = `${TRIG_V}.acos`;
for (const [id, name] of [[TRIG_ASIN, "asin"], [TRIG_ACOS, "acos"]]) {
  const type = node({ id: `${id}.type`, kind: "tfun", params: [node({ id: `${id}.t0`, kind: "tref", target: `${TRIG}.a`, args: [] })], result: node({ id: `${id}.t1`, kind: "tref", target: `${TRIG}.a`, args: [] }), effects: [CHOICE] });
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
export const PAIR_V = "std.tuple2.tuple", FIRST = "std.tuple2.tuple.first", SECOND = "std.tuple2.tuple.second";

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
const PARTIAL_OPS = new Set(["div", "sqrt", "log", "pow"]);
for (const op of Object.keys(impl) as (keyof typeof impl)[]) {
  // `/`, `sqrt`, `log` and `^` have no answer at some inputs (L125b): Choice,
  // dropped where the checker knows the input is fine (signs.ts).
  SIGS[B[op]] = (s) => fn(Array(impl[op].length).fill(num), num, s.freshRow(PARTIAL_OPS.has(op) ? [CHOICE] : []));
}

const pure = (params: Type[], ret: Type): Sig => (s) => fn(params, ret, s.freshRow());

// What a search's function does besides Choice: never the world, since it
// runs on paths the search abandons or repeats (LANGUAGE.md, "The world and
// Choice"). The checker puts the call's row around it instead of making
// them one (infer.ts, SEARCHES), so code beside the search may still act.
const searchRow = (s: Subst): Row => { const e = s.freshRow(); s.noWorld.add(e.tail!); return e; };

export const S = {
  // A list written out (L181, PORTS §4): one call with an input per item,
  // so a thousand items are one node's inputs, not a thousand nested
  // `cons` calls. Its type is written for one item; the checker gives a
  // call with n inputs n of them (infer.ts).
  listOf: builtin("list.of", "list of", (s) => { const a = s.fresh(); return fn([a], list(a), s.freshRow()); }, (...xs: unknown[]) => listOf(xs)),
  // A stop with a reason (SPEC §8.4, L51c): no handler catches it, as an
  // overflow. For a rule that a pure operation can't keep any other way, as
  // + on tensors of different shapes. Haskell's `error`. run.ts runs it.
  stop: builtin("stop", "stop with", (s) => fn([str], s.fresh(), s.freshRow())),
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
  mod: builtin("mod", "mod", (s) => fn([num, num], num, s.freshRow([CHOICE])), (a: number, b: number) => ((a % b) + b) % b),
  concat: builtin("concat", "join text", pure([str, str], str), (a: string, b: string) => a + b),
  show: builtin("show", "show", pure([num], str), (x: number) => floatText(x)),
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
  count: builtin("count", "count", (s) => { const a = s.fresh(), e = searchRow(s); return fn([fn([], a, { effs: [CHOICE], tail: e.tail })], int, e); }),
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
  // A file's bytes as they are, and bytes written as they are (L189c,
  // bytes.ts): no UTF-8 decoding or NFC, for images, sound and binary
  // formats.
  readBytes: world("io.readBytes", "read bytes", [str], { t: "con", id: "std.bytes", args: [] }, [FILES, ABORT]),
  writeBytes: world("io.writeBytes", "write bytes", [str, { t: "con", id: "std.bytes", args: [] }], unit, [FILES, ABORT]),
  // The body of a GET, as text. Aborts when it can't be had (no network,
  // a status that isn't 2xx). Fetched once per address per run.
  fetchText: world("io.fetchText", "fetch text", [str], str, [NETWORK, ABORT]),
  // A GET started, as a ticket for its body (L150), so `together` and
  // `race` can wait on fetches beside timers and each other: fetch text is
  // await(start fetch(url)). The world here fetches when it starts and the
  // ticket is ready at once, a timer of 0 ms with the text, on any clock
  // (simulated's too); fetches that overlap need a world that fetches in
  // the background (L150b).
  startFetch: world("io.startFetch", "start fetch", [str], { t: "con", id: "std.ticket", args: [str] }, [NETWORK, ABORT]),
  // A request with its method, headers and body, and its response, whatever
  // its status (L191, network.ts). Aborts only when it can't be sent. Sent
  // once per run for the same request, as fetch text is.
  sendRequest: world("io.sendRequest", "send request", [{ t: "con", id: "std.request", args: [] }], { t: "con", id: "std.response", args: [] }, [NETWORK, ABORT]),
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
// Representations (REPRESENTATIONS.md, L108): a type t stored as another
// type r, written as one definition, `representation(meaning, space,
// jobs)`. The meaning says what an r stands for; each job says which
// definition does one of t's jobs at r, and at what cost; the compiler
// picks, per program, the representation whose jobs cost least
// (represent.ts `choose`). Costs are the ladder represent.ts orders by.
export const COST = typedef("std.cost", "Cost", [], [
  ["constant", []], ["logarithmic", []], ["polylogarithmic", []], ["linear", []], ["linearithmic", []], ["quadratic", []],
]);
const jobType = (t: Type, r: Type): Type => ({ t: "con", id: JOB, args: [t, r] });
const costType: Type = { t: "con", id: COST, args: [] };
export const REPRESENTATION = typedef("std.representation", "Representation", ["t", "r"], [
  ["representation", [
    ["meaning", ([t, r]) => tfun([tref(r)], tref(t), [])],
    ["space", () => tref(COST)],
    ["jobs", ([t, r]) => tref(LIST, tref(JOB, tref(t), tref(r)))],
  ]],
]);
export const REPRESENTATION_V = "std.representation.representation";
// The world's effects (HOSTS.md, BACKLOG L55): Console, Files and Network
// are declared like Random, an operation for each builtin that acts on the
// world. Calling `print` performs Console's print, so a match on Console's
// operations handles it (a test collects what was printed, or gives `read
// file` a file of its own); what nothing handles goes to the world, as
// before. The operations are private: a program calls the builtins, whose
// types also say they may abort, and names the operations in a handler's
// cases. Their ids are the effects' old ids, so every row reads the same.
// Prior art: Unison's IO ability, answered by the runtime at the top and by
// a handler in a test; Koka's console effect. After Representation, so the
// ids above don't move.
const text = () => tref(STRING);
export const CONSOLE_TYPE = typedef(CONSOLE, "Console", [], [
  ["print", [["text", text]], () => tref(UNIT)],
  ["print error", [["text", text]], () => tref(UNIT)],
  ["read input", [], text],
  ["read line", [], () => tref(OPTIONAL, tref(STRING))],
], true);
const fixedTref = (id: Id, target: Id, ...args: Id[]) => node({ id, kind: "tref", target, args });
export const FILES_TYPE = typedef(FILES, "Files", [], [
  ["read file", [["path", text]], text],
  ["write file", [["path", text], ["text", text]], () => tref(UNIT)],
  ["add to file", [["path", text], ["text", text]], () => tref(UNIT)],
  ["file exists", [["path", text]], () => tref(BOOL)],
  ["list folder", [["path", text]], () => tref(LIST, tref(STRING))],
  // Their types are nodes with ids of their own, so numbered ids after
  // them don't move (as start fetch's, below).
  ["read bytes", [["path", () => fixedTref(`${FILES}.read bytes.path.type`, STRING)]], () => fixedTref(`${FILES}.read bytes.returns`, "std.bytes")],
  ["write bytes", [["path", () => fixedTref(`${FILES}.write bytes.path.type`, STRING)], ["bytes", () => fixedTref(`${FILES}.write bytes.bytes.type`, "std.bytes")]], () => fixedTref(`${FILES}.write bytes.returns`, UNIT)],
], true);
// start fetch's types are nodes with ids of their own, so the numbered
// ones after them (the tuples') don't move: a saved program may hold
// std's type nodes.
export const NETWORK_TYPE = typedef(NETWORK, "Network", [], [
  ["fetch text", [["url", text]], text],
  ["start fetch", [["url", () => fixedTref(`${NETWORK}.start fetch.url.type`, STRING)]],
    () => fixedTref(`${NETWORK}.start fetch.returns`, "std.ticket", fixedTref(`${NETWORK}.start fetch.returns.a`, STRING))],
  ["send request", [["request", () => fixedTref(`${NETWORK}.send request.request.type`, "std.request")]],
    () => fixedTref(`${NETWORK}.send request.returns`, "std.response")],
], true);
// Each builtin that acts on the world, by the operation it performs.
export const WORLD_OPS: Record<Id, Id> = {
  [S.print]: `${CONSOLE}.print`, [IO.printError]: `${CONSOLE}.print error`, [IO.readInput]: `${CONSOLE}.read input`, [IO.readLine]: `${CONSOLE}.read line`,
  [IO.readFile]: `${FILES}.read file`, [IO.writeFile]: `${FILES}.write file`, [IO.appendFile]: `${FILES}.add to file`, [IO.fileExists]: `${FILES}.file exists`, [IO.listFolder]: `${FILES}.list folder`, [IO.readBytes]: `${FILES}.read bytes`, [IO.writeBytes]: `${FILES}.write bytes`,
  [IO.fetchText]: `${NETWORK}.fetch text`, [IO.startFetch]: `${NETWORK}.start fetch`, [IO.sendRequest]: `${NETWORK}.send request`,
};
for (const v of Object.values(WORLD_OPS)) (nodes.find((n) => n.id === v) as NodeOf<"variant">).private = true;
// A job's two definitions have the same type but for t, which is r in the
// second: the checker says so (infer.ts), since a type can't.
const jobOf = (op: string, name: string, given: (s: Subst) => Type[]) => builtin(op, name, (s) => {
  const t = s.fresh(), r = s.fresh();
  return fn([...given(s), costType], jobType(t, r), s.freshRow());
}, (...xs: unknown[]) => ({ tag: `builtin.${op}`, fields: xs }));
function sameJob(op: string, name: string, given: (r: Type, s: Subst) => Type[]) {
  return builtin(op, name, (s) => {
    const t = s.fresh(), r = s.fresh();
    return fn(given(r, s), jobType(t, r), s.freshRow());
  }, (...xs: unknown[]) => ({ tag: `builtin.${op}`, fields: xs }));
}
export const JOBS = {
  // t's job (a constructor or a function on t) done at r by `by`.
  job: jobOf("representation.job", "job", (s) => [s.fresh(), s.fresh()]),
  // t's job done as t's own definition does it, at this cost.
  asWritten: jobOf("representation.asWritten", "as written", (s) => [s.fresh()]),
  // A match on t, done at r: by(value, one function per case of t).
  matchBy: jobOf("representation.matchBy", "match by", (s) => [s.fresh()]),
  // A fold on t, done at r, the same way.
  foldBy: jobOf("representation.foldBy", "fold by", (s) => [s.fresh()]),
  // A match or a fold on t done as t does it, at this cost.
  matchAsWritten: jobOf("representation.matchAsWritten", "match as written", () => []),
  foldAsWritten: jobOf("representation.foldAsWritten", "fold as written", () => []),
  // A fold whose cases read no rest (a sum, a count), done as t's own fold
  // of the meaning, at this cost (C75).
  foldOfItems: jobOf("representation.foldOfItems", "fold of items", () => []),
  // A representation that isn't one spelling per value (a tree, whose shape
  // depends on the order things went in) says how equal, show and compare
  // see a value of r: through its meaning.
  // How a value of t is stored as r at once, in one go rather than by
  // its constructors one at a time (C76): a list's items as a balanced
  // tree, or an array.
  storeBy: builtin("representation.storeBy", "store by", (s) => { const t = s.fresh(), r = s.fresh(); return fn([fn([t], r, s.freshRow())], jobType(t, r), s.freshRow()); }, (...xs: unknown[]) => ({ tag: "builtin.representation.storeBy", fields: xs })),
  equalBy: sameJob("representation.equalBy", "equal by", (r) => [fn([r, r], bool, { effs: [], tail: null })]),
  showBy: sameJob("representation.showBy", "show by", (r) => [fn([r], str, { effs: [], tail: null })]),
  compareBy: sameJob("representation.compareBy", "compare by", (r) => [fn([r, r], { t: "con", id: ORDER, args: [] }, { effs: [], tail: null })]),
  // For t's job that gives a list, a definition giving only its first
  // item, as a list of one or nil (the rewrite uses it where only the
  // first is read).
  headBy: sameJob("representation.headBy", "head by", (_, s) => [s.fresh(), s.fresh()]),
  // A field of t's case, by its position, that r doesn't keep as a value
  // of t (L117): `hides(cons, 1)`, since a list's rest, in an array, is
  // the items after a position, made only when read. A fold whose arms
  // never read it costs what the walk costs.
  hides: sameJob("representation.hides", "hides", (_, s) => [s.fresh(), int]),
  // r changes a value in place where t's job makes a changed copy (a hash
  // table's put, C63b): chosen only where every value of t has one holder,
  // so nobody sees the old one (one-holder.ts).
  inPlace: sameJob("representation.inPlace", "in place", () => []),
};

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
  // The item of the list at p whose part at `by` is the key (L98 keys):
  // found when the path is used, not when it is made, so it names the same
  // item after others moved. No such item: read at has no answer there and
  // an edit changes nothing, as past the end of a list.
  keyPath: builtin("cells.keyPath", "key path", (s) => { const w = s.fresh(), a = s.fresh(), k = s.fresh(); return fn([pathOf(w, list(a)), pathOf(a, k), k], pathOf(w, a), s.freshRow()); }),
  readAt: builtin("cells.readAt", "read at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, b)], b, s.freshRow([CELLS, DIVERGE, CHOICE])); }),
  writeAt: builtin("cells.writeAt", "write at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, b), b], unit, s.freshRow([UPDATE])); }),
  insertAt: builtin("cells.insertAt", "insert at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, list(b)), int, b], unit, s.freshRow([UPDATE])); }),
  removeAt: builtin("cells.removeAt", "remove at", (s) => { const a = s.fresh(), b = s.fresh(); return fn([cellOf(a), pathOf(a, list(b)), int], unit, s.freshRow([UPDATE])); }),
  // A value with the part at a place changed (L163, GAPS round 9 MG2): the
  // paths above, on any value rather than a cell's, so a record's one
  // field or a list's one item changes without writing the rest out. A
  // place that isn't there gives the value as it was. Pure. Prior art:
  // lenses' `set` (van Laarhoven; Kmett's lens), OCaml's and Elm's
  // `{ r with f = v }`.
  changed: builtin("cells.changed", "changed", (s) => { const a = s.fresh(), b = s.fresh(); return fn([a, pathOf(a, b), b], a, s.freshRow()); }),
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
  bitAnd: builtin("int.bitAnd", "int bits and", pure([int, int], int), I.bitAnd),
  bitOr: builtin("int.bitOr", "int bits or", pure([int, int], int), I.bitOr),
  bitXor: builtin("int.bitXor", "int bits xor", pure([int, int], int), I.bitXor),
  less: builtin("int.less", "less than", pure([int, int], bool), (a: I.Int, b: I.Int) => truth(I.less(a, b))),
  quotient: choice("int.quotient", "quotient", [int, int], int, I.quotient),
  remainder: choice("int.remainder", "remainder", [int, int], int, I.remainder),
  power: choice("int.power", "power", [int, int], int, I.power),
  // Both divided by their greatest common divisor, the bottom made positive:
  // a fraction's one spelling. Total: (n, 0) gives (±1, 0) and (0, 0) stays.
  lowestTerms: builtin("int.lowestTerms", "lowest terms", pure([int, int], { t: "con", id: PAIR, args: [int, int] }), (a: I.Int, b: I.Int) => {
    const [t, u] = I.lowestTerms(a, b);
    return { tag: PAIR_V, fields: [t, u] };
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
const generic = (op: string, name: string, arity: 1 | 2, kind: "arith" | "less" = "arith") =>
  builtin(`arith.${op}`, name, (s) => {
    const a = s.fresh(false, false, kind);
    return fn(arity === 1 ? [a] : [a, a], kind === "less" ? bool : a, s.freshRow());
  }, unresolved(name));
export const ARITH = {
  add: generic("add", "add", 2),
  sub: generic("sub", "subtract", 2),
  mul: generic("mul", "multiply", 2),
  neg: generic("neg", "negate", 1),
  less: generic("less", "less than", 2, "less"),
};
// Which interface's field each generic operation is (INTERFACES.md step 4).
export const ARITH_FIELD: Record<Id, { iface: Id; field: Id }> = {
  [ARITH.add]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.add` },
  [ARITH.sub]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.subtract` },
  [ARITH.mul]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.multiply` },
  [ARITH.neg]: { iface: ARITHMETIC, field: `${ARITHMETIC_V}.negate` },
  [ARITH.less]: { iface: ORDERED, field: `${ORDERED_V}.less` },
};

// A Float64 as show writes it (BACKLOG L154, Ersagun 2026-11-02): to 9
// decimals, so a sum's last-bit noise doesn't show (0.1 + 0.2 is 0.3);
// but a nonzero number smaller than 10⁻⁶ in size, which 9 decimals would
// turn into 0 or one digit, gets the shortest text that reads back to it
// exactly (JavaScript's own, 1e-12), as Steele and White's and Ryū's
// shortest round trip.
export const floatText = (x: number): string =>
  Number.isInteger(x) ? String(x) : x !== 0 && Math.abs(x) < 1e-6 ? String(x) : String(Math.round(x * 1e9) / 1e9);

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
  readNumber: choice("text.readNumber", "read number", [str], num, T.readNumber),
  // NFC (L214a): text from the world already is; text built from pieces
  // may not be ("e" ++ "\u0301").
  normalized: builtin("text.normalized", "normalized", pure([str], str), (t: string) => t.normalize("NFC")),
  // What a reader sees as characters (L214c, TEXT-2026-11-03.md §3):
  // `characters` and `length` stay code points, which slicing counts.
  graphemes: builtin("text.graphemes", "graphemes", pure([str], list(str)), (t: string) => listOf(T.graphemes(t))),
  graphemeCount: builtin("text.graphemeCount", "grapheme count", pure([str], int), T.graphemeCount),
  // Case in a language (L214b, TEXT-2026-11-03.md §2): the same text in
  // the same Locale gives the same answer, so they are pure.
  uppercase: builtin("text.uppercase", "uppercase", pure([str, { t: "con", id: "std.locale", args: [] }], str), (t: string, l: { fields: unknown[] }) => T.uppercase(t, l.fields[0] as string)),
  // People's order for text in a language (L214d, §4): the Unicode
  // Collation Algorithm with CLDR's rules for it. compare and < don't
  // change.
  collate: builtin("text.collate", "collate", pure([str, str, { t: "con", id: "std.locale", args: [] }], { t: "con", id: "std.order", args: [] }), (a: string, b: string, l: { fields: unknown[] }) => ({ tag: [ORDER_V.before, ORDER_V.same, ORDER_V.after][T.collate(a, b, l.fields[0] as string) + 1], fields: [] })),
  lowercase: builtin("text.lowercase", "lowercase", pure([str, { t: "con", id: "std.locale", args: [] }], str), (t: string, l: { fields: unknown[] }) => T.lowercase(t, l.fields[0] as string)),
};

// Arrays (BACKLOG C30d, REPRESENTATIONS.md step 5): a list's items side by
// side, so an item is read by its position in constant time. An array is
// a view, a start and a length, on a buffer with free room at both ends,
// so adding an item at either end, and taking the array after the first
// item, are amortised constant, and a view's items are never copied to
// make another view. Adding writes into the free slot just past the
// view's end (or just before its start) when no other view has taken it,
// as the buffer keeps its lowest and highest used slots, and copies the
// view's items into a new buffer otherwise, so every array still never
// changes. The evaluator and compiled JS (compiler/src/runtime.js) share
// these. Ersagun's design, a two-ended array list from one of his Unity C#
// projects; prior art: deques as ring buffers, gap buffers, Go's slices,
// which share their backing array the same way at one end, and arrays as
// a list's representation, as Clojure's vectors and Haskell's Data.Vector
// stand for sequences. `items of array` is the meaning (Array a → List a).
//
// `fields` is the { tag, fields: [n, item₀, …] } value equal, compare and
// show walk, the count first so they tell [1] from [1, 2] and order
// shorter arrays first; it is made once, when first read.
//
// An item replaced (C93c) is written into the buffer too, so a replace is
// constant: the views on the buffer as it was point at a version that
// records the change instead, the slot and what it held, and reading one
// of those first undoes the changes back to it, as a Map's hash table
// does (Table below: Baker's shallow binding, "Shallow binding makes
// functional arrays fast", 1991). A list kept by one holder only reads
// its newest version, so each replace stays constant.
export const ARRAY_TAG = "std.array";
type Buffer = { items: unknown[]; lo: number; hi: number };
// The newest version holds the buffer; an older one, the change from the
// version after it: `slot` held `old`.
type Version = { cur: Buffer | null; next: Version | null; slot: number; old: unknown };
const versionOf = (b: Buffer): Version => ({ cur: b, next: null, slot: 0, old: undefined });
function rerootArray(t: Version) {
  if (t.cur) return;
  const path: Version[] = [];
  let x = t;
  while (!x.cur) { path.push(x); x = x.next!; }
  for (let i = path.length - 1; i >= 0; i--) {
    const y = path[i], b = x.cur!, was = b.items[y.slot];
    b.items[y.slot] = y.old;
    y.cur = b; y.next = null;
    x.cur = null; x.next = y; x.slot = y.slot; x.old = was;
    x = y;
  }
}
export class ArrayView {
  readonly tag = ARRAY_TAG;
  readonly ver: Version;
  readonly start: number;
  readonly n: number;
  private f: unknown[] | null = null;
  // Its rest, when that was copied out of a much bigger buffer (I106c).
  rest: ArrayView | null = null;
  constructor(ver: Version, start: number, n: number) { this.ver = ver; this.start = start; this.n = n; }
  // The buffer as this view's version has it.
  get buf(): Buffer { rerootArray(this.ver); return this.ver.cur!; }
  get fields(): unknown[] { return (this.f ??= [this.n, ...this.buf.items.slice(this.start, this.start + this.n)]); }
  toJSON() { return { tag: this.tag, fields: this.fields }; }
}
type ArrayValue = ArrayView | { tag: Id; fields: unknown[] };
// A buffer holding xs[from, to) in its middle, with room for as many
// again on each side.
export const arrayOf = (xs: unknown[], from = 0, to = xs.length): ArrayView => {
  const n = to - from, room = Math.max(4, n), items = new Array(n + 2 * room).fill(undefined);
  for (let i = 0; i < n; i++) items[room + i] = xs[from + i];
  return new ArrayView(versionOf({ items, lo: room, hi: room + n }), room, n);
};
// Either kind of array value: a view, or { tag, fields } made elsewhere
// (a value read back from JSON).
export const arrayView = (a: ArrayValue): ArrayView => (a instanceof ArrayView ? a : arrayOf(a.fields, 1));
const pushBack = (a: ArrayValue, x: unknown): ArrayView => {
  const v = arrayView(a), b = v.buf, end = v.start + v.n;
  if (end === b.hi && end < b.items.length) { b.items[end] = x; b.hi++; return new ArrayView(v.ver, v.start, v.n + 1); }
  const w = arrayOf(b.items, v.start, end);
  w.buf.items[w.start + w.n] = x; w.buf.hi++;
  return new ArrayView(w.ver, w.start, w.n + 1);
};
const pushFront = (a: ArrayValue, x: unknown): ArrayView => {
  const v = arrayView(a), b = v.buf;
  if (v.start === b.lo && v.start > 0) { b.items[v.start - 1] = x; b.lo--; return new ArrayView(v.ver, v.start - 1, v.n + 1); }
  const w = arrayOf(b.items, v.start, v.start + v.n);
  w.buf.items[w.start - 1] = x; w.buf.lo--;
  return new ArrayView(w.ver, w.start - 1, w.n + 1);
};
// A rest is a view on the same buffer, so a list taken apart item by item
// would keep its whole first buffer however little is left (Go's slices
// leak so, I106c). Where what's left is under a quarter of a big buffer,
// the rest is copied into one of its own instead: n items copied once
// after at least 3n rests, so still constant per rest, and kept on the
// view, so matching the same view again copies nothing.
const restOf = (a: ArrayValue): ArrayView => {
  const v = arrayView(a);
  if (v.n === 0) return v;
  if (v.rest) return v.rest;
  const size = v.ver.cur ? v.ver.cur.items.length : v.buf.items.length;
  if (size > 256 && (v.n - 1) * 4 < size) return (v.rest = arrayOf(v.buf.items, v.start + 1, v.start + v.n));
  return new ArrayView(v.ver, v.start + 1, v.n - 1);
};
// The item at position i replaced by x (C93c), or the array as it is
// outside it, as `replace at` on a list: written into the buffer, and the
// version given becomes the change back.
const replaceIn = (a: ArrayValue, i: I.Int, x: unknown): ArrayView => {
  const v = arrayView(a), k = Number(i);
  if (!(Number.isInteger(k) && k >= 0 && k < v.n)) return v;
  const b = v.buf, slot = v.start + k, t = v.ver;
  const newest: Version = { cur: b, next: null, slot: 0, old: undefined };
  t.cur = null; t.next = newest; t.slot = slot; t.old = b.items[slot];
  b.items[slot] = x;
  return new ArrayView(newest, v.start, v.n);
};
const itemsIn = (a: ArrayValue): unknown[] => { const v = arrayView(a); return v.buf.items.slice(v.start, v.start + v.n); };
const arrayOf_ = (a: Type): Type => ({ t: "con", id: ARRAY, args: [a] });
const ofItem = (make: (a: Type, s: Subst) => [Type[], Type], effects: Id[] = []): Sig => (s) => { const a = s.fresh(); const [ps, r] = make(a, s); return fn(ps, r, s.freshRow(effects)); };
const arrayItem = builtin("array.at", "item at", ofItem((a) => [[arrayOf_(a), int], a], [CHOICE]));
STD_MANY[arrayItem] = (arr: ArrayValue, i: I.Int) => { const v = arrayView(arr), k = Number(i); return Number.isInteger(k) && k >= 0 && k < v.n ? [v.buf.items[v.start + k]] : []; };
// The two ends (C30d): the first item (none of an empty array), the array
// after it (empty of an empty array) and an item added at the front.
const arrayFirst = builtin("array.first", "first of array", ofItem((a) => [[arrayOf_(a)], a], [CHOICE]));
STD_MANY[arrayFirst] = (arr: ArrayValue) => { const v = arrayView(arr); return v.n > 0 ? [v.buf.items[v.start]] : []; };
export const ARRAY_OPS = {
  empty: builtin("array.empty", "empty array", ofItem((a) => [[], arrayOf_(a)]), () => arrayOf([])),
  of: builtin("array.of", "array of", ofItem((a) => [[list(a)], arrayOf_(a)]), (l: { tag: Id; fields: unknown[] }) => arrayOf(itemsOf(l))),
  items: builtin("array.items", "items of array", ofItem((a) => [[arrayOf_(a)], list(a)]), (arr: ArrayValue) => listOf(itemsIn(arr))),
  length: builtin("array.length", "array length", ofItem((a) => [[arrayOf_(a)], int]), (arr: ArrayValue) => arrayView(arr).n),
  at: arrayItem,
  push: builtin("array.push", "push", ofItem((a) => [[arrayOf_(a), a], arrayOf_(a)]), pushBack),
  first: arrayFirst,
  rest: builtin("array.rest", "rest of array", ofItem((a) => [[arrayOf_(a)], arrayOf_(a)]), restOf),
  pushFront: builtin("array.pushFront", "push front", ofItem((a) => [[arrayOf_(a), a], arrayOf_(a)]), pushFront),
  replaceAt: builtin("array.replaceAt", "replace in array", ofItem((a) => [[arrayOf_(a), int, a], arrayOf_(a)]), replaceIn),
  // The first item as an Option, without Choice: `array of List`'s match
  // (array-list.ts, C30d3b) reads it this way, so the evaluator runs a
  // match on an array without a search around it.
  firstIfAny: builtin("array.firstIfAny", "first of array if any", ofItem((a) => [[arrayOf_(a)], optional(a)]), (arr: ArrayValue) => {
    const v = arrayView(arr);
    return v.n > 0 ? { tag: SOME, fields: [v.buf.items[v.start]] } : { tag: NONE, fields: [] };
  }),
};

// A hash table changed in place (C63b, IN-PLACE.md step 2): Map's
// representation, its keys Ints and Texts, the ones a JS Map holds by value
// (an Int has one spelling, int.ts), and tuples of them, held by their
// spelling (C63f). Its entries are in compare's order, so
// its meaning is the Map it stands for.
//
// Every version stays a value (C71): a put writes into the one JS Map and
// gives a new newest version, and the version it was given becomes the
// change that undoes it, pointing at the newest. Reading an older version
// first undoes the changes between, turning the chain round so that one is
// the newest (`reroot`). A map with one holder only ever reads its newest
// version, so each put is constant; a map read again after a change is
// still right, and pays for the changes it walks back over. Prior art:
// Baker's shallow binding for functional arrays ("Shallow binding makes
// functional arrays fast", 1991), as Conchon and Filliâtre's persistent
// arrays ("A persistent union-find data structure", 2007).
// `empty map` is a constant, one value every use shares: the empty table
// it stands for is `shared`, and a put or remove on it makes a new one, so
// maps started from it don't share one chain.
// No `tag`: it isn't a case of a data type, and nothing takes it apart.
export class Table {
  // The newest version holds the JS Map; an older one, the change from the
  // version after it: `key` was absent (had false) or `old`.
  cur: Map<unknown, unknown> | null;
  next: Table | null = null;
  key: unknown = undefined;
  had = false;
  old: unknown = undefined;
  readonly shared: boolean;
  // Its entries (a set's items) in compare's order, once listed: a
  // version's entries never change, so a map read many times (an index's
  // postings) is sorted once (C72).
  listed: unknown = undefined;
  constructor(m: Map<unknown, unknown>, shared = false) { this.cur = m; this.shared = shared; }
  get m(): Map<unknown, unknown> { reroot(this); return this.cur!; }
}
// Make t the newest version: undo, from the newest back, each change
// between it and t, each undone one becoming the change that redoes it.
function reroot(t: Table) {
  if (t.cur) return;
  const path: Table[] = [];
  let x = t;
  while (!x.cur) { path.push(x); x = x.next!; }
  for (let i = path.length - 1; i >= 0; i--) {
    const y = path[i], m = x.cur!;
    const had = m.has(y.key), old = m.get(y.key);
    if (y.had) m.set(y.key, y.old); else m.delete(y.key);
    y.cur = m; y.next = null;
    x.cur = null; x.next = y; x.key = y.key; x.had = had; x.old = old;
    x = y;
  }
}
// A put (set) or remove: a new newest version, t the change back to it.
function change(t: Table, key: unknown, set: boolean, v?: unknown): Table {
  if (t.shared) { const m = new Map(t.m); if (set) m.set(key, v); else m.delete(key); return new Table(m); }
  const m = t.m, had = m.has(key), old = m.get(key);
  if (!set && !had) return t;
  if (set) m.set(key, v); else m.delete(key);
  const n = new Table(m);
  t.cur = null; t.next = n; t.key = key; t.had = had; t.old = old;
  return n;
}
const tableOf_ = (k: Type, v: Type): Type => ({ t: "con", id: TABLE, args: [k, v] });
const ofEntry = (make: (k: Type, v: Type) => [Type[], Type], effects: Id[] = []): Sig => (s) => { const k = s.fresh(), v = s.fresh(); const [ps, r] = make(k, v); return fn(ps, r, s.freshRow(effects)); };
// compare's order on Ints, Texts and tuples of them (run.ts
// compareValues): a tuple part by part.
const keyOrder = (a: unknown, b: unknown): number => {
  if (typeof a === "string") return a === b ? 0 : T.less(a, b as string) ? -1 : 1;
  if (typeof a === "object" && a !== null) {
    const x = (a as { fields: unknown[] }).fields, y = (b as { fields: unknown[] }).fields;
    for (let i = 0; i < x.length; i++) { const c = keyOrder(x[i], y[i]); if (c) return c; }
    return 0;
  }
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
};
// A tuple key (C63f) is held by its spelling, one per value: an Int's
// digits (an Int has one spelling, int.ts), a Text quoted, a tuple's parts
// in brackets. The table's keys are all of one type, so a spelling never
// meets a Text it could be mistaken for. Such an entry keeps the key itself
// beside its value (`Keyed`), for the entries; an Int or Text key is held
// as it is.
class Keyed { key: unknown; value: unknown; constructor(key: unknown, value: unknown) { this.key = key; this.value = value; } }
const spelling = (x: unknown): string => (typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? `(${(x as { fields: unknown[] }).fields.map(spelling).join(",")})` : String(x));
const held = (key: unknown) => (typeof key === "object" && key !== null ? spelling(key) : key);
const valueOf = (v: unknown) => (v instanceof Keyed ? v.value : v);
const keyOf = (k: unknown, v: unknown) => (v instanceof Keyed ? v.key : k);
const tableAt = builtin("table.at", "table value at", ofEntry((k, v) => [[tableOf_(k, v), k], v], [CHOICE]));
STD_MANY[tableAt] = (t: Table, key: unknown) => { const h = held(key); return t.m.has(h) ? [valueOf(t.m.get(h))] : []; };
export const TABLE_OPS = {
  empty: builtin("table.empty", "empty table", ofEntry((k, v) => [[], tableOf_(k, v)]), () => new Table(new Map(), true)),
  put: builtin("table.put", "table put", ofEntry((k, v) => [[tableOf_(k, v), k, v], tableOf_(k, v)]), (t: Table, key: unknown, v: unknown) => {
    const h = held(key);
    return change(t, h, true, h === key ? v : new Keyed(key, v));
  }),
  remove: builtin("table.remove", "table remove", ofEntry((k, v) => [[tableOf_(k, v), k], tableOf_(k, v)]), (t: Table, key: unknown) => change(t, held(key), false)),
  has: builtin("table.has", "table has", ofEntry((k, v) => [[tableOf_(k, v), k], bool]), (t: Table, key: unknown) => ({ tag: t.m.has(held(key)) ? TRUE : FALSE, fields: [] })),
  size: builtin("table.size", "table size", ofEntry((k, v) => [[tableOf_(k, v)], int]), (t: Table) => t.m.size),
  at: tableAt,
  // The entries in compare's order: the Map it stands for.
  entries: builtin("table.entries", "table entries", ofEntry((k, v) => [[tableOf_(k, v)], list({ t: "con", id: PAIR, args: [k, v] })]),
    (t: Table) => (t.listed ??= listOf([...t.m].map(([k, v]) => [keyOf(k, v), valueOf(v)]).sort(([a], [b]) => keyOrder(a, b)).map(([a, b]) => ({ tag: PAIR_V, fields: [a, b] }))))),
};

// Set as a hash table changed in place (C63d): the same Table, its keys
// the items, each holding `true`. As for Map's, only where every set has
// one holder, items are Ints, Texts and tuples of them (C63f), and they
// come out in compare's order.
const setOf_ = (a: Type): Type => ({ t: "con", id: HASH_SET, args: [a] });
const ofSetItem = (make: (a: Type) => [Type[], Type]): Sig => (s) => { const a = s.fresh(); const [ps, r] = make(a); return fn(ps, r, s.freshRow([])); };
export const HASH_SET_OPS = {
  empty: builtin("hashset.empty", "empty hash set", ofSetItem((a) => [[], setOf_(a)]), () => new Table(new Map(), true)),
  add: builtin("hashset.add", "hash set add", ofSetItem((a) => [[setOf_(a), a], setOf_(a)]), (t: Table, x: unknown) => { const h = held(x); return change(t, h, true, h === x ? true : new Keyed(x, true)); }),
  remove: builtin("hashset.remove", "hash set remove", ofSetItem((a) => [[setOf_(a), a], setOf_(a)]), (t: Table, x: unknown) => change(t, held(x), false)),
  has: builtin("hashset.has", "hash set has", ofSetItem((a) => [[setOf_(a), a], bool]), (t: Table, x: unknown) => ({ tag: t.m.has(held(x)) ? TRUE : FALSE, fields: [] })),
  size: builtin("hashset.size", "hash set size", ofSetItem((a) => [[setOf_(a)], int]), (t: Table) => t.m.size),
  items: builtin("hashset.items", "hash set items", ofSetItem((a) => [[setOf_(a)], list(a)]), (t: Table) => (t.listed ??= listOf([...t.m].map(([k, v]) => keyOf(k, v)).sort(keyOrder)))),
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
// The name of the case a plain value was made by, as text (L162, GAPS
// round 9 MG1): case name(add(r1, r2, r3)) is "add", case name([]) is
// "nil", and a number or a text, made by no case, gives "". The name is the
// program's, like show's (run.ts caseName). Data.Data's showConstr.
export const CASE_NAME = builtin("caseName", "case name", (s) => fn([s.fresh(true)], str, s.freshRow()));
// The order on plain data (L66, run.ts compareValues): numbers by value,
// text by code point, cases in the order their type declares them, then
// fields left to right. Plain data only, like `equal`.
export const COMPARE = builtin("compare", "compare", (s) => { const a = s.fresh(true); return fn([a, a], { t: "con", id: "std.order", args: [] }, s.freshRow()); });

// A data type's fields picked by their type (L162b, fields-by-type.ts):
// fields mapped(value, f) gives every field of value's case declared with
// f's input type to f; fields listed(value) is those fields as a list. Both
// are written out per type as a match before anything runs, so they have no
// implementation of their own (run.ts says so if one is reached).
const open = (name: string) => () => { throw new Error(`${name} needs the value's data type and the fields' type known where it is used: give the definition that calls it those types`); };
export const FIELDS = {
  mapped: builtin("fields.mapped", "fields mapped", (s) => { const a = s.fresh(true), b = s.fresh(), e = s.freshRow(); return fn([a, fn([b], b, e)], a, e); }, open("fields mapped")),
  listed: builtin("fields.listed", "fields listed", (s) => { const a = s.fresh(true), b = s.fresh(); return fn([a], list(b), s.freshRow()); }, open("fields listed")),
};

// Records: set(field, record, value) is the record with that field changed.
// `field` is a field, or a path of fields (p ↦ p.address.city), which the
// checker insists on; the update is that path run backwards, with every
// other field kept (src/lang/records.ts).
export const SET = builtin("set", "set", (s) => {
  const r = s.fresh(), a = s.fresh();
  return fn([fn([r], a, s.freshRow()), r, a], r, s.freshRow());
});

// A Clifford algebra built once (BACKLOG I79): its signature (the squares
// of its basis vectors), its basis, each blade beside its basis element,
// and its multiplication table, so the prelude's clifford functions don't
// build one on every call. (clifford outer and inner still build theirs:
// three tables made eagerly cost relate's checks more than they saved.)
// `clifford algebra(squares, basis)` makes one.
export const ALGEBRA = typedef("std.algebra", "Algebra", ["a"], [
  ["algebra", [
    ["squares", () => tref(LIST, tref(NUMBER))],
    ["basis", ([a]) => tref(LIST, tref(a))],
    ["blades", ([a]) => tref(LIST, tref(PAIR, tref(LIST, tref(BOOL)), tref(a)))],
    ["table", ([a]) => tref(LIST, tref(TABLE_ENTRY, tref(a)))],
  ]],
]);
export const ALGEBRA_V = "std.algebra.algebra";
// A number type with its two infinities (FLOAT-VALUES-2026-11-01.md §3,
// BACKLOG L125d): ordinary data, for any ordered number type. Float64 has
// no ∞ of its own; a bound with no end, the least of no numbers, or "not
// reached yet" is an Extended. Declared low to high, so `compare` and
// `sort` order them as numbers. After Algebra, so ids above don't move.
export const EXTENDED = typedef("std.extended", "Extended", ["a"], [
  ["minus infinity", []],
  ["finite", [["value", ([a]) => tref(a)]]],
  ["plus infinity", []],
]);
export const EXTENDED_V = { minus: "std.extended.minus infinity", finite: "std.extended.finite", plus: "std.extended.plus infinity" } as const;
// Waiting for several things at once (BACKLOG L71b, ANSWERED-LATER.md
// "Typing await and together"). A Ticket a is something that will give an
// a: the world's (L71c answers those), a `timer` of some milliseconds with
// a value (a timer), or the first ready of some tickets, given as its
// position through `which` (so `any of(tickets)` is a Ticket Int without
// a type that depends on its case). `await` is one operation for every
// type: its a is its own (L71a), and it is answered later, so `together`
// can park a branch's rest. A Branch is what `together` keeps of one
// action: its value, or the ticket it waits for and how to go on. After
// Extended, so ids above don't move.
export const TICKET = typedef("std.ticket", "Ticket", ["a"], [
  ["ticket", [["number", () => tref(INT)]]],
  ["timer", [["milliseconds", () => tref(NUMBER)], ["value", ([a]) => tref(a)]]],
  ["first ready", [["tickets", (_, self) => tref(LIST, tref(self, tref(UNIT)))], ["which", ([a]) => tfun([tref(INT)], tref(a), [])]]],
  // Ready at this moment on the clock of whoever answers it, with this
  // value: what a handler that keeps its own clock (`simulated`, L63)
  // gives for a timer it starts.
  ["at", [["time", () => tref(NUMBER)], ["value", ([a]) => tref(a)]]],
]);
export const TICKET_V = { ticket: "std.ticket.ticket", timer: "std.ticket.timer", firstReady: "std.ticket.first ready", at: "std.ticket.at" } as const;
export const AWAIT = typedef("std.await", "Await", [], [
  ["await", [["ticket", ([a]) => tref(TICKET, tref(a))]], ([a]) => tref(a), { later: true, own: ["a"] }],
  // A timer the world keeps (L71c): ready this many milliseconds after it
  // was started, whoever awaits it and however often. Answered later, so a
  // handler that keeps the clock (`simulated`, L63) can pass it along; the
  // world, and most cases, answer at once.
  ["start timer", [["milliseconds", () => tref(NUMBER)]], () => tref(TICKET, tref(UNIT)), { later: true }],
], true);
export const AWAIT_OP = "std.await.await", START_TIMER_OP = "std.await.start timer";
// Its `e` is a row (L149): what the action does besides waiting, which
// resuming it does too, so a branch may print, abort, fetch or draw.
// The row's own tref has an id of its own, so the numbered ones after it
// (the tuples') don't move: a saved program may hold std's type nodes.
const BRANCH_ID = "std.branch";
export const BRANCH = typedef(BRANCH_ID, "Branch", ["r", "e"], [
  ["done", [["value", ([r]) => tref(r)]]],
  ["parked", [["ticket", () => tref(TICKET, tref(UNIT))], ["resume", ([r, e], self) => tfun([], tref(self, tref(r), node({ id: `${BRANCH_ID}.e.arg`, kind: "tref", target: e, args: [] })), [AWAIT, e])]]],
]);
export const BRANCH_V = { done: "std.branch.done", parked: "std.branch.parked" } as const;
// Tuples (PORTS-2026-11-01.md §1, L128): the inputs of a function, or its
// results, as one value. Structural, as every data type here is: two
// tuples of the same types are one type wherever they come from. A tuple
// of one is its value and of none is Unit, so only 2 to 8 parts are types
// of their own. Shown as (A, B); the parts' names come from the ports of
// the function they go in or come out of. After every other type, so ids
// above don't move. Prior art: Standard ML's tuples (every function takes
// one value, which may be a tuple).
const PART_NAMES = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
export const TUPLE_MAX = 8;
export const TUPLES: Id[] = [];
for (let n = 2; n <= TUPLE_MAX; n++) {
  TUPLES.push(typedef(`std.tuple${n}`, `Tuple${n}`, PART_NAMES.slice(0, n).map((_, i) => "abcdefgh"[i]), [
    ["tuple", PART_NAMES.slice(0, n).map((f, i) => [f, (ps: Id[]) => tref(ps[i])] as [string, TypeOf])],
  ]));
}
// The one ÷ (BACKLOG L155, NUMBERS.md "and later ÷"): an interface, as
// Trig is, whose `divide` is resolved to the type's own before anything
// runs (arith.ts). Every number type but Int implements it in the prelude;
// dividing by zero has no answer, so it has Choice. Int has no ÷: its
// quotient and remainder are another operation. After the tuples, so ids
// above don't move.
export const DIVISION = typedef("std.division", "Division", ["a"], [
  ["division", [["divide", ([a]) => tfun([tref(a), tref(a)], tref(a), [CHOICE])]]],
], false, true);
export const DIVISION_V = "std.division.division";
export const DIVIDE = `${DIVISION_V}.divide`;
// A queue and a priority queue (BACKLOG L177, GAPS round 10 KL4: clinic
// wrote a leftist heap and a two-list queue). A Queue is two lists, the
// front in order and the back reversed, with its size kept, so adding,
// taking and counting don't walk it (Okasaki, "Purely Functional Data
// Structures", 1998, §5.2): the front is empty only when the queue is. A
// Priority queue is a Map from (priority, the order it came in) to the
// item, so two items may have one priority and leave in the order they
// came, and whatever stores a Map stores it (trees, DATA-STRUCTURES.md).
// After the division, so ids above don't move.
export const QUEUE = typedef("std.queue", "Queue", ["a"], [
  ["queue", [["front", ([a]) => tref(LIST, tref(a))], ["back", ([a]) => tref(LIST, tref(a))], ["size", () => tref(INT)]]],
]);
export const QUEUE_V = "std.queue.queue";
export const PRIORITY_QUEUE = typedef("std.priority queue", "Priority queue", ["p", "a"], [
  ["priority queue", [["entries", ([p, a]) => tref(MAP, tref("std.tuple2", tref(p), tref(INT)), tref(a))], ["next", () => tref(INT)]]],
]);
export const PRIORITY_QUEUE_V = "std.priority queue.priority queue";
// A matrix of any size (BACKLOG L44, MATRICES.md step 3): its row and
// column counts and its items row by row, one flat list, as BLAS, LAPACK
// and NumPy store a dense matrix (row-major, NumPy's default). The size
// isn't in the type (that needs numbers in types), so a mismatch is
// found when the program runs and the message names both sizes. How the
// items are stored is the compiler's choice, as a List's is (Array,
// DATA-STRUCTURES.md). After the priority queue, so ids above don't move.
export const MATRIX = typedef("std.matrix", "Matrix", ["a"], [
  ["matrix", [["rows", () => tref(INT)], ["columns", () => tref(INT)], ["items", ([a]) => tref(LIST, tref(a))]]],
]);
export const MATRIX_V = "std.matrix.matrix";
// State (BACKLOG L16's first half): a value a computation reads and
// replaces as it goes, `get state()` and `put state(value)`, answered by a
// handler written in the language (the prelude's `with state`), which
// passes the value along from each operation to the rest: the classic
// state handler of effect handlers (Plotkin and Pretnar, "Handlers of
// algebraic effects", 2009; Koka's and Eff's examples). Not Cells: no
// reader is woken, a write is only the next value. After the matrix, so
// ids above don't move.
export const STATE = typedef("std.state", "State", ["s"], [
  ["get state", [], ([s]) => tref(s), { later: true }],
  ["put state", [["value", ([s]) => tref(s)]], () => tref(UNIT), { later: true }],
], true);
export const STATE_OPS = { get: "std.state.get state", put: "std.state.put state" } as const;
// A pipeline (BACKLOG L64): a producer that sends items and a consumer
// that receives them, run side by side by the prelude's `piped`, the
// producer going on only when the consumer asks (a pipe handler, as in
// Kammar, Lindley and Oury, "Handlers in action", 2013, and Unix pipes
// before it). The channel is scoped to the one `piped` call: nothing else
// can send on it or receive from it. A Pipe is the producer stopped at an
// item, with how to go on (its own effects in `e`, as a Branch's), or
// finished. After the state, so ids above don't move.
export const SEND = typedef("std.send", "Send", ["a"], [
  ["send", [["item", ([a]) => tref(a)]], () => tref(UNIT), { later: true }],
], true);
export const RECEIVE = typedef("std.receive", "Receive", ["a"], [
  ["receive", [], ([a]) => tref(OPTIONAL, tref(a)), { later: true }],
], true);
const PIPE_ID = "std.pipe";
export const PIPE = typedef(PIPE_ID, "Pipe", ["a", "e"], [
  ["finished", []],
  ["sent", [["item", ([a]) => tref(a)], ["more", ([a, e], self) => tfun([], tref(self, tref(a), node({ id: `${PIPE_ID}.e.arg`, kind: "tref", target: e, args: [] })), [e])]]],
]);
export const PIPE_OPS = { send: "std.send.send", receive: "std.receive.receive", finished: "std.pipe.finished", sent: "std.pipe.sent" } as const;
// How a value of a type shows as text, as an interface (BACKLOG L205,
// MATHEMATICS-AS-LIBRARIES-2026-11-03.md): `show any` shows a value of a
// type with an implementation through it, so a type of your own shows its
// own way, `shown at quaternion = shown(show quaternion)`. The prelude's
// number types are implementations, not names run.ts knows. After the
// pipe, so ids above don't move.
export const SHOWN = typedef("std.shown", "Shown", ["a"], [
  ["shown", [["as shown", ([a]) => tfun([tref(a)], tref(STRING), [])]]],
], false, true);
// A list written in the program, as one `list of` call (L181) or nested
// conses ending in nil: its items, or null when it is anything else.
export function writtenItems(nodes: Code["nodes"], id: Id): Id[] | null {
  const ref = (x: Id) => { const n = nodes[x]; return n?.kind === "ref" ? n.target : null; };
  const top = nodes[id];
  if (isCall(top) && ref(top.fn) === S.listOf) return [...top.args];
  const out: Id[] = [];
  for (let at = id; ; ) {
    if (ref(at) === NIL) return out;
    const n = nodes[at];
    if (!isCall(n) || ref(n.fn) !== CONS || n.args.length !== 2) return null;
    out.push(n.args[0]);
    at = n.args[1];
  }
}
export const SHOWN_V = "std.shown.shown";
// Each type with a Shown implementation, and the definition implementing
// it: what `show any` shows a value of that type through, in the
// evaluator (run.ts) and in compiled code (C148).
export function shownImplementations(info: { implementations?: Map<string, Id> }): Map<Id, Id> {
  const showns = new Map<Id, Id>();
  for (const [key, d] of info.implementations ?? []) {
    const m = key.startsWith(`${SHOWN}|`) ? /"t":"con","id":"([^"]+)"/.exec(key.slice(SHOWN.length + 1)) : null;
    if (m) showns.set(m[1], d);
  }
  return showns;
}
// Wrapping integers (BACKLOG L193, ASPECTS-2026-11-03 142, 143): Word8, Word16,
// Word32 and Word64 are arithmetic mod 2ⁿ, an Int from 0 to 2ⁿ − 1 kept
// in `bits`, for hashes, generators, binary formats and samples, which an
// Int that never overflows can't say. + − · wrap, < is unsigned; the
// constructor is private (a word of 300 at Word8 would break the rule), so
// `as word8(n)` makes one from any Int, keeping its low bits. The
// representation picks the machine word (Compiler lane). Bits is the
// interface for and, or, xor and shifts, so a hash is written once for
// every width. After Shown, so ids above don't move.
export const WORD_SIZES = [8, 16, 32, 64] as const;
const word = (n: number) => typedef(`std.word${n}`, `Word${n}`, [], [[`word${n}`, [["bits", () => tref(INT)]]]], false, false, `${n}-bit words`);
export const WORD8 = word(8), WORD32 = word(32), WORD64 = word(64);
export const WORD_V = { 8: "std.word8.word8", 16: "std.word16.word16", 32: "std.word32.word32", 64: "std.word64.word64" } as const;
const privateWord = (n: 8 | 16 | 32 | 64) => { SMART[WORD_V[n]] = `as word${n}`; (nodes.find((x) => x.id === WORD_V[n]) as NodeOf<"variant">).private = true; };
for (const n of [8, 32, 64] as const) privateWord(n);
export const BITS = typedef("std.bits", "Bits", ["a"], [
  ["bits", [
    ["bits and", ([a]) => tfun([tref(a), tref(a)], tref(a), [])],
    ["bits or", ([a]) => tfun([tref(a), tref(a)], tref(a), [])],
    ["bits xor", ([a]) => tfun([tref(a), tref(a)], tref(a), [])],
    ["shifted up", ([a]) => tfun([tref(a), tref(INT)], tref(a), [])],
    ["shifted down", ([a]) => tfun([tref(a), tref(INT)], tref(a), [])],
  ]],
], false, true);
export const BITS_V = "std.bits.bits";
// Word16 (Ersagun 2026-11-03: "No Word16?"), for 16-bit audio samples and
// binary formats. After Bits, so ids above don't move.
export const WORD16 = word(16);
privateWord(16);
// A tensor (BACKLOG L51, TENSORS-2026-11-03.md): a shape, the axis
// lengths, and the items with the last axis changing fastest (row-major,
// NumPy's and C's order). It means a function from an index to an item;
// the items are how it is written down, stored as an array where `array
// of List` pays. Made by the prelude's `tensor of`, which checks the item
// count against the shape. After Word16, so ids above don't move.
export const TENSOR = typedef("std.tensor", "Tensor", ["a"], [
  ["tensor", [["shape", () => tref(LIST, tref(INT))], ["items", ([a]) => tref(LIST, tref(a))]]],
]);
export const TENSOR_V = "std.tensor.tensor";
SMART[TENSOR_V] = "tensor of";
(nodes.find((x) => x.id === TENSOR_V) as NodeOf<"variant">).private = true;
// Bytes (L189): a byte sequence. It means its list of Ints, each 0 to 255;
// a representation may keep them in a buffer. Made by the prelude's
// `bytes of`, which checks each item, and `utf8 of`. After Tensor, so ids
// above don't move.
export const BYTES = typedef("std.bytes", "Bytes", [], [
  ["bytes", [["items", () => tref(LIST, tref(INT))]]],
]);
export const BYTES_V = "std.bytes.bytes";
SMART[BYTES_V] = "bytes of";
(nodes.find((x) => x.id === BYTES_V) as NodeOf<"variant">).private = true;
// JSON's values (L190, RFC 8259) as data: a program reads and writes them
// with the prelude's `json printed`, and its own records go through them.
// After Bytes, so ids above don't move.
export const JSON_TYPE = typedef("std.json", "Json", [], [
  ["json null", []],
  ["json bool", [["value", () => tref(BOOL)]]],
  ["json number", [["value", () => tref(NUMBER)]]],
  ["json text", [["value", () => tref(STRING)]]],
  ["json list", [["items", (_, self) => tref(LIST, tref(self))]]],
  ["json object", [["fields", (_, self) => tref(LIST, tref(PAIR, tref(STRING), tref(self)))]]],
]);
export const JSON_V = { null: "std.json.json null", bool: "std.json.json bool", number: "std.json.json number", text: "std.json.json text", list: "std.json.json list", object: "std.json.json object" };
// A calendar date (L188, the proleptic Gregorian calendar, as ISO 8601 and
// java.time's LocalDate): a year, a month 1 to 12 and a day of that month,
// checked by the prelude's `date of`. After Json, so ids above don't move.
export const DATE = typedef("std.date", "Date", [], [
  ["date", [["year", () => tref(INT)], ["month", () => tref(INT)], ["day", () => tref(INT)]]],
]);
export const DATE_V = "std.date.date";
SMART[DATE_V] = "date of";
(nodes.find((x) => x.id === DATE_V) as NodeOf<"variant">).private = true;
// A time of day (L188c, as ISO 8601 and java.time's LocalTime): whole
// seconds from midnight, 0 to 86399, read as an hour, a minute and a second.
// Made by the prelude's `time of`, which checks it. After Date, so ids
// above don't move.
export const TIME_OF_DAY = typedef("std.timeofday", "Time of day", [], [
  ["time of day", [["seconds", () => tref(INT)]]],
]);
export const TIME_OF_DAY_V = "std.timeofday.time of day";
SMART[TIME_OF_DAY_V] = "time of";
(nodes.find((x) => x.id === TIME_OF_DAY_V) as NodeOf<"variant">).private = true;
// An instant (L188b, as java.time's Instant and POSIX time): seconds since
// 1970-01-01 00:00:00 UTC, a Float64 so it holds fractions of a second,
// leap seconds not counted. A duration is a Float64 in seconds. After Time
// of day, so ids above don't move.
export const INSTANT = typedef("std.instant", "Instant", [], [
  ["instant", [["seconds", () => tref(NUMBER)]]],
]);
export const INSTANT_V = "std.instant.instant";
SMART[INSTANT_V] = "instant of";
(nodes.find((x) => x.id === INSTANT_V) as NodeOf<"variant">).private = true;
// An embedding of a in b (EMBEDDINGS.md, L208b): a map from a into b that
// keeps the operations, ι(x + y) = ι(x) + ι(y) and so on, declared at most
// once for a pair of types, `embedding(map: (x) → complex(x, 0))`. lab test
// checks its laws (embed-laws.ts). After Instant, so ids above don't move.
export const EMBEDDING = typedef("std.embedding", "Embedding", ["a", "b"], [
  ["embedding", [["map", ([a, b]) => tfun([tref(a)], tref(b), [])]]],
]);
export const EMBEDDING_V = "std.embedding.embedding";
// A request over the network and its response (L191, network.ts): a
// header is a name and a value, in the order given. After Embedding, so
// the ids above don't move.
const headersT = () => tref(LIST, tref(PAIR, tref(STRING), tref(STRING)));
export const REQUEST = typedef("std.request", "Request", [], [
  ["request", [["method", () => tref(STRING)], ["url", () => tref(STRING)], ["headers", headersT], ["body", () => tref(STRING)]]],
]);
export const RESPONSE = typedef("std.response", "Response", [], [
  ["response", [["status", () => tref(INT)], ["headers", headersT], ["body", () => tref(STRING)]]],
]);
// A language, as a BCP 47 tag ("tr", "en-GB"), for what depends on it:
// case (L214b), later collation (L214d).
export const LOCALE = typedef("std.locale", "Locale", [], [
  ["locale", [["tag", () => tref(STRING)]]],
]);
export const LOCALE_V = "std.locale.locale";
export const EMBEDDING_MAP = "std.embedding.embedding.map";
export function tupleType(n: number): Id { return `std.tuple${n}`; }
export const tupleVariant = (n: number): Id => `std.tuple${n}.tuple`;
export const tuplePart = (n: number, i: number): Id => `std.tuple${n}.tuple.${PART_NAMES[i]}`;
// Ids that were renamed, as a saved program may still use them: std's Pair
// is Tuple2 (L139).
export const RENAMED_IDS: Record<Id, Id> = {
  "std.pair": "std.tuple2", "std.pair.type": "std.tuple2.type", "std.pair.a": "std.tuple2.a", "std.pair.b": "std.tuple2.b",
  "std.pair.pair": "std.tuple2.tuple", "std.pair.pair.fst": "std.tuple2.tuple.first", "std.pair.pair.snd": "std.tuple2.tuple.second",
};
// Library definitions whose content changed, old id to today's (L184,
// written by library/build.ts). A part of one (`@def:3`) moves with it.
const MOVED = moved0 as Record<Id, Id>;
const todaysId = (id: string): string => {
  const renamed = RENAMED_IDS[id] ?? MOVED[id];
  if (renamed) return renamed;
  const at = id.startsWith("@") ? id.indexOf(":") : -1;
  return at > 0 && MOVED[id.slice(0, at)] ? MOVED[id.slice(0, at)] + id.slice(at) : id;
};
// A saved value (a program's code, names, comments) read as today's: each
// renamed or moved id in it, as a key or a string, and its nodes moved
// through every change of shape since the one it was saved at (`shape`,
// model.ts SHAPE_STEPS; all of them when it has none).
export function onTodaysIds<T>(x: T, from = (x as { shape?: unknown } | null)?.shape): T {
  const shape = typeof from === "number" ? from : 0;
  if (typeof x === "string") return todaysId(x) as T;
  if (Array.isArray(x)) return x.map((v) => onTodaysIds(v, shape)) as T;
  if (x && typeof x === "object") {
    const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [todaysId(k), onTodaysIds(v, shape)]));
    if (o.nodes && typeof o.nodes === "object" && !Array.isArray(o.nodes)) toTodaysShape(o.nodes as Record<Id, unknown>, shape);
    return o as T;
  }
  return x;
}
export const tupleSize = (id: Id): number | null => { const m = /^std\.tuple(\d)$/.exec(id); return m ? Number(m[1]) : null; };

export const std: Code = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), defs: [BOOL, UNIT, LIST, OPTIONAL, ABORT, LOG, RANDOM, CHECK, TIME, WAIT, EVENT, INPUT, ATTRIBUTE, HTML, RATIONAL, COMPLEX, ORDER, OUTCOME, MAP, SET_TYPE, TABLE_ENTRY, ALGEBRA, EXTENDED, TICKET, AWAIT, BRANCH, ALGEBRAIC, TRIG, DUAL, ARITHMETIC, ORDERED, FIXED, MAT2, MAT3, MAT4, COST, REPRESENTATION, CONSOLE_TYPE, FILES_TYPE, NETWORK_TYPE, VIEW_ROW, HANDLER_ROW, SOUND_ROW, ...TUPLES, DIVISION, QUEUE, PRIORITY_QUEUE, MATRIX, STATE, SEND, RECEIVE, PIPE, SHOWN, WORD8, WORD32, WORD64, BITS, WORD16, TENSOR, BYTES, JSON_TYPE, DATE, TIME_OF_DAY, INSTANT, EMBEDDING, REQUEST, RESPONSE, LOCALE] };
export const stdNames: Names = { ...names, [B.sqrt]: "sqrt", [B.pow]: "power" };

// Operations where the grouping doesn't change the answer. A chain of one
// of them, a ++ (b ++ c), is shown as the one call it means, with every
// operand side by side, however the tree pairs them up: a view, like a
// list drawn as [x, y] (the program keeps its pairs). `keep` stops at an
// inner call that has to stay visible on its own (a graph's named dot).
export const ASSOCIATIVE = new Set<Id>([B.add, B.mul, S.and, S.or, S.concat]);
export function chainOperands(code: Code, id: Id, keep: (id: Id) => boolean = () => false): Id[] | null {
  const head = (n: Node | undefined) => (isCall(n) && n.args.length === 2 ? code.nodes[n.fn] : undefined);
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
