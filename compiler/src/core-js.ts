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

import { ARRAY_OPS } from "../../ters/src/lang/std.ts";
import { toList, type Runtime } from "../../ters/src/lang/run.ts";
import { fusedProgram } from "./handlers.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import type { Code, Id, NodeOf } from "../../ters/src/model.ts";
import { effectOfOperation, hostOp, ownOperations } from "../../ters/src/lang/hosts.ts";
import * as I from "../../ters/src/lang/int.ts";
import { ARRAY_RT, listSteps, RT, isData, isRecord, lowerScalar, type CoreIR, type LType, type Op, type SExpr, type SFunc, type TType } from "./scalar.ts";
import { runtime } from "./wasm-rt.ts";
import { STOPS } from "./stops.ts";
import { Aborted, FAIL, OUT, RUNTIME, Stopped, Unsupported, coreRuntime, runCoreFn, type BuiltinOf, type HostOps, type MainSpec, type TableSpec } from "./core-rt.ts";
// The runtime is core-rt.ts's; these are here too, for the tests and
// tools that print and run in one.
// The solver too, for the programs run here that solve (core-solve.ts).
import "./core-solve.ts";
export { Aborted, FAIL, OUT, RUNTIME, Stopped, Unsupported, coreCall, coreRuntime, runCoreFn, type MainSpec, type TableSpec } from "./core-rt.ts";


// The runtime functions by name: the evaluator's builtin where there is
// one (scalar.ts RT and ARRAY_RT, read backwards), told to the runtime
// with whether it gives a Bool (wasm-rt.ts's signature), so the runtime
// needn't know scalar.ts (C149).
const BUILTIN = new Map<string, Id>([...Object.entries(RT), ...Object.entries(ARRAY_RT), [ARRAY_OPS.replaceAt, "array.replaceAt"]].map(([id, n]) => [n, id]));
function builtinOf(name: string): BuiltinOf | undefined {
  const base = name.replace(/\.a\d+$/, "");
  const id = BUILTIN.get(base === "array.get" ? "array.at" : base);
  return id ? [id, runtime(name).result === "i32"] : undefined;
}
export const tableSpec = (t: TType): TableSpec => ({ set: t.set });

const INFIX: Partial<Record<Op, string>> = { add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "===", beq: "===", and: "&&", or: "||" };
const MATH: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "abs", floor: "floor", float32: "fround", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", pow: "pow", atan2: "atan2" };


// The source of a function of the runtime giving every function, by name.
// `worlds`: the world's operations it calls, which the loader gives as
// R.worlds in that order.
export function emitCoreJs(ir: CoreIR): { js: string; names: string[]; worlds: string[] } {
  const names = ir.funcs.map((_, i) => `f${i}`);
  const rts = new Map<string, string>();
  const rtName = (n: string) => { if (!rts.has(n)) rts.set(n, `rt${rts.size}`); return rts.get(n)!; };
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
  const constant = (e: SExpr): boolean => ["num", "int", "text", "bool"].includes(e.k) || ((e.k === "new" || (e.k === "make" && !e.t.mutable)) && e.args.every(constant));
  // Deep recursion on the heap (C137c18, compile.ts's C21): a function in
  // a cycle of calls that aren't all its own tail calls (`x + sum(rest)`)
  // takes a JavaScript frame per call, and the stack holds some thousands.
  // Each gets a second copy, a generator whose calls in its cycle yield
  // what to call instead; past DEPTH plain calls deep, a call runs that
  // copy, and R.drive keeps the calls waiting in an array.
  const deep = deepFuncs(ir.funcs);
  const gens = names.map((n) => `${n}$h`);
  const text = ir.funcs.flatMap((f, i) => {
    if (!deep.has(i)) return [func(f, i, null)];
    const ps = f.params.map((_, j) => `l${j}`).join(", ");
    const plain = func(f, i, null).replace(`function ${names[i]}(`, `function ${names[i]}$b(`);
    return [`// ${f.name.replace(/\n/g, " ")} (past ${DEPTH} calls deep, its copy on the heap)\nfunction ${names[i]}(${ps}) {\n  if (depth > ${DEPTH}) return R.drive(${gens[i]}(${ps}));\n  depth++;\n  const r = ${names[i]}$b(${ps});\n  depth--;\n  return r;\n}`, plain, func(f, i, deep.get(i)!)];
  });
  const js = [
    "let fuel = Infinity;",
    // Plain calls of functions with a heap copy on JavaScript's stack now.
    "let depth = 0;",
    ...[...classes].map(([key, c]) => {
      const variant = key.slice(0, key.lastIndexOf("/")), n = Number(key.slice(key.lastIndexOf("/") + 1));
      const fs = Array.from({ length: n }, (_, j) => `x${j}`);
      return `class ${c} { constructor(${fs.join(", ")}) { this.tag = ${JSON.stringify(variant)};${fs.map((x, j) => ` this.f${j} = ${x};`).join("")} } get fields() { return [${fs.map((_, j) => `this.f${j}`).join(", ")}]; } }`;
    }),
    ...[...consts].map(([src, v]) => `const ${v} = ${src};`),
    // A backwards search spends the budget too (C137c12).
    "R.spending(() => --fuel >= 0);",
    ...[...rts].map(([n, v]) => { const b = builtinOf(n); return `const ${v} = R.rt(${JSON.stringify(n)}${b ? `, ${JSON.stringify(b)}` : ""});`; }),
    ...worlds.map((_, i) => `const w${i} = R.worlds[${i}];`),
    ...text,
    // A partial function given out says no answer by throwing, as the
    // evaluator's runtime expects.
    // A call from outside starts at the depth it found, whatever it threw.
    `return { ${names.map((n, i) => {
      const c = ir.funcs[i].partial ? `R.ck(${n}(...xs))` : `${n}(...xs)`;
      return deep.size ? `${n}: (...xs) => { const d = depth; try { return ${c}; } finally { depth = d; } }` : ir.funcs[i].partial ? `${n}: (...xs) => ${c}` : n;
    }).join(", ")} };`,
  ].join("\n");
  return { js, names, worlds };

  // `cycle`: writing the heap copy, whose calls of these yield.
  function func(f: SFunc, i: number, cycle: Set<number> | null): string {
    let temps = 0;
    const call = (fn: number, xs: string[]) => (cycle?.has(fn) ? `(yield [${gens[fn]}, [${xs.join(", ")}]])` : `${names[fn]}(${xs.join(", ")})`);
    // A catch that goes on puts the depth back as it was at its try.
    const keep = () => { if (!deep.size) return ["", ""]; const t = temp(); return [`const ${t} = depth; `, `depth = ${t}; `]; };
    const temp = () => `t${temps++}`;
    const local = (j: number) => `l${j}`;
    const self = (e: SExpr): boolean => (e.k === "call" && e.fn === i && e.tail) || kidsOf(e).some(self);
    const loops = self(f.body);
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
      const ok = temp(), label = temp(), [save, back] = keep();
      const body = within(`{ ${ok} = false; break ${label}; }`, () => block(e.body, { set: local(e.res), fails: true }, d + "  "));
      pre.push(`${d}${save}let ${ok} = true;`, `${d}${label}: try {`, ...body, `${d}  if (${local(e.res)} === R.FAIL) ${ok} = false;`, `${d}} catch (x) {`, `${d}  if (x !== R.FAIL${e.spent ? " && x !== R.OUT" : ""}) throw x;`, `${d}  ${back}${ok} = false;`, `${d}}`);
      return ok;
    }
    // A call's inputs where a statement begins: one that is a partial call
    // is checked as a slot when everything before it is a value already
    // (so computing it first changes no order).
    function inputs(args: SExpr[], out: string[], d: string): string[] {
      const atomic = (a: SExpr) => ["local", "num", "int", "text", "bool", "cap"].includes(a.k);
      return args.map((a, j) => (args.slice(0, j).every(atomic) ? slot(a, out, d) : ex(a, out, d)));
    }
    function slot(e: SExpr, out: string[], d: string): string {
      const partial = (e.k === "call" && ir.funcs[e.fn].partial) || (e.k === "apply" && e.t.partial);
      if (!onFail || !partial) return ex(e, out, d);
      let c: string;
      if (e.k === "call") c = call(e.fn, inputs(e.args, out, d));
      else { const fn = ex(e.fn, out, d), xs = inputs(e.args, out, d); out.push(`${d}${local(e.tmp)} = ${fn};`); c = `R.ap(${[local(e.tmp), ...xs].join(", ")})`; }
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
          const c = call(e.fn, xs);
          return ir.funcs[e.fn].partial ? `R.ck(${c})` : c;
        }
        case "make": { const v = made(e.t.variant, e.args.map((a) => ex(a, pre, d))); return constant(e) ? constName(v) : v; }
        case "get": return read(ex(e.rec, pre, d), e.i, pre, d);
        case "new": { const v = made(e.t.cases[e.c].variant, e.args.map((a) => ex(a, pre, d))); return constant(e) ? constName(v) : v; }
        // A written list (L181b): its items in order, made into conses from the last.
        case "list": {
          const [nil, cons] = listSteps(e), xs = e.items.map((a) => ex(a, pre, d));
          const fields = (cons as Extract<SExpr, { k: "new" }>).args.map((a) => ((a as { i: number }).i === e.acc ? "t" : "x")).join(", ");
          return `[${xs.join(", ")}].reduceRight((t, x) => ${made(e.t.cases[e.c].variant, fields.split(", "))}, ${ex(nil, pre, d)})`;
        }
        case "field": return read(ex(e.rec, pre, d), e.i, pre, d);
        case "tag": return `R.caseOf(${ex(e.rec, pre, d)}, ${JSON.stringify(e.t.cases.map((c) => c.variant))})`;
        // One of a type that waits takes the rest last (C40 step 4): called
        // from outside, it's given a rest that keeps the answer.
        // A closure that takes the rest (it waits, or gives several
        // answers) is given one when called from outside (core-rt.ts).
        case "closure": { const rest = e.t.waits || e.t.several; return `R.closure(${names[e.fn]}, [${e.caps.map((a) => ex(a, pre, d)).join(", ")}]${e.src || rest ? `, ${e.src ? JSON.stringify(e.src) : "undefined"}` : ""}${rest ? ", true" : ""})`; }
        case "cap": return `l0.caps[${e.i}]`;
        case "apply": {
          const c = ex(e.fn, pre, d), xs = e.args.map((a) => ex(a, pre, d));
          pre.push(`${d}${local(e.tmp)} = ${c};`);
          return e.t.partial ? `R.ck(R.ap(${[local(e.tmp), ...xs].join(", ")}))` : `${local(e.tmp)}(${xs.join(", ")})`;
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
          // The fuel is this module's own (C137c21).
          if (e.fn === "fuel.get") return "fuel";
          if (e.fn === "fuel.swap") { const t = temp(); pre.push(`${d}const ${t} = fuel;`, `${d}fuel = ${xs[0]};`); return t; }
          return `${rtName(e.fn)}(${xs.join(", ")})`;
        }
        case "world": { const xs = e.args.map((a) => ex(a, pre, d)); return `${worldName(e.op)}(${xs.join(", ")})`; }
        case "fail": return "R.fail()";
        case "attempt": {
          const ok = tried(e, pre, d), t = temp();
          pre.push(`${d}let ${t};`, `${d}if (${ok}) {`, ...block(e.ok, { set: t }, d + "  "), `${d}} else {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "budget": {
          const s = temp(), out = temp(), t = temp(), [save, back] = keep();
          pre.push(`${d}${save}const ${s} = fuel;`, `${d}fuel = ${e.n};`, `${d}let ${t}, ${out} = false;`, `${d}try {`, ...within(null, () => block(e.body, { set: t }, d + "  ")), `${d}} catch (x) {`, `${d}  if (x !== R.OUT) { fuel = ${s}; throw x; }`, `${d}  ${back}${out} = true;`, `${d}}`, `${d}fuel = ${s};`);
          pre.push(`${d}if (${out}) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "abort": return `R.abort(${ex(e.reason, pre, d)}, ${e.esc ?? 0})`;
        case "handle": {
          const t = temp(), [save, back] = keep();
          pre.push(`${d}${save}let ${t};`, `${d}try {`, ...within(null, () => block(e.body, { set: t }, d + "  ")), `${d}} catch (x) {`, `${d}  if (!(x instanceof R.Aborted) || x.esc !== ${e.esc ?? 0}) throw x;`, `${d}  ${back}${local(e.reason)} = x.reason;`, ...block(e.arm, { set: t }, d + "  "), `${d}}`);
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
      const give = (x: string) => [...out, to === "return" ? `${d}return ${x};` : `${d}${to.set} = ${x};`];
      if (failable && e.k === "fail") return give("R.FAIL");
      if (failable && e.k === "call" && ir.funcs[e.fn].partial && !(to === "return" && e.fn === i && e.tail)) return give(call(e.fn, inputs(e.args, out, d)));
      if (failable && e.k === "attempt") {
        const ok = tried(e, out, d);
        return [...out, `${d}if (${ok}) {`, ...block(e.ok, to, d + "  "), `${d}} else {`, ...block(e.otherwise, to, d + "  "), `${d}}`];
      }
      if (failable && e.k === "apply" && e.t.partial) {
        const c = ex(e.fn, out, d), xs = inputs(e.args, out, d);
        out.push(`${d}${local(e.tmp)} = ${c};`);
        return give(`R.ap(${[local(e.tmp), ...xs].join(", ")})`);
      }
      // A match hands `to` to its arms, so a self call in one is the
      // loop's next round, not a call as deep as the data (L181b).
      if (e.k === "case") {
        out.push(`${d}${local(e.s)} = ${slot(e.scrut, out, d)};`, `${d}switch (${local(e.s)}.tag) {`);
        e.arms.forEach((a, c) => { if (a) out.push(`${d}  case ${JSON.stringify(e.t.cases[c].variant)}: {`, ...block(a, to, d + "    "), ...(to === "return" ? [] : [`${d}    break;`]), `${d}  }`); });
        out.push(`${d}}`);
        return out;
      }
      if (e.k === "let") {
        out.push(`${d}${local(e.i)} = ${slot(e.value, out, d)};`);
        return [...out, ...block(e.body, to, d)];
      }
      if (e.k === "if") {
        const c = slot(e.cond, out, d);
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
    return [`// ${f.name.replace(/\n/g, " ")}${cycle ? ", its calls in its cycle yielded to R.drive" : ""}`, `function${cycle ? "*" : ""} ${cycle ? gens[i] : names[i]}(${params.join(", ")}) {`, ...(locals.length ? [`  let ${locals.join(", ")};`] : []), ...body, "}"].join("\n");
  }
}

// The program lowered for this printer (`host`), after the passes every
// printer takes: handlers the compiler can see put into the code they
// handle (handlers.ts, C64b), so a program's own effect answered in place
// (effects' Ask) needs no handler at run time (C137c17).
export function lowerCore(code: Code, info: Info, names: Record<Id, string>, roots: Id[]): CoreIR {
  const f = fusedProgram(code, info, names);
  return lowerScalar(f.code, f.info, f.names, roots, { data: true, host: true });
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
  const calls = funcs.map((f, me) => {
    const out = new Set<number>();
    let other = false;
    const walk = (e: SExpr, tail: boolean): void => {
      if (e.k === "call") { out.add(e.fn); if (e.fn === me && !(e.tail && tail)) other = true; }
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
    case "set": return [e.rec, e.value, e.then];
    default: return [];
  }
}

// The functions, by their place in ir.funcs. `rt`: the console and files.
// `hostOps`: the operations rt.hosts answers (hostOpsOf).
export function loadCoreJs(ir: CoreIR, rt: Runtime = { print: () => {} }, hostOps?: HostOps): ((...xs: unknown[]) => unknown)[] {
  const { js, names, worlds } = emitCoreJs(ir);
  const all = new Function("R", js)(coreRuntime(ir.tables.map(tableSpec), worlds, rt, ir.code, ir.info, hostOps)) as Record<string, (...xs: unknown[]) => unknown>;
  // A Float64 handed back to the host is a use of it (SPEC §3.3, C156):
  // too big, it stops there.
  const fin = (x: number) => { if (x - x !== 0) throw new Stopped(STOPS[STOPS.length - 1]); return x; };
  return names.map((n, i) => { const f = all[n]; return ir.funcs[i]?.result === "f64" && !ir.shader ? (...xs: unknown[]) => fin(f(...xs) as number) : f; });
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

export function runCoreMain(ir: CoreIR, name: string, args: string[], rt: Runtime): number {
  const [fi, m] = mainOf(ir, name);
  return runCoreFn(loadCoreJs(ir, rt)[fi], m, args, rt);
}

// The program as a module that runs main in Node (C137c5, `lab compile
// --core`): the printed functions, with the runtime imported from
// `runtime` (this file, which a bundler takes in) and Node's world.
// `hosts`: the program's hosts/js.js, imported, and its operations
// (hostOpsOf), which it answers where nothing in the program handles them.
export function coreModule(ir: CoreIR, name: string, runtime: string, world: string, hosts?: Hosts): string {
  const [fi, m] = mainOf(ir, name);
  const { js, names, worlds } = emitCoreJs(ir);
  const code = codeFor(ir, js);
  return [
    `import { coreRuntime, runCoreFn } from ${JSON.stringify(runtime)};`,
    ...solverFor(code, runtime),
    `import { nodeWorld } from ${JSON.stringify(world)};`,
    ...(hosts ? [`import $hostAnswers from ${JSON.stringify(hosts.file)};`] : []),
    `const rt = { print: (s) => console.log(s), world: nodeWorld()${hosts ? ", hosts: $hostAnswers" : ""} };`,
    `const R = coreRuntime(${JSON.stringify(ir.tables.map(tableSpec))}, ${JSON.stringify(worlds)}, rt, ${code}${hosts ? `, undefined, ${JSON.stringify(hosts.ops)}` : ""});`,
    "const defs = (function (R) {",
    js,
    "})(R);",
    `process.exitCode = runCoreFn(defs.${names[fi]}, ${JSON.stringify(m)}, process.argv.slice(2), rt);`,
  ].join("\n");
}

// The program's nodes, for a module whose solves the evaluator's solver
// runs (C137c11): only when it has one.
// As a string parsed once, which is smaller and quicker to load than
// the same object written out.
const solving = (js: string) => /R\.rt\("(solve|exists"|derive:)/.test(js);
// Whether the program runs the evaluator's solver (a solve, `for some`, a
// derivative): far slower than compile.ts's plans for now, so a sound
// isn't played this way (C137d7).
export const usesSolver = (ir: CoreIR): boolean => solving(emitCoreJs(ir).js);
const codeFor = (ir: CoreIR, js: string) => (solving(js) ? `JSON.parse(${JSON.stringify(JSON.stringify({ nodes: ir.code.nodes, defs: ir.code.defs }))})` : "undefined");

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
const solverFor = (code: string, beside: string) => {
  if (code === "undefined") return [];
  if (beside.startsWith("$")) return [`${beside}.useSolver(${beside}.solver);`];
  const at = (f: string) => JSON.stringify(beside.replace(/[^/]*$/, f));
  return [`import { useSolver } from ${at("core-rt.ts")};`, `import { solver } from ${at("core-solve.ts")};`, "useSolver(solver);"];
};

// What a script takes from its runtime: imported from the file a bundler
// takes in, or from a prebuilt runtime's global ($core, C137d6).
const using = (names: string, from: string) => (from.startsWith("$") ? `const { ${names} } = ${from};` : `import { ${names} } from ${JSON.stringify(from)};`);
const wrapped = (from: string, lines: string[]) => (from.startsWith("$") ? ["(() => {", ...lines, "})();"] : lines).join("\n");

// A page's script (C137c9, `lab build-web --core`): the printed functions,
// with core-page.ts (`page`, which a bundler takes in, or the global of
// a prebuilt core-page-runtime.ts) drawing main.
// `worklet`: a page with sound, its audio thread's script (coreSoundScript
// bundled), which the page plays (C137d4).
export function corePageScript(ir: CoreIR, name: string, page: string, title: string, worklet?: string, hosts?: Hosts): string {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  if (fi < 0 || ir.funcs[fi].params.length) throw new Error(`${name}: not compiled, or not a page's main`);
  const { js, names, worlds } = emitCoreJs(ir);
  const code = codeFor(ir, js);
  return wrapped(page, [
    using("startCorePage", page),
    ...solverFor(code, page),
    ...(hosts ? [`import $hostAnswers from ${JSON.stringify(hosts.file)};`] : []),
    `startCorePage(${JSON.stringify(ir.tables.map(tableSpec))}, ${JSON.stringify(worlds)}, (R) => {`,
    js,
    `}, ${JSON.stringify(names[fi])}, ${JSON.stringify(title)}, ${code}, ${worklet === undefined ? "undefined" : JSON.stringify(worklet)}${hosts ? `, { answers: $hostAnswers, ops: ${JSON.stringify(hosts.ops)} }` : ""});`,
  ]);
}

// The audio thread's script for a page with sound (C137d4): the printed
// functions, with core-sound.ts (`sound`, which a bundler takes in)
// running main again there and playing its block functions; `sound`
// may be a prebuilt runtime's global, as for a page.
export function coreSoundScript(ir: CoreIR, name: string, sound: string): string {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted);
  if (fi < 0 || ir.funcs[fi].params.length) throw new Error(`${name}: not compiled, or not a page's main`);
  const { js, names, worlds } = emitCoreJs(ir);
  const code = codeFor(ir, js);
  return wrapped(sound, [
    using("startCoreSound", sound),
    ...solverFor(code, sound),
    `startCoreSound(${JSON.stringify(ir.tables.map(tableSpec))}, ${JSON.stringify(worlds)}, (R) => {`,
    js,
    `}, ${JSON.stringify(names[fi])}, ${code});`,
  ]);
}
