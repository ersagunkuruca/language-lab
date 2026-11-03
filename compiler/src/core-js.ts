// JavaScript printed from the core IR (C137c, docs/design/targets/CORE-IR.md):
// the printer that is to replace compile.ts, which lowers the model a
// second way. Grown in steps, checked by the fuzz test (C101) against the
// evaluator; this first step takes the `data` profile's values and
// control, with Int, Text and Array through the evaluator's own builtins.
//
// Values are the evaluator's (C137c6), so the evaluator's runtime (the
// library, tables, pages and cells) takes them as they are: a Float64 is
// a number, an Int a number while small, else a bigint (int.ts), a Text a
// string, a record or a data type's value { tag, fields } (run.ts Data),
// a closure a function of its inputs holding what it captured, an Array
// the evaluator's. Only a Bool differs: a boolean, turned at the runtime's
// edge. No answer (Choice) is the exception `FAIL`,
// caught by the nearest attempt; an abort is an `Aborted`, caught by its
// handler; a budget running out is `OUT`. A runtime function or world
// operation this printer doesn't have yet throws `Unsupported` when it is
// reached, so a program runs as far as it can. Tables and Hash sets are
// the evaluator's (C137c2), Random seeded is random.ts's generator, and
// the world is the evaluator's Runtime (C137c3, runCoreMain).

import { ARRAY_OPS, CONS, FALSE, HASH_SET_OPS, NIL, NONE, S, SOME, STD_IMPL, STD_MANY, TABLE_OPS, TRUE } from "../../ters/src/lang/std.ts";
import { cellOps, equal, solveAnswers, toList, type Runtime, type Value, type World } from "../../ters/src/lang/run.ts";
import { Cells, NoValue } from "../../ters/src/lang/cells.ts";
import { NoAnswer } from "../../ters/src/lang/html.ts";
import { worldRandom } from "../../ters/src/lang/random.ts";
import * as I from "../../ters/src/lang/int.ts";
import * as T from "../../ters/src/lang/text.ts";
import { useTarget, type Code, type Id, type Use } from "../../ters/src/model.ts";
import { ARRAY_RT, RT, isData, isRecord, type CoreIR, type LType, type Op, type SExpr, type SFunc, type TType } from "./scalar.ts";
import { runtime } from "./wasm-rt.ts";
import { STOPS } from "./stops.ts";

export class Unsupported extends Error {}
export class Stopped extends Error {}
export class Aborted { reason: unknown; esc: number; constructor(reason: unknown, esc: number) { this.reason = reason; this.esc = esc; } }
export const FAIL = { fail: true }, OUT = { out: true };

const INFIX: Partial<Record<Op, string>> = { add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "===", beq: "===", and: "&&", or: "||" };
const MATH: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "abs", floor: "floor", float32: "fround", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", pow: "pow", atan2: "atan2" };

// The runtime functions by name: the evaluator's builtin where there is
// one (scalar.ts RT and ARRAY_RT, read backwards), with lists and Bools
// turned between the two forms; the rest written here.
const BUILTIN = new Map<string, Id>([...Object.entries(RT), ...Object.entries(ARRAY_RT), [ARRAY_OPS.replaceAt, "array.replaceAt"]].map(([id, n]) => [n, id]));
const big = (x: I.Int) => BigInt(x);
// UTF-8 as a browser has it too (a page's script, C137c9).
const UTF8 = new TextEncoder();
const OWN: Record<string, (...xs: never[]) => unknown> = {
  "int.equal": (a: I.Int, b: I.Int) => a === b,
  "int.less": (a: I.Int, b: I.Int) => a < b,
  "text.equal": (a: string, b: string) => a === b,
  "text.less": (a: string, b: string) => T.less(a, b),
  "text.quoted": (t: string) => JSON.stringify(t),
  "int.exact": (a: I.Int, b: I.Int) => I.norm(big(a) / big(b)),
  "int.gcd": (a: I.Int, b: I.Int) => { let x = big(a) < 0n ? -big(a) : big(a), y = big(b) < 0n ? -big(b) : big(b); while (y) [x, y] = [y, x % y]; return I.norm(x); },
  // run.ts's, which the evaluator has outside std.ts.
  "number.range": (n: number) => toList(Array.from({ length: Math.max(0, n) }, (_, i) => i)),
  "text.size": (t: string) => UTF8.encode(t).length,
  "text.bytes": (t: string, a: number, b: number) => new TextDecoder().decode(UTF8.encode(t).subarray(a, b)),
  // Where the character that ends at byte i (> 0) starts.
  "text.before": (t: string, i: number) => { const b = UTF8.encode(t); do i--; while (i > 0 && (b[i] & 0xc0) === 0x80); return i; },
};
// A Table or Hash set (C63h, C63i) is the evaluator's (std.ts Table: a
// Map with Baker's versions), a record key given as the evaluator's
// record and taken back from its entries.
const TABLE = /^table\.(\w+)\.t(\d+)(?:\.e\d+)?$/;
// What the runtime needs of the program's tables, as plain data a module
// can carry: whether each is a Hash set.
export interface TableSpec { set: boolean }
export const tableSpec = (t: TType): TableSpec => ({ set: t.set });
function tableFn(op: string, t: TableSpec): (...xs: unknown[]) => unknown {
  const bool = (v: unknown) => (v as { tag: Id }).tag === TRUE;
  const impl = (id: Id) => STD_IMPL[id] as (...xs: unknown[]) => unknown;
  switch (op) {
    case "empty": return () => impl(TABLE_OPS.empty)();
    case "put": return (m, k, v) => impl(TABLE_OPS.put)(m, k, v);
    case "remove": return (m, k) => impl(TABLE_OPS.remove)(m, k);
    case "has": return (m, k) => bool(impl(TABLE_OPS.has)(m, k));
    case "size": return (m) => impl(TABLE_OPS.size)(m);
    case "at": return (m, k) => { const r = STD_MANY[TABLE_OPS.at](m, k); if (!r.length) throw FAIL; return r[0]; };
    case "entries": return t.set ? (m) => impl(HASH_SET_OPS.items)(m) : (m) => impl(TABLE_OPS.entries)(m);
  }
  return () => { throw new Unsupported(`table.${op}`); };
}
// Random under seeded (C106): random.ts's xoshiro128** seeded by
// SplitMix32, its four words in r, as WebAssembly's globals $r0 to $r3.
function randFns(r: Uint32Array): Record<string, (...xs: never[]) => unknown> {
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const mix = (z: number) => { let x = z; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
  const word = () => {
    const [a, b] = [r[0], r[1]], out = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0, t = b << 9;
    r[2] ^= a; r[3] ^= b; r[1] ^= r[2]; r[0] ^= r[3]; r[2] ^= t; r[3] = rotl(r[3], 11);
    return out;
  };
  return {
    "rand.seed": (seed: number) => { let z = Math.floor(seed) >>> 0; for (let i = 0; i < 4; i++) { z = (z + 0x9e3779b9) >>> 0; r[i] = mix(z); } return 0; },
    "rand.next": () => ((word() >>> 5) * 67108864 + (word() >>> 6)) / 9007199254740992,
    "rand.s0": () => r[0], "rand.s1": () => r[1], "rand.s2": () => r[2], "rand.s3": () => r[3],
    "rand.unset": () => !(r[0] | r[1] | r[2] | r[3]),
    "rand.restore": (a: number, b: number, c: number, d: number) => { r.set([a, b, c, d]); return 0; },
  };
}
function rtFn(name: string, tables?: TableSpec[], rand?: Record<string, (...xs: never[]) => unknown>, cells?: Record<Id, (...xs: Value[]) => Value | undefined>, code?: Code, spend?: () => boolean): (...xs: unknown[]) => unknown {
  if (name.startsWith("host:")) return hostFn(name, cells);
  if (name.startsWith("solve:")) return solveFn(name.slice(6), code, false, spend);
  if (name.startsWith("solveAll:")) return solveFn(name.slice(9), code, true, spend);
  if (name.startsWith("pick:")) { const [, j, bool] = name.split(":"); return (xs) => { const v = (xs as Value[])[Number(j)]; return bool ? (v as unknown) === true || (v as { tag?: Id }).tag === TRUE : v; }; }
  const tm = TABLE.exec(name);
  if (tm && tables) return tableFn(tm[1], tables[Number(tm[2])]);
  if (rand?.[name]) return rand[name] as (...xs: unknown[]) => unknown;
  const base = name.replace(/\.a\d+$/, "");
  if (OWN[base]) return OWN[base] as (...xs: unknown[]) => unknown;
  const id = BUILTIN.get(base === "array.get" ? "array.at" : base);
  const one = id ? STD_IMPL[id] : undefined, many = id ? STD_MANY[id] : undefined;
  if (!one && !many) return () => { throw new Unsupported(name); };
  const meta = runtime(name);
  const out = meta.result === "i32" ? (v: unknown) => (typeof v === "object" && v !== null && "tag" in v ? (v as { tag: Id }).tag === TRUE : v) : (v: unknown) => v;
  // array.get's place is an i32; array.at's an Int.
  const conv = base === "array.get" ? (xs: unknown[]) => [xs[0], I.norm(BigInt(xs[1] as number))] : (xs: unknown[]) => xs;
  if (one) return (...xs) => out(one(...conv(xs)));
  return (...xs) => { const r = many!(...conv(xs)); if (!r.length) throw FAIL; return out(r[0]); };
}

// A builtin the core IR has no lowering for (C137c7, scalar.ts host):
// the evaluator's own, by its id, a Bool given turned to the evaluator's
// and one given back (`:bool`) turned back; no answer is FAIL.
function hostFn(name: string, cells?: Record<Id, (...xs: Value[]) => Value | undefined>): (...xs: unknown[]) => unknown {
  const [, id, bool] = name.split(":");
  const out = bool ? (v: unknown) => v === true || (v as { tag?: Id }).tag === TRUE : (v: unknown) => v;
  const cell = cells?.[id];
  if (cell) return (...xs) => { const v = cell(...(xs.map(inn) as Value[])); if (v === undefined) throw FAIL; return out(v); };
  const one = STD_IMPL[id], many = STD_MANY[id];
  if (one) return (...xs) => out(one(...xs.map(inn)));
  if (many) return (...xs) => { const r = many(...xs.map(inn)); if (!r.length) throw FAIL; return out(r[0]); };
  return () => { throw new Unsupported(name); };
}
// A relation run some way with one answer (C137c11, scalar.ts solveUse):
// the evaluator's solve on the program's code, its first answer's values.
// `spend`: one step of the printed program's budget, as the evaluator's
// solve spends its innermost fuel; false ends the search there.
function solveFn(id: Id, code?: Code, all = false, spend?: () => boolean): (...xs: unknown[]) => unknown {
  if (!code) return () => { throw new Unsupported(`solve ${id} without the program`); };
  const n = code.nodes[id] as Use, keys = Object.keys(n.given);
  const answers = (xs: unknown[]) => solveAnswers(code, n, Object.fromEntries(keys.map((k, i) => [k, inn(xs[i])])), { spend });
  // Every answer, a List of them (`solveAll`) made as it is read: a
  // periodic solution (an angle) has no end, and `one of` it stops at the
  // first that the rest of the search takes, as the evaluator's does.
  if (all) return (...xs) => lazyList(answers(xs));
  return (...xs) => {
    for (const bound of answers(xs)) return bound;
    throw new Error(`solving ${useTarget(code.nodes, n)} this way gives exactly one answer, and it gave none`);
  };
}
class LazyCell {
  private cell?: { tag: Id; fields: unknown[] };
  private it: Iterator<unknown>;
  constructor(it: Iterator<unknown>) { this.it = it; }
  private get forced() { if (!this.cell) { const r = this.it.next(); this.cell = r.done ? { tag: NIL, fields: [] } : { tag: CONS, fields: [r.value, new LazyCell(this.it)] }; } return this.cell; }
  get tag() { return this.forced.tag; }
  get fields() { return this.forced.fields; }
}
const lazyList = (it: Iterator<unknown>) => new LazyCell(it);
const inn = (x: unknown) => (typeof x === "boolean" ? { tag: x ? TRUE : FALSE, fields: [] } : x);
// Cells' operations (run.ts cellOps) on the runtime's handler, calling the
// program's closures: no answer is a formula with no value.
function cellFns(cells: Cells) {
  return cellOps(cells, (f, ...xs) => {
    try { return inn((f as unknown as (...a: unknown[]) => unknown)(...xs)) as Value; } catch (e) { if (e === FAIL) throw new NoValue("gave no value"); throw e; }
  });
}

export const RUNTIME = {
  FAIL, OUT, Aborted, Unsupported, rt: rtFn,
  fail: (): never => { throw FAIL; },
  stop: (i: number): never => { throw new Stopped(STOPS[i]); },
  mod: (a: number, b: number) => ((a % b) + b) % b,
  unsupported: (what: string): never => { throw new Unsupported(what); },
  int: (s: string) => I.norm(BigInt(s)),
  // A data value's case number, for `tag`.
  caseOf: (x: { tag: Id }, variants: Id[]) => variants.indexOf(x.tag),
  // A closure: a function of its inputs, calling its code with itself
  // first, holding what it captured, so the evaluator's runtime (a page,
  // the library) calls it as any function.
  closure: (code: (...xs: unknown[]) => unknown, caps: unknown[]) => { const c = Object.assign((...xs: unknown[]) => code(c, ...xs), { caps }); return c; },
  show: STD_IMPL[S.show],
};

// The source of a function of the runtime giving every function, by name.
// `worlds`: the world's operations it calls, which the loader gives as
// R.worlds in that order.
export function emitCoreJs(ir: CoreIR): { js: string; names: string[]; worlds: string[] } {
  const names = ir.funcs.map((_, i) => `f${i}`);
  const rts = new Map<string, string>();
  const rtName = (n: string) => { if (!rts.has(n)) rts.set(n, `rt${rts.size}`); return rts.get(n)!; };
  const worlds: string[] = [];
  const worldName = (op: string) => { let i = worlds.indexOf(op); if (i < 0) i = worlds.push(op) - 1; return `w${i}`; };
  const text = ir.funcs.map((f, i) => func(f, i));
  const js = [
    "let fuel = Infinity;",
    // A backwards search spends the budget too (C137c12).
    "R.spending(() => --fuel >= 0);",
    ...[...rts].map(([n, v]) => `const ${v} = R.rt(${JSON.stringify(n)});`),
    ...worlds.map((_, i) => `const w${i} = R.worlds[${i}];`),
    ...text,
    `return { ${names.join(", ")} };`,
  ].join("\n");
  return { js, names, worlds };

  function func(f: SFunc, i: number): string {
    let temps = 0;
    const temp = () => `t${temps++}`;
    const local = (j: number) => `l${j}`;
    const self = (e: SExpr): boolean => (e.k === "call" && e.fn === i && e.tail) || kidsOf(e).some(self);
    const loops = self(f.body);

    // An expression, with the statements it needs first.
    function ex(e: SExpr, pre: string[], d: string): string {
      switch (e.k) {
        case "num": return Object.is(e.v, -0) ? "(-0)" : e.v < 0 ? `(${e.v})` : Number.isFinite(e.v) ? String(e.v) : e.v > 0 ? "Infinity" : e.v < 0 ? "(-Infinity)" : "NaN";
        case "int": { const v = I.norm(e.v); return typeof v === "bigint" ? `(${v}n)` : `(${v})`; }
        case "text": return JSON.stringify(e.v);
        case "bool": return String(e.v);
        case "local": return local(e.i);
        case "zero": if (e.none) return "R.fail()"; return zero(e.t);
        case "op": {
          const xs = e.args.map((a) => ex(a, pre, d));
          if (INFIX[e.op]) return `(${xs[0]} ${INFIX[e.op]} ${xs[1]})`;
          if (e.op === "neg") return `(-${xs[0]})`;
          if (e.op === "not") return `(!${xs[0]})`;
          if (e.op === "mod") return `R.mod(${xs.join(", ")})`;
          if (e.op === "stop") return `R.stop(${xs[0]})`;
          if (MATH[e.op]) return `Math.${MATH[e.op]}(${xs.join(", ")})`;
          return `R.unsupported(${JSON.stringify(`op ${e.op}`)})`;
        }
        case "let": pre.push(`${d}${local(e.i)} = ${ex(e.value, pre, d)};`); return ex(e.body, pre, d);
        case "if": {
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}let ${t};`, `${d}if (${c}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "call": {
          // Its inputs computed first: a call's own statements must not
          // come between them.
          const xs = e.args.map((a) => ex(a, pre, d));
          return `${names[e.fn]}(${xs.join(", ")})`;
        }
        case "make": return `{ tag: ${JSON.stringify(e.t.variant)}, fields: [${e.args.map((a) => ex(a, pre, d)).join(", ")}] }`;
        case "get": return `${ex(e.rec, pre, d)}.fields[${e.i}]`;
        case "new": return `{ tag: ${JSON.stringify(e.t.cases[e.c].variant)}, fields: [${e.args.map((a) => ex(a, pre, d)).join(", ")}] }`;
        case "field": return `${ex(e.rec, pre, d)}.fields[${e.i}]`;
        case "tag": return `R.caseOf(${ex(e.rec, pre, d)}, ${JSON.stringify(e.t.cases.map((c) => c.variant))})`;
        case "closure": return `R.closure(${names[e.fn]}, [${e.caps.map((a) => ex(a, pre, d)).join(", ")}])`;
        case "cap": return `l0.caps[${e.i}]`;
        case "apply": {
          const c = ex(e.fn, pre, d), xs = e.args.map((a) => ex(a, pre, d));
          pre.push(`${d}${local(e.tmp)} = ${c};`);
          return `${local(e.tmp)}(${xs.join(", ")})`;
        }
        case "case": {
          pre.push(`${d}${local(e.s)} = ${ex(e.scrut, pre, d)};`);
          const t = temp();
          pre.push(`${d}let ${t};`, `${d}switch (${local(e.s)}.tag) {`);
          e.arms.forEach((a, c) => { if (a) pre.push(`${d}  case ${JSON.stringify(e.t.cases[c].variant)}: {`, ...block(a, { set: t }, d + "    "), `${d}    break;`, `${d}  }`); });
          pre.push(`${d}}`);
          return t;
        }
        case "rt": {
          const xs = e.args.map((a) => ex(a, pre, d));
          return `${rtName(e.fn)}(${xs.join(", ")})`;
        }
        case "world": { const xs = e.args.map((a) => ex(a, pre, d)); return `${worldName(e.op)}(${xs.join(", ")})`; }
        case "fail": return "R.fail()";
        case "attempt": {
          const ok = temp(), t = temp();
          pre.push(`${d}let ${ok} = true;`, `${d}try {`, ...block(e.body, { set: local(e.res) }, d + "  "), `${d}} catch (x) {`, `${d}  if (x !== R.FAIL) throw x;`, `${d}  ${ok} = false;`, `${d}}`);
          pre.push(`${d}let ${t};`, `${d}if (${ok}) {`, ...block(e.ok, { set: t }, d + "  "), `${d}} else {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "budget": {
          const s = temp(), out = temp(), t = temp();
          pre.push(`${d}const ${s} = fuel;`, `${d}fuel = ${e.n};`, `${d}let ${t}, ${out} = false;`, `${d}try {`, ...block(e.body, { set: t }, d + "  "), `${d}} catch (x) {`, `${d}  if (x !== R.OUT) { fuel = ${s}; throw x; }`, `${d}  ${out} = true;`, `${d}}`, `${d}fuel = ${s};`);
          pre.push(`${d}if (${out}) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "abort": return `R.abort(${ex(e.reason, pre, d)}, ${e.esc ?? 0})`;
        case "handle": {
          const t = temp();
          pre.push(`${d}let ${t};`, `${d}try {`, ...block(e.body, { set: t }, d + "  "), `${d}} catch (x) {`, `${d}  if (!(x instanceof R.Aborted) || x.esc !== ${e.esc ?? 0}) throw x;`, `${d}  ${local(e.reason)} = x.reason;`, ...block(e.arm, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "set": { const r = ex(e.rec, pre, d); pre.push(`${d}${r}.fields[${e.i}] = ${ex(e.value, pre, d)};`); return ex(e.then, pre, d); }
        case "choose": case "search": throw new Error(`${e.k} is gone after lowering`);
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    function block(e: SExpr, to: { set: string } | "return", d: string): string[] {
      const out: string[] = [];
      if (e.k === "let") {
        out.push(`${d}${local(e.i)} = ${ex(e.value, out, d)};`);
        return [...out, ...block(e.body, to, d)];
      }
      if (e.k === "if") {
        const c = ex(e.cond, out, d);
        return [...out, `${d}if (${c}) {`, ...block(e.then, to, d + "  "), `${d}} else {`, ...block(e.else, to, d + "  "), `${d}}`];
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: every new value computed before any is set.
        const xs = e.args.map((a) => ex(a, out, d)), ts = xs.map(() => temp());
        xs.forEach((x, j) => out.push(`${d}const ${ts[j]} = ${x};`));
        ts.forEach((t, j) => out.push(`${d}${local(j)} = ${t};`));
        return [...out, `${d}continue;`];
      }
      const x = ex(e, out, d);
      return [...out, to === "return" ? `${d}return ${x};` : `${d}${to.set} = ${x};`];
    }

    // One from the budget per call, and per round of the loop.
    const spend = (d: string) => (f.spends ? [`${d}if (--fuel < 0) throw R.OUT;`] : []);
    const params = f.params.map((_, j) => local(j)), locals = f.locals.map((_, j) => local(f.params.length + j));
    const body = loops ? ["  for (;;) {", ...spend("    "), ...block(f.body, "return", "    "), "  }"] : [...spend("  "), ...block(f.body, "return", "  ")];
    return [`// ${f.name.replace(/\n/g, " ")}`, `function ${names[i]}(${params.join(", ")}) {`, ...(locals.length ? [`  let ${locals.join(", ")};`] : []), ...body, "}"].join("\n");
  }
}

// What a variable starts as.
function zero(t: LType): string {
  if (t === "f64" || t === "int32") return "0";
  if (t === "i32") return "false";
  if (t === "int") return "0";
  if (t === "text") return '""';
  if (typeof t === "object" && isRecord(t)) return `{ tag: ${JSON.stringify(t.variant)}, fields: [${t.fields.map((x) => zero(x.t)).join(", ")}] }`;
  if (typeof t === "object" && isData(t)) return "null";
  return "null";
}

function kidsOf(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return e.args;
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
    case "set": return [e.rec, e.value, e.then];
    default: return [];
  }
}

// The world's operations (scalar.ts WORLD_OPS) over the evaluator's
// Runtime, as wasm.ts's worldOf: one that fails aborts with its reason.
function worldFn(op: string, rt: Runtime): (...xs: unknown[]) => unknown {
  const w = <K extends keyof World>(k: K): World[K] => {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" ? "write to standard error" : k}`); }) as unknown as World[K];
    return f.bind(rt.world) as World[K];
  };
  const tried = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof Aborted) throw e; throw new Aborted((e as Error).message, 0); } };
  switch (op) {
    case "randomSeed": return () => Math.floor(Math.random() * 4294967296);
    case "now": return () => (rt.world?.now ?? Date.now)();
    case "random": return () => (rt.world?.random ?? worldRandom)();
    case "print": return (s) => { rt.print(s as string); return []; };
    case "printError": return (s) => { w("error")(s as string); return []; };
    case "readInput": return () => tried(() => w("input")());
    case "readLine": return () => tried(() => { const l = w("readLine")(); return l === null ? { tag: NONE, fields: [] } : { tag: SOME, fields: [l] }; });
    case "readFile": return (p) => tried(() => w("readFile")(p as string));
    case "writeFile": return (p, s) => tried(() => { w("writeFile")(p as string, s as string); return []; });
    case "appendFile": return (p, s) => tried(() => { w("appendFile")(p as string, s as string); return []; });
    case "fileExists": return (p) => w("fileExists")(p as string);
    case "listFolder": return (p) => tried(() => toList(w("listFolder")(p as string)));
  }
  return () => { throw new Unsupported(`world ${op}`); };
}

// What the printed functions are given as R: the runtime, the tables'
// and the world's operations, a fresh generator.
export function coreRuntime(tables: TableSpec[], worlds: string[], rt: Runtime, code?: Code) {
  const rand = randFns(new Uint32Array(4)), cells = cellFns(rt.cells ?? new Cells(equal));
  let spend = () => true;
  return { ...RUNTIME, spending: (f: () => boolean) => { spend = f; }, rt: (n: string) => rtFn(n, tables, rand, cells, code, () => spend()), worlds: worlds.map((op) => worldFn(op, rt)), abort: (reason: unknown, esc: number): never => { throw new Aborted(reason, esc); } };
}

// The functions, by their place in ir.funcs. `rt`: the console and files.
export function loadCoreJs(ir: CoreIR, rt: Runtime = { print: () => {} }): ((...xs: unknown[]) => unknown)[] {
  const { js, names, worlds } = emitCoreJs(ir);
  const all = new Function("R", js)(coreRuntime(ir.tables.map(tableSpec), worlds, rt, ir.code)) as Record<string, (...xs: unknown[]) => unknown>;
  return names.map((n) => all[n]);
}

// How the evaluator's runtime (a page's mount, html.ts) calls a function
// printed here: its value, no answer being html.ts's NoAnswer.
export const coreCall = (f: Value, ...xs: Value[]): Value => {
  try { return (f as unknown as (...a: Value[]) => Value)(...xs); } catch (e) { if (e === FAIL) throw new NoAnswer(); throw e; }
};

// What running a main needs to know of it: whether it takes the
// arguments, and what it gives.
export interface MainSpec { args: boolean; result: "f64" | "int" | "other" }
function mainOf(ir: CoreIR, name: string): [number, MainSpec] {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted), f = ir.funcs[fi];
  if (!f || f.params.length > 1) throw new Error(`${name}: not compiled, or not a main`);
  if (f.params.length && !isData(f.params[0])) throw new Error(`${name} takes something other than a List of Texts`);
  return [fi, { args: f.params.length > 0, result: f.result === "f64" ? "f64" : f.result === "int" ? "int" : "other" }];
}

// Runs a main as wasm.ts's runMain does: given the arguments as a List of
// Texts if it takes them; an abort or a stop nobody handles is written to
// standard error, and the exit code is 1.
export function runCoreFn(fn: (...xs: unknown[]) => unknown, m: MainSpec, args: string[], rt: Runtime): number {
  const err = rt.world?.error ?? rt.print;
  let v: unknown;
  try { v = fn(...(m.args ? [toList(args)] : [])); } catch (e) {
    if (e instanceof Aborted) { err(String(e.reason)); return 1; }
    if (e instanceof Stopped) { err(e.message); return 1; }
    if (e === FAIL) throw new Error("main had no answer");
    throw e;
  }
  return m.result === "other" ? 0 : Number(v);
}
export function runCoreMain(ir: CoreIR, name: string, args: string[], rt: Runtime): number {
  const [fi, m] = mainOf(ir, name);
  return runCoreFn(loadCoreJs(ir, rt)[fi], m, args, rt);
}

// The program as a module that runs main in Node (C137c5, `lab compile
// --core`): the printed functions, with the runtime imported from
// `runtime` (this file, which a bundler takes in) and Node's world.
export function coreModule(ir: CoreIR, name: string, runtime: string, world: string): string {
  const [fi, m] = mainOf(ir, name);
  const { js, names, worlds } = emitCoreJs(ir);
  return [
    `import { coreRuntime, runCoreFn } from ${JSON.stringify(runtime)};`,
    `import { nodeWorld } from ${JSON.stringify(world)};`,
    "const rt = { print: (s) => console.log(s), world: nodeWorld() };",
    `const R = coreRuntime(${JSON.stringify(ir.tables.map(tableSpec))}, ${JSON.stringify(worlds)}, rt, ${codeFor(ir, js)});`,
    "const defs = (function (R) {",
    js,
    "})(R);",
    `process.exitCode = runCoreFn(defs.${names[fi]}, ${JSON.stringify(m)}, process.argv.slice(2), rt);`,
  ].join("\n");
}

// The program's nodes, for a module whose solves the evaluator's solver
// runs (C137c11): only when it has one.
const codeFor = (ir: CoreIR, js: string) => (/R\.rt\("solve/.test(js) ? JSON.stringify({ nodes: ir.code.nodes, defs: ir.code.defs }) : "undefined");

// A page's script (C137c9, `lab build-web --core`): the printed functions,
// with core-page.ts (`page`, which a bundler takes in) drawing main.
export function corePageScript(ir: CoreIR, name: string, page: string, title: string): string {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  if (fi < 0 || ir.funcs[fi].params.length) throw new Error(`${name}: not compiled, or not a page's main`);
  const { js, names, worlds } = emitCoreJs(ir);
  return [
    `import { startCorePage } from ${JSON.stringify(page)};`,
    `startCorePage(${JSON.stringify(ir.tables.map(tableSpec))}, ${JSON.stringify(worlds)}, (R) => {`,
    js,
    `}, ${JSON.stringify(names[fi])}, ${JSON.stringify(title)}, ${codeFor(ir, js)});`,
  ].join("\n");
}
