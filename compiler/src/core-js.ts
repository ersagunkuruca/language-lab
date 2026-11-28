// JavaScript printed from the core IR (C137c, docs/design/targets/CORE-IR.md):
// the printer that is to replace compile.ts, which lowers the model a
// second way. Grown in steps, checked by the fuzz test (C101) against the
// evaluator; this first step takes the `data` profile's values and
// control, with Int, Text and Array through the evaluator's own builtins.
//
// Values are the evaluator's (C137c6), so the evaluator's runtime (the
// library, tables, pages and cells) takes them as they are: a Float64 is
// a number, an Int a number while small, else a bigint (int.ts), a Text a
// string, a record or a data type's value an object of its case's class
// with `tag` and its fields (C138c; `fields` gives them as run.ts Data has),
// a closure a function of its inputs holding what it captured, an Array
// the evaluator's. Only a Bool differs: a boolean, turned at the runtime's
// edge. No answer (Choice) is the exception `FAIL`,
// caught by the nearest attempt; an abort is an `Aborted`, caught by its
// handler; a budget running out is `OUT`. A runtime function or world
// operation this printer doesn't have yet throws `Unsupported` when it is
// reached, so a program runs as far as it can. Tables and Hash sets are
// the evaluator's (C137c2), Random seeded is random.ts's generator, and
// the world is the evaluator's Runtime (C137c3, runCoreMain).

import { keepingWhole } from "../../ters/src/lang/check-cache.ts";
import { keysOver } from "../../ters/src/lang/def-keys.ts";
import { overLiterals } from "../../ters/src/lang/literals-again.ts";
import { shareCalls } from "./share-calls.ts";
import { addedMemoFuncs, listMemoFuncs, MEMO_SIZE, memoFuncs } from "./memo-calls.ts";
import { inlineCalls, inlineSmall } from "./inline-small.ts";
import { knownClosures } from "./known-closures.ts";
import { itemPaths } from "./item-paths.ts";
import { chosenParts } from "./chosen-parts.ts";
import { keptItems, pushedInOrder } from "./kept-items.ts";
import { intRanges } from "./int-ranges.ts";
import { loopRecords } from "./loop-records.ts";
import { boundedReads, countedInts, keptArraysOf, keptColumns } from "./kept-arrays.ts";
import { ownedArrays } from "./owned-arrays.ts";
import { ownPushes, ownedPerValue, sharedHolders } from "./holders.ts";
import { columns } from "./columns.ts";
import { linearCalls } from "./linear-calls.ts";
import { arrayOffsets } from "./array-offsets.ts";
import { ownedPushes } from "./owned-pushes.ts";
import { ownedRecords } from "./owned-records.ts";
import { ownedTables } from "./owned-tables.ts";
import { envSet, zeroParts } from "./zero-parts.ts";
import { ARITH, ARRAY_OPS, BYTES_V, FALSE, FIRST, HTML_V, PAIR_V, S, SECOND, TRUE } from "../../ters/src/lang/std.ts";
import { STD_IMPL, STD_MANY } from "../../ters/src/lang/std-impl.ts";
import { toList, type Runtime } from "../../ters/src/lang/run.ts";
import { fusedProgram } from "./handlers.ts";
import { checksKept, infer, type Info } from "../../ters/src/lang/infer.ts";
import { useDirections } from "../../ters/src/lang/directions.ts";
import { withInverses } from "./inverses.ts";
import { withOperationLambdas } from "./operation-values.ts";
import { withCharacterMaps } from "./character-maps.ts";
import { withLiteralCalls } from "./literal-calls.ts";
import { hoistInvariants } from "./hoist.ts";
import { idsSeeded, ownerOfTypeParts, type Code, type Id, type NodeOf, type Use, nodeIds } from "../../ters/src/model.ts";
import { bindsOf } from "./uses.ts";
import { effectOfOperation, hostOp, ownOperations } from "../../ters/src/lang/hosts.ts";
import * as I from "../../ters/src/lang/int.ts";
import { gpuMaps } from "./gpu-maps.ts";
import { packsOf } from "./gpu-draws.ts";
import { keptOnGpu } from "./gpu-resident.ts";
import { rangeArrays, rangeChoices } from "./range-choices.ts";
import { originalOf, PRELUDE_DEFS, typedOriginalOf } from "../../ters/src/lang/prelude-ids.ts";
import { earlyAnd } from "./early-and.ts";
import { intArgs } from "./int-args.ts";
import { ARRAY_RT, emptyArray, isArray, isDual, isTable, endsAsBefore, fails, keyList, kids, listSteps, mapKids, RT, isData, isRecord, lowerScalar, poolHeld, type AType, type CoreIR, type LType, type Op, type RType, type SExpr, type SFunc, type TType } from "./scalar.ts";
import type { Type } from "../../ters/src/lang/types.ts";
import { runtime } from "./wasm-rt.ts";
import { siteOf, STOPS } from "./stops.ts";
import { BRANCH_NAMES, BRANCH_WORLDS, branches } from "./core-branches.ts";
import { floats } from "./core-floats.ts";
import { Aborted, FAIL, OUT, RUNTIME, Stopped, Unsupported, coreRuntime, runCoreFn, useBranches, useBuiltins, useFloats, type BuiltinOf, type HostOps, type MainSpec, type TableSpec } from "./core-rt.ts";
// The runtime is core-rt.ts's; these are here too, for the tests and
// tools that print and run in one.
// The solver too, for the programs run here that solve (core-solve.ts).
import { PLAN_NAMES, modePlan, noAnswer, solverPlan, writtenOut } from "./core-solve.ts";
// A solve (`solve:<id>`, `solveOne:<id>` or `solveAll:<id>`) as its printed plan, or null
// where the evaluator's solver runs it: one the equations' solver plans
// (C167a), or a mode plan whose forward calls are builtins and whose
// literals are plain (C167b). Worked out once per program (emitCoreJs is
// run more than once on one IR: usesSolver, solvesSlowly).
const plans = new WeakMap<Code, Map<string, string | null>>();
const plain = (v: unknown) => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v) && !Object.is(v, -0));
const printSolve = (code: Code, fn: string): string | null => {
  const m = /^(solve|solveOne|solveAll):(.*)$/.exec(fn);
  if (!m) return null;
  const [, way, id] = m, rest = `${way === "solveAll" ? "true" : way === "solveOne" ? '"one"' : "false"}, ${JSON.stringify(noAnswer(code, id))}`;
  const sp = solverPlan(code, id);
  if (sp) return `R.planned(({ ${PLAN_NAMES.join(", ")} }) => {\n${sp}\n}, ${rest})`;
  const mp = modePlan(code, id);
  // A builtin called as itself (an array's front and push, C196) goes by
  // its id, as core-rt.ts moded reads it back.
  const consts = mp?.consts.map((c) => (typeof c === "function" ? builtinIdOf(c) : c));
  if (!mp || !consts || !mp.forwards.every((f) => code.nodes[f]?.kind === "builtin") || !consts.every((c) => plain(c) || !!(c as { $builtin?: Id } | null)?.$builtin)) return null;
  // `one` (C184): one answer's binds (one bind as itself, `wrap`), or $no.
  const wrap = Object.keys(bindsOf(code.nodes[id] as Use)).length === 1;
  return `R.moded(($no, $eq, $int, F, K) => {\n${mp.code}\nif (typeof solve$$one === "function") { solve$.one = solve$$one; solve$.wrap = ${wrap}; }\nreturn solve$;\n}, ${JSON.stringify(mp.forwards)}, ${JSON.stringify(consts)}, ${rest})`;
};
const builtinIdOf = (f: unknown): { $builtin: Id } | null => {
  const id = Object.keys(STD_IMPL).find((k) => STD_IMPL[k] === f);
  return id && !STD_MANY[id] ? { $builtin: id } : null;
};
const planOf = (code: Code, fn: string): string | null => {
  let m = plans.get(code);
  if (!m) plans.set(code, (m = new Map()));
  if (!m.has(fn)) m.set(fn, printSolve(code, fn));
  return m.get(fn)!;
};
import { trackReads } from "./cell-paths.ts";
export { Aborted, FAIL, OUT, RUNTIME, Stopped, Unsupported, coreCall, coreRuntime, runCoreFn, type MainSpec, type TableSpec } from "./core-rt.ts";


// The runtime functions by name: the evaluator's builtin where there is
// one (scalar.ts RT and ARRAY_RT, read backwards), told to the runtime
// with whether it gives a Bool (wasm-rt.ts's signature), so the runtime
// needn't know scalar.ts (C149).
// Code printed and run here (loadCoreJs) may call any builtin, and run
// side by side.
useBuiltins(STD_IMPL, STD_MANY);
useBranches(branches);
useFloats(floats);
const BUILTIN = new Map<string, Id>([...Object.entries(RT), ...Object.entries(ARRAY_RT), [ARRAY_OPS.replaceAt, "array.replaceAt"]].map(([id, n]) => [n, id]));
function builtinOf(name: string): BuiltinOf | undefined {
  // An owned replace (C93 s4) is the replace's builtin, written in place.
  const plain = name.replace(/^array\.replaceOwned\./, "array.replaceAt.").replace(/^array\.pushFrontOwned\./, "array.pushFront.").replace(/^array\.pushOwned\./, "array.push.");
  const base = plain.replace(/\.a\d+$/, "");
  const id = BUILTIN.get(base === "array.get" ? "array.at" : base);
  return id ? [id, runtime(plain).result === "i32"] : undefined;
}
// Which of a map's entries lists are its keys alone (`keys of`): a list
// whose items are of the key's type.
// A table of Int keys is a DirectMap (std.ts, C215: pond's food; C60:
// swarm's motes, removed as they die, the keys there sliding up).
export const tableSpec = (t: TType): TableSpec => {
  const keys = t.set ? [] : t.entries.map((d) => keyList(t, d));
  const direct = t.keyT === "int" ? { direct: true as const } : pairKey(t) ? { pair: true as const } : {};
  return keys.some((x) => x) ? { set: t.set, keys, ...direct } : { set: t.set, ...direct };
};
// A map's key or a set's item a pair of Ints and Texts (rota's `(person,
// day)`): held by its parts (table.ts PairMap), each entry keeping its key
// beside it, which a set's items are listed from.
const pairKey = (t: TType): boolean => typeof t.keyT === "object" && isRecord(t.keyT) && t.keyT.fields.length === 2 && t.keyT.fields.every((f) => f.t === "int" || f.t === "text");
const tableSpecs = (ir: CoreIR): TableSpec[] => {
  return ir.tables.map((t) => tableSpec(t));
};

const INFIX: Partial<Record<Op, string>> = { add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "===", beq: "===", and: "&&", or: "||" };
// The runtime's builtins that are one operator on how values are held
// (core-rt.ts OWN, std.ts concat): Ints normalised, so equal ones are ===.
const RT_INFIX: Record<string, string> = { "text.concat": "+", "text.equal": "===", "int.equal": "===", "int.less": "<", "int.addSmall": "+", "int.subSmall": "-", "int.remainderSmallUp": "%" };
const MATH: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "abs", floor: "floor", float32: "fround", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", pow: "pow", atan2: "atan2" };


// The source of a function of the runtime giving every function, by name.
// `worlds`: the world's operations it calls, which the loader gives as
// R.worlds in that order. Functions are f0, f1, … with no comment naming
// their definitions (C170a): a stop names its definition through
// CoreIR.stops (C143b), and the rest of what a tool needs goes in C143's map.
// What in printed code may throw no answer (R.FAIL) rather than give it:
// anything of the runtime's but its stop, step and mod, the program's
// runtime and world functions, a try, a throw, a yield.
// A literal as printed (ex): a number, an Int, a Bool, a text.
const LITERAL = /^(?:\(?-?(?:[\d.]+(?:e[+-]?\d+)?n?|Infinity|NaN)\)?|true|false|"(?:[^"\\]|\\.)*")$/;
const THROWS = /\bR\.(?!FAIL\b|stop\(|step\(|mod\(|remk\()|\brt\d+\(|\bw\d+\(|\btry\b|\bthrow\b|\byield\b/;

// `only`: the functions printed (reachedFuncs), the rest left out.
const FILLED = /^filled(·|$)/;
export function emitCoreJs(ir: CoreIR, only?: Set<number>): { js: string; names: string[]; worlds: string[]; parts: string[][]; head: string[] } {
  const names = ir.funcs.map((_, i) => `f${i}`);
  // The partial functions, whose bodies may throw no answer (an attempt's try).
  const partialNames = new Set(names.filter((_, i) => ir.funcs[i].partial));
  // A closure carries its lambda's and captures' ids (C137c13) only for a
  // solver (or set and path) to look inside it: in a program with none, it doesn't
  // (C169), and no Map is made per closure.
  const printedPlan = (fn: string) => planOf(ir.code, fn) !== null;
  const looks = (e: SExpr): boolean => (e.k === "rt" && LOOKS_INSIDE.test(e.fn) && !printedPlan(e.fn)) || kids(e).some(looks);
  const carries = ir.funcs.some((f) => looks(f.body));
  const rts = new Map<string, string>();
  const noInlineInts = envSet("NO_INLINE_INTS");
  const rtName = (n: string) => { if (!rts.has(n)) rts.set(n, `rt${rts.size}`); return rts.get(n)!; };
  // A runtime function that gives no answer as FAIL rather than throwing
  // it (core-rt.ts tableFn's atv): named rv…, so an attempt holding it
  // needs no try (THROWS).
  const rvName = (n: string) => { if (!rts.has(n)) rts.set(n, `rv${rts.size}`); return rts.get(n)!; };
  const worlds: string[] = [];
  const worldName = (op: string) => { let i = worlds.indexOf(op); if (i < 0) i = worlds.push(op) - 1; return `w${i}`; };
  // Data written out whole (an operator list, a case with no fields) is
  // made once, at load, not at each call: nothing changes a value but a
  // search's box (`set`), which is never constant.
  const consts = new Map<string, string>();
  const constName = (src: string) => { if (!consts.has(src)) consts.set(src, `c${consts.size}`); return consts.get(src)!; };
  // One object per constructor (C138c): a class per case, its fields own
  // properties (f0, f1, …), where { tag, fields: [...] } was two objects.
  // The evaluator's runtime reads a value's `tag` and `fields` as before
  // (`fields` a getter giving them as an array), and a value it made
  // itself (a host builtin's, the world's, an event) is read by its
  // `fields` where it has no f0.
  const classes = new Map<string, string>();
  const made = (variant: Id, xs: string[]): string => {
    // Bytes hold their items as one array (C321), so `byte at` reads one
    // in place, not a list's cells from its start.
    if (variant === BYTES_V && xs.length === 1) xs = [`R.itemsOf(${xs[0]})`];
    const key = `${variant}/${xs.length}`;
    if (!classes.has(key)) classes.set(key, `K${classes.size}`);
    return `new ${classes.get(key)}(${xs.join(", ")})`;
  };
  let reads = 0;
  const read = (rec: string, i: number, pre: string[], d: string): string => {
    if (/^[\w$.]+$/.test(rec)) return `(${rec}.f${i} ?? ${rec}.fields[${i}])`;
    const t = `r${reads++}`;
    pre.push(`${d}const ${t} = ${rec};`);
    return `(${t}.f${i} ?? ${t}.fields[${i}])`;
  };
  const constant = (e: SExpr): boolean => ["num", "int", "text", "bool"].includes(e.k) || (((e.k === "new" && !stack(e.t)) || (e.k === "make" && !e.t.mutable && !e.t.owned)) && e.args.every(constant));
  // A fold's stack (scalar.ts framesOf), which only its own loop down and
  // loop up see and each uses once: a JavaScript array pushed on the way
  // down and popped on the way up, not a frame object a value (C137d21).
  // Not where a function giving several answers takes it: its answers
  // after the first go on from the same stack again (countdown's
  // permutations), which one array popped can't give.
  const shared = new Set<string>();
  const framesIn = (e: SExpr, out: Set<string>) => { const t = (e as { t?: { inner?: boolean; key?: string } }).t; if (t?.inner && t.key?.endsWith(".frames")) out.add(t.key); kids(e).forEach((k) => framesIn(k, out)); };
  for (const f of ir.funcs) if (f.multi) framesIn(f.body, shared);
  const stack = (t: { inner?: boolean; key: string }) => !!t.inner && t.key.endsWith(".frames") && !shared.has(t.key);
  const named = (x: string, pre: string[], d: string) => { if (/^[\w$]+$/.test(x)) return x; const t = `r${reads++}`; pre.push(`${d}const ${t} = ${x};`); return t; };
  // A case matched by its number in its type (C170c): each case's class
  // keeps it on its prototype as `$c`, beside the `tag` the evaluator's
  // runtime and the borders read. A value made outside (a builtin's, the
  // world's) has no `$c` and is looked up by its tag.
  const caseNo = new Map<string, number | null>();
  const noted = (variant: string, c: number) => { const was = caseNo.get(variant); caseNo.set(variant, was === undefined || was === c ? c : null); };
  const label = (t: { inner?: boolean; key: string; cases: { variant: string }[] }, c: number) => { if (!stack(t)) noted(t.cases[c].variant, c); return String(c); };
  const caseOf = (t: { cases: { variant: string }[] }, x: string) => `(${x}.$c ?? R.caseOf(${x}, ${constName(JSON.stringify(t.cases.map((c) => c.variant)))}))`;
  const scrutOf = (t: { inner?: boolean; key: string; cases: { variant: string }[] }, x: string) => (stack(t) ? `(${x}.length === 0 ? 0 : 1)` : caseOf(t, x));
  // The budget, only where one is set or spent from (C171). Only read (a
  // together or map run side by side, C41/C42), it is Infinity: nothing
  // sets one.
  const fuelUsed = (e: SExpr): boolean => e.k === "budget" || (e.k === "rt" && e.fn.startsWith("fuel.") && e.fn !== "fuel.get") || kids(e).some(fuelUsed);
  const fuel = ir.funcs.some((f) => f.spends || fuelUsed(f.body));
  // Deep recursion on the heap (C137c18, compile.ts's C21): a function in
  // a cycle of calls that aren't all its own tail calls (`x + sum(rest)`)
  // takes a JavaScript frame per call, and the stack holds some thousands.
  // Each gets a second copy, a generator whose calls in its cycle yield
  // what to call instead; past DEPTH plain calls deep, a call runs that
  // copy, and R.drive keeps the calls waiting in an array.
  const deep = deepFuncs(ir.funcs);
  // Arrays and tables of a type written in place (owned-arrays.ts,
  // owned-tables.ts): a definition giving one gives a new one each time it
  // is named, as holders.ts reads it (G3f).
  const written = new Set<number>(), writtenTables = new Set<number>();
  const writes = (e: SExpr): void => {
    if (e.k === "rt") {
      const m = /^array\.(replaceOwned|pushFrontOwned|pushOwned)\.a(\d+)$/.exec(e.fn); if (m) written.add(Number(m[2]));
      const t = /^table\.(putOwned|removeOwned)\.t(\d+)$/.exec(e.fn); if (t) writtenTables.add(Number(t[2]));
    }
    kids(e).forEach(writes);
  };
  ir.funcs.forEach((f) => writes(f.body));
  const gens = names.map((n) => `${n}$h`);
  // A closure's code with a heap copy has it as `.h`, and a heap copy's
  // apply that may call back into its cycle runs it on the heap (R.aph).
  const coded = new Map<string, Set<number>>();
  const closures = (e: SExpr): void => { if (e.k === "closure") { const s = coded.get(e.t.key) ?? new Set(); coded.set(e.t.key, s.add(e.fn)); } kidsOf(e).forEach(closures); };
  ir.funcs.forEach((f) => closures(f.body));
  const keptOf = keptArraysOf(ir);
  const selfLoops = (e: SExpr, i: number): boolean => (e.k === "call" && e.fn === i && e.tail) || kidsOf(e).some((k) => selfLoops(k, i));
  const heapCodes = [...deep.keys()].filter((i) => [...coded.values()].some((s) => s.has(i)));
  const memo = envSet("NO_MEMO") ? new Set<number>() : memoFuncs(ir, new Set(deep.keys()));
  const LISTWISE = new Set([PRELUDE_DEFS.keep, PRELUDE_DEFS.map, PRELUDE_DEFS["flat map"]]);
  const listMemo = envSet("NO_MEMO") || envSet("NO_LIST_MEMO") ? new Set<number>() : listMemoFuncs(ir, new Set(deep.keys()), (d) => LISTWISE.has(typedOriginalOf(originalOf(d))));
  const addedMemo = envSet("NO_MEMO") || envSet("NO_LIST_MEMO") ? new Set<number>() : addedMemoFuncs(ir, new Set(deep.keys()), (d) => typedOriginalOf(originalOf(d)) === PRELUDE_DEFS["set tree added all"]);
  const parts = ir.funcs.map((f, i) => {
    if (only && !only.has(i)) return [];
    // An array of numbers sorted (C355): JavaScript's own sort, the same
    // order as the merge scalar.ts wrote.
    if (f.sorts && ["f64", "int"].includes((f.params[0] as AType).item as string)) return [`function ${names[i]}(l0) {\n  return R.sortedNumbers(l0);\n}`];
    // A loop keeping two arrays or more, or counting in numbers, printed a
    // second time as it was (kept-arrays.ts): the first goes on in that
    // one where two are versions of one buffer, or a count isn't small.
    // One whose reads stay in their arrays, a third time with its checks
    // (`$c`), for where they may not.
    const plainCopy = () => {
      if (!selfLoops(f.body, i)) return [];
      const counted = countedInts(ir, i), kept = keptOf(i);
      const rows = new Set(kept.values()).size - keptColumns(ir, i, kept).size;
      return [
        ...(rows > 1 || counted ? [func(f, i, null, "written").replace(`function ${names[i]}(`, `function ${names[i]}$s(`)] : []),
        ...(counted && kept.size && boundedReads(ir, i, kept, counted) ? [func(f, i, null, "checked").replace(`function ${names[i]}(`, `function ${names[i]}$c(`)] : []),
      ];
    };
    // Its last eight inputs and answers kept, each given again for the
    // same inputs (memo-calls.ts, C352, C353).
    if (memo.has(i)) {
      const ps = f.params.map((_, j) => `l${j}`), m = `${names[i]}$k`;
      const same = ps.map((p, j) => `Object.is(${m}${j}[j], ${p})`).join(" && ");
      return [`const ${[...ps.map((_, j) => `${m}${j}`), `${m}r`].map((x) => `${x} = []`).join(", ")}; let ${m}n = 0;`,
        `function ${names[i]}(${ps.join(", ")}) {\n  for (let j = 0, e = Math.min(${m}n, ${MEMO_SIZE}); j < e; j++) if (${same}) return ${m}r[j];\n  const r = ${names[i]}$m(${ps.join(", ")});\n  const j = ${m}n++ % ${MEMO_SIZE}; ${ps.map((p, j) => `${m}${j}[j] = ${p};`).join(" ")} ${m}r[j] = r;\n  return r;\n}`,
        func(f, i, null).replace(`function ${names[i]}(`, `function ${names[i]}$m(`), ...plainCopy()];
    }
    // A keep, map or flat map's answers kept with its list and closure,
    // and a list with items put on its end worked out for those alone
    // (memo-calls.ts listMemoFuncs, C354 step 1).
    if (listMemo.has(i)) {
      const m = `${names[i]}$L`;
      return [`const ${m} = [];`,
        `function ${names[i]}(l0, l1) {
  const code = l1 && l1.code, caps = l1 && l1.caps;
  if (code === undefined || !caps) return ${names[i]}$m(l0, l1);
  for (let j = ${m}.length - 1; j >= 0; j--) {
    const e = ${m}[j];
    if (e.code !== code || !R.sameCaps(e.caps, caps)) continue;
    if (e.x === l0) return R.keptList(e.r);
    const rest = R.listAfter(e.x, l0);
    if (rest === undefined) continue;
    const more = ${names[i]}$m(rest, l1);
    if (more === R.FAIL) return more;
    e.x = R.keptList(l0); e.caps = caps; e.r = R.keptList(R.listJoined(e.r, more));
    return R.keptList(e.r);
  }
  const r = ${names[i]}$m(l0, l1);
  if (r !== R.FAIL) { ${m}.push({ x: R.keptList(l0), code, caps, r: R.keptList(r) }); if (${m}.length > ${MEMO_SIZE}) ${m}.shift(); }
  return R.keptList(r);
}`,
        func(f, i, null).replace(`function ${names[i]}(`, `function ${names[i]}$m(`), ...plainCopy()];
    }
    // Items added to a set tree (map-tree.ts `set tree added all`), its
    // answers kept with the list and the tree they were added to: called
    // again with that list with items pushed onto its end, the new items
    // are added to the last answer, the same set (memo-calls.ts
    // addedMemoFuncs, C354).
    if (addedMemo.has(i)) {
      const m = `${names[i]}$A`;
      return [`const ${m} = [];`,
        `function ${names[i]}(l0, l1) {
  for (let j = ${m}.length - 1; j >= 0; j--) {
    const e = ${m}[j];
    if (!Object.is(e.t, l1)) continue;
    if (e.x === l0) return e.r;
    const rest = R.listAfter(e.x, l0);
    if (rest === undefined) continue;
    const r = ${names[i]}$m(rest, e.r);
    if (r === R.FAIL) return r;
    e.x = R.keptList(l0); e.r = r;
    return r;
  }
  const r = ${names[i]}$m(l0, l1);
  if (r !== R.FAIL) { ${m}.push({ x: R.keptList(l0), t: l1, r }); if (${m}.length > ${MEMO_SIZE}) ${m}.shift(); }
  return r;
}`,
        func(f, i, null).replace(`function ${names[i]}(`, `function ${names[i]}$m(`), ...plainCopy()];
    }
    if (!deep.has(i)) return [func(f, i, null), ...plainCopy()];
    const ps = f.params.map((_, j) => `l${j}`).join(", ");
    const plain = func(f, i, null).replace(`function ${names[i]}(`, `function ${names[i]}$b(`);
    // A big frame counts for more (C339): housefit's pass back, 88 locals
    // 1008 calls deep, ran out of Node's stack under DEPTH plain calls.
    const w = 1 + (f.locals.length >> 5), up = w === 1 ? "depth++" : `depth += ${w}`, down = w === 1 ? "depth--" : `depth -= ${w}`;
    return [`function ${names[i]}(${ps}) {\n  if (depth > ${DEPTH}) return R.drive(${gens[i]}(${ps}));\n  ${up};\n  const r = ${names[i]}$b(${ps});\n  ${down};\n  return r;\n}`, plain, ...plainCopy(), func(f, i, deep.get(i)!)];
  });
  const text = parts.flat();
  const printed = (i: number) => !only || only.has(i);
  // A mode plan's data as this program's own (C137d23): made with its
  // classes and read by their fields, so the program's loops over what
  // a plan gives see one shape of cons, not two, and reading a field
  // doesn't make the fields' array.
  const own = (plan: string) => plan
    .replace(/\{ tag: ("[^"\\]*"), fields: \[([^[\]{}()]*)\] \}/g, (all, tag: string, args: string) => {
      const xs = args.trim() ? args.split(", ") : [];
      return xs.every((x) => /^[\w$]+$/.test(x)) ? made(JSON.parse(tag), xs) : all;
    })
    .replace(/\b([\w$]+)\.fields\[(\d+)\]/g, "($1.f$2 ?? $1.fields[$2])");
  const rtLines = [...rts].map(([n, v]) => {
    // A solve the equations' solver plans, its plan printed (C167a): no
    // node table and no evaluator for it.
    const plan = planOf(ir.code, n);
    if (plan) return `const ${v} = ${plan.startsWith("R.moded(") ? own(plan) : plan};`;
    const b = builtinOf(n);
    return `const ${v} = R.rt(${JSON.stringify(n)}${b ? `, ${JSON.stringify(b)}` : ""});`;
  });
  const head = [
    ...(fuel ? ["let fuel = Infinity;"] : []),
    // Plain calls of functions with a heap copy on JavaScript's stack now.
    "let depth = 0;",
    ...[...classes].map(([key, c]) => {
      const variant = key.slice(0, key.lastIndexOf("/")), n = Number(key.slice(key.lastIndexOf("/") + 1));
      const fs = Array.from({ length: n }, (_, j) => `x${j}`);
      const no = caseNo.get(variant);
      return `class ${c} { constructor(${fs.join(", ")}) {${fs.map((x, j) => ` this.f${j} = ${x};`).join("")} } get fields() { return [${fs.map((_, j) => `this.f${j}`).join(", ")}]; } }\n${c}.prototype.tag = ${JSON.stringify(variant)};${typeof no === "number" ? ` ${c}.prototype.$c = ${no};` : ""}`;
    }),
    ...[...consts].map(([src, v]) => `const ${v} = ${src};`),
    // A backwards search spends the budget too (C137c12).
    ...(fuel ? ["R.spending(() => --fuel >= 0);"] : []),
    ...rtLines,
    ...worlds.map((_, i) => `const w${i} = R.worlds[${i}];`),
  ];
  const js = [
    ...head,
    ...text,
    ...heapCodes.filter(printed).map((i) => `${names[i]}.h = ${gens[i]};`),
    // A partial function given out says no answer by throwing, as the
    // evaluator's runtime expects.
    // A call from outside starts at the depth it found, whatever it threw.
    `return { ${names.flatMap((n, i) => (printed(i) ? [[n, i] as const] : [])).map(([n, i]) => {
      const c = ir.funcs[i].partial ? `R.ck(${n}(...xs))` : `${n}(...xs)`;
      return deep.size ? `${n}: (...xs) => { const d = depth; try { return ${c}; } finally { depth = d; } }` : ir.funcs[i].partial ? `${n}: (...xs) => ${c}` : n;
    }).join(", ")} };`,
  ].join("\n");
  return { js, names, worlds, parts, head };

  // `cycle`: writing the heap copy, whose calls of these yield.
  // `mode`: "checked", a loop's reads of its kept arrays checked though
  // they stay in them (kept-arrays.ts boundedReads); "written", the loop
  // as written, none of kept-arrays.ts.
  function func(f: SFunc, i: number, cycle: Set<number> | null, mode: "fast" | "checked" | "written" = "fast"): string {
    let temps = 0;
    const call = (fn: number, xs: string[]) => (cycle?.has(fn) ? `(yield [${gens[fn]}, [${xs.join(", ")}]])` : `${names[fn]}(${xs.join(", ")})`);
    // A closure applied, given out FAIL as a value: on the heap in a heap
    // copy when it may be one of the cycle's (L72e1d).
    const ap = (t: { key: string }, xs: string[]) => (cycle && [...coded.get(t.key) ?? []].some((g) => cycle.has(g)) ? `(yield [R.aph, [${xs.join(", ")}]])` : `R.ap(${xs.join(", ")})`);
    // A catch that goes on puts the depth back as it was at its try.
    const keep = () => { if (!deep.size) return ["", ""]; const t = temp(); return [`const ${t} = depth; `, `depth = ${t}; `]; };
    const temp = () => `t${temps++}`;
    // The locals the printed body reads or sets: only those are declared.
    // The passes before leave slots behind (a let inlined or never read),
    // and conjugation's functions declared 1,700 locals they never used.
    const used = new Set<number>();
    const local = (j: number) => (used.add(j), `l${j}`);
    const self = (e: SExpr): boolean => (e.k === "call" && e.fn === i && e.tail) || kidsOf(e).some(self);
    const loops = self(f.body);
    // The arrays the loop keeps (kept-arrays.ts): each one's view, buffer,
    // start and length worked out once, before it. Where one of them
    // turned the buffer away from another (two versions of one array),
    // the loop as written goes on instead (`$s`), reading as before.
    const keptLocals = loops && !cycle && mode !== "written" ? keptOf(i) : new Map<number, number>();
    const kept = new Map<number, string>([...new Set(keptLocals.values())].sort((x, y) => x - y).map((j) => [j, `w${j}$`]));
    const keptItem = (w: string, j: string) => `${w}b[${w}s + ${j}]`;
    const columnsOf = keptLocals.size ? keptColumns(ir, i, keptLocals) : new Map<number, Set<number>>();
    const isColumns = (w: string) => [...kept].some(([j, v]) => v === w && columnsOf.has(j));
    const counted = loops && !cycle && mode !== "written" ? countedInts(ir, i) : null;
    const bounded = mode === "fast" && counted && keptLocals.size ? boundedReads(ir, i, keptLocals, counted) : null;
    const keptOfArg = (x: SExpr) => { const j = x.k === "local" ? keptLocals.get(x.i) : undefined; return j === undefined ? undefined : kept.get(j); };
    // How a statement leaves when what it reads has no answer (C137c15): the
    // function gives FAIL, or the nearest attempt in it takes its
    // otherwise; null where it must be thrown (a budget's or a handler's
    // body, which put things back as it passes).
    let onFail: string | null = f.partial ? "return R.FAIL;" : null;
    const within = <T>(exit: string | null, run: () => T): T => { const outer = onFail; onFail = exit; try { return run(); } finally { onFail = outer; } };
    // e's value where a statement begins (a let's value, an if's test), so
    // nothing computed before it waits: a partial call's FAIL is checked
    // here and leaves by onFail, without a throw.
    // An attempt's body, run: the name of the Bool saying it answered.
    function tried(e: Extract<SExpr, { k: "attempt" }>, pre: string[], d: string): string {
      // A remainder by a positive literal always has an answer (round 13
      // P4: pond's `first(remainder(c + side cells, side cells), else 0)`,
      // a quarter of its time in the try and the generic remainder): no
      // try, and a small Int's worked out in place.
      const b = e.body;
      if (b.k === "rt" && b.fn === "int.remainder" && b.args.length === 2 && b.args[1].k === "int" && b.args[1].v > 0n && b.args[1].v < 1n << 31n && !e.spent && !e.resumes && !fails(b.args[0], ir.funcs)) {
        pre.push(`${d}${local(e.res)} = R.remk(${ex(b.args[0], pre, d)}, ${b.args[1].v});`);
        return "true";
      }
      // `item at` likewise (the flock's `first(cells item at k, else [])`
      // for each of a bird's 27 cells): its check in place, no try.
      if (b.k === "rt" && /^array\.at\.a\d+$/.test(b.fn) && b.args.length === 2 && !e.spent && !e.resumes && !b.args.some((x) => fails(x, ir.funcs))) {
        const w = keptOfArg(b.args[0]);
        if (w && bounded) {
          pre.push(`${d}${local(e.res)} = ${keptItem(w, ex(b.args[1], pre, d))};`);
          return "true";
        }
        if (w) {
          const k = ex(b.args[1], pre, d), j = temp(), ok = temp();
          pre.push(`${d}const ${j} = ${k};`, `${d}const ${ok} = Number.isInteger(${j}) && ${j} >= 0 && ${j} < ${w}n;`, `${d}if (${ok}) ${local(e.res)} = ${keptItem(w, j)};`);
          return ok;
        }
        const x = ex(b.args[0], pre, d), k = ex(b.args[1], pre, d), a = temp(), j = temp(), ok = temp();
        pre.push(`${d}const ${a} = ${x} instanceof R.ArrayView ? ${x} : R.arrayView(${x}), ${j} = ${k};`, `${d}const ${ok} = Number.isInteger(${j}) && ${j} >= 0 && ${j} < ${a}.n;`, `${d}if (${ok}) ${local(e.res)} = ${a}.buf.items[${a}.start + ${j}];`);
        return ok;
      }
      const ok = temp(), label = temp(), [save, back] = keep();
      const body = within(`{ ${ok} = false; break ${label}; }`, () => block(e.body, { set: local(e.res), fails: true }, d + "  "));
      // A body whose every no answer leaves by its label, with nothing in
      // it that throws one (a partial closure's R.ck, the runtime's or the
      // world's functions, a nested try, a wait, a partial function), needs no try: `/` and
      // `sqrt` say no answer as a value (C189, GAPS.md round 12 B2).
      // A partial function's own body may throw it too (its R.ck), so a
      // call of one keeps the try.
      if (!e.spent && !e.resumes && !body.some((l) => THROWS.test(l) || [...l.matchAll(/\b([A-Za-z_$][\w$]*)\(/g)].some((m) => partialNames.has(m[1])))) {
        pre.push(`${d}let ${ok} = true;`, `${d}${label}: {`, ...body, `${d}  if (${local(e.res)} === R.FAIL) ${ok} = false;`, `${d}}`);
        return ok;
      }
      pre.push(`${d}${save}let ${ok} = true;`, `${d}${label}: try {`, ...body, `${d}  if (${local(e.res)} === R.FAIL) ${ok} = false;`, `${d}} catch (x) {`, `${d}  if (x !== R.FAIL${e.spent ? " && x !== R.OUT" : ""}) throw x;`, `${d}  ${back}${ok} = false;`, `${d}}`);
      return ok;
    }
    // A call's inputs where a statement begins: one that is a partial call
    // is checked as a slot when everything before it is a value already
    // (so computing it first changes no order).
    // fill-arrays.ts's `filled` called on the empty array, 0 and a count
    // starts from an empty array with room for that many (C303).
    function filledFrom(e: Extract<SExpr, { k: "call" }>, xs: string[], out: string[], d: string): string[] {
      const [a0, a1] = e.args;
      if (!FILLED.test(ir.funcs[e.fn].name) || xs.length < 3 || a0?.k !== "rt" || !/^array\.empty\.a\d+$/.test(a0.fn) || !((a1?.k === "num" || a1?.k === "int") && Number(a1.v) === 0)) return xs;
      const n = named(xs[2], out, d);
      return [`R.emptyFor(${n})`, xs[1], n, ...xs.slice(3)];
    }
    function inputs(args: SExpr[], out: string[], d: string): string[] {
      const atomic = (a: SExpr) => ["local", "num", "int", "text", "bool", "cap"].includes(a.k);
      return exs(args, out, d, (a, own, j) => (args.slice(0, j).every(atomic) ? slot(a, own, d) : ex(a, own, d)));
    }
    // y, worked out after the statements `own`, comes out different: it
    // calls something (which may do something, or read what they did), or
    // reads a local they set.
    const moved = (y: string, own: string[]) => !LITERAL.test(y) && (/[\w$]\(|\byield\b/.test(y) || [...new Set(y.match(/(?<![.\w$])[lpt]\d+(?![\w$])/g))].some((v) => own.some((l) => new RegExp(`(?<![.\\w$])${v} =(?!=)`).test(l))));
    // Inputs left to right. One that needs statements first (a let, an if,
    // a call put in place there) has them run after the inputs before it
    // are worked out: those that aren't literals are held in temps first,
    // so a call among them (a random draw, say) isn't moved after the
    // statements, nor a local read after they set it.
    function exs(args: SExpr[], pre: string[], d: string, one = (a: SExpr, own: string[], _j: number) => ex(a, own, d)): string[] {
      const xs: string[] = [];
      args.forEach((a, j) => {
        const own: string[] = [], x = one(a, own, j);
        if (own.length) xs.forEach((y, k) => { if (moved(y, own)) { const t = temp(); pre.push(`${d}const ${t} = ${y};`); xs[k] = t; } });
        pre.push(...own);
        xs.push(x);
      });
      return xs;
    }
    function slot(e: SExpr, out: string[], d: string): string {
      const partial = (e.k === "call" && ir.funcs[e.fn].partial) || (e.k === "apply" && e.t.partial);
      if (!onFail || !partial) return ex(e, out, d);
      let c: string;
      if (e.k === "call") c = call(e.fn, filledFrom(e, inputs(e.args, out, d), out, d));
      else { const fn = ex(e.fn, out, d), xs = inputs(e.args, out, d); out.push(`${d}${local(e.tmp)} = ${fn};`); c = ap(e.t, [local(e.tmp), ...xs]); }
      const t = temp();
      out.push(`${d}const ${t} = ${c};`, `${d}if (${t} === R.FAIL) ${onFail}`);
      return t;
    }

    // An expression, with the statements it needs first.
    function ex(e: SExpr, pre: string[], d: string): string {
      switch (e.k) {
        case "num": return Object.is(e.v, -0) ? "(-0)" : e.v < 0 ? `(${e.v})` : Number.isFinite(e.v) ? String(e.v) : e.v > 0 ? "Infinity" : e.v < 0 ? "(-Infinity)" : "NaN";
        case "int": { const v = I.norm(e.v); return typeof v === "bigint" ? `(${v}n)` : `(${v})`; }
        case "text": return JSON.stringify(e.v);
        case "bool": return String(e.v);
        case "local": return local(e.i);
        case "zero": if (e.none) return "R.fail()"; return zero(e.t, made);
        case "op": {
          const xs = exs(e.args, pre, d);
          if (INFIX[e.op]) return `(${xs[0]} ${INFIX[e.op]} ${xs[1]})`;
          if (e.op === "neg") return `(-${xs[0]})`;
          if (e.op === "not") return `(!${xs[0]})`;
          if (e.op === "mod") return `R.mod(${xs.join(", ")})`;
          // With where it is (C143), when the site is known.
          if (e.op === "stop") { const c = e.args[0].k === "num" ? e.args[0].v : -1, at = c >= 0 ? ir.stops?.[siteOf(c)] : undefined; return at ? `R.stop(${xs[0]}, ${[at.node, at.def, ...(at.name ? [at.name] : [])].map((x) => JSON.stringify(x)).join(", ")})` : `R.stop(${xs[0]})`; }
          if (MATH[e.op]) return `Math.${MATH[e.op]}(${xs.join(", ")})`;
          return `R.unsupported(${JSON.stringify(`op ${e.op}`)})`;
        }
        case "let": {
          // One nothing reads: worked out only for what it does.
          if (!readsLocal(e.body, e.i)) { if (!quiet(e.value)) pre.push(`${d}${ex(e.value, pre, d)};`); return ex(e.body, pre, d); }
          const v = ex(e.value, pre, d);
          if (v !== local(e.i)) pre.push(`${d}${local(e.i)} = ${v};`);
          return ex(e.body, pre, d);
        }
        case "if": {
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}let ${t};`, `${d}if (${c}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "call": {
          // Its inputs computed first: a call's own statements must not
          // come between them.
          const c = call(e.fn, filledFrom(e, exs(e.args, pre, d), pre, d));
          return ir.funcs[e.fn].partial ? `R.ck(${c})` : c;
        }
        case "make": {
          // Written into a local's value (C93 s5, owned-records.ts): every
          // input first, then the changed fields; a value made outside,
          // not one of the classes, is made again.
          if (e.into !== undefined) {
            const xs = e.args.map((a) => named(ex(a, pre, d), pre, d)), y = local(e.into);
            const fresh = made(e.t.variant, xs), k = fresh.slice(4, fresh.indexOf("("));
            const writes = xs.flatMap((x, i) => (e.same?.includes(i) ? [] : [`${y}.f${i} = ${x}`]));
            return `(${y} instanceof ${k} ? (${[...writes, y].join(", ")}) : ${fresh})`;
          }
          const v = made(e.t.variant, exs(e.args, pre, d)); return constant(e) ? constName(v) : v;
        }
        case "get": return read(ex(e.rec, pre, d), e.i, pre, d);
        case "new": {
          if (stack(e.t)) {
            if (e.c === 0) return "[]";
            const x = named(ex(e.args[0], pre, d), pre, d), a = named(ex(e.args[1], pre, d), pre, d);
            return `(${a}.push(${x}), ${a})`;
          }
          noted(e.t.cases[e.c].variant, e.c);
          // Written into a local's cell (C279, scalar.ts turned): every
          // input first, then the changed fields; anything else made anew.
          if (e.into !== undefined) {
            const xs = e.args.map((a) => named(ex(a, pre, d), pre, d)), y = local(e.into);
            const fresh = made(e.t.cases[e.c].variant, xs), k = fresh.slice(4, fresh.indexOf("("));
            const writes = xs.flatMap((x, i) => (e.same?.includes(i) ? [] : [`${y}.f${i} = ${x}`]));
            return `(${y} instanceof ${k} ? (${[...writes, y].join(", ")}) : ${fresh})`;
          }
          const v = made(e.t.cases[e.c].variant, exs(e.args, pre, d));
          return constant(e) ? constName(v) : v;
        }
        // A written list (L181b): its items in order, made into conses from the last.
        // An item that does something first (a write, then a read) has the
        // items before it worked out before that (exs).
        case "list": {
          const [nil, cons] = listSteps(e), xs = exs(e.items, pre, d);
          const fields = (cons as Extract<SExpr, { k: "new" }>).args.map((a) => ((a as { i: number }).i === e.acc ? "t" : "x")).join(", ");
          return `[${xs.join(", ")}].reduceRight((t, x) => ${made(e.t.cases[e.c].variant, fields.split(", "))}, ${ex(nil, pre, d)})`;
        }
        case "field": {
          if (stack(e.t)) { const a = named(ex(e.rec, pre, d), pre, d); return e.i === 0 ? `${a}[${a}.length - 1]` : `(${a}.pop(), ${a})`; }
          return read(ex(e.rec, pre, d), e.i, pre, d);
        }
        case "tag": { e.t.cases.forEach((c, i) => noted(c.variant, i)); return caseOf(e.t, named(ex(e.rec, pre, d), pre, d)); }
        // One of a type that waits takes the rest last (C40 step 4): called
        // from outside, it's given a rest that keeps the answer.
        // A closure that takes the rest (it waits, or gives several
        // answers) is given one when called from outside (core-rt.ts).
        case "closure": {
          const rest = e.t.waits || e.t.several;
          // `d` (I245): the maker of its derivative's closure, last.
          const src = carries ? e.src : undefined, more = [src ? JSON.stringify(src) : "undefined", rest ? "true" : "undefined", e.d !== undefined ? names[e.d] : "undefined"];
          while (more.length && more[more.length - 1] === "undefined") more.pop();
          const c = `R.closure(${[names[e.fn], `[${e.caps.map((a) => ex(a, pre, d)).join(", ")}]`, ...more].join(", ")})`;
          // One that captures nothing is the same function every time, so
          // it's made once, at load (C137d18): sheet's tokenizer made one
          // per character for its fold.
          return e.caps.length ? c : constName(c);
        }
        case "cap": return `l0.caps[${e.i}]`;
        case "apply": {
          const [c, ...xs] = exs([e.fn, ...e.args], pre, d);
          pre.push(`${d}${local(e.tmp)} = ${c};`);
          if (cycle && ap(e.t, []).startsWith("(yield")) return e.t.partial ? `R.ck(${ap(e.t, [local(e.tmp), ...xs])})` : ap(e.t, [local(e.tmp), ...xs]);
          return e.t.partial ? `R.ck(R.ap(${[local(e.tmp), ...xs].join(", ")}))` : `${local(e.tmp)}(${xs.join(", ")})`;
        }
        case "case": {
          { const v = ex(e.scrut, pre, d); if (v !== local(e.s)) pre.push(`${d}${local(e.s)} = ${v};`); }
          const t = temp();
          pre.push(`${d}let ${t};`, `${d}switch (${scrutOf(e.t, local(e.s))}) {`);
          e.arms.forEach((a, c) => { if (a) pre.push(`${d}  case ${label(e.t, c)}: {`, ...block(a, { set: t }, d + "    "), `${d}    break;`, `${d}  }`); });
          pre.push(`${d}}`);
          return t;
        }
        case "rt": {
          // A position's test the loop's check before it answers (kept-arrays.ts).
          { const k = bounded?.known.get(e); if (k !== undefined) return String(k); }
          const xs = exs(e.args, pre, d);
          // A loop's count or position's step, a number (kept-arrays.ts).
          if (counted?.plain.has(e)) return `(${xs[0]} ${e.fn === "int.add" ? "+" : "-"} ${xs[1]})`;
          // An Int's sum, difference or product whose range isn't known
          // (int-ranges.ts): the small case written out, so the engine does
          // it inline, and int.ts's past 2^28 (C359).
          {
            const op = e.fn === "int.add" ? "+" : e.fn === "int.sub" ? "-" : e.fn === "int.mul" ? "*" : null;
            const lit = (x: string) => /^\(?-?\d+\)?$/.test(x);
            if (op && xs.length === 2 && !noInlineInts && xs.every((x) => lit(x) || /^[lt]\d+$/.test(x))) {
              const t = temp();
              pre.push(`${d}let ${t};`);
              const num = xs.filter((x) => !lit(x)).map((x) => `typeof ${x} === "number" && `).join("");
              return `(${num}(${t} = ${xs[0]} ${op} ${xs[1]}) > -${2 ** 28} && ${t} < ${2 ** 28} ? ${op === "*" ? `${t} + 0` : t} : ${rtName(e.fn)}(${xs.join(", ")}))`;
            }
          }
          // The fuel is this module's own (C137c21).
          if (e.fn === "fuel.get") return fuel ? "fuel" : "Infinity";
          // One of an answer's values (core-rt.ts pick), read where it is used.
          { const m = /^pick:(\d+)$/.exec(e.fn); if (m && xs.length === 1) return `(${xs[0]})[${m[1]}]`; }
          // derivative(f) of a function chosen at run time (I245): f's maker
          // of its derivative, given f.
          if (e.fn === "derived") { const t = temp(); pre.push(`${d}const ${t} = ${xs[0]};`); return `${t}.d(${t})`; }
          if (e.fn === "fuel.swap") { const t = temp(); pre.push(`${d}const ${t} = fuel;`, `${d}fuel = ${xs[0]};`); return t; }
          // An array of records as columns (columns.ts, C60): an array per
          // field, a Float64Array for a Float64, a Float32Array for a
          // Float32's (C309: already a binary32, so stored exactly).
          {
            const kind = (a: string, x: LType, i: number) => (ir.arrays[Number(a)].narrow?.[i] ? "Float32Array" : x === "f64" ? "Float64Array" : "Array");
            const m = /^array\.c(new|build|push|copy|front|slice|of|rows|length|in|get(\d+)|set([\d_]+))\.a(\d+)$/.exec(e.fn);
            if (m) {
              // A slice, its columns copied: from, count, each clamped to the
              // array (array-view.ts sliceOf) (C342).
              // Made of a list's items, records of plain fields (C342).
              if (m[1] === "of") {
                const ts = ir.arrays[Number(m[4])].leaves ?? (ir.arrays[Number(m[4])].item as RType).fields.map((x) => x.t);
                const c = temp(), w = temp();
                pre.push(`${d}const ${c} = R.itemsOf(${xs[0]}).items(), ${w} = { n: ${c}.length };`);
                ts.forEach((x, i) => pre.push(`${d}{ const g = new ${kind(m[4], x, i)}(${c}.length); for (let k = 0; k < ${c}.length; k++) { const r = ${c}[k]; g[k] = r.f${i} ?? r.fields[${i}]; } ${w}.c${i} = g; }`));
                return w;
              }
              // Its rows, for a host given it whole (C348: the frame's draw
              // given the flock's birds): each item a record made of its
              // leaves, a record in a field one of its own.
              if (m[1] === "rows") {
                let l = 0;
                const row = (t: RType): string => made(t.variant, t.fields.map((x) => (isRecord(x.t) && !x.t.mutable && x.t.fields.length ? row(x.t) : `c.c${l++}[k]`)));
                const made1 = row(ir.arrays[Number(m[4])].item as RType);
                return `R.rowsOf(${xs[0]}, ${l}, (c, k) => ${made1})`;
              }
              if (m[1] === "slice") {
                const ts = ir.arrays[Number(m[4])].leaves ?? (ir.arrays[Number(m[4])].item as RType).fields.map((x) => x.t);
                const c = temp(), f = temp(), k = temp();
                pre.push(`${d}const ${c} = ${xs[0]}, ${f} = Math.max(0, Math.min(${c}.n, Number(${xs[1]}))), ${k} = Math.max(0, Math.min(${c}.n - ${f}, Number(${xs[2]})));`);
                return `{ n: ${k}, ${ts.map((_, i) => `c${i}: ${c}.c${i}.slice(${f}, ${f} + ${k})`).join(", ")} }`;
              }
              // A copy of an array's columns, to write an item into; or with
              // one more item in front, at 0 (G1b4).
              if (m[1] === "copy" || m[1] === "front") {
                const ts = ir.arrays[Number(m[4])].leaves ?? (ir.arrays[Number(m[4])].item as RType).fields.map((x) => x.t);
                const c = temp(), w = temp(), at = m[1] === "front" ? 1 : 0;
                pre.push(`${d}const ${c} = ${xs[0]}, ${w} = { n: ${c}.n + ${at} };`);
                ts.forEach((x, i) => pre.push(`${d}{ const g = new ${kind(m[4], x, i)}(Math.max(8, ${c}.n + 1)); for (let k = 0; k < ${c}.n; k++) g[k + ${at}] = ${c}.c${i}[k]; ${w}.c${i} = g; }`));
                return w;
              }
              // An array a loop builds by pushes (G1b2): room for eight,
              // each column twice the size when full.
              if (m[1] === "build" || m[1] === "push") {
                const ts = ir.arrays[Number(m[4])].leaves ?? (ir.arrays[Number(m[4])].item as RType).fields.map((x) => x.t);
                if (m[1] === "build") return `{ n: 0, ${ts.map((x, i) => `c${i}: new ${kind(m[4], x, i)}(8)`).join(", ")} }`;
                const c = temp();
                pre.push(`${d}const ${c} = ${xs[0]};`);
                const vs = ts.map((_, i) => { const v = temp(); pre.push(`${d}const ${v} = ${xs[i + 1]};`); return v; });
                pre.push(`${d}if (${c}.n === ${c}.c0.length) {`);
                ts.forEach((x, i) => pre.push(`${d}  { const o = ${c}.c${i}, g = new ${kind(m[4], x, i)}(o.length * 2); for (let k = 0; k < ${c}.n; k++) g[k] = o[k]; ${c}.c${i} = g; }`));
                pre.push(`${d}}`);
                vs.forEach((v, i) => pre.push(`${d}${c}.c${i}[${c}.n] = ${v};`));
                pre.push(`${d}${c}.n++;`);
                return c;
              }
              // A kept array's length and columns, worked out before the loop.
              const w = keptOfArg(e.args[0]), at = w ?? `${xs[0]}.`;
              if (m[1] === "length") return `${at}n`;
              // Whether a position is one of the array's (`item at`'s check).
              if (m[1] === "in") { const j = temp(); pre.push(`${d}const ${j} = ${xs[1]};`); return `(Number.isInteger(${j}) && ${j} >= 0 && ${j} < ${at}n)`; }
              if (m[2] !== undefined) return `${at}c${m[2]}[${xs[1]}]`;
              if (m[1] === "new") {
                const t = temp(), r = ir.arrays[Number(m[4])].item as RType;
                pre.push(`${d}const ${t} = ${xs[0]};`);
                const ts = ir.arrays[Number(m[4])].leaves ?? r.fields.map((x) => x.t);
                return `{ n: ${t}, ${ts.map((x, i) => `c${i}: new ${kind(m[4], x, i)}(${t})`).join(", ")} }`;
              }
              const c = temp(), j = temp(), ks = m[3]!.split("_");
              pre.push(`${d}const ${c} = ${xs[0]}, ${j} = ${xs[1]};`);
              const vs = ks.map((k, i) => { const v = temp(); pre.push(`${d}const ${v} = ${xs[i + 2]};`); return [k, v]; });
              for (const [k, v] of vs) pre.push(`${d}${c}.c${k}[${j}] = ${v};`);
              return c;
            }
          }
          // An array's item and length read in place where it is a view
          // (G3d): the runtime's own, one function for every array of a
          // program, was a quarter of the flock page's time, its calls
          // seeing every kind of array.
          {
            // And `item at` on a kept array (C343: the prelude's strided
            // contraction sum reads through it): past the end, the
            // runtime's, which has no answer there.
            const m = /^array\.(get|length|at)\.a\d+$/.exec(e.fn);
            if (m && xs.length === (m[1] === "length" ? 1 : 2) && (m[1] !== "at" || keptOfArg(e.args[0]))) {
              const named = (x: string) => { if (/^[\w$]+$/.test(x)) return x; const t = temp(); pre.push(`${d}const ${t} = ${x};`); return t; };
              const a = named(xs[0]), w = keptOfArg(e.args[0]);
              if (w && m[1] === "length") return `${w}n`;
              if (w && bounded) return keptItem(w, named(xs[1]));
              if (w) { const j = named(xs[1]); return `(${j} >= 0 && ${j} < ${w}n ? ${keptItem(w, j)} : ${rtName(e.fn)}(${a}, ${j}))`; }
              if (m[1] === "length") return `(${a} instanceof R.ArrayView ? ${a}.n : ${rtName(e.fn)}(${a}))`;
              const j = named(xs[1]);
              return `(${a} instanceof R.ArrayView && ${j} >= 0 && ${j} < ${a}.n ? ${a}.buf.items[${a}.start + ${j}] : ${rtName(e.fn)}(${a}, ${j}))`;
            }
          }
          // Small Ints' product and remainder (int-ranges.ts): a product
          // that is 0 is 0, not −0.
          if (e.fn === "int.mulSmall" && xs.length === 2) return `(${xs[0]} * ${xs[1]} + 0)`;
          if (e.fn === "int.remainderSmall" && xs.length === 2) return `((${xs[0]} % ${xs[1]} + ${xs[1]}) % ${xs[1]})`;
          // A builtin that is one JavaScript operator, printed as it (C170b).
          { const op = RT_INFIX[e.fn]; if (op && xs.length === 2) return `(${xs[0]} ${op} ${xs[1]})`; }
          // A map's `value at` where no answer leaves by onFail: checked as
          // a value, not thrown and caught (C59: notebook's scores).
          { const m = /^table\.at(\.t\d+(?:\.e\d+)?)$/.exec(e.fn); if (m && onFail) { const t = temp(); pre.push(`${d}const ${t} = ${rvName(`table.atv${m[1]}`)}(${xs.join(", ")});`, `${d}if (${t} === R.FAIL) ${onFail}`); return t; } }
          return `${rtName(e.fn)}(${xs.join(", ")})`;
        }
        case "world": { const xs = exs(e.args, pre, d); return `${worldName(e.op)}(${xs.join(", ")})`; }
        // No answer leaves the way a partial call's FAIL does (onFail),
        // without a throw; thrown only where it must be (C137d12: calc's
        // parser spent 41% of its time throwing it).
        case "fail": if (onFail) { pre.push(`${d}${onFail}`); return "undefined"; } return "R.fail()";
        case "attempt": {
          // (Not in a heap copy, whose calls yield: there it is plain.)
          if (e.resumes && !cycle) {
            // Its body may wait (C181): ok or otherwise as a function, run
            // now, or, past a page's wait, once the rest it resumes is done
            // (R.later), given what that rest gave.
            const t = temp(), a = temp(), v = temp(), r = local(e.res), [save, back] = keep();
            pre.push(`${d}${save}let ${t};`, `${d}const ${a} = (${v}) => {`, `${d}  ${r} = ${v};`, `${d}  if (${v} !== R.FAIL) {`, ...within("return R.FAIL;", () => block(e.ok, { set: t, fails: true }, d + "    ")), `${d}  } else {`, ...within("return R.FAIL;", () => block(e.otherwise, { set: t, fails: true }, d + "    ")), `${d}  }`, `${d}  return ${t};`, `${d}};`);
            const body = within(`{ ${r} = R.FAIL; break ${v}; }`, () => block(e.body, { set: r, fails: true }, d + "  "));
            pre.push(`${d}${v}: try {`, ...body, `${d}} catch (x) {`, `${d}  if (x !== R.FAIL${e.spent ? " && x !== R.OUT" : ""}) R.later(x, ${a}${e.spent ? ", true" : ""});`, `${d}  ${back}${r} = R.FAIL;`, `${d}}`, `${d}${t} = ${a}(${r});`);
            pre.push(onFail ? `${d}if (${t} === R.FAIL) ${onFail}` : `${d}R.ck(${t});`);
            return t;
          }
          const ok = tried(e, pre, d), t = temp();
          pre.push(`${d}let ${t};`, `${d}if (${ok}) {`, ...block(e.ok, { set: t }, d + "  "), `${d}} else {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "budget": {
          const s = temp(), out = temp(), t = temp(), [save, back] = keep();
          pre.push(`${d}${save}const ${s} = fuel;`, `${d}fuel = ${e.n};`, `${d}let ${t}, ${out} = false;`, `${d}try {`, ...within(null, () => block(e.body, { set: t }, d + "  ")), `${d}} catch (x) {`, (e.resumes ? `${d}  if (x !== R.OUT) { const inner = fuel; fuel = ${s}; R.fuelLater(x, inner, (v) => { const o = fuel; fuel = v; return o; }); }` : `${d}  if (x !== R.OUT) { fuel = ${s}; throw x; }`), `${d}  ${back}${out} = true;`, `${d}}`, `${d}fuel = ${s};`);
          pre.push(`${d}if (${out}) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "abort": return `R.abort(${ex(e.reason, pre, d)}, ${e.esc ?? 0})`;
        case "handle": {
          const t = temp(), [save, back] = keep();
          // Around several answers or a wait (C182): an abort while the
          // rest of the search runs isn't this handler's.
          const fr = e.frame === undefined ? "" : local(e.frame);
          if (fr) {
            // The case as a function, so a page's wait (Pending) going out
            // through the handler is resumed inside it again (R.caught).
            const h = temp();
            // On the program's stack of handlers too (C185), so a rest a
            // handler outside keeps for later, run once this has
            // returned, still has its aborts caught by it (core-rt.ts).
            const n = temp();
            pre.push(`${d}${save}let ${t};`, `${d}const ${h} = (x) => {`, `${d}  if (!(x instanceof R.Aborted) || x.esc !== ${e.esc ?? 0} || ${fr}.inRest) throw x;`, `${d}  ${back}${local(e.reason)} = x.reason;`,
              ...within("return R.FAIL;", () => block(e.arm, { set: t }, d + "  ")), `${d}  return ${t};`, `${d}};`, `${d}${fr} = { inRest: false, abort: ${h} };`, `${d}const ${n} = R.hin(${fr});`,
              `${d}try {`, ...within(null, () => block(e.body, { set: t }, d + "  ")), `${d}} catch (x) {`, `${d}  R.hout(${n});`, `${d}  ${t} = R.caught(x, ${h});`, `${d}} finally {`, `${d}  R.hout(${n});`, `${d}}`);
            if (onFail) pre.push(`${d}if (${t} === R.FAIL) ${onFail}`);
            return t;
          }
          pre.push(`${d}${save}let ${t};`, `${d}try {`, ...within(null, () => block(e.body, { set: t }, d + "  ")), `${d}} catch (x) {`, `${d}  if (!(x instanceof R.Aborted) || x.esc !== ${e.esc ?? 0}) throw x;`, `${d}  ${back}${local(e.reason)} = x.reason;`, ...block(e.arm, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        // A handler's release (L213a3/a4): after its body on every exit, a
        // normal one or a throw (an abort, no answer), but not a page's
        // Pending, which comes back to the body later.
        case "released": {
          const t = temp(), r = temp();
          pre.push(`${d}let ${t}, ${r};`, `${d}try {`, ...within(null, () => block(e.body, { set: t }, d + "  ")), `${d}} catch (x) {`, `${d}  if (!(x instanceof R.Pending)) {`, ...within(null, () => block(e.release, { set: r }, d + "    ")), `${d}  }`, `${d}  throw x;`, `${d}}`, ...block(e.release, { set: r }, d));
          return t;
        }
        case "set": { const r = ex(e.rec, pre, d); pre.push(`${d}${r}.f${e.i} = ${ex(e.value, pre, d)};`); return ex(e.then, pre, d); }
        case "choose": case "search": throw new Error(`${e.k} is gone after lowering`);
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    // `fails` (or a return from a partial function): the value may be FAIL,
    // which whoever reads it checks, so no answer here is that value.
    function block(e: SExpr, to: { set: string; fails?: true } | "return", d: string): string[] {
      const out: string[] = [];
      const failable = to === "return" ? !!f.partial : !!to.fails;
      const give = (x: string) => [...out, ...(to === "return" ? [`${d}return ${x};`] : x === to.set ? [] : [`${d}${to.set} = ${x};`])];
      if (failable && e.k === "fail") return give("R.FAIL");
      if (failable && e.k === "call" && ir.funcs[e.fn].partial && !(to === "return" && e.fn === i && e.tail)) return give(call(e.fn, filledFrom(e, inputs(e.args, out, d), out, d)));
      if (failable && e.k === "attempt" && !(e.resumes && !cycle)) {
        const ok = tried(e, out, d);
        return [...out, `${d}if (${ok}) {`, ...block(e.ok, to, d + "  "), `${d}} else {`, ...block(e.otherwise, to, d + "  "), `${d}}`];
      }
      if (failable && e.k === "apply" && e.t.partial) {
        const c = ex(e.fn, out, d), xs = inputs(e.args, out, d);
        out.push(`${d}${local(e.tmp)} = ${c};`);
        return give(ap(e.t, [local(e.tmp), ...xs]));
      }
      // A match hands `to` to its arms, so a self call in one is the
      // loop's next round, not a call as deep as the data (L181b).
      if (e.k === "case") {
        // Not `l0 = l0;`: a loop's case on its own parameter.
        const v = slot(e.scrut, out, d);
        if (v !== local(e.s)) out.push(`${d}${local(e.s)} = ${v};`);
        out.push(`${d}switch (${scrutOf(e.t, local(e.s))}) {`);
        e.arms.forEach((a, c) => { if (a) out.push(`${d}  case ${label(e.t, c)}: {`, ...block(a, to, d + "    "), ...(to === "return" ? [] : [`${d}    break;`]), `${d}  }`); });
        out.push(`${d}}`);
        return out;
      }
      if (e.k === "let") {
        if (!readsLocal(e.body, e.i)) {
          if (!quiet(e.value)) out.push(`${d}${ex(e.value, out, d)};`);
          return [...out, ...block(e.body, to, d)];
        }
        const v = slot(e.value, out, d);
        if (v !== local(e.i)) out.push(`${d}${local(e.i)} = ${v};`);
        return [...out, ...block(e.body, to, d)];
      }
      // A field set, then what follows as the statements it is, so a
      // failure after it is the block's own (keep's next answer asked for).
      if (e.k === "set") {
        const r = ex(e.rec, out, d);
        out.push(`${d}${r}.f${e.i} = ${ex(e.value, out, d)};`);
        return [...out, ...block(e.then, to, d)];
      }
      if (e.k === "if") {
        const c = slot(e.cond, out, d);
        return [...out, `${d}if (${c}) {`, ...block(e.then, to, d + "  "), `${d}} else {`, ...block(e.else, to, d + "  "), `${d}}`];
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: every new value computed before any is set.
        // A parameter passed on as it is stays as it is.
        const xs = e.args.map((a) => ex(a, out, d)), ts = xs.map((x, j) => (x === local(j) ? null : temp()));
        xs.forEach((x, j) => { if (ts[j]) out.push(`${d}const ${ts[j]} = ${x};`); });
        ts.forEach((t, j) => { if (t) out.push(`${d}${local(j)} = ${t};`); });
        return [...out, `${d}continue;`];
      }
      const x = ex(e, out, d);
      return [...out, ...(to === "return" ? [`${d}return ${x};`] : x === to.set ? [] : [`${d}${to.set} = ${x};`])];
    }

    // One from the budget per call, and per round of the loop.
    // A definition that may not finish takes a step each time round, which
    // only a page's budget counts (C179): a formula that never ends stops.
    // As the evaluator counts (run.ts spendStep): a step outside any `with
    // fuel` (whose fuel is Infinity), and not again in a piece of the
    // search (I291: countdown's `results`, whose rests took a step each,
    // 3.47M page steps where the evaluator takes 442k).
    // In the editor's preview every function takes one (stepEverywhere,
    // E319d): there a page runs on the editor's thread, and its budget
    // must reach work that ends but takes seconds.
    const step = (everyStep || ir.info.divergent.has(f.def)) && !f.piece ? [fuel ? "if (fuel === Infinity) R.step();" : "R.step();"] : [];
    const spend = (d: string) => [...(f.spends ? [`${d}if (--fuel < 0) throw R.OUT;`] : []), ...step.map((x) => d + x)];
    const params = f.params.map((_, j) => local(j));
    // The library's `item at` and `length` on a list over one array (the
    // runtime's ItemsList: Bytes' items, a table's keys) read it in place,
    // as an array's are (C321): walked a cell at a time, `byte at` read
    // mnist-page's 74 KB of digits from their start, 3 s a batch.
    const inPlace = !f.def.startsWith("@") || params.length !== (f.name === "item at" ? 3 : f.name === "length" ? 1 : -1) ? []
      : f.name === "length" ? [`  if (${params[0]} instanceof R.ItemsList) return ${params[0]}.b.length - ${params[0]}.i;`]
      : [`  if (${params[0]} instanceof R.ItemsList && typeof ${params[1]} === "number") return Number.isInteger(${params[1]}) && ${params[1]} >= 0 && ${params[0]}.i + ${params[1]} < ${params[0]}.b.length ? ${params[0]}.b[${params[0]}.i + ${params[1]}] : ${params[2]};`];
    const views = [...kept].flatMap(([j, w]) => columnsOf.has(j)
      ? [`  const ${w} = ${params[j]}, ${w}n = ${w}.n${[...columnsOf.get(j)!].sort((x, y) => x - y).map((c) => `, ${w}c${c} = ${w}.c${c}`).join("")};`]
      : [`  const ${w} = ${params[j]} instanceof R.ArrayView ? ${params[j]} : R.arrayView(${params[j]}), ${w}b = ${w}.buf.items, ${w}s = ${w}.start, ${w}n = ${w}.n;`]);
    const rowViews = [...kept.values()].filter((w) => !isColumns(w));
    if (counted) views.unshift(`  if (${[...counted.ints, ...counted.steady].map((j) => `typeof ${params[j]} !== "number"`).join(" || ")}) return ${names[i]}$s(${params.join(", ")});`);
    if (rowViews.length > 1) views.push(`  if (!(${rowViews.map((w) => `${w}.ver.cur`).join(" && ")})) return ${names[i]}$s(${params.join(", ")});`);
    if (bounded && counted) {
      // The first and last positions each read is at, in its array.
      const c = params[bounded.count];
      const ins = bounded.reads.map(({ array, at }) => {
        const st = counted.step.get(at)!, w = kept.get(array)!, p = params[at];
        const by = st.input ? params[st.by as number] : `${st.by}`, last = `(${p} ${st.down ? "-" : "+"} (${c} - 1) * ${by})`;
        return `${p} >= 0 && ${p} < ${w}n && ${last} >= 0 && ${last} < ${w}n`;
      });
      views.push(`  if (!(${c} < 1 || (${ins.join(" && ")}))) return ${names[i]}$c(${params.join(", ")});`);
    }
    const body = [...inPlace, ...views, ...(loops ? ["  for (;;) {", ...spend("    "), ...block(f.body, "return", "    "), "  }"] : [...spend("  "), ...block(f.body, "return", "  ")])];
    const locals = f.locals.map((_, j) => f.params.length + j).filter((j) => used.has(j)).map((j) => `l${j}`);
    // A definition that isn't a function is worked out once, at its first
    // use, as compile.ts has it (`??=`): sheet's `symbols`, a set made from
    // a written list, was made again for every character (C137d17).
    if (f.value && !cycle && !deep.has(i) && !f.partial && !f.spends && !f.budgeted && !params.length && !(isArray(f.result) && written.has(f.result.index) && !emptyArray(f.body)) && !(isTable(f.result) && writtenTables.has(f.result.index))) {
      return [`let ${names[i]}$v;`, `function ${names[i]}() { return ${names[i]}$v ??= ${names[i]}$w(); }`, `function ${names[i]}$w() {`, ...(locals.length ? [`  let ${locals.join(", ")};`] : []), ...body, "}"].join("\n");
    }
    return [`function${cycle ? "*" : ""} ${cycle ? gens[i] : names[i]}(${params.join(", ")}) {`, ...(locals.length ? [`  let ${locals.join(", ")};`] : []), ...body, "}"].join("\n");
  }
}

// The program lowered for this printer (`host`), after the passes every
// printer takes: handlers the compiler can see put into the code they
// handle (handlers.ts, C64b), so a program's own effect answered in place
// (effects' Ask) needs no handler at run time (C137c17).
import { reachedImplementing } from "../../ters/src/lang/reached.ts";
import { passesAgain } from "./ir-again.ts";
export { reachedImplementing };

export function lowerCore(code: Code, info: Info, names: Record<Id, string>, roots: Id[]): CoreIR {
  // Definitions' keys (def-keys.ts) write the ids the passes below make by
  // place, not as made.
  // Where checks are kept, the ids the passes make are drawn the same way
  // each compile (model.ts idsSeeded), so their checks again find their
  // groups kept; whole checks too, on no layer (check-cache.ts
  // keepingWhole): a bake's check was 85 ms of greenhouse-page's lowering.
  const lower = () => keysOver(code.nodes, () => lowerCoreIn(code, info, names, roots));
  return checksKept(info.options) ? idsSeeded(`lowering ${roots.join(" ")}`, () => keepingWhole(lower)) : lower();
}
function lowerCoreIn(code: Code, info: Info, names: Record<Id, string>, roots: Id[]): CoreIR {
  // Work a lambda redoes on every call though nothing in it changes, done
  // once before (hoist.ts, C81), as compile.ts has it: sheet's columns
  // used, walked again for every row (C137d16). On what the roots reach,
  // so its check again isn't over the whole library.
  // The passes below walk every node they're given, so they're given only
  // what the roots reach, hoisted or not, not the whole library (C174:
  // sort's lowering 451 to about 200 ms, wc's about 500 to 120).
  // A solve a relation's direction answers is that direction (directions.ts,
  // POLAR.md), as the checker reads it: the same nodes, its types (C177).
  const given = info;
  // An edit of a number takes the last answer with the new value put in
  // (literals-again.ts): these steps read numbers only through the check.
  // The ownership passes below read the program as these leave it, before
  // its handlers are put in.
  ({ code, info, names } = overLiterals(`lowering's front ${roots.join(" ")}`, { code, info, names }, () => front(code, info, names, roots)));
  const f = overLiterals(`handlers put in ${roots.join(" ")}`, { code, info, names }, () => fusedProgram(code, info, names));
  let ir = lowerScalar(f.code, endsAsBefore(given, f.info), f.names, roots, { data: true, host: true, baked: true, printed: (c, id) => planOf(c, `solve:${id}`) !== null });
  // The passes up to the Ints' ranges read numbers' values only where
  // they say so (ir-again.ts readValue): an edit of a number takes their
  // last answer with the new values put in (machine's 250 ms a number edit).
  ir = passesAgain(`lowered ${roots.join(" ")}`, ir, (ir) => {
    // A linear function of a linear function, one matrix (linear-calls.ts, L44).
    if (!envSet("NO_LINEAR")) linearCalls(ir);
    // Parts always 0 (a vector's bivector parts) dropped, with a copy of a
    // function for each set of parts its callers give (zero-parts.ts, L43).
    if (!envSet("NO_ZP")) ir = zeroParts(ir, ir.funcs.flatMap((g, i) => (roots.includes(g.def) && !g.inner ? [i] : []))).ir;
    // A read or write at an item path, given the path's parts (C273).
    if (!envSet("NO_ITEM_PATHS")) itemPaths(ir);
    // A closure made only to be applied at once, a call of its code (C288).
    if (!envSet("NO_KNOWN_CLOSURES")) knownClosures(ir);
    // Small pure functions put in place, so that sharing reaches across
    // them (C194); then a pure call made twice with the same inputs, made
    // once (C189).
    if (!envSet("NO_INLINE")) inlineSmall(ir);
    // A choice over a range's items as one Float64, no list (C207s).
    if (!envSet("NO_RANGE_CHOICES")) rangeChoices(ir, true);
    // `keep` over an array's items a loop pushing the kept ones (G1b1).
    if (!envSet("NO_KEPT_ITEMS")) keptItems(ir);
    // And a loop folding a Bool with `and` stopping once it's false (C207m).
    if (!envSet("NO_EARLY_AND")) earlyAnd(ir);
    // And `array of range x` of Ints filled with no list (C228, as C207v
    // on WebAssembly): depot's `indices`, made for each search.
    if (!envSet("NO_RANGE_ARRAYS")) rangeArrays(ir);
    // An array a function walks by its rests, read by position (C196).
    if (!envSet("NO_OFFSETS")) arrayOffsets(ir);
    if (!envSet("NO_SHARE")) shareCalls(ir);
    // An array of a written list made from its items, with no list between
    // (C196: agent's triangle corners, three points an array each call).
    writtenArrays(ir);
    // contracted's one pair of axes at Float64, several sums at once (C351a).
    if (!envSet("NO_PRODUCTS")) stridedProducts(ir);
    // A replace in an array of a type whose every value has one holder,
    // written in place (owned-arrays.ts, C93 s4).
    // The passes after it read one holders() (sharedHolders).
    const shared = sharedHolders(ir, ir.funcs.flatMap((g, i) => (roots.includes(g.def) && !g.inner ? [i] : [])));
    if (!envSet("NO_OWN") && roots.length === 1) ownedArrays(ir, roots[0], true, shared);
    // And each other replace whose array has one holder, decided per value
    // (holders.ts, C327f).
    if (!envSet("NO_OWN") && !envSet("NO_HOLDERS")) ownedPerValue(ir, [], shared);
    // And puts and removes on tables nobody else holds (owned-tables.ts).
    if (!envSet("NO_OWN") && !envSet("NO_OWN_TABLES") && roots.length === 1) ownedTables(ir, roots[0], shared);
    // A push onto an array a call just made, on its view (C196).
    if (!envSet("NO_PUSHES")) ownedPushes(ir, ir.funcs.flatMap((g, i) => (roots.includes(g.def) && !g.inner ? [i] : [])));
    // And records rebuilt from their own fields (owned-records.ts, C93 s5).
    if (!envSet("NO_OWN") && !envSet("NO_OWN_RECORDS") && roots.length === 1) ownedRecords(ir, code, info, names, roots[0]);
    // A loop putting what it keeps in front, pushing at the end going
    // down instead (G1b2), so columns can grow it.
    if (!envSet("NO_GROW_COLUMNS")) pushedInOrder(ir);
    // Arrays of records whose loops read and write them field by field, as
    // an array per field (columns.ts, C60).
    if (!envSet("NO_COLUMNS")) columns(ir, ir.funcs.flatMap((g, i) => (roots.includes(g.def) && !g.inner ? [i] : [])), { whole: !envSet("NO_WHOLE_COLUMNS"), grow: !envSet("NO_GROW_COLUMNS") });
    // The pushes holders.ts found onto arrays nobody else holds, as columns
    // left them.
    ownPushes(ir);
    // contracted's one pair of axes at Dual, its arrays columns (C351b).
    if (!envSet("NO_PRODUCTS")) stridedProducts(ir, true);
    // Then calls put in place for the printed code: a function called from
    // one place, or a small one, whatever it does (inline-small.ts).
    if (!envSet("NO_INLINE_CALLS")) inlineCalls(ir, (i) => ir.info.divergent.has(ir.funcs[i].def));
    // A record chosen between and read only by its parts, as its parts
    // (chosen-parts.ts, G3d): the flock's neighbour, no bird made for it.
    if (!envSet("NO_CHOSEN_PARTS")) chosenParts(ir);
    // Small functions using the runtime's reads put in place in loops, so
    // a loop reads the arrays it keeps from their buffers and counts in
    // numbers (inline-small.ts, kept-arrays.ts, C303b).
    if (!envSet("NO_INLINE")) inlineSmall(ir, true);
    // And a record such a loop carries round, as its fields, where its
    // fields are read only in what was put in place (loop-records.ts, C304a).
    if (!envSet("NO_LOOP_RECORDS")) loopRecords(ir);
    // And a record chosen between there read by its parts (C304c: a column
    // array's `item at` or else a constant Dual, put in place in mnist's dot).
    if (!envSet("NO_CHOSEN_PARTS")) chosenParts(ir);
    return ir;
  });
  // Ints known small worked out as numbers (int-ranges.ts, C267).
  if (!envSet("NO_INT_RANGES")) intRanges(ir, new Set(ir.funcs.flatMap((g, i) => (roots.includes(g.def) && !g.inner ? [i] : []))));
  // An Int operation's inputs as locals, so its small case is written out
  // (int-args.ts, C361).
  if (!envSet("NO_INT_ARGS")) intArgs(ir);
  // Reads that wait on the places their values are used at (C162).
  trackReads(ir);
  return ir;
}

// The steps every lowering of these roots takes before the scalar
// profile's.
function front(code: Code, info: Info, names: Record<Id, string>, roots: Id[]): { code: Code; info: Info; names: Record<Id, string> } {
  // The passes below rewrite a checked program and check it again; none
  // changes a unit, so units aren't checked again (I261: trek's 5.9 s).
  info = { ...info, options: { ...info.options, units: false } };
  code = reachedImplementing(useDirections(code), roots, info);
  // A pure builtin on literals alone, a definition of no inputs, made once
  // (literal-calls.ts, C346).
  ({ code, info, names } = withLiteralCalls(code, info, names, roots));
  const h = hoistInvariants(code, info, names);
  if (h.hoisted) ({ code, info, names } = h);
  // inverse(f, …) of a named f is a solve on f (inverses.ts), as compile.ts
  // has it: the equations' solver or a mode's plan, not the relational
  // interpreter calling a function it is handed (the pedal's atanh, C137d8).
  // Checked with the program's options: a represented program's insiders
  // (library-reps.ts) may call the constructors they stand for.
  ({ code, info, names } = withInverses(code, info, names));
  // An operation with an effect given as a value, the lambda calling it
  // (operation-values.ts, C235): `for each(lines, print)`.
  ({ code, info, names } = withOperationLambdas(code, info, names));
  // A map over a text's characters, a fold over them (character-maps.ts,
  // C239): one walk over the text, no list of one-character texts.
  return withCharacterMaps(code, info, names);
}

// `array of` a written list: `array.ofItems`, its items handed as they
// are, so no cons cell is made for each to be read back.
// And `array of(append(items of a, items of b))` of two arrays of its
// own kind: `array.concat`, the two copied into one, with no list between
// (C324: bazaar's `concat arrays`, joining two rows at every match).
// And `array of(items of a)` is a itself, an array being a value (C304c:
// mnist's Newton weights, made by a map on workers, then read back as a
// list into an array of Duals that columns can't make, so kept as rows).
function writtenArrays(ir: CoreIR): void {
  const append = new Set(ir.funcs.flatMap((f, i) => (originalOf(f.def) === PRELUDE_DEFS.append ? [i] : [])));
  const go = (e: SExpr): SExpr => {
    const x = mapKids(e, go);
    const m = x.k === "rt" ? /^array\.of\.(a\d+)$/.exec(x.fn) : null;
    if (!m || x.k !== "rt" || x.args.length !== 1) return x;
    const l = x.args[0];
    if (l.k === "list") return { ...x, fn: `array.ofItems.${m[1]}`, args: l.items };
    const items = (y: SExpr) => (y.k === "rt" && y.fn === `array.items.${m[1]}` && y.args.length === 1 ? y.args[0] : null);
    if (l.k === "call" && append.has(l.fn) && !l.cps && l.args.length === 2 && items(l.args[0]) && items(l.args[1])) return { ...x, fn: `array.concat.${m[1]}`, args: [items(l.args[0])!, items(l.args[1])!] };
    if (items(l)) return items(l)!;
    return x;
  };
  for (const f of ir.funcs) f.body = go(f.body);
}

// contracted's one pair of axes at Float64 (`strided products`, C351a;
// C306 on C, c.ts stridedProductsC): the runtime's
// `array.stridedProducts`, 2 rows by 4 columns of sums at once, each
// added in the order the definition adds it, so the same bits (mnist's
// weight gradient, 28% of Adam as the definition's map of sums).
// `dual` (C351b), after columns.ts: at the numbers module's Dual, the three
// arrays each two Float64 columns (`{ n, c0, c1 }`, value and slope), the
// runtime's `array.stridedProductsDual`, each sum's value and slope added
// as its · and + add them (mnist's Newton, two thirds of it these sums).
function stridedProducts(ir: CoreIR, dual = false): void {
  const items = (t: LType) => (dual ? isArray(t) && isDual(t.item) && t.leaves?.length === 2 && t.leaves.every((x) => x === "f64") && !t.narrow?.some((x) => x) : isArray(t) && t.item === "f64");
  const ints = (t: LType) => isArray(t) && t.item === "int";
  for (const f of ir.funcs) {
    const p = f.params, r = f.result;
    if (p.length !== 7 || typedOriginalOf(f.def) !== PRELUDE_DEFS["strided products"] || f.multi || f.budgeted) continue;
    if (!items(p[0]) || !items(p[1]) || !ints(p[2]) || !ints(p[3]) || p.slice(4).some((t) => t !== "int") || !items(r) || !isArray(r)) continue;
    f.body = { k: "rt", fn: `array.stridedProducts${dual ? "Dual" : ""}.a${r.index}`, args: p.map((_, i): SExpr => ({ k: "local", i })) };
  }
}

// What a variable starts as.
function zero(t: LType, made: (variant: Id, xs: string[]) => string): string {
  if (t === "f64" || t === "int32") return "0";
  if (t === "i32") return "false";
  if (t === "int") return "0";
  if (t === "text") return '""';
  if (typeof t === "object" && isRecord(t)) return made(t.variant, t.fields.map((x) => zero(x.t, made)));
  if (typeof t === "object" && isData(t)) return "null";
  return "null";
}

const DEPTH = 1000;

// The functions with a heap copy, each with the functions of its cycle
// (the ones it calls that call it back): those in a cycle of two or more,
// or calling themselves other than as the loop's next round.
function deepFuncs(funcs: SFunc[]): Map<number, Set<number>> {
  // An apply may call the code of any closure of its type (L72e1d): a
  // search's rest, in continuation passing, is such a cycle.
  const coded = new Map<string, Set<number>>();
  const closures = (e: SExpr): void => { if (e.k === "closure") { const s = coded.get(e.t.key) ?? new Set(); coded.set(e.t.key, s.add(e.fn)); } kidsOf(e).forEach(closures); };
  funcs.forEach((f) => closures(f.body));
  const calls = funcs.map((f, me) => {
    const out = new Set<number>();
    let other = false;
    const walk = (e: SExpr, tail: boolean): void => {
      if (e.k === "call") { out.add(e.fn); if (e.fn === me && !(e.tail && tail)) other = true; }
      if (e.k === "apply") coded.get(e.t.key)?.forEach((g) => { out.add(g); if (g === me) other = true; });
      // Only a call where block() makes the loop counts as the loop.
      const inTail = (x: SExpr) => tail && (e.k === "case" ? x !== e.scrut : e.k === "let" ? x === e.body : e.k === "if" ? x !== e.cond : false);
      kidsOf(e).forEach((x) => walk(x, inTail(x)));
    };
    walk(f.body, true);
    return { out, other };
  });
  const reach = funcs.map((_, i) => {
    const seen = new Set<number>(), todo = [...calls[i].out];
    for (let j; (j = todo.pop()) !== undefined;) if (!seen.has(j)) { seen.add(j); todo.push(...calls[j].out); }
    return seen;
  });
  const deep = new Map<number, Set<number>>();
  funcs.forEach((_, i) => {
    if (!reach[i].has(i)) return;
    const cycle = new Set([...reach[i]].filter((j) => reach[j].has(i)));
    if (cycle.size > 1 || calls[i].other) deep.set(i, cycle);
  });
  return deep;
}

// The functions the printed `roots` reach: called, made a closure of, or
// named in any other way in the printed code (a heap copy, a plan), read
// off the printed text, so nothing that names one is missed. A function
// put in place where it was called (inline-small.ts), or one nothing calls
// any more, is left out of a page.
export function reachedFuncs(ir: CoreIR, roots: number[]): Set<number> {
  const { parts, head } = emitCoreJs(ir);
  const named = (text: string) => [...text.matchAll(/(?<![.\w$])f(\d+)(?!\d)/g)].map((m) => Number(m[1])).filter((i) => i < parts.length);
  const out = new Set<number>(), todo = [...roots, ...head.flatMap(named)];
  while (todo.length) {
    const i = todo.pop()!;
    if (out.has(i)) continue;
    out.add(i);
    for (const t of parts[i]) todo.push(...named(t));
  }
  return out;
}

// Does e read local i? Through a local node, or as the record `make`
// writes into.
const readsLocal = (e: SExpr, i: number): boolean => (e.k === "local" && e.i === i) || (e.k === "make" && e.into === i) || kidsOf(e).some((x) => readsLocal(x, i));
// A value worked out for nothing but itself: no effect, no stop, so one
// nothing reads needn't be worked out at all.
const quiet = (e: SExpr): boolean => {
  switch (e.k) {
    case "local": case "num": case "int": case "text": case "bool": case "cap": return true;
    case "get": case "field": case "tag": return quiet(e.rec);
    case "closure": return e.caps.every(quiet);
    case "new": return e.args.every(quiet);
    case "make": return e.into === undefined && e.args.every(quiet);
    default: return false;
  }
};

function kidsOf(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return e.args;
    case "list": return e.items;
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "get": case "field": case "tag": return [e.rec];
    case "closure": return e.caps;
    case "apply": return [e.fn, ...e.args];
    case "case": return [e.scrut, ...e.arms.filter((a): a is SExpr => !!a)];
    case "budget": return [e.body, e.otherwise];
    case "attempt": return [e.body, e.ok, e.otherwise];
    case "abort": return [e.reason];
    case "handle": return [e.body, e.arm];
    case "released": return [e.body, e.release];
    case "set": return [e.rec, e.value, e.then];
    default: return [];
  }
}

// The functions, by their place in ir.funcs. `rt`: the console and files.
// `hostOps`: the operations rt.hosts answers (hostOpsOf).
export function loadCoreJs(ir: CoreIR, rt: Runtime = { print: () => {} }, hostOps?: HostOps): ((...xs: unknown[]) => unknown)[] {
  // With the nodes a module ships (solverCode), not the whole program's,
  // so a run here is a module's run (C167e).
  const p = printed(ir);
  return loadPrinted(p, rt, p.code, ir.info, hostOps);
}

// A lowered program as printed, which is plain data (E245c): kept for a
// run of the same code again, or built with the site for a shipped
// example, and loaded with no lowering. `code`: the program's nodes when
// its solves need them (codeFor), else none. `f64`: which functions give
// a Float64 back to the host. `checked`: a derivative needs the check's
// types too, which aren't data, so such a program is lowered each time.
export interface Printed { js: string; names: string[]; worlds: string[]; tables: TableSpec[]; f64: boolean[]; code?: Code; checked?: true }
export function printed(ir: CoreIR): Printed {
  const { js, names, worlds } = emitCoreJs(ir);
  return { js, names, worlds, tables: tableSpecs(ir), f64: ir.funcs.map((f) => f.result === "f64" && !ir.shader), ...(solving(js) ? { code: solverCode(ir, js) } : {}), ...(/R\.rt\("derive:/.test(js) ? { checked: true as const } : {}) };
}
export function loadPrinted(p: Printed, rt: Runtime = { print: () => {} }, code: Code | undefined = p.code, info?: Info, hostOps?: HostOps): ((...xs: unknown[]) => unknown)[] {
  const all = new Function("R", p.js)(coreRuntime(p.tables, p.worlds, rt, code, info, hostOps)) as Record<string, (...xs: unknown[]) => unknown>;
  // A Float64 handed back to the host is a use of it (SPEC §3.3, C156):
  // too big, it stops there.
  const fin = (x: number) => { if (x - x !== 0) throw new Stopped(STOPS[STOPS.length - 1]); return x; };
  return p.names.map((n, i) => { const f = all[n]; return p.f64[i] ? (...xs: unknown[]) => fin(f(...xs) as number) : f; });
}

// What running a main needs to know of it: whether it takes the
// arguments, and what it gives.
function mainOf(ir: CoreIR, name: string): [number, MainSpec] {
  // A main that waits (C40) takes the rest of its run last, as a
  // function with several answers does (scalar.ts several_).
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.budgeted && (!g.inner || g.multi)), f = ir.funcs[fi];
  const ps = f?.multi ? f.params.slice(0, -1) : f?.params ?? [], result = f?.multi ? f.answer : f?.result;
  if (!f || ps.length > 1) throw new Error(`${name}: not compiled, or not a main`);
  if (ps.length && !isData(ps[0])) throw new Error(`${name} takes something other than a List of Texts`);
  return [fi, { args: ps.length > 0, result: result === "f64" ? "f64" : result === "int" ? "int" : "other", ...(f.multi ? { rest: true as const } : {}) }];
}

// A program's definitions compiled through the core IR, by name, as
// compile.ts's module gave them (`defs`, C137 r1): each a function, one
// that takes nothing called with nothing. For tests that compare compiled
// code with the evaluator. Its values are the core IR's: data are its
// classes (read by `tag` and `fields`, or turned plain with plainValue).
export function compiledDefs(code: Code, info: Info, names: Record<Id, string>, exports: string[], rt: Runtime = { print: () => {} }): Record<string, (...xs: unknown[]) => unknown> {
  // The program's own over the library's of the same name (a program's
  // `grow` or `plus`, I219), its definitions coming after the library's.
  const ids = exports.map((n) => code.defs.findLast((d) => names[d] === n) ?? (() => { throw new Error(`no definition ${n}`); })());
  const ir = lowerCore(code, info, names, ids);
  for (const [i, d] of ids.entries()) { const why = ir.refused.get(d); if (why) throw new Error(`${exports[i]} isn't compiled through the core IR: it ${why}`); }
  const fns = loadCoreJs(ir, rt);
  return Object.fromEntries(exports.map((n, i) => {
    // By its id, or by its name where a pass before the lowering
    // made the definition again (withInverses, hoist.ts).
    const fi = ir.funcs.findIndex((g) => (g.def === ids[i] || g.name === n) && !g.budgeted && (!g.inner || g.multi));
    if (fi < 0) throw new Error(`${n}: not compiled`);
    // One with several answers takes the rest last (scalar.ts several_):
    // its first answer, or FAIL with none, as main's run takes it.
    if (ir.funcs[fi].multi) return [n, (...xs: unknown[]) => { let v: unknown, got = false; fns[fi](...xs, (x: unknown) => { v = x; got = true; return true; }); if (!got) throw FAIL; return v; }];
    return [n, fns[fi]];
  }));
}
// The same, each definition on its own: those the core IR compiles, and
// why it doesn't the others yet (C137's gaps), by name.
export function compiledEach(code: Code, info: Info, names: Record<Id, string>, exports: string[], rt: Runtime = { print: () => {} }): { defs: Record<string, (...xs: unknown[]) => unknown>; gaps: Record<string, string> } {
  const defs: Record<string, (...xs: unknown[]) => unknown> = {}, gaps: Record<string, string> = {};
  for (const n of exports) { try { defs[n] = compiledDefs(code, info, names, [n], rt)[n]; } catch (e) { gaps[n] = (e as Error).message; } }
  return { defs, gaps };
}
// A program's main compiled through the core IR and run on `rt`, as the
// tests that ran compile.ts's did (C137): its exit status. Throws when
// main isn't compiled through the core IR, with why.
export function compiledMain(code: Code, info: Info, names: Record<Id, string>, rt: Runtime, name = "main"): number {
  const main = code.defs.find((d) => names[d] === name) ?? (() => { throw new Error(`no definition ${name}`); })();
  const ir = lowerCore(code, info, names, [main]);
  const why = ir.refused.get(main);
  if (why) throw new Error(`${name} isn't compiled through the core IR: it ${why}`);
  return runCoreMain(ir, name, [], rt);
}
// A core IR value as the evaluator's: data as plain { tag, fields }, a
// Bool as its case, inside lists and records too; numbers, texts and
// functions as they are.
export function plainValue(v: unknown): unknown {
  if (typeof v === "boolean") return { tag: v ? TRUE : FALSE, fields: [] };
  if (typeof v !== "object" || v === null || !("tag" in v)) return v;
  const d = v as { tag: string; fields: unknown[] };
  return { tag: d.tag, fields: d.fields.map(plainValue) };
}

export function runCoreMain(ir: CoreIR, name: string, args: string[], rt: Runtime): number {
  return coreMain(ir, name, rt)(args);
}
// Main as printed, which is plain data, for a run kept on disk (ters/cli/
// run-store.ts, I264); runPrintedMain runs it as runCoreMain does.
export function printedMain(ir: CoreIR, name: string): { printed: Printed; main: number; spec: MainSpec } {
  const [main, spec] = mainOf(ir, name);
  return { printed: printed(ir), main, spec };
}
export function runPrintedMain(k: { printed: Printed; main: number; spec: MainSpec }, args: string[], rt: Runtime): number {
  return runCoreFn(loadPrinted(k.printed, rt)[k.main], k.spec, args, rt);
}
// Main printed once and run as often as asked (the gaps benchmarks,
// C137d11), each run on what `rt` holds then: its print and world are read
// at each use.
export function coreMain(ir: CoreIR, name: string, rt: Runtime): (args: string[]) => number {
  const [fi, m] = mainOf(ir, name);
  const f = loadCoreJs(ir, rt)[fi];
  return (args) => runCoreFn(f, m, args, rt);
}

// The program as a module that runs main in Node (C137c5, `ters compile
// --core`): the printed functions, with the runtime imported from
// `runtime` (this file, which a bundler takes in) and Node's world.
// `hosts`: the program's hosts/js.js, imported, and its operations
// (hostOpsOf), which it answers where nothing in the program handles them.
export function coreModule(ir: CoreIR, name: string, runtime: string, world: string, hosts?: Hosts): string {
  const [fi, m] = mainOf(ir, name);
  const { names, worlds } = emitCoreJs(ir);
  const { js } = moduleTags(ir, !!hosts);
  const code = codeFor(ir, js);
  // A together run side by side (C41, branches-rt.ts): the module is
  // started again on worker threads, which find each branch's code by
  // name, and run no main.
  const branches = /R\.rt\("((together|map|keep|all|any|first|fold|both)\.pure|(count|all|first)\.search)"/.test(js);
  const body = branches ? withFunctionsNamed(js) : js;
  return [
    `import { coreRuntime, runCoreFn } from ${JSON.stringify(runtime)};`,
    ...solverFor(code, runtime, js),
    ...floatsFor(js, runtime),
    ...builtinsFor(js, runtime),
    ...branchesFor(js, worlds, runtime),
    `import { nodeWorld } from ${JSON.stringify(world)};`,
    ...(hosts ? [`import $hostAnswers from ${JSON.stringify(hosts.file)};`] : []),
    // With TERS_LOG set, the world's answers are logged to that file
    // (L186's log, C172a), for \`ters run --replay\` to give the evaluator.
    `import { logged, logText, MAIN_LOG_CAP } from ${JSON.stringify(world.replace(/[^/]*$/, "worldlog.ts"))};`,
    `import { writeFileSync as $writeLog } from "node:fs";`,
    "const $logTo = process.env.TERS_LOG, $logged = $logTo ? logged(nodeWorld(), [], { cap: MAIN_LOG_CAP }) : null;",
    "if ($logged) process.on(\"exit\", () => $writeLog($logTo, logText($logged.log)));",
    `const rt = { print: (s) => console.log(s), world: $logged ? $logged.world : nodeWorld()${hosts ? ", hosts: $hostAnswers" : ""} };`,
    `const R = coreRuntime(${JSON.stringify(tableSpecs(ir))}, ${JSON.stringify(worlds)}, rt, ${code}${hosts ? `, undefined, ${JSON.stringify(hosts.ops)}` : ""});`,
    "const defs = (function (R) {",
    body,
    "})(R);",
    `${branches ? "if (!R.branchWorker()) " : ""}process.exitCode = runCoreFn(defs.${names[fi]}, ${JSON.stringify(m)}, process.argv.slice(2), rt);`,
  ].join("\n");
}

// The module's functions given to branches-rt.ts by name, before its
// definitions are handed out (its last line, `return {`). Not a
// relation's mode (modes.ts, `…$mode0`): it is printed inside the body
// `R.moded` is given, so it isn't in scope here (I206: backwards' compiled
// module threw on load, f5057927$mode0 is not defined).
// And the workers it starts where the choices hold how many (L280e).
function withFunctionsNamed(js: string, call = "R.branchesFrom(import.meta.url, ", workers = poolHeld("JavaScript")): string {
  const fns = [...new Set([...js.matchAll(/^\s*function\*?\s+(f[\w$]*)\s*\(/gm)].map((m) => m[1]))].filter((f) => !/\$mode\d+(\$into)?$/.test(f));
  const at = js.lastIndexOf("\nreturn {");
  return `${js.slice(0, at)}\n${call}{ ${fns.join(", ")} }, R.closure, R.Aborted${workers === undefined ? "" : `, ${workers}`});${js.slice(at)}`;
}

// What a tool needs to go from the printed JavaScript back to the program
// (C143c, DEBUG-AND-SPEED-2026-11-04 §4), kept beside the output, never in
// it, and ids only: the node each printed function was lowered from (a
// definition, or a lambda or a fold's arm inside one), by its name (fN;
// its copies are fN$b, fN$h, fN$w and fN$v), and each stop site's node and
// definition, by the number a stop carries (C143a, stops.ts).
// `locals`: for each function, the binder whose value each local lN holds
// (C143d), where the lowering knows it.
// `tags`: the variant each of the program's own cases is tagged with, by
// the number it is tagged with in the module (moduleTags), when it is.
export function coreMap(ir: CoreIR, hosts = false): { version: 1; functions: Record<string, Id>; locals: Record<string, Record<string, Id>>; stops: { node: Id; def: Id }[]; tags?: Record<string, Id> } {
  const { names } = emitCoreJs(ir);
  const { tags } = moduleTags(ir, hosts);
  const locals = Object.fromEntries(names.flatMap((n, i) => {
    const b = Object.entries(ir.funcs[i].binders ?? {}).filter(([, id]) => id);
    return b.length ? [[n, Object.fromEntries(b.map(([j, id]) => [`l${j}`, id]))]] : [];
  }));
  return { version: 1, functions: Object.fromEntries(names.map((n, i) => [n, ir.funcs[i].def])), locals, stops: (ir.stops ?? []).map(({ node, def }) => ({ node, def })), ...(Object.keys(tags).length ? { tags } : {}) };
}

// A module's own tags as small numbers (C170d): each case of the
// program's own types (and the core IR's boxes) is tagged in the module by
// a number, not its node id, and the map (coreMap `tags`) says which
// variant each number is. The library's cases keep their ids, which the
// runtime reads (std.ts's Bool, List, Optional…). Not where something
// outside the module makes the program's own values by their ids: the
// evaluator's solver (a module carrying the nodes) or its hosts/js.js.
// A stop names its definition there but carries no ids: the map has its
// node and definition by the number it stops with (C143c).
export function moduleTags(ir: CoreIR, hosts: boolean, only?: Set<number>): { js: string; tags: Record<string, Id> } {
  const js = emitCoreJs(ir, only).js.replace(/R\.stop\(([^,()]+), "[^"]*", "[^"]*"(, "(?:[^"\\]|\\.)*")?\)/g, (_, c: string, name = "") => `R.stop(${c}, 0, 0${name})`);
  if (hosts || solving(js)) return { js, tags: {} };
  const own = [...new Set([...js.matchAll(/\.prototype\.tag = ("(?:[^"\\]|\\.)*");/g)].map((m) => JSON.parse(m[1]) as string))]
    // Not a record's empty tag (a search's frames, scalar.ts): every ""
    // in the module was that number, so larder's `words` kept the empty
    // ones and no blank line was blank (I374's frames, #3422).
    .filter((t) => t !== "" && !/^(std|builtin|type|effect)\./.test(t));
  if (!own.length) return { js, tags: {} };
  const num = new Map(own.map((t, i) => [JSON.stringify(t), i]));
  const tags = Object.fromEntries(own.map((t, i) => [String(i), t]));
  return { js: js.replace(/"(?:[^"\\]|\\.)*"/g, (lit) => (num.has(lit) ? String(num.get(lit)) : lit)), tags };
}

// Where each printed function is in the written module (C143e), the
// map's output positions: its first and last line, counted from 1, by its
// printed name (fN and its copies), so a stack trace's line:column finds
// the function, and the map's `functions` its node. Read off the module as
// written, after the bundler, which may rename one whose name the runtime
// has too (f1 written f12): `printed` is the module as printed, and its
// functions are written in the same order, so the nth function in the
// definitions there is the nth printed.
export function codeLines(printed: string, written: string): Record<string, [number, number]> {
  const decl = /^(\s*)(?:async\s+)?function\*?\s*([\w$]+)\(/;
  const ours = [...printed.matchAll(/function\*?\s*(f\d+(?:\$[bhw])?)\(/g)].map((m) => m[1]);
  const lines = written.split("\n"), out: Record<string, [number, number]> = {};
  const start = lines.findIndex((l) => /^(?:var|const|let) defs = \(function\s*\(/.test(l));
  if (start < 0) return out;
  let k = 0, indent: string | null = null;
  for (let i = start + 1; i < lines.length && k < ours.length; i++) {
    const m = decl.exec(lines[i]);
    if (!m || (indent ??= m[1]) !== m[1]) continue;
    // One written on its line ends there; else at the brace at its indent.
    let end = i;
    if (!/}\s*$/.test(lines[i])) while (end + 1 < lines.length && !lines[++end].startsWith(`${indent}}`));
    out[ours[k++]] = [i + 1, end + 1];
  }
  return out;
}

// The program's nodes, for a module whose solves the evaluator's solver
// runs (C137c11): only when it has one.
// As a string parsed once, which is smaller and quicker to load than
// the same object written out.
const solving = (js: string) => /R\.rt\("(solve|exists"|derive:)/.test(js);
// Does a printed script call the evaluator's solver? A page that doesn't
// is given a runtime without it (cli/web.ts, page.ts pageRuntime).
export const scriptSolves = solving;
// The runtime calls that look inside a function given them, by name: the
// evaluator's solver, and `set` and `path` taking a field's function.
const LOOKS_INSIDE = /^(solve:|solveOne:|solveAll:|exists$|derive:|host:builtin\.set\b|host:builtin\.cells\.path\b)/;
// Whether the program runs the evaluator's solver (a solve, `for some`, a
// derivative): far slower than compile.ts's plans for now, so a sound
// isn't played this way (C137d7).
export const usesSolver = (ir: CoreIR): boolean => solving(emitCoreJs(ir).js);
// Whether it runs the evaluator's solver on every call somewhere: a solve
// whose plan core-solve.ts can't write out (writtenOut), `for some`, a
// derivative. A sound that does is too slow for the audio thread on the
// core IR (the pedal's solves, before their plans were written out, played
// 34 blocks a second of the 375 it needs), so it stays on compile.ts
// (C137d7, C137d9).
export const solvesSlowly = (ir: CoreIR): boolean =>
  [...emitCoreJs(ir).js.matchAll(/R\.rt\("(?:(solve|solveOne|solveAll):([^"]*)"|exists"|derive:)/g)].some((m) => !m[1] || !writtenOut(ir.code, JSON.parse(`"${m[2]}"`)));
const codeFor = (ir: CoreIR, js: string) => (solving(js) ? `JSON.parse(${JSON.stringify(JSON.stringify(solverCode(ir, js)))})` : "undefined");
// The nodes the evaluator's solver reads (C167c): those a solve's use
// reaches, through any id a node holds, and those of the lambdas a printed
// closure carries. spacetime's one solve reads 15 of its 39,966 nodes
// (5.2 MB of them). A derivative or `for some` looks inside the function
// it is given, a printed closure carrying its lambda, so it reads what that
// reaches, and the derivative's own definition what it reaches (C167d).
// The lambdas of the printed closures the evaluator's solver can be
// given (C167e): a closure of a function type that can reach a call that
// looks inside one (a solve, `for some`, a derivative, `set` and `path`)
// through its inputs' types, or through what such a closure captured.
// spacetime's one solve is given a Float64 → Text, so the lambdas of its
// other closures stay behind. Null where an input's type can't be told
// (then every closure's lambda, as before).
function lambdasLookedIn(ir: CoreIR): string[] | null {
  const keys = new Set<string>(), seen = new Set<string>();
  let unknown = false;
  const add = (t: LType): void => {
    if (t === "host") unknown = true;
    if (typeof t !== "object") return;
    if (seen.has(t.key)) return;
    seen.add(t.key);
    if ("result" in t) { keys.add(t.key); t.params.forEach(add); add(t.result); if (t.answer) add(t.answer); }
    else if ("cases" in t) t.cases.forEach((c) => c.fields.forEach((x) => add(x.t)));
    else if ("variant" in t) t.fields.forEach((x) => add(x.t));
    else if ("item" in t) add(t.item);
    else if ("keyT" in t) { add(t.keyT); add(t.value); }
  };
  const typeOf = (e: SExpr, f: SFunc): LType | null => {
    switch (e.k) {
      case "local": return f.locals[e.i];
      case "closure": return e.t;
      case "cap": return ir.shapes[e.shape].caps[e.i];
      case "field": return e.t.cases[e.c].fields[e.i].t;
      case "get": return e.t.fields[e.i].t;
      case "num": return "f64";
      case "text": return "text";
      case "int": return "int";
      case "bool": return "i32";
      default: return null;
    }
  };
  const closures: Extract<SExpr, { k: "closure" }>[] = [];
  for (const f of ir.funcs) {
    const walk = (e: SExpr): void => {
      if (e.k === "closure") closures.push(e);
      if (e.k === "rt" && LOOKS_INSIDE.test(e.fn)) for (const a of e.args) { const t = typeOf(a, f); if (t === null) unknown = true; else add(t); }
      kids(e).forEach(walk);
    };
    walk(f.body);
  }
  if (unknown) return null;
  // What a closure looked inside captured, the solver may call too.
  for (let before = -1; before !== keys.size; ) {
    before = keys.size;
    for (const c of closures) if (keys.has(c.t.key)) ir.shapes[c.shape].caps.forEach(add);
  }
  if (unknown) return null;
  return closures.filter((c) => keys.has(c.t.key) && c.src && "lambda" in c.src).map((c) => (c.src as { lambda: Id }).lambda);
}
export function solverCode(ir: CoreIR, js: string): Code {
  const nodes = ir.code.nodes as Record<string, unknown>;
  const roots = [...js.matchAll(/R\.rt\("(?:solve|solveOne|solveAll|derive):([^"]*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
  const lambdas = lambdasLookedIn(ir);
  roots.push(...(lambdas ?? [...js.matchAll(/\\?"lambda\\?":\\?"([^"\\]*)/g)].map((m) => JSON.parse(`"${m[1]}"`) as string)));
  const seen = new Set<string>(roots.filter((r) => nodes[r] !== undefined)), todo = [...seen];
  const walk = (v: unknown): void => {
    if (typeof v === "string") { if (nodes[v] !== undefined && !seen.has(v)) { seen.add(v); todo.push(v); } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { walk(k); walk(x); }
  };
  // And what is found the other way: a variant's type (run.ts's owner), a
  // lambda's definition (relate.ts, modes.ts), and every interface's
  // implementations (show and compare of a value find them by its type).
  const owner = ownerOfTypeParts(ir.code);
  const add = (id: string | undefined) => { if (id && nodes[id] !== undefined && !seen.has(id)) { seen.add(id); todo.push(id); } };
  // An implementation only once its type is reached: the types it is at
  // whose definitions are nodes (a builtin's Float64 or Text is none) are
  // all seen. spacetime's solve shows a Float64, so Float32's show and its
  // digits (1,000 nodes) stay behind.
  const impls = [...(ir.info.implementations ?? [])].map(([key, d]) => {
    const at = key.slice(key.indexOf("|") + 1), cons: string[] = [];
    if (at.startsWith("@")) cons.push(at.slice(1));
    else { const walkT = (t: Type): void => { if (t.t === "con") { cons.push(t.id); t.args.forEach(walkT); } else if (t.t === "fn") { t.params.forEach(walkT); walkT(t.ret); } }; walkT(JSON.parse(at) as Type); }
    return { d, cons: cons.filter((c) => nodes[c] !== undefined) };
  });
  const reachedImpls = () => { for (const x of impls) if (!seen.has(x.d) && x.cons.every((c) => seen.has(c))) add(x.d); };
  // A derivative's rules name the builtins they differentiate by id
  // (builtin.pow), not through a node, so it gets them all.
  // And the library's it writes into a derivative (pairs of a value and
  // its slope, +, the parts of a record): not reached from the program's
  // own nodes when only a derivative uses them.
  if (/R\.rt\("derive:/.test(js)) {
    for (const id of nodeIds(ir.code.nodes)) if (id.startsWith("builtin.")) add(id);
    for (const id of [FIRST, SECOND, PAIR_V, ...Object.values(ARITH), S.mapParts, S.zipParts, S.fail, S.total, S.abs, S.floor, S.float32, S.mod]) add(id);
  }
  for (let before = -1; before !== seen.size; ) {
    before = seen.size;
    while (todo.length) walk(nodes[todo.pop()!]);
    for (const id of [...seen]) add(owner.get(id));
    for (const d of ir.code.defs) if (seen.has((nodes[d] as { body?: string } | undefined)?.body ?? "")) add(d);
    reachedImpls();
  }
  return { nodes: Object.fromEntries([...seen].map((k) => [k, nodes[k]])) as Code["nodes"], defs: ir.code.defs.filter((d) => seen.has(d)) };
}

// A program's hosts/js.js (FOREIGN.md, C137d5): where it is, and the
// program's own operations by `effect:index`, as a perform names them
// (scalar.ts), with what the border needs of each (hosts.ts hostOp).
export interface Hosts { file: string; ops: HostOps }
export function hostOpsOf(code: Code, names: Record<Id, string>): HostOps {
  const out: HostOps = {};
  for (const op of ownOperations(code)) {
    const e = effectOfOperation(code, op);
    if (!e) continue;
    const i = (code.nodes[(code.nodes[e] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants.indexOf(op);
    out[`${e}:${i}`] = { ...hostOp(code, names, op), op };
  }
  return out;
}

// The solver, next to the runtime, imported only by a program that has
// its nodes (one that solves): it carries the library (C137d1).
// `beside` a global's name ($core, a prebuilt runtime: corePageRuntime):
// the solver is in it.
// And plan-rt.js, for one whose solves' plans are printed (C167a).
const solverFor = (code: string, beside: string, js: string) => {
  const at = (f: string) => JSON.stringify(beside.replace(/[^/]*$/, f));
  const plans = !/R\.planned\(\(\{/.test(js) ? [] : beside.startsWith("$") ? [`${beside}.usePlans(${beside}.plans);`] : [`import { usePlans } from ${at("core-rt.ts")};`, `import { plans } from ${at("plan-rt.js")};`, "usePlans(plans);"];
  if (code === "undefined") return plans;
  if (beside.startsWith("$")) return [...plans, `${beside}.useSolver(${beside}.solver);`];
  return [...plans, `import { useSolver } from ${at("core-rt.ts")};`, `import { solver } from ${at("core-solve.ts")};`, "useSolver(solver);"];
};

// The Float64 operations a mode plan runs forward (core-floats.ts,
// C251c), given to the runtime by a script that has one.
const floatsFor = (js: string, beside: string): string[] => {
  if (!js.includes("R.moded(")) return [];
  if (beside.startsWith("$")) return [`${beside}.useFloats(${beside}.floats);`];
  const at = (f: string) => JSON.stringify(beside.replace(/[^/]*$/, f));
  return [`import { useFloats as $useFloats } from ${at("core-rt.ts")};`, `import { floats as $floats } from ${at("core-floats.ts")};`, "$useFloats($floats);"];
};
// The builtins a printed script calls, given to its runtime (C251b,
// core-rt.ts useBuiltins): each imported by name from std-run.ts or
// std-run-many.ts, so a bundled page or module carries those only; a
// prebuilt runtime's global (`$core`) carries every one and has given
// them all (core-page-runtime.ts). Read off the script: every builtin's id it names, as a call
// (R.rt's), a host's, a mode plan's or a closure's.
const builtinsFor = (js: string, beside: string): string[] => {
  if (beside.startsWith("$")) return [];
  const ids = [...new Set(js.match(/builtin\.[A-Za-z0-9.]+/g) ?? [])].sort();
  const one = ids.filter((id) => STD_IMPL[id]), many = ids.filter((id) => STD_MANY[id]);
  if (!one.length && !many.length) return [];
  const lang = (f: string) => JSON.stringify(beside.replace(/[^/]*$/, `../../ters/src/lang/${f}`));
  const name = (id: string) => id.slice("builtin.".length).replace(/\./g, "$");
  const imports = (ids: Id[], from: string, at: number) => ids.length ? [`import { ${ids.map((id, i) => `${name(id)} as $b${at + i}`).join(", ")} } from ${lang(from)};`] : [];
  const table = (ids: Id[], at: number) => `{ ${ids.map((id, i) => `${JSON.stringify(id)}: $b${at + i}`).join(", ")} }`;
  return [
    `import { useBuiltins as $useBuiltins } from ${JSON.stringify(beside.replace(/[^/]*$/, "core-rt.ts"))};`,
    ...imports(one, "std-run.ts", 0),
    ...imports(many, "std-run-many.ts", one.length),
    `$useBuiltins(${table(one, 0)}, ${table(many, one.length)});`,
  ];
};

// What runs side by side (core-branches.ts, C251c), given to the runtime
// by a script that does: one naming any of its runtime names or world
// operations. A prebuilt runtime's global has given it (core-page-
// runtime.ts).
const branchesFor = (js: string, worlds: string[], beside: string): string[] => {
  if (beside.startsWith("$")) return [];
  const names = new Set(BRANCH_NAMES);
  const used = worlds.some((w) => BRANCH_WORLDS.includes(w)) || [...js.matchAll(/R\.rt\("([^"]*)"/g)].some((m) => names.has(m[1]));
  if (!used) return [];
  const at = (f: string) => JSON.stringify(beside.replace(/[^/]*$/, f));
  return [`import { useBranches as $useBranches } from ${at("core-rt.ts")};`, `import { branches as $branches } from ${at("core-branches.ts")};`, "$useBranches($branches);"];
};

// What a script takes from its runtime: imported from the file a bundler
// takes in, or from a prebuilt runtime's global ($core, C137d6).
const using = (names: string, from: string) => (from.startsWith("$") ? `const { ${names} } = ${from};` : `import { ${names} } from ${JSON.stringify(from)};`);
const wrapped = (from: string, lines: string[]) => (from.startsWith("$") ? ["(() => {", ...lines, "})();"] : lines).join("\n");

// A page's script (C137c9, `ters build-web --core`): the printed functions,
// with core-page.ts (`page`, which a bundler takes in, or the global of
// a prebuilt core-page-runtime.ts) drawing main.
// `worklet`: a page with sound, its audio thread's script (coreSoundScript
// bundled), which the page plays (C137d4).
// `bare`: a page saved or built (C143), with no node ids, as a module has
// none (moduleTags): its stops name their definition only, and its own
// cases are numbers where no audio thread runs main again beside it. The
// editor's preview keeps them, for Show where it stopped (C143g).
// Every function and every round of a loop takes a step from a page's
// budget while f prints (E319d): the editor's preview, whose page runs on
// the editor's thread and must stop when its budget runs out. A page in a
// tab, and every other target, steps only where a definition may not
// finish (C179).
let everyStep = false;
export function stepEverywhere<T>(f: () => T): T {
  const was = everyStep;
  everyStep = true;
  try { return f(); } finally { everyStep = was; }
}

export function corePageScript(ir: CoreIR, name: string, page: string, title: string, worklet?: string, hosts?: Hosts, bare = false): string {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  if (fi < 0 || ir.funcs[fi].params.length) throw new Error(`${name}: not compiled, or not a page's main`);
  // Only what main reaches.
  const only = reachedFuncs(ir, [fi]);
  const { names, worlds, js: all } = emitCoreJs(ir, only);
  const js0 = bare ? moduleTags(ir, !!hosts || worklet !== undefined, only).js : all;
  // A map on the page's workers (C61 c′): the functions by name, and the
  // page's own script, which each worker runs (core-page.ts).
  const js1 = worlds.includes("mapAway") || worlds.includes("searchAway") ? withFunctionsNamed(js0, "R.pageBranches(typeof document === \"undefined\" ? undefined : document.currentScript?.textContent ?? undefined, ", poolHeld("JavaScript page")) : js0;
  // Its maps the GPU may run, each as a kernel (C61 d′, gpu-maps.ts).
  // And its draws the GPU takes, each as a site (G9c, gpu-draws.ts); a
  // list only kernels and draws read kept on the GPU between ticks (G13b,
  // gpu-resident.ts), the kernels whose answers it is marked so.
  const away = worlds.includes("mapAway") ? gpuMaps(ir) : {}, kept = keptOnGpu(ir, away);
  const kernels = Object.fromEntries(Object.entries(away).map(([s, m]) => [s, kept.resident.sites.includes(Number(s)) ? { ...m, resident: true as const } : m]));
  const js = Object.keys(kernels).length ? `R.pageGpu(${JSON.stringify(kernels)});\n${js1}` : js1;
  const code = codeFor(ir, js);
  const draws = kept.draws;
  const drawn = Object.keys(draws).length ? [using("pageDraws", page), `pageDraws(${JSON.stringify(draws)}, ${packsOf(draws)});`] : [];
  return wrapped(page, [
    using("startCorePage", page),
    ...drawn,
    ...solverFor(code, page, js),
    ...floatsFor(js, page),
    ...builtinsFor(js, page),
    ...branchesFor(js, worlds, page),
    // What plays its sound, where it has one (C251c).
    // What renders its frames, where it renders one.
    ...(page.startsWith("$") || !js.includes(JSON.stringify(HTML_V.render)) ? [] : [using("useRender", page), `import { renderFrame as $renderFrame } from ${JSON.stringify(page.replace(/[^/]*$/, "../../ters/src/lang/frame-render.ts"))};`, "useRender($renderFrame);"]),
    ...(worklet === undefined || page.startsWith("$") ? [] : [`import { useSound as $useSound } from ${JSON.stringify(page)};`, `import { recordingWorld as $recordingWorld, soundPlayer as $soundPlayer } from ${JSON.stringify(page.replace(/[^/]*$/, "../../ters/src/lang/audio-page.ts"))};`, "$useSound({ recordingWorld: $recordingWorld, soundPlayer: $soundPlayer });"]),
    ...(hosts ? [`import $hostAnswers from ${JSON.stringify(hosts.file)};`] : []),
    `startCorePage(${JSON.stringify(tableSpecs(ir))}, ${JSON.stringify(worlds)}, (R) => {`,
    js,
    `}, ${JSON.stringify(names[fi])}, ${JSON.stringify(title)}, ${code}, ${worklet === undefined ? "undefined" : JSON.stringify(worklet)}${hosts ? `, { answers: $hostAnswers, ops: ${JSON.stringify(hosts.ops)} }` : ""});`,
  ]);
}

// The audio thread's script for a page with sound (C137d4): the printed
// functions, with core-sound.ts (`sound`, which a bundler takes in)
// running main again there and playing its block functions; `sound`
// may be a prebuilt runtime's global, as for a page. `hosts`: the
// program's hosts/js.js, asked there too (C137d10).
export function coreSoundScript(ir: CoreIR, name: string, sound: string, hosts?: Hosts): string {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  if (fi < 0 || ir.funcs[fi].params.length) throw new Error(`${name}: not compiled, or not a page's main`);
  const { js, names, worlds } = emitCoreJs(ir, reachedFuncs(ir, [fi]));
  const code = codeFor(ir, js);
  return wrapped(sound, [
    using("startCoreSound", sound),
    ...solverFor(code, sound, js),
    ...floatsFor(js, sound),
    ...builtinsFor(js, sound),
    ...branchesFor(js, worlds, sound),
    ...(hosts ? [`import $hostAnswers from ${JSON.stringify(hosts.file)};`] : []),
    `startCoreSound(${JSON.stringify(tableSpecs(ir))}, ${JSON.stringify(worlds)}, (R) => {`,
    js,
    `}, ${JSON.stringify(names[fi])}, ${code}${hosts ? `, { answers: $hostAnswers, ops: ${JSON.stringify(hosts.ops)} }` : ""});`,
  ]);
}
