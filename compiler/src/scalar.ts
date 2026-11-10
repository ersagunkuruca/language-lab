// The core IR (docs/design/targets/CORE-IR.md, C137b): what WebAssembly,
// C, WGSL and js-scalar.ts print, and what compiled JavaScript is to be
// printed from too. It began as the scalar profile, below, and has grown
// data, closures, searches, handlers, the world, Int, Text, arrays and
// tables; CORE-IR.md has its contract.
//
// The scalar profile: the part of the language that needs no heap.
//
// A definition is in it when its inputs and result are Float64 or Bool, and
// its body uses only arithmetic, comparisons, `if`, lets, and calls to other
// definitions in the profile. No data, no closures, no Choice, no world
// effects, and nothing that might not finish. That's exactly what a GPU or
// plain WebAssembly can run without a garbage collector, so this one
// lowering feeds both: wasm.ts prints it as a WebAssembly module, and a
// shader backend would print it as WGSL (see docs/design/targets/COMPILER.md).
//
// With `records`, the profile also takes records of those: a data type
// with one case whose fields are Float64s, Bools or records again (a
// point, a colour, a ray). They need no heap either, since their size is
// known; a shader has them as structs (or vectors, wgsl.ts). A record is built by its case,
// read by its fields or by a match with one arm. WebAssembly has them as
// WasmGC structs (wasm.ts).
//
// With `data` (WebAssembly only, which has a garbage collector), the
// profile also takes data types with several cases and types that
// contain themselves: lists, expression trees, Optional. They're built by
// their cases, taken apart by a match or by their fields, and their values
// live on the heap (DType). Something that may not finish is allowed too,
// as in the JS backend, since a module that loops is a program that
// loops, not a hung GPU; a budget still counts the same way.
//
// The lowering is to a tiny expression tree with numbered locals. A
// definition outside the profile is refused with the reason, the way a
// type error is reported, so "can this run on the GPU / in WASM" is a
// question with an answer you can show in the editor.
//
// Diverge, like every other effect, has to be handled before it gets here.
// On a GPU a loop that never ends doesn't throw: it hangs the tab or
// resets the device. So a definition whose type says it might not finish
// is refused, unless it runs under a budget, the language's own handler
// for Diverge written the way a shader needs it:
//
//   first(() => with fuel(1000, () => trace(x, y, time)), () => fallback)
//
// `with fuel(n, …)` allows n calls to possibly-divergent definitions and
// then fails; `first` turns the failure into the fallback. The result has
// no Diverge in its type, and the lowering keeps the same count the
// evaluator keeps (one per call into a definition the checker couldn't
// see end, a loop's rounds included), so the GPU gives the evaluator's
// answer, fallback and all. n is a number written down, so the bound is
// known when the shader is built.

import { tableText } from "./table-text.ts";
import { unnameHandlers } from "./handler-names.ts";
import { laterOps as laterOpsOf } from "../../ters/src/lang/later-ops.ts";
import { answerKeys, givenInOrder } from "../../ters/src/lang/ports.ts";
import { resolveArithmetic } from "../../ters/src/lang/arith.ts";
import type { Code, Id, NodeOf } from "../../ters/src/model.ts";
import { dependencies, portsOf, subtree, isCall, type Call, isUse, useTarget, type Use } from "../../ters/src/model.ts";
import { bindsOf, bodyOf, withBodies } from "./uses.ts";
import type { Names } from "../../ters/src/presentation.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { ARRAY, TABLE, HASH_SET, CELL, CELLS, UPDATE, CHOICE, CONSOLE, DIVERGE, FILES, INT, NUMBER, PATH as PATH_T, STRING, BUILTIN_EFFECTS, Subst, type Row, type Type } from "../../ters/src/lang/types.ts";
import { RELEASE_V, LOG_OP, FILE_OPS, KEPT_FILES, OPEN_FILE, tupleType, ABORT, ABORT_OP, CHECK, CHECK_OP, ALGEBRAIC_V, ARRAY_OPS, TABLE_OPS, HASH_SET_OPS, BOOL, CASE_NAME, RANDOM, RANDOM_OP, CELL_OPS, COMPARE, CONS, EXTENDED_V, FALSE, INT_OPS, IO, NIL, NONE, NOW_OP, MY_LOCALE_OP, MY_ZONE_OP, SETTINGS, OPTIONAL, ORDER_V, PAIR_V, S, SET, SHOW_ANY, shownImplementations, implementationsOf, ORDERED, SOME, TEXT_OPS, TRUE, ZONE_OPS } from "../../ters/src/lang/std.ts";
import { liftLets } from "../../ters/src/lang/lift-lets.ts";
import { solvesOnce } from "../../ters/src/lang/run.ts";
import { planSolve } from "../../ters/src/lang/solve.ts";
import { relationFor } from "../../ters/src/lang/equations.ts";
import { writablePlan } from "./relation.ts";
import { cleanBody, live, NotWritten, roundedKey, writtenExpr, writtenSteps, type Written } from "./solved.ts";
import { tornRoots } from "./torn.ts";
import { solveMode, determinism, analyzer, type Plan as ModePlanT } from "../../ters/src/lang/modes.ts";
import { inlineLists } from "./inline-lets.ts";
import { B } from "../../ters/src/prelude.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { SITES, STOPS } from "./stops.ts";
import { fieldIndex, fieldPath } from "../../ters/src/lang/records.ts";
import { expandDerivatives, recordVariant } from "../../ters/src/lang/derive.ts";
import { stageProgram } from "../../ters/src/lang/stage.ts";
import { firstArms } from "../../ters/src/lang/first-arms.ts";
import { parallelCounts, parallelFolds, parallelLists, parallelTogethers, type ListJob } from "../../ters/src/lang/pure-branches.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { discharge } from "../../ters/src/lang/ledger.ts";
import { scalarOp, TARGETS } from "./builtins.ts";
import { WORLD_OPS as OP_OF_BUILTIN } from "../../ters/src/lang/std.ts";
import { AUDIO_BLOCK, AWAIT, AWAIT_OP, START_TIMER_OP, TICKET_V, TIME, WAIT, WAIT_OP, HANDLER_ROW, LIST, PAGE_HANDLER, PAGE_VIEW, SIGS, SOUND_ROW, VIEW_ROW, STD_IMPL, STD_MANY } from "../../ters/src/lang/std.ts";
// Cells' operations JavaScript from the core IR takes from the evaluator
// (run.ts cellOps), `path` aside: it looks inside its function.
// The effects a page's views and handlers may have (std.ts PAGE_VIEW,
// PAGE_HANDLER, AUDIO_BLOCK, and the rows naming them), which a function's type may name for JavaScript from the
// core IR (C137c8); an operation of one that isn't lowered is refused
// where it is called.
const PAGE_EFFECTS = new Set<Id>([...PAGE_VIEW, ...PAGE_HANDLER, ...AUDIO_BLOCK, VIEW_ROW, HANDLER_ROW, SOUND_ROW]);
// The cells operations C has (C199a): the rest are refused there.
const CELL_C = new Set<Id>([CELL_OPS.cell, CELL_OPS.formula, CELL_OPS.read, CELL_OPS.write]);
const HOST_CELLS = new Set(Object.values(CELL_OPS).filter((id) => id !== CELL_OPS.path));
import { runtime } from "./wasm-rt.ts";
import { machineWords } from "./machine-words.ts";
import { loopRecords } from "./loop-records.ts";
import { closureArgs } from "./closure-args.ts";
import { wideProducts } from "./wide-products.ts";

// A shader (or a ray marcher's loop) may call what might not finish only
// under a literal with fuel; the rest of its type must be empty.
// std's Array's builtins: runtime functions, one copy per item type.
// std's Table's jobs (C63h), by their runtime functions' names.
const TABLE_RT: Record<Id, string> = {
  [TABLE_OPS.empty]: "empty", [TABLE_OPS.put]: "put", [TABLE_OPS.remove]: "remove", [TABLE_OPS.has]: "has",
  [TABLE_OPS.size]: "size", [TABLE_OPS.at]: "at", [TABLE_OPS.entries]: "entries",
  // A hash set (C63i) is the table of its items, each holding true.
  [HASH_SET_OPS.empty]: "empty", [HASH_SET_OPS.add]: "put", [HASH_SET_OPS.remove]: "remove", [HASH_SET_OPS.has]: "has",
  [HASH_SET_OPS.size]: "size", [HASH_SET_OPS.items]: "entries",
};
// Log's effect, written to the world by a target that runs releases.
const LOG_EFFECT = "std.log";
// together and race (C44): in C, each action on a fiber.
const libDef = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name);
const TOGETHER = libDef("together"), RACE = libDef("race");

export const ARRAY_RT: Record<Id, string> = {
  [ARRAY_OPS.empty]: "array.empty", [ARRAY_OPS.of]: "array.of", [ARRAY_OPS.items]: "array.items",
  [ARRAY_OPS.length]: "array.length", [ARRAY_OPS.at]: "array.at", [ARRAY_OPS.push]: "array.push",
  [ARRAY_OPS.first]: "array.first", [ARRAY_OPS.rest]: "array.rest", [ARRAY_OPS.pushFront]: "array.pushFront",
};
// Int's builtins held in 32 bits (`shader`). quotient, remainder, power
// and whole part may have no answer, which sets the shader's flag.
const INT32: Record<Id, Op> = {
  [INT_OPS.add]: "iadd", [INT_OPS.sub]: "isub", [INT_OPS.mul]: "imul", [INT_OPS.neg]: "ineg", [INT_OPS.abs]: "iabs",
  [INT_OPS.less]: "iless", [INT_OPS.toNumber]: "itof",
  [INT_OPS.quotient]: "iquot", [INT_OPS.remainder]: "irem", [INT_OPS.power]: "ipow", [INT_OPS.wholePart]: "iwhole",
};
// Builtins on Int and Text that are runtime functions (`data`).
export const RT: Record<Id, string> = {
  [INT_OPS.add]: "int.add", [INT_OPS.sub]: "int.sub", [INT_OPS.mul]: "int.mul", [INT_OPS.neg]: "int.neg", [INT_OPS.abs]: "int.abs",
  [INT_OPS.less]: "int.less", [INT_OPS.show]: "int.show", [INT_OPS.toNumber]: "int.toNumber",
  [S.concat]: "text.concat", [S.show]: "number.show", [S.range]: "number.range", [INT_OPS.range]: "int.range",
  [TEXT_OPS.length]: "text.length", [TEXT_OPS.slice]: "text.slice", [TEXT_OPS.characters]: "text.characters",
  [TEXT_OPS.split]: "text.split", [TEXT_OPS.joinAll]: "text.joinAll", [TEXT_OPS.less]: "text.less",
  // No answer or one (Choice): runtime functions that give a status too.
  [INT_OPS.quotient]: "int.quotient", [INT_OPS.remainder]: "int.remainder", [INT_OPS.power]: "int.power",
  [INT_OPS.read]: "int.read", [INT_OPS.wholePart]: "int.wholePart",
  // and, or, xor on Int (C150, L193's words keep their low bits by them).
  [INT_OPS.shiftDown]: "int.shiftDown", [INT_OPS.bitAnd]: "int.bitAnd", [INT_OPS.bitOr]: "int.bitOr", [INT_OPS.bitXor]: "int.bitXor",
  [TEXT_OPS.find]: "text.find", [TEXT_OPS.code]: "text.code", [TEXT_OPS.fromCode]: "text.fromCode",
  [TEXT_OPS.readNumber]: "text.readNumber",
};

// The world (`data`): the console and files, through the host's World
// (wasm.ts imports them). `aborts`: it can fail, with a reason.
export const WORLD_OPS: Record<Id, { op: string; aborts: boolean }> = {
  [S.print]: { op: "print", aborts: false }, [IO.printError]: { op: "printError", aborts: false },
  [IO.readInput]: { op: "readInput", aborts: true }, [IO.readLine]: { op: "readLine", aborts: true },
  [IO.readFile]: { op: "readFile", aborts: true }, [IO.writeFile]: { op: "writeFile", aborts: true }, [IO.appendFile]: { op: "appendFile", aborts: true },
  [IO.fileExists]: { op: "fileExists", aborts: false }, [IO.listFolder]: { op: "listFolder", aborts: true },
};
// A world operation of the core IR's JavaScript, by its builtin, on
// lowered arguments; null for one it doesn't have.
const HOST_WORLD: Record<Id, { op: string; aborts: boolean }> = {
  [IO.readBytes]: { op: "readBytes", aborts: true }, [IO.writeBytes]: { op: "writeBytes", aborts: true }, [IO.fetchText]: { op: "fetchText", aborts: true },
  [IO.sendRequest]: { op: "sendRequest", aborts: true },
  // A fetch as a ticket (L150, C182): ready when the body comes.
  [IO.startFetch]: { op: "startFetch", aborts: true },
};
const worldCall = (b: Id, args: SExpr[], t: LType): SExpr | null => {
  const w = WORLD_OPS[b] ?? HOST_WORLD[b];
  return w ? { k: "world", ...w, args, t } : null;
};
// C's (L213c5, bytes L213c7).
const C_KEPT = new Set(Object.values(FILE_OPS));
// The kept files' operations (L213c3), for JavaScript from the core IR.
const KEPT_OPS: Record<Id, string> = {
  [FILE_OPS.open]: "keptOpen", [FILE_OPS.line]: "keptLine", [FILE_OPS.addLine]: "keptAddLine",
  [FILE_OPS.close]: "keptClose", [FILE_OPS.bytes]: "keptBytes", [FILE_OPS.addBytes]: "keptAddBytes",
};
const BUDGETED = discharge("a shader", [DIVERGE], "only under a literal with fuel, which gives each pixel a step budget");

// Float64, Bool (0 or 1), and Int held in 32 bits (`int32`, shaders: C66c).
export type SType = "f64" | "i32" | "int32" | "i64";
// A record: a data type with one case, at particular type arguments.
// `mutable`: a box the lowering makes (W4d), whose one field a search sets.
// `owned`: its values are written in place (owned-records.ts), so none is
// made once and shared.
export interface RType { key: string; name: string; def: Id; variant: Id; case?: string; fields: { name: string; t: LType }[]; mutable?: true; owned?: true }
// A data type with several cases, or one that contains itself (`data`).
// A case's fields are in the order written.
// `inner`: made by the lowering (a fold's stack), not the program's.
export interface DType { key: string; name: string; def: Id; cases: { variant: Id; name: string; fields: { name: string; t: LType }[] }[]; inner?: boolean }
// A function as a value (`data`): a closure, called through its code.
// `partial`: it may have no answer (Choice, or a budget running out), so
// its code gives a status after its answer, as a partial SFunc does.
// `several` (C137c22, SEVERAL-ANSWER-FUNCTIONS-2026-11-03.md): a function
// type with Choice whose closures may give several answers. Its closures
// take the rest of the search as one more input, last (a continuation of
// the answer, `answer`), and answer whether it went on, as a definition
// with several answers does; `result` is that i32. `chooses`: it is
// several for its Choice; `waits` (C40 step 4): for a Wait or an Await in
// its row, whose closures go on from a wait by the rest they were given.
export interface FType { key: string; params: LType[]; result: LType; partial?: boolean; several?: true; answer?: LType; chooses?: true; waits?: true }
// What a generic definition's type variables stand for, and its effect
// rows (by their tail variable: the effects added).
type At = Map<number, Type | Row>;
// Int and Text (`data`): an i31 or a $big (W5), and UTF-8 bytes
// (wasm-rt.ts).
export type WType = "int" | "text" | "host";
// std's Array (`data`, C66): a view, a start and a length, on a buffer
// with free room at both ends, as compiled JS keeps it (runtime.js, C30d1).
// `index`: its place in CoreIR.arrays, which the runtime's array
// functions are named by (`array.push.a0`); `list`: List of its items,
// when a job takes or gives one.
export interface AType { key: string; name: string; item: LType; index: number; list: DType | null }
// std's Table (C63h): Map as a hash table, in C only, for Int and Text
// keys (c.ts `tableC`). `index`: its place in CoreIR.tables, which its
// runtime functions are named by (`table.put.t0`); `entries`: each List
// of (key, value) pairs `table entries` gives (`table.entries.t0.e1`): a
// key nothing fixes is held as an Int, its pairs' may be another type.
// `set`: std's Hash set (C63i), its items the keys, each holding true
// (a Bool), its entries the List of its items.
export interface TType { key: string; name: string; keyT: "int" | "text" | "f64" | RType; value: LType; index: number; entries: DType[]; set: boolean }
export type LType = SType | WType | RType | DType | FType | AType | TType;
export const isArray = (t: LType): t is AType => typeof t === "object" && "item" in t;
export const isTable = (t: LType): t is TType => typeof t === "object" && "keyT" in t;
export const isData = (t: LType): t is DType => typeof t === "object" && "cases" in t;
export const isRecord = (t: LType): t is RType => typeof t === "object" && "variant" in t;
export const isFn = (t: LType): t is FType => typeof t === "object" && "result" in t;
// A closure's own struct: the function type it has and what it captured.
export interface Shape { t: FType; caps: LType[] }
// For a printer of a target without a heap (WGSL, the JS fallback for
// shaders), which is never given data.
export const noData = (e: SExpr): never => { throw new Error(`${e.k} needs a heap: lower without \`data\``); };
// Whether e can end with no answer or abort: it fails or aborts, or calls
// something partial.
export function fails(e: SExpr, funcs: SFunc[]): boolean {
  switch (e.k) {
    case "fail": case "abort": return true;
    case "world": return e.aborts || e.args.some((a) => fails(a, funcs));
    case "call": return !!funcs[e.fn]?.partial || e.args.some((a) => fails(a, funcs));
    // The worker threads' runtime is JavaScript's only (branches-rt.ts):
    // what it runs may abort as the code it stands for may.
    case "rt": return !!(e.host ? e.host.partial : e.fn === "map.worth" ? false : /\.(pure|search)$/.test(e.fn) || runtime(e.fn).partial) || e.args.some((a) => fails(a, funcs));
    case "apply": return !!e.t.partial || kids(e).some((a) => fails(a, funcs));
    // An abort goes on through first and budgets, so their bodies count.
    case "attempt": case "budget": return kids(e).some((a) => fails(a, funcs));
    default: return kids(e).some((a) => fails(a, funcs));
  }
}
// A written list's empty case, and its case made of `item` onto `acc`:
// what a printer builds it from, from the last item (L181b).
export function listSteps(e: Extract<SExpr, { k: "list" }>): [SExpr, SExpr] {
  const nil = e.t.cases.findIndex((x) => !x.fields.length);
  const fields = e.t.cases[e.c].fields.map((x): SExpr => ({ k: "local", i: x.t === e.t ? e.acc : e.item }));
  return [{ k: "new", t: e.t, c: nil, args: [] }, { k: "new", t: e.t, c: e.c, args: fields }];
}
// The expressions directly inside e.
export function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return e.args;
    case "list": return e.items;
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "get": case "field": case "tag": return [e.rec];
    case "case": return [e.scrut, ...e.arms.filter((a): a is SExpr => !!a)];
    case "budget": return [e.body, e.otherwise];
    case "closure": return e.caps;
    case "apply": return [e.fn, ...e.args];
    case "attempt": return [e.body, e.ok, e.otherwise];
    case "abort": return [e.reason];
    case "handle": return [e.body, e.arm];
    case "released": return [e.body, e.release];
    case "choose": return [e.list];
    case "search": return [e.body, ...(e.dflt ? [e.dflt] : [])];
    case "set": return [e.rec, e.value, e.then];
    default: return [];
  }
}
// e with its kids (in kids' order) replaced by f's.
export function mapKids(e: SExpr, f: (x: SExpr) => SExpr): SExpr {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return { ...e, args: e.args.map(f) } as SExpr;
    case "list": return { ...e, items: e.items.map(f) };
    case "if": return { ...e, cond: f(e.cond), then: f(e.then), else: f(e.else) };
    case "let": return { ...e, value: f(e.value), body: f(e.body) };
    case "get": case "field": case "tag": return { ...e, rec: f(e.rec) } as SExpr;
    case "case": { const scrut = f(e.scrut); return { ...e, scrut, arms: e.arms.map((a) => a && f(a)) }; }
    case "budget": return { ...e, body: f(e.body), otherwise: f(e.otherwise) };
    case "closure": return { ...e, caps: e.caps.map(f) };
    case "apply": { const fn = f(e.fn); return { ...e, fn, args: e.args.map(f) }; }
    case "attempt": return { ...e, body: f(e.body), ok: f(e.ok), otherwise: f(e.otherwise) };
    case "abort": return { ...e, reason: f(e.reason) };
    case "handle": return { ...e, body: f(e.body), arm: f(e.arm) };
    case "released": return { ...e, body: f(e.body), release: f(e.release) };
    case "choose": return { ...e, list: f(e.list) };
    case "search": { const body = f(e.body); return { ...e, body, ...(e.dflt ? { dflt: f(e.dflt) } : {}) }; }
    case "set": { const rec = f(e.rec), value = f(e.value); return { ...e, rec, value, then: f(e.then) }; }
    default: return e;
  }
}
// e with every local it reads or sets renumbered by m.
export function mapLocals(e: SExpr, m: (i: number) => number): SExpr {
  const r = mapKids(e, (x) => mapLocals(x, m));
  switch (r.k) {
    case "local": return { k: "local", i: m(r.i) };
    case "let": return { ...r, i: m(r.i) };
    case "case": return { ...r, s: m(r.s) };
    case "attempt": case "search": return { ...r, res: m(r.res) };
    case "apply": return { ...r, tmp: m(r.tmp) };
    case "list": return { ...r, item: m(r.item), acc: m(r.acc) };
    case "handle": return { ...r, reason: m(r.reason), save: m(r.save), ...(r.frame !== undefined ? { frame: m(r.frame) } : {}) };
    case "budget": return { ...r, save: m(r.save), res: m(r.res) };
    default: return r;
  }
}
// A function's body tidied for every printer (C175), changing no bit of
// any answer: `let a = b` of a local set once is b where a is read, and
// -(-x) is x, a + (-b) is a − b (IEEE's a − b is a + (−b), exactly).
export function tidied(f: SFunc, self: number): SFunc {
  const writes = new Map<number, number>();
  const wrote = (i: number) => writes.set(i, (writes.get(i) ?? 0) + 1);
  let loops = false;
  const scan = (e: SExpr) => {
    switch (e.k) {
      case "let": wrote(e.i); break;
      case "case": wrote(e.s); break;
      case "attempt": case "search": wrote(e.res); break;
      case "apply": wrote(e.tmp); if (e.tail) loops = true; break;
      case "list": wrote(e.item); wrote(e.acc); break;
      case "handle": wrote(e.reason); wrote(e.save); if (e.frame !== undefined) wrote(e.frame); break;
      case "budget": wrote(e.save); wrote(e.res); break;
      case "released": if (e.st !== undefined) wrote(e.st); break;
      case "call": if (e.tail && e.fn === self) loops = true; break;
    }
    kids(e).forEach(scan);
  };
  scan(f.body);
  // A parameter is set again each time round a loop.
  const once = (i: number) => (i < f.params.length ? !loops && !writes.has(i) : writes.get(i) === 1);
  // A let nothing reads whose value can't stop, fail or draw is dropped.
  const reads = new Map<number, number>();
  const count = (e: SExpr) => { if (e.k === "local") reads.set(e.i, (reads.get(e.i) ?? 0) + 1); kids(e).forEach(count); };
  count(f.body);
  const PURE = new Set<string>(["add", "sub", "mul", "div", "neg", "sqrt", "abs", "floor", "float32", "sin", "cos", "tan", "exp", "log", "pow", "atan2", "less", "equal", "beq", "and", "or", "not", "itof"]);
  const pure = (e: SExpr): boolean => ["local", "num", "bool", "text", "zero"].includes(e.k) || ((e.k === "op" && PURE.has(e.op)) || e.k === "make" || e.k === "get") && kids(e).every(pure);
  const tidy = (e: SExpr): SExpr => {
    if (e.k === "let" && !reads.get(e.i) && once(e.i) && !e.check && !e.seeded && pure(e.value)) return tidy(e.body);
    if (e.k === "let" && e.value.k === "local" && e.value.i !== e.i && once(e.i) && once(e.value.i) && f.locals[e.i] === f.locals[e.value.i] && !e.check && !e.seeded) {
      const j = e.value.i, i = e.i;
      return tidy(mapLocals(e.body, (x) => (x === i ? j : x)));
    }
    const r = mapKids(e, tidy);
    if (r.k === "op" && r.op === "neg" && r.args[0].k === "op" && r.args[0].op === "neg") return r.args[0].args[0];
    if (r.k === "op" && r.op === "add" && r.args.length === 2 && r.args[1].k === "op" && r.args[1].op === "neg") return { k: "op", op: "sub", args: [r.args[0], r.args[1].args[0]] };
    return r;
  };
  return { ...f, body: tidy(f.body) };
}
// The locals e reads that it doesn't set itself, in the order first read.
function freeLocals(e: SExpr): number[] {
  const read: number[] = [], set = new Set<number>();
  const walk = (x: SExpr) => {
    switch (x.k) {
      case "local": if (!read.includes(x.i)) read.push(x.i); break;
      case "let": set.add(x.i); break;
      case "case": set.add(x.s); break;
      case "attempt": case "search": set.add(x.res); break;
      case "apply": set.add(x.tmp); break;
      case "list": set.add(x.item); set.add(x.acc); break;
      case "handle": set.add(x.reason); set.add(x.save); if (x.frame !== undefined) set.add(x.frame); break;
      case "budget": set.add(x.save); set.add(x.res); break;
    }
    kids(x).forEach(walk);
  };
  walk(e);
  return read.filter((i) => !set.has(i));
}

// Where a closure came from, for JavaScript from the core IR (C137c13): the
// lambda written in place (or a definition's), and the binders its captures
// are; or a builtin. The evaluator's solver looks inside a function it is
// given (relate.ts fromValue), so the printed closure carries this as the
// evaluator's closures do (run.ts META). Other printers ignore it.
export type ClosureSrc = { lambda: Id; binders: Id[]; bools: number[] } | { prim: Id };
export type SExpr =
  | { k: "num"; v: number }
  | { k: "int"; v: bigint }
  | { k: "text"; v: string }
  // A function of the runtime (wasm-rt.ts) by name.
  | { k: "rt"; fn: string; args: SExpr[]; host?: { t: LType; partial: boolean } }
  | { k: "bool"; v: boolean }
  | { k: "local"; i: number }
  | { k: "op"; op: Op; args: SExpr[] }
  // `check`: a finiteness check (L125c2), `then` the stop, `else` the
  // value; a shader takes `else` alone (unchecked).
  | { k: "if"; cond: SExpr; then: SExpr; else: SExpr; t: LType; check?: true }
  // `check`: a value named for a finiteness check (L125c2), used once
  // without it.
  | { k: "let"; i: number; value: SExpr; body: SExpr; check?: true; seeded?: true }
  // `cps`: a call of a function with several answers (W4d), the rest of
  // the search passed as its last input.
  | { k: "call"; fn: number; args: SExpr[]; tail: boolean; cps?: true }
  // `into` (C93 s5, owned-records.ts): written into that local's value,
  // whose fields at `same` are already these.
  | { k: "make"; t: RType; args: SExpr[]; into?: number; same?: number[] }
  | { k: "get"; rec: SExpr; t: RType; i: number }
  // A value of case c of t, and field i of one (it is that case: the
  // checker says so, or the match just looked).
  | { k: "new"; t: DType; c: number; args: SExpr[] }
  | { k: "field"; rec: SExpr; t: DType; c: number; i: number }
  // A written list (`list of`, L181b): items in order, each a value of
  // case c's head, made into case c from the end onto t's empty case. Flat,
  // so ten thousand items are one node; a printer evaluates them in order
  // and builds from the last with locals `item` and `acc`.
  | { k: "list"; t: DType; c: number; items: SExpr[]; item: number; acc: number }
  // The number of a value's case, from 0 in the order written.
  | { k: "tag"; rec: SExpr; t: DType }
  // A function as a value: `fn` takes the closure, then t's inputs, and
  // reads what it captured (in shapes[shape]) with cap.
  | { k: "closure"; t: FType; fn: number; shape: number; caps: SExpr[]; src?: ClosureSrc }
  | { k: "cap"; t: FType; shape: number; i: number }
  // Calling a closure: it goes into local tmp, then its code is called
  // with it and the inputs.
  | { k: "apply"; fn: SExpr; t: FType; args: SExpr[]; tail: boolean; tmp: number; cps?: true }
  // A match on t: scrut goes into local s, then the arm for its case
  // runs (null: no arm, which the checker rules out).
  | { k: "case"; scrut: SExpr; s: number; t: DType; arms: (SExpr | null)[]; result: LType }
  // first(() => with fuel(n, () => body), () => otherwise): body with n
  // calls to spend, or otherwise if it ran out. `save` is a Float64 local
  // for the budget around this one, `res` one for body's value.
  // `resumes`: body may wait (C181), as an attempt's.
  | { k: "budget"; n: number; body: SExpr; otherwise: SExpr; t: LType; save: number; res: number; resumes?: true }
  // No answer here (Choice, `data`): the nearest attempt gives its
  // otherwise, or the function, being partial, says it has none.
  | { k: "fail" }
  // first, optional, all and count over a search with one answer or none:
  // body's answer goes into local res and ok is the value; if it has
  // none, otherwise is.
  // `spent`: running out of fuel inside is no answer here too, where a
  // printer tells the two apart (core-js.ts; C137c21's rest of a search).
  // `resumes`: body may wait (C181): a page's wait (Pending) going out
  // through it runs ok or otherwise once the rest it resumes is done.
  | { k: "attempt"; body: SExpr; res: number; ok: SExpr; otherwise: SExpr; t: LType; spent?: true; resumes?: true }
  // abort(reason) (`data`): the computation ends, out to the nearest
  // handler of Abort, which gets the reason in local `reason` and gives
  // arm's value instead (a match on Abort). With `esc`, another operation
  // that never returns (C34): status 2 + esc, `reason` the operation as a
  // value of its effect's type (CoreIR.escapes[esc - 1]), and the
  // handler with that `esc` takes it.
  | { k: "abort"; reason: SExpr; esc?: number }
  // An operation on the world (WORLD_OPS), with its result's type.
  // `suspends` (C40 step 4): a page handler's wait or await, which goes on
  // by the rest of the handler; `cps`, that rest given last (t is then
  // the i32 it answers).
  // `ins`: its inputs' types, where they aren't texts (a host's
  // operation in WebAssembly, L69b2).
  | { k: "world"; op: string; aborts: boolean; args: SExpr[]; t: LType; suspends?: true; cps?: true; ins?: LType[] }
  | { k: "handle"; body: SExpr; reason: number; arm: SExpr; t: LType; save: number; esc?: number; frame?: number }
  // A handler's release (L213a, core IR only): body's value, with release
  // run once after it however body ends (its value, an Abort, a stop),
  // as the evaluator runs it on every exit.
  | { k: "released"; body: SExpr; release: SExpr; t: LType; st?: number }
  // W4d, gone after lowering: `one of` a list (t), anywhere, and a
  // handler's search (first, optional, all, count) to be made into code
  // once it's known whether it has several answers.
  | { k: "choose"; list: SExpr; t: DType }
  | { k: "search"; kind: "first" | "optional" | "all" | "count"; body: SExpr; res: number; t: LType; bt: LType; dflt?: SExpr; splits?: boolean }
  // Field i of the box rec set to value, then `then`; and the zero of t
  // (what a box starts as, before a search sets it).
  | { k: "set"; rec: SExpr; t: RType; i: number; value: SExpr; then: SExpr }
  | { k: "zero"; t: LType; none?: true };

// Operations the targets provide. `host` ones (sin, pow, …) aren't
// WebAssembly instructions; a WASM module imports them, a shader has them
// built in.
export type Op = keyof typeof OPS;
export const OPS = {
  add: { t: "f64" }, sub: { t: "f64" }, mul: { t: "f64" }, div: { t: "f64" }, neg: { t: "f64" },
  sqrt: { t: "f64" }, abs: { t: "f64" }, floor: { t: "f64" }, float32: { t: "f64" },
  sin: { t: "f64", host: true }, cos: { t: "f64", host: true }, tan: { t: "f64", host: true },
  exp: { t: "f64", host: true }, log: { t: "f64", host: true }, pow: { t: "f64", host: true }, atan2: { t: "f64", host: true }, mod: { t: "f64", host: true },
  less: { t: "i32" }, equal: { t: "i32" }, beq: { t: "i32" }, and: { t: "i32" }, or: { t: "i32" }, not: { t: "i32" },
  // Int in 32 bits (`int32`): + − × negate abs past 32 bits give up as a
  // budget running out does (wgsl.ts, js-scalar.ts).
  iadd: { t: "int32" }, isub: { t: "int32" }, imul: { t: "int32" }, ineg: { t: "int32" }, iabs: { t: "int32" },
  iless: { t: "i32" }, ieq: { t: "i32" }, itof: { t: "f64" },
  // One answer or none (`shader`): none sets the shader's flag.
  iquot: { t: "int32" }, irem: { t: "int32" }, ipow: { t: "int32" }, iwhole: { t: "int32" },
  // A 32-bit machine word held in an i32 and read unsigned (C150f,
  // machine-words.ts): + − × and negate wrap, `uless` compares unsigned.
  uadd: { t: "i32" }, usub: { t: "i32" }, umul: { t: "i32" }, uneg: { t: "i32" },
  uand: { t: "i32" }, uor: { t: "i32" }, uxor: { t: "i32" }, uless: { t: "i32" },
  // And a 64-bit one held in an i64 (C150h).
  u64add: { t: "i64" }, u64sub: { t: "i64" }, u64mul: { t: "i64" }, u64neg: { t: "i64" },
  u64and: { t: "i64" }, u64or: { t: "i64" }, u64xor: { t: "i64" }, u64less: { t: "i32" },
  // stop(i): the program stops with STOPS[i] (L125c2, finite() below):
  // a WebAssembly host's import, WASI's own line and exit, C's lab_stop.
  stop: { t: "f64" },
} as const satisfies Record<string, { t: SType; host?: boolean }>;


// `spends`: each call spends one from the budget (the checker couldn't see
// it end). `budgeted`: its type has Diverge, so it may only be called under
// a budget, never from outside. `inner`: made by the lowering (a fold
// is a function of its own), so not something to call from outside either.
// `partial`: it has one answer or none (Choice, `data`), so it gives a
// status with its answer (wasm.ts).
// `multi`: it has several answers (W4d): it takes the rest of the search
// as its last input and gives what that gives; `answer` is the type of
// its answers.
// `value`: a definition that isn't a function (sheet's `symbols`), whose
// value a printer may work out once (core-js.ts, C137d17).
// `binders`: the binder each local holds, where the lowering read one
// (C143d, the map's): ids only, by the local's number.
// A rewrite that changes no answer (arithmetic resolved, a derivative
// written out, a list let inlined, a list made an array) checked again: a
// definition that ended before ends now, though the checker may no longer
// see why, as with a walk over an array by first and rest (C184).
export function endsAsBefore(before: Info, after: Info): Info {
  for (const d of [...after.divergent]) if (before.typeOf.has(d) && !before.divergent.has(d)) after.divergent.delete(d);
  return after;
}

export interface SFunc { def: Id; name: string; params: LType[]; result: LType; locals: LType[]; body: SExpr; spends: boolean; budgeted: boolean; inner?: boolean; partial?: boolean; multi?: true; answer?: LType; value?: true; binders?: Id[] }
// `code` and `info` are the program that was lowered: the one given, or
// a copy with its derivatives generated, where funcs[i].def lives.
// rounded: definitions with a call worked out when compiled (stage.ts) that
// computed a number Float32 can't hold, so a Float32 run differs from it.
// `shader`: lowered with `shader` and not `data` (C66c): Int is int32, and
// no answer is the flag, not a status (wasm.ts takes both). `int32`:
// lowered without `data`, shader or not (C163): an Int is an int32.
// `stops`: where each stop site is (C143, stops.ts): the node a stop was
// lowered from, and the definition it is in.
export interface CoreIR { stops?: { node: Id; def: Id; name?: string }[]; funcs: SFunc[]; refused: Map<Id, string>; records: RType[]; data: DType[]; arrays: AType[]; tables: TType[]; fns: FType[]; shapes: Shape[]; code: Code; info: Info; escapes: DType[]; rounded: Set<Id>; shader?: true; int32?: true }

class Refused extends Error {}
// A closure of a function type, at `key`, gives several answers: lowering
// starts again with that type's closures taking the rest (C137c22). Only
// types that need it are transformed, as in Koka's and Effekt's selective
// CPS; the rest is Mercury's success continuation, as for definitions.
class NeedsSeveral extends Error { key: string; constructor(key: string) { super(`closures of ${key} give several answers`); this.key = key; } }
// A solve's answers, a List of opaque values (each one answer's binds),
// for JavaScript from the core IR (C137c11).
const ANSWERS: DType = { key: "answers", name: "List", def: LIST, cases: [{ variant: NIL, name: "nil", fields: [] }, { variant: CONS, name: "cons", fields: [{ name: "item", t: "host" }] }] };
ANSWERS.cases[1].fields.push({ name: "rest", t: ANSWERS });

// The largest budget: counts are kept in f32 on a GPU, whole up to 2^24.
export const MAX_FUEL = 2 ** 24;
const BUDGET = "first(() => with fuel(n, () => …), () => …)";
const MAY_NOT_FINISH = `may not finish (its type has Diverge): on a GPU that hangs the page, so run it under a budget, ${BUDGET}`;

// The definitions the roots reach, every type, and the builtins: what
// the scalar profile and compile (C67) stage and check again (C90).
// The same, and the Shown implementations `show any` shows through when
// what the roots reach shows a value (L205, C148). `own`: only those of
// types not in std (the scalar lowering shows std's own way).
export function reachedWithShows(code: Code, roots: Id[], info: Info, own = false): Code {
  const reached = reachedFrom(code, roots);
  const showns = [...shownImplementations(info)].flatMap(([t, d]) => (own && t.startsWith("std.") ? [] : [d]));
  const shows = showns.length && Object.values(reached.nodes).some((n) => n.kind === "ref" && n.target === SHOW_ANY);
  // And the Ordered implementations a compare orders through (L204h).
  const ordereds = [...implementationsOf(info, ORDERED)].flatMap(([t, d]) => (own && t.startsWith("std.") ? [] : [d]));
  const compares = ordereds.length && Object.values(reached.nodes).some((n) => n.kind === "ref" && n.target === COMPARE);
  return shows || compares ? reachedFrom(code, [...roots, ...(shows ? showns : []), ...(compares ? ordereds : [])]) : reached;
}
export function reachedFrom(code: Code, roots: Id[]): Code {
  const reach = new Set<Id>();
  for (const r of roots) { reach.add(r); for (const d of dependencies(code, r)) reach.add(d); }
  const isType = (d: Id) => { const n = code.nodes[d]; return n?.kind === "def" && !!n.body && code.nodes[n.body]?.kind === "typedef"; };
  const defs = code.defs.filter((d) => reach.has(d) || isType(d));
  if (defs.length === code.defs.length) return code;
  const nodes: Code["nodes"] = {};
  for (const [id, n] of Object.entries(code.nodes)) if (n.kind === "builtin") nodes[id] = n;
  for (const d of defs) for (const id of subtree(code, d)) nodes[id] = code.nodes[id];
  return { nodes, defs };
}


// `shader`: what a shader has without a heap (C66c). An Int is held in 32
// bits, and a result past them gives up as a budget running out does. A
// search with one answer or none, under `first` with a fallback or
// `count`, is a flag the printers keep (lab_none): `fail`, a quotient by
// 0 and the like set it, the code goes on with zeros, and the `first`
// looks at it when its search ends. Shaders have no side effects, so going
// on computes nothing anyone sees. The plain profile (no `data`, no
// shader) takes `first` with a fallback and `count` the same way since
// C166: inside the search's body, and in what it calls (lowered again for
// it), a partial builtin with no answer raises the flag instead of
// stopping, so raymarch's colour needs no budget around its trace.
// `hosted`: the program's own effects its host answers where nothing
// handles them (FOREIGN.md; for C, hosts/c.c, L69b1): their operations
// are performed, as compiled JavaScript's are.
export function lowerScalar(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean; data?: boolean; shader?: boolean; host?: boolean; hosted?: Set<Id>; releases?: boolean; handlers?: boolean; threads?: boolean; cells?: boolean } = {}): CoreIR {
  // The function types whose closures give several answers: found as
  // lowering meets one, and lowered again with them (C137c22). Only those
  // types' closures pay for taking the rest.
  const several = new Set<string>();
  for (;;) {
    try { return lowerOnce(code, info, names, roots, opts, several); } catch (e) {
      if (!(e instanceof NeedsSeveral) || several.has(e.key)) throw e;
      several.add(e.key);
    }
  }
}

function lowerOnce(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean; data?: boolean; shader?: boolean; host?: boolean; hosted?: Set<Id>; releases?: boolean; handlers?: boolean; threads?: boolean; cells?: boolean }, severalTypes: Set<string>): CoreIR {
  const outer = stopSite;
  try { return lowerOnceIn(code, info, names, roots, opts, severalTypes); } finally { stopSite = outer; }
}
function lowerOnceIn(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean; data?: boolean; shader?: boolean; host?: boolean; hosted?: Set<Id>; releases?: boolean; handlers?: boolean; threads?: boolean; cells?: boolean }, severalTypes: Set<string>): CoreIR {
  // Where each stop is lowered from (C143): the node being lowered, and
  // the sites met so far, one a node.
  let here: { node: Id; def: Id } | null = null;
  const sites: { node: Id; def: Id; name?: string }[] = [], siteAt = new Map<Id, number>();
  stopSite = () => {
    if (!here) return -1;
    let i = siteAt.get(here.node);
    if (i === undefined) { i = sites.push({ ...here, ...(names[here.def] ? { name: names[here.def] } : {}) }) - 1; siteAt.set(here.node, i); }
    return i;
  };
  const asGiven = info;
  // A use with no body, as the use that binds its ports (C161, uses.ts).
  ({ code, info } = withBodies(code, info, names));
  // Case and graphemes with no host to ask run the cases module (L214e5).
  if (!opts.host) ({ code, info, names } = tableText(code, info, names));
  // A named handler handles a copy of its effect of its own (L213b).
  ({ code, info, names } = unnameHandlers(code, info, names));
  // The generic + resolved to each type's own operation first
  // (ters/src/lang/arith.ts): nothing here sees a generic one.
  ({ code, info, names } = resolveArithmetic(code, info, names));
  // A function named by a let (the editor's "Make it a function": `part =
  // (a, b) ↦ …; part(x, y)`) is a definition of its own, given what it
  // uses from around it, since there are no closures here (lift-lets.ts,
  // C54).
  ({ code, info, names } = liftLets(code, info, names, true));
  // Only what the roots reach goes through firstArms, which checks the
  // program again (T14): the editor's shader picture checked the whole
  // library there. After the arithmetic is resolved, which reads
  // implementations and ways nothing names.
  code = reachedWithShows(code, roots, info);
  // The first answer of a search that can't fail once each choice takes
  // its first way is that way, as plain code (first-arms.ts, L72e1d):
  // json printed as json spelled's first, with no choice kept to go back to.
  ({ code, info, names } = firstArms(code, info, names));
  // Only what the roots reach is staged and checked again, as compile
  // does (C67): the editor's picture of the ray marcher, with its PGA
  // motor, was checked over the whole library each time (C90).
  code = reachedWithShows(code, roots, info);
  if (opts.data) opts = { ...opts, records: true };
  // Calls given data written down (an algebra's signature and basis) are
  // worked out as far as that data goes (stage.ts, C65): what's left is
  // arithmetic, with no lists. Kept only if the program still checks.
  // Definitions given such data get a copy for it (I86).
  // The roots are called from outside: every other definition's
  // multivector inputs are what its callers give it (grades.ts valueMasks,
  // L43c), so staging multiplies only their masked parts.
  const st = stageProgram(code, info, names, roots);
  ({ code, names, info } = st);
  // Then derivative(f) of a function written right there becomes the code
  // of its derivative (derive.ts), checked again, so the GPU gets exact
  // slopes as plain arithmetic. The partials it calls (∂scene/∂x …) are
  // definitions like any other. gradient(f) too, over the record f's type
  // says it takes. After staging, so a function that calls the clifford
  // functions with an algebra written down is arithmetic by then (C74: a
  // ray marcher's scene moved by a PGA motor; read before, its derivative
  // would be the clifford functions' generic folds again), and what the
  // derivatives made is staged in turn.
  const later = expandDerivatives(code, names, (call) => {
    const f = info.subst.zonk(info.typeOf.get((code.nodes[call] as Call).args[0]) ?? { t: "var", v: -1 });
    return f.t === "fn" && f.params[0]?.t === "con" ? recordVariant(code, f.params[0].id) : null;
  });
  if (later.expanded.length) {
    const checked = infer(later.code, later.names);
    if (checked.errors.length <= info.errors.length) {
      ({ code, names } = later);
      info = checked;
      const again = stageProgram(code, info, names, roots);
      ({ code, names, info } = again);
      st.rounded.push(...again.rounded);
    }
  }
  const rounded = new Set<Id>();
  const calls = new Set(st.rounded);
  if (calls.size) for (const d of code.defs) if (subtree(code, d).some((id) => calls.has(id))) rounded.add(d);
  // A list named first and then walked is put where it's walked, so the
  // fold over `characters` sees it (inline-lets.ts, C49).
  const lets = inlineLists(code, info);
  if (lets.inlined) {
    code = lets.code;
    info = infer(code, names);
  }
  // Each step above changes no answer, so what ended as given still ends.
  info = endsAsBefore(asGiven, info);
  // A generic definition (the vectors module's plus, for any record of
  // Float64s) is lowered once per set of types it's called at, the way a
  // C++ template or a Rust generic is: `at` is what its type variables
  // stand for in the one being lowered, and what its effect rows do (keep
  // with a test that may have no answer is a search itself).
  let at: At = new Map();
  const put = (t: Type, m: At): Type => {
    if (t.t === "var") { const x = m.get(t.v); return x && "t" in x ? x : t; }
    if (t.t === "con") return { ...t, args: t.args.map((a) => put(a, m)) };
    const x = t.eff.tail === null ? undefined : m.get(t.eff.tail);
    const eff = x && "effs" in x ? { effs: [...new Set([...t.eff.effs, ...x.effs])].sort(), tail: x.tail } : t.eff;
    return { ...t, params: t.params.map((p) => put(p, m)), ret: put(t.ret, m), eff };
  };
  const zonk = (id: Id): Type => put(info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 }), at);
  const nm = (id: Id) => names[id] ?? id;
  const records = new Map<string, RType>();
  // The type each record or data type was made from, for an implementation
  // with type parameters (L219) made at it (implementedAt).
  const sources = new Map<string, Type>();
  const datas = new Map<string, DType>();
  const fns = new Map<string, FType>();
  const arrays = new Map<string, AType>();
  const tables = new Map<string, TType>();
  const shapes: Shape[] = [];
  // Effects whose operations all never return (Abort's shape, LANGUAGE.md
  // "Effects you define"), by their operations: each compiles as Abort does
  // (C34), with status 2 + its number here (Abort's 0, the rest from 1)
  // and what it was given in the reason: Abort's reason, or the operation
  // as a value of the effect's own type (`escapes`, from 1).
  const opOf = new Map<Id, Id>();
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "def" || !n.body) continue;
    const td = code.nodes[n.body];
    if (td?.kind === "typedef" && td.effect && td.variants.every((v: Id) => { const x = code.nodes[v] as NodeOf<"variant">; return !x.returns && !x.later; })) td.variants.forEach((v: Id) => opOf.set(v, n.id));
  }
  // A program's own effects whose operations all return (C137, step 2 of
  // PROGRAM-EFFECTS-2026-11-03.md), for JavaScript from the core IR: a
  // handler of one, which fusion (handlers.ts) couldn't write into the
  // code it handles (Pig's `written into`, whose case writes a cell),
  // pushes its cases, and a perform calls the nearest (core-rt.ts
  // `perform:`), as the evaluator finds the nearest handler. Every case
  // answers in tail position here, since the operation's answer is the
  // case's value.
  // Console, Files and Network are declared in std too, without the
  // prefix (L55): one is the program's own only where the program has a
  // case for one of its operations; otherwise a perform of one by name
  // (board's `file exists`) is the builtin that performs it, the world's
  // (C137d19).
  const arms = new Set(Object.values(code.nodes).flatMap((n) => (n.kind === "arm" && n.variant ? [n.variant] : [])));
  const notOwn = (n: NodeOf<"def">, td: NodeOf<"typedef">) => n.id.startsWith("std.") || (BUILTIN_EFFECTS.includes(n.id) && !td.variants.some((v) => arms.has(v)));
  const builtinOf = new Map(Object.entries(OP_OF_BUILTIN).map(([b, v]) => [v, b]));
  const tailOps = new Map<Id, Id>(), answeredLater = laterOpsOf(code);
  // Without `host`, only the effects `hosted` names (C's hosts/c.c).
  // And the file `with open file` keeps open (L213c3), the library's.
  // With `handlers` (C, L213c4), the program's own too, on C's stack.
  for (const n of opts.host || opts.handlers ? Object.values(code.nodes) : [...opts.hosted ?? []].flatMap((e) => code.nodes[e] ?? [])) {
    if (n.kind !== "def" || !n.body || (n.id.startsWith("std.") ? !((opts.host || opts.handlers) && n.id === OPEN_FILE) : code.nodes[n.body]?.kind === "typedef" && notOwn(n, code.nodes[n.body] as NodeOf<"typedef">))) continue;
    const td = code.nodes[n.body];
    if (td?.kind === "typedef" && td.effect && td.variants.length && td.variants.every((v: Id) => { const x = code.nodes[v] as NodeOf<"variant">; return x.returns && !answeredLater.has(v); })) td.variants.forEach((v: Id) => tailOps.set(v, n.id));
  }
  // Random too, where the program handles it (Pig's `recorded into`): a
  // draw no handler of the program's answers is the world's, as before.
  // Not with `seeded` as well, whose draws aren't on that stack.
  const handlesRandom = !!opts.host && Object.values(code.nodes).some((n) => n.kind === "arm" && n.variant === RANDOM_OP);
  if (handlesRandom) tailOps.set(RANDOM_OP, RANDOM);
  // The person's settings too (L214b2), where the program answers them: an
  // ask no handler of the program's answers is the world's.
  if (opts.host && Object.values(code.nodes).some((n) => n.kind === "arm" && (n.variant === MY_LOCALE_OP || n.variant === MY_ZONE_OP))) { tailOps.set(MY_LOCALE_OP, SETTINGS); tailOps.set(MY_ZONE_OP, SETTINGS); }
  // Check too, where the program handles it (T7e2: `ters test --compiled`
  // runs a test under a handler of its expects).
  if (opts.host && Object.values(code.nodes).some((n) => n.kind === "arm" && n.variant === CHECK_OP)) tailOps.set(CHECK_OP, CHECK);
  // A program's own effect whose operations are answered later (step 3:
  // tumble's Animate, ANSWERED-LATER.md): its case is given the rest, so
  // the performer runs in continuation passing (several_), and a perform
  // hands the case the rest it was given (core-rt.ts `perform:`).
  const laterOps = new Map<Id, Id>();
  // C (C44b): the code a handler of one handles runs on a fiber of its
  // own, which a perform leaves and the rest goes back to.
  const fibers = !!opts.handlers && !opts.host;
  let parallel: Set<Id> | undefined, parallelList: Map<Id, ListJob> | undefined, foldsShared: Set<Id> | undefined, counts: Map<Id, "count" | "all" | "first"> | undefined;
  const countsShared = () => (counts ??= parallelCounts(code, info));
  // In C (C203), a count's, an all's or a first's search split.
  const splitsC = () => countsShared().size > 0;
  const splitting = new Set<Id>();
  // A call's inputs already worked out, as locals (a map that may be shared, C42).
  const given = new Map<Id, SExpr[]>();
  let mapSites = 0;
  for (const n of opts.host || fibers ? Object.values(code.nodes) : []) {
    if (n.kind !== "def" || !n.body || (code.nodes[n.body]?.kind === "typedef" && notOwn(n, code.nodes[n.body] as NodeOf<"typedef">)) || n.id.startsWith("std.")) continue;
    const td = code.nodes[n.body];
    if (td?.kind === "typedef" && td.effect && td.variants.length && td.variants.every((v: Id) => { const x = code.nodes[v] as NodeOf<"variant">; return x.returns && answeredLater.has(v); })) td.variants.forEach((v: Id) => laterOps.set(v, n.id));
  }
  // std's Await where the program handles it (start branch, under
  // together, race and within, C180): an await or a timer no handler of
  // the program's answers is the world's (core-rt.ts `perform:`).
  // Wait and Time too (the simulated clock's, C180): a case that answers
  // at once may await, so the performer goes on by the rest.
  const handledHere = (v: Id) => opts.host && Object.values(code.nodes).some((n) => n.kind === "arm" && n.variant === v);
  if (handledHere(AWAIT_OP) || handledHere(START_TIMER_OP)) { laterOps.set(AWAIT_OP, AWAIT); laterOps.set(START_TIMER_OP, AWAIT); }
  if (handledHere(WAIT_OP)) laterOps.set(WAIT_OP, WAIT);
  if (handledHere(NOW_OP)) laterOps.set(NOW_OP, TIME);
  const laterEffs = new Set(laterOps.values());
  const tailEffs = new Set([...tailOps.values(), ...laterEffs]);
  // The program's own effects C keeps on its handler stack (L213c4): not
  // a host's.
  const tailOwn = new Set(opts.handlers ? [...tailOps.values()].filter((e) => !opts.hosted?.has(e)) : []);
  let drawn = false;
  // Every effect's operations, for refusing what isn't lowered yet.
  const effectOps = new Set(Object.values(code.nodes).flatMap((n) => {
    const td = n.kind === "def" && n.body ? code.nodes[n.body] : null;
    return td?.kind === "typedef" && td.effect ? td.variants : [];
  }));
  const escaping = (e: Id) => e === ABORT || [...opOf.values()].includes(e);
  const escapes: Id[] = [];
  const escapeOf = (e: Id): number => (e === ABORT ? 0 : (escapes.includes(e) || escapes.push(e), escapes.indexOf(e) + 1));
  // What a partial function (`data`) may do besides answer: have no answer,
  // not finish (running out of a budget), or abort; and the world's effects.
  const partialEff = (e: Id) => e === CHOICE || e === DIVERGE || escaping(e) || (!!opts.cells && !opts.host && (e === VIEW_ROW || e === HANDLER_ROW || e === SOUND_ROW));
  // Random under a `seeded` (C106), or drawn from the world (C136).
  const allowedEff = (e: Id) => partialEff(e) || e === CONSOLE || e === FILES || (!!opts.data && e === RANDOM) || (!!opts.host && (PAGE_EFFECTS.has(e) || tailEffs.has(e) || e === KEPT_FILES)) || (!!opts.releases && e === LOG_EFFECT) || (!!opts.cells && (e === CELLS || e === UPDATE || PAGE_EFFECTS.has(e))) || (!!opts.handlers && (tailOwn.has(e) || e === KEPT_FILES || (!opts.host && (e === WAIT || e === AWAIT || e === TIME || laterEffs.has(e)))));
  // Some root draws a number nobody seeds (C136): the world seeds
  // Random's generator then, at the first draw.
  const worldRandom = !!opts.data && roots.some((r) => {
    const raw = info.typeOf.get(r) && info.subst.zonk(info.typeOf.get(r)!);
    return raw?.t === "fn" && info.subst.resolveRow(raw.eff).effs.includes(RANDOM);
  });
  const OTHER = opts.data ? "something other than Float64, Bool or data of them" : opts.records ? "something other than Float64, Bool or a record of them" : "something other than Float64 or Bool";

  // The profile's type for t, or null if t isn't in it.
  // The type variables of the root being lowered, which its callers give.
  let rootVars = new Set<number>();
  const unconstrained = (x: Type) => x.t === "var" && !rootVars.has(x.v);
  const freeInside = (x: Type): boolean => unconstrained(x) || (x.t === "con" && x.args.some(freeInside)) || (x.t === "fn" && (x.params.some(freeInside) || freeInside(x.ret)));
  const freed = (x: Type): Type => (unconstrained(x) ? { t: "con", id: NUMBER, args: [] } : x.t === "con" && x.args.some(freeInside) ? { ...x, args: x.args.map(freed) } : x.t === "fn" && freeInside(x) ? { ...x, params: x.params.map(freed), ret: freed(x.ret) } : x);
  function stype(t: Type, inside: Id[] = []): LType | null {
    if (t.t === "fn" && opts.data) {
      // A function that may not finish, have no answer or abort is fine
      // here (a partial one, giving a status); one with other effects isn't yet.
      const effs = info.subst.resolveRow(t.eff).effs;
      if (effs.some((e) => !allowedEff(e))) return null;
      const free = (x: Type): Type => (unconstrained(x) ? { t: "con", id: NUMBER, args: [] } : x);
      const params = t.params.map((p) => stype(free(p), inside)), result = stype(free(t.ret), inside);
      if (params.some((p) => !p) || !result) return null;
      const partial = effs.some(partialEff);
      const key = `fn(${(params as LType[]).map(keyOf).join(",")})>${keyOf(result)}${partial ? "!" : ""}`;
      // A type that may wait is one only once a closure of it does (a page
      // handler's row says Wait whether it waits or not, and so do the
      // functions its row reaches): its closures' code asks (NeedsSeveral).
      const chooses = effs.includes(CHOICE) && severalTypes.has(key), waits = !!opts.host && (effs.includes(WAIT) || effs.includes(AWAIT) || effs.some((e) => laterEffs.has(e))) && severalTypes.has(key);
      if (chooses || waits) {
        const sk = `${key}*`;
        if (!fns.has(sk)) fns.set(sk, { key: sk, params: [...params as LType[], kOf(result)], result: "i32", partial: true, several: true, answer: result, ...(chooses ? { chooses } : {}), ...(waits ? { waits } : {}) } as FType);
        return fns.get(sk)!;
      }
      if (!fns.has(key)) fns.set(key, { key, params: params as LType[], result, ...(partial ? { partial } : {}) });
      return fns.get(key)!;
    }
    if (opts.data && unconstrained(t)) return "f64";
    if (t.t !== "con") return null;
    // A type an operation keeps its own (Await's `a`, pinned where a case
    // takes it): its values only pass through the case, as the host's
    // (start branch's tickets, C180).
    if (opts.host && t.id.startsWith("pin.any.")) return "host";
    // A part nothing constrains (the items of `[]` nobody adds to, what a
    // function given to map over it takes, C101): no value of it is ever
    // made, so any type holds it; Float64's.
    // A root's own type variables stay what they are: its caller gives
    // values of them.
    // At any depth (List (Optional (List a)), sort's runs of nothing): the
    // type's key is made from its arguments as they are.
    if (opts.data && t.t === "con" && (t.id === TABLE || t.id === HASH_SET)) {
      // A key no put ever fixes (an empty map nothing is put in) is what
      // any type nothing makes is, a Float64, as its entries' keys are.
      const set = t.id === HASH_SET, free = !t.args[0] || unconstrained(t.args[0]);
      const k = free ? "f64" : stype(t.args[0], inside), value = set ? "i32" : t.args[1] && stype(freed(t.args[1]), inside);
      // A tuple or record of Ints and Texts too (C63k), as JavaScript's.
      const hashable = (x: LType | null): boolean => x === "int" || x === "text" || (!!x && isRecord(x) && !x.mutable && x.fields.length > 0 && x.fields.every((f) => hashable(f.t)));
      if (!(free || hashable(k)) || !value) return null;
      const key = `${t.id}<${typeof k === "string" ? k : (k as RType).key}${set ? "" : `,${show(freed(t.args[1]))}`}>`;
      if (tables.has(key)) return tables.get(key)!;
      const h: TType = { key, name: set ? "HashSet" : "Table", keyT: k as TType["keyT"], value, index: tables.size, entries: [], set };
      tables.set(key, h);
      return h;
    }
    if (opts.data && t.args.some(freeInside)) t = { ...t, args: t.args.map(freed) };
    if (t.id === NUMBER) return "f64";
    if (t.id === BOOL) return "i32";
    if (opts.data && t.id === INT) return "int";
    // Int held in 32 bits wherever Int isn't the heap's (C66c in shaders;
    // C163 in the plain profile: JavaScript, WebAssembly and C for pictures).
    if (!opts.data && t.id === INT) return "int32";
    if (opts.data && t.id === STRING) return "text";
    // A cell or a place in one (C137c8): the evaluator's value, opaque here.
    if (opts.host && (t.id === CELL || t.id === PATH_T)) return "host";
    // A cell in C (C199a, NATIVE-APPS.md): a box holding what gives its
    // value, a closure of nothing: one that gives what was written, or the
    // formula.
    if (opts.cells && t.id === CELL) { const a = t.args[0] && stype(t.args[0], inside); return a ? cellBox(a) : null; }
    if ((opts.data || opts.shader) && t.id === ARRAY) {
      const key = `${t.id}<${t.args.map(show).join(",")}>`;
      if (arrays.has(key)) return arrays.get(key)!;
      const item = t.args[0] && stype(t.args[0], inside);
      if (!item) return null;
      const a: AType = { key, name: "Array", item, index: arrays.size, list: null };
      arrays.set(key, a);
      return a;
    }
    if (!opts.records) return null;
    const key = `${t.id}<${t.args.map(show).join(",")}>`;
    if (!sources.has(key)) sources.set(key, t);
    if (records.has(key)) return records.get(key)!;
    if (datas.has(key)) return datas.get(key)!;
    // A type inside itself at other arguments (List (List Tree)) is
    // another type; one that grows each level (non-regular) never ends.
    if (inside.filter((x) => x === t.id).length >= 8) return null;
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || (td.effect && !(opts.data && escaping(t.id) && t.id !== ABORT))) return null;
    const self = (v: Id) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => mentions((code.nodes[f] as NodeOf<"field">).type, t.id));
    const many = td.variants.length !== 1 || self(td.variants[0]) || !!td.effect;
    if (many && !opts.data) return null;
    // The fields' types, with the type's parameters replaced by t's arguments.
    const args = new Map(td.params.map((p, i) => [p, t.args[i]] as const));
    const te = (tid: Id): Type | null => {
      const n = code.nodes[tid];
      // A field holding a function (C126), with the effects it names.
      if (n?.kind === "tfun") {
        const ps = n.params.map(te), ret = te(n.result);
        // The type's row parameter (L149) is the row its argument carries
        // (the steps of an effect's rests, L229c).
        const effs = (n.effects ?? []).flatMap((x) => { const a = args.get(x), r = a && info.subst.resolve(a); return r && r.t === "fn" ? info.subst.resolveRow(r.eff).effs : [x]; });
        return ps.every((x) => x) && ret ? { t: "fn", params: ps as Type[], ret, eff: { effs, tail: null } } : null;
      }
      if (n?.kind !== "tref") return null;
      if (args.has(n.target)) return args.get(n.target)!;
      const xs = n.args.map(te);
      return xs.every((x) => x) ? { t: "con", id: n.target, args: xs as Type[] } : null;
    };
    const fieldsOf = (v: Id): RType["fields"] | null => {
      const fields: RType["fields"] = [];
      for (const f of (code.nodes[v] as NodeOf<"variant">).fields) {
        const ft = te((code.nodes[f] as NodeOf<"field">).type);
        const lt = ft && stype(info.subst.zonk(ft), [...inside, t.id]);
        if (!lt) return null;
        fields.push({ name: nm(f), t: lt });
      }
      return fields;
    };
    if (many) {
      // Registered first, so a field of the type itself finds it.
      const d: DType = { key, name: nm(t.id), def: t.id, cases: [] };
      const had = new Set([...datas.keys(), ...records.keys()]);
      datas.set(key, d);
      for (const v of td.variants) {
        const fields = fieldsOf(v);
        if (!fields) {
          // Not in the profile, nor is anything made since that holds it.
          for (const k of [...datas.keys(), ...records.keys()]) if (!had.has(k)) { datas.delete(k); records.delete(k); }
          return null;
        }
        d.cases.push({ variant: v, name: nm(v), fields });
      }
      return d;
    }
    const fields = fieldsOf(td.variants[0]);
    if (!fields || (!fields.length && !opts.data)) return null;
    const r: RType = { key, name: nm(t.id), def: t.id, variant: td.variants[0], case: nm(td.variants[0]), fields };
    records.set(key, r);
    return r;
  }
  // Why t isn't in the profile, when records are: the first reason found.
  function whyNot(t: Type, inside: Id[] = []): string {
    if (t.t === "fn") {
      if (!opts.data) return "a function (that needs closures)";
      const bad = [...t.params, t.ret].find((p) => !stype(p, inside));
      return bad ? `a function of ${whyNot(bad, inside)}` : `a function with effects (${info.subst.resolveRow(t.eff).effs.filter((e) => e !== DIVERGE).map(nm).join(", ")})`;
    }
    if (t.t === "var") return "a value of any type";
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.effect) return nm(t.id);
    if (opts.data) {
      const arg = t.args.find((a) => !stype(a));
      return arg ? `${nm(t.id)} of ${whyNot(arg, [...inside, t.id])}` : `${nm(t.id)}, which has a field that isn't a Float64, Bool or data of them`;
    }
    if (inside.includes(t.id)) return `${nm(t.id)}, which contains itself (that needs a heap)`;
    if (td.variants.length !== 1) return `${nm(t.id)}, which has ${td.variants.length} cases (only one-case records fit)`;
    const ft = (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.map((f) => code.nodes[(code.nodes[f] as NodeOf<"field">).type]);
    if (ft.some((n) => n?.kind === "tref" && (n.target === t.id || inside.includes(n.target)))) return `${nm(t.id)}, which contains itself (that needs a heap)`;
    return `${nm(t.id)}, which has a field that isn't a Float64, Bool or record`;
  }
  // Whether a type written in the program mentions `target`.
  const mentions = (tid: Id, target: Id): boolean => {
    const n = code.nodes[tid];
    return n?.kind === "tref" && (n.target === target || n.args.some((a) => mentions(a, target)));
  };
  const vars = (t: Type): number[] => (t.t === "var" ? [t.v] : t.t === "con" ? t.args.flatMap(vars) : [...t.params.flatMap(vars), ...vars(t.ret), ...(t.eff.tail === null ? [] : [t.eff.tail])]);
  const keyOf = (t: LType): string => (typeof t === "string" ? t : t.key);
  // A type's key; a function's says whether it may have no answer, as its
  // lowered type does (I152: a list of functions that choose and one of
  // functions that don't were one type, holding either).
  const show = (t: Type): string => (t.t === "con" ? `${t.id}<${t.args.map(show).join(",")}>` : t.t === "var" ? `?${t.v}` : `fn(${t.params.map(show).join(",")})>${show(t.ret)}${opts.data && info.subst.resolveRow(t.eff).effs.some(partialEff) ? "!" : ""}`);

  const funcs: SFunc[] = [];
  const index = new Map<Id, number>();
  // Relational solves written out (modeSolve).
  let modeAn: ReturnType<typeof analyzer> | null = null;
  // While a mode function is written, the nodes whose slots hold a value
  // are read from their locals (expr at the top), so a call whose inputs
  // are known runs forward as any call does.
  let pinned: ((id: Id) => SExpr | undefined) | null = null;
  // A mode function giving all its answers (modeFn's `all`): the local
  // holding the answers found after the arm being written, in order.
  const collecting = new Map<SFunc, number>();
  const modeOrder = (ps: string[]) => [...ps].sort((a, b) => (a === "out" ? 1 : b === "out" ? -1 : Number(a) - Number(b)));
  class ModeUnsupported extends Error {}
  const refused = new Map<Id, string>();
  const showns = shownImplementations(info), ordereds = implementationsOf(info, ORDERED);
  const inProgress = new Set<Id>();
  // Whether what's being lowered runs under a budget, so a call to
  // something that might not finish is allowed: inside a budget's body, or
  // inside a definition that itself may only be called under one.
  let underBudget = false;
  // Lowering inside a search's body in the plain profile (C166): there a
  // partial builtin with no answer raises the flag `first` and `count`
  // read, as in a shader, rather than stopping. What such a body calls is
  // lowered again for it (its key ends `|trying`), so the same definition
  // called outside any search still stops.
  let trying = false;
  const diverges = (t: Type | undefined) => !!t && t.t === "fn" && info.subst.resolveRow(t.eff).effs.includes(DIVERGE);

  // A definition's type as its lambda is written. A definition with results
  // (L128) has the type of its forward reading (polar from x and y to its
  // length and angle), while its lambda takes every port and gives the
  // condition on them, which is what a call given all its ports runs
  // (L128d2, infer.ts asPredicate): that is the function lowered here;
  // a use read another way goes through results.ts.
  function defType(def: Id): Type | undefined {
    const t = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
    const d = code.nodes[def], lam = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
    const ports = portsOf(code.nodes, def);
    if (t?.t !== "fn" || !ports?.condition || lam?.kind !== "lambda" || lam.params.length === t.params.length) return t;
    const rs = ports.results, ins = ports.inputs;
    const outs = rs.length === 1 ? [t.ret] : t.ret.t === "con" && t.ret.id === tupleType(rs.length) ? t.ret.args : null;
    if (!outs || ins.length !== t.params.length) return t;
    return { t: "fn", params: lam.params.map((p) => (rs.includes(p) ? outs[rs.indexOf(p)] : t.params[ins.indexOf(p)])), ret: { t: "con", id: BOOL, args: [] }, eff: t.eff };
  }

  // The function index for `def` at these types, lowering it (and what it
  // calls) first.
  function func(def: Id, types: At = new Map()): number {
    // A definition that names another (`twice = double`, I150) is that one,
    // at the types it has here.
    const named = code.nodes[def]?.kind === "def" && (code.nodes[def] as NodeOf<"def">).body ? code.nodes[(code.nodes[def] as NodeOf<"def">).body!] : undefined;
    if (named?.kind === "ref" && named.target !== def && code.nodes[named.target]?.kind === "def") {
      const here = defType(def), there = defType(named.target), at: At = new Map();
      if (here && there) bindVars(there, put(here, types), at);
      return func(named.target, at);
    }
    const raw = defType(def);
    const t = raw && put(raw, types);
    if (!opts.data && !underBudget && diverges(t)) throw new Refused(`calls ${nm(def)}, which ${MAY_NOT_FINISH}`);
    const used = raw ? [...new Set(vars(raw))].filter((v) => types.has(v)).sort((a, b) => a - b) : [];
    const bound = (x: Type | Row) => ("t" in x ? show(x) : `{${x.effs.join(",")}}`);
    const key = (used.length ? `${def}|${used.map((v) => `${v}=${bound(types.get(v)!)}`).join(",")}` : def) + (trying ? "|trying" : "");
    if (index.has(key)) return index.get(key)!;
    if (refused.has(key)) throw new Refused(`calls ${nm(def)}, which ${refused.get(key)}`);
    const d = code.nodes[def] as NodeOf<"def">;
    const lam = d?.body ? code.nodes[d.body] : null;
    const fail = (why: string): never => { refused.set(key, why); throw new Refused(`calls ${nm(def)}, which ${why}`); };
    // A constant (`data`): a function of no inputs, computed where it's used.
    const constant = (!!opts.data || (!!opts.shader && !!t && t.t === "con" && t.id === ARRAY)) && !!t && t.t !== "fn" && !!lam && !["lambda", "typedef", "builtin"].includes(lam.kind);
    if (!constant && (!t || t.t !== "fn" || lam?.kind !== "lambda")) fail("is not a function written in the program");
    const ft = (constant ? { t: "fn", params: [], ret: t, eff: null } : t) as Extract<Type, { t: "fn" }>;
    // A relation whose type is one of its readings (L130: polar read from
    // x and y to its length and angle) has fewer inputs in its type than its
    // lambda has ports: its body would read ports that aren't there (C146).
    if (!constant && lam?.kind === "lambda" && lam.params.length !== ft.params.length) fail(`is a relation whose type is one reading of it (${ft.params.length} of its ${lam.params.length} ports in), not lowered yet`);
    // An input that can be anything is one the body never looks at (∂f/∂x
    // of a function that has an input the slope doesn't depend on, say).
    // It's taken as a Float64, and calls must pass one.
    const free = new Set(vars(ft.ret));
    const params = ft.params.map((p) => (p.t === "var" && !free.has(p.v) ? "f64" : stype(p))), result = stype(ft.ret);
    if (params.some((p) => !p) || !result) {
      const bad = [...ft.params, ft.ret][[...params, result].findIndex((x) => !x)];
      fail(opts.records ? `takes or gives ${whyNot(info.subst.zonk(bad))}` : `takes or gives ${OTHER}`);
    }
    // With `data`, a search with one answer or none (no `one of`, which
    // is refused where it's used) is a partial function, and so is one
    // that spends from a budget: running out is having no answer there,
    // which the nearest handler sees, as in the evaluator.
    const all = constant ? [] : info.subst.resolveRow(ft.eff).effs;
    // A host's operation may fail, with its reason (L69b1, L69b2): a
    // function that performs one is partial, as one that aborts is.
    const partial = (!!opts.data && (all.includes(CHOICE) || all.some(escaping) || all.some((e) => !!opts.hosted?.has(e)) || (!constant && info.divergent.has(def)))) || (!!opts.shader && all.includes(CHOICE));
    // Without `data` or `shader`, a Choice is let through: one from a
    // partial builtin (x / 0, the square root of a negative; L125b) is
    // lowered as its arithmetic, so no answer isn't seen here yet (L125c2,
    // L125c3); a Choice of the program's own (fail, one of) is refused
    // where it's used.
    const effs = all.filter((e) => !BUDGETED.includes(e) && !(partial && partialEff(e)) && !(opts.data && (e === CONSOLE || e === FILES || e === RANDOM)) && !(opts.host && (PAGE_EFFECTS.has(e) || tailEffs.has(e) || e === KEPT_FILES)) && !(opts.releases && e === LOG_EFFECT) && !(opts.cells && (e === CELLS || e === UPDATE || PAGE_EFFECTS.has(e))) && !(opts.handlers && (tailOwn.has(e) || e === KEPT_FILES || (!opts.host && (e === WAIT || e === AWAIT || e === TIME || (laterEffs.has(e) && !roots.includes(def)))))) && !(opts.hosted?.has(e) && tailEffs.has(e)) && !(e === CHOICE && !opts.data && !opts.shader));
    if (effs.length) fail(`has effects (${effs.map(nm).join(", ")})`);
    const budgeted = !constant && !opts.data && diverges(ft);

    // Reserve the index now, so recursion finds it.
    const i = funcs.length;
    index.set(key, i);
    inProgress.add(def);
    const f: SFunc = { def, name: nm(def), params: params as LType[], result: result!, locals: [...params as LType[]], body: { k: "num", v: 0 }, spends: info.divergent.has(def), budgeted, ...(partial ? { partial } : {}), ...(constant ? { value: true as const } : {}) };
    funcs.push(f);
    const outer = underBudget, outerAt = at, shaped = shapes.length;
    try {
      const l = lam as NodeOf<"lambda">;
      const env = new Map(constant ? [] : l.params.map((p, j) => [p, j]));
      underBudget = budgeted;
      // The body's own type variables can differ from the definition's
      // (a library definition is a copy of its module's): what they are
      // here, from the body's type against the one being lowered.
      at = new Map(types);
      const bt = info.typeOf.get(d.body!) && info.subst.zonk(info.typeOf.get(d.body!)!);
      if (bt && t) bindVars(bt, t, at);
      f.body = expr(constant ? d.body! : l.body, env, f, true);
    } catch (e) {
      underBudget = outer;
      at = outerAt;
      // Undo: this definition and anything lowered after it.
      funcs.splice(i);
      shapes.splice(shaped);
      for (const [d2, j] of index) if (j >= i) index.delete(d2);
      // Closures' code with it (it was left behind, C137c22).
      for (const j of closureCode) if (j >= i) closureCode.delete(j);
      inProgress.delete(def);
      if (e instanceof Refused) { refused.set(key, e.message); throw new Refused(`calls ${nm(def)}, which ${e.message}`); }
      throw e;
    }
    underBudget = outer;
    at = outerAt;
    inProgress.delete(def);
    return i;
  }

  function expr(id: Id, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    if (pinned) { const v = pinned(id); if (v) return v; }
    const was = here;
    here = { node: id, def: f.def };
    try { return exprAt(id, env, f, tail); } finally { here = was; }
  }
  function exprAt(id: Id, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": {
        const t = stype(zonk(id));
        if (t === "int") return { k: "int", v: BigInt(n.value) };
        if (t === "int32") {
          const v = BigInt(n.value);
          if (v < -(2n ** 31n) || v >= 2n ** 31n) throw new Refused(`uses ${v}, which is past 32 bits (an Int in a shader is held in 32)`);
          return { k: "int", v };
        }
        if (t === "text" && typeof n.value === "string") return { k: "text", v: n.value };
        if (typeof n.value !== "number" || t !== "f64") throw new Refused(opts.data ? "uses a value that isn't a Float64, Int or Text" : "uses a value that isn't a Float64");
        return { k: "num", v: n.value };
      }
      case "ref": {
        if (n.target === TRUE || n.target === FALSE) return { k: "bool", v: n.target === TRUE };
        // Which binder a local holds, for the map (C143d): noted where it's read.
        if (env.has(n.target)) { const i = env.get(n.target)!; (f.binders ??= [])[i] = n.target; return { k: "local", i }; }
        const later = inlined.get(n.target);
        if (later) return { ...later, tail };
        // A case with no fields (empty, nothing) written alone.
        if (opts.data && code.nodes[n.target]?.kind === "variant") return build(n.target, zonk(id), []);
        // A constant array in a shader (C66c): a function of no inputs.
        if (opts.shader && !opts.data && code.nodes[n.target]?.kind === "def") {
          const t = stype(zonk(id));
          if (t && isArray(t)) return { k: "call", fn: func(n.target, new Map()), args: [], tail };
        }
        if (opts.data && code.nodes[n.target]?.kind === "def") {
          const t = stype(zonk(id));
          if (t && isFn(t)) return named(n.target, id, t);
          // A constant of a type with variables (empty map) is made at the
          // type it has here.
          const types: At = new Map(), ct = info.typeOf.get(n.target) && info.subst.zonk(info.typeOf.get(n.target)!);
          if (ct) bindVars(ct, zonk(id), types);
          return { k: "call", fn: func(n.target, types), args: [], tail };
        }
        if (opts.host && (STD_IMPL[n.target] || STD_MANY[n.target])) {
          const t = stype(zonk(id));
          if (t && isFn(t)) return builtinValue(n.target, t);
        }
        throw new Refused(`uses ${nm(n.target)} as a value (functions and data need a heap)`);
      }
      case "call": {
        if (isUse(n)) {
          if (!opts.host) return writtenSolve(n, env, f, tail);
          return solveUse(n, env, f, tail);
        }
        const head = code.nodes[n.fn];
        if (head.kind === "lambda") {
          // A let: each argument goes into a new local.
          if (head.params.length !== n.args.length) throw new Refused("applies a function to the wrong number of inputs");
          let inner = new Map(env);
          const lets: { i: number; value: SExpr }[] = [];
          head.params.forEach((p, j) => {
            const t = stype(zonk(p));
            if (!t) throw new Refused(`lets ${nm(p)} be ${OTHER}`);
            const value = expr(n.args[j], env, f, false);
            const i = f.locals.push(t) - 1;
            inner = new Map(inner).set(p, i);
            lets.push({ i, value });
          });
          return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(head.body, inner, f, tail));
        }
        // A function computed or passed in: called through its closure.
        if (opts.data && (head.kind !== "ref" || env.has(head.target) || inlined.has(head.target) || (code.nodes[head.target]?.kind === "def" && (code.nodes[(code.nodes[head.target] as NodeOf<"def">).body ?? ""]?.kind !== "lambda")))) {
          const t = stype(zonk(n.fn));
          if (!t || !isFn(t)) throw new Refused(`calls a function of ${whyNot(zonk(n.fn))}`);
          return { k: "apply", fn: expr(n.fn, env, f, false), t, args: n.args.map((a) => expr(a, env, f, false)), tail, tmp: f.locals.push(t) - 1 };
        }
        if (head.kind !== "ref") throw new Refused("calls a computed function (that needs closures)");
        const args = () => given.get(n.id) ?? n.args.map((a) => expr(a, env, f, false));
        const target = (!tailOps.has(head.target) && !laterOps.has(head.target) && builtinOf.get(head.target)) || head.target;
        if (target === S.equal) {
          const t = stype(zonk(n.args[0]));
          if (!t || (typeof t !== "string" && !opts.data)) throw new Refused("compares values that aren't Float64s or Bools");
          const [x, y] = args();
          // Each checked once, named, so equal's rule reads locals (L125c2).
          if (t === "f64" && !opts.shader) return held(f, fin(f, x), (lx: SExpr) => held(f, fin(f, y), (ly: SExpr) => same(lx, ly, t, f, tail)));
          return same(x, y, t, f, tail);
        }
        if (opts.data && target === COMPARE) {
          // compare (run.ts compareValues) as −1, 0 or 1 from the type's
          // own order, then the Order case.
          const t = stype(zonk(n.args[0])), o = stype(zonk(id));
          if (!t || !o || !isData(o)) throw new Refused(`compares ${whyNot(zonk(n.args[0]))}`);
          const [x, y] = args().map((a) => (t === "f64" ? fin(f, a) : a)), [lx, ly] = [f.locals.push(t) - 1, f.locals.push(t) - 1], c = f.locals.push("f64") - 1, at: SExpr = { k: "local", i: c };
          const order = (v: Id): SExpr => build(v, zonk(id), []);
          const num = (v: number): SExpr => ({ k: "num", v });
          return { k: "let", i: lx, value: x, body: { k: "let", i: ly, value: y, body: { k: "let", i: c, value: compared({ k: "local", i: lx }, { k: "local", i: ly }, t, f, false), body: { k: "if", cond: { k: "op", op: "less", args: [at, num(0)] }, then: order(ORDER_V.before), else: { k: "if", cond: { k: "op", op: "equal", args: [at, num(0)] }, then: order(ORDER_V.same), else: order(ORDER_V.after), t: o }, t: o } } } };
        }
        if (opts.data && target === SHOW_ANY) {
          // show as the evaluator gives it (run.ts showValue, a number as
          // the number it stands for), from a function of its own per type.
          const t = stype(zonk(n.args[0]));
          if (!t) throw new Refused(`shows ${whyNot(zonk(n.args[0]))}`);
          const [x] = args();
          return shown(t === "f64" ? fin(f, x) : x, t, f, tail);
        }
        if (opts.data && target === CASE_NAME) {
          // case name (L162, C99): show's walk stopped at the tag, the
          // case's name as a text constant (run.ts caseName); a value made
          // by no case (a number, a text, an array, a function) gives "".
          const t = stype(zonk(n.args[0]));
          if (!t) throw new Refused(`names the case of ${whyNot(zonk(n.args[0]))}`);
          const [x] = args(), text = (v: string): SExpr => ({ k: "text", v }), s = f.locals.push(t) - 1;
          if (t === "i32") return { k: "if", cond: x, then: text(nm(TRUE)), else: text(nm(FALSE)), t: "text" };
          if (isData(t)) return { k: "case", scrut: x, s, t, result: "text", arms: t.cases.map((c) => text(nm(c.variant))) };
          return { k: "let", i: s, value: x, body: text(isRecord(t) ? nm(t.variant) : "") };
        }
        if (opts.data && target === INT_OPS.lowestTerms) {
          // int.ts's lowest terms from the runtime's gcd and exact division:
          // both over their gcd, both negated if the bottom is below 0.
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          const [a, b] = args(), at = (i: number): SExpr => ({ k: "local", i }), rt = (fn: string, ...xs: SExpr[]): SExpr => ({ k: "rt", fn, args: xs });
          const [x, y, g, p, q] = [0, 0, 0, 0, 0].map(() => f.locals.push("int") - 1);
          const both = (u: SExpr, v: SExpr) => build(PAIR_V, zonk(id), [u, v]);
          const lets: [number, SExpr][] = [[x, a], [y, b], [g, rt("int.gcd", at(x), at(y))], [p, rt("int.exact", at(x), at(g))], [q, rt("int.exact", at(y), at(g))]];
          const body: SExpr = { k: "if", cond: rt("int.less", at(y), { k: "int", v: 0n }), then: both(rt("int.neg", at(p)), rt("int.neg", at(q))), else: both(at(p), at(q)), t };
          return lets.reduceRight<SExpr>((e, [i, value]) => ({ k: "let", i, value, body: e }), body);
        }
        if (opts.shader && !opts.data && ARRAY_RT[target]) {
          // A shader's array has its size where it's made (C66c): from a
          // list written out, empty, or a push. Its items go in as the
          // job's inputs; there is no List to make or read.
          const at = target === ARRAY_OPS.of || target === ARRAY_OPS.empty || target === ARRAY_OPS.push ? id : n.args[0], a = stype(zonk(at));
          if (!a || !isArray(a)) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(at))}`);
          if (target === ARRAY_OPS.items) throw new Refused("takes an array's items as a List (a shader has no lists)");
          // The two ends (C30d) at fixed sizes (C66): the first item is
          // item 0, no answer when empty; the rest is one shorter (the empty
          // array's is itself), a push at the front one longer.
          if (target === ARRAY_OPS.first) return { k: "rt", fn: `${ARRAY_RT[ARRAY_OPS.at]}.a${a.index}`, args: [...args(), { k: "int", v: 0n }] };
          if (target !== ARRAY_OPS.of) return { k: "rt", fn: `${ARRAY_RT[target]}.a${a.index}`, args: args() };
          const items: Id[] = [];
          let l = code.nodes[n.args[0]];
          // Written as one `list of` (L181), or as conses onto nil.
          if (isCall(l) && code.nodes[l.fn]?.kind === "ref" && (code.nodes[l.fn] as NodeOf<"ref">).target === S.listOf) return { k: "rt", fn: `${ARRAY_RT[target]}.a${a.index}`, args: l.args.map((x) => expr(x, env, f, false)) };
          for (; isCall(l) && code.nodes[l.fn]?.kind === "ref" && (code.nodes[l.fn] as NodeOf<"ref">).target === CONS; l = code.nodes[l.args[1]]) items.push(l.args[0]);
          if (!(l?.kind === "ref" && l.target === NIL)) throw new Refused("makes an array of a list that isn't written out (a shader's array has its size where it's made)");
          return { k: "rt", fn: `${ARRAY_RT[target]}.a${a.index}`, args: items.map((x) => expr(x, env, f, false)) };
        }
        if (opts.data && target === ARRAY_OPS.firstIfAny) {
          // `array of List`'s match (C30d3c): the first item as an Optional,
          // which is `optional` of array first, whose empty array is no
          // answer.
          const a = stype(zonk(n.args[0])), t = stype(zonk(id));
          if (!a || !isArray(a) || !t || !isData(t)) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(n.args[0]))}`);
          const item = a.item;
          return { k: "search", kind: "optional", body: { k: "rt", fn: `array.first.a${a.index}`, args: args() }, res: f.locals.push(item) - 1, t, bt: item };
        }
        if (opts.data && target === ARRAY_OPS.front) {
          // The first item and the rest at once (C137 s3e): `optional` of
          // the pair of array first and array rest, none of an empty array.
          const a = stype(zonk(n.args[0])), t = stype(zonk(id));
          if (!a || !isArray(a) || !t || !isData(t)) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(n.args[0]))}`);
          const pair = t.cases.find((c) => c.fields.length)!.fields[0].t;
          const arr = f.locals.push(a) - 1, at: SExpr = { k: "local", i: arr };
          return {
            k: "let", i: arr, value: args()[0],
            body: { k: "search", kind: "optional", body: { k: "make", t: pair as RType, args: [{ k: "rt", fn: `array.first.a${a.index}`, args: [at] }, { k: "rt", fn: `array.rest.a${a.index}`, args: [at] }] }, res: f.locals.push(pair) - 1, t, bt: pair },
          };
        }
        if (opts.data && (ARRAY_RT[target] || target === ARRAY_OPS.replaceAt)) {
          // The array's type, from the argument or the answer that is one;
          // List of its items too where the job takes or gives a list.
          const ts = [...n.args, id].map((a) => { const t = stype(zonk(a)); if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(a))}`); return t; });
          const a = ts.find(isArray);
          if (!a) throw new Refused(`uses ${nm(target)} on no array`);
          const l = ts.find(isData);
          if (l) a.list = l;
          return { k: "rt", fn: `${ARRAY_RT[target] ?? "array.replaceAt"}.a${a.index}`, args: args() };
        }
        if (opts.data && TABLE_RT[target]) {
          // The table's type, from the argument or the answer that is one;
          // the list of its entries where the job gives one.
          const ts = [...n.args, id].map((a) => { const t = stype(zonk(a)); if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(a))}`); return t; });
          const h = ts.find(isTable);
          if (!h) throw new Refused(`uses ${nm(target)} on no table`);
          const l = target === TABLE_OPS.entries || target === HASH_SET_OPS.items ? ts.find(isData) : undefined;
          if (l && !h.entries.includes(l)) h.entries.push(l);
          return { k: "rt", fn: `table.${TABLE_RT[target]}.t${h.index}${l ? `.e${h.entries.indexOf(l)}` : ""}`, args: target === HASH_SET_OPS.add ? [...args(), { k: "bool", v: true }] : args() };
        }
        // A zone's offset at an instant (L188): the host's zone database,
        // asked through the world (C's TZ rules, the JavaScript host's
        // Intl for WebAssembly), NaN for a zone it doesn't know, which is
        // no answer here.
        if (opts.data && target === ZONE_OPS.offset && n.args.length === 2) {
          const it = stype(zonk(n.args[1]));
          if (!it || typeof it !== "object" || !(isRecord(it) || isData(it))) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(n.args[1]))}`);
          const at = expr(n.args[1], env, f, false);
          const seconds: SExpr = isRecord(it) ? { k: "get", rec: at, t: it, i: 0 } : { k: "field", rec: at, t: it, c: 0, i: 0 };
          const i = f.locals.push("f64") - 1, x: SExpr = { k: "local", i };
          return { k: "let", i, value: { k: "world", op: "zoneOffset", aborts: false, args: [expr(n.args[0], env, f, false), seconds], t: "f64", ins: ["text", "f64"] },
            body: { k: "if", cond: { k: "op", op: "equal", args: [x, x] }, then: x, else: { k: "fail" }, t: "f64" } };
        }
        if (opts.data && RT[target]) {
          // What it takes and gives in, so List Text is one of the module's types.
          for (const a of [...n.args, id]) if (!stype(zonk(a))) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(a))}`);
          return { k: "rt", fn: RT[target], args: RT_LATE.has(RT[target]) ? args().map((a, i) => (stype(zonk(n.args[i])) === "f64" ? fin(f, a) : a)) : args() };
        }
        if (!opts.data && INT32[target]) return { k: "op", op: INT32[target], args: args() };
        // A partial function's x / 0 has no answer there (L125b), unless the
        // checker found this call always answered: then it can only stop.
        // Inside a search's body too: there the search gives the no answer
        // (optional's none, first's fallback).
        if (scalarOp(target)) { const e = { k: "op" as const, op: scalarOp(target)!, args: args() }; return opts.shader ? e : checked(f, e, trying ? "flag" : !!opts.data && (!!f.partial || !!searching.get(f)) && !info.answered?.has(id)); }
        if (target === S.mapParts || target === S.zipParts || target === S.total) return parts(n, env, f);
        if (target === S.fail && opts.data) return { k: "fail" };
        if (target === S.fail && opts.shader) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`fails as ${whyNot(zonk(id))}`);
          return { k: "zero", t, none: true };
        }
        if (!opts.data && (target === S.first || target === S.count) && !isBudget(n)) return flagged(n, id, env, f);
        // A stop with a reason (L51c, SPEC §8.4) ends the program, as an
        // overflow does: no handler gets it. The world says why; what it
        // gives is never used, so the call's value is a zero of its type.
        if (target === S.stop && opts.data && n.args.length === 1) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`stops as ${whyNot(zonk(id))}`);
          const i = f.locals.push("f64") - 1;
          return { k: "let", i, value: { k: "world", op: "stopWith", aborts: false, args: [expr(n.args[0], env, f, false)], t: "f64" }, body: { k: "zero", t } };
        }
        if (target === S.stop) throw new Refused("stops with a reason, which needs the heap's text (a shader can't stop)");
        if (target === ABORT_OP && opts.data && n.args.length === 1) return { k: "abort", reason: expr(n.args[0], env, f, false) };
        if (opts.data && opOf.has(target)) {
          const e = opOf.get(target)!;
          return { k: "abort", reason: build(target, { t: "con", id: e, args: [] }, args()), esc: escapeOf(e) };
        }
        // together and race in C (C44): each action on a fiber of its own,
        // which an await parks till its ticket is ready (c.ts
        // `fbranches:`), not start branch's handler, whose await is of
        // any type.
        // A together whose actions only compute, in JavaScript: run side
        // by side on worker threads where there are any (branches-rt.ts,
        // C41), given the fuel, since under a budget they stay in order.
        if (opts.host && !fibers && target === TOGETHER && (parallel ??= parallelTogethers(code, info)).has(n.id)) return { k: "rt", fn: "together.pure", args: [...args(), { k: "rt", fn: "fuel.get", args: [] }] };
        // A map of a function that only computes, likewise by its items
        // (C42), where its items are worth sharing by what each took the
        // last time (map.worth); otherwise the map as compiled, which is
        // the faster for the small maps a loop makes many of.
        if (opts.host && !fibers && !given.has(n.id) && (parallelList ??= parallelLists(code, info)).has(n.id)) {
          const tx = stype(zonk(n.args[0])), t = stype(zonk(id));
          if (tx && t) {
            // The list once, as a local; the function as written, made
            // only on the way taken (lowered for each, as passes after
            // may change a node in place), so the compiled map is its own
            // copy for it. The call site is a number the runtime keeps its
            // measure under.
            const l = f.locals.push(tx) - 1, xs: SExpr = { k: "local", i: l }, [items, by] = args(), site: SExpr = { k: "num", v: mapSites++ };
            given.set(n.id, [xs, by]);
            let plain: SExpr;
            try { plain = expr(id, env, f, tail); } finally { given.delete(n.id); }
            const shared: SExpr = { k: "rt", fn: `${parallelList.get(n.id)}.pure`, args: [xs, expr(n.args[1], env, f, false), { k: "rt", fn: "fuel.get", args: [] }, site] };
            // first where's runtime gives the item found, as a list of it
            // or of none, which first where as compiled then answers from.
            let then: SExpr = shared;
            if (parallelList.get(n.id) === "first") {
              const one = f.locals.push(tx) - 1;
              given.set(n.id, [{ k: "local", i: one }, expr(n.args[1], env, f, false)]);
              try { then = { k: "let", i: one, value: shared, body: expr(id, env, f, tail) }; } finally { given.delete(n.id); }
            }
            return { k: "let", i: l, value: items, body: { k: "if", cond: { k: "rt", fn: "map.worth", args: [xs, site] }, then, else: plain, t } };
          }
        }
        // The same in C (L101, c.ts `par:map`), an array's: on threads,
        // the counts of what they share made atomic, where the runtime
        // finds the items worth it. Its items do nothing a fiber is for. A
        // list's map stays as compiled.
        // A together whose actions only compute, likewise in C (C201,
        // c.ts `par:together`): on the threads, not on fibers.
        if (opts.threads && target === TOGETHER && (parallel ??= parallelTogethers(code, info)).has(n.id)) {
          const t = stype(zonk(id));
          if (t && isData(t)) return { k: "rt", fn: "par:together", args: args(), host: { t, partial: true } };
        }
        // And a keep (C202), its items that pass in order; all pass and
        // any pass, the first test that decides.
        const job = opts.threads ? (parallelList ??= parallelLists(code, info)).get(n.id) : undefined;
        if (job === "map" || job === "keep" || job === "all" || job === "any" || job === "first") {
          const t = stype(zonk(id)), tx = stype(zonk(n.args[0]));
          if (t && (job === "all" || job === "any" ? tx && isArray(tx) : isArray(t))) return { k: "rt", fn: `par:${job}`, args: args(), host: { t, partial: true } };
          // first where (C202c): the item that first passes, as an array
          // of it or of none, which first where as compiled then answers
          // from, as in JavaScript.
          if (job === "first" && tx && isArray(tx) && !given.has(n.id)) {
            const one = f.locals.push(tx) - 1;
            const found: SExpr = { k: "rt", fn: "par:first", args: args(), host: { t: tx, partial: true } };
            given.set(n.id, [{ k: "local", i: one }, expr(n.args[1], env, f, false)]);
            try { return { k: "let", i: one, value: found, body: expr(id, env, f, tail) }; } finally { given.delete(n.id); }
          }
        }
        if (fibers && (target === TOGETHER || target === RACE)) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          return { k: "rt", fn: `fbranches:${target === TOGETHER ? "all" : "first"}`, args: args(), host: { t, partial: true } };
        }
        if (laterOps.has(target)) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          const e = laterOps.get(target)!, op = (code.nodes[(code.nodes[e] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants.indexOf(target);
          if (fibers) return { k: "rt", fn: `fperform:${e}:${op}`, args: args(), host: { t, partial: true } };
          return { k: "world", op: `perform:${e}:${op}`, aborts: false, args: args(), t, suspends: true };
        }
        // The world's Console and Files where the program handles them
        // (L145): print, read file and the rest, by name or as builtins,
        // go to the nearest handler of the program's, and to the world
        // when there's none, as the evaluator gives them.
        const worldOp = OP_OF_BUILTIN[target] ?? target, worldBuiltin = OP_OF_BUILTIN[target] ? target : builtinOf.get(target);
        if (opts.host && worldBuiltin && (tailOps.get(worldOp) === CONSOLE || tailOps.get(worldOp) === FILES)) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          const e = tailOps.get(worldOp)!, op = (code.nodes[(code.nodes[e] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants.indexOf(worldOp);
          const xs = n.args.map((a) => {
            const at = stype(zonk(a));
            if (!at) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(a))}`);
            return { i: f.locals.push(at) - 1, value: expr(a, env, f, false) };
          });
          const locals = xs.map((x): SExpr => ({ k: "local", i: x.i }));
          const world = worldCall(worldBuiltin, locals, t);
          if (!world) throw new Refused(`uses ${nm(target)} under a handler of the program's (not lowered yet)`);
          const either: SExpr = { k: "if", cond: { k: "rt", fn: `handled:${e}`, args: [], host: { t: "i32", partial: false } }, then: { k: "rt", fn: `perform:${e}:${op}${t === "i32" ? ":bool" : ""}`, args: locals, host: { t, partial: true } }, else: world, t };
          return xs.reduceRight<SExpr>((body, x) => ({ k: "let", i: x.i, value: x.value, body }), either);
        }
        if (tailOps.has(target) && !drawn) {
          if (target === RANDOM_OP) {
            drawn = true;
            let world: SExpr;
            try { world = expr(id, env, f, false); } finally { drawn = false; }
            return { k: "if", cond: { k: "rt", fn: `handled:${RANDOM}`, args: [], host: { t: "i32", partial: false } }, then: { k: "rt", fn: `perform:${RANDOM}:0`, args: [], host: { t: "f64", partial: true } }, else: world, t: "f64" };
          }
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          const e = tailOps.get(target)!, op = (code.nodes[(code.nodes[e] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants.indexOf(target);
          if (e === SETTINGS) {
            drawn = true;
            let world: SExpr;
            try { world = expr(id, env, f, false); } finally { drawn = false; }
            return { k: "if", cond: { k: "rt", fn: `handled:${SETTINGS}`, args: [], host: { t: "i32", partial: false } }, then: { k: "rt", fn: `perform:${SETTINGS}:${op}`, args: [], host: { t, partial: true } }, else: world, t };
          }
          if (tailOwn.has(e)) {
            // C (L213c4): the nearest handler's case, called.
            const ps = n.args.map((a) => stype(zonk(a)));
            if (ps.some((p) => !p)) throw new Refused(`uses ${nm(target)} on ${OTHER}`);
            const ft = fnOf(ps as LType[], t);
            return { k: "apply", fn: { k: "rt", fn: `handler:${e}:${op}`, args: [], host: { t: ft, partial: false } }, t: ft, args: args(), tail: false, tmp: f.locals.push(ft) - 1 };
          }
          return { k: "rt", fn: `perform:${e}:${op}${t === "i32" ? ":bool" : ""}`, args: args(), host: { t, partial: true } };
        }
        if (opts.data && WORLD_OPS[target]) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          return { k: "world", ...WORLD_OPS[target], args: args(), t };
        }
        // The clock, for JavaScript from the core IR (C137c10): the world's,
        // as the evaluator answers a `now` nothing handles.
        if ((opts.host || opts.handlers) && target === NOW_OP) return { k: "world", op: "now", aborts: false, args: [], t: "f64" };
        // The person's locale and time zone (L214b2, L188), a file's bytes
        // (L189c), a fetched text, for JavaScript from the core IR: the
        // world's, as the evaluator answers them.
        if (opts.host && (target === MY_LOCALE_OP || target === MY_ZONE_OP || HOST_WORLD[target])) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          if (HOST_WORLD[target]) return worldCall(target, args(), t)!;
          return { k: "world", op: target === MY_LOCALE_OP ? "myLocale" : "myTimeZone", aborts: false, args: [], t };
        }
        // The files `with open file` keeps open (L213c3): the world's, by
        // their number, as the evaluator answers them; only the library
        // performs these, and none of them aborts.
        if ((opts.host || (opts.handlers && C_KEPT.has(target))) && KEPT_OPS[target]) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          // Their inputs' types, for WebAssembly's imports (L213c9).
          return { k: "world", op: KEPT_OPS[target], aborts: false, args: args(), t, ins: n.args.map((x) => stype(zonk(x))!) };
        }
        // A log line nothing handles (L213a3, for a release that logs): the
        // world's log, as the evaluator writes it.
        if ((opts.host || opts.releases) && target === LOG_OP && !tailOps.has(LOG_OP)) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          // C's is logLine: its world.log is the replay's log (C172b).
          return { k: "world", op: opts.host ? "log" : "logLine", aborts: false, args: args(), t };
        }
        // A page handler's waits (C40 step 4): the world's timers, as the
        // evaluator's (run.ts `unhandled`); a wait or an await goes on by
        // the rest of the handler, given to it (cps).
        if (opts.host && (target === WAIT_OP || target === AWAIT_OP || target === START_TIMER_OP)) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          if (target === START_TIMER_OP) return { k: "world", op: "startTimer", aborts: false, args: args(), t };
          return { k: "world", op: target === WAIT_OP ? "wait" : "await", aborts: target === AWAIT_OP, args: args(), t, suspends: true };
        }
        // C's (C44a): the world's clock, and waits that block. A timer is a
        // ticket at its deadline; an await sleeps until its ticket's time.
        if (opts.handlers && !opts.host && (target === WAIT_OP || target === AWAIT_OP || target === START_TIMER_OP)) return blockingWait(n, target, id, env, f);
        if (opts.data && target === CELL_OPS.changed) return changed(n, id, env, f);
        if (target === SET && n.args.length === 3) return setField(n, id, env, f);
        if (opts.data && target === RANDOM_OP) {
          const next: SExpr = { k: "rt", fn: "rand.next", args: [] };
          // For JavaScript from the core IR (C137c10), a draw nothing seeded
          // is the world's, as the evaluator's is (rt.world.random). Asked
          // whatever main's row says: a page's handlers draw though main
          // doesn't (ters build-web lowers main alone, and dice rolled 1 and
          // 1 every time).
          if (opts.host) return { k: "if", cond: { k: "rt", fn: "rand.unset", args: [] }, then: { k: "world", op: "random", aborts: false, args: [], t: "f64" }, else: next, t: "f64" };
          // A page in C (`cells`) too: its handlers draw though main
          // doesn't (C199c: native dice rolled 1 and 1).
          if (!worldRandom && !opts.cells) return next;
          // Nobody may have seeded it (C136): the world seeds the
          // generator at its first draw, so draws under a seeded still
          // give the seeded numbers and an outer one goes on after.
          const tmp = f.locals.push("f64") - 1;
          return { k: "if", cond: { k: "rt", fn: "rand.unset", args: [] }, then: { k: "let", i: tmp, value: { k: "rt", fn: "rand.seed", args: [{ k: "world", op: "randomSeed", aborts: false, args: [], t: "f64" }] }, body: next }, else: next, t: "f64" };
        }
        if (opts.data && target === S.seeded) return seeded(n, id, env, f);
        if (target === S.valueOf && opts.data) return valueOf(n, id, env, f);
        if (target === S.oneOf && opts.data && n.args.length === 1) {
          const lt = stype(zonk(n.args[0]));
          if (!lt || !isData(lt) || !lt.cases.some((c) => c.variant === CONS)) throw new Refused(`chooses one of ${whyNot(zonk(n.args[0]))}`);
          return { k: "choose", list: expr(n.args[0], env, f, false), t: lt };
        }
        if (opts.data && [S.first, S.optional, S.all, S.count].includes(target) && !isBudget(n)) return attempt(n, id, env, f);
        if (target === S.first || target === S.fuel) return budget(n, id, env, f);
        const t = code.nodes[target];
        if (t?.kind === "def") {
          // What the callee's type variables and rows are here.
          const types: At = new Map();
          const ct = defType(target);
          if (ct?.t === "fn") { ct.params.forEach((p, j) => n.args[j] && bindVars(p, zonk(n.args[j]), types)); bindVars(ct.ret, zonk(id), types); }
          const fn = func(target, types);
          n.args.forEach((a, j) => {
            if (stype(zonk(a)) !== funcs[fn].params[j]) throw new Refused(`passes ${nm(target)} something other than ${nm(target)} takes there`);
          });
          return { k: "call", fn, args: args(), tail };
        }
        if (opts.records && t?.kind === "variant") return build(target, zonk(id), args());
        // A written list (L181b): one flat node, however many items.
        if (opts.data && target === S.listOf) {
          const lt = stype(zonk(id));
          const c = lt && isData(lt) ? lt.cases.findIndex((x) => x.variant === CONS) : -1;
          if (!lt || !isData(lt) || c < 0) throw new Refused(`writes a list whose items are ${OTHER}`);
          const head = lt.cases[c].fields.find((x) => x.t !== lt)!.t;
          return { k: "list", t: lt, c, items: args(), item: f.locals.push(head) - 1, acc: f.locals.push(lt) - 1 };
        }
        if (opts.records && t?.kind === "field" && n.args.length === 1) {
          const r = stype(zonk(n.args[0]));
          if (r && isData(r)) {
            const c = r.cases.findIndex((x) => (code.nodes[x.variant] as NodeOf<"variant">).fields.includes(target));
            return { k: "field", rec: expr(n.args[0], env, f, false), t: r, c, i: fieldIndex(code, target) };
          }
          if (!r || !isRecord(r)) throw new Refused(`takes ${nm(target)} of something that isn't a record of Float64s and Bools`);
          return { k: "get", rec: expr(n.args[0], env, f, false), t: r, i: fieldIndex(code, target) };
        }
        if (opts.cells && !opts.host && CELL_C.has(target)) return cellOp(n, target, id, env, f);
        if (opts.host && (STD_IMPL[target] || STD_MANY[target] || (HOST_CELLS.has(target)))) return host(n, target, id, env, f);
        // for some(x => …), for JavaScript from the core IR (C137c16): the
        // evaluator's relational interpreter (relate.ts satisfiable) on the
        // closure, which carries its lambda (closure.src).
        if (opts.host && target === S.exists && n.args.length === 1) return { k: "rt", fn: "exists", args: [expr(n.args[0], env, f, false)], host: { t: "i32", partial: false } };
        if (!opts.host && opts.data && target === S.exists && n.args.length === 1) return existsSolve(n, env, f);
        // derivative(f) and gradient(f) of a function value, for JavaScript
        // from the core IR (C137c20): the evaluator's, which looks inside
        // the closure (it carries its lambda, closure.src); what it gives
        // is the evaluator's function, called for its one answer.
        if (opts.host && (target === S.derivative || target === S.gradient) && n.args.length === 1) {
          const t = stype(zonk(id));
          if (!t || !isFn(t)) throw new Refused(`takes ${nm(target)} giving ${whyNot(zonk(id))}`);
          return { k: "rt", fn: `derive:${target}`, args: [expr(n.args[0], env, f, false)], host: { t, partial: false } };
        }
        const why = TARGETS[target]?.scalar;
        throw new Refused(`uses ${nm(target)}, which isn't in the scalar profile${why && typeof why === "object" && "no" in why ? `: it ${why.no}` : ""}`);
      }
      case "match": {
        const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
        // A handler's release (L213a3, a4): the handler without it, then
        // the release however that ends, a normal exit or an Abort, as the
        // evaluator runs it after the handler's last case.
        const release = arms.find((a) => a.variant === RELEASE_V);
        if (release) {
          // `releases`: the target runs one (C too, L213a6).
          if (!opts.host && !opts.releases) throw new Refused("handles an effect with a release, which is only lowered for JavaScript and C yet (L213a): it runs in the evaluator");
          const t = stype(zonk(id));
          if (!t) throw new Refused(`handles an effect with a release, and gives ${OTHER}`);
          const kept = code.nodes[id];
          code.nodes[id] = { ...n, arms: n.arms.filter((a) => a !== release.id) };
          let body: SExpr;
          try { body = expr(id, env, f, false); } finally { code.nodes[id] = kept; }
          // st: where WebAssembly keeps the status while the release runs.
          return { k: "released", body, release: expr(release.body, env, f, false), t, st: f.locals.push("i32") - 1 };
        }
        if (n.name) throw new Refused("handles an effect under a name, which isn't lowered yet (L213b): it runs in the evaluator");
        if (n.otherwise && arms.length && effectOps.has(arms[0].variant)) {
          // A case for the normal finish (L57, C180) runs outside the
          // handler, on the computation's value; an escape's value passes
          // as it is.
          const fin = code.nodes[n.otherwise], ft = zonk(n.otherwise), e = laterOps.get(arms[0].variant) ?? tailOps.get(arms[0].variant) ?? opOf.get(arms[0].variant);
          const why = "handles an effect with a case for the normal finish that uses the effect again, which is only lowered for JavaScript yet (L57)";
          if (fin?.kind !== "lambda" || fin.params.length !== 1 || ft.t !== "fn" || e === undefined) throw new Refused(why);
          if (!ft.eff.effs.includes(e)) {
            // One that doesn't use the handled effect runs the same inside
            // it, on every target: the handler's computation is then the
            // finish called on the old one (a let).
            const call = `${id}·finish` as Id;
            code.nodes[call] = { id: call, kind: "call", fn: n.otherwise, args: [n.scrutinee] };
            info.typeOf.set(call, info.typeOf.get(id)!);
            const kept = code.nodes[id];
            code.nodes[id] = { ...n, scrutinee: call, otherwise: null };
            try { return expr(id, env, f, tail); } finally { code.nodes[id] = kept; }
          }
          // One that does: the runtime's handler runs it once the
          // computation has finished, with the handler taken off.
          const later = laterOps.get(arms[0].variant), pushed = tailOps.get(arms[0].variant);
          if ((opts.host || fibers) && later && arms.every((a) => laterOps.get(a.variant) === later)) return handleOps(n, later, id, env, f, true, fin);
          if (opts.host && pushed && !tailOwn.has(pushed) && arms.every((a) => tailOps.get(a.variant) === pushed)) return handleOps(n, pushed, id, env, f, false, fin);
          throw new Refused(why);
        }
        if (opts.data && arms.length === 1 && arms[0].variant === ABORT_OP) {
          // A handler of Abort: the scrutinee is the computation.
          const t = stype(zonk(id));
          if (!t) throw new Refused(`handles Abort with a value that is ${OTHER}`);
          const reason = f.locals.push("text") - 1, save = f.locals.push("f64") - 1;
          const body = expr(n.scrutinee, env, f, false);
          const arm = expr(arms[0].body, new Map(env).set(arms[0].binds[0], reason), f, false);
          return { k: "handle", body, reason, arm, t, save };
        }
        const later = arms.length ? laterOps.get(arms[0].variant) : undefined;
        if (later && arms.every((a) => laterOps.get(a.variant) === later) && !n.otherwise) return handleOps(n, later, id, env, f, true);
        const pushed = arms.length ? tailOps.get(arms[0].variant) : undefined;
        if (pushed && arms.every((a) => tailOps.get(a.variant) === pushed) && !n.otherwise) return handleOps(n, pushed, id, env, f);
        const handled = opts.data && arms.length ? opOf.get(arms[0].variant) : undefined;
        // A match on the world's Console or Files (L145): its operations
        // answer and go on, and print is performed as the world's, so the
        // case below (operations that never return) would skip the match.
        if (handled === CONSOLE || handled === FILES) throw new Refused(`handles ${nm(handled)}, the world's, which isn't lowered yet: it runs in the evaluator`);
        if (handled && handled !== ABORT && arms.every((a) => opOf.get(a.variant) === handled) && !n.otherwise) {
          // A handler of another effect whose operations never return (C34):
          // a case on the operation it was given (the checker wants an arm
          // for each).
          const t = stype(zonk(id));
          if (!t) throw new Refused(`handles ${nm(handled)} with a value that is ${OTHER}`);
          const et = stype({ t: "con", id: handled, args: [] });
          if (!et || !isData(et)) throw new Refused(`handles ${nm(handled)}, whose operations take ${OTHER}`);
          if (!et.cases.every((c) => arms.some((a) => a.variant === c.variant))) throw new Refused(`handles only some of ${nm(handled)}'s operations`);
          const esc = escapeOf(handled);
          const reason = f.locals.push(et) - 1, save = f.locals.push("f64") - 1, s = f.locals.push(et) - 1;
          const body = expr(n.scrutinee, env, f, false);
          const cases = et.cases.map((c, ci): SExpr => {
            const a = arms.find((x) => x.variant === c.variant)!;
            let inner = new Map(env);
            const lets = a.binds.map((b, j) => {
              const i = f.locals.push(c.fields[j].t) - 1;
              inner = new Map(inner).set(b, i);
              return { i, value: { k: "field", rec: { k: "local", i: s }, t: et, c: ci, i: j } as SExpr };
            });
            return lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), expr(a.body, inner, f, false));
          });
          const arm: SExpr = { k: "case", scrut: { k: "local", i: reason }, s, t: et, arms: cases, result: t };
          return { k: "handle", body, reason, arm, t, save, esc };
        }
        // A match on an array's front (`array of List`'s match, C137 s3e)
        // whose some case takes the pair apart at once: an if on the
        // length, and the first item and the rest read as lets, with no
        // option or pair made and no search (C196: the pedal's reads).
        const front = frontMatch(n);
        if (opts.data && front) {
          const a = stype(zonk(front.array)), t = stype(zonk(id));
          if (a && isArray(a) && t) {
            const arr = f.locals.push(a) - 1, at: SExpr = { k: "local", i: arr };
            const inner = new Map(env), lets: { i: number; value: SExpr }[] = [];
            const [x, r] = front.pair.binds;
            if (x) { const i = f.locals.push(a.item) - 1; inner.set(x, i); lets.push({ i, value: { k: "rt", fn: `array.first.a${a.index}`, args: [at] } }); }
            if (r) { const i = f.locals.push(a) - 1; inner.set(r, i); lets.push({ i, value: { k: "rt", fn: `array.rest.a${a.index}`, args: [at] } }); }
            const some = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(front.pair.body, inner, f, tail));
            const cond: SExpr = { k: "rt", fn: "int.less", args: [{ k: "int", v: 0n }, { k: "rt", fn: `array.length.a${a.index}`, args: [at] }] };
            return { k: "let", i: arr, value: expr(front.array, env, f, false), body: { k: "if", cond, then: some, else: expr(front.none.body, env, f, tail), t } };
          }
        }
        const st = opts.records ? stype(zonk(n.scrutinee)) : null;
        if (st && isData(st)) {
          // Each case's arm, its fields as lets read from the scrutinee's local.
          const s = f.locals.push(st) - 1;
          const result = stype(zonk(id));
          if (!result) throw new Refused(`has a match whose value is ${OTHER}`);
          const arms2 = st.cases.map((c, ci): SExpr | null => {
            const a = arms.find((x) => x.variant === c.variant);
            if (!a) return n.otherwise ? expr(n.otherwise, env, f, tail) : null;
            let inner = new Map(env);
            const lets: { i: number; value: SExpr }[] = [];
            a.binds.forEach((b, j) => {
              const i = f.locals.push(c.fields[j].t) - 1;
              inner = new Map(inner).set(b, i);
              lets.push({ i, value: { k: "field", rec: { k: "local", i: s }, t: st, c: ci, i: j } });
            });
            return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(a.body, inner, f, tail));
          });
          return { k: "case", scrut: expr(n.scrutinee, env, f, false), s, t: st, arms: arms2, result };
        }
        if (st && isRecord(st) && arms.length === 1 && arms[0].variant === st.variant) {
          // Taking a record apart: its fields are lets.
          const r = f.locals.push(st) - 1;
          let inner = new Map(env);
          const lets: { i: number; value: SExpr }[] = [];
          arms[0].binds.forEach((b, j) => {
            const i = f.locals.push(st.fields[j].t) - 1;
            inner = new Map(inner).set(b, i);
            lets.push({ i, value: { k: "get", rec: { k: "local", i: r }, t: st, i: j } });
          });
          const body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(arms[0].body, inner, f, tail));
          return { k: "let", i: r, value: expr(n.scrutinee, env, f, false), body };
        }
        // Otherwise only `if`: a match on Bool.
        if (!arms.every((a) => a.variant === TRUE || a.variant === FALSE)) throw new Refused("matches on data (needs a heap)");
        const arm = (v: Id) => arms.find((a) => a.variant === v)?.body ?? n.otherwise!;
        const t = stype(zonk(id));
        if (!t) throw new Refused(`has an if whose value is ${OTHER}`);
        return { k: "if", cond: expr(n.scrutinee, env, f, false), then: expr(arm(TRUE), env, f, tail), else: expr(arm(FALSE), env, f, tail), t };
      }
      case "fold": {
        if (!opts.data) throw new Refused("folds over data (needs a heap)");
        return fold(n, id, env, f, tail);
      }
      case "lambda": {
        if (!opts.data) throw new Refused("makes a function (that needs closures)");
        const t = stype(zonk(id));
        if (!t || !isFn(t)) throw new Refused(`makes a function of ${whyNot(zonk(id))}`);
        return lambda(n, t, env, f);
      }
      case "hole": throw new Refused("has a hole");
      default: throw new Refused(`has a ${n.kind}`);
    }
  }

  // `match front(array) { none → …; some(p) → match p { pair(x, r) → … } }`
  // with p read nowhere else: the array, the none case and the pair's case.
  function frontMatch(n: NodeOf<"match">): { array: Id; none: NodeOf<"arm">; pair: NodeOf<"arm"> } | null {
    const sc = code.nodes[n.scrutinee];
    if (!isCall(sc) || n.otherwise || n.arms.length !== 2) return null;
    const fn = code.nodes[sc.fn];
    if (fn?.kind !== "ref" || fn.target !== ARRAY_OPS.front) return null;
    const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
    const none = arms.find((a) => a.variant === NONE), some = arms.find((a) => a.variant === SOME);
    const p = some?.binds[0];
    const m = some && code.nodes[some.body];
    if (!none || !p || m?.kind !== "match" || m.otherwise || m.arms.length !== 1) return null;
    const ms = code.nodes[m.scrutinee];
    if (ms?.kind !== "ref" || ms.target !== p) return null;
    const pair = code.nodes[m.arms[0]] as NodeOf<"arm">;
    if (pair.variant !== PAIR_V) return null;
    if (subtree(code, pair.body).some((x) => { const r = code.nodes[x]; return r.kind === "ref" && r.target === p; })) return null;
    return { array: sc.args[0], none, pair };
  }

  // A builtin with no lowering of its own, for JavaScript from the core IR
  // only (C137c7, `host`): the evaluator's own, called by its id, as the
  // values are the evaluator's. Not one with effects past Choice and
  // Diverge (the evaluator's runtime would be needed), nor one taking or
  // giving a Bool inside data (a Bool is a boolean only at the top).
  function host(n: Call, target: Id, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const sig = SIGS[target]?.(new Subst());
    const effs = sig?.t === "fn" ? info.subst.resolveRow(sig.eff).effs : [];
    const bad = effs.find((e) => e !== CHOICE && e !== DIVERGE && !(HOST_CELLS.has(target) && (e === CELLS || e === UPDATE)));
    if (bad) throw new Refused(`uses ${nm(target)}, which has ${nm(bad)} and isn't lowered yet`);
    const ts = [...n.args, id].map((a) => stype(zonk(a)));
    ts.forEach((t, i) => { if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk([...n.args, id][i]))}`); });
    if (ts.some((t) => typeof t === "object" && boolInside(t!))) throw new Refused(`uses ${nm(target)} on data holding a Bool, which isn't lowered yet`);
    if (ts.some((t) => severalInside(t!))) throw new Refused(`uses ${nm(target)} on a function with several answers, which the evaluator's can't call yet`);
    const t = ts[ts.length - 1]!;
    return { k: "rt", fn: `host:${target}${t === "i32" ? ":bool" : ""}`, args: n.args.map((a) => expr(a, env, f, false)), host: { t, partial: effs.includes(CHOICE) || !!STD_MANY[target] || target === CELL_OPS.read || target === CELL_OPS.readAt } };
  }
  // A relation run some way with one answer, for JavaScript from the core
  // IR (C137c11): the evaluator's solve (run.ts solveAnswers) gives the
  // binds' values, as one opaque value taken apart into locals, and the
  // body sees them. One with several answers is a search, not lowered yet.
  function solveUse(n: Use, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const name = nm(useTarget(code.nodes, n));
    // Where the definition has no Choice and no search is around (the
    // checker found the solve always answers), its first answer is the one,
    // as in the evaluator. Otherwise the solver's answers are `one of` a
    // list of them made as it is read (core-js.ts; a periodic angle has no
    // end, nor may a backwards search), which spends the program's budget.
    // One the solver can't plan (a relation that can't be run this way) is
    // refused, so that definition is listed and the rest lower (impact's
    // `first touch by advancing`, lowered as a root of its own).
    let planned: boolean;
    try { planned = solvesOnce(code, n); } catch (e) { throw new Refused(`solves ${name}: ${(e as Error).message}`); }
    const once = planned || (!f.partial && !searching.get(f));
    // One that gives one answer or none (the solver's single direction, a
    // relational mode that's det or semidet and ends) is its answer, or
    // no answer here: no list of them, no chooser (C184, the pedal's tanh
    // and bands). The same answers, as one of a list of one or none is.
    const single = !once && atMostOne(code, n);
    // In port order (C147), as the evaluator computes them and core-js.ts's
    // solve reads them.
    const given = givenInOrder(code, n).map((k) => n.given[k]), binds = Object.values(bindsOf(n));
    for (const g of given) { const t = stype(zonk(g)); if (!t) throw new Refused(`solves ${name} given ${whyNot(zonk(g))}`); if (typeof t === "object" && boolInside(t)) throw new Refused(`solves ${name} given data holding a Bool, which isn't lowered yet`); }
    const ts = binds.map((b) => { const t = stype(zonk(b)); if (!t) throw new Refused(`solves ${name} for ${whyNot(zonk(b))}`); if (typeof t === "object" && boolInside(t)) throw new Refused(`solves ${name} for data holding a Bool, which isn't lowered yet`); return t; });
    const all = f.locals.push("host") - 1;
    let inner = new Map(env);
    const lets = binds.map((b, j) => { const i = f.locals.push(ts[j]) - 1; inner = new Map(inner).set(b, i); return { i, value: { k: "rt", fn: `pick:${j}${ts[j] === "i32" ? ":bool" : ""}`, args: [{ k: "local", i: all }], host: { t: ts[j], partial: false } } as SExpr }; });
    const body = lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), expr(bodyOf(n), inner, f, tail));
    const solved: SExpr = once || single
      ? { k: "rt", fn: `${single ? "solveOne" : "solve"}:${n.id}`, args: given.map((g) => expr(g, env, f, false)), host: { t: "host", partial: single } }
      : { k: "choose", list: { k: "rt", fn: `solveAll:${n.id}`, args: given.map((g) => expr(g, env, f, false)), host: { t: ANSWERS, partial: false } }, t: ANSWERS };
    return { k: "let", i: all, value: solved, body };
  }
  // A solve where nothing runs the solver at run time (WebAssembly, C):
  // its plan written out (solved.ts, C195), each answer rounded as the
  // solver rounds it (number clean). One way to an answer is written as
  // it is (C195a). Several ways (C195b): where the first answer is the
  // answer, each way is tried in the solver's order, the next where one
  // gives none; in a search, a way is chosen, as `one of` chooses, and an
  // answer an earlier way gave too is given once, as the solver's key
  // tells them apart.
  function writtenSolve(n: Use, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const name = nm(useTarget(code.nodes, n));
    const no = new Refused("solves a relation (not in this profile yet)");
    let p: ReturnType<typeof planSolve>;
    try { p = planSolve(code, n); } catch { throw no; }
    if (p.mode === "relational") return modeSolve(n, env, f, tail);
    if (p.mode !== "solver" || p.status !== "solved" || !p.rel) throw no;
    const binds = bindsOf(n), keys = Object.keys(binds);
    if (keys.join() !== answerKeys(code, n).join()) throw no;
    const steps = writablePlan(p.rel as never, [...p.known], true);
    if (!steps) throw new Refused(`solves ${name} by a plan with numbers searched for (not in this profile yet)`);
    if (p.known.some((k) => !n.given[k] || stype(zonk(n.given[k])) !== "f64") || keys.some((k) => stype(zonk(binds[k])) !== "f64")) throw new Refused(`solves ${name} for something other than Float64s`);
    let planned: boolean;
    try { planned = solvesOnce(code, n); } catch (e) { throw new Refused(`solves ${name}: ${(e as Error).message}`); }
    const once = planned || (!f.partial && !searching.get(f)) || firstOnly.has(n.id);
    // A family of answers (angle + 2πk), where only the first is taken:
    // the solver's stream gives level 0's first answer (every k 0), or,
    // with none there, level 1's (each k 0, 1 or −1), or none, since a
    // level after one with nothing new isn't tried. A case the equations
    // leave free stops, saying so.
    const periodic = steps.some((s) => s.type === "solve" && s.branches.some((b) => b.params.length));
    const leftFree = steps.some((s) => s.type === "solve" && s.branches.some((b) => b.free.some(live)));
    if (periodic && !once) throw new Refused(`solves ${name} for a family of answers (plus 2πk) in a search (not in this profile yet)`);
    if (leftFree && !opts.data) throw new Refused(`solves ${name}, which may leave a value free, and a shader can't stop`);
    const wr: Written = periodic || leftFree ? {
      periodic: periodic ? [0] : undefined, eqs: (p.rel as unknown as { eqs: { lhs: never; rhs: never }[] }).eqs,
      free: leftFree ? () => ({ k: "abort", reason: { k: "text", v: `solving ${name} this way leaves a value free, which this profile can't give yet` } }) : undefined,
    } : {};
    const many = steps.filter((s) => s.type === "solve" && (s.branches.length > 1 || s.branches.some((b) => b.params.length))).length;
    if (many && !opts.data) throw new Refused(`solves ${name} with several ways, which a shader can't try`);
    if (many > 1 && !once) throw new Refused(`solves ${name} with several ways at more than one step, in a search (not in this profile yet)`);
    const vars = new Map<string, number>();
    const at = (v: string) => { let i = vars.get(v); if (i === undefined) vars.set(v, (i = f.locals.push("f64") - 1)); return i; };
    const known = p.known.map((k) => ({ i: at(k), value: expr(n.given[k], env, f, false) }));
    let inner = new Map(env);
    const answers = keys.map((k) => { const i = f.locals.push("f64") - 1; inner = new Map(inner).set(binds[k], i); return { i, v: at(k) }; });
    const clean = (x: SExpr): SExpr => ({ k: "call", fn: cleanFn(), args: [x], tail: false });
    const answered = (): SExpr => answers.reduceRight<SExpr>((e, a) => ({ k: "let", i: a.i, value: clean({ k: "local", i: a.v }), body: e }), expr(bodyOf(n), inner, f, tail));
    // Where a way gives no answer: none, in a search or a partial function;
    // otherwise the evaluator's abort, which a shader (no data) can't print.
    const fail = (): SExpr => {
      if (f.partial || searching.get(f)) return { k: "fail" };
      if (!opts.data) throw new Refused(`solves ${name}, which may give no answer, and a shader can't stop`);
      return { k: "abort", reason: { k: "text", v: `solving ${name} this way gives exactly one answer, and it gave none` } };
    };
    const t = stype(zonk(n.id))!;
    const NONE: SExpr = { k: "fail" };
    const attempt = (body: SExpr, ok: (res: number) => SExpr, otherwise: SExpr, at: LType): SExpr => { const res = f.locals.push("f64") - 1; return { k: "attempt", body, res, ok: ok(res), otherwise, t: at }; };
    let written: SExpr;
    try {
      if (!many) written = writtenSteps(steps, at, answered, fail, t, undefined, undefined, { ...wr, torn: once || !opts.data ? undefined : (s, ks, values) => {
        // A tear (torn.ts): one of its roots, closest to 0 first.
        const LF = stype({ t: "con", id: LIST, args: [{ t: "con", id: NUMBER, args: [] }] }) as DType;
        const key = `torn ${JSON.stringify([s.residual, s.tear, ks])}`;
        let fn = index.get(key);
        if (fn === undefined) index.set(key, (fn = tornRoots(s, ks, LF, writtenExpr, (g) => funcs.push(g) - 1, (x) => `${x} isn't known before the tear`)));
        return { k: "choose", list: { k: "call", fn, args: values, tail: false }, t: LF };
      } });
      else if (once) {
        // The ways tried in order, to the first that gets to the end.
        const level = (ks?: number[]) => writtenSteps(steps, at, () => ({ k: "num", v: 1 }), () => NONE, "f64",
          (_, each) => each.reduceRight<SExpr>((otherwise, body) => attempt(body, (r) => ({ k: "local", i: r }), otherwise, "f64"), NONE), undefined, { ...wr, periodic: ks });
        const tried = periodic ? attempt(level([0]), (r) => ({ k: "local", i: r }), level([0, 1, -1]), "f64") : level(wr.periodic);
        written = attempt(tried, () => answered(), fail(), t);
      } else {
        // One way chosen; an answer is the solver's only where no earlier
        // way gets to the end with the same key.
        const ports = (p.rel as { ports: string[] }).ports.filter((x) => !p.known.includes(x));
        const fresh = () => f.locals.push("f64") - 1;
        const earlier = (path: number[]): SExpr[] => Array.from({ length: path[0] }, (_, w) => {
          const mine = new Map<string, number>(p.known.map((k) => [k, at(k)]));
          const again = (v: string) => { let i = mine.get(v); if (i === undefined) mine.set(v, (i = fresh())); return i; };
          const same = (): SExpr => ports.map((x) => (rest: SExpr) => roundedKey(clean({ k: "local", i: at(x) }), fresh, (a) => roundedKey(clean({ k: "local", i: again(x) }), fresh, (b) => ({ k: "if", cond: { k: "op", op: "equal", args: [a, b] }, then: rest, else: NONE, t: "f64" }))))
            .reduceRight<SExpr>((rest, test) => test(rest), { k: "num", v: 1 });
          return attempt(writtenSteps(steps, again, same, () => NONE, "f64", undefined, [w], wr), () => ({ k: "num", v: 1 }), { k: "num", v: 0 }, "f64");
        });
        const LF = stype({ t: "con", id: LIST, args: [{ t: "con", id: NUMBER, args: [] }] }) as DType;
        const c = LF.cases.findIndex((x) => x.variant === CONS);
        written = writtenSteps(steps, at, (path) => earlier(path).reduceRight<SExpr>((rest, seen) => ({ k: "if", cond: { k: "op", op: "equal", args: [seen, { k: "num", v: 1 }] }, then: NONE, else: rest, t }), answered()), fail, t, (_, each) => {
          const w = f.locals.push("f64") - 1;
          const list: SExpr = { k: "list", t: LF, c, items: each.map((_, k) => ({ k: "num", v: k })), item: f.locals.push("f64") - 1, acc: f.locals.push(LF) - 1 };
          const pick = each.slice(0, -1).reduceRight<SExpr>((rest, e, k) => ({ k: "if", cond: { k: "op", op: "equal", args: [{ k: "local", i: w }, { k: "num", v: k }] }, then: e, else: rest, t }), each.at(-1)!);
          return { k: "let", i: w, value: { k: "choose", list, t: LF }, body: pick };
        }, undefined, wr);
      }
    } catch (e) { if (e instanceof NotWritten) throw new Refused(`solves ${name} with ${e.message} (not in this profile yet)`); throw e; }
    return known.reduceRight<SExpr>((e, k) => ({ k: "let", i: k.i, value: k.value, body: e }), written);
  }
  // for some(x, y => r(a, x, b, y)), r a predicate the solver reads as
  // equations, its unknowns the lambda's own inputs (C195; physics' for
  // some y, angle: polar(1, y, 2, angle)), on WebAssembly and C: whether
  // r solved for them has an answer. The solver's stream has one if level
  // 1 has (each k 0, 1 or −1, so level 0 too), since a level after one
  // with nothing new isn't tried; a variable left free is an answer.
  function existsSolve(n: Call, env: Map<Id, number>, f: SFunc): SExpr {
    const no = (why: string) => new Refused(`uses for some ${why} (not in this profile yet)`);
    // for some x: for some y: … is one search over x and y.
    const params: Id[] = [];
    let inner: Call = n, lam: NodeOf<"lambda"> | undefined;
    for (;;) {
      const l = code.nodes[inner.args[0]];
      if (l?.kind !== "lambda") throw no("on a function not written in place");
      lam = l; params.push(...l.params);
      const b = code.nodes[l.body], fn = b && isCall(b) ? code.nodes[b.fn] : undefined;
      if (!b || !isCall(b) || fn?.kind !== "ref" || fn.target !== S.exists || b.args.length !== 1) break;
      inner = b;
    }
    const call = code.nodes[lam.body];
    const callee = call && isCall(call) ? code.nodes[call.fn] : undefined;
    if (!call || !isCall(call) || callee?.kind !== "ref") throw no("on something other than one relation's call");
    let r: ReturnType<typeof relationFor>;
    try { r = relationFor(code, callee.target); } catch { throw no(`on ${nm(callee.target)}, which doesn't read as equations`); }
    const { rel } = r as unknown as { rel: { ports: string[]; eqs: { lhs: never; rhs: never }[] } };
    if (!r.predicate || call.args.length !== rel.ports.length) throw no(`on ${nm(callee.target)}, which isn't a predicate the solver reads`);
    const isParam = (a: Id) => { const m = code.nodes[a]; return m?.kind === "ref" && params.includes(m.target); };
    const unknown = call.args.map(isParam);
    const mine = call.args.filter(isParam).map((a) => (code.nodes[a] as NodeOf<"ref">).target);
    if (new Set(mine).size !== params.length || mine.length !== params.length) throw no(`whose inputs aren't each one of ${nm(callee.target)}'s`);
    if (call.args.some((a, i) => !unknown[i] && subtree(code, a).some((x) => { const m = code.nodes[x]; return m?.kind === "ref" && params.includes(m.target); })))
      throw no(`reading its inputs other than as ${nm(callee.target)}'s`);
    const known = rel.ports.filter((_, i) => !unknown[i]);
    if (call.args.some((a, i) => !unknown[i] && stype(zonk(a)) !== "f64")) throw no(`on something other than Float64s`);
    const steps = writablePlan(rel as never, known, true);
    if (!steps) throw no(`on ${nm(callee.target)}, solved by a plan with numbers searched for`);
    const vars = new Map<string, number>();
    const at = (v: string) => { let i = vars.get(v); if (i === undefined) vars.set(v, (i = f.locals.push("f64") - 1)); return i; };
    const values = call.args.flatMap((a, i) => (unknown[i] ? [] : [{ i: at(rel.ports[i]), value: expr(a, env, f, false) }]));
    const NONE: SExpr = { k: "fail" }, yes: SExpr = { k: "num", v: 1 };
    const attempt = (body: SExpr, otherwise: SExpr): SExpr => { const res = f.locals.push("f64") - 1; return { k: "attempt", body, res, ok: { k: "local", i: res }, otherwise, t: "f64" }; };
    let found: SExpr;
    try {
      found = writtenSteps(steps, at, () => yes, () => NONE, "f64", (_, each) => each.reduceRight<SExpr>((otherwise, body) => attempt(body, otherwise), NONE), undefined,
        { periodic: [0, 1, -1], free: () => yes, eqs: rel.eqs });
    } catch (e) { if (e instanceof NotWritten) throw no(`on ${nm(callee.target)}, solved with ${e.message}`); throw e; }
    const answer: SExpr = { k: "op", op: "equal", args: [attempt(found, { k: "num", v: 0 }), yes] };
    return values.reduceRight<SExpr>((e, k) => ({ k: "let", i: k.i, value: k.value, body: e }), answer);
  }
  // A solve the relational interpreter runs, in a mode with one answer or
  // none (det, semidet) whose plan is fixed before it runs (compiler/src/
  // modes.ts writes the same plan as JavaScript; C195): a function per
  // definition and known ports, taking them and giving the others, with
  // no answer where the plan's way fails. Each goal is a value worked out,
  // a test, or a value taken apart.
  function modeSolve(n: Use, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const name = nm(useTarget(code.nodes, n));
    const no = (why: string) => new Refused(`solves ${name} by the relational interpreter (${why}; not in this profile yet)`);
    if (!opts.data) throw no("a shader");
    modeAn ??= analyzer(code, names);
    const v = modeAn.ofSolve(n);
    if (!v || !v.ends || v.stuck.length || v.dynamic.length) throw no("its plan isn't fixed before it runs");
    const d = determinism(v.answers);
    // Several answers (backwards' magnitude): in a search, one of the
    // list of every answer, in the interpreter's order (C195).
    const several = d !== "det" && d !== "semidet";
    if (several && !(f.partial || searching.get(f))) throw no("it may have several answers, outside a search");
    const def = code.nodes[useTarget(code.nodes, n)];
    if (def?.kind !== "def") {
      if (useTarget(code.nodes, n) === S.concat && several && Object.keys(n.given).join() === "out") return cutsSolve(n, env, f, tail);
      throw no("not a definition");
    }
    const lam = code.nodes[def.body!] as NodeOf<"lambda">;
    const portOf = (k: string) => (k === "out" ? "out" : String(lam.params.indexOf(k)));
    const known = givenInOrder(code, n);
    const ins = modeOrder(known.map(portOf));
    if (ins.includes("-1")) throw no("a port it doesn't have");
    let m: { fn: number; outs: string[] };
    try { m = modeFn(def.id, ins, several); } catch (e) { if (e instanceof ModeUnsupported) throw no(e.message); throw e; }
    const listed = several ? funcs[m.fn].result as DType : undefined;
    const one = listed ? listed.cases.find((x) => x.variant === CONS)!.fields[0].t : funcs[m.fn].result;
    const res = f.locals.push(one) - 1;
    let inner = new Map(env);
    const binds = bindsOf(n);
    const lets = Object.entries(binds).map(([k, b]) => {
      const j = m.outs.indexOf(portOf(k)), t = m.outs.length === 1 ? one : (one as RType).fields[j].t;
      const i = f.locals.push(t) - 1;
      inner = new Map(inner).set(b, i);
      const r: SExpr = { k: "local", i: res };
      return { i, value: m.outs.length === 1 ? r : { k: "get", rec: r, t: one as RType, i: j } as SExpr };
    });
    const t = stype(zonk(n.id))!;
    const body = lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), expr(bodyOf(n), inner, f, tail));
    const call: SExpr = { k: "call", fn: m.fn, args: ins.map((p) => expr(n.given[known[known.map(portOf).indexOf(p)]], env, f, false)), tail: false };
    if (listed) return { k: "let", i: res, value: { k: "choose", list: call, t: listed }, body };
    if (d === "det") return { k: "let", i: res, value: call, body };
    const none: SExpr = f.partial || searching.get(f) ? { k: "fail" } : { k: "abort", reason: { k: "text", v: `solving ${name} this way gives exactly one answer, and it gave none` } };
    return { k: "attempt", body: call, res, ok: body, otherwise: none, t };
  }
  // Text joined run backwards with neither side known (backwards' cuts),
  // in a search: one of every cut of the text in two, the shortest first
  // side first, as the relational interpreter gives them.
  function cutsSolve(n: Use, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const pair = stype({ t: "con", id: tupleType(2), args: [{ t: "con", id: STRING, args: [] }, { t: "con", id: STRING, args: [] }] });
    const lt = stype({ t: "con", id: LIST, args: [{ t: "con", id: tupleType(2), args: [{ t: "con", id: STRING, args: [] }, { t: "con", id: STRING, args: [] }] }] });
    if (!pair || !isRecord(pair) || !lt || !isData(lt)) throw new Refused("solves join text for its cuts, as a list of pairs of texts (not in this profile yet)");
    const key = "text.cuts";
    let fn = index.get(key);
    if (fn === undefined) {
      // cuts(t, i, later): the cuts at i and before, before later.
      const g: SFunc = { def: "", name: "join text backwards, every answer", params: ["text", "int", lt], result: lt, locals: ["text", "int", lt], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
      index.set(key, (fn = funcs.push(g) - 1));
      const t: SExpr = { k: "local", i: 0 }, i: SExpr = { k: "local", i: 1 };
      const cut: SExpr = { k: "make", t: pair, args: [{ k: "rt", fn: "text.slice", args: [t, { k: "int", v: 0n }, i] }, { k: "rt", fn: "text.slice", args: [t, i, { k: "rt", fn: "text.length", args: [t] }] }] };
      g.body = { k: "if", cond: { k: "rt", fn: "int.less", args: [i, { k: "int", v: 0n }] }, then: { k: "local", i: 2 },
        else: { k: "call", fn, args: [t, { k: "rt", fn: "int.sub", args: [i, { k: "int", v: 1n }] }, { k: "new", t: lt, c: lt.cases.findIndex((x) => x.variant === CONS), args: [cut, { k: "local", i: 2 }] }], tail: true }, t: lt };
    }
    const text = f.locals.push("text") - 1, res = f.locals.push(pair) - 1;
    const all: SExpr = { k: "call", fn, args: [{ k: "local", i: text }, { k: "rt", fn: "text.length", args: [{ k: "local", i: text }] }, { k: "new", t: lt, c: lt.cases.findIndex((x) => x.variant === NIL), args: [] }], tail: false };
    let inner = new Map(env);
    const lets = Object.entries(bindsOf(n)).map(([k, b]) => {
      const i = f.locals.push("text") - 1;
      inner = new Map(inner).set(b, i);
      return { i, value: { k: "get", rec: { k: "local", i: res }, t: pair, i: Number(k) } as SExpr };
    });
    if (lets.length !== Object.keys(bindsOf(n)).length || Object.keys(bindsOf(n)).some((k) => k !== "0" && k !== "1")) throw new Refused("solves join text for something other than its two sides (not in this profile yet)");
    const body = lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), expr(bodyOf(n), inner, f, tail));
    return { k: "let", i: text, value: expr(n.given.out, env, f, false), body: { k: "let", i: res, value: { k: "choose", list: all, t: lt }, body } };
  }
  // The mode function for def with these ports known: its index, and the
  // ports it gives, in order (one as itself, several as a tuple).
  function modeFn(def: Id, ins: string[], all = false): { fn: number; outs: string[] } {
    const lam = code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    if (lam?.kind !== "lambda") throw new ModeUnsupported("not a function");
    const portNode = (p: string) => (p === "out" ? lam.body : lam.params[Number(p)]);
    const outs = [...lam.params.map((_, i) => String(i)), "out"].filter((p) => !ins.includes(p));
    const key = `mode${all ? "s" : ""}:${def}|${ins.join(",")}`;
    if (index.has(key)) return { fn: index.get(key)!, outs };
    const typeOf = (x: Id) => { const t = stype(zonk(x)); if (!t || t === "host") throw new ModeUnsupported(`a port of type ${whyNot(zonk(x))}`); return t; };
    const params = ins.map((p) => typeOf(portNode(p)));
    const one: LType = outs.length === 1 ? typeOf(portNode(outs[0])) : stype({ t: "con", id: tupleType(outs.length), args: outs.map((p) => zonk(portNode(p))) })!;
    if (!one) throw new ModeUnsupported("its answers as a tuple");
    const oneT: Type = outs.length === 1 ? zonk(portNode(outs[0])) : { t: "con", id: tupleType(outs.length), args: outs.map((p) => zonk(portNode(p))) };
    const listed = all ? stype({ t: "con", id: LIST, args: [oneT] }) : undefined;
    if (all && (!listed || !isData(listed))) throw new ModeUnsupported("its answers as a list");
    const result: LType = all ? listed! : one;
    const g: SFunc = { def: "", name: `${nm(def)} backwards${all ? ", every answer" : ""}`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, partial: !all };
    const at = funcs.push(g) - 1;
    index.set(key, at);
    try {
      const an = modeAn!;
      const plan = an.planOf({ k: "def", id: def }, { known: ins, spec: [] });
      const env0 = new Map<Id, number>(ins.map((p, i) => [an.slot(portNode(p)), i]));
      const done = (env: Map<Id, number>): SExpr => {
        const vs = outs.map((p) => env.get(an.slot(portNode(p))));
        if (vs.some((x) => x === undefined)) throw new ModeUnsupported("a port is never found");
        const ls = vs.map((i) => ({ k: "local", i: i! }) as SExpr);
        const answer: SExpr = outs.length === 1 ? ls[0] : { k: "make", t: one as RType, args: ls };
        if (!all) return answer;
        // Every answer: this one before those after it.
        const lt = listed as DType;
        return { k: "new", t: lt, c: lt.cases.findIndex((x) => x.variant === CONS), args: [answer, { k: "local", i: collecting.get(g)! }] };
      };
      if (!all) g.body = modePlan(an, plan, env0, done, g);
      else {
        const lt = listed as DType, none = g.locals.push(lt) - 1, r = g.locals.push(lt) - 1;
        collecting.set(g, none);
        g.body = { k: "let", i: none, value: { k: "new", t: lt, c: lt.cases.findIndex((x) => x.variant === NIL), args: [] }, body: { k: "attempt", body: modePlan(an, plan, env0, done, g), res: r, ok: { k: "local", i: r }, otherwise: { k: "local", i: none }, t: lt } };
      }
    } catch (e) { funcs.pop(); index.delete(key); throw e; }
    return { fn: at, outs };
  }
  // A plan's goals in order, then its choice of arms, then done; a way
  // that fails is no answer (the function is partial).
  function modePlan(an: ReturnType<typeof analyzer>, plan: ModePlanT, env0: Map<Id, number>, done: (env: Map<Id, number>) => SExpr, g: SFunc): SExpr {
    const NONE: SExpr = { k: "fail" };
    const failsHere = plan.steps.some((e) => { const h = e.k === "call" ? code.nodes[(code.nodes[e.node] as Call).fn] : undefined; return h?.kind === "ref" && h.target === S.fail; });
    if (failsHere) return NONE;
    const rt = g.result;
    const typeOf = (x: Id) => { const t = stype(zonk(x)); if (!t || t === "host") throw new ModeUnsupported(`a value of type ${whyNot(zonk(x))}`); return t; };
    const test = (cond: SExpr, then: SExpr): SExpr => ({ k: "if", cond, then, else: NONE, t: rt });
    const local = (i: number): SExpr => ({ k: "local", i });
    // A slot gets a value: where it has one, the two must be equal.
    const bind = (env: Map<Id, number>, s: Id, value: SExpr, k: (env: Map<Id, number>) => SExpr): SExpr => {
      const slot = an.slot(s), was = env.get(slot), t = typeOf(s);
      if (was !== undefined) return test(same(local(was), value, t, g, false), k(env));
      if (value.k === "local") return k(new Map(env).set(slot, value.i));
      const i = g.locals.push(t) - 1;
      return { k: "let", i, value, body: k(new Map(env).set(slot, i)) };
    };
    const binds = (env: Map<Id, number>, xs: [Id, SExpr][], k: (env: Map<Id, number>) => SExpr): SExpr =>
      xs.length ? bind(env, xs[0][0], xs[0][1], (e) => binds(e, xs.slice(1), k)) : k(env);
    // A value taken apart: its case, then its fields.
    const apart = (env: Map<Id, number>, val: SExpr, valNode: Id, variant: Id, fields: Id[], k: (env: Map<Id, number>) => SExpr): SExpr => {
      const t = typeOf(valNode);
      if (isRecord(t)) return binds(env, fields.map((b, i) => [b, { k: "get", rec: val, t, i }]), k);
      // A Bool (an i32): true or false, no fields.
      if (t === "i32" && (variant === TRUE || variant === FALSE)) return test(variant === TRUE ? val : { k: "op", op: "not", args: [val] }, k(env));
      if (!isData(t)) throw new ModeUnsupported("a case of a value that isn't data");
      const c = t.cases.findIndex((x) => x.variant === variant);
      if (c < 0) throw new ModeUnsupported("a case of another type");
      return { k: "case", scrut: val, s: g.locals.push(t) - 1, t, arms: t.cases.map((_, j) => (j === c ? binds(env, fields.map((b, i) => [b, { k: "field", rec: val, t, c, i }]), k) : NONE)), result: rt };
    };
    const made = (valNode: Id, variant: Id, fields: SExpr[]): SExpr => {
      const t = typeOf(valNode);
      if (isRecord(t)) return { k: "make", t, args: fields };
      if (t === "i32" && (variant === TRUE || variant === FALSE)) return { k: "bool", v: variant === TRUE };
      if (!isData(t)) throw new ModeUnsupported("a value built of a type that isn't data");
      return { k: "new", t, c: t.cases.findIndex((x) => x.variant === variant), args: fields };
    };
    // A node whose inputs are known, run forward as the program would.
    const forward = (env: Map<Id, number>, node: Id): SExpr => {
      const was = pinned;
      pinned = (x) => { if (x === node) return undefined; const i = env.get(an.slot(x)); return i === undefined ? undefined : local(i); };
      try { return expr(node, new Map(), g, false); } finally { pinned = was; }
    };
    const int = (v: number): SExpr => ({ k: "int", v: BigInt(v) });
    const steps = (i: number, env: Map<Id, number>): SExpr => {
      if (i === plan.steps.length) return plan.branch ? arms(plan.branch, env) : done(env);
      const e = plan.steps[i], next = (env: Map<Id, number>) => steps(i + 1, env);
      if (e.waits) throw new ModeUnsupported("a goal waits");
      const get = (x: Id) => env.get(an.slot(x));
      switch (e.k) {
        case "given": return bind(env, e.node, forward(env, e.node), next);
        case "same": {
          if (an.slot(e.a) === an.slot(e.b)) return next(env);
          const a = get(e.a), b = get(e.b);
          if (a !== undefined) return bind(env, e.b, local(a), next);
          if (b !== undefined) return bind(env, e.a, local(b), next);
          throw new ModeUnsupported("two unknowns made one");
        }
        case "case": {
          const val = get(e.value);
          if (val !== undefined) return apart(env, local(val), e.value, e.variant, e.binds, next);
          const fs = e.binds.map(get);
          if (fs.some((x) => x === undefined)) throw new ModeUnsupported("a value built from unknowns");
          return bind(env, e.value, made(e.value, e.variant, fs.map((x) => local(x!))), next);
        }
        case "call": {
          const n = code.nodes[e.node] as Call, head = code.nodes[n.fn];
          if (head?.kind !== "ref" || code.nodes[head.target]?.kind === "binder") throw new ModeUnsupported("a function known only when it runs");
          const t = code.nodes[head.target], args = n.args.map(get), res = get(n.id);
          if (args.every((x) => x !== undefined)) return bind(env, n.id, forward(env, n.id), next);
          if (t.kind === "def") {
            if (!e.callee || e.callee.spec.length) throw new ModeUnsupported("a call in a mode not planned");
            // Every answer in the interpreter's order holds while nothing
            // suspends (relate.ts mplus takes the next arm's first answer
            // at a suspension); a call may.
            if (collecting.has(g)) throw new ModeUnsupported("a call where every answer is wanted, whose order may interleave");
            const lam = code.nodes[t.body!] as NodeOf<"lambda">;
            const ins = modeOrder(e.callee.known);
            const port = (p: string) => (p === "out" ? n.id : n.args[Number(p)]);
            const vals = ins.map((p) => get(port(p)));
            if (vals.some((x) => x === undefined)) throw new ModeUnsupported("a mode's input not known");
            const m = modeFn(head.target, ins);
            const r = g.locals.push(funcs[m.fn].result) - 1;
            const outs = m.outs.map((p, j): [Id, SExpr] => [port(p), m.outs.length === 1 ? local(r) : { k: "get", rec: local(r), t: funcs[m.fn].result as RType, i: j }]);
            void lam;
            return { k: "let", i: r, value: { k: "call", fn: m.fn, args: vals.map((x) => local(x!)), tail: false }, body: binds(env, outs, next) };
          }
          if (t.kind === "variant" && res !== undefined) return apart(env, local(res), n.id, head.target, n.args, next);
          if (t.kind === "builtin" && res !== undefined) {
            const [a, b] = args, R = local(res);
            const len = (x: SExpr): SExpr => ({ k: "rt", fn: "text.length", args: [x] });
            // Text joined: one side known, the other what's left.
            if (head.target === S.concat && (a !== undefined || b !== undefined)) {
              const k0 = a ?? b!, la = g.locals.push("int") - 1, lr = g.locals.push("int") - 1;
              const start: SExpr = a !== undefined ? int(0) : { k: "rt", fn: "int.sub", args: [local(lr), local(la)] };
              const piece: SExpr = { k: "rt", fn: "text.slice", args: [R, start, a !== undefined ? local(la) : local(lr)] };
              const rest: SExpr = a !== undefined ? { k: "rt", fn: "text.slice", args: [R, local(la), local(lr)] } : { k: "rt", fn: "text.slice", args: [R, int(0), start] };
              const fits: SExpr = { k: "op", op: "not", args: [{ k: "rt", fn: "int.less", args: [local(lr), local(la)] }] };
              return { k: "let", i: la, value: len(local(k0)), body: { k: "let", i: lr, value: len(R), body:
                test(fits, test({ k: "rt", fn: "text.equal", args: [piece, local(k0)] }, bind(env, n.args[a !== undefined ? 1 : 0], rest, next))) } };
            }
            // Numbers: one unknown, by + − and negation (relate.ts does the same).
            const isInt = INT_OPS.add === head.target || INT_OPS.sub === head.target || INT_OPS.neg === head.target;
            const sub = (x: SExpr, y: SExpr): SExpr => (isInt ? { k: "rt", fn: "int.sub", args: [x, y] } : { k: "op", op: "sub", args: [x, y] });
            const add = (x: SExpr, y: SExpr): SExpr => (isInt ? { k: "rt", fn: "int.add", args: [x, y] } : { k: "op", op: "add", args: [x, y] });
            const plus = head.target === B.add || head.target === INT_OPS.add, minus = head.target === B.sub || head.target === INT_OPS.sub;
            if (plus && a !== undefined) return bind(env, n.args[1], sub(R, local(a)), next);
            if (plus && b !== undefined) return bind(env, n.args[0], sub(R, local(b)), next);
            if (minus && a !== undefined) return bind(env, n.args[1], sub(local(a), R), next);
            if (minus && b !== undefined) return bind(env, n.args[0], add(R, local(b)), next);
            if (head.target === B.neg) return bind(env, n.args[0], { k: "op", op: "neg", args: [R] }, next);
            if (head.target === INT_OPS.neg) return bind(env, n.args[0], { k: "rt", fn: "int.neg", args: [R] }, next);
          }
          throw new ModeUnsupported("a call with no backwards reading here");
        }
        default: throw new ModeUnsupported(`a ${e.k} goal`);
      }
    };
    // A choice of arms: the value known, its arm; else each arm in turn,
    // the next where one gives none.
    const arms = (c: NonNullable<ModePlanT["branch"]>, env: Map<Id, number>): SExpr => {
      const val = env.get(an.slot(c.value));
      if (val !== undefined) {
        const other = c.arms.find((a) => a.variant === null), t = typeOf(c.value);
        const plan = (a: (typeof c.arms)[number]) => apart(env, local(val), c.value, a.variant!, a.binds, (e) => modePlan(an, a.plan, e, done, g));
        if (isRecord(t)) { const a = c.arms.find((x) => x.variant !== null); return a ? plan(a) : other ? modePlan(an, other.plan, env, done, g) : NONE; }
        if (!isData(t)) throw new ModeUnsupported("a choice on a value that isn't data");
        // Each case's arm: its fields bound (apart tests the case again, which the printer may keep).
        const rest = other ? modePlan(an, other.plan, env, done, g) : NONE;
        return { k: "case", scrut: local(val), s: g.locals.push(t) - 1, t, arms: t.cases.map((x) => { const a = c.arms.find((y) => y.variant === x.variant); return a ? plan(a) : rest; }), result: rt };
      }
      // otherwise, for a value not known: its arm, then the value, known
      // by its end, must be none of the other arms' cases.
      const arm = (a: (typeof c.arms)[number]): SExpr => {
        if (a.variant !== null) return modePlan(an, a.plan, env, done, g);
        const others = c.arms.filter((x) => x.variant !== null).map((x) => x.variant!);
        return modePlan(an, a.plan, env, (e) => {
          const at = e.get(an.slot(c.value));
          if (at === undefined) throw new ModeUnsupported("otherwise, for a value not found in its arm");
          const t = typeOf(c.value);
          if (!isData(t)) throw new ModeUnsupported("otherwise, for a value that isn't data");
          const tag: SExpr = { k: "tag", rec: local(at), t };
          const none = others.reduce<SExpr>((acc, v) => ({ k: "op", op: "and", args: [acc, { k: "op", op: "not", args: [{ k: "op", op: "equal", args: [tag, { k: "num", v: t.cases.findIndex((x) => x.variant === v) }] }] }] }), { k: "bool", v: true });
          return test(none, done(e));
        }, g);
      };
      // Every answer: each arm's before the next's, an arm that gives none
      // adding nothing (as relate.ts gives them while nothing suspends; an
      // unfold suspends at each level).
      const after = collecting.get(g);
      if (after !== undefined && code.nodes[c.node]?.kind === "fold") throw new ModeUnsupported("unfolding where every answer is wanted, whose order may interleave");
      if (after !== undefined) {
        const out = c.arms.reduceRight<SExpr>((later, a) => {
          const l = g.locals.push(rt) - 1, r = g.locals.push(rt) - 1;
          collecting.set(g, l);
          const body = arm(a);
          return { k: "let", i: l, value: later, body: { k: "attempt", body, res: r, ok: local(r), otherwise: local(l), t: rt } };
        }, local(after));
        collecting.set(g, after);
        return out;
      }
      return c.arms.reduceRight<SExpr>((rest, a) => { const r = g.locals.push(rt) - 1; return { k: "attempt", body: arm(a), res: r, ok: local(r), otherwise: rest, t: rt }; }, NONE);
    };
    return steps(0, env0);
  }
  function cleanFn(): number {
    const key = "number.clean";
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: "", name: "number clean", params: ["f64"], result: "f64", locals: ["f64"], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    g.body = cleanBody(() => g.locals.push("f64") - 1);
    return index.get(key)!;
  }
  function atMostOne(code: Code, n: Use): boolean {
    try {
      const p = planSolve(code, n);
      if (p.mode !== "relational") return p.status === "solved" && !p.many;
      const v = solveMode(code, n);
      return !!v && !v.stuck.length && v.ends && (determinism(v.answers) === "det" || determinism(v.answers) === "semidet");
    } catch { return false; }
  }
  function boolInside(t: LType, seen = new Set<LType>()): boolean {
    if (t === "i32") return true;
    if (typeof t !== "object" || seen.has(t)) return false;
    seen.add(t);
    if (isRecord(t)) return t.fields.some((x) => boolInside(x.t, seen));
    if (isData(t)) return t.cases.some((c) => c.fields.some((x) => boolInside(x.t, seen)));
    return false;
  }

  // A function with several answers, at t or inside it (C137c22).
  function severalInside(t: LType, seen = new Set<LType>()): boolean {
    if (typeof t !== "object" || seen.has(t)) return false;
    seen.add(t);
    if (isFn(t)) return !!t.several || t.params.some((x) => severalInside(x, seen)) || severalInside(t.result, seen);
    if (isRecord(t)) return t.fields.some((x) => severalInside(x.t, seen));
    if (isData(t)) return t.cases.some((c) => c.fields.some((x) => severalInside(x.t, seen)));
    if (isArray(t)) return severalInside(t.item, seen);
    return false;
  }

  // equal on values of type t, by the evaluator's rule (run.ts equal).
  function same(x: SExpr, y: SExpr, t: LType, f: SFunc, tail: boolean): SExpr {
    if (t === "i32") return { k: "op", op: "beq", args: [x, y] };
    if (t === "int32") return { k: "op", op: "ieq", args: [x, y] };
    if (isFn(t)) throw new Refused("compares functions");
    if (isArray(t)) return { k: "call", fn: arrayLoop(t, "="), args: [x, y], tail };
    if (t === "int") return { k: "rt", fn: "int.equal", args: [x, y] };
    if (t === "text") return { k: "rt", fn: "text.equal", args: [x, y] };
    if (isTable(t)) throw new Refused("compares tables (their meaning does, in the library)");
    if (t === "host") throw new Refused("compares a cell, which isn't lowered");
    if (t === "i64") throw new Error("a machine word is made after lowering (machine-words.ts)");
    if (t !== "f64") return { k: "call", fn: equality(t), args: [x, y], tail };
    // Two Float64s exactly (run.ts sameNumber, L197).
    return { k: "op", op: "equal", args: [x, y] };
  }
  // compare's order (run.ts compareValues) as −1, 0 or 1: numbers by
  // value (exactly), Bools and cases in the order their type declares them, text by
  // code point, fractions by value, then fields left to right.
  function compared(x: SExpr, y: SExpr, t: LType, f: SFunc, tail: boolean): SExpr {
    const num = (v: number): SExpr => ({ k: "num", v });
    const pick = (eq: SExpr, lt: SExpr): SExpr => ({ k: "if", cond: eq, then: num(0), else: { k: "if", cond: lt, then: num(-1), else: num(1), t: "f64" }, t: "f64" });
    if (isFn(t)) throw new Refused("compares functions");
    if (t === "f64") {
      // Exactly, with NaN after every other Float64 (run.ts numberOrder).
      const op = (o: Op, ...args: SExpr[]): SExpr => ({ k: "op", op: o, args });
      const nan = (e: SExpr) => op("not", op("equal", e, e));
      return pick(op("or", op("equal", x, y), op("and", nan(x), nan(y))), op("or", op("less", x, y), op("and", nan(y), op("not", nan(x)))));
    }
    if (t === "i32") return pick({ k: "op", op: "beq", args: [x, y] }, { k: "op", op: "not", args: [x] });
    if (t === "int") return pick({ k: "rt", fn: "int.equal", args: [x, y] }, { k: "rt", fn: "int.less", args: [x, y] });
    if (t === "int32") return pick({ k: "op", op: "ieq", args: [x, y] }, { k: "op", op: "iless", args: [x, y] });
    if (t === "text") return pick({ k: "rt", fn: "text.equal", args: [x, y] }, { k: "rt", fn: "text.less", args: [x, y] });
    if (isArray(t)) return { k: "call", fn: arrayLoop(t, "<"), args: [x, y], tail };
    if (isTable(t)) throw new Refused("compares tables (their meaning does, in the library)");
    if (t === "host") throw new Refused("orders a cell, which isn't lowered");
    if (t === "i64") throw new Error("a machine word is made after lowering (machine-words.ts)");
    return { k: "call", fn: ordering(t), args: [x, y], tail };
  }
  // equal ("=") or compare ("<") on two arrays, as the evaluator has them
  // (std.ts ArrayView's fields: the length, then the items): the lengths,
  // then the items in order by a loop of tail calls, stopping at the first
  // that differs (C66).
  function arrayLoop(t: AType, how: "=" | "<"): number {
    const key = `${how}${t.key}`;
    if (index.has(key)) return index.get(key)!;
    if (opts.shader) throw new Refused("compares arrays (not in shaders yet)");
    const eq = how === "=", result: LType = eq ? "i32" : "f64";
    const g: SFunc = { def: ARRAY, name: `${t.name}.${eq ? "equal" : "compare"}`, params: [t, t], result, locals: [t, t], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const h: SFunc = { def: ARRAY, name: `${g.name}.from`, params: [t, t, "int"], result, locals: [t, t, "int"], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const hi = funcs.push(h) - 1;
    const loc = (i: number): SExpr => ({ k: "local", i }), rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn: `${fn}.a${t.index}`, args });
    const [a, b, k] = [loc(0), loc(1), loc(2)];
    const done: SExpr = eq ? { k: "bool", v: true } : { k: "num", v: 0 };
    const from = (i: SExpr): SExpr => ({ k: "call", fn: hi, args: [a, b, i], tail: true });
    // Item k of each, then the rest from k + 1.
    const next = from({ k: "rt", fn: "int.add", args: [k, { k: "int", v: 1n }] });
    const items = (x: SExpr) => rt("array.get", x, k);
    if (eq) {
      g.body = { k: "if", cond: { k: "rt", fn: "int.equal", args: [rt("array.length", a), rt("array.length", b)] }, then: from({ k: "int", v: 0n }), else: { k: "bool", v: false }, t: "i32" };
      h.body = { k: "if", cond: { k: "rt", fn: "int.equal", args: [k, rt("array.length", a)] }, then: done, else: { k: "if", cond: same(items(a), items(b), t.item, h, false), then: next, else: { k: "bool", v: false }, t: "i32" }, t: "i32" };
    } else {
      const c = g.locals.push("f64") - 1, d = h.locals.push("f64") - 1;
      g.body = { k: "let", i: c, value: compared(rt("array.length", a), rt("array.length", b), "int", g, false), body: { k: "if", cond: { k: "op", op: "equal", args: [loc(c), { k: "num", v: 0 }] }, then: from({ k: "int", v: 0n }), else: loc(c), t: "f64" } };
      h.body = { k: "if", cond: { k: "rt", fn: "int.equal", args: [k, rt("array.length", a)] }, then: done, else: { k: "let", i: d, value: compared(items(a), items(b), t.item, h, false), body: { k: "if", cond: { k: "op", op: "equal", args: [loc(d), { k: "num", v: 0 }] }, then: next, else: loc(d), t: "f64" } }, t: "f64" };
    }
    return index.get(key)!;
  }
  // compared on a record or data type, a function of its own (recursive
  // for a type that contains itself): different cases by their places,
  // the same case field by field, the last a tail call, so two long lists
  // compare in constant stack.
  // An interface's implementation (Shown, Ordered) at record or data type
  // t: its value, the record it is and the function it holds first. One
  // with type parameters (L219, `Ordered (Tagged a)`) is made at t's
  // arguments.
  function implementedAt(impl: Id | undefined, t: RType | DType): { value: SExpr; it: RType; ft: FType } | undefined {
    if (!impl || !code.defs.includes(impl)) return undefined;
    const raw = info.typeOf.get(impl) && info.subst.zonk(info.typeOf.get(impl)!), src = sources.get(t.key);
    if (!raw) return undefined;
    const types: At = new Map();
    if (src && raw.t === "con" && raw.args[0]) bindVars(raw.args[0], src, types);
    const it = stype(put(raw, types));
    const ft = it && isRecord(it) ? it.fields[0]?.t : undefined;
    return it && isRecord(it) && ft && isFn(ft) ? { value: { k: "call", fn: func(impl, types), args: [], tail: false }, it, ft } : undefined;
  }
  function ordering(t: RType | DType): number {
    const key = `<${t.key}`;
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: t.def, name: `${t.name}.compare`, params: [t, t], result: "f64", locals: [t, t], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const a: SExpr = { k: "local", i: 0 }, b: SExpr = { k: "local", i: 1 };
    const num = (v: number): SExpr => ({ k: "num", v });
    // A type with an Ordered implementation orders by its less, as the
    // evaluator's orderedBy does (L204g): before when a's less than b,
    // after when b's less than a, else the same. The prelude's Rational's
    // is one, so no case of its is named here (C139b).
    const od = opts.data ? implementedAt(ordereds.get(t.def), t) : undefined;
    if (od) {
      const less = (x: SExpr, y: SExpr): SExpr => ({ k: "apply", fn: { k: "get", rec: od.value, t: od.it, i: 0 }, t: od.ft, args: [x, y], tail: false, tmp: g.locals.push(od.ft) - 1 });
      g.body = { k: "if", cond: less(a, b), then: num(-1), else: { k: "if", cond: less(b, a), then: num(1), else: num(0), t: "f64" }, t: "f64" };
      return index.get(key)!;
    }
    const all = (pairs: [SExpr, SExpr, LType][]): SExpr => {
      if (!pairs.length) return num(0);
      const [x, y, ft] = pairs[pairs.length - 1];
      return pairs.slice(0, -1).reduceRight<SExpr>((rest, [x2, y2, t2]) => {
        const c = g.locals.push("f64") - 1, at: SExpr = { k: "local", i: c };
        return { k: "let", i: c, value: compared(x2, y2, t2, g, false), body: { k: "if", cond: { k: "op", op: "equal", args: [at, num(0)] }, then: rest, else: at, t: "f64" } };
      }, compared(x, y, ft, g, true));
    };
    if (isRecord(t)) g.body = all(t.fields.map((x, j) => [{ k: "get", rec: a, t, i: j }, { k: "get", rec: b, t, i: j }, x.t]));
    else {
      const arms = t.cases.map((c, ci) => all(c.fields.map((x, j) => [{ k: "field", rec: a, t, c: ci, i: j }, { k: "field", rec: b, t, c: ci, i: j }, x.t])));
      // Different cases: a's place against b's.
      const apart: SExpr = { k: "case", scrut: a, s: 0, t, result: "f64", arms: t.cases.map((_, i) => ({ k: "case", scrut: b, s: 1, t, result: "f64", arms: t.cases.map((_, j) => num(i < j ? -1 : i > j ? 1 : 0)) })) };
      g.body = { k: "if", cond: { k: "op", op: "beq", args: [{ k: "tag", rec: a, t }, { k: "tag", rec: b, t }] }, then: { k: "case", scrut: a, s: 0, t, arms, result: "f64" }, else: apart, t: "f64" };
    }
    return index.get(key)!;
  }
  // Structural equality on a record or data type, a function of its own
  // (recursive for a type that contains itself): the same case, then each
  // field in order, stopping at the first that differs, the last a tail
  // call, so two long lists compare in constant stack.
  function equality(t: RType | DType): number {
    const key = `=${t.key}`;
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: t.def, name: `${t.name}.equal`, params: [t, t], result: "i32", locals: [t, t], body: { k: "bool", v: true }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const a: SExpr = { k: "local", i: 0 }, b: SExpr = { k: "local", i: 1 };
    const all = (pairs: [SExpr, SExpr, LType][]): SExpr => {
      if (!pairs.length) return { k: "bool", v: true };
      const [x, y, ft] = pairs[pairs.length - 1];
      return pairs.slice(0, -1).reduceRight<SExpr>((rest, [x2, y2, t2]) => ({ k: "if", cond: same(x2, y2, t2, g, false), then: rest, else: { k: "bool", v: false }, t: "i32" }), same(x, y, ft, g, true));
    };
    if (isRecord(t)) g.body = all(t.fields.map((x, j) => [{ k: "get", rec: a, t, i: j }, { k: "get", rec: b, t, i: j }, x.t]));
    else {
      const arms = t.cases.map((c, ci) => all(c.fields.map((x, j) => [{ k: "field", rec: a, t, c: ci, i: j }, { k: "field", rec: b, t, c: ci, i: j }, x.t])));
      g.body = { k: "if", cond: { k: "op", op: "beq", args: [{ k: "tag", rec: a, t }, { k: "tag", rec: b, t }] }, then: { k: "case", scrut: a, s: 0, t, arms, result: "i32" }, else: { k: "bool", v: false }, t: "i32" };
    }
    return index.get(key)!;
  }

  // show's text (run.ts showValue with asNumber, which compiled JS's
  // $showAny is) of a value of type t: numbers as show writes them, Bools
  // and cases by their names, a list as [a, b], a tuple as (a, b), a
  // fraction as 1/3, an Extended as its number or −∞ and +∞ (C97).
  function shown(x: SExpr, t: LType, f: SFunc, tail: boolean): SExpr {
    if (t === "f64") return { k: "rt", fn: "number.show", args: [x] };
    if (t === "int") return { k: "rt", fn: "int.show", args: [x] };
    if (t === "i32") return { k: "if", cond: x, then: { k: "text", v: nm(TRUE) }, else: { k: "text", v: nm(FALSE) }, t: "text" };
    // Quoted as JSON.stringify quotes it (run.ts showValue, C102).
    if (t === "text") return { k: "rt", fn: "text.quoted", args: [x] };
    if (t === "int32" || isFn(t)) throw new Refused(`shows ${isFn(t) ? "a function" : "an Int in 32 bits"} (not in WebAssembly and C yet)`);
    if (isArray(t)) return { k: "call", fn: showingArray(t), args: [x], tail };
    if (isTable(t)) throw new Refused("shows a table (its meaning does, in the library)");
    if (t === "host") throw new Refused("shows a cell, which isn't lowered");
    if (t === "i64") throw new Error("a machine word is made after lowering (machine-words.ts)");
    return { k: "call", fn: showing(t), args: [x], tail };
  }
  // show on an array, "array [a, b]" as run.ts writes it (I156): the
  // first item, then a loop of tail calls adding ", " and item k to the
  // text so far, so a long array shows in constant stack.
  function showingArray(t: AType): number {
    const key = `$${t.key}`;
    if (index.has(key)) return index.get(key)!;
    if (opts.shader) throw new Refused("shows an array (not in shaders yet)");
    const g: SFunc = { def: ARRAY, name: `${t.name}.show`, params: [t], result: "text", locals: [t], body: { k: "text", v: "" }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const h: SFunc = { def: ARRAY, name: `${t.name}.show.from`, params: [t, "text", "int"], result: "text", locals: [t, "text", "int"], body: { k: "text", v: "" }, spends: false, budgeted: false, inner: true };
    const hi = funcs.push(h) - 1;
    const loc = (i: number): SExpr => ({ k: "local", i }), rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn: `${fn}.a${t.index}`, args });
    const text = (v: string): SExpr => ({ k: "text", v }), int = (v: bigint): SExpr => ({ k: "int", v });
    const item = (fn: SFunc, k: SExpr) => shown(rt("array.get", loc(0), k), t.item, fn, false);
    const empty: SExpr = { k: "rt", fn: "int.equal", args: [rt("array.length", loc(0)), int(0n)] };
    g.body = { k: "if", cond: empty, then: text("array []"), else: { k: "call", fn: hi, args: [loc(0), joined(text("array ["), item(g, int(0n))), int(1n)], tail: true }, t: "text" };
    const [k, sofar] = [loc(2), loc(1)];
    h.body = { k: "if", cond: { k: "rt", fn: "int.equal", args: [k, rt("array.length", loc(0))] }, then: joined(sofar, text("]")),
      else: { k: "call", fn: hi, args: [loc(0), joined(sofar, text(", "), item(h, k)), { k: "rt", fn: "int.add", args: [k, int(1n)] }], tail: true }, t: "text" };
    return index.get(key)!;
  }
  // Text joined, left to right.
  const joined = (...parts: SExpr[]): SExpr => parts.reduce((a, b) => ({ k: "rt", fn: "text.concat", args: [a, b] }));
  // show on a record or data type, a function of its own (recursive for a
  // type that contains itself). A list's items are joined by a loop of
  // tail calls carrying the text so far, so a long list shows in constant
  // stack.
  function showing(t: RType | DType): number {
    const key = `$${t.key}`;
    if (index.has(key)) return index.get(key)!;
    const variants = isRecord(t) ? [t.variant] : t.cases.map((c) => c.variant);
    if (variants.includes(ALGEBRAIC_V)) throw new Refused(`shows ${t.name} (not in WebAssembly and C yet)`);
    const g: SFunc = { def: t.def, name: `${t.name}.show`, params: [t], result: "text", locals: [t], body: { k: "text", v: "" }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const a: SExpr = { k: "local", i: 0 }, text = (v: string): SExpr => ({ k: "text", v });
    // A type of the program's own with a Shown implementation shows through
    // its `show`, as in the evaluator (L205, C148), and so do std's number
    // types that have one (the prelude's Rational, Complex, Fixed and the
    // words, C139a): no case of theirs is named here. Extended and the
    // algebras have none yet.
    const impl = opts.data ? implementedAt(showns.get(t.def), t) : undefined;
    if (impl) {
      g.body = { k: "apply", fn: { k: "get", rec: impl.value, t: impl.it, i: 0 }, t: impl.ft, args: [a], tail: true, tmp: g.locals.push(impl.ft) - 1 };
      return index.get(key)!;
    }
    // Case c's text, from its fields (part j) and their types.
    const one = (v: Id, fts: LType[], part: (j: number) => SExpr): SExpr => {
      const fields = fts.map((ft, j) => shown(part(j), ft, g, false));
      const list = (open: string, close: string) => joined(text(open), ...fields.flatMap((x, j) => (j ? [text(", "), x] : [x])), text(close));
      if (/^std\.tuple[2-8]\.tuple$/.test(v)) return list("(", ")");
      return fts.length ? list(`${nm(v)}(`, ")") : text(nm(v));
    };
    if (isRecord(t)) {
      g.body = one(t.variant, t.fields.map((x) => x.t), (j) => ({ k: "get", rec: a, t, i: j }));
      return index.get(key)!;
    }
    const nil = variants.indexOf(NIL), cons = variants.indexOf(CONS);
    if (nil >= 0 && cons >= 0 && t.cases.length === 2) {
      // [a, b, c]: the first item, then ", " and each of the rest.
      const item = t.cases[cons].fields[0].t;
      const r: SFunc = { def: t.def, name: `${t.name}.show.rest`, params: [t, "text"], result: "text", locals: [t, "text"], body: text(""), spends: false, budgeted: false, inner: true };
      const ri = funcs.push(r) - 1;
      const head = (fn: SFunc, s: number): SExpr => shown({ k: "field", rec: { k: "local", i: s }, t, c: cons, i: 0 }, item, fn, false);
      const rest = (s: number): SExpr => ({ k: "field", rec: { k: "local", i: s }, t, c: cons, i: 1 });
      const arms = (whenNil: SExpr, whenCons: SExpr): SExpr[] => variants.map((_, i) => (i === nil ? whenNil : whenCons));
      const rs = r.locals.push(t) - 1, gs = g.locals.push(t) - 1;
      r.body = { k: "case", scrut: { k: "local", i: 0 }, s: rs, t, result: "text", arms: arms(joined({ k: "local", i: 1 }, text("]")), { k: "call", fn: ri, args: [rest(rs), joined({ k: "local", i: 1 }, text(", "), head(r, rs))], tail: true }) };
      g.body = { k: "case", scrut: a, s: gs, t, result: "text", arms: arms(text("[]"), { k: "call", fn: ri, args: [rest(gs), joined(text("["), head(g, gs))], tail: true }) };
      return index.get(key)!;
    }
    const s = g.locals.push(t) - 1;
    g.body = { k: "case", scrut: a, s, t, result: "text", arms: t.cases.map((c, ci) => one(c.variant, c.fields.map((x) => x.t), (j) => ({ k: "field", rec: { k: "local", i: s }, t, c: ci, i: j }))) };
    return index.get(key)!;
  }
  // A function written in place, as a closure: its code is a function of
  // its own taking the closure and then the inputs, which starts by
  // reading what it captured into locals.
  function lambda(n: NodeOf<"lambda">, t: FType, env: Map<Id, number>, f: SFunc): SExpr {
    const free = [...new Set(refsIn(n.body))].filter((b) => env.has(b) || inlined.has(b));
    if (free.some((b) => inlined.has(b))) throw new Refused("makes a function inside a fold that uses the fold's result (not in WebAssembly yet)");
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const shape = shapes.push({ t, caps }) - 1;
    const g: SFunc = { def: n.id, name: `${f.name}.λ`, params: [t, ...t.params], result: t.several ? t.answer! : t.result, locals: [t, ...t.params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, ...(t.partial ? { partial: true } : {}) };
    const gi = funcs.push(g) - 1;
    closureCode.add(gi);
    let inner = new Map(n.params.map((p, j) => [p, j + 1]));
    const lets = free.map((b, j) => { const i = g.locals.push(caps[j]) - 1; inner = new Map(inner).set(b, i); return { i, value: { k: "cap", t, shape, i: j } as SExpr }; });
    g.body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(n.body, inner, g, true));
    const src: ClosureSrc | undefined = opts.host && !caps.some((c) => typeof c === "object" && boolInside(c)) ? { lambda: n.id, binders: free, bools: caps.flatMap((c, j) => (c === "i32" ? [j] : [])) } : undefined;
    return { k: "closure", t, fn: gi, shape, caps: free.map((b): SExpr => ({ k: "local", i: env.get(b)! })), ...(src ? { src } : {}) };
  }
  // A handler of a program's own effect whose cases answer in place
  // (tailOps): the code it handles, and each case, as closures given to
  // the runtime, which pushes the cases while the code runs and pops
  // them after, however it ends (core-rt.ts `handleOps:`). A case runs
  // with them popped, so what it performs goes to the handler outside,
  // as in the evaluator.
  // `later`: each case is given the rest, last, and the code it handles
  // takes the rest of the run (several_): core-rt.ts `handleK:`.
  // Whether code in f may wait for a handler outside it (C185): f's row
  // has an effect answered later, or, for the code a handler handles and
  // its cases (handleOps), what the handler says.
  const synthWaits = new Map<Id, boolean>();
  function waitingIn(f: SFunc): boolean {
    if (synthWaits.has(f.def)) return synthWaits.get(f.def)!;
    const ft = zonk(f.def);
    return ft.t === "fn" && info.subst.resolveRow(ft.eff).effs.some((x) => laterEffs.has(x));
  }
  function handleOps(n: NodeOf<"match">, e: Id, id: Id, env: Map<Id, number>, f: SFunc, later = false, fin?: NodeOf<"lambda">): SExpr {
    const t = stype(zonk(id));
    if (!t) throw new Refused(`handles ${nm(e)} with a value that is ${OTHER}`);
    // With a case for the normal finish (C180), the computation's value
    // is the finish's input.
    const tb = fin ? stype(zonk(n.scrutinee)) : t;
    if (!tb) throw new Refused(`handles ${nm(e)} around ${whyNot(zonk(n.scrutinee))}`);
    const ops = (code.nodes[(code.nodes[e] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants;
    const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
    if (!ops.every((v) => arms.some((a) => a.variant === v))) throw new Refused(`handles only some of ${nm(e)}'s operations`);
    // A closure of `params` giving what `body` gives, made as a lambda is.
    const closureOf = (at: Id, params: Id[], ts: LType[], body: Id, result: LType): SExpr => {
      const ft = fnOf(ts, result);
      const c = lambda({ id: at, kind: "lambda", params, body } as NodeOf<"lambda">, ft, env, f);
      return c.k === "closure" ? { ...c, src: undefined } : c;
    };
    // The code handled may perform this effect, answered later: a
    // handler inside it is in a function that may wait. A case runs
    // where the handler is.
    const here = waitingIn(f);
    if (later) synthWaits.set(n.scrutinee, true);
    const cases = ops.map((v) => {
      const a = arms.find((x) => x.variant === v)!;
      synthWaits.set(a.id, here);
      const r = stype(zonk(a.body)), ps = a.binds.map((b) => stype(zonk(b)));
      if (!r) throw new Refused(`handles ${nm(e)} with a case giving ${whyNot(zonk(a.body))}`);
      ps.forEach((p, j) => { if (!p) throw new Refused(`handles ${nm(v)} given ${whyNot(zonk(a.binds[j]))}`); });
      return closureOf(a.id, a.binds, ps as LType[], a.body, r);
    });
    const body = closureOf(n.scrutinee, [], [], n.scrutinee, tb);
    const cps = (c: SExpr) => c.k === "closure" && (c.t.several || waits(funcs[c.fn].body));
    const finished = fin ? [closureOf(fin.id, fin.params, [tb], fin.body, t)] : [];
    const finTag = !fin ? "" : cps(finished[0]) ? ":finK" : ":fin";
    // A computation that doesn't wait after all (together's actions that
    // never await) is called directly (`d`), its value the end.
    const how = cps(body) ? "k" : "d";
    // A case that leaves the rest out answers at once (L63, L229e): the
    // runtime resumes the rest with its value.
    const now = later ? ops.flatMap((v, i) => (arms.find((x) => x.variant === v)!.binds.length === (code.nodes[v] as NodeOf<"variant">).fields.length ? [i] : [])) : [];
    // C (C44b): the code on a fiber, the cases called and returning; the
    // printer writes the handler's driver (c.ts `fhandle:`).
    if (later && fibers) return { k: "rt", fn: `fhandle:${n.id}:${e}:${now.join(",")}:${fin ? "fin" : "-"}`, args: [body, ...cases, ...finished], host: { t, partial: true } };
    if (later) {
      // The cases given where their answer goes (continuation passing).
      const ks = cases.flatMap((c, i) => (cps(c) ? [i] : []));
      const name = `handleK:${e}:${now.join(",")}:${finTag.slice(1) || "-"}:${how}:${ks.join(",")}`;
      // Inside a function that may wait (its row has an effect answered
      // later), a handler around a wait for one outside it hands its value
      // on (C185): the simulated world, around start branch's handler, or
      // its clock's. A case's rest may then wait too, and takes where its
      // answer goes.
      const inWaiting = waitingIn(f);
      if (!inWaiting) return { k: "rt", fn: name, args: [body, ...cases, ...finished], host: { t, partial: true } };
      ops.forEach((v, i) => {
        const a = arms.find((x) => x.variant === v)!;
        if (now.includes(i)) return;
        const rt = zonk(a.binds[a.binds.length - 1]), st = stype(rt);
        if (rt.t === "fn" && st && typeof st === "object" && "params" in st && !st.several && info.subst.resolveRow(rt.eff).effs.some((x) => laterEffs.has(x))) throw new NeedsSeveral(st.key);
      });
      return { k: "world", op: `${name}:out`, aborts: false, args: [body, ...cases, ...finished], t, suspends: true };
    }
    if (cps(body) || finTag === ":finK") throw new Refused(`handles ${nm(e)} around a wait or several answers (not lowered yet)`);
    if (tailOwn.has(e)) {
      // C (L213c4): the cases pushed, the code run, and popped however it
      // ends (a release).
      const bt = (body as Extract<SExpr, { k: "closure" }>).t;
      const i = f.locals.push("i32") - 1;
      return { k: "let", i, value: { k: "rt", fn: `hpush:${e}`, args: cases, host: { t: "i32", partial: false } },
        body: { k: "released", body: { k: "apply", fn: body, t: bt, args: [], tail: false, tmp: f.locals.push(bt) - 1 }, release: { k: "rt", fn: `hpop:${e}`, args: [], host: { t: "i32", partial: false } }, t, st: f.locals.push("i32") - 1 } };
    }
    return { k: "rt", fn: `handleOps:${e}${t === "i32" ? ":bool" : ""}${finTag}`, args: [body, ...cases, ...finished], host: { t, partial: true } };
  }
  // C's waits (C44a): a wait sleeps; a timer is the ticket `at` its
  // deadline on the world's clock; an await of a timer or a ticket at a
  // time sleeps until then and gives its value. Tickets of fetches and
  // first ready (together, race) need fibers (C44), and abort.
  function blockingWait(n: NodeOf<"call">, target: Id, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const unit = stype(zonk(id)), args = n.args ?? [];
    const now: SExpr = { k: "world", op: "now", aborts: false, args: [], t: "f64" };
    if (target === WAIT_OP) {
      if (!unit) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
      return { k: "world", op: "sleep", aborts: false, args: [expr(args[0], env, f, false)], t: unit };
    }
    const tt = stype(zonk(target === START_TIMER_OP ? id : args[0]));
    if (!tt || !isData(tt)) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(target === START_TIMER_OP ? id : args[0]))}`);
    const at = tt.cases.findIndex((c) => c.variant === TICKET_V.at), timer = tt.cases.findIndex((c) => c.variant === TICKET_V.timer);
    if (target === START_TIMER_OP) {
      const vt = tt.cases[at].fields[1].t;
      return { k: "new", t: tt, c: at, args: [{ k: "op", op: "add", args: [now, expr(args[0], env, f, false)] }, { k: "zero", t: vt }] };
    }
    const r = stype(zonk(id));
    if (!r) throw new Refused(`awaits ${whyNot(zonk(id))}`);
    const s = f.locals.push(tt) - 1, scrut: SExpr = { k: "local", i: s };
    // Till the moment `at`: a branch of together or race parks (C44), and
    // the program sleeps.
    const sleep = (at: SExpr, c: number): SExpr => ({ k: "let", i: f.locals.push("i32") - 1, value: { k: "rt", fn: "fpark", args: [at], host: { t: "i32", partial: false } }, body: { k: "field", rec: scrut, t: tt, c, i: 1 } });
    const other: SExpr = { k: "abort", reason: { k: "text", v: "a ticket of the world's other than a timer, awaited in C (C44)" } };
    // The first ready of some tickets: the runtime sleeps till the first
    // is (c.ts `fready:`), and which gives its position.
    const first = tt.cases.findIndex((c) => c.variant === TICKET_V.firstReady);
    const ready = (): SExpr => {
      const lt = tt.cases[first].fields[0].t as DType, wt = tt.cases[first].fields[1].t as FType, i = f.locals.push("int") - 1;
      return { k: "let", i, value: { k: "rt", fn: `fready:${lt.key}`, args: [{ k: "field", rec: scrut, t: tt, c: first, i: 0 }], host: { t: "int", partial: true } }, body: { k: "apply", fn: { k: "field", rec: scrut, t: tt, c: first, i: 1 }, t: wt, args: [{ k: "local", i }], tail: false, tmp: f.locals.push(wt) - 1 } };
    };
    return { k: "case", scrut: expr(args[0], env, f, false), s, t: tt, result: r, arms: tt.cases.map((_, c): SExpr => (c === timer ? sleep({ k: "op", op: "add", args: [now, { k: "field", rec: scrut, t: tt, c, i: 0 }] }, c) : c === at ? sleep({ k: "field", rec: scrut, t: tt, c, i: 0 }, c) : c === first ? ready() : other)) };
  }
  // A partial function type of these, keyed as stype keys one.
  // One whose closures turned out to take the rest (NeedsSeveral) is
  // that one's several type.
  function fnOf(params: LType[], result: LType): FType {
    const key = `fn(${params.map(keyOf).join(",")})>${keyOf(result)}!`;
    if (severalTypes.has(key)) {
      const sk = `${key}*`;
      if (!fns.has(sk)) fns.set(sk, { key: sk, params: [...params, kOf(result)], result: "i32", partial: true, several: true, answer: result, waits: true });
      return fns.get(sk)!;
    }
    if (!fns.has(key)) fns.set(key, { key, params, result, partial: true });
    return fns.get(key)!;
  }
  // A definition used as a value: a closure that calls it, made once.
  function named(def: Id, id: Id, t: FType): SExpr {
    const key = `&${def}|${t.key}`;
    if (!index.has(key)) {
      const shape = shapes.push({ t, caps: [] }) - 1;
      const g: SFunc = { def, name: `${nm(def)}.value`, params: [t, ...t.params], result: t.several ? t.answer! : t.result, locals: [t, ...t.params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, ...(t.partial ? { partial: true } : {}) };
      index.set(key, funcs.push(g) - 1);
      closureCode.add(index.get(key)!);
      // What its type variables are, from the type it's used at.
      const types: At = new Map();
      const dt = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
      if (dt) bindVars(dt, zonk(id), types);
      // A several type's rest, last, isn't the definition's (C137c22).
      g.body = { k: "call", fn: func(def, types), args: t.params.slice(0, t.several ? -1 : undefined).map((_, j): SExpr => ({ k: "local", i: j + 1 })), tail: true };
      shapeOfNamed.set(key, shape);
    }
    const body = (code.nodes[def] as NodeOf<"def">).body;
    const src: ClosureSrc | undefined = opts.host && body && code.nodes[body]?.kind === "lambda" ? { lambda: body, binders: [], bools: [] } : undefined;
    return { k: "closure", t, fn: index.get(key)!, shape: shapeOfNamed.get(key)!, caps: [], ...(src ? { src } : {}) };
  }
  const shapeOfNamed = new Map<string, number>();
  // A builtin used as a value, for JavaScript from the core IR (C137c12):
  // a closure that calls the evaluator's, as `host` calls it.
  function builtinValue(target: Id, t: FType): SExpr {
    const key = `&${target}|${t.key}`;
    if (t.several) throw new Refused(`uses ${nm(target)} as a value that gives several answers (not lowered yet)`);
    if (!index.has(key)) {
      const sig = SIGS[target]?.(new Subst());
      const bad = (sig?.t === "fn" ? info.subst.resolveRow(sig.eff).effs : []).find((e) => e !== CHOICE && e !== DIVERGE);
      if (bad) throw new Refused(`uses ${nm(target)} as a value, which has ${nm(bad)} and isn't lowered yet`);
      if ([...t.params, t.result].some((x) => typeof x === "object" && boolInside(x))) throw new Refused(`uses ${nm(target)} as a value on data holding a Bool, which isn't lowered yet`);
      const shape = shapes.push({ t, caps: [] }) - 1;
      const g: SFunc = { def: target, name: `${nm(target)}.value`, params: [t, ...t.params], result: t.result, locals: [t, ...t.params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, ...(t.partial ? { partial: true } : {}) };
      index.set(key, funcs.push(g) - 1);
      closureCode.add(index.get(key)!);
      g.body = { k: "rt", fn: `host:${target}${t.result === "i32" ? ":bool" : ""}`, args: t.params.map((_, j): SExpr => ({ k: "local", i: j + 1 })), host: { t: t.result, partial: !!t.partial } };
      shapeOfNamed.set(key, shape);
    }
    return { k: "closure", t, fn: index.get(key)!, shape: shapeOfNamed.get(key)!, caps: [], src: { prim: target } };
  }

  // A fold's result binder used once, by the call that computes it.
  const inlined = new Map<Id, Extract<SExpr, { k: "call" }>>();
  // A fold is a recursive function of its own: the value folded is its
  // first input, then the locals its arms use from around it. Each arm
  // calls it on the fields of the type itself, before its body, which
  // gets those results (structural recursion, as written).
  function fold(n: NodeOf<"fold">, id: Id, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const st = stype(zonk(n.scrutinee)), result = stype(zonk(id));
    if (!st || !isData(st)) throw new Refused(`folds over ${st ? "a record (a match takes it apart)" : OTHER}`);
    if (!result) throw new Refused(`has a fold whose value is ${OTHER}`);
    const data: DType = st, res: LType = result;
    const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
    const free = [...new Set(arms.flatMap((a) => refsIn(a.body)))].filter((b) => env.has(b));
    // A field holding the type inside another (a rose tree's List Tree):
    // its folded value is that container with each one folded.
    const nested = arms.some((a) => a.results.some((r, j) => r && st.cases.find((x) => x.variant === a.variant)!.fields[j].t !== st));
    const outside = free.map((b): SExpr => ({ k: "local", i: env.get(b)! }));
    if (!nested && arms.every((a) => a.results.filter((r) => r).length <= 1)) {
      const s = expr(n.scrutinee, env, f, false);
      // A fold of a list adding an Int for each item, worked out by calls
      // that only compute, or keeping the largest or the smallest (C42):
      // the items shared out on worker threads where they are worth it
      // (map.worth), from the last as the fold meets them, their Ints
      // added or compared (exact, so in any order) after the empty list's.
      // Otherwise as below.
      const each = result === "int" && !underBudget && (opts.host && !fibers || opts.threads) && !(s.k === "rt" && s.fn === "text.characters") && (foldsShared ??= parallelFolds(code, info)).has(n.id) ? itemFold(st, arms, free, env, f) : null;
      if (each) {
        const arr = s.k === "rt" && /^array\.items\.a\d+$/.test(s.fn);
        // In C (C202d), an array's, on the threads, which time it themselves.
        if (opts.threads) { if (arr) return { k: "rt", fn: `par:fold:${each.how}`, args: [s.args[0], each.fn, each.nil], host: { t: "int", partial: true } }; }
        else {
        const whole = arr ? s.args[0] : s, lt = arr ? [...arrays.values()][Number(/\d+$/.exec(s.fn)![0])] : st;
        const l = f.locals.push(lt) - 1, xs: SExpr = { k: "local", i: l }, site: SExpr = { k: "num", v: mapSites++ };
        const shared: SExpr = { k: "rt", fn: "fold.pure", args: [xs, each.fn, each.nil, { k: "text", v: each.how }, { k: "rt", fn: "fuel.get", args: [] }, site] };
        return { k: "let", i: l, value: whole, body: { k: "if", cond: { k: "rt", fn: "map.worth", args: [xs, site] }, then: shared, else: inTurn(arr ? { ...s, args: [xs] } : xs), t: "int" } };
        }
      }
      return inTurn(s);
    }
    function inTurn(s: SExpr): SExpr {
      const st = data, result = res;
      const fused = s.k === "rt" && s.fn === "text.characters" ? characters(st, result, arms, free, env, f) : null;
      if (fused && s.k === "rt") {
        const tl = f.locals.push("text") - 1, t: SExpr = { k: "local", i: tl };
        return { k: "let", i: tl, value: s.args[0], body: { k: "call", fn: fused.fn, args: [t, { k: "rt", fn: "text.size", args: [t] }, fused.start, ...outside], tail } };
      }
      // The same over an array's items (`array of List`'s fold, C30 s2):
      // the items read in place by position, from the last back.
      const ai = s.k === "rt" && /^array\.items\.a\d+$/.test(s.fn) ? arrayItems(st, result, arms, free, env, f, [...arrays.values()][Number(/\d+$/.exec(s.fn)![0])]) : null;
      if (ai && s.k === "rt") {
        const al = f.locals.push(ai.array) - 1, a: SExpr = { k: "local", i: al };
        return { k: "let", i: al, value: s.args[0], body: { k: "call", fn: ai.fn, args: [a, { k: "rt", fn: `array.length.a${ai.array.index}`, args: [a] }, ai.start, ...outside], tail } };
      }
      const sum = result === "int" && !underBudget ? summed(st, arms, free, env, f) : null;
      if (sum !== null) return { k: "call", fn: sum, args: [s, { k: "int", v: 0n }, ...outside], tail };
      return { k: "call", fn: loop(st, result, arms, free, env, f), args: [s, { k: "new", t: framesOf(st), c: 0, args: [] }, ...outside], tail };
    }
    const params = [st, ...free.map((b) => f.locals[env.get(b)!])];
    const g: SFunc = { def: id, name: `${f.name}.fold`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    const captured: SExpr[] = free.map((_, j) => ({ k: "local", i: j + 1 }));
    const genv = new Map(free.map((b, j) => [b, j + 1]));
    const scrut: SExpr = { k: "local", i: 0 };
    // The fold mapped over a container type of st, made once per type:
    // a function of a container and what the fold captured, rebuilding it
    // case by case with each st in it folded (nested.ts, what Coq does
    // for nested inductive types).
    const maps = new Map<string, number>();
    const holds = (t: LType, seen = new Set<string>()): boolean =>
      t === st || (isData(t) && !seen.has(t.key) && (seen.add(t.key), t.cases.some((c) => c.fields.some((x) => holds(x.t, seen)))));
    const mapped = (t: LType, to: LType, v: SExpr, caps: SExpr[]): SExpr => {
      if (t === st) return { k: "call", fn: gi, args: [v, ...caps], tail: false };
      if (!holds(t)) return v;
      if (!isData(t) || !isData(to) || t.cases.length !== to.cases.length) throw new Refused(`folds over data inside ${isData(t) ? t.name : OTHER} (a nested fold)`);
      return { k: "call", fn: mapper(t, to), args: [v, ...caps], tail: false };
    };
    const mapper = (t: DType, to: DType): number => {
      const key = `${t.key}>${to.key}`;
      if (maps.has(key)) return maps.get(key)!;
      const ps = [t, ...params.slice(1)];
      const m: SFunc = { def: id, name: `${f.name}.fold.${t.name}`, params: ps, result: to, locals: [...ps], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
      maps.set(key, funcs.push(m) - 1);
      const x: SExpr = { k: "local", i: 0 }, caps = free.map((_, j): SExpr => ({ k: "local", i: j + 1 }));
      m.body = { k: "case", scrut: x, s: 0, t, result: to, arms: t.cases.map((c, ci): SExpr =>
        ({ k: "new", t: to, c: ci, args: c.fields.map((y, j) => mapped(y.t, to.cases[ci].fields[j].t, { k: "field", rec: x, t, c: ci, i: j }, caps)) })) };
      return maps.get(key)!;
    };
    const bodies = st.cases.map((c, ci): SExpr | null => {
      const a = arms.find((x) => x.variant === c.variant);
      if (!a) return null;
      let inner = new Map(genv);
      const lets: { i: number; value: SExpr }[] = [];
      const bind = (b: Id, t: LType, value: SExpr) => { const i = g.locals.push(t) - 1; inner = new Map(inner).set(b, i); lets.push({ i, value }); };
      a.binds.forEach((b, j) => bind(b, c.fields[j].t, { k: "field", rec: scrut, t: st, c: ci, i: j }));
      a.results.forEach((r, j) => {
        if (!r) return;
        if (c.fields[j].t !== st) {
          const to = stype(zonk(r));
          if (!to) throw new Refused(`has a fold whose value is ${OTHER}`);
          return bind(r, to, mapped(c.fields[j].t, to, { k: "field", rec: scrut, t: st, c: ci, i: j }, captured));
        }
        const call: Extract<SExpr, { k: "call" }> = { k: "call", fn: gi, args: [{ k: "field", rec: scrut, t: st, c: ci, i: j }, ...captured], tail: false };
        // A result used once is computed where it's used, so an arm that
        // doesn't need it (insert, once it found the place) stops there.
        // Outside a budget nothing can tell; under one, the evaluator's
        // order is kept, so the count is the same.
        // (Not from inside a fold in the arm: that's a function of its own.)
        const uses = refsIn(a.body).filter((x) => x === r).length;
        if (!underBudget && uses <= 1 && refsIn(a.body, false).filter((x) => x === r).length === uses) inlined.set(r, call);
        else bind(r, result, call);
      });
      return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(a.body, inner, g, true));
    });
    g.body = { k: "case", scrut, s: 0, t: st, arms: bodies, result };
    // Partial when anything in it fails, the mappers' calls of it included.
    for (let more = true; more;) {
      more = false;
      for (const h of [g, ...[...maps.values()].map((i) => funcs[i])]) if (!h.partial && fails(h.body, funcs)) more = h.partial = true;
    }
    return { k: "call", fn: gi, args: [expr(n.scrutinee, env, f, false), ...outside], tail };
  }
  // The stack of a fold run as a loop: the values on the way down, newest
  // first. A data type of the lowering's own, which the host never sees.
  function framesOf(st: DType): DType {
    const key = `${st.key}.frames`;
    if (datas.has(key)) return datas.get(key)!;
    const d: DType = { key, name: `${st.name}.frames`, def: st.def, cases: [], inner: true };
    d.cases.push({ variant: `${key}.done`, name: "done", fields: [] }, { variant: `${key}.frame`, name: "frame", fields: [{ name: "value", t: st }, { name: "next", t: d }] });
    datas.set(key, d);
    return d;
  }
  // A fold of a list to an Int whose item's arm adds to the rest's result
  // an Int worked out from the item alone, by calls (what reads and
  // compares only stays `summed`'s loop), or keeps the larger or the
  // smaller of the two (`if r < d then d else r`): that Int as a closure
  // of the item, the empty list's arm, and how they go together, for
  // sharing the items out (C42). Null where the arms aren't so.
  function itemFold(st: DType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc): { fn: SExpr; nil: SExpr; how: "add" | "max" | "min" } | null {
    const ci = st.cases.findIndex((c) => c.variant === CONS), ni = st.cases.findIndex((c) => c.variant === NIL);
    const cons = arms.find((a) => a.variant === CONS), nil = arms.find((a) => a.variant === NIL);
    if (st.cases.length !== 2 || ci < 0 || ni < 0 || !cons || !nil || cons.binds.length !== 2 || !cons.results[1] || cons.results[0]) return null;
    if (refsIn(cons.body).includes(cons.binds[1]) || refsIn(nil.body).some((b) => !env.has(b))) return null;
    const item = st.cases[ci].fields[0].t, ft = fnOf([item], "int");
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const shape = shapes.push({ t: ft, caps }) - 1;
    const g: SFunc = { def: cons.id, name: `${f.name}.fold.each`, params: [ft, item], result: "int", locals: [ft, item], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const R = g.locals.push("int") - 1;
    let inner = new Map<Id, number>([[cons.binds[0], 1], [cons.results[1]!, R]]);
    const lets = free.map((b, j) => { const i = g.locals.push(caps[j]) - 1; inner = new Map(inner).set(b, i); return { i, value: { k: "cap", t: ft, shape, i: j } as SExpr }; });
    const fn = funcs.push(g) - 1;
    const has = (e: SExpr): boolean => (e.k === "local" && e.i === R) || kids(e).some(has);
    const zero = (e: SExpr) => e.k === "int" && e.v === 0n;
    const plus = (a: SExpr, b: SExpr): SExpr => (zero(a) ? b : zero(b) ? a : { k: "rt", fn: "int.add", args: [a, b] });
    const added = (e: SExpr): SExpr | null => {
      if (e.k === "local" && e.i === R) return { k: "int", v: 0n };
      if (e.k === "let" && !has(e.value)) { const b = added(e.body); return b && { ...e, body: b }; }
      if (e.k === "if" && !e.check && !has(e.cond)) { const a = added(e.then), b = added(e.else); return a && b && { ...e, then: a, else: b }; }
      if (e.k === "rt" && e.fn === "int.add" && e.args.length === 2) {
        const [x, y] = e.args;
        if (has(x) && !has(y)) { const d = added(x); return d && plus(d, y); }
        if (has(y) && !has(x)) { const d = added(y); return d && plus(x, d); }
      }
      return null;
    };
    // The larger (or smaller) of the rest's result and an Int d without it,
    // compared by Int less, as d and how.
    const isR = (e: SExpr) => e.k === "local" && e.i === R;
    const same = (a: SExpr, b: SExpr) => JSON.stringify(a, (_, v) => (typeof v === "bigint" ? `${v}n` : v)) === JSON.stringify(b, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
    const kept = (e: SExpr): { d: SExpr; how: "max" | "min" } | null => {
      if (e.k === "let" && !has(e.value)) { const b = kept(e.body); return b && { d: { ...e, body: b.d }, how: b.how }; }
      if (e.k !== "if" || e.check || e.cond.k !== "rt" || e.cond.fn !== "int.less" || e.cond.args.length !== 2) return null;
      const [p, q] = e.cond.args, other = isR(p) ? q : isR(q) ? p : null, d = isR(e.then) ? e.else : isR(e.else) ? e.then : null;
      if (!other || !d || has(d) || !same(d, other)) return null;
      // r < d then d is the larger; d < r then r too.
      return { d, how: isR(p) !== isR(e.then) ? "max" : "min" };
    };
    // Only where the item's Int calls something: reading and comparing is
    // quicker in the loop than any hop.
    const calls = (e: SExpr): boolean => e.k === "call" || e.k === "apply" || kids(e).some(calls);
    const body = expr(cons.body, inner, g, false), k = kept(body), how = k ? k.how : "add" as const;
    const d = k ? k.d : added(body);
    // Not so: what lowering the arm made stays, unused, as summed's.
    if (!d || has(d) || !calls(d)) { g.body = { k: "int", v: 0n }; return null; }
    g.body = lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), d);
    if (fails(g.body, funcs)) g.partial = true;
    closureCode.add(fn);
    return { fn: { k: "closure", t: ft, fn, shape, caps: free.map((b): SExpr => ({ k: "local", i: env.get(b)! })) }, nil: expr(nil.body, env, f, false), how };
  }
  // A fold to an Int whose arms that fold a child each add something to
  // the child's result (count, a length, a sum: `if p(x) then r + 1 else
  // r`), run as one loop that adds as it goes down, with no stack
  // (C137d26). Int addition is exact, so the order of the additions can't
  // change the sum, and what each arm adds is only reading and comparing
  // (`pure` below), which can't fail, stop or act, so nobody can tell the
  // order it was worked out in either. Null where the arms aren't so.
  function summed(st: DType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc): number | null {
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const params: LType[] = [st, "int", ...caps];
    const g: SFunc = { def: arms[0]?.id ?? st.def, name: `${f.name}.fold.sum`, params, result: "int", locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const R = g.locals.push("int") - 1;
    const has = (e: SExpr): boolean => (e.k === "local" && e.i === R) || kids(e).some(has);
    const zero = (e: SExpr) => e.k === "int" && e.v === 0n;
    const plus = (a: SExpr, b: SExpr): SExpr => (zero(a) ? b : zero(b) ? a : { k: "rt", fn: "int.add", args: [a, b] });
    // e as R plus something without R: that something, or null.
    const added = (e: SExpr): SExpr | null => {
      if (e.k === "local" && e.i === R) return { k: "int", v: 0n };
      if (e.k === "let" && !has(e.value)) { const b = added(e.body); return b && { ...e, body: b }; }
      if (e.k === "if" && !e.check && !has(e.cond)) { const a = added(e.then), b = added(e.else); return a && b && { ...e, then: a, else: b }; }
      if (e.k === "rt" && e.fn === "int.add" && e.args.length === 2) {
        const [x, y] = e.args;
        if (has(x) && !has(y)) { const d = added(x); return d && plus(d, y); }
        if (has(y) && !has(x)) { const d = added(y); return d && plus(x, d); }
      }
      return null;
    };
    const PURE = new Set(["int.add", "int.sub", "int.equal", "int.less", "text.equal", "text.less", "text.length", "text.size"]);
    const pure = (e: SExpr): boolean =>
      (["num", "int", "text", "bool", "local", "let", "field", "tag", "if"].includes(e.k) || (e.k === "rt" && PURE.has(e.fn)) || (e.k === "op" && e.op !== "stop")) && kids(e).every(pure);
    const x: SExpr = { k: "local", i: 0 }, acc: SExpr = { k: "local", i: 1 };
    const capsIn: SExpr[] = free.map((_, j) => ({ k: "local", i: 2 + j }));
    const body = (a: NodeOf<"arm">, ci: number): SExpr => {
      let inner = new Map(free.map((b, j) => [b, 2 + j]));
      const lets: { i: number; value: SExpr }[] = [];
      a.binds.forEach((b, j) => {
        const i = g.locals.push(st.cases[ci].fields[j].t) - 1;
        inner = new Map(inner).set(b, i);
        lets.push({ i, value: { k: "field", rec: x, t: st, c: ci, i: j } });
      });
      const r = a.results.find((y) => y);
      if (r) inner = new Map(inner).set(r, R);
      return lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), expr(a.body, inner, g, false));
    };
    const at = funcs.push(g) - 1;
    const out: (SExpr | null)[] = [];
    for (const [ci] of st.cases.entries()) {
      const a = arms.find((y) => y.variant === st.cases[ci].variant);
      if (!a) { out.push(null); continue; }
      const j = a.results.findIndex((y) => y);
      const e = body(a, ci);
      if (j < 0) { out.push(has(e) ? null : plus(acc, e)); if (has(e)) break; continue; }
      const d = added(e);
      if (!d || has(d) || !pure(d)) break;
      out.push({ k: "call", fn: at, args: [{ k: "field", rec: x, t: st, c: ci, i: j }, plus(acc, d), ...capsIn], tail: true });
    }
    if (out.length !== st.cases.length) {
      // Not a sum: the loop with its stack instead. What lowering the arms
      // made stays, unused, so g gets a body of its own type.
      g.body = { k: "int", v: 0n };
      if (funcs.length === at + 1) funcs.pop();
      return null;
    }
    g.body = { k: "case", scrut: x, s: 0, t: st, result: "int", arms: out };
    if (fails(g.body, funcs)) g.partial = true;
    return at;
  }
  // A fold whose arms each fold at most one child (a list, a chain) as a
  // loop, the evaluator's own order: `down` walks to the end, keeping
  // each value it passes on a stack, and computes the arm that folds
  // nothing; `up` takes the stack back, giving each value's arm the
  // result so far. Both are tail calls, so a list of any length folds in
  // constant stack, as in the evaluator and the JS backend.
  function loop(st: DType, result: LType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc): number {
    const frames = framesOf(st);
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const mk = (suffix: string, params: LType[]): [SFunc, number] => {
      const g: SFunc = { def: arms[0]?.id ?? st.def, name: `${f.name}.fold.${suffix}`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
      return [g, funcs.push(g) - 1];
    };
    const [down, di] = mk("down", [st, frames, ...caps]), [up, ui] = mk("up", [frames, result, ...caps]);
    const capsIn = (at: number): SExpr[] => free.map((_, j) => ({ k: "local", i: at + j }));
    // An arm's body for the value in local v of g, with the result so far
    // in local acc (when it folds a child).
    const arm = (g: SFunc, a: NodeOf<"arm">, ci: number, v: number, acc: number | null): SExpr => {
      let inner = new Map(free.map((b, j) => [b, 2 + j]));
      const lets: { i: number; value: SExpr }[] = [];
      a.binds.forEach((b, j) => {
        const i = g.locals.push(st.cases[ci].fields[j].t) - 1;
        inner = new Map(inner).set(b, i);
        lets.push({ i, value: { k: "field", rec: { k: "local", i: v }, t: st, c: ci, i: j } });
      });
      const r = a.results.find((x) => x);
      if (r && acc !== null) inner = new Map(inner).set(r, acc);
      return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(a.body, inner, g, false));
    };
    const armOf = (ci: number) => arms.find((x) => x.variant === st.cases[ci].variant);
    down.body = {
      k: "case", scrut: { k: "local", i: 0 }, s: 0, t: st, result,
      arms: st.cases.map((_, ci): SExpr | null => {
        const a = armOf(ci);
        if (!a) return null;
        const j = a.results.findIndex((x) => x);
        if (j < 0) return { k: "call", fn: ui, args: [{ k: "local", i: 1 }, arm(down, a, ci, 0, null), ...capsIn(2)], tail: true };
        const deeper: SExpr = { k: "field", rec: { k: "local", i: 0 }, t: st, c: ci, i: j };
        return { k: "call", fn: di, args: [deeper, { k: "new", t: frames, c: 1, args: [{ k: "local", i: 0 }, { k: "local", i: 1 }] }, ...capsIn(2)], tail: true };
      }),
    };
    // up: the stack's top value, then its arm with the result so far.
    const v = up.locals.push(st) - 1;
    up.body = {
      k: "case", scrut: { k: "local", i: 0 }, s: 0, t: frames, result,
      arms: [
        { k: "local", i: 1 },
        {
          k: "let", i: v, value: { k: "field", rec: { k: "local", i: 0 }, t: frames, c: 1, i: 0 },
          body: {
            k: "call", fn: ui, tail: true,
            args: [
              { k: "field", rec: { k: "local", i: 0 }, t: frames, c: 1, i: 1 },
              { k: "case", scrut: { k: "local", i: v }, s: v, t: st, result, arms: st.cases.map((_, ci) => { const a = armOf(ci); return a && a.results.some((x) => x) ? arm(up, a, ci, v, 1) : null; }) },
              ...capsIn(2),
            ],
          },
        },
      ],
    };
    if (fails(down.body, funcs) || fails(up.body, funcs)) down.partial = up.partial = true;
    return di;
  }
  // A fold over `characters(t)` whose arms don't use the rest of the list
  // itself: no list, and no stack. Its result is the arm for the end,
  // then each character's arm from the last to the first, the order the
  // loop above takes them; one function, t and the byte position of the
  // characters still to go, a tail call per character. (Fusion: Wadler's
  // deforestation, as the JS backend does with G16.)
  function characters(st: DType, result: LType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc): { fn: number; start: SExpr } | null {
    const nil = arms.find((a) => !a.results.some((x) => x)), cons = arms.find((a) => a.results.some((x) => x));
    if (!nil || !cons || arms.length !== 2) return null;
    const ci = st.cases.findIndex((c) => c.variant === cons.variant), c = st.cases[ci];
    const head = c.fields.findIndex((x) => x.t !== st), tail = c.fields.findIndex((x) => x.t === st);
    if (head < 0 || tail < 0 || st.cases.length !== 2) return null;
    if (cons.binds[tail] && refsIn(cons.body).includes(cons.binds[tail]!)) return null;
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const params: LType[] = ["text", "i32", result, ...caps];
    const g: SFunc = { def: cons.id, name: `${f.name}.fold.characters`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    let inner = new Map(free.map((b, j) => [b, 3 + j]));
    const from = g.locals.push("i32") - 1, x = g.locals.push("text") - 1;
    if (cons.binds[head]) inner = new Map(inner).set(cons.binds[head]!, x);
    inner = new Map(inner).set(cons.results[tail]!, 2);
    const t: SExpr = { k: "local", i: 0 }, at: SExpr = { k: "local", i: 1 };
    g.body = {
      k: "if", t: result, cond: { k: "op", op: "not", args: [at] }, then: { k: "local", i: 2 },
      else: {
        k: "let", i: from, value: { k: "rt", fn: "text.before", args: [t, at] },
        body: {
          k: "let", i: x, value: { k: "rt", fn: "text.bytes", args: [t, { k: "local", i: from }, at] },
          body: { k: "call", fn: gi, args: [t, { k: "local", i: from }, expr(cons.body, inner, g, false), ...free.map((_, j): SExpr => ({ k: "local", i: 3 + j }))], tail: true },
        },
      },
    };
    if (fails(g.body, funcs)) g.partial = true;
    // The end's arm, where the fold is (it binds nothing of the list's).
    return { fn: gi, start: expr(nil.body, env, f, false) };
  }
  // A fold over `items of array(a)` whose arms don't use the rest of the
  // list itself, as `characters` above: no list and no stack, the items
  // read from the array by position, the last first. One function: the
  // array, how many items are still to go, the result so far.
  function arrayItems(st: DType, result: LType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc, array: AType): { fn: number; start: SExpr; array: AType } | null {
    const nil = arms.find((a) => !a.results.some((x) => x)), cons = arms.find((a) => a.results.some((x) => x));
    if (!nil || !cons || arms.length !== 2 || st.cases.length !== 2) return null;
    const c = st.cases.find((x) => x.variant === cons.variant)!;
    const head = c.fields.findIndex((x) => x.t !== st), tail = c.fields.findIndex((x) => x.t === st);
    if (head < 0 || tail < 0) return null;
    if (cons.binds[tail] && refsIn(cons.body).includes(cons.binds[tail]!)) return null;
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const params: LType[] = [array, "int", result, ...caps];
    const g: SFunc = { def: cons.id, name: `${f.name}.fold.items`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    let inner = new Map(free.map((b, j) => [b, 3 + j]));
    const k = g.locals.push("int") - 1, x = g.locals.push(c.fields[head].t) - 1;
    if (cons.binds[head]) inner = new Map(inner).set(cons.binds[head]!, x);
    inner = new Map(inner).set(cons.results[tail]!, 2);
    const a: SExpr = { k: "local", i: 0 }, left: SExpr = { k: "local", i: 1 };
    g.body = {
      k: "if", t: result, cond: { k: "rt", fn: "int.equal", args: [left, { k: "int", v: 0n }] }, then: { k: "local", i: 2 },
      else: {
        k: "let", i: k, value: { k: "rt", fn: "int.sub", args: [left, { k: "int", v: 1n }] },
        body: {
          k: "let", i: x, value: { k: "rt", fn: `array.get.a${array.index}`, args: [a, { k: "local", i: k }] },
          body: { k: "call", fn: gi, args: [a, { k: "local", i: k }, expr(cons.body, inner, g, false), ...free.map((_, j): SExpr => ({ k: "local", i: 3 + j }))], tail: true },
        },
      },
    };
    if (fails(g.body, funcs)) g.partial = true;
    const start = expr(nil.body, env, f, false);
    if (opts.host) restAsView((g.body as Extract<SExpr, { k: "if" }>).else, start, array, k, x);
    return { fn: gi, start, array };
  }
  // `array of List`'s own fold hands each arm the rest of the array as it
  // goes, pushing each item onto what it had: a new array per fold,
  // though the rest after item k is the array's own items from k. Where
  // the result so far is a record whose field j starts as an empty array
  // and becomes push front(that field, the item) at each item, field j is
  // made a view of the array from k instead (C30 s2b; core-rt.ts
  // array.from), on the core IR's JavaScript, whose arrays are views.
  // chapters: 707 to 531 ms.
  function restAsView(step: SExpr, start: SExpr, array: AType, k: number, x: number) {
    const push = `array.pushFront.a${array.index}`;
    if (start.k !== "make") return;
    // The step: the lets of the item and k, then the call with the new result.
    let e: SExpr = step;
    while (e.k === "let") e = e.body;
    if (e.k !== "call") return;
    let r = e.args[2];
    const lets = new Map<number, SExpr>();
    while (r.k === "let") { lets.set(r.i, r.value); r = r.body; }
    if (r.k !== "make" || r.t !== start.t) return;
    const acc = (s: SExpr) => s.k === "local" && (s.i === 2 || (lets.get(s.i)?.k === "local" && (lets.get(s.i) as { i: number }).i === 2));
    r.args.forEach((a, j) => {
      const s = start.args[j];
      if (s?.k !== "rt" || s.fn !== `array.empty.a${array.index}` || a.k !== "rt" || a.fn !== push) return;
      const [rest, item] = a.args, read = rest.k === "local" ? lets.get(rest.i) : undefined;
      if (item.k !== "local" || item.i !== x || read?.k !== "get" || read.i !== j || !acc(read.rec)) return;
      r.args[j] = { k: "rt", fn: `array.from.a${array.index}`, args: [{ k: "local", i: 0 }, { k: "local", i: k }] };
    });
  }
  // What p's type variables stand for, where c is p at known types.
  function bindVars(p: Type, c: Type, types: At) {
    if (p.t === "var") { if (c.t !== "var" && !types.has(p.v)) types.set(p.v, c); }
    else if (p.t === "con" && c.t === "con") p.args.forEach((a, j) => c.args[j] && bindVars(a, c.args[j], types));
    else if (p.t === "fn" && c.t === "fn") { p.params.forEach((a, j) => c.params[j] && bindVars(a, c.params[j], types)); bindVars(p.ret, c.ret, types); bindRow(p.eff, c.eff, types); }
  }
  // p's row variable stands for the effects c has beyond p's own.
  function bindRow(p: Row, c: Row, types: At) {
    const r = info.subst.resolveRow(p);
    if (r.tail === null || types.has(r.tail)) return;
    const cr = info.subst.resolveRow(c);
    const effs = cr.effs.filter((e) => !r.effs.includes(e));
    if (effs.length) types.set(r.tail, { effs, tail: null });
  }
  // The binders a piece of the program refers to (inside its folds too, or not).
  function refsIn(id: Id, folds = true): Id[] {
    const n = code.nodes[id], all = (ids: Id[]) => ids.flatMap((x) => refsIn(x, folds));
    switch (n?.kind) {
      case "ref": return [n.target];
      case "call": return isUse(n) ? all([...Object.values(n.given), bodyOf(n)]) : all([n.fn, ...n.args]);
      case "lambda": case "arm": return all([n.body]);
      case "match": return all([n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])]);
      case "fold": return all(folds ? [n.scrutinee, ...n.arms] : [n.scrutinee]);
      default: return [];
    }
  }

  // A value of `variant` at type t, from its fields' values.
  function build(variant: Id, t: Type, args: SExpr[]): SExpr {
    const r = stype(t);
    if (r && isData(r)) {
      const c = r.cases.findIndex((x) => x.variant === variant);
      if (c >= 0) return { k: "new", t: r, c, args };
    }
    if (r && isRecord(r) && r.variant === variant) return { k: "make", t: r, args };
    throw new Refused(`builds ${nm(variant)}, which isn't ${opts.data ? "data" : "a record"} of Float64s and Bools`);
  }

  // Whether a call of first is first(() => with fuel(…), …), a budget.
  function isBudget(n: Call): boolean {
    const a = n.args[0] ? code.nodes[n.args[0]] : undefined;
    const body = a?.kind === "lambda" && !a.params.length ? code.nodes[a.body] : null;
    return (code.nodes[n.fn] as NodeOf<"ref">).target === S.first && isCall(body) && code.nodes[body.fn]?.kind === "ref" && (code.nodes[body.fn] as NodeOf<"ref">).target === S.fuel;
  }
  // first, optional, all and count of a search written in place: the
  // search, lowered with `one of` where it chooses, and what the handler
  // makes of its answers. Once everything it calls is lowered, the pass
  // below (several) makes it code.
  // first with a fallback, or count, in a shader: the search's flag, kept
  // by the printer (`shader` above).
  function flagged(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const target = (code.nodes[n.fn] as NodeOf<"ref">).target;
    const thunk = (x: Id | undefined) => { const l = x && code.nodes[x]; return l && l.kind === "lambda" && !l.params.length ? l.body : null; };
    const search = thunk(n.args[0]), dflt = target === S.first ? thunk(n.args[1]) : null;
    if (!search || (target === S.first && !dflt)) throw new Refused(`uses ${nm(target)} on a search that isn't written in place (as () => …)`);
    const t = stype(zonk(id)), bt = stype(zonk(search));
    if (!t || !bt) throw new Refused(`searches for ${whyNot(zonk(t ? search : id))}`);
    const res = f.locals.push(bt) - 1, was = trying;
    trying = !opts.shader;
    let body: SExpr;
    try { body = expr(search, env, f, false); } finally { trying = was; }
    return target === S.first
      ? { k: "attempt", body, res, ok: { k: "local", i: res }, otherwise: expr(dflt!, env, f, false), t }
      : { k: "attempt", body, res, ok: countOf(t, 1), otherwise: countOf(t, 0), t };
  }
  // A count, an Int since L151 (or a Float64 where a count was one):
  // a whole number of the count's type.
  const countOf = (t: LType, n: number): SExpr => (t === "int" || t === "int32" ? { k: "int", v: BigInt(n) } : { k: "num", v: n });
  const countPlusOne = (t: LType, x: SExpr): SExpr => t === "int" ? { k: "rt", fn: "int.add", args: [x, countOf(t, 1)] }
    : t === "int32" ? { k: "op", op: "iadd", args: [x, countOf(t, 1)] } : { k: "op", op: "add", args: [x, countOf(t, 1)] };
  // How many searches' bodies each function is lowering now.
  const searching = new Map<SFunc, number>();
  // Solves that are a first's whole search, with nothing after them that
  // chooses: only their first answer is ever taken (C195).
  const firstOnly = new Set<Id>();
  // The use x is, or the one a let (a lambda called at once) is given,
  // where nothing else there chooses.
  const soleSolve = (x: Id): Id | null => {
    const m = code.nodes[x];
    if (m && isUse(m)) return m.body !== undefined && !mayChoose(m.body) ? x : null;
    if (!m || !isCall(m) || code.nodes[m.fn]?.kind !== "lambda") return null;
    const uses = m.args.filter((a) => code.nodes[a] && isUse(code.nodes[a]));
    if (uses.length !== 1 || mayChoose(m.fn) || m.args.some((a) => a !== uses[0] && mayChoose(a))) return null;
    return soleSolve(uses[0]);
  };
  // x a call of a definition (not recursive: its body is one solve of
  // something else) whose body is a sole solve, given inputs that don't
  // choose: the definition's inputs, body and that solve.
  const soleCall = (x: Id): { params: Id[]; args: Id[]; body: Id; use: Id } | null => {
    const m = code.nodes[x];
    if (!m || !isCall(m)) return null;
    const fn = code.nodes[m.fn], d = fn?.kind === "ref" ? code.nodes[fn.target] : undefined;
    const lam = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
    if (lam?.kind !== "lambda" || lam.params.length !== m.args.length || m.args.some(mayChoose)) return null;
    const use = soleSolve(lam.body);
    const u = use ? code.nodes[use] : undefined;
    if (!use || !u || !isUse(u) || useTarget(code.nodes, u) === (fn as NodeOf<"ref">).target) return null;
    return { params: lam.params, args: m.args, body: lam.body, use };
  };
  const mayChoose = (id: Id) => subtree(code, id).some((x) => {
    const m = code.nodes[x];
    if (!m) return false;
    if (isUse(m)) return true;
    if (!isCall(m)) return false;
    // By what's called as declared, not as used: a use takes on the
    // effects around it (`++` in a search has Choice in its row there).
    const fn = code.nodes[m.fn], target = fn?.kind === "ref" ? fn.target : undefined;
    if (fn?.kind === "lambda" || (target && (code.nodes[target]?.kind === "variant" || code.nodes[target]?.kind === "field"))) return false;
    const declared = target === undefined ? undefined : info.schemes.get(target)?.type ?? SIGS[target]?.(new Subst());
    const t = declared ? info.subst.zonk(declared) : zonk(m.fn);
    return t.t === "fn" && info.subst.resolveRow(t.eff).effs.includes(CHOICE);
  });
  function attempt(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const target = (code.nodes[n.fn] as NodeOf<"ref">).target;
    const thunk = (x: Id | undefined) => { const l = x && code.nodes[x]; return l && l.kind === "lambda" && !l.params.length ? l.body : null; };
    const search = thunk(n.args[0]), dflt = target === S.first ? thunk(n.args[1]) : null;
    if (!search || (target === S.first && !dflt)) throw new Refused(`uses ${nm(target)} on a search that isn't written in place (as () => …)`);
    const t = stype(zonk(id)), bt = stype(zonk(search));
    if (!t || !bt) throw new Refused(`searches for ${whyNot(zonk(t ? search : id))}`);
    const kind = target === S.first ? "first" : target === S.optional ? "optional" : target === S.all ? "all" : "count";
    // A count of a search that only computes (C43): its first choice's
    // alternatives counted on worker threads, the search a closure the
    // runtime runs once for each (branches-rt.ts countPure).
    // first's, its answer or none (FAIL), the default then given.
    // Not a first of one solve (C195), whose plan takes only the first answer.
    // Only a search with several answers, its closure taking the rest
    // (a search of one answer or none has no choice to split).
    const searchClosure = (): SExpr | null => { const c = expr(n.args[0], env, f, false); return c.k === "closure" && c.t.several ? c : null; };
    if (opts.host && !fibers && kind === "first" && dflt && countsShared().get(n.id) === "first" && !soleSolve(search) && !soleCall(search)) {
      const c = searchClosure();
      if (c) {
        const res = f.locals.push(t) - 1;
        return { k: "attempt", body: { k: "rt", fn: "first.search", args: [c, { k: "rt", fn: "fuel.get", args: [] }, { k: "num", v: mapSites++ }] }, res, ok: local(res), otherwise: expr(dflt, env, f, false), t };
      }
    }
    if (opts.host && !fibers && (kind === "count" || kind === "all") && countsShared().has(n.id)) {
      // all's answers as the list kind its type is: an array, or a list
      // the compiled code reads as it reads any of the runtime's.
      const how: SExpr[] = kind === "all" ? [{ k: "bool", v: isArray(t) }] : [], c = searchClosure();
      if (c) return { k: "rt", fn: `${kind}.search`, args: [c, ...how, { k: "rt", fn: "fuel.get", args: [] }, { k: "num", v: mapSites++ }] };
    }
    // The same count in C (C203): the search a closure of nothing giving
    // its count, which c.ts `par:count:search` runs with each item of its first
    // choice on the threads (choose.split, with each thread's own split).
    // An all likewise (C203b), its answers a list, joined in order; a
    // first (C203c), the runs' first answer in order, the default where
    // none has one (as JavaScript's, not of one solve or call of one).
    const firstC = kind === "first" && !!dflt && (isData(t) || t === "int" || t === "f64") && !soleSolve(search) && !soleCall(search);
    if (opts.threads && (kind === "count" ? t === "int" : kind === "all" ? isData(t) : firstC) && countsShared().get(n.id) === kind && !splitting.has(n.id) && splitsC()) {
      const free = [...new Set(refsIn(n.args[0]))].filter((b) => env.has(b) || inlined.has(b));
      if (!free.some((b) => inlined.has(b))) {
        const ft = fnOf([], t), caps = free.map((b) => f.locals[env.get(b)!]);
        const shape = shapes.push({ t: ft, caps }) - 1;
        const g: SFunc = { def: n.id, name: `${f.name}.${kind}.split`, params: [ft], result: t, locals: [ft], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, partial: true };
        const gi = funcs.push(g) - 1;
        closureCode.add(gi);
        let inner = new Map<Id, number>();
        const lets = free.map((b, j) => { const i = g.locals.push(caps[j]) - 1; inner = new Map(inner).set(b, i); return { i, value: { k: "cap", t: ft, shape, i: j } as SExpr }; });
        splitting.add(n.id);
        let counted: SExpr;
        try { counted = attempt(n, id, inner, g); } finally { splitting.delete(n.id); }
        // A first's run has an answer or none (fails), its default given here.
        if (counted.k === "search") counted = { ...counted, splits: true, ...(kind === "first" ? { dflt: undefined } : {}) };
        g.body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), counted);
        const c: SExpr = { k: "closure", t: ft, fn: gi, shape, caps: free.map((b): SExpr => ({ k: "local", i: env.get(b)! })) };
        const found: SExpr = { k: "rt", fn: `par:${kind}:search`, args: [c], host: { t, partial: true } };
        if (kind !== "first") return found;
        const res = f.locals.push(t) - 1;
        return { k: "attempt", body: found, res, ok: { k: "local", i: res }, otherwise: expr(dflt!, env, f, false), t };
      }
    }
    if (target === S.first) { const only = soleSolve(search); if (only) firstOnly.add(only); }
    // A first of a call of a definition that is one such solve (relations'
    // to polar, a family of answers): the definition's body written in
    // place, its inputs bound to the call's, so that solve's first answer
    // is the one taken here too.
    const sole = target === S.first ? soleCall(search) : null;
    searching.set(f, (searching.get(f) ?? 0) + 1);
    let body: SExpr;
    try {
      if (sole) {
        firstOnly.add(sole.use);
        let inner = new Map(env);
        const lets = sole.args.map((a, j) => { const t = stype(zonk(a)); if (!t) throw new Refused(`searches over a call given ${whyNot(zonk(a))}`); const i = f.locals.push(t) - 1; inner = new Map(inner).set(sole.params[j], i); return { i, value: expr(a, env, f, false) }; });
        body = lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), expr(sole.body, inner, f, false));
      } else body = expr(search, env, f, false);
    } finally { searching.set(f, searching.get(f)! - 1); }
    return { k: "search", kind, body, res: f.locals.push(bt) - 1, t, bt, ...(dflt ? { dflt: expr(dflt, env, f, false) } : {}) };
  }

  // ---- searches with several answers (docs/design/targets/WASM.md, W4d)
  //
  // A function that chooses (`one of`), or calls one that does, outside
  // a handler, has several answers. It's lowered as the JS backend's `$k`
  // copies are (COMPILER.md, "Searches in continuation-passing style"),
  // which is how Mercury's high-level C backend compiles nondeterministic
  // code (Henderson and Somogyi, CC 2002): it takes the rest of the search,
  // k, as one more input, and calls it on each answer in turn. k gives
  // "stop" as an answer, or "go on" as no answer (status 1), so a choice
  // is a loop that tries k on each item until one stops, and `fail` is
  // just going on. A handler's k puts each answer in a box it made: first
  // stops at the first, all keeps going and adds each one.
  //
  // The rest of a search (Cont.gen) is code, made where the answer is,
  // into the function at hand; when it has to go into a loop, a closure
  // or a join of its own, it's moved there (its locals renumbered), taking
  // the locals it reads as inputs or captures.
  type Cont = { gen: (v: SExpr, tail: boolean) => SExpr; direct?: SExpr };
  const closureCode = new Set<number>();
  const kOf = (t: LType): FType => {
    const key = `fn(${keyOf(t)})>i32!`;
    if (!fns.has(key)) fns.set(key, { key, params: [t], result: "i32", partial: true });
    return fns.get(key)!;
  };
  // A cell's box (C199a): its one field gives the cell's value.
  function cellBox(a: LType): RType {
    const ft = fnOf([], a), key = `cell:${ft.key}`;
    if (!records.has(key)) records.set(key, { key, name: "Cell", def: key, variant: key, fields: [{ name: "value", t: ft }], mutable: true });
    return records.get(key)!;
  }
  // A closure of nothing that gives v (C199a): what a cell holds once
  // written.
  const cellGivers = new Map<string, { fn: number; shape: number }>();
  function giving(ft: FType, v: SExpr): SExpr {
    if (!cellGivers.has(ft.key)) {
      const a = ft.result, shape = shapes.push({ t: ft, caps: [a] }) - 1;
      const g: SFunc = { def: `cell:${ft.key}`, name: "cell.value", params: [ft], result: a, locals: [ft], body: { k: "cap", t: ft, shape, i: 0 }, spends: false, budgeted: false, inner: true, partial: true };
      const fn = funcs.push(g) - 1;
      closureCode.add(fn);
      cellGivers.set(ft.key, { fn, shape });
    }
    const { fn, shape } = cellGivers.get(ft.key)!;
    return { k: "closure", t: ft, fn, shape, caps: [v] };
  }
  // cell, formula, read and write in C (C199a): a cell is a box (cellBox);
  // a formula's is its function, run at each read, which gives what
  // cells.ts's formula gives, as it can only read cells.
  function cellOp(n: Call, target: Id, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const ct = stype(zonk(target === CELL_OPS.cell || target === CELL_OPS.formula ? id : n.args[0]));
    if (!ct || !isRecord(ct) || !ct.key.startsWith("cell:")) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(target === CELL_OPS.cell || target === CELL_OPS.formula ? id : n.args[0]))}`);
    const ft = ct.fields[0].t as FType;
    const arg = (i: number) => expr(n.args[i], env, f, false);
    if (target === CELL_OPS.cell) return { k: "make", t: ct, args: [giving(ft, arg(0))] };
    if (target === CELL_OPS.formula) {
      const th = stype(zonk(n.args[0]));
      if (!th || typeof th !== "object" || !("params" in th) || th.key !== ft.key) throw new Refused(`uses formula on a function of type ${th && typeof th === "object" ? th.key : th}, not ${ft.key}`);
      return { k: "make", t: ct, args: [arg(0)] };
    }
    if (target === CELL_OPS.read) return { k: "apply", fn: { k: "get", rec: arg(0), t: ct, i: 0 }, t: ft, args: [], tail: false, tmp: f.locals.push(ft) - 1 };
    const unit = stype(zonk(id));
    if (!unit) throw new Refused(`uses write on ${whyNot(zonk(id))}`);
    const b = f.locals.push(ct) - 1;
    return { k: "let", i: b, value: arg(0), body: { k: "set", rec: { k: "local", i: b }, t: ct, i: 0, value: giving(ft, arg(1)), then: { k: "zero", t: unit } } };
  }
  const boxOf = (t: LType): RType => {
    const key = `box:${keyOf(t)}`;
    if (!records.has(key)) records.set(key, { key, name: "Box", def: key, variant: key, fields: [{ name: "value", t }], mutable: true });
    return records.get(key)!;
  };
  const local = (i: number): SExpr => ({ k: "local", i });
  // Whether e has several answers: it chooses, or calls a function that
  // does, outside a handler (whose search, and its default, are its own).
  function several(e: SExpr): boolean {
    if (e.k === "choose") return true;
    if (e.k === "call" && !e.cps && funcs[e.fn].multi) return true;
    if (e.k === "apply" && !e.cps && e.t.several) return true;
    if (e.k === "world" && e.suspends && !e.cps) return true;
    // A search that waits (C181): what comes after it is the rest a wait
    // takes, so it is one that goes on to the rest too.
    if (e.k === "search") return (!!e.dflt && several(e.dflt)) || (!!opts.host && waits(e.body));
    if (e.k === "handle" && several(e.body)) { if (!opts.host) throw new Refused("handles Abort around a search with several answers (not in WebAssembly yet)"); return true; }
    return kids(e).some(several);
  }
  // Whether e may wait (C40 step 4): a search or a budget around a wait
  // isn't lowered, since the rest it's given would run after it's gone.
  const waiting = new Set<number>();
  function waits(e: SExpr): boolean {
    if (e.k === "world" && e.suspends) return true;
    if (e.k === "call" && waiting.has(e.fn)) return true;
    if (e.k === "apply" && e.t.waits) return true;
    return kids(e).some(waits);
  }
  // A tail call inside e isn't one once e is a value in the rest of a search.
  const untail = (e: SExpr): SExpr => { const r = mapKids(e, untail); return r.k === "call" || r.k === "apply" ? { ...r, tail: false } : r; };
  const trivial = (e: SExpr) => ["local", "num", "int", "bool", "text"].includes(e.k);
  // The type of e's value, in g.
  function typeIn(e: SExpr, g: SFunc): LType {
    switch (e.k) {
      case "local": return g.locals[e.i];
      case "num": return "f64";
      case "int": return opts.data ? "int" : "int32";
      case "bool": case "tag": return "i32";
      case "text": return "text";
      case "op": return OPS[e.op].t;
      case "call": return funcs[e.fn].multi ? "i32" : funcs[e.fn].result;
      case "world": return e.cps ? "i32" : e.t;
      case "make": case "new": case "list": case "closure": case "if": case "attempt": case "handle": case "released": case "budget": case "search": case "choose": case "zero": return e.k === "choose" ? e.t.cases.find((c) => c.variant === CONS)!.fields[0].t : e.t;
      case "get": return e.t.fields[e.i].t;
      case "field": return e.t.cases[e.c].fields[e.i].t;
      case "apply": return e.t.several && !e.cps ? e.t.answer! : e.t.result;
      case "case": return e.result;
      case "let": return typeIn(e.body, g);
      case "set": return typeIn(e.then, g);
      case "rt": {
        if (e.host) return e.host.t;
        const r = runtime(e.fn).result;
        if (r === "int" && !opts.data) return "int32";
        if (r === "i32" || r === "int" || r === "f64" || r === "text") return r;
        const tm = /^table\.\w+\.t(\d+)(?:\.e(\d+))?$/.exec(e.fn), h = tm && [...tables.values()][Number(tm[1])];
        if (h && r === "table") return h;
        if (h && r === "value") return h.value;
        if (h && r === "list" && tm![2]) return h.entries[Number(tm![2])];
        const a = /\.a(\d+)$/.exec(e.fn) && [...arrays.values()][Number(/\.a(\d+)$/.exec(e.fn)![1])];
        if (a && r === "array") return a;
        if (a && r === "item") return a.item;
        if (a && r === "list" && a.list) return a.list;
        break;
      }
    }
    throw new Refused("chooses after a value it can't keep (not in WebAssembly yet)");
  }
  // code, made in g, moved into h: `fixed` says where the locals it reads
  // from g are in h; the ones it sets get new locals there.
  function move(e: SExpr, g: SFunc, h: SFunc, fixed: Map<number, number>): SExpr {
    const m = new Map(fixed);
    return mapLocals(e, (i) => { if (!m.has(i)) m.set(i, h.locals.push(g.locals[i]) - 1); return m.get(i)!; });
  }
  // A function of its own for the rest of a search, given what it reads:
  // `first` its first inputs, then those locals.
  function apart(g: SFunc, name: string, first: LType[], code: SExpr, bound: number[]) {
    const free = freeLocals(code).filter((i) => !bound.includes(i));
    const params = [...first, ...free.map((i) => g.locals[i])];
    const h: SFunc = { def: g.def, name: `${g.name.replace(/\.(choose|k|join)$/, "")}.${name}`, params, result: "i32", locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, partial: true };
    const hi = funcs.push(h) - 1;
    return { h, hi, free, fixed: new Map(free.map((i, j) => [i, first.length + j] as const)), passed: free.map(local) };
  }
  // The rest of the search for v of type t: k itself, or a join that
  // takes v, made once, for the arms of a match or an if.
  function join(k: Cont, t: LType, g: SFunc, uses: number): Cont {
    if (k.direct || uses <= 1) return k;
    const v = g.locals.push(t) - 1;
    const code = k.gen(local(v), true);
    const j = apart(g, "join", [t], code, [v]);
    j.fixed.set(v, 0);
    j.h.body = move(code, g, j.h, j.fixed);
    return { gen: (x, tail) => ({ k: "call", fn: j.hi, args: [x, ...j.passed], tail }) };
  }
  // `one of` list: a loop over it that tries the rest of the search on
  // each item until that stops.
  function choose(list: SExpr, lt: DType, k: Cont, tail: boolean, g: SFunc): SExpr {
    const cons = lt.cases.findIndex((c) => c.variant === CONS), et = lt.cases[cons].fields[0].t;
    const x = g.locals.push(et) - 1;
    const code = k.gen(local(x), false);
    const l = apart(g, "choose", [lt], code, [x]);
    const head = l.h.locals.push(et) - 1, rest = l.h.locals.push(lt) - 1, res = l.h.locals.push("i32") - 1;
    l.fixed.set(x, head);
    const moved = move(code, g, l.h, l.fixed);
    const scrut = local(0);
    const again: SExpr = { k: "call", fn: l.hi, args: [local(rest), ...l.free.map((_, j) => local(1 + j))], tail: true };
    l.h.body = {
      k: "case", scrut, s: 0, t: lt, result: "i32",
      arms: lt.cases.map((_, c): SExpr => (c !== cons ? { k: "fail" } : {
        k: "let", i: head, value: { k: "field", rec: scrut, t: lt, c, i: 0 },
        body: { k: "let", i: rest, value: { k: "field", rec: scrut, t: lt, c, i: 1 }, body: { k: "attempt", body: moved, res, ok: local(res), otherwise: again, t: "i32" } },
      })),
    };
    // Where a count's alternatives are shared (C43), the runtime may keep
    // only one item of a run's first choice.
    const split = opts.host ? !fibers && countsShared().size > 0 : !!opts.threads && splitsC();
    return { k: "call", fn: l.hi, args: [split ? { k: "rt", fn: "choose.split", args: [list], ...(opts.host ? {} : { host: { t: lt, partial: false } }) } : list, ...l.passed], tail };
  }
  // A call of a function with several answers: the rest of the search as
  // a closure (or the caller's own k, when the call is all that's left).
  function callSeveral(fn: number, args: SExpr[], k: Cont, tail: boolean, g: SFunc): SExpr {
    return { k: "call", fn, args: [...args, restOf(funcs[fn].answer!, k, g)], tail, cps: true };
  }
  // The rest of a search, k, as a closure taking an answer of type t.
  function restOf(t: LType, k: Cont, g: SFunc): SExpr {
    const kt = kOf(t);
    let kv = k.direct;
    if (!kv) {
      const v = g.locals.push(t) - 1;
      const code = k.gen(local(v), true);
      const free = freeLocals(code).filter((i) => i !== v);
      const shape = shapes.push({ t: kt, caps: free.map((i) => g.locals[i]) }) - 1;
      const c: SFunc = { def: g.def, name: `${g.name.replace(/\.(choose|k|join)$/, "")}.k`, params: [kt, t], result: "i32", locals: [kt, t], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, partial: true };
      const ci = funcs.push(c) - 1;
      const fixed = new Map([[v, 1]]);
      const lets = free.map((i, j) => { const l = c.locals.push(g.locals[i]) - 1; fixed.set(i, l); return { i: l, value: { k: "cap", t: kt, shape, i: j } as SExpr }; });
      c.body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), move(code, g, c, fixed));
      kv = { k: "closure", t: kt, fn: ci, shape, caps: free.map(local) };
    }
    return kv;
  }
  // es in order, then done with their values: those before one with
  // several answers go into locals first, so they're computed once, first.
  function inOrder(es: SExpr[], done: (vs: SExpr[], tail: boolean) => SExpr, tail: boolean, g: SFunc): SExpr {
    const m = es.findIndex(several);
    if (m < 0) return done(es.map(untail), tail);
    const lets: { i: number; value: SExpr }[] = [];
    const before = es.slice(0, m).map((e) => {
      if (trivial(e)) return e;
      const i = g.locals.push(typeIn(e, g)) - 1;
      lets.push({ i, value: untail(e) });
      return local(i);
    });
    const rest = cps(es[m], { gen: (v, tl) => inOrder(es.slice(m + 1), (ws, tl2) => done([...before, v, ...ws], tl2), tl, g) }, tail, g);
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), rest);
  }
  // e, with k on each of its answers: code giving what k gives.
  function cps(e: SExpr, k: Cont, tail: boolean, g: SFunc): SExpr {
    if (!several(e)) return k.gen(untail(e), tail);
    const arms = (xs: (SExpr | null)[]) => xs.filter((x) => x && x.k !== "fail").length;
    switch (e.k) {
      case "choose": return inOrder([e.list], ([l], tl) => choose(l, e.t, k, tl, g), tail, g);
      case "call": if (funcs[e.fn].multi && !e.cps) return inOrder(e.args, (vs, tl) => callSeveral(e.fn, vs, k, tl, g), tail, g); break;
      // A closure of a several type is given the rest (C137c22).
      case "apply": if (e.t.several && !e.cps) return inOrder([e.fn, ...e.args], ([fv, ...vs], tl) => ({ k: "apply", fn: fv, t: e.t, args: [...vs, restOf(e.t.answer!, k, g)], tail: tl, tmp: e.tmp, cps: true }), tail, g); break;
      // A wait is given the rest of the handler (C40 step 4).
      case "world": if (e.suspends && !e.cps) return inOrder(e.args, (vs) => ({ ...e, args: [...vs, restOf(e.t, k, g)], t: "i32", cps: true }), tail, g); break;
      case "let":
        if (several(e.value) && e.seeded) return seededAround(e, k, g);
        if (several(e.value)) return cps(e.value, { gen: (v, tl) => ({ k: "let", i: e.i, value: v, body: cps(e.body, k, tl, g) }) }, tail, g);
        return { k: "let", i: e.i, value: untail(e.value), body: cps(e.body, k, tail, g) };
      case "if": {
        if (several(e.cond)) return cps(e.cond, { gen: (c, tl) => cps({ ...e, cond: c }, k, tl, g) }, tail, g);
        const j = join(k, e.t, g, arms([e.then, e.else]));
        return { k: "if", cond: e.cond, then: cps(e.then, j, tail, g), else: cps(e.else, j, tail, g), t: "i32" };
      }
      case "case": {
        if (several(e.scrut)) return cps(e.scrut, { gen: (v, tl) => cps({ ...e, scrut: v }, k, tl, g) }, tail, g);
        const j = join(k, e.result, g, arms(e.arms));
        return { ...e, arms: e.arms.map((a) => a && cps(a, j, tail, g)), result: "i32" };
      }
      case "search": if (opts.host && waits(e.body)) return handledThen(e, k, g); break;
      case "budget": if (waits(e.body) && !opts.host) throw new Refused("waits inside with fuel (not lowered yet)"); if (!several(e.otherwise)) return outside(e, k, g); break;
      // A handler of Abort around several answers, or a wait (C182): each
      // answer goes on to the rest outside it, so an abort in the rest
      // isn't the handler's. Its frame says when the rest is running
      // (core-rt.ts `rest.in`, `rest.out`); the arm's answer goes on too.
      case "handle": {
        const fr = g.locals.push("host") - 1, j = join(k, e.t, g, 2), at = local(fr);
        const mark = (fn: string): SExpr => ({ k: "rt", fn, args: [at], host: { t: "i32", partial: false } });
        // The answer worked out first, inside; the rest's own no answer
        // (going back for the next) ends the rest too.
        const out = (x: SExpr): SExpr => ({ k: "let", i: g.locals.push("i32") - 1, value: mark("rest.out"), body: x });
        const rest: Cont = { gen: (v) => {
          const a = g.locals.push(e.t) - 1, r = g.locals.push("i32") - 1;
          const run: SExpr = { k: "attempt", body: j.gen(local(a), false), res: r, ok: out(local(r)), otherwise: out({ k: "fail" }), t: "i32" };
          return { k: "let", i: a, value: v, body: { k: "let", i: g.locals.push("i32") - 1, value: mark("rest.in"), body: run } };
        } };
        return { ...e, body: cps(e.body, rest, false, g), arm: cps(e.arm, j, false, g), t: "i32", frame: fr };
      }
      case "attempt": {
        if (several(e.body)) break;
        const j = join(k, e.t, g, arms([e.ok, e.otherwise]));
        return { ...e, ok: cps(e.ok, j, tail, g), otherwise: cps(e.otherwise, j, tail, g), t: "i32" };
      }
    }
    if (["op", "call", "make", "new", "rt", "world", "get", "field", "tag", "apply", "abort"].includes(e.k)) {
      return inOrder(kids(e), (vs, tl) => { let j = 0; return k.gen(untail(mapKids(e, () => vs[j++])), tl); }, tail, g);
    }
    throw new Refused("chooses among several answers where WebAssembly can't yet");
  }
  // `with fuel` around several answers (C137c21): each answer goes on to
  // the rest of the search, which runs on the fuel of the budget outside,
  // so the fuel is swapped around it. The outside's fuel is kept in a box
  // (the rest may be moved into a join or a closure), put back after the
  // budget whichever way it ends. As in the evaluator, running out ends
  // that budget's search: the inside's has no more answers; once the
  // outside's ran out, the rest isn't run again and nothing after answers.
  function outside(e: Extract<SExpr, { k: "budget" }>, k: Cont, g: SFunc): SExpr {
    const box = boxOf("f64"), b = g.locals.push(box) - 1;
    const got: SExpr = { k: "get", rec: local(b), t: box, i: 0 };
    const swap = (x: SExpr): SExpr => ({ k: "rt", fn: "fuel.swap", args: [x] });
    const fail: SExpr = { k: "fail" };
    const ranOut: SExpr = { k: "op", op: "less", args: [got, { k: "num", v: 0 }] };
    const rest: Cont = {
      // The answer is worked out inside, on the inside's fuel; then the rest.
      gen: (v) => {
        const answer = g.locals.push(e.t) - 1, inner = g.locals.push("f64") - 1, r = g.locals.push("i32") - 1;
        const back = (then: SExpr): SExpr => ({ k: "set", rec: local(b), t: box, i: 0, value: swap(local(inner)), then });
        const run: SExpr = { k: "attempt", body: k.gen(local(answer), false), res: r, ok: back(local(r)), otherwise: back(fail), t: "i32", spent: true };
        return { k: "let", i: answer, value: v, body: { k: "if", cond: ranOut, then: fail, else: { k: "let", i: inner, value: swap(got), body: run }, t: "i32" } };
      },
    };
    const inside: SExpr = { ...e, body: cps(e.body, rest, false, g), otherwise: fail, t: "i32", res: g.locals.push("i32") - 1 };
    const r = g.locals.push("i32") - 1, put = (then: SExpr): SExpr => ({ k: "let", i: g.locals.push("f64") - 1, value: swap(got), body: then });
    const wrapped: SExpr = { k: "attempt", body: inside, res: r, ok: put({ k: "if", cond: ranOut, then: fail, else: local(r), t: "i32" }), otherwise: put(fail), t: "i32" };
    return { k: "let", i: b, value: { k: "make", t: box, args: [{ k: "rt", fn: "fuel.get", args: [] }] }, body: wrapped };
  }
  // `seeded` around several answers (C178): the inside draws from its own
  // generator, which goes on from answer to answer as the evaluator's
  // handler's state does, and each answer goes on to the rest of the
  // search on the generator outside, so the two are swapped around it.
  // The outside's state is kept in boxes (the rest may be moved into a
  // join or a closure), put back once the inside has no more answers.
  function seededAround(e: Extract<SExpr, { k: "let" }>, k: Cont, g: SFunc): SExpr {
    const after = e.body;
    if (after.k !== "let" || after.value.k !== "rt" || after.value.fn !== "rand.restore") throw new Refused("seeds Random around several answers in a way not lowered yet");
    const box = boxOf("f64"), boxes = after.value.args.map(() => g.locals.push(box) - 1);
    const got = (b: number): SExpr => ({ k: "get", rec: local(b), t: box, i: 0 });
    const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
    const fail: SExpr = { k: "fail" };
    const restore = (xs: SExpr[], then: SExpr): SExpr => ({ k: "let", i: g.locals.push("f64") - 1, value: rt("rand.restore", ...xs), body: then });
    const rest: Cont = {
      gen: (v) => {
        const inner = boxes.map(() => g.locals.push("f64") - 1), r = g.locals.push("i32") - 1;
        // Back inside: the outside's state as the rest left it, then the inside's.
        const back = (then: SExpr): SExpr => boxes.reduceRight<SExpr>((x, b, j) => ({ k: "set", rec: local(b), t: box, i: 0, value: rt(`rand.s${j}`), then: x }), restore(inner.map(local), then));
        const run: SExpr = { k: "attempt", body: cps(after.body, k, false, g), res: r, ok: back(local(r)), otherwise: back(fail), t: "i32" };
        const swapped = restore(boxes.map(got), run);
        return { k: "let", i: e.i, value: v, body: inner.reduceRight<SExpr>((x, l, j) => ({ k: "let", i: l, value: rt(`rand.s${j}`), body: x }), swapped) };
      },
    };
    const r = g.locals.push("i32") - 1, put = (then: SExpr): SExpr => restore(boxes.map(got), then);
    const wrapped: SExpr = { k: "attempt", body: cps(e.value, rest, false, g), res: r, ok: put(local(r)), otherwise: put(fail), t: "i32" };
    return boxes.reduceRight<SExpr>((x, b, j) => ({ k: "let", i: b, value: { k: "make", t: box, args: [after.value.k === "rt" ? after.value.args[j] : fail] }, body: x }), wrapped);
  }
  // A handler's search, now that it's known whether it has several answers.
  function handled(e: Extract<SExpr, { k: "search" }>, g: SFunc): SExpr {
    const caseOf = (d: LType, v: Id) => (isData(d) ? d.cases.findIndex((c) => c.variant === v) : -1);
    const d = e.t as DType;
    const made = (v: Id, args: SExpr[]): SExpr => ({ k: "new", t: d, c: caseOf(d, v), args });
    const dflt = (): SExpr => e.dflt ?? { k: "fail" };
    if (!several(e.body)) {
      // One answer or none.
      const answer = local(e.res);
      const [ok, otherwise]: [SExpr, SExpr] = e.kind === "first" ? [answer, dflt()] : e.kind === "count" ? [countOf(e.t, 1), countOf(e.t, 0)]
        : e.kind === "optional" ? [made(SOME, [answer]), made(NONE, [])] : [made(CONS, [answer, made(NIL, [])]), made(NIL, [])];
      return { k: "attempt", body: e.body, res: e.res, ok, otherwise, t: e.t };
    }
    if (waits(e.body) && !opts.host) throw new Refused(`waits inside ${e.kind} (not lowered yet)`);
    const acc: LType = e.kind === "count" ? e.t : e.kind === "all" ? e.t : e.bt, box = boxOf(acc);
    const b = g.locals.push(box) - 1, got: SExpr = { k: "get", rec: local(b), t: box, i: 0 };
    const set = (value: SExpr, then: SExpr): SExpr => ({ k: "set", rec: local(b), t: box, i: 0, value, then });
    const keep: Cont["gen"] = e.kind === "first" || e.kind === "optional" ? (v) => set(v, { k: "bool", v: true })
      : e.kind === "all" ? (v) => set(made(CONS, [v, got]), { k: "fail" })
      // count: the answer is still computed, since it may turn out to be none.
      : (v) => ({ k: "let", i: g.locals.push(e.bt) - 1, value: v, body: set(countPlusOne(acc, got), { k: "fail" }) });
    const start: SExpr = e.kind === "count" ? countOf(acc, 0) : e.kind === "all" ? made(NIL, []) : { k: "zero", t: acc };
    const run = cps(e.body, { gen: keep }, false, g), r = g.locals.push("i32") - 1;
    const back: SExpr = { k: "call", fn: e.kind === "all" ? reverse(d) : -1, args: [got, made(NIL, [])], tail: false };
    const [ok, otherwise]: [SExpr, SExpr] = e.kind === "first" ? [got, dflt()] : e.kind === "optional" ? [made(SOME, [got]), made(NONE, [])] : e.kind === "all" ? [back, back] : [got, got];
    const searched: SExpr = { k: "attempt", body: run, res: r, ok, otherwise, t: e.t };
    // Where a count's alternatives are shared (C43), a search inside the
    // one split keeps every item of its own choices.
    let inner: SExpr = searched;
    // In C (C203) the split is a thread's own, an f64; the one the threads
    // split keeps it.
    if ((opts.host ? !fibers && countsShared().size > 0 : opts.threads && splitsC() && !e.splits) && !waits(e.body)) {
      const ht: LType = opts.host ? "host" : "f64", host = opts.host ? {} : { host: { t: ht, partial: false } };
      const held = g.locals.push(ht) - 1, v = g.locals.push(e.t) - 1;
      inner = { k: "let", i: held, value: { k: "rt", fn: "split.hold", args: [], ...host }, body: { k: "let", i: v, value: searched, body: { k: "let", i: g.locals.push(ht) - 1, value: { k: "rt", fn: "split.give", args: [local(held)], ...host }, body: local(v) } } };
    }
    return { k: "let", i: b, value: { k: "make", t: box, args: [start] }, body: inner };
  }
  // A search that waits (C181), its value going on to k: the collector,
  // with k after its ok and its otherwise.
  function handledThen(e: Extract<SExpr, { k: "search" }>, k: Cont, g: SFunc): SExpr {
    const h = handled(e, g);
    const into = (x: SExpr): SExpr => {
      if (x.k === "let") return { ...x, body: into(x.body) };
      if (x.k !== "attempt") throw new Refused(`waits inside ${e.kind} in a way not lowered yet`);
      const j = join(k, e.t, g, 2);
      const then = (v: SExpr): SExpr => { const i = g.locals.push(e.t) - 1; return { k: "let", i, value: v, body: j.gen(local(i), false) }; };
      return { ...x, ok: then(x.ok), otherwise: then(x.otherwise), t: "i32" };
    };
    return into(h);
  }
  // The handlers' searches in e made code, innermost first.
  // One that waits is left to cps (handledThen).
  const handle = (e: SExpr, g: SFunc): SExpr => { const r = mapKids(e, (x) => handle(x, g)); return r.k === "search" && !(opts.host && waits(r.body)) ? handled(r, g) : r; };
  // Every attempt whose body may wait (C181): see `resumes`.
  const resuming = (e: SExpr): SExpr => { const r = mapKids(e, resuming); return (r.k === "attempt" || r.k === "budget") && opts.host && waits(r.body) ? { ...r, resumes: true } : r; };
  // After a root and what it calls are lowered: which have several
  // answers, then their code, and every handler's.
  function several_(from: number) {
    const end = funcs.length;
    for (let changed = true; changed;) {
      changed = false;
      for (let i = from; i < end; i++) if (!funcs[i].multi && (several(funcs[i].body) || (closureCode.has(i) && (funcs[i].params[0] as FType).several))) { funcs[i].multi = true; funcs[i].answer = funcs[i].result; changed = true; }
      for (let i = from; i < end; i++) if (!waiting.has(i) && waits(funcs[i].body)) { waiting.add(i); changed = true; }
    }
    for (let i = from; i < end; i++) {
      const g = funcs[i];
      if (!g.multi) { g.body = handle(g.body, g); continue; }
      // A closure's code: its type says it takes the rest, last; one whose
      // type doesn't yet starts lowering again (C137c22).
      if (closureCode.has(i)) {
        const ct = g.params[0] as FType;
        if (!ct.several) throw new NeedsSeveral(ct.key);
        const p = g.params.length - 1, kt = g.params[p] as FType;
        g.result = "i32";
        g.partial = true;
        const k: Cont = { direct: local(p), gen: (v, tail) => ({ k: "apply", fn: local(p), t: kt, args: [v], tail, tmp: g.locals.push(kt) - 1 }) };
        g.body = cps(handle(g.body, g), k, true, g);
        continue;
      }
      const p = g.params.length, kt = kOf(g.answer!);
      const body = mapLocals(g.body, (j) => (j < p ? j : j + 1));
      g.locals = [...g.locals.slice(0, p), kt, ...g.locals.slice(p)];
      g.params = [...g.params, kt];
      g.result = "i32";
      g.partial = true;
      g.inner = true;
      const k: Cont = { direct: local(p), gen: (v, tail) => ({ k: "apply", fn: local(p), t: kt, args: [v], tail, tmp: g.locals.push(kt) - 1 }) };
      g.body = cps(handle(body, g), k, true, g);
    }
    // The functions made for the rest (joins, a choice's loop) included,
    // which may wait too (C181).
    if (opts.host) {
      for (let changed = true; changed;) { changed = false; for (let i = from; i < funcs.length; i++) if (!waiting.has(i) && waits(funcs[i].body)) { waiting.add(i); changed = true; } }
      for (let i = from; i < funcs.length; i++) funcs[i].body = resuming(funcs[i].body);
    }
  }
  // A function whose answer, somewhere it ends, is cons(x, itself(…))
  // (ledger's entries) recurses once per item, so a long list runs out of
  // stack. Instead it keeps the items so far, newest first, in one more
  // input, so each such end is a tail call, and every other end gives
  // them turned round onto its answer: the same list, built in the same
  // order. (Tail recursion modulo cons, done by reversing rather than
  // filling holes, since WasmGC cells are immutable; the JS backend
  // fills holes, G22.)
  function modCons(from: number) {
    const end = funcs.length;
    for (let i = from; i < end; i++) {
      const g = funcs[i], t = g.result;
      if (g.multi || g.spends || g.budgeted || closureCode.has(i) || !isData(t)) continue;
      const cons = t.cases.findIndex((c) => c.variant === CONS), nil = t.cases.findIndex((c) => c.variant === NIL);
      if (cons < 0 || nil < 0) continue;
      const self = (e: SExpr): e is Extract<SExpr, { k: "new" }> => {
        if (e.k !== "new" || e.t.key !== t.key || e.c !== cons) return false;
        const last = e.args[e.args.length - 1];
        return last.k === "call" && last.fn === i && !last.cps;
      };
      const ends = (e: SExpr): boolean =>
        self(e) || (e.k === "let" && ends(e.body)) || (e.k === "if" && (ends(e.then) || ends(e.else))) || (e.k === "case" && e.arms.some((a) => a !== null && ends(a)));
      if (!ends(g.body)) continue;
      const p = g.params.length;
      const h: SFunc = { ...g, name: `${g.name}.onto`, params: [...g.params, t], locals: [...g.locals.slice(0, p), t, ...g.locals.slice(p)], inner: true, body: { k: "num", v: 0 } };
      const hi = funcs.push(h) - 1, acc: SExpr = { k: "local", i: p };
      const onto = (e: SExpr): SExpr => {
        switch (e.k) {
          case "let": return { ...e, body: onto(e.body) };
          case "if": return { ...e, then: onto(e.then), else: onto(e.else) };
          case "case": return { ...e, arms: e.arms.map((a) => (a === null ? null : onto(a))) };
          case "fail": case "abort": return e;
          case "call": if (e.fn === i && e.tail) return { ...e, fn: hi, args: [...e.args, acc] }; break;
          case "new": if (self(e)) {
            // Its other fields first, as written, then the call's inputs.
            const xs = e.args.slice(0, -1).map((x) => ({ i: h.locals.push(typeIn(x, h)) - 1, value: x }));
            const call = e.args[e.args.length - 1] as Extract<SExpr, { k: "call" }>;
            const body: SExpr = { k: "call", fn: hi, tail: true, args: [...call.args, { k: "new", t, c: cons, args: [...xs.map((x): SExpr => ({ k: "local", i: x.i })), acc] }] };
            return xs.reduceRight<SExpr>((b, x) => ({ k: "let", i: x.i, value: x.value, body: b }), body);
          }
        }
        // Not a tail call any more: its answer is turned round onto.
        return { k: "call", fn: reverse(t), tail: true, args: [acc, "tail" in e && e.tail ? { ...e, tail: false } as SExpr : e] };
      };
      h.body = onto(mapLocals(g.body, (j) => (j < p ? j : j + 1)));
      g.body = { k: "call", fn: hi, tail: true, args: [...g.params.map((_, j): SExpr => ({ k: "local", i: j })), { k: "new", t, c: nil, args: [] }] };
    }
  }
  // A list turned round onto another, a loop.
  function reverse(d: DType): number {
    const key = `reverse:${d.key}`;
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: d.def, name: `${d.name}.reverse`, params: [d, d], result: d, locals: [d, d], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    index.set(key, gi);
    const cons = d.cases.findIndex((c) => c.variant === CONS), l: SExpr = { k: "local", i: 0 };
    g.body = { k: "case", scrut: l, s: 0, t: d, result: d, arms: d.cases.map((_, k): SExpr => (k !== cons ? { k: "local", i: 1 } : {
      k: "call", fn: gi, tail: true, args: [{ k: "field", rec: l, t: d, c: k, i: 1 }, { k: "new", t: d, c: k, args: [{ k: "field", rec: l, t: d, c: k, i: 0 }, { k: "local", i: 1 }] }],
    })) };
    return gi;
  }
  // changed(value, path, part) (L163, C100): the path is written out where
  // it is used (path of a chain of fields, item path, then path), so the
  // value is rebuilt along it: a field step makes the record again with
  // that field changed, an item step a function of its own that walks the
  // list to the item. A place that isn't there (an item past the end, a
  // field of another case) leaves the value as it was, as cells.ts
  // changeAt does.
  type PathStep = { field: Id } | { item: Id };
  function stepsOfPath(id: Id): PathStep[] {
    const n = code.nodes[id], head = isCall(n) ? code.nodes[n.fn] : undefined;
    const op = head?.kind === "ref" ? head.target : undefined;
    if (isCall(n) && op === CELL_OPS.path && n.args.length === 1) {
      const l = code.nodes[n.args[0]];
      if (l?.kind === "lambda" && l.params.length === 1) {
        const fields: PathStep[] = [];
        let b = code.nodes[l.body];
        for (; isCall(b) && b.args.length === 1; b = code.nodes[b.args[0]]) {
          const h = code.nodes[b.fn];
          if (h?.kind !== "ref" || code.nodes[h.target]?.kind !== "field") break;
          fields.unshift({ field: h.target });
        }
        if (b?.kind === "ref" && b.target === l.params[0]) return fields;
      }
    }
    if (isCall(n) && op === CELL_OPS.itemPath && n.args.length === 2) return [...stepsOfPath(n.args[0]), { item: n.args[1] }];
    if (isCall(n) && op === CELL_OPS.thenPath && n.args.length === 2) return [...stepsOfPath(n.args[0]), ...stepsOfPath(n.args[1])];
    throw new Refused("changes a value at a path that isn't written out where it's used (a chain of fields and items)");
  }
  function changed(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const t = stype(zonk(id)), xt = stype(zonk(n.args[2]));
    if (!t || !xt) throw new Refused(`changes ${whyNot(zonk(t ? n.args[2] : id))}`);
    const steps = stepsOfPath(n.args[1]);
    // Each item's position is worked out once, before the value is rebuilt.
    const lets: { i: number; value: SExpr }[] = [];
    const keep = (e: SExpr, lt: LType): SExpr => { const i = f.locals.push(lt) - 1; lets.push({ i, value: e }); return { k: "local", i }; };
    const v = keep(expr(n.args[0], env, f, false), t);
    const at = steps.map((s) => ("item" in s ? keep(expr(s.item, env, f, false), "int") : null));
    const x = keep(expr(n.args[2], env, f, false), xt);
    const body = along(v, t, steps, at, x, xt, f);
    return lets.reduceRight<SExpr>((e, l) => ({ k: "let", i: l.i, value: l.value, body: e }), body);
  }
  // set(field, record, value) (C106): the path is fields written in place
  // (the checker insists), so the record is made again along it with that
  // field changed, the way changed does for a path of fields.
  function setField(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const t = stype(zonk(id)), xt = stype(zonk(n.args[2]));
    if (!t || !xt) throw new Refused(`sets a field of ${whyNot(zonk(t ? n.args[2] : id))}`);
    const path = fieldPath(code, n.args[0]);
    if (!path) throw new Refused("sets a field that isn't written in place");
    const vl = f.locals.push(t) - 1, xl = f.locals.push(xt) - 1;
    const body = along({ k: "local", i: vl }, t, path.map((field) => ({ field })), path.map(() => null), { k: "local", i: xl }, xt, f);
    return { k: "let", i: vl, value: expr(n.args[1], env, f, false), body: { k: "let", i: xl, value: expr(n.args[2], env, f, false), body } };
  }
  // v (a local) of type t with the place at steps changed to x. `at` holds
  // the item steps' positions, as expressions g can read.
  function along(v: SExpr, t: LType, steps: PathStep[], at: (SExpr | null)[], x: SExpr, xt: LType, g: SFunc): SExpr {
    if (!steps.length) return x;
    const [s, ...rest] = steps, inner = (part: SExpr, pt: LType): SExpr => {
      const i = g.locals.push(pt) - 1;
      return { k: "let", i, value: part, body: along({ k: "local", i }, pt, rest, at.slice(1), x, xt, g) };
    };
    if ("field" in s) {
      const fi = fieldIndex(code, s.field);
      if (isRecord(t)) return { k: "make", t, args: t.fields.map((fl, j) => (j === fi ? inner({ k: "get", rec: v, t, i: j }, fl.t) : { k: "get", rec: v, t, i: j })) };
      if (isData(t)) {
        const c = t.cases.findIndex((cs) => (code.nodes[cs.variant] as NodeOf<"variant">).fields.includes(s.field));
        if (c < 0) throw new Refused(`changes ${nm(s.field)} of a value without it`);
        const sl = g.locals.push(t) - 1, sv: SExpr = { k: "local", i: sl };
        const arms = t.cases.map((cs, k): SExpr => (k !== c ? sv : { k: "new", t, c, args: cs.fields.map((fl, j) => (j === fi ? inner({ k: "field", rec: sv, t, c, i: j }, fl.t) : { k: "field", rec: sv, t, c, i: j })) }));
        return { k: "case", scrut: v, s: sl, t, arms, result: t };
      }
      throw new Refused(`changes ${nm(s.field)} of something that isn't a record`);
    }
    const ci = isData(t) ? t.cases.findIndex((c) => c.variant === CONS) : -1;
    if (!isData(t) || ci < 0) throw new Refused("changes an item of something that isn't a List");
    // A function of its own: the list, the position, the later positions
    // and the part; it walks to the item and makes the list again up to it.
    const later = at.slice(1).filter((a): a is SExpr => !!a);
    const params: LType[] = [t, "int", ...later.map(() => "int" as LType), xt];
    const h: SFunc = { def: t.def, name: `${t.name}.changed`, params, result: t, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const hi = funcs.push(h) - 1;
    const loc = (i: number): SExpr => ({ k: "local", i }), l = loc(0), pos = loc(1);
    let p = 2;
    const at2 = at.slice(1).map((a) => (a ? loc(p++) : null)), x2 = loc(p);
    const item = t.cases[ci].fields[0].t, sl = h.locals.push(t) - 1, cell: SExpr = loc(sl);
    const head: SExpr = { k: "field", rec: cell, t, c: ci, i: 0 }, tl: SExpr = { k: "field", rec: cell, t, c: ci, i: 1 };
    const hl = h.locals.push(item) - 1;
    const here: SExpr = { k: "let", i: hl, value: head, body: { k: "new", t, c: ci, args: [(() => { const r = along(loc(hl), item, rest, at2, x2, xt, h); return r; })(), tl] } };
    const on: SExpr = { k: "new", t, c: ci, args: [head, { k: "call", fn: hi, args: [tl, { k: "rt", fn: "int.sub", args: [pos, { k: "int", v: 1n }] }, ...at2.filter((a): a is SExpr => !!a), x2], tail: false }] };
    const less = (y: bigint): SExpr => ({ k: "rt", fn: "int.less", args: [pos, { k: "int", v: y }] });
    h.body = { k: "case", scrut: l, s: sl, t, result: t, arms: t.cases.map((_, k): SExpr => (k !== ci ? l : { k: "if", cond: less(0n), then: l, else: { k: "if", cond: less(1n), then: here, else: on, t }, t })) };
    return { k: "call", fn: hi, args: [v, at[0]!, ...later, x], tail: false };
  }
  // seeded(seed, body) (C106): the generator's words as the body found
  // them are kept, it's seeded, the body runs, and they're put back, so an
  // outer seeded goes on where it was. random() is rand.next.
  function seeded(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const t = stype(zonk(id));
    if (!t || n.args.length !== 2) throw new Refused(`seeds Random around ${whyNot(zonk(id))}`);
    const lam = code.nodes[n.args[1]];
    const body = lam?.kind === "lambda" && lam.params.length === 0 ? expr(lam.body, env, f, false)
      : (() => { const ft = stype(zonk(n.args[1])); if (!ft || !isFn(ft)) throw new Refused("seeds Random around a function it can't call"); return { k: "apply", fn: expr(n.args[1], env, f, false), t: ft, args: [], tail: false, tmp: f.locals.push(ft) - 1 } as SExpr; })();
    const keep = [0, 1, 2, 3].map(() => f.locals.push("f64") - 1), seedL = f.locals.push("f64") - 1, done = f.locals.push("f64") - 1, v = f.locals.push(t) - 1;
    const rt = (fn: string, ...args: SExpr[]): SExpr => ({ k: "rt", fn, args });
    // Where the program handles Random too (C183): the seeded generator is
    // the nearest handler while the body runs, so a handler of the
    // program's further out doesn't answer its draws (core-rt.ts
    // `seeded.in`, `seeded.out`, however the body ends).
    const own = tailOps.get(RANDOM_OP) === RANDOM;
    const ran: SExpr = !own ? body : { k: "let", i: f.locals.push("i32") - 1, value: { k: "rt", fn: `seeded.in:${RANDOM}`, args: [], host: { t: "i32", partial: false } },
      body: { k: "released", body, release: { k: "rt", fn: `seeded.out:${RANDOM}`, args: [], host: { t: "i32", partial: false } }, t, st: f.locals.push("i32") - 1 } };
    const lets: [number, SExpr][] = [
      ...keep.map((l, k): [number, SExpr] => [l, rt(`rand.s${k}`)]),
      [seedL, rt("rand.seed", expr(n.args[0], env, f, false))],
      [v, ran],
      [done, rt("rand.restore", ...keep.map((l): SExpr => ({ k: "local", i: l })))],
    ];
    // The let of the body's value is marked: a body with several answers
    // keeps its own generator from answer to answer (cps, seededAround).
    return lets.reduceRight<SExpr>((e, [i, value]) => ({ k: "let", i, value, body: e, ...(i === v ? { seeded: true as const } : {}) }), { k: "local", i: v });
  }
  // value of(o): o's value if it's some, no answer if it's none.
  function valueOf(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const d = stype(zonk(n.args[0])), t = stype(zonk(id));
    if (!d || !isData(d) || !t) throw new Refused(`takes the value of ${whyNot(zonk(d ? id : n.args[0]))}`);
    const s = f.locals.push(d) - 1, some = d.cases.findIndex((c) => c.variant === SOME);
    return { k: "case", scrut: expr(n.args[0], env, f, false), s, t: d, result: t, arms: d.cases.map((_, ci): SExpr => (ci === some ? { k: "field", rec: { k: "local", i: s }, t: d, c: ci, i: 0 } : { k: "fail" })) };
  }

  // first(() => with fuel(n, () => body), () => otherwise), and nothing
  // else made of those two. With `data`, with fuel(n, () => body) alone
  // too: running out is no answer, as in the evaluator, for the nearest
  // first (or the caller) to see.
  function budget(n: Call, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const thunk = (x: Id | undefined) => { const l = x && code.nodes[x]; return l && l.kind === "lambda" && !l.params.length ? l.body : null; };
    const alone = !!opts.data && (code.nodes[n.fn] as NodeOf<"ref">).target === S.fuel;
    const action = alone ? null : thunk(n.args[0]), otherwise = alone ? null : thunk(n.args[1]);
    const inner = alone ? n : action ? code.nodes[action] : null;
    const head = isCall(inner) ? code.nodes[inner.fn] : null;
    const who = opts.data ? "this profile" : "a shader";
    const shape = `only as a budget, ${opts.data ? `with fuel(n, () => …) or ${BUDGET}` : BUDGET}`;
    if ((!alone && ((code.nodes[n.fn] as NodeOf<"ref">).target !== S.first || !action || !otherwise)) || !isCall(inner) || head?.kind !== "ref" || head.target !== S.fuel || inner.args.length !== 2)
      throw new Refused(`uses first or with fuel, which ${who} takes ${shape}`);
    // A number written down, rounded to Float32 maybe (NUMBERS.md).
    const rounded = code.nodes[inner.args[0]];
    const under = isCall(rounded) && code.nodes[rounded.fn]?.kind === "ref" && (code.nodes[rounded.fn] as NodeOf<"ref">).target === S.float32 && rounded.args.length === 1;
    const amount = under ? code.nodes[(rounded as Call).args[0]] : rounded, body = thunk(inner.args[1]);
    if (!body) throw new Refused(`uses with fuel, which ${who} takes ${shape}`);
    if (amount?.kind !== "lit" || typeof amount.value !== "number") throw new Refused(`has a budget that isn't a number written down (${opts.data ? "this profile's" : "a shader's"} bound is fixed when it's built)`);
    const v = under ? Math.fround(amount.value) : amount.value;
    if (!(v >= 0 && v <= MAX_FUEL && Math.fround(v) === v)) throw new Refused(`has a budget of ${v} (${opts.data ? "this profile's" : "a shader's"} is a number from 0 to ${MAX_FUEL})`);
    const t = stype(zonk(id));
    if (!t) throw new Refused(`has a budget whose value is ${OTHER}`);
    const save = f.locals.push("f64") - 1, res = f.locals.push(t) - 1;
    const outer = underBudget;
    underBudget = true;
    let inside: SExpr;
    try { inside = expr(body, env, f, false); } finally { underBudget = outer; }
    if (alone || !opts.data) return { k: "budget", n: v, body: inside, otherwise: alone ? { k: "fail" } : expr(otherwise!, env, f, false), t, save, res };
    // With `data`: the body's first answer, if it has one, is optional's,
    // so a body with no answer gives `otherwise` as running out does (as in
    // the evaluator, where first sees no answer either way), and a body with
    // several answers is a search like any other's (C137c14). `otherwise`
    // runs after the budget, outside it, as there.
    const ot = stype({ t: "con", id: OPTIONAL, args: [zonk(id)] });
    if (!ot || !isData(ot)) throw new Refused(`has a budget whose value is ${OTHER}`);
    const some = ot.cases.findIndex((c) => c.variant === SOME), none = ot.cases.findIndex((c) => c.variant === NONE);
    const found: SExpr = { k: "search", kind: "optional", body: inside, res: f.locals.push(t) - 1, t: ot, bt: t };
    const ran: SExpr = { k: "budget", n: v, body: found, otherwise: { k: "new", t: ot, c: none, args: [] }, t: ot, save, res: f.locals.push(ot) - 1 };
    const s = f.locals.push(ot) - 1;
    return { k: "case", scrut: ran, s, t: ot, result: t, arms: ot.cases.map((_, ci): SExpr => (ci === some ? { k: "field", rec: { k: "local", i: s }, t: ot, c: ci, i: 0 } : expr(otherwise!, env, f, false))) };
  }

  // A root that may not finish is refused as a place to start, even when
  // it was lowered to be called from under a budget.
  const unstarted = new Map<Id, string>();
  // map parts, zip parts and total: the function applied to each part, as
  // the record's fields would be written by hand. A part that is already
  // an expression (the record was just built) is used as it is; otherwise
  // the record goes in a local first, so it's computed once.
  function parts(n: Call, env: Map<Id, number>, f: SFunc): SExpr {
    const target = (code.nodes[n.fn] as NodeOf<"ref">).target;
    const recs = target === S.total ? n.args : n.args.slice(1);
    const t = stype(zonk(recs[0]));
    if (t !== "f64" && (!t || !isRecord(t) || t.fields.some((x) => x.t !== "f64"))) throw new Refused(`takes the parts of something that isn't a record of Float64s`);
    const lets: { i: number; value: SExpr }[] = [];
    const partsOf = (id: Id): SExpr[] => {
      const e = expr(id, env, f, false);
      if (t === "f64") return [e];
      if (e.k === "make") return e.args;
      let rec = e;
      if (e.k !== "local") { const i = f.locals.push(t) - 1; lets.push({ i, value: e }); rec = { k: "local", i }; }
      return t.fields.map((_, j) => ({ k: "get", rec, t, i: j }));
    };
    const ps = recs.map(partsOf);
    const width = ps[0].length;
    let out: SExpr;
    if (target === S.total) out = ps[0].reduce((a, b) => ({ k: "op", op: "add", args: [a, b] }));
    else {
      const fnId = n.args[0], fnNode = code.nodes[fnId];
      const each = (j: number): SExpr => {
        const xs = ps.map((p) => p[j]);
        if (fnNode.kind === "lambda") {
          if (fnNode.params.length !== xs.length) throw new Refused("applies a function to the wrong number of inputs");
          let inner = new Map(env);
          const ls = fnNode.params.map((p, k) => { const i = f.locals.push("f64") - 1; inner = new Map(inner).set(p, i); return { i, value: xs[k] }; });
          return ls.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(fnNode.body, inner, f, false));
        }
        if (fnNode.kind === "ref" && scalarOp(fnNode.target)) { const e = { k: "op" as const, op: scalarOp(fnNode.target)!, args: xs }; return opts.shader ? e : checked(f, e, trying ? "flag" : false); }
        if (fnNode.kind === "ref" && code.nodes[fnNode.target]?.kind === "def") return { k: "call", fn: func(fnNode.target), args: xs, tail: false };
        throw new Refused("takes the parts with a function that isn't written here (that needs closures)");
      };
      const results = Array.from({ length: width }, (_, j) => each(j));
      out = t === "f64" ? results[0] : { k: "make", t, args: results };
    }
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), out);
  }

  // A root no call fixes the types of, generic over numbers (a literal is
  // some Number, WHAT-NUMBER-MEANS.md), is lowered at Float64: the default
  // Haskell gives an ambiguous number at the top.
  const defaults = (r: Id): At => {
    const raw = info.typeOf.get(r) && info.subst.zonk(info.typeOf.get(r)!);
    const s = info.subst;
    return new Map(raw ? [...new Set(vars(raw))].filter((v) => s.numbers.has(v) || s.arith.has(v)).map((v): [number, Type] => [v, { t: "con", id: NUMBER, args: [] }]) : []);
  };
  for (const r of roots) {
    const from = funcs.length, shaped = shapes.length;
    const raw = info.typeOf.get(r) && info.subst.zonk(info.typeOf.get(r)!), given = defaults(r);
    rootVars = new Set(raw ? vars(raw).filter((v) => !given.has(v)) : []);
    try { func(r, given); several_(from); modCons(from); } catch (e) {
      if (!(e instanceof Refused)) throw e;
      if (funcs.length > from && index.get(r) !== undefined && index.get(r)! >= from) {
        // Refused making its searches: undo it, and what was lowered with it.
        funcs.splice(from);
        shapes.splice(shaped);
        for (const [d2, j] of index) if (j >= from) index.delete(d2);
        for (const j of closureCode) if (j >= from) closureCode.delete(j);
        refused.set(r, e.message);
      } else if (!refused.has(r)) unstarted.set(r, e.message.replace(`calls ${nm(r)}, which `, ""));
    }
  }
  for (const [r, why] of unstarted) if (!refused.has(r)) refused.set(r, why);
  funcs.forEach((g, j) => { g.body = tidied(g, j).body; });
  // Refusals by definition; those of one specialization stay inside.
  const niche = opts.data ? niches(funcs, [...records.values()], [...datas.values()], [...arrays.values()], [...fns.values()], shapes, [...tables.values()]) : new Set<string>();
  const ir: CoreIR = { stops: sites, funcs, refused: new Map([...refused].filter(([k]) => !k.includes("|"))), records: [...records.values()], data: [...datas.values()].filter((d) => !niche.has(d.key)), arrays: [...arrays.values()], tables: [...tables.values()], fns: [...fns.values()], shapes, code, info, escapes: escapes.map((e) => stype({ t: "con", id: e, args: [] }) as DType), rounded, ...(opts.shader && !opts.data ? { shader: true as const } : {}), ...(!opts.data ? { int32: true as const } : {}) };
  // A record's Int field proved to fit 32 bits, stored as a machine word
  // (C150e): WebAssembly and C, not core JS, whose values the host reads.
  // A record a loop carries, its fields as values of their own (C68a); a
  // shader's records are its own values (vectors, structs) already.
  // A function written where a definition is called, called directly in
  // that definition's own copy (C30 s2c1), on the core IR's JavaScript.
  if (opts.data && opts.host) closureArgs(ir);
  if (opts.data) loopRecords(ir);
  if (opts.data && !opts.host) { machineWords(ir); wideProducts(ir); }
  // The fuel is endless outside a budget, so where no budget is set
  // (`with fuel`, or the fuel a search outside one swaps in) nothing
  // spends it (C171): no count per call of a function that may not end.
  // A shader keeps its own (its loops must end).
  const setsFuel = (e: SExpr): boolean => e.k === "budget" || (e.k === "rt" && e.fn.startsWith("fuel.")) || kids(e).some(setsFuel);
  if (opts.data && !funcs.some((f) => setsFuel(f.body))) for (const f of funcs) f.spends = false;
  return ir;
}

// A Float64 is finite (L125c2, FLOAT-VALUES-2026-11-01.md §2), on
// WebAssembly and C as on the evaluator (run.ts finiteFloat) and compiled
// JavaScript (runtime.js $fin): the reasons a program stops, by number.
export { STOPS };
const [DIV0, MOD0, SQRT, LOG, POW0, POWNEG, OVERFLOW] = STOPS.map((_, i) => i);

// The checks for a Float64 operation the program calls (`call`, made in
// f), as it is lowered. No answer is checked on the argument, unless it's
// a literal that can't be one; an overflow late, where it could vanish or
// decide something: a comparison (less, equal, compare), a divisor, exp
// and atan2 (which turn ∞ into finite values), show, range and a
// conversion. Through + − · IEEE keeps it ∞ or NaN, so a chain is checked
// once, and one nothing uses isn't reported. Only the program's own
// operations are checked: the lowering's own arithmetic (equal's nearness,
// which subtracts) is left alone. A shader has no checks: a GPU can't stop.
// Unlike on the evaluator and in compiled JavaScript, the stop isn't an
// Abort a handler in the program gets: it ends the program.
const num = (v: number): SExpr => ({ k: "num", v });
const op = (o: Op, ...args: SExpr[]): SExpr => ({ k: "op", op: o, args });
// The stop's site (C143, stops.ts): which node it is lowered from, set by
// lowerScalar while it lowers one.
let stopSite: () => number = () => -1;
const stopWith = (i: number): SExpr => op("stop", num(i + SITES * (stopSite() + 1)));
const stop = stopWith;
const iff = (cond: SExpr, then: SExpr, otherwise: SExpr): SExpr => ({ k: "if", cond, then, else: otherwise, t: "f64" });
// When bad, the stops in why; otherwise ok.
const guard = (bad: SExpr, why: SExpr, ok: SExpr): SExpr => ({ k: "if", cond: bad, then: why, else: ok, t: "f64", check: true });
// e without its checks: what a GPU runs, which can't stop.
// Optional Float64 and Extended Float64 as one f64 (L125e,
// FLOAT-VALUES-2026-11-01.md §4, Rust's niche): every Float64 is finite
// (L125a), so the f64s that aren't are free for the other cases. Extended's
// infinities are IEEE's ±∞ and its finite(x) is x; Optional's none is NaN
// and its some(x) is x, so Optional (Extended Float64) is one f64 too.
// Made after lowering, over what it made: a value of a case is its f64, a
// match tests which f64 it is, and every type that held one holds an f64
// instead. Gives the keys of the data types no longer used.
type Niche = { values: number[]; test: (c: number, x: SExpr) => SExpr };
function niches(funcs: SFunc[], records: RType[], datas: DType[], arrays: AType[], fns: FType[], shapes: Shape[], tables: TType[] = []): Set<string> {
  const plain = (t: LType) => t === "f64";
  const op = (o: Op, ...args: SExpr[]): SExpr => ({ k: "op", op: o, args });
  const is = (x: SExpr, v: number): SExpr => op("equal", x, { k: "num", v });
  const found = new Map<string, Niche>();
  const fits = (t: LType) => plain(t) || (typeof t === "object" && found.has((t as DType).key));
  for (let more = true; more;) {
    more = false;
    for (const d of datas) {
      if (found.has(d.key)) continue;
      const v = (id: Id) => d.cases.findIndex((c) => c.variant === id), [none, some] = [v(NONE), v(SOME)];
      const [minus, fin, plus] = [v(EXTENDED_V.minus), v(EXTENDED_V.finite), v(EXTENDED_V.plus)];
      if (d.cases.length === 2 && none >= 0 && some >= 0 && !d.cases[none].fields.length && d.cases[some].fields.length === 1 && fits(d.cases[some].fields[0].t)) {
        // x = x for every f64 but NaN.
        found.set(d.key, { values: d.cases.map((_, c) => (c === none ? NaN : 0)), test: (c, x) => (c === some ? op("equal", x, x) : op("not", op("equal", x, x))) });
        more = true;
      } else if (d.cases.length === 3 && minus >= 0 && fin >= 0 && plus >= 0 && d.cases[fin].fields.length === 1 && plain(d.cases[fin].fields[0].t)) {
        found.set(d.key, { values: d.cases.map((_, c) => (c === minus ? -Infinity : c === plus ? Infinity : 0)), test: (c, x) => (c === minus ? is(x, -Infinity) : c === plus ? is(x, Infinity) : op("and", op("not", is(x, -Infinity)), op("not", is(x, Infinity)))) });
        more = true;
      }
    }
  }
  const keys = new Set(found.keys());
  if (!keys.size) return keys;
  const on = (t: LType | undefined): t is DType => !!t && typeof t === "object" && isData(t) && keys.has(t.key);
  const ty = (t: LType): LType => (on(t) ? "f64" : t);
  // The case with a field: its value is the field's.
  const full = (d: DType) => d.cases.findIndex((c) => c.fields.length === 1);
  // A host still gives and gets these as data: a function it calls with
  // one in its type keeps that type, as a wrapper around the function on
  // f64s (which becomes inner).
  const outer = funcs.flatMap((f, i) => (!f.inner && !f.budgeted && !f.multi && [...f.params, f.result].some(on) ? [{ i, params: f.params, result: f.result }] : []));
  for (const r of records) r.fields.forEach((x) => { x.t = ty(x.t); });
  for (const d of datas) d.cases.forEach((c) => c.fields.forEach((x) => { x.t = ty(x.t); }));
  for (const a of arrays) a.item = ty(a.item);
  for (const h of tables) h.value = ty(h.value);
  for (const t of [...fns, ...shapes.map((sh) => sh.t)]) { t.params = t.params.map(ty); t.result = ty(t.result); }
  for (const sh of shapes) sh.caps = sh.caps.map(ty);
  for (const f of funcs) {
    const named = (x: SExpr, body: (l: SExpr) => SExpr): SExpr => {
      if (x.k === "local") return body(x);
      const i = f.locals.push("f64") - 1;
      return { k: "let", i, value: x, body: body({ k: "local", i }) };
    };
    const walk = (e0: SExpr): SExpr => {
      // Two values' cases compared (equal and compare do it): the same
      // answer to each case's test.
      if (e0.k === "op" && e0.op === "beq" && e0.args.every((a) => a.k === "tag" && on(a.t))) {
        const [a, b] = e0.args as Extract<SExpr, { k: "tag" }>[], t = a.t, n = found.get(t.key)!;
        return named(walk(a.rec), (x) => named(walk(b.rec), (y) => t.cases.slice(1).reduce<SExpr>((acc, _, c) => op("and", acc, op("beq", n.test(c + 1, x), n.test(c + 1, y))), op("beq", n.test(0, x), n.test(0, y)))));
      }
      const e = mapKids(e0, walk);
      switch (e.k) {
        case "new": return on(e.t) ? (e.c === full(e.t) ? e.args[0] : { k: "num", v: found.get(e.t.key)!.values[e.c] }) : e;
        case "field": return on(e.t) ? e.rec : e;
        case "tag": if (on(e.t)) throw new Error(`a case's number of ${e.t.name}, held as an f64`); return e;
        case "case": {
          const result = ty(e.result);
          if (!on(e.t)) return { ...e, result };
          const n = found.get(e.t.key)!, x: SExpr = { k: "local", i: e.s };
          // A missing arm is one the checker rules out.
          const arm = (c: number): SExpr => e.arms[c] ?? { k: "zero", t: result };
          const last = e.arms.length - 1;
          const body = e.arms.slice(0, -1).reduceRight<SExpr>((rest, _, c) => ({ k: "if", cond: n.test(c, x), then: arm(c), else: rest, t: result }), arm(last));
          return { k: "let", i: e.s, value: e.scrut, body };
        }
        case "if": case "budget": case "attempt": case "world": case "handle": case "released": case "zero": return { ...e, t: ty(e.t) } as SExpr;
        default: return e;
      }
    };
    f.body = walk(f.body);
    f.params = f.params.map(ty);
    f.locals = f.locals.map(ty);
    f.result = ty(f.result);
    if (f.answer) f.answer = ty(f.answer);
  }
  // The wrappers, which see the data types: a value's f64 from its case,
  // and back.
  const used = new Set<string>();
  for (const { i, params, result } of outer) {
    const f = funcs[i], loc = (j: number): SExpr => ({ k: "local", i: j });
    const w: SFunc = { def: f.def, name: f.name, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, ...(f.partial ? { partial: true } : {}) };
    f.inner = true;
    f.name = `${f.name}.f64`;
    const args = params.map((t, j): SExpr => {
      if (!on(t)) return loc(j);
      used.add(t.key);
      const s2 = w.locals.push(t) - 1;
      return { k: "case", scrut: loc(j), s: s2, t, result: "f64", arms: t.cases.map((_, c): SExpr => (c === full(t) ? { k: "field", rec: loc(s2), t, c, i: 0 } : { k: "num", v: found.get(t.key)!.values[c] })) };
    });
    if (on(result)) {
      used.add(result.key);
      const r = w.locals.push("f64") - 1, n = found.get(result.key)!;
      const back = result.cases.slice(0, -1).reduceRight<SExpr>((rest, _, c) => ({ k: "if", cond: n.test(c, loc(r)), then: { k: "new", t: result, c, args: c === full(result) ? [loc(r)] : [] }, else: rest, t: result }),
        { k: "new", t: result, c: result.cases.length - 1, args: result.cases.length - 1 === full(result) ? [loc(r)] : [] });
      w.body = { k: "let", i: r, value: { k: "call", fn: i, args, tail: false }, body: back };
    } else w.body = { k: "call", fn: i, args, tail: true };
    funcs.push(w);
  }
  for (const k of used) keys.delete(k);
  return keys;
}

export const unchecked = (e: SExpr): SExpr => {
  if (e.k === "if" && e.check) return unchecked(e.else);
  if (e.k === "let" && e.check) {
    const value = unchecked(e.value), body = unchecked(e.body);
    return value.k === "local" || value.k === "num" || reads(body, e.i) <= 1 ? put(body, e.i, value) : { k: "let", i: e.i, value, body };
  }
  return mapKids(e, unchecked);
};
const reads = (e: SExpr, i: number): number => (e.k === "local" ? Number(e.i === i) : kids(e).reduce((n, x) => n + reads(x, i), 0));
// e with local i read as v (held's locals, read once the checks are gone).
const put = (e: SExpr, i: number, v: SExpr): SExpr => (e.k === "local" && e.i === i ? v : mapKids(e, (x) => put(x, i, v)));
const lit = (e: SExpr) => (e.k === "num" ? e.v : e.k === "op" && e.op === "neg" && e.args[0].k === "num" ? -e.args[0].v : null);
// x as a local of f, then body given it.
const held = (f: SFunc, x: SExpr, body: (l: SExpr) => SExpr): SExpr => {
  if (x.k === "local" || x.k === "num") return body(x);
  const i = f.locals.push("f64") - 1;
  return { k: "let", i, value: x, body: body({ k: "local", i }), check: true };
};
const isFinite = (l: SExpr) => op("equal", op("sub", l, l), num(0));
// x, which must be finite here.
export const fin = (f: SFunc, x: SExpr): SExpr => (lit(x) !== null ? x : held(f, x, (l) => guard(op("not", isFinite(l)), stop(OVERFLOW), l)));
const LATE: Partial<Record<Op, true>> = { less: true, equal: true, exp: true };
export const RT_LATE = new Set(["number.show", "number.range", "int.wholePart"]);
// `none`: no answer is a Choice the function gives (a fail) instead of a
// stop; "flag": inside a search's body in the plain profile (C166), it
// raises the flag and goes on with a zero, as a shader's search does. It
// is still a check: a printer that runs as the GPU does (wgsl.ts,
// js-scalar.ts) drops it with the others and goes on with NaN, so the
// copy is the same code there and WGSL's built-ins (length) are kept.
function checked(f: SFunc, r: Extract<SExpr, { k: "op" }>, none: boolean | "flag" = false): SExpr {
  const [a, b] = r.args;
  const stop = (i: number): SExpr => (none === "flag" && i !== OVERFLOW ? { k: "zero", t: "f64", none: true } : none && i !== OVERFLOW ? { k: "fail" } : stopWith(i));
  switch (r.op) {
    case "div": case "mod": {
      const v = lit(b);
      if (v !== null && v !== 0) return r;
      return held(f, b, (lb) => guard(op("equal", lb, num(0)), stop(r.op === "div" ? DIV0 : MOD0), op(r.op, a, fin(f, lb))));
    }
    case "sqrt": { const v = lit(a); return v !== null && v >= 0 ? r : held(f, a, (l) => guard(op("less", l, num(0)), stop(SQRT), op("sqrt", l))); }
    case "log": return held(f, a, (l) => guard(op("or", op("less", l, num(0)), op("equal", l, num(0))), stop(LOG), op("log", l)));
    case "pow": return held(f, a, (la) => held(f, b, (lb) => held(f, op("pow", la, lb), (p) =>
      guard(op("not", op("and", isFinite(p), op("and", isFinite(la), isFinite(lb)))),
        iff(op("and", op("equal", la, num(0)), op("less", lb, num(0))), stop(POW0),
          iff(op("and", op("less", la, num(0)), op("and", isFinite(lb), op("not", op("equal", op("floor", lb), lb)))), stop(POWNEG), stop(OVERFLOW))),
        p))));
    // −0 is 0, as on the evaluator: atan2(−0, −1) is π.
    case "atan2": return { ...r, args: r.args.map((x) => (lit(x) !== null ? num(lit(x)! + 0) : op("add", fin(f, x), num(0)))) };
    default: return LATE[r.op] ? { ...r, args: r.args.map((x) => fin(f, x)) } : r;
  }
}
