// A compiler from the typed core (ters/src/lang) to JavaScript.
//
// The evaluator (run.ts) treats every expression as a lazy stream of
// results, because any of them might be a Choice. The compiler doesn't have
// to guess: the checker has already worked out, in each function's type,
// whether it can produce several results or none. So it generates two kinds
// of code:
//
//   - code without Choice is ordinary JavaScript: expressions, ternaries for
//     `if`, loops for `fold` (no JS stack per item), `&&` for `and`;
//   - code with Choice becomes nested `for … of` loops, one per choice point,
//     with the rest of the computation (the continuation) inside the
//     innermost loop. `one of` is a loop over a list, `fail` is the absence
//     of a continuation, and a handler is a loop that stops early (`first`),
//     counts (`count`) or collects (`all`). That is what you'd write by hand
//     for backtracking search, and the checker is what makes it safe.
//
// A function whose type has Choice is a generator function; anything else
// is a plain function. Effect-polymorphic definitions (`map`, whose effects
// are its argument's) get one copy per calling convention they're used at:
// there are only two, so at most two copies.
//
// `solve` nodes call the relation solver at compile time, not at run time:
// the direction is fixed where the node is, so the plan is too, and it is
// emitted as straight-line code (src/relation.ts). Plans that need numeric
// search fall back to the solver at run time, with the plan made once.

import { resolveArithmetic } from "../../ters/src/lang/arith.ts";
import { intLit } from "../../ters/src/lang/int.ts";
import { children, dependencies, subtree, type Code, type Id, type Node, type NodeOf } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { CHOICE, DIVERGE, INT, NUMBER, STRING, Subst, type Row, type Type } from "../../ters/src/lang/types.ts";
import { fieldShapes, shapeOf, type Shape } from "../../ters/src/lang/nested.ts";
import { ALGEBRAIC_V, BOOL, CELL_OPS, COMPARE, CONS, FALSE, INT_OPS, LIST, NIL, ORDER_V, RATIO, S, SET, SIGS, TEXT_OPS, TRUE, UNIT_V, NONE, SOME } from "../../ters/src/lang/std.ts";
import { fieldPath, placePath } from "../../ters/src/lang/records.ts";
import { planSolve } from "../../ters/src/lang/solve.ts";
import { oneAnswer as solvedOnce } from "../../ters/src/lang/modes.ts";
import { compileSolve } from "./relation.ts";
import { modeCompiler, type ModeEmit } from "./modes.ts";
import { INLINE, jsKind } from "./builtins.ts";
import { CORE, MODULES } from "../../ters/src/lang/library.ts";
import { pointsAt } from "../../ters/src/lang/modules.ts";
import { foldPlan } from "../../ters/src/lang/represent.ts";
import { composeLinear, linearMap, type LinearMap } from "../../ters/src/lang/linear.ts";
import { add as addCost, less, steps as costSteps } from "../../ters/src/lang/cost.ts";
import { inlineLists } from "./inline-lets.ts";
import { fuseHandlers } from "./handlers.ts";
import { expandDerivatives, recordVariant } from "../../ters/src/lang/derive.ts";
import { stageProgram } from "../../ters/src/lang/stage.ts";
import { expandInverses } from "./inverses.ts";
import { solvesAsCalls } from "./results.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";

type Rho = Map<number, boolean>;
const NO_LAT: Set<number> = new Set();
const NO_AT: Map<number, Type> = new Map();
type K = (value: string) => string;

export interface Options {
  // Where the generated module imports the runtime from.
  runtime: string;
  // Definitions to export, by display name.
  exports: string[];
  // "global": a plain script instead of a module. `runtime` is then an
  // expression for the runtime already loaded (a page's prebuilt one), and
  // the definitions are a `const defs` the script after it uses.
  link?: "import" | "global";
  // false: nothing runs this code under a page's step budget (run.ts
  // `withSteps`), as in a program `lab compile` writes. Then only calls
  // that can be under a `with fuel` spend steps.
  steps?: boolean;
}

// Builtins: what each compiles to is its record in builtins.ts. Those that
// run their implementation from std.ts call `$impl`; a Choice builtin is
// partial, with no answer or one (std.ts `choice`), so a call runs
// `$partial`, which gives the answer or $no (GAPS.md G24), and `$many` is
// its answers as an array, for a use as a value.
const implOf = (id: Id) => (jsKind(id) === "impl" ? `$impl[${JSON.stringify(id)}]` : null);
const manyOf = (id: Id) => (jsKind(id) === "partial" ? `$many[${JSON.stringify(id)}]` : null);
const oneOf = (id: Id) => (jsKind(id) === "partial" ? `$partial[${JSON.stringify(id)}]` : null);
// Where a `$fields` copy leaves its answer's fields.
const GOT = "const $got = [];";
const HANDLERS = new Set([S.first, S.all, S.count, S.optional, S.fuel]);

// An Int literal in its one spelling (int.ts): a number while it's small,
// a BigInt beyond.
const intJs = (v: number | string): string => { const x = intLit(v); return typeof x === "bigint" ? `${x}n` : x < 0 ? `(${x})` : String(x); };

// The definitions the exports reach, every type, and the builtins (all of
// them when an export isn't found).
function reachedFromExports(code: Code, names: Names, exports: string[]): Code {
  const roots = exports.map((x) => code.defs.findLast((d) => names[d] === x));
  if (roots.some((r) => !r)) return code;
  const reach = new Set<Id>();
  for (const r of roots as Id[]) { reach.add(r); for (const d of dependencies(code, r)) reach.add(d); }
  const isType = (d: Id) => { const n = code.nodes[d]; return n?.kind === "def" && !!n.body && code.nodes[n.body]?.kind === "typedef"; };
  const defs = code.defs.filter((d) => reach.has(d) || isType(d));
  if (defs.length === code.defs.length) return code;
  const nodes: Code["nodes"] = {};
  for (const [id, n] of Object.entries(code.nodes)) if (n.kind === "builtin") nodes[id] = n;
  for (const d of defs) for (const id of subtree(code, d)) nodes[id] = code.nodes[id];
  return { nodes, defs };
}

export function compile(code: Code, info: Info, names: Names, opts: Options): string {
  // The generic + resolved to each type's own operation first
  // (ters/src/lang/arith.ts): nothing here sees a generic one.
  ({ code, info, names } = resolveArithmetic(code, info, names));
  // derivative(f) and gradient(f) of a function written right there become
  // the code of its derivative (derive.ts), checked again, as in the scalar
  // profile (scalar.ts): plain arithmetic, no $derivative at run time, and
  // no node table when nothing else looks inside functions. A derivative
  // of a function known only at run time still asks the runtime.
  const x = expandDerivatives(code, names, (call) => {
    const f = info.subst.zonk(info.typeOf.get((code.nodes[call] as NodeOf<"call">).args[0]) ?? { t: "var", v: -1 });
    return f.t === "fn" && f.params[0]?.t === "con" ? recordVariant(code, f.params[0].id) : null;
  });
  if (x.expanded.length) {
    code = x.code;
    names = x.names;
    info = infer(code, names);
  }
  // inverse(f, …) of a named f is a solve on f (inverses.ts).
  const inv = expandInverses(code, names);
  if (inv.expanded.length) {
    code = inv.code;
    names = inv.names;
    info = infer(code, names);
  }
  // A solve of a definition with results, in its own direction, is a call
  // per result it binds (results.ts, C55): `_, y = polar(1, t)` is a sine.
  const sol = solvesAsCalls(code, names);
  if (sol.expanded.length) {
    const checked = infer(sol.code, sol.names);
    if (checked.errors.length <= info.errors.length) ({ code, names, info } = { ...sol, info: checked });
  }
  // Only what the exports reach is compiled, so it is all the passes below
  // look at and check again (C67): the library's other definitions were
  // over half of each check. Types stay, and the builtins. The checked
  // types still hold for what's left, so this needs no check of its own.
  code = reachedFromExports(code, names, opts.exports);
  // Calls given data written down (an algebra's signature and basis) are
  // worked out as far as that data goes (stage.ts, C65): what's left is
  // arithmetic, with no lists. Kept only if the program still checks.
  // Definitions given such data get a copy for it, whose calls are worked
  // out in turn (I86).
  ({ code, names, info } = stageProgram(code, info, names));
  // Handlers the compiler can see are put into the code they handle
  // (handlers.ts, C64b), a round at a time, each checked again; a round
  // that doesn't check is dropped.
  for (let round = 0; round < 8; round++) {
    const f = fuseHandlers(code, info, names);
    if (!f) break;
    const checked = infer(f.code, f.names);
    if (checked.errors.length) break;
    ({ code, names } = f);
    info = checked;
  }
  // A list named first and then walked is put where it's walked, so the
  // fold or fusion sees what made it (inline-lets.ts, C49).
  const lets = inlineLists(code, info);
  if (lets.inlined) {
    code = lets.code;
    info = infer(code, names);
  }
  // Is this node a text literal below the surrogates? (TEXT_OPS.less)
  const narrowText = (id: Id) => { const n = code.nodes[id]; return n.kind === "lit" && typeof n.value === "string" && n.of === undefined && /^[\u0000-\ud7ff]*$/.test(n.value); };
  const sub = info.subst;
  // Effects a program defines: an operation is a variant of an effect, and a
  // match on operations is a handler (runtime.js $perform, $handle).
  const effectOf = (variant: Id): Id | null => {
    const def = info.owner.get(variant);
    const body = def ? (code.nodes[def] as NodeOf<"def">).body : null;
    return body && (code.nodes[body] as NodeOf<"typedef">).effect ? def! : null;
  };
  const handlerOf = (n: NodeOf<"match">) => (n.arms.length ? effectOf((code.nodes[n.arms[0]] as NodeOf<"arm">).variant) : null);
  // An operation answered later (ANSWERED-LATER.md, C40): the code that
  // may perform one is a generator, and performing is a yield that the
  // handler's driver answers ($handleL). Its rest is the generator, resumed
  // once. A row says which code that is: a function whose row holds an
  // effect with such an operation is a generator function, and calls of it
  // are `yield*`. Prior art: generators as one-shot continuations, as
  // OCaml 5 checks them (ANSWERED-LATER.md, "Prior art").
  const isLater = (op: Id) => !!(code.nodes[op] as NodeOf<"variant">).later;
  const laterEffects = new Set(Object.keys(code.nodes).filter((id) => code.nodes[id].kind === "variant" && isLater(id)).map((id) => effectOf(id)!));
  // `lat`: row variables that stand for a row with such an effect in the
  // copy being written (`map` given a function that waits: its row is any).
  const laterRow = (row: Row, lat: Set<number> = NO_LAT) => {
    if (!laterEffects.size) return false;
    const r = sub.resolveRow(row);
    return r.effs.some((e) => laterEffects.has(e)) || (r.tail !== null && lat.has(r.tail));
  };
  const laterFn = (t: Type, lat: Set<number> = NO_LAT) => t.t === "fn" && laterRow(t.eff, lat);
  const notYet = (what: string) => new Error(`${what}: compiled JavaScript doesn't run that yet (BACKLOG C40); the evaluator does`);
  const perform = (op: Id, args: string[]) => (isLater(op) ? `(yield $later(${JSON.stringify(effectOf(op))}, ${tag(op)}, [${args.join(", ")}]))` : `$perform(${JSON.stringify(effectOf(op))}, ${tag(op)}, [${args.join(", ")}])`);
  const ty = (id: Id): Type => sub.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  // Which possibly-divergent definitions spend a step per call (GAPS.md G1,
  // fuel). Only those that can run under a `with fuel`, or under a page's
  // step budget when the code may run in a page. Under fuel means: called,
  // directly or through other definitions, from a `with fuel`'s arguments,
  // or used as a value anywhere, since a value can be called from anywhere.
  const underFuel = new Set<Id>();
  {
    const isDef = (t: Id) => code.nodes[t]?.kind === "def";
    const todo: Id[] = [];
    const reach = (id: Id) => { for (const x of subtree(code, id)) { const r = code.nodes[x]; if (r.kind === "ref" && isDef(r.target) && !underFuel.has(r.target)) { underFuel.add(r.target); todo.push(r.target); } } };
    const heads = new Set<Id>();
    for (const n of Object.values(code.nodes)) if (n.kind === "call") heads.add(n.fn);
    for (const n of Object.values(code.nodes)) {
      if (n.kind === "call" && code.nodes[n.fn].kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === S.fuel) n.args.forEach(reach);
      if (n.kind === "ref" && isDef(n.target) && !heads.has(n.id) && !underFuel.has(n.target)) { underFuel.add(n.target); todo.push(n.target); }
    }
    for (let d = todo.pop(); d !== undefined; d = todo.pop()) reach(d);
  }
  const spends = (def: Id) => info.divergent.has(def) && (opts.steps !== false || underFuel.has(def));
  // `equal`, one rule on every type (run.ts `sameNumber`). A Float64, an Int
  // or a text on its own is compared without the general loop: an Int is
  // always whole, so === is the rule for it.
  // A generic definition that the program uses at one type only compares
  // its values as that type (GAPS.md G17): `times in` on Text uses ===. The
  // type each use gives a type variable, followed through generic callers;
  // exported definitions can be called at any type, so they keep $eq. This is
  // the one-instance case of specializing by type, as MLton does for all.
  const monoVars = new Map<number, Type>();
  {
    const exportedDefs = new Set(opts.exports.map((x) => code.defs.findLast((d) => names[d] === x)));
    const uses = new Map<Id, Type[]>();
    for (const n of Object.values(code.nodes)) {
      if (n.kind !== "ref" || code.nodes[n.target]?.kind !== "def") continue;
      const t = info.typeOf.get(n.id);
      if (!uses.has(n.target)) uses.set(n.target, []);
      uses.get(n.target)!.push(t ? sub.zonk(t) : { t: "var", v: -1 });
    }
    const apply = (t: Type): Type =>
      t.t === "var" ? (monoVars.has(t.v) ? monoVars.get(t.v)! : t)
      : t.t === "con" ? { ...t, args: t.args.map(apply) }
      : { ...t, params: t.params.map(apply), ret: apply(t.ret) };
    const closed = (t: Type): boolean => (t.t === "var" ? false : t.t === "con" ? t.args.every(closed) : t.params.every(closed) && closed(t.ret));
    const bind = (pat: Type, t: Type, vars: Set<number>, out: Map<number, Type[]>): boolean => {
      if (pat.t === "var") {
        if (vars.has(pat.v) && !(t.t === "var" && t.v === pat.v)) out.set(pat.v, [...(out.get(pat.v) ?? []), t]);
        return true;
      }
      if (pat.t === "con") return t.t === "con" && t.id === pat.id && t.args.length === pat.args.length && pat.args.every((a, i) => bind(a, t.args[i], vars, out));
      return t.t === "fn" && t.params.length === pat.params.length && pat.params.every((a, i) => bind(a, t.params[i], vars, out)) && bind(pat.ret, t.ret, vars, out);
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const [def, ts] of uses) {
        const sc = info.schemes.get(def);
        if (!sc || !sc.vars.length || exportedDefs.has(def)) continue;
        const vars = new Set(sc.vars), out = new Map<number, Type[]>();
        if (!ts.every((t) => bind(sc.type, t, vars, out))) continue;
        for (const [v, at] of out) {
          if (monoVars.has(v)) continue;
          const keys = new Set(at.map((t) => JSON.stringify(apply(t))));
          const only = apply(at[0]);
          if (keys.size === 1 && closed(only)) { monoVars.set(v, only); changed = true; }
        }
      }
    }
  }
  const monoType = (t: Type): Type => (t.t === "var" && monoVars.has(t.v) ? monoVars.get(t.v)! : t);
  const equalJs = (arg: Id, [a, b]: string[]) => {
    const t = monoType(ty(arg));
    if (t.t === "con" && t.id === NUMBER) return `$sameNumber(${a}, ${b})`;
    if (t.t === "con" && (t.id === STRING || t.id === INT)) return `(${a} === ${b})`;
    return `$eq(${a}, ${b})`;
  };
  // `compare` at its type (GAPS.md M4), as -1, 0 or 1: a Float64, an Int
  // or a text with its own order, a case of a type that isn't recursive
  // field by field in a function made for that type (as G0 did for
  // `equal`). Anything else, and a type with a variable left in it, goes
  // to the evaluator's order (run.ts compareValues), as a number too.
  // `orderFns`: the functions made, by type.
  const orderFns = new Map<string, { name: string; js: string | null }>();
  const monoDeep = (t: Type): Type => (t.t === "var" ? (monoVars.has(t.v) ? monoDeep(monoVars.get(t.v)!) : t) : t.t === "con" ? { ...t, args: t.args.map(monoDeep) } : t);
  const closedType = (t: Type): boolean => (t.t === "con" ? t.args.every(closedType) : false);
  const orderOf = (t: Type): string | null => {
    t = monoDeep(sub.zonk(t));
    if (t.t !== "con" || !closedType(t)) return null;
    if (t.id === NUMBER) return "$numberOrder";
    if (t.id === INT) return "$intOrder";
    if (t.id === STRING) return "$textOrder";
    const td = code.nodes[(code.nodes[t.id] as { body?: Id })?.body ?? ""];
    if (td?.kind !== "typedef" || td.effect || td.interface || td.variants.some((v) => v === RATIO || v === ALGEBRAIC_V)) return null;
    const key = JSON.stringify(t);
    const made = orderFns.get(key);
    // One being made is a recursive type: the general order, which keeps
    // its own stack, so a long list can't overflow.
    if (made) return made.js === null ? (made.name = "") || null : made.name || null;
    const name = ident(`$order ${key}`, `$order_${names[t.id] ?? "type"}`);
    const entry = { name, js: null as string | null };
    orderFns.set(key, entry);
    const params = new Map(td.params.map((p, i) => [p, (t as { args: Type[] }).args[i]] as const));
    const fieldType = (id: Id): Type => {
      const n = code.nodes[id];
      if (n.kind === "tref") return params.get(n.target) ?? { t: "con", id: n.target, args: n.args.map(fieldType) };
      return { t: "var", v: -1 };
    };
    const cases: string[] = [];
    for (const v of td.variants) {
      const fs = (code.nodes[v] as NodeOf<"variant">).fields;
      const each: string[] = [];
      for (let i = 0; i < fs.length; i++) {
        const o = orderOf(fieldType((code.nodes[fs[i]] as NodeOf<"field">).type)) ?? `((x, y) => $compareN(x, y, $order))`;
        if (entry.name === "") break;
        each.push(`c = ${o}(a.fields[${i}], b.fields[${i}]);\nif (c) return c;`);
      }
      if (entry.name === "") return null;
      if (each.length) cases.push(td.variants.length > 1 ? `case ${tag(v)}: {\n${each.join("\n")}\nbreak;\n}` : each.join("\n"));
    }
    const tags = td.variants.length > 1 ? `if (a.tag !== b.tag) return $order.get(a.tag) < $order.get(b.tag) ? -1 : 1;\n` : "";
    const body = cases.length ? `let c;\n${td.variants.length > 1 ? `switch (a.tag) {\n${cases.join("\n")}\n}` : cases.join("\n")}\n` : "";
    entry.js = `function ${name}(a, b) {\n${tags}${body}return 0;\n}`;
    return name;
  };
  const orderJs = (arg: Id, [a, b]: string[]) => { const o = orderOf(withAt(curAt, ty(arg))); return o ? `${o}(${a}, ${b})` : `$compareN(${a}, ${b}, $order)`; };
  // The copy being written: its `at`, in both its scheme's variables and
  // its body's.
  let curAt: Map<number, Type> = NO_AT;
  const withAt = (at: Map<number, Type>, t: Type): Type => (!at.size ? t : t.t === "var" ? at.get(t.v) ?? t : t.t === "con" ? { ...t, args: t.args.map((x) => withAt(at, sub.zonk(x))) } : t.t === "fn" ? { ...t, params: t.params.map((x) => withAt(at, sub.zonk(x))), ret: withAt(at, sub.zonk(t.ret)) } : t);
  const typeName = (t: Type): string => (t.t === "con" ? [names[t.id] ?? "T", ...t.args.map(typeName)].join("_") : "a");
  // The type variables of a definition (its scheme's) whose values it
  // compares, itself or through another definition it calls with them:
  // the ones a copy per type is made for. A library definition's body has
  // variables of its own, read off its lambda paired with the scheme.
  const comparedMemo = new Map<Id, Set<number>>();
  const varsOf = (t: Type, out: Set<number>): Set<number> => {
    t = sub.zonk(t);
    if (t.t === "var") out.add(t.v);
    else if (t.t === "con") t.args.forEach((x) => varsOf(x, out));
    else if (t.t === "fn") { t.params.forEach((x) => varsOf(x, out)); varsOf(t.ret, out); }
    return out;
  };
  const compared = (def: Id): Set<number> => {
    if (comparedMemo.has(def)) return comparedMemo.get(def)!;
    const out = new Set<number>();
    comparedMemo.set(def, out);
    const sc = info.schemes.get(def);
    if (!sc || !sc.vars.length || code.nodes[def]?.kind !== "def" || !isFnDef(def)) return out;
    const toScheme = new Map<number, number>(sc.vars.map((v) => [v, v]));
    const pair = (a: Type, b: Type) => {
      b = sub.zonk(b);
      if (a.t === "var") { if (b.t === "var") toScheme.set(b.v, a.v); return; }
      if (a.t === "con" && b.t === "con") a.args.forEach((x, i) => b.args[i] && pair(x, b.args[i]));
      if (a.t === "fn" && b.t === "fn") { a.params.forEach((x, i) => b.params[i] && pair(x, b.params[i])); pair(a.ret, b.ret); }
    };
    pair(sc.type, ty(node<"def">(def).body!));
    const add = (vs: Set<number>) => { for (const v of vs) { const w = toScheme.get(v); if (w !== undefined && sc.vars.includes(w)) out.add(w); } };
    for (const x of subtree(code, def)) {
      const n = code.nodes[x];
      if (n.kind === "call" && refTarget(n.fn) === COMPARE && n.args[0]) add(varsOf(ty(n.args[0]), new Set()));
      if (n.kind !== "ref" || n.target === def || code.nodes[n.target]?.kind !== "def") continue;
      const g = compared(n.target);
      if (!g.size) continue;
      // The types the callee's compared variables stand for here.
      const bindVars = (a: Type, b: Type) => {
        b = sub.zonk(b);
        if (a.t === "var") { if (g.has(a.v)) add(varsOf(b, new Set())); return; }
        if (a.t === "con" && b.t === "con") a.args.forEach((y, i) => b.args[i] && bindVars(y, b.args[i]));
        if (a.t === "fn" && b.t === "fn") { a.params.forEach((y, i) => b.params[i] && bindVars(y, b.params[i])); bindVars(a.ret, b.ret); }
      };
      bindVars(info.schemes.get(n.target)!.type, ty(x));
    }
    return out;
  };
  // `at` read in the body's variables too (a library definition, checked
  // apart, has its own): its lambda's type paired with the scheme's.
  const typedAt = (def: Id, at: Map<number, Type>): Map<number, Type> => {
    if (!at.size) return at;
    const out = new Map(at);
    const pair = (a: Type, b: Type) => {
      b = sub.zonk(b);
      if (a.t === "var") { if (b.t === "var" && at.has(a.v)) out.set(b.v, at.get(a.v)!); return; }
      if (a.t === "con" && b.t === "con") a.args.forEach((x, i) => b.args[i] && pair(x, b.args[i]));
      if (a.t === "fn" && b.t === "fn") { a.params.forEach((x, i) => b.params[i] && pair(x, b.params[i])); pair(a.ret, b.ret); }
    };
    pair(info.schemes.get(def)!.type, ty(node<"def">(def).body!));
    return out;
  };
  // A copy's `at` as its key gives it (in its scheme's variables).
  const keyAt = (s: Spec): Map<number, Type> => new Map([...s.at].filter(([v]) => info.schemes.get(s.def)!.vars.includes(v)));
  const node = <K extends NodeOf<any>["kind"]>(id: Id) => code.nodes[id] as NodeOf<K>;

  // ---- identifiers: display names where there are some, made unique
  const used = new Set<string>();
  const idents = new Map<string, string>();
  const ident = (key: string, hint: string): string => {
    if (idents.has(key)) return idents.get(key)!;
    let base = hint.replace(/[^\p{ID_Continue}$]+/gu, "_").replace(/^_+|_+$/g, "") || "v";
    if (!/^[\p{ID_Start}$]/u.test(base)) base = "_" + base;
    let name = base;
    for (let i = 2; used.has(name) || RESERVED.has(name); i++) name = `${base}${i}`;
    used.add(name);
    idents.set(key, name);
    return name;
  };
  // Tags are variant ids; the name is only a comment.
  const tag = (variant: Id) => `${JSON.stringify(variant)}${names[variant] && names[variant] !== variant ? ` /* ${names[variant]} */` : ""}`;
  const local = (binder: Id) => ident(binder, names[binder] ?? "x");
  let temps = 0;
  const temp = (hint = "t") => `${hint}$${temps++}`;
  // A fold's field that holds the type in a container: its shape.
  const nestedShape = (a: NodeOf<"arm">, i: number): Shape | null => {
    const def = info.owner.get(a.variant)!;
    if (fieldShapes(code, def, a.variant)[i] !== "nested") return null;
    return shapeOf(code, def, node<"field">(node<"variant">(a.variant).fields[i]).type);
  };

  const referenced = new Set<Id>();
  for (const n of Object.values(code.nodes)) if (n.kind === "ref") referenced.add(n.target);

  // ---- reflection
  // Some things look inside a function at run time: a relation run
  // backwards by the relational interpreter (relate.ts), when a function is
  // passed to it, and `derivative`. In a program that does either, compiled
  // functions remember the node they came from and the values they closed
  // over, the same as the evaluator's (META), and the module carries its
  // own node table for the interpreter to read.
  const relational = (n: NodeOf<"solve">) => planSolve(code, n).mode === "relational";
  // A relational solve whose mode has one answer or none is its plan
  // written out as a function (modes.ts here, MODES.md step 5): a call it
  // runs forward is a call of a compiled function or a builtin, and the
  // program needs no interpreter for it. `real` false: only whether each
  // piece can be written, before any copy of a definition is asked for.
  const modes = modeCompiler(code, names);
  const modeEmit = (real: boolean): ModeEmit => ({
    value(id) {
      const n = code.nodes[id];
      if (n.kind === "lit") return n.of === INT ? intJs(n.value as number | string) : typeof n.value === "number" && n.value < 0 ? `(${n.value})` : JSON.stringify(n.value);
      if (n.kind !== "ref" || code.nodes[n.target]?.kind !== "variant" || effectOf(n.target) || node<"variant">(n.target).fields.length) return null;
      return n.target === TRUE ? "$T" : n.target === FALSE ? "$F" : n.target === NIL ? "$nil" : n.target === UNIT_V ? "$unit" : `({ tag: ${tag(n.target)}, fields: [] })`;
    },
    forward(c, args) {
      const f = code.nodes[c.fn];
      if (f.kind !== "ref") return null;
      const t = code.nodes[f.target], id = f.target;
      if (t.kind === "builtin") {
        if (INLINE[id] && !INLINE[id]?.boolArgs) { const js = INLINE[id].js(args, c.args.map(narrowText)); return { js: INLINE[id].bool ? `$bool(${js})` : js }; }
        if (id === S.equal) return { js: `$bool($eq(${args.join(", ")}))` };
        if (implOf(id)) return { js: `${implOf(id)}(${args.join(", ")})` };
        if (oneOf(id)) return { js: `${oneOf(id)}(${args.join(", ")})`, partial: true };
        return null;
      }
      if (t.kind === "variant") return effectOf(id) ? null : { js: id === CONS ? `$cons(${args.join(", ")})` : `({ tag: ${tag(id)}, fields: [${args.join(", ")}] })` };
      if (t.kind === "field") {
        const v = node<"typedef">(node<"def">(info.owner.get(id)!).body!).variants[0];
        return { js: `${args[0]}.fields[${node<"variant">(v).fields.indexOf(id)}]` };
      }
      const st = info.schemes.get(id)?.type;
      if (t.kind !== "def" || code.nodes[t.body!]?.kind !== "lambda" || st?.t !== "fn" || sub.resolveRow(st.eff).effs.includes(CHOICE)) return null;
      if (!real) return { js: "x" };
      const sp = spec(id, new Map());
      const call = `${sp.name}(${args.join(", ")})`;
      const v = sp.bool ? `$bool(${call})` : call;
      return { js: spends(id) ? `($spendOrThrow(), ${v})` : v };
    },
    tag,
  });
  const dryEmit = modeEmit(false);
  // Only nodes the definitions hold: an expanded derivative leaves its old
  // `derivative` reference behind in the table. And only definitions the
  // exports reach: the prelude's inverse is in every program.
  const exportsReach = new Set<Id>();
  const reachFrom = (d: Id | undefined) => {
    if (!d || exportsReach.has(d)) return;
    exportsReach.add(d);
    for (const id of subtree(code, d)) { const n = code.nodes[id]; if (n.kind === "ref" && code.nodes[n.target]?.kind === "def") reachFrom(n.target); }
  };
  for (const x of opts.exports) reachFrom(code.defs.findLast((d) => names[d] === x));
  const reflective = code.defs.filter((d) => exportsReach.has(d)).flatMap((d) => subtree(code, d)).map((id) => code.nodes[id]).some((n) => (n.kind === "solve" && relational(n) && !modes.compilable(n, dryEmit)) || (n.kind === "ref" && (n.target === S.derivative || n.target === S.gradient || n.target === S.exists)));
  // The expressions a solve node hands over: all of its given ports for the
  // interpreter, only the solver's known ones (not a predicate's out = true)
  // for a planned direction.
  const givenOf = (n: NodeOf<"solve">) => (relational(n) ? Object.values(n.given) : planSolve(code, n).known.map((k) => n.given[k]));
  // The binders a lambda closes over: used inside it, bound outside it.
  function captured(lambda: Id): Id[] {
    const inside = subtree(code, lambda);
    const own = new Set(inside.filter((id) => code.nodes[id].kind === "binder"));
    const out = new Set<Id>();
    for (const id of inside) {
      const n = code.nodes[id];
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "binder" && !own.has(n.target)) out.add(n.target);
    }
    return [...out];
  }

  // ---- effects under a specialization
  const choice = (row: Row, rho: Rho) => {
    const r = sub.resolveRow(row);
    return r.effs.includes(CHOICE) || (r.tail !== null && rho.get(r.tail) === true);
  };
  const streamsFn = (t: Type, rho: Rho) => t.t === "fn" && choice(t.eff, rho);

  // Where `ret` puts a value.
  // `into`: an `$into` copy's answer, pushed onto the array `d` (P4).
  // `done`: a let's name whose list is already in the array (letInto);
  // the other answers are written in its place, not by the into paths.
  interface Out { bool: boolean; leaf: (js: string) => string; into?: { d: string; shape: Into; done?: Id } }
  interface Reuse { s: string; cell: Id; root: Id; binds: Id[] }
  const RETURN: Out = { bool: false, leaf: (js) => `return ${js};` };
  const RETURN_BOOL: Out = { bool: true, leaf: (js) => `return ${js};` };

  // ---- specializations of definitions
  // `plain`: parameters whose type says Choice, but whose argument at the
  // calls this copy serves is a function written in place that never
  // chooses, so the copy calls them as plain functions (GAPS.md G4).
  // `bool`: the copy returns a JS boolean, not Bool data. Its callers test
  // it as it is, or make it data where they need a value (GAPS.md G3).
  // `single`: the copy has Choice but at most one answer, so it's a plain
  // function that returns the answer or $no, not a generator (GAPS.md G14).
  // `cps`: the copy takes the rest of the search as a last argument `k`,
  // calls it once per answer, and returns true when `k` said stop
  // (COMPILER.md, "Searches in continuation-passing style"; GAPS.md G11).
  // Adapted from Mercury's high-level C backend, which compiles
  // nondeterministic code this way (Henderson and Somogyi, CC 2002).
  // Only direct calls from compiled code use it; values stay generators.
  // `arr`: list parameters given as JS arrays, and which kind (GAPS.md
  // G21, `walkable`).
  // `own`: the `$own` copy, which may change its own parameters' cells
  // (GAPS.md G25).
  // `sus`: the definition's row holds an operation answered later, so its
  // one copy is a generator function (`isLater`).
  // `at`: the types the copy's type variables stand for, where it compares
  // values of them (`compared`), so `compare` there is at those types
  // (GAPS.md M4): the tree jobs get a copy per key type. Specializing by
  // type as MLton does for every definition, here only where it compares.
  interface Spec { lat: Set<number>; def: Id; rho: Rho; name: string; streams: boolean; plain: Set<Id>; bool: boolean; single: boolean; cps: boolean; arr: Map<Id, "front" | "back" | "view">; own: boolean; out: boolean; into: Into | null; sus: boolean; at: Map<number, Type> }
  // A copy that writes its list into an array it is handed (`$into`): the
  // list itself, or the list field `k` of a record with two fields, when it
  // returns the other one (GAPS.md P4).
  interface Into { rec: Id | null; k: number }
  const specs = new Map<string, Spec>();
  const queue: Spec[] = [];
  const isFnDef = (def: Id) => code.nodes[node<"def">(def).body!]?.kind === "lambda";
  const isBool = (t: Type) => { const z = sub.zonk(t); return z.t === "con" && z.id === BOOL; };
  // A use of a copy as a value: Bool data out, as everywhere else.
  // A `$k` copy whose answers are all one record (a type with one case,
  // such as `found(expr, value)`) passes the record's fields to `k` instead
  // of building it, and the caller's closure takes them apart for free
  // (GAPS.md G13). The record is built only where something keeps it.
  const unpackOf = (sp: Spec): Id | null => {
    const t = info.schemes.get(sp.def)!.type;
    const r = t.t === "fn" ? sub.zonk(t.ret) : null;
    const d = r?.t === "con" ? code.nodes[r.id] : null;
    const td = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
    if (td?.kind !== "typedef" || td.effect || td.variants.length !== 1) return null;
    const v = td.variants[0];
    return v !== CONS && node<"variant">(v).fields.length > 0 ? v : null;
  };
  // ---- lists written into arrays (GAPS.md P4)
  // Destination passing: a copy of a definition that builds its list front
  // to back is handed an array and pushes the items onto it, so a caller
  // that wants an array (the audio runtime, for a block) gets one with no
  // cells. Its tail calls hand the array on, a call of itself is a jump,
  // and a list it only has as a value is copied in ($pushList). A record
  // with two fields, one of them the list (the compressor's samples and
  // level), works the same way: the copy pushes the list and returns the
  // other field. Prior art: destination-passing style (Minamide, "A
  // functional representation of data structures with a hole", POPL 1998;
  // Shaikhha, Fitzgibbon, Peyton Jones and Vytiniotis, FHPC 2017), and
  // tail modulo cons (G22; Bour, Clément and Scherer, OCaml 4.14).
  const refTarget = (id: Id) => { const r = code.nodes[id]; return r.kind === "ref" ? r.target : null; };
  const isList = (t: Type) => { const z = sub.zonk(t); return z.t === "con" && z.id === LIST; };
  const isNumbers = (t: Type) => { const z = sub.zonk(t); return z.t === "con" && z.id === LIST && sub.zonk(z.args[0]).t === "con" && (sub.zonk(z.args[0]) as { id: Id }).id === NUMBER; };
  const isBlockFn = (t: Type) => t.t === "fn" && t.params.length === 1 && isNumbers(t.params[0]) && isNumbers(t.ret);
  // The expressions a definition's answer can be: through lets and matches.
  const tailsOf = (id: Id): Id[] => {
    const n = code.nodes[id];
    if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") return tailsOf(node<"lambda">(n.fn).body);
    if (n.kind === "match" && !handlerOf(n)) return [...n.arms.flatMap((a) => tailsOf(node<"arm">(a).body)), ...(n.otherwise ? tailsOf(n.otherwise) : [])];
    return [id];
  };
  const intoShapes = new Map<Id, Into | null>();
  function intoShape(def: Id): Into | null {
    if (intoShapes.has(def)) return intoShapes.get(def)!;
    let r: Into | null = null;
    if (!reflective && code.nodes[def]?.kind === "def" && isFnDef(def) && !info.divergent.has(def)) {
      const t = info.schemes.get(def)!.type;
      const ret = t.t === "fn" ? sub.zonk(t.ret) : null;
      const v = ret?.t === "con" && ret.id !== LIST ? unpackOf({ def } as Spec) : null;
      if (ret?.t === "con" && ret.id === LIST) r = { rec: null, k: 0 };
      else if (v && node<"variant">(v).fields.length === 2) {
        const ks = new Set<number>();
        for (const leaf of tailsOf(node<"lambda">(node<"def">(def).body!).body)) {
          const n = code.nodes[leaf];
          if (n.kind === "call" && refTarget(n.fn) === v) n.args.forEach((a, i) => { if (isList(ty(a))) ks.add(i); });
        }
        if (ks.size === 1) r = { rec: v, k: [...ks][0] };
      }
    }
    intoShapes.set(def, r);
    return r;
  }
  const sameInto = (a: Into | null, b: Into | null) => !!a && !!b && a.rec === b.rec && a.k === b.k;
  const mentionsAny = (id: Id, bs: Id[]) => subtree(code, id).some((x) => { const n = code.nodes[x]; return n.kind === "ref" && bs.includes(n.target); });
  // A match an `$into` copy writes without the record: on a call whose
  // copy can write into the array too, with one arm for the record.
  //  - "pass": the arm gives back the record with an item consed onto its
  //    list, and its other field as it was (the compressor's step). The
  //    item is pushed first, then the call writes the rest.
  //  - "field": the arm's answer is the record's list itself, the one use
  //    of it (the compressor, which keeps the level in a cell).
  function intoMatch(m: NodeOf<"match">, shape: Into): { kind: "pass" | "field"; call: NodeOf<"call">; arm: NodeOf<"arm">; to: Into; head?: Id } | null {
    const c = code.nodes[m.scrutinee], g = c.kind === "call" ? refTarget(c.fn) : null;
    if (handlerOf(m) || m.otherwise || m.arms.length !== 1 || !g || code.nodes[g]?.kind !== "def") return null;
    const to = intoShape(g), arm = node<"arm">(m.arms[0]);
    if (!to?.rec || arm.variant !== to.rec) return null;
    const call = c as NodeOf<"call">, b = code.nodes[arm.body];
    if (shape.rec !== null && sameInto(shape, to) && b.kind === "call" && refTarget(b.fn) === to.rec) {
      const l = code.nodes[b.args[to.k]], o = code.nodes[b.args[1 - to.k]];
      if (l.kind === "call" && refTarget(l.fn) === CONS && refTarget(l.args[1]) === arm.binds[to.k] && refTarget(b.args[1 - to.k]) === arm.binds[1 - to.k] && o.kind === "ref" && !mentionsAny(l.args[0], arm.binds))
        return { kind: "pass", call, arm, to, head: l.args[0] };
    }
    if (shape.rec === null) {
      const uses = subtree(code, arm.body).filter((x) => refTarget(x) === arm.binds[to.k]);
      if (uses.length === 1 && tailsOf(arm.body).includes(uses[0])) return { kind: "field", call, arm, to };
    }
    return null;
  }
  // Is an `$into` copy worth having: does some answer build the list, or
  // hand the array to a copy that does?
  const intoGains = new Map<Id, boolean>();
  function intoGain(def: Id): boolean {
    if (intoGains.has(def)) return intoGains.get(def)!;
    intoGains.set(def, false);
    const shape = intoShape(def);
    const r = !!shape && gainsIn(node<"lambda">(node<"def">(def).body!).body, shape, def);
    intoGains.set(def, r);
    return r;
  }
  // A let whose value writes the list and whose name is one of the
  // answers (the pedal's `out = as loud as(…)`, then the block itself when
  // the pedal is off): the value is written first, and another answer
  // takes its place.
  function letInto(n: Node, shape: Into): { p: Id; call: NodeOf<"call">; body: Id } | null {
    if (shape.rec !== null || n.kind !== "call" || code.nodes[n.fn].kind !== "lambda") return null;
    const f = node<"lambda">(n.fn), v = code.nodes[n.args[0]];
    if (f.params.length !== 1 || v?.kind !== "call") return null;
    const g = refTarget(v.fn);
    if (!g || code.nodes[g]?.kind !== "def" || !sameInto(intoShape(g), shape) || !intoGain(g)) return null;
    const uses = subtree(code, f.body).filter((x) => refTarget(x) === f.params[0]);
    return uses.length === 1 && tailsOf(f.body).includes(uses[0]) ? { p: f.params[0], call: v, body: f.body } : null;
  }
  function gainsIn(id: Id, shape: Into, def: Id | null): boolean {
    const n = code.nodes[id];
    if (letInto(n, shape)) return true;
    if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") return gainsIn(node<"lambda">(n.fn).body, shape, def);
    if (n.kind === "match" && !handlerOf(n)) {
      const m = intoMatch(n, shape);
      if (m) return m.kind === "pass" || intoGain(refTarget(m.call.fn)!);
      return n.arms.some((a) => gainsIn(node<"arm">(a).body, shape, def)) || (!!n.otherwise && gainsIn(n.otherwise, shape, def));
    }
    if (n.kind !== "call") return false;
    const f = refTarget(n.fn);
    if (shape.rec === null && f === CONS) return true;
    if (shape.rec !== null && f === shape.rec) return refTarget(n.args[shape.k]) !== NIL;
    return !!f && f !== def && code.nodes[f]?.kind === "def" && sameInto(intoShape(f), shape) && intoGain(f);
  }

  // What a JS expression is known to be: data just built, or a record whose
  // fields arrived as separate arguments.
  const pieces = new Map<string, { variant: Id; fields: string[] }>();
  const linearMaps = new Map<Id, LinearMap | null>();
  const asValue = (s: Spec) => (s.bool ? `((...a) => $bool(${s.name}(...a)))` : s.single ? `$stream0(${s.name})` : s.name);

  // Does every path through this definition give one answer or none,
  // whatever Choice functions it's given? Only calls whose callee is known
  // count: a definition with at most one answer, `fail`, a function value
  // whose type has no Choice. `one of`, handlers, `first`, solves and
  // Choice-typed parameters may give more. A definition that's still being
  // looked at (recursion) counts as one for itself, and as many for the
  // others in its cycle.
  const singles = new Map<Id, boolean>();
  const looking = new Set<Id>();
  const STREAMING = new Set<Id>([S.oneOf, S.fuel, S.first, S.seeded]);
  // Does `id` give one answer or none? `def`: the definition being looked
  // at, whose calls of itself count as one.
  function oneAnswer(id: Id, def: Id | null): boolean {
    const noChoice = (t: Type) => t.t === "fn" && !t.eff.effs.includes(CHOICE) && t.eff.tail === null;
    const one = (id: Id): boolean => {
      const n = code.nodes[id];
      switch (n.kind) {
        case "lit": case "ref": case "hole": case "lambda": return true;
        case "match": return !handlerOf(n) && one(n.scrutinee) && n.arms.every((a) => one(node<"arm">(a).body)) && (!n.otherwise || one(n.otherwise));
        case "fold": return one(n.scrutinee) && n.arms.every((a) => one(node<"arm">(a).body));
        case "solve": return givenOf(n).every(one) && (solver(n), onceSolvers.has(n.id)) && one(n.body);
        case "call": {
          if (!n.args.every(one)) return false;
          const f = code.nodes[n.fn];
          if (f.kind === "lambda") return one(f.body);
          if (f.kind !== "ref") return one(n.fn) && noChoice(ty(n.fn));
          const t = code.nodes[f.target];
          if (t.kind === "variant" || t.kind === "field") return true;
          if (t.kind === "builtin") return !STREAMING.has(f.target);
          if (t.kind === "def") {
            if (f.target === def) return true;
            const scheme = info.schemes.get(f.target)!.type;
            return noChoice(scheme) || (isFnDef(f.target) && singleDef(f.target));
          }
          return noChoice(ty(n.fn));
        }
        default: return false;
      }
    };
    return one(id);
  }
  function singleDef(def: Id): boolean {
    if (singles.has(def)) return singles.get(def)!;
    if (looking.has(def)) return false;
    looking.add(def);
    const r = isFnDef(def) && oneAnswer(node<"lambda">(node<"def">(def).body!).body, def);
    looking.delete(def);
    singles.set(def, r);
    return r;
  }

  // `out`: a single-answer copy whose answers are all one record, which
  // puts the record's fields in `$got` and returns whether it has one
  // (GAPS.md G13 again): its caller takes them apart straight away.
  function spec(def: Id, rho: Rho, plain: Set<Id> = new Set(), cps = false, arr: Map<Id, "front" | "back" | "view"> = new Map(), own = false, out = false, into: Into | null = null, lat: Set<number> = NO_LAT, at: Map<number, Type> = NO_AT): Spec {
    const scheme = info.schemes.get(def)!;
    const on = scheme.rows.filter((r) => rho.get(r)).sort((a, b) => a - b);
    lat = new Set(scheme.rows.filter((r) => lat.has(r)));
    // The body's types may name the same rows with variables of their own
    // (a library definition, checked apart): read them off its lambda.
    if (lat.size && isFnDef(def)) {
      const pair = (a: Type, b: Type) => {
        if (a.t === "con" && b.t === "con") a.args.forEach((x, i) => b.args[i] && pair(x, b.args[i]));
        if (a.t !== "fn" || b.t !== "fn") return;
        const x = sub.resolveRow(a.eff).tail, y = sub.resolveRow(b.eff).tail;
        if (x !== null && y !== null && lat.has(x)) lat.add(y);
        a.params.forEach((p, i) => b.params[i] && pair(p, b.params[i]));
        pair(a.ret, b.ret);
      };
      pair(scheme.type, ty(node<"def">(def).body!));
    }
    const key = `${def}|${on.join(",")}|${[...plain].sort().join(",")}${cps ? "|k" : ""}${arr.size ? `|a:${[...arr].map(([p, k]) => `${p}${k}`).sort().join(",")}` : ""}${own ? "|o" : ""}${out ? "|f" : ""}${into ? "|i" : ""}${lat.size ? `|l:${[...lat].sort((a, b) => a - b).join(",")}` : ""}${at.size ? `|t:${JSON.stringify(scheme.vars.filter((v) => at.has(v)).map((v) => at.get(v)))}` : ""}`;
    if (!specs.has(key)) {
      const base = names[def] ?? def;
      const streams = streamsFn(scheme.type, rho), t = scheme.type;
      const sus = !reflective && isFnDef(def) && laterFn(t, lat);
      // A search that waits (C40): its generator gives its answers and its
      // waits, told apart by $isLater; whatever walks it passes the waits on.
      if (sus && streams && (cps || out || into || own || arr.size)) throw notYet(`${base} has Choice and performs an operation answered later`);
      const bool = !sus && !reflective && !streams && isFnDef(def) && t.t === "fn" && isBool(t.ret);
      const single = !reflective && streams && !sus && isFnDef(def) && singleDef(def);
      const s: Spec = { def, rho, plain, name: ident(key, `${base}${on.length ? "$choice" : ""}${plain.size ? "$plain" : ""}${arr.size ? "$arr" : ""}${own ? "$own" : ""}${cps ? "$k" : ""}${out ? "$fields" : ""}${into ? "$into" : ""}${at.size ? `$${scheme.vars.flatMap((v) => (at.has(v) ? [typeName(at.get(v)!)] : [])).join("_")}` : ""}`), streams, bool, single, cps, arr, own, out, into, sus, lat, at: typedAt(def, at) };
      if (out && !constants.includes(GOT)) constants.push(GOT);
      specs.set(key, s);
      queue.push(s);
    }
    return specs.get(key)!;
  }

  // The specialization a use of `def` needs. Row variables that only appear
  // as the definition's own effect (not inside a parameter) are pure: a
  // definition that doesn't do Choice itself can't start doing it because
  // a caller does. The others follow the argument passed for them.
  function specAt(ref: Id, def: Id, rho: Rho, plain?: Set<Id>, arr?: Map<Id, "front" | "back" | "view">, own = false, lat: Set<number> = NO_LAT, callerAt: Map<number, Type> = NO_AT): Spec {
    const scheme = info.schemes.get(def)!;
    const inner = new Set<number>();
    const collect = (t: Type, top: boolean) => {
      if (t.t === "con") t.args.forEach((a) => collect(a, false));
      if (t.t !== "fn") return;
      if (!top && t.eff.tail !== null) inner.add(t.eff.tail);
      t.params.forEach((p) => collect(p, false));
      collect(t.ret, false);
    };
    collect(scheme.type, true);
    const out: Rho = new Map(), waits = new Set<number>();
    const walk = (s: Type, t: Type) => {
      if (s.t === "con" && t.t === "con") s.args.forEach((a, i) => walk(a, t.args[i]));
      if (s.t !== "fn" || t.t !== "fn") return;
      // Where the position already says Choice, the variable adds nothing,
      // so only positions without it tell us what the variable stands for.
      if (s.eff.tail !== null && inner.has(s.eff.tail) && !s.eff.effs.includes(CHOICE) && !out.get(s.eff.tail)) out.set(s.eff.tail, choice(t.eff, rho));
      // The same for an operation answered later: a copy that waits (C40).
      // Only what the variable stands for counts: the operations the
      // position names itself (`() ->{Animate | e}`, a handler's
      // computation) are handled inside, so they don't make it wait (I37).
      if (s.eff.tail !== null && inner.has(s.eff.tail)) {
        const named = new Set(sub.resolveRow(s.eff).effs), r = sub.resolveRow(t.eff);
        if (laterRow({ ...r, effs: r.effs.filter((e) => !named.has(e)) }, lat)) waits.add(s.eff.tail);
      }
      s.params.forEach((p, i) => walk(p, t.params[i]));
      walk(s.ret, t.ret);
    };
    walk(scheme.type, ty(ref));
    // The types its variables stand for here, where the copy compares them.
    const at = new Map<number, Type>();
    const cmp = compared(def);
    if (cmp.size) {
      const bindVars = (a: Type, b: Type) => {
        if (a.t === "var") { const t = monoDeep(withAt(callerAt, b)); if (cmp.has(a.v) && closedType(t)) at.set(a.v, t); return; }
        if (a.t === "con" && b.t === "con") a.args.forEach((x, i) => b.args[i] && bindVars(x, sub.zonk(b.args[i])));
        if (a.t === "fn" && b.t === "fn") { a.params.forEach((x, i) => b.params[i] && bindVars(x, sub.zonk(b.params[i]))); bindVars(a.ret, sub.zonk(b.ret)); }
      };
      bindVars(scheme.type, ty(ref));
    }
    return spec(def, out, plain, false, arr, own, false, null, waits, at);
  }

  // The parameters of a function definition that are only ever called,
  // never passed on or stored, so a copy may call them plainly.
  const onlyCalled = new Map<Id, Set<Id>>();
  function calledParams(def: Id): Set<Id> {
    if (!onlyCalled.has(def)) {
      const lam = node<"lambda">(node<"def">(def).body!);
      const ok = new Set(lam.params);
      const callee = new Set<Id>();
      for (const id of subtree(code, lam.body)) {
        const n = code.nodes[id];
        if (n.kind === "call") callee.add(n.fn);
      }
      for (const id of subtree(code, lam.body)) {
        const n = code.nodes[id];
        if (n.kind === "ref" && ok.has(n.target) && !callee.has(id)) ok.delete(n.target);
      }
      onlyCalled.set(def, ok);
    }
    return onlyCalled.get(def)!;
  }

  // ---- lists that stay arrays (GAPS.md G21; NUMBERS.md, the `array` row)
  // `split` and `characters` make JS arrays. A binder that is only ever
  // walked whole (a fold over it, `join all`, `one of`, or handed on to a
  // parameter or let that is itself only walked) can hold that array, and
  // the cons cells are never made. For definitions this means a copy per
  // set of such parameters (`$arr`), which calls whose argument is an array
  // use. A use the compiler can't walk as an array gets the list back from
  // it ($toList), so the choice only ever costs time, never meaning.
  // Prior art: cdr-coding (Hansen, "Compact list representation", CACM
  // 1969), decided here at compile time by the uses rather than per cell.
  // A list that is also consed onto, and the result only walked or consed
  // onto again (an accumulator such as chapters' `taken`), is kept from the
  // other end: `{ a, n }`, the list a[n − 1], …, a[0]. Consing pushes onto
  // a when nothing has pushed past n yet, and copies otherwise, so every
  // older list still reads what it read ($snoc). `growable` holds those
  // binders, and `walkable` the ones that are never consed onto.
  const walkable = new Set<Id>(), growable = new Set<Id>();
  if (!reflective) {
    const parent = new Map<Id, Id>(), refs = new Map<Id, Id[]>();
    for (const n of Object.values(code.nodes)) {
      for (const c of children(n)) parent.set(c, n.id);
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "binder") refs.set(n.target, [...(refs.get(n.target) ?? []), n.id]);
    }
    const binders: Id[] = [];
    for (const def of code.defs) if (code.nodes[def]?.kind === "def" && isFnDef(def) && !info.divergent.has(def)) binders.push(...node<"lambda">(node<"def">(def).body!).params);
    for (const n of Object.values(code.nodes)) if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") binders.push(...node<"lambda">(n.fn).params);
    const walk = (r: Id, set: Set<Id>, grow: boolean): boolean => {
      const p = code.nodes[parent.get(r)!];
      if (p?.kind === "fold") return p.scrutinee === r && arrayFold(p);
      if (p?.kind !== "call" || p.fn === r) return false;
      const i = p.args.indexOf(r), f = code.nodes[p.fn];
      if (f.kind === "lambda") return set.has(f.params[i]);
      if (f.kind !== "ref") return false;
      if (f.target === CONS) return grow && i === 1 && walk(p.id, set, grow);
      if (f.target === TEXT_OPS.joinAll || f.target === S.oneOf) return i === 0;
      return code.nodes[f.target]?.kind === "def" && isFnDef(f.target) && set.has(node<"lambda">(node<"def">(f.target).body!).params[i]);
    };
    for (const [set, grow] of [[walkable, false], [growable, true]] as const) {
      binders.forEach((b) => set.add(b));
      for (let changed = true; changed; ) {
        changed = false;
        for (const b of set) if (!(refs.get(b) ?? []).every((r) => walk(r, set, grow))) { set.delete(b); changed = true; }
      }
    }
  }
  // Lists only ever taken apart by matches, whose rests are too, or passed
  // to such a parameter (GAPS.md G23): where one is an array from `split`,
  // it can be the array and the index where it starts. ledger's `entries`
  // walks its lines this way, handing the rest to itself.
  const viewable = new Set<Id>();
  if (!reflective) {
    const parent = new Map<Id, Id>(), refs = new Map<Id, Id[]>(), rests: Id[] = [];
    for (const n of Object.values(code.nodes)) {
      for (const c of children(n)) parent.set(c, n.id);
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "binder") refs.set(n.target, [...(refs.get(n.target) ?? []), n.id]);
    }
    const listMatch = (n: Node): n is NodeOf<"match"> => n.kind === "match" && !handlerOf(n) && n.arms.length > 0 && n.arms.every((a) => [NIL, CONS].includes(node<"arm">(a).variant));
    for (const n of Object.values(code.nodes)) if (listMatch(n)) for (const a of n.arms) { const arm = node<"arm">(a); if (arm.variant === CONS) rests.push(arm.binds[1]); }
    const params = (def: Id) => node<"lambda">(node<"def">(def).body!).params;
    for (const def of code.defs) if (code.nodes[def]?.kind === "def" && isFnDef(def)) params(def).forEach((b) => viewable.add(b));
    rests.forEach((b) => viewable.add(b));
    const ok = (r: Id): boolean => {
      const p = code.nodes[parent.get(r)!];
      if (p && listMatch(p) && p.scrutinee === r) {
        const cons = p.arms.map((a) => node<"arm">(a)).find((a) => a.variant === CONS);
        return !cons || viewable.has(cons.binds[1]);
      }
      if (p?.kind !== "call" || p.fn === r) return false;
      const f = code.nodes[p.fn];
      return f.kind === "ref" && code.nodes[f.target]?.kind === "def" && isFnDef(f.target) && viewable.has(params(f.target)[p.args.indexOf(r)]);
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const b of viewable) if (!(refs.get(b) ?? []).every(ok)) { viewable.delete(b); changed = true; }
    }
  }
  // ---- cells nobody else holds, changed in place (GAPS.md G25)
  // A list is owned where the code at hand holds the only reference to every
  // cell of its spine: a fold's accumulator (the step before made it and
  // passed it on), a fresh cons onto an owned list, nil, or what an owned
  // copy of a definition returns. A definition whose list parameter is
  // matched and used at most once on any path gets an `$own` copy, used
  // where every such argument is owned. In it, an arm of that match whose
  // path doesn't use the parameter again builds its cons in the matched
  // cell instead of a new one, and the cell's rest is owned in turn.
  // `add to` and `insert` in ledger change their totals in place this way.
  // Only in definitions without Choice (no answer runs the rest twice) and
  // outside lambdas and handlers (which may run more than once). Prior art:
  // Koka's Perceus and "functional but in place" (Reinking, Xie, de Moura
  // and Leijen, PLDI 2021; Lorenzen, Leijen and Swierstra, ICFP 2023),
  // which find the same reuse with reference counts at run time.
  const up = new Map<Id, Id>();
  for (const n of Object.values(code.nodes)) for (const c of children(n)) up.set(c, n.id);
  const INF = 1e9;
  const isLet = (id: Id) => { const p = code.nodes[up.get(id)!]; return p?.kind === "call" && p.fn === id; };
  const handlerMatch = (n: Node) => n.kind === "match" && !!handlerOf(n);
  const mentions = (id: Id, b: Id) => subtree(code, id).some((x) => { const n = code.nodes[x]; return n.kind === "ref" && n.target === b; });
  // The most times `b` is used on one run of `id`: a match's arms are
  // alternatives, and being matched on isn't a use. A use inside a lambda,
  // a handler or a fold's arm (run many times) counts as many.
  function usesOf(id: Id, b: Id): number {
    const n = code.nodes[id];
    if (n.kind === "ref") return n.target === b ? 1 : 0;
    if ((n.kind === "lambda" && !isLet(id)) || handlerMatch(n)) return mentions(id, b) ? INF : 0;
    if (n.kind === "match") {
      const s = code.nodes[n.scrutinee], first = s.kind === "ref" && s.target === b ? 0 : usesOf(n.scrutinee, b);
      return first + Math.max(0, ...[...n.arms.map((a) => node<"arm">(a).body), ...(n.otherwise ? [n.otherwise] : [])].map((x) => usesOf(x, b)));
    }
    if (n.kind === "fold") return usesOf(n.scrutinee, b) + (n.arms.some((a) => mentions(a, b)) ? INF : 0);
    return children(n).reduce((t, c) => t + usesOf(c, b), 0);
  }
  // Definitions that may change cells: without Choice, without fuel.
  const inPlace = (def: Id) => {
    if (reflective || !isFnDef(def) || info.divergent.has(def)) return false;
    const t = info.schemes.get(def)?.type;
    if (t?.t !== "fn" || t.eff.effs.includes(CHOICE)) return false;
    // A row variable that is only the definition's own effect is pure (as
    // in specAt); one shared with a function parameter may be Choice.
    const rows = new Set<number>();
    const collect = (x: Type) => {
      if (x.t === "con") x.args.forEach(collect);
      if (x.t !== "fn") return;
      if (x.eff.tail !== null) rows.add(x.eff.tail);
      if (x.eff.effs.includes(CHOICE)) rows.add(-1);
      x.params.forEach(collect);
      collect(x.ret);
    };
    t.params.forEach(collect);
    collect(t.ret);
    return !rows.has(-1) && (t.eff.tail === null || !rows.has(t.eff.tail));
  };
  // The nodes of such a definition that run once per call: not inside a
  // lambda (other than a let's) or a handler. Fold arms are, once per item,
  // and their binders are new each time.
  const once = new Map<Id, Id>();
  for (const def of code.defs) {
    if (code.nodes[def]?.kind !== "def" || !inPlace(def)) continue;
    const walk = (id: Id) => {
      const n = code.nodes[id];
      once.set(id, def);
      if (handlerMatch(n)) return;
      for (const c of children(n)) if (!(code.nodes[c].kind === "lambda" && !isLet(c))) walk(c);
    };
    walk(node<"lambda">(node<"def">(def).body!).body);
  }
  // A list parameter that is matched with a cons arm and used at most once.
  const ownParamsMemo = new Map<Id, Id[]>();
  function ownParams(def: Id): Id[] {
    if (!ownParamsMemo.has(def)) {
      const lam = node<"lambda">(node<"def">(def).body!);
      ownParamsMemo.set(def, !inPlace(def) ? [] : lam.params.filter((p) => !walkable.has(p) && !growable.has(p) && usesOf(lam.body, p) <= 1 &&
        subtree(code, lam.body).some((x) => {
          const n = code.nodes[x];
          return n.kind === "match" && once.has(x) && !handlerMatch(n) && code.nodes[n.scrutinee].kind === "ref" && node<"ref">(n.scrutinee).target === p && n.arms.some((a) => node<"arm">(a).variant === CONS);
        })));
    }
    return ownParamsMemo.get(def)!;
  }
  // Is `b` not used on the run that reaches `at`, between `root` and it?
  // The other arms of a match on the way are other runs.
  function clearOf(at: Id, b: Id, root: Id): boolean {
    for (let x = at; x !== root; ) {
      const p = up.get(x)!, n = code.nodes[p];
      for (const c of children(n)) {
        if (c === x || (n.kind === "match" && c !== n.scrutinee)) continue;
        if (n.kind === "match" && c === n.scrutinee && code.nodes[c].kind === "ref") continue;
        if (mentions(c, b)) return false;
      }
      x = p;
    }
    return true;
  }
  // The arm, and the match, that bound `b` as the rest of a cons cell.
  function restOf(b: Id): { arm: NodeOf<"arm">; m: NodeOf<"match">; cell: Id } | null {
    const a = code.nodes[up.get(b)!];
    if (a?.kind !== "arm" || a.variant !== CONS || a.binds[1] !== b) return null;
    const m = code.nodes[up.get(a.id)!];
    if (m?.kind !== "match" || handlerMatch(m) || code.nodes[m.scrutinee].kind !== "ref") return null;
    return { arm: a, m, cell: node<"ref">(m.scrutinee).target };
  }
  // `own`: compiling the `$own` copy, whose own parameters are owned.
  // `assume`: folds and definitions being checked, taken as owned
  // (recursion).
  function owned(id: Id, own: boolean, assume = new Set<Id>()): boolean {
    const n = code.nodes[id];
    if (!once.has(id)) return false;
    if (n.kind === "ref") {
      if (n.target === NIL) return true;
      return ownedAt(n.target, id, own, assume);
    }
    if (n.kind === "call") {
      const f = code.nodes[n.fn];
      if (f.kind === "lambda") return owned(f.body, own, assume);
      if (f.kind !== "ref") return false;
      if (f.target === CONS) return !isConst(id) && owned(n.args[1], own, assume);
      if (code.nodes[f.target]?.kind !== "def" || !inPlace(f.target)) return false;
      return (!ownParams(f.target).length || ownCall(n, own, assume)) && returnsOwned(f.target, assume);
    }
    if (n.kind === "match") return !handlerMatch(n) && [...n.arms.map((a) => node<"arm">(a).body), ...(n.otherwise ? [n.otherwise] : [])].every((x) => owned(x, own, assume));
    if (n.kind === "fold") {
      if (assume.has(id)) return true;
      const more = new Set(assume).add(id);
      return n.arms.every((a) => owned(node<"arm">(a).body, own, more));
    }
    return false;
  }
  // Is binder `b` owned where `ref` uses it?
  function ownedAt(b: Id, ref: Id, own: boolean, assume: Set<Id>): boolean {
    if (walkable.has(b) || growable.has(b)) return false;
    const p = code.nodes[up.get(b)!];
    if (p?.kind === "lambda") {
      if (isLet(p.id)) {
        const call = node<"call">(up.get(p.id)!);
        return usesOf(p.body, b) <= 1 && owned(call.args[p.params.indexOf(b)], own, assume);
      }
      const def = code.nodes[up.get(p.id)!];
      return own && def?.kind === "def" && ownParams(def.id).includes(b);
    }
    if (p?.kind === "arm") {
      if (p.results.includes(b)) {
        const fold = up.get(p.id)!;
        return usesOf(p.body, b) <= 1 && owned(fold, own, assume);
      }
      const r = restOf(b);
      return !!r && usesOf(r.arm.body, b) <= 1 && clearOf(ref, r.cell, r.arm.body) && ownedAt(r.cell, r.m.scrutinee, own, assume);
    }
    return false;
  }
  // Does this call take the `$own` copy: every own parameter given an
  // owned list?
  function ownCall(n: NodeOf<"call">, own: boolean, assume = new Set<Id>()): boolean {
    const def = node<"ref">(n.fn).target;
    if (!inPlace(def) || !once.has(n.id)) return false;
    const params = node<"lambda">(node<"def">(def).body!).params, mine = ownParams(def);
    return mine.length > 0 && mine.every((p) => owned(n.args[params.indexOf(p)], own, assume));
  }
  // Does the `$own` copy of `def` return an owned list?
  const returnsMemo = new Map<Id, boolean>();
  function returnsOwned(def: Id, assume: Set<Id>): boolean {
    if (returnsMemo.has(def)) return returnsMemo.get(def)!;
    if (assume.has(def)) return true;
    const r = inPlace(def) && owned(node<"lambda">(node<"def">(def).body!).body, true, new Set(assume).add(def));
    if (!assume.size) returnsMemo.set(def, r);
    return r;
  }

  // Does the program run anything under `with fuel`?
  const fueled = Object.values(code.nodes).some((n) => n.kind === "ref" && n.target === S.fuel);

  // ---- Bool parameters as JS booleans (GAPS.md G3): a definition that is
  // only ever called by name, and not exported, takes its Bool parameters
  // as `true`/`false`. A use as data boxes it ($T/$F); tests read it as is.
  const boolParams = new Set<Id>();
  if (!reflective) {
    const exported = new Set(opts.exports.map((x) => code.defs.findLast((d) => names[d] === x)));
    const asValue = new Set<Id>();
    for (const n of Object.values(code.nodes)) {
      if (n.kind !== "ref" || code.nodes[n.target]?.kind !== "def") continue;
      const p = code.nodes[up.get(n.id)!];
      if (!(p?.kind === "call" && p.fn === n.id)) asValue.add(n.target);
    }
    for (const def of code.defs) {
      if (code.nodes[def]?.kind !== "def" || !isFnDef(def) || exported.has(def) || asValue.has(def)) continue;
      for (const p of node<"lambda">(node<"def">(def).body!).params) if (isBool(ty(p))) boolParams.add(p);
    }
  }

  // Which arrays a binder can hold.
  type Kind = "front" | "back";
  const fits = (b: Id, kind: Kind) => (kind === "front" ? walkable : growable).has(b);
  // A fold over a list that only reads each item and the folded rest, not
  // the rest itself, which an array can run without cells.
  function arrayFold(n: NodeOf<"fold">): boolean {
    const arms = n.arms.map((a) => node<"arm">(a)), cons = arms.find((a) => a.variant === CONS);
    return arms.length === 2 && !!cons && arms.some((a) => a.variant === NIL) && !referenced.has(cons.binds[1]);
  }

  // ---- constant data, built once at module level (GAPS.md G9): a variant
  // whose fields are all literals or constant data, so `one of([plus,
  // minus, times, over])` doesn't build its list each time. Data is never
  // changed in place, so one copy can be shared.
  const constants: string[] = [];
  const constNames = new Map<string, string>();
  function isConst(id: Id): boolean {
    const n = code.nodes[id];
    if (n.kind === "lit") return true;
    const variant = (r: Id) => { const t = code.nodes[r]; return t?.kind === "ref" && code.nodes[t.target]?.kind === "variant" && !effectOf(t.target); };
    if (n.kind === "ref") return variant(id) && node<"variant">(n.target).fields.length === 0;
    return n.kind === "call" && variant(n.fn) && n.args.length === node<"variant">(node<"ref">(n.fn).target).fields.length && n.args.every(isConst);
  }
  function hoist(js: string): string {
    if (!constNames.has(js)) {
      const name = `$k${constNames.size}`;
      constNames.set(js, name);
      constants.push(`const ${name} = ${js};`);
      if (pieces.has(js)) pieces.set(name, pieces.get(js)!);
    }
    return constNames.get(js)!;
  }

  // ---- solve nodes: one function each, shared by every specialization
  const solvers = new Map<Id, string>();
  // Solves with at most one answer: they also have `name$one`, which gives
  // the binds (one bind as itself) or $no (GAPS.md P2).
  const onceSolvers = new Set<Id>();
  // Of those, the ones whose one bind is a list a written-out mode pushes
  // onto an array: `name$into(d, given…)` (modes.ts).
  const intoSolvers = new Set<Id>();
  const solverCode: string[] = [];
  function solver(n: NodeOf<"solve">): string {
    if (!solvers.has(n.id)) {
      const name = `solve$${solvers.size}`;
      solvers.set(n.id, name);
      const label = (port: string) => names[`${n.fn}#${port}`] ?? names[port] ?? port;
      const bound = Object.values(n.binds);
      if (relational(n) && modes.solver(n, name, modeEmit(true), bound.length === 1 && isList(ty(bound[0])))) {
        solverCode.push(...modes.code.splice(0));
        onceSolvers.add(n.id);
        if (modes.intoSolvers.has(name)) intoSolvers.add(n.id);
        return name;
      }
      if (relational(n)) {
        // A mode with several answers, or a goal that waits: the relational
        // interpreter runs it.
        const given = Object.keys(n.given), ps = given.map((_, i) => `g${i}`);
        solverCode.push(`// ${names[n.fn] ?? n.fn}, run backwards by the relational interpreter: given ${given.map(label).join(", ")}, ` +
          `solve for ${Object.keys(n.binds).map(label).join(", ")}\nfunction ${name}(${ps.join(", ")}) {\n` +
          `return $relate($program, ${JSON.stringify(n.fn)}, { ${given.map((g, i) => `${JSON.stringify(g)}: ${ps[i]}`).join(", ")} }, ${JSON.stringify(Object.keys(n.binds))});\n}`);
        return name;
      }
      const c = compileSolve(name, planSolve(code, n).rel!, planSolve(code, n).known, Object.keys(n.binds), names[n.fn] ?? n.fn, label);
      solverCode.push(c.code);
      if (c.once) onceSolvers.add(n.id);
    }
    return solvers.get(n.id)!;
  }

  // ---- one specialization's body
  // ---- deep recursion on the heap (C21)
  // JavaScript's stack holds some thousands of calls, and a call in a
  // cycle of definitions that isn't a tail call (`h + count(t)`, a parser's
  // expression inside parentheses) takes one each. Such a definition gets
  // a second copy, a generator whose calls in the cycle yield what to call
  // instead; past DEPTH calls of copies like it the call runs that copy,
  // and $drive's loop keeps the calls in an array (runtime.js). Shallow
  // calls pay a counter. Prior art: Kotlin's DeepRecursiveFunction, and
  // trampolined style (Ganz, Friedman and Wand, 1999).
  const reaches = new Map<Id, Set<Id>>();
  const refsIn = (def: Id): Id[] => {
    const b = node<"def">(def).body;
    return b ? [...new Set(subtree(code, b).map((id) => code.nodes[id]).filter((n): n is NodeOf<"ref"> => n.kind === "ref" && code.nodes[n.target]?.kind === "def").map((n) => n.target))] : [];
  };
  function reachable(def: Id): Set<Id> {
    if (!reaches.has(def)) {
      const seen = new Set<Id>(), todo = refsIn(def);
      for (let d; (d = todo.pop()) !== undefined;) if (!seen.has(d)) { seen.add(d); todo.push(...refsIn(d)); }
      reaches.set(def, seen);
    }
    return reaches.get(def)!;
  }
  // Is `callee` in `def`'s cycle (calls that can come back to `def`)?
  const cycles = (callee: Id, def: Id) => reachable(callee).has(def) && (callee === def || reachable(def).has(callee));
  // The copies that have a heap copy, and those a heap copy calls.
  const heapCopies = new Set<string>(), heapCalled = new Set<string>();

  function body(sp: Spec): string {
    curAt = sp.at;
    // The copies this one's heap copy calls with a yield.
    const yields = new Set<string>();
    const rho = sp.rho;
    const memo = new Map<Id, boolean>();
    const d = node<"def">(sp.def);
    // Lambdas here that are typed Choice but never choose, and are passed
    // where the callee's copy calls them plainly.
    const plainHere = new Set<Id>();
    // Is the code being written now somewhere a closure can stand for the
    // rest of the search? Then direct calls of searches use their `$k` copy.
    // True in a `$k` body and in a handler written in place; false inside
    // any function the compiler makes that yields, or returns a value, or
    // breaks out to a label (a closure would cut those off).
    let cps = false;
    // Function parameters of definitions fused into this one (G16), which
    // are given functions that don't choose.
    const fusePlain = new Set<Id>();
    // Writing the copy that keeps its stack on the heap (C21, `heapCopy`)?
    // Then calls of the definitions in this one's cycle yield, outside any
    // function the compiler makes inside it.
    let heap = false;
    // Writing a generator's statements, where an operation answered later
    // may be performed (`isLater`): code made inside is a generator too.
    let gen = false;
    const inGen = <T>(on: boolean, f: () => T): T => { const was = gen; gen = on; try { return f(); } finally { gen = was; } };
    const scoped = <T>(on: boolean, f: () => T): T => { const was = cps, wasHeap = heap, wasGen = gen; cps = on && !reflective; heap = false; gen = false; try { return f(); } finally { cps = was; heap = wasHeap; gen = wasGen; } };
    // A call of a copy: in the heap copy, one in this definition's cycle is
    // a yield the driver answers ($drive).
    // The heap copy, if its calls in the cycle can all yield: one inside a
    // function the compiler makes (an arrow) would be a syntax error, so
    // then there is none.
    const heapCopy = (sp: Spec, write: () => string): string | null => {
      // One not kept leaves the temporaries' numbers as they were.
      const was = temps;
      heap = true;
      let js: string;
      try { js = write(); } finally { heap = false; }
      if (!yields.size) { temps = was; return null; }
      try { new Function(`"use strict";\n${js}`); } catch { temps = was; return null; }
      heapCopies.add(sp.name);
      yields.forEach((n) => heapCalled.add(n));
      return js;
    };
    const callOf = (s: Spec, args: string[]): string => {
      if (s.sus) return `(yield* ${s.name}(${args.join(", ")}))`;
      if (!heap || s.streams || s.cps || s.single || s.out || s.into || !cycles(s.def, sp.def)) return `${s.name}(${args.join(", ")})`;
      yields.add(s.name);
      return `(yield [${s.name}$h, [${args.join(", ")}]])`;
    };

    // The copy of a definition a call needs: by the effects of its
    // arguments' types, and which of its Choice-typed function parameters
    // get a lambda written in place that doesn't choose.
    function defCall(n: NodeOf<"call">): Spec {
      const f = node<"ref">(n.fn);
      const plain = new Set<Id>(), arr = new Map<Id, Kind | "view">();
      if (!reflective && isFnDef(f.target)) {
        const params = node<"lambda">(node<"def">(f.target).body!).params;
        const called = calledParams(f.target);
        n.args.forEach((a, i) => {
          const arg = code.nodes[a];
          if (arg.kind === "lambda" && called.has(params[i]) && streamsFn(ty(a), rho) && !streamy(arg.body)) {
            plain.add(params[i]);
            plainHere.add(a);
          }
          const kind = arrayKind(a, true);
          if (kind && fits(params[i], kind)) arr.set(params[i], kind);
          else if (viewable.has(params[i]) && viewArg(a)) arr.set(params[i], "view");
        });
      }
      return specAt(f.id, f.target, rho, plain, arr, !sp.streams && ![...arr.values()].includes("view") && ownCall(n, sp.own), sp.lat, sp.at);
    }
    // A call's arguments, each an array where the copy takes one.
    function argsOf(n: NodeOf<"call">, s: Spec): string[] {
      const params = node<"lambda">(node<"def">(s.def).body!).params;
      return n.args.map((a, i) => (s.arr.has(params[i]) ? arrArg(a, s.arr.get(params[i])!) : boolParams.has(params[i]) ? exBool(a) : ex(a)));
    }
    // An argument a copy takes as an array: the array, or for a view the
    // array and the index (two arguments).
    function arrArg(a: Id, kind: Kind | "view"): string {
      if (kind !== "view") return arraySource(a, true)!.js;
      const v = viewArg(a)!;
      return `${v.a}, ${v.i}`;
    }
    // The array and index a list argument is: a view binder, `split` and
    // `characters`, whose arrays are made here, or a call of a definition
    // with an `$into` copy, which writes its list into a new one (P4: the
    // compressor's samples, walked by the loudness match).
    function viewArg(id: Id): { a: string; i: string } | null {
      const n = code.nodes[id];
      if (n.kind === "ref") return views.get(n.target) ?? null;
      if (n.kind !== "call" || code.nodes[n.fn].kind !== "ref" || streamy(id)) return null;
      const f = node<"ref">(n.fn).target;
      if (f === TEXT_OPS.split || f === TEXT_OPS.characters) return { a: arraySource(id)!.js, i: "0" };
      if (f === S.first) { const a = firstArray(n); return a ? { a, i: "0" } : null; }
      const t = code.nodes[f]?.kind === "def" ? intoCallee(n, { rec: null, k: 0 }) : null;
      return t ? { a: `$intoArray(${[t.name, ...argsOf(n, t)].join(", ")})`, i: "0" } : null;
    }
    // `first` whose answer is a solve's one bind, a list its mode can push
    // onto an array (the pedal's join run backwards, in `conjugate`): the
    // search runs as it does as a value, with the solve writing into an
    // array of its own, and the other way's list copied into one.
    let arrayAt: { solve: Id; d: string } | null = null;
    function firstArray(n: NodeOf<"call">): string | null {
      const body = thunk(n.args[0]), g = thunk(n.args[1]);
      if (reflective || !body || !g) return null;
      const tails = tailsOf(body.body), sv = code.nodes[tails[0]];
      if (tails.length !== 1 || sv.kind !== "solve") return null;
      const bound = Object.values(sv.binds);
      if (bound.length !== 1 || refTarget(sv.body) !== bound[0] || !relational(sv) || (solver(sv), !intoSolvers.has(sv.id))) return null;
      const d = temp("a"), got = temp("got"), was = arrayAt;
      arrayAt = { solve: sv.id, d };
      const search = scoped(true, () => st(body.body, (v) => `${got} = ${v};\nreturn true;`));
      arrayAt = was;
      const other = viewArg(g.body);
      const rest = other && other.i === "0" ? other.a : `$listArrays.from(${ex(g.body)})`;
      return `(() => {\nconst ${d} = [];\nlet ${got} = $no;\n(() => {\n${search}\n})();\nif (${got} !== $no) return ${got};\nreturn ${rest};\n})()`;
    }
    // A copy's parameters as JS names: a view is two.
    const paramNames = (s: Spec) => node<"lambda">(node<"def">(s.def).body!).params.flatMap((p) => (s.arr.get(p) === "view" ? [local(p), `${local(p)}$i`] : [local(p)]));
    // A call's arguments in the same order, for a loop's inputs.
    function loopArgs(n: NodeOf<"call">, s: Spec): string[] {
      const params = node<"lambda">(node<"def">(s.def).body!).params;
      return argsOf(n, s).flatMap((a, i) => { if (s.arr.get(params[i]) !== "view") return [a]; const v = viewArg(n.args[i])!; return [v.a, v.i]; });
    }

    // Binders holding an array here: the copy's array parameters, and lets
    // given one.
    const arrNow = new Map<Id, Kind>([...sp.arr].filter((e): e is [Id, Kind] => e[1] !== "view"));
    // Rest binders of a list taken apart where it is an array: the array
    // and the index where the rest starts (`viewOf`).
    const views = new Map<Id, { a: string; i: string }>();
    for (const [p, k] of sp.arr) if (k === "view") views.set(p, { a: local(p), i: `${local(p)}$i` });
    // The rests of a view parameter taken apart are views too, named now, so
    // a call that hands one back is known to be this copy before its match
    // is written (holes, loops).
    if (views.size) {
      for (const x of subtree(code, node<"def">(sp.def).body!)) {
        const m = code.nodes[x];
        if (m.kind !== "match" || handlerOf(m) || streamy(x) || code.nodes[m.scrutinee].kind !== "ref" || !m.arms.every((a) => [NIL, CONS].includes(node<"arm">(a).variant))) continue;
        const from = views.get(node<"ref">(m.scrutinee).target), cons = m.arms.map((a) => node<"arm">(a)).find((a) => a.variant === CONS);
        if (from && cons && viewable.has(cons.binds[1]) && referenced.has(cons.binds[1])) views.set(cons.binds[1], { a: from.a, i: temp("j") });
      }
    }
    // A match on a list, with no handler: nil and cons arms (or otherwise).
    const listMatch = (n: NodeOf<"match">) => !handlerOf(n) && n.arms.length > 0 && n.arms.every((a) => { const v = node<"arm">(a).variant; return v === NIL || v === CONS; });
    // Is every use of a cons arm's rest the scrutinee of another such
    // match? Then the rest can stay an index into the array.
    const onlyMatched = (arm: NodeOf<"arm">) => {
      const rest = arm.binds[1];
      if (viewable.has(rest)) return true;
      const scrutinees = new Set<Id>();
      for (const x of subtree(code, arm.body)) { const m = code.nodes[x]; if (m.kind === "match" && listMatch(m)) scrutinees.add(m.scrutinee); }
      return subtree(code, arm.body).every((x) => { const r = code.nodes[x]; return !(r.kind === "ref" && r.target === rest) || scrutinees.has(x); });
    };
    // The array and index a matched list is, if it is one: a binder that
    // holds a part of an array, or `split` and `characters`, whose arrays
    // are made here. Only when the cons arm's rest is itself only matched.
    // `m`: the match it is matched by (a node can sit under more than one
    // parent where staging shared it, so it's passed, not looked up).
    function viewOf(id: Id, m: NodeOf<"match">): { pre: string; a: string; i: string } | null {
      const cons = m.arms.map((a) => node<"arm">(a)).find((a) => a.variant === CONS);
      if (cons && !onlyMatched(cons)) return null;
      const n = code.nodes[id];
      if (n.kind === "ref" && views.has(n.target)) return { pre: "", ...views.get(n.target)! };
      if (reflective || n.kind !== "call" || code.nodes[n.fn].kind !== "ref" || streamy(id)) return null;
      const f = node<"ref">(n.fn).target;
      if (f !== TEXT_OPS.split && f !== TEXT_OPS.characters) return null;
      const a = temp("a");
      return { pre: `const ${a} = ${arraySource(id)!.js};\n`, a, i: "0" };
    }
    // Fold results that arrive as their fields, in separate locals (G13
    // again, `foldArms`).
    const splitAt = new Map<Id, { variant: Id; fields: string[] }>();
    // The array an expression is, without making cells, if it is one: a JS
    // array in list order (front), or `{ a, n }` from the other end (back).
    // `held`: the value goes to a binder, where an empty list is worth
    // starting from the other end, in case it grows.
    function arrayKind(id: Id, held = false): Kind | null {
      const n = code.nodes[id];
      if (n.kind === "ref") return n.target === NIL ? (held ? "back" : null) : arrNow.get(n.target) ?? null;
      if (n.kind !== "call" || code.nodes[n.fn].kind !== "ref" || streamy(id)) return null;
      const f = node<"ref">(n.fn).target;
      if (f === TEXT_OPS.split || f === TEXT_OPS.characters) return "front";
      return f === CONS && code.nodes[n.args[1]].kind === "ref" && arrayKind(n.args[1], held) === "back" ? "back" : null;
    }
    function arraySource(id: Id, held = false): { js: string; kind: Kind } | null {
      if (!arrayKind(id, held)) return null;
      const n = code.nodes[id];
      if (n.kind === "ref") {
        if (n.target === NIL) return { js: "{ a: [], n: 0 }", kind: "back" };
        const kind = arrNow.get(n.target);
        return kind ? { js: local(n.target), kind } : null;
      }
      if (n.kind !== "call" || code.nodes[n.fn].kind !== "ref" || streamy(id)) return null;
      const f = node<"ref">(n.fn).target;
      if (f === TEXT_OPS.split || f === TEXT_OPS.characters) return { js: `$text.${f === TEXT_OPS.split ? "split" : "characters"}(${n.args.map(ex).join(", ")})`, kind: "front" };
      // Onto a list kept from the other end. Only onto a name or nil, so the
      // item is still worked out before the rest, as in $cons.
      const rest = f === CONS && code.nodes[n.args[1]].kind === "ref" ? arraySource(n.args[1], held) : null;
      if (rest?.kind === "back") return { js: `$snoc(${rest.js}, ${ex(n.args[0])})`, kind: "back" };
      return null;
    }
    // `let p = v`, holding the array when v is one that p can hold.
    function letArg(p: Id, a: Id): string {
      const arr = arraySource(a, true);
      if (!arr || !fits(p, arr.kind)) return ex(a);
      arrNow.set(p, arr.kind);
      return arr.js;
    }
    // A loop over an array's items, in list order, from the end of the list,
    // or in either order.
    function eachOf(arr: { js: string; kind: Kind }, x: string, body: string, order: "list" | "end" | "any"): string {
      if (arr.kind === "front" && order !== "end") return `for (const ${x} of ${arr.js}) {\n${body}\n}`;
      const v = temp("v"), i = temp("i");
      const up = (arr.kind === "back") === (order !== "list");
      const [a, len] = arr.kind === "front" ? [v, `${v}.length`] : [`${v}.a`, `${v}.n`];
      const loop = up ? `for (let ${i} = 0; ${i} < ${len}; ${i}++)` : `for (let ${i} = ${len} - 1; ${i} >= 0; ${i}--)`;
      return `{\nconst ${v} = ${arr.js};\n${loop} {\nconst ${x} = ${a}[${i}];\n${body}\n}\n}`;
    }
    // An array as a JS array in list order.
    const inOrder = (arr: { js: string; kind: Kind }) => (arr.kind === "front" ? arr.js : `$fromBack(${arr.js})`);

    // Does evaluating this expression give anything other than exactly
    // one result? (A lambda doesn't: it's a value; calling it might.)
    function streamy(id: Id): boolean {
      if (memo.has(id)) return memo.get(id)!;
      const n = code.nodes[id];
      let r = false;
      switch (n.kind) {
        case "call": {
          const f = code.nodes[n.fn];
          if (f.kind === "lambda") r = n.args.some(streamy) || streamy(f.body);
          else r = streamy(n.fn) || n.args.some(streamy) || callStreams(n);
          break;
        }
        case "match": r = streamy(n.scrutinee) || n.arms.some((a) => streamy(node<"arm">(a).body)) || (!!n.otherwise && streamy(n.otherwise)); break;
        case "fold": r = streamy(n.scrutinee) || n.arms.some((a) => streamy(node<"arm">(a).body)); break;
        case "solve": r = !solvedOnce(code, n) || Object.values(n.given).some(streamy) || streamy(n.body); break;
      }
      memo.set(id, r);
      return r;
    }

    // Does this call's callee produce a stream (is it a generator)?
    function callStreams(n: NodeOf<"call">): boolean {
      const f = code.nodes[n.fn];
      if (f.kind === "ref") {
        const t = code.nodes[f.target];
        if (t.kind === "def") return defCall(n).streams;
        if (sp.plain.has(f.target) || fusePlain.has(f.target)) return false;
        if (t.kind === "variant" || t.kind === "field") return false;
        if (t.kind === "builtin") {
          if (f.target === S.oneOf || f.target === S.fail || f.target === S.fuel || manyOf(f.target)) return true;
          if (f.target === S.first) return streamsFn(ty(n.args[1]), rho);
          if (f.target === S.seeded) return streamsFn(ty(n.args[1]), rho);
          return false;
        }
      }
      return streamsFn(ty(n.fn), rho);
    }

    // ---- expressions with exactly one result: a JS expression
    function ex(id: Id): string {
      if (streamy(id)) throw new Error(`internal: ${id} in ${names[sp.def]} has Choice but is compiled as a plain expression`);
      const n = code.nodes[id];
      switch (n.kind) {
        case "lit":
          if (n.of === INT) return intJs(n.value as number | string);
          return typeof n.value === "number" && n.value < 0 ? `(${n.value})` : JSON.stringify(n.value);
        case "ref": return refValue(n);
        case "hole": return `$hole(${JSON.stringify(id)})`;
        case "lambda": return lambda(n);
        case "call": return call(n);
        case "match": return match(n);
        case "fold": return foldEx(n);
        case "solve": {
          const binds = Object.values(n.binds).map(local);
          return `((${binds.join(", ")}) => ${ex(n.body)})(...$one(${solver(n)}(${givenOf(n).map(ex).join(", ")})))`;
        }
        default: throw new Error(`can't compile a ${n.kind}`);
      }
    }

    // A boolean expression as a JS boolean, without building Bool data.
    function exBool(id: Id): string {
      const n = code.nodes[id];
      if (n.kind === "ref" && (n.target === TRUE || n.target === FALSE)) return String(n.target === TRUE);
      if (n.kind === "ref" && boolParams.has(n.target)) return local(n.target);
      if (n.kind === "call" && code.nodes[n.fn].kind === "ref" && boolFns.has(node<"ref">(n.fn).target)) return `${local(node<"ref">(n.fn).target)}(${n.args.map(ex).join(", ")})`;
      if (n.kind === "call" && code.nodes[n.fn].kind === "ref") {
        const target = node<"ref">(n.fn).target;
        if (INLINE[target]?.bool) return INLINE[target].js(n.args.map(INLINE[target]?.boolArgs ? exBool : ex), n.args.map(narrowText));
        if (target === S.equal) return equality(n);
        if (code.nodes[target]?.kind === "def" && !streamy(id)) {
          const s = defCall(n);
          if (s.bool) {
            const c = callOf(s, argsOf(n, s));
            return spends(target) ? `($spendOrThrow(), ${c})` : c;
          }
        }
      }
      // A let that only names other locals (a handler's case written in,
      // C64c): its names are the locals', and its body is the expression.
      if (n.kind === "call" && code.nodes[n.fn].kind === "lambda" && !streamy(id) && aliases(n)) return exBool(node<"lambda">(n.fn).body);
      // An if on a condition, as JS's ?: with no function made for it.
      if (n.kind === "match" && !handlerOf(n) && !streamy(id) && isBoolMatch(n)) {
        const [t, f] = boolArms(n);
        return `(${exBool(n.scrutinee)} ? ${exBool(t)} : ${exBool(f)})`;
      }
      if (n.kind === "match" && !handlerOf(n) && !streamy(id)) return `(() => {\n${ret(id, false, RETURN_BOOL)}\n})()`;
      return `(${ex(id)}.tag === ${JSON.stringify(TRUE)})`;
    }
    // Can this let's inputs be the locals they're given? Each is a ref to a
    // local binder written as its name, and the input has no name yet.
    function aliases(n: NodeOf<"call">): boolean {
      const f = node<"lambda">(n.fn);
      const ok = f.params.every((p, i) => {
        const a = code.nodes[n.args[i]];
        return !idents.has(p) && !boolParams.has(p) && a?.kind === "ref" && code.nodes[a.target]?.kind === "binder" && refValue(a) === local(a.target);
      });
      if (ok) f.params.forEach((p, i) => idents.set(p, local((code.nodes[n.args[i]] as NodeOf<"ref">).target)));
      return ok;
    }
    function equality(n: NodeOf<"call">): string {
      // A name against a value built in place (`t = word("let")`): a tag
      // test and its fields, with nothing built (GAPS.md G2).
      for (const [a, b] of [[0, 1], [1, 0]]) {
        const x = code.nodes[n.args[a]];
        if (x.kind !== "ref" || code.nodes[x.target]?.kind !== "binder" || !shaped(n.args[b])) continue;
        const v = ex(n.args[a]);
        if (/^[\p{L}\p{N}_$]+$/u.test(v)) return sameShape(v, n.args[b]);
      }
      return equalJs(n.args[0], n.args.map(ex));
    }
    // A variant (not a list's, Bool's or an effect's) with fields that are
    // literals, names, or such values again.
    function builtAt(id: Id): { variant: Id; args: Id[] } | null {
      const n = code.nodes[id];
      const v = n.kind === "ref" ? n.target : n.kind === "call" && code.nodes[n.fn].kind === "ref" ? node<"ref">(n.fn).target : null;
      if (!v || code.nodes[v]?.kind !== "variant" || [CONS, NIL, TRUE, FALSE, UNIT_V].includes(v) || effectOf(v)) return null;
      const args = n.kind === "call" ? n.args : [];
      return args.length === node<"variant">(v).fields.length ? { variant: v, args } : null;
    }
    function shaped(id: Id): boolean {
      const b = builtAt(id);
      return !!b && b.args.every((f) => { const x = code.nodes[f]; return x.kind === "lit" || (x.kind === "ref" && code.nodes[x.target]?.kind === "binder") || shaped(f); });
    }
    function sameShape(v: string, id: Id): string {
      const { variant, args } = builtAt(id)!;
      return `(${[`${v}.tag === ${tag(variant)}`, ...args.map((f, i) => (builtAt(f) ? sameShape(`${v}.fields[${i}]`, f) : equalJs(f, [`${v}.fields[${i}]`, ex(f)])))].join(" && ")})`;
    }

    function refValue(n: NodeOf<"ref">): string {
      const t = code.nodes[n.target];
      const wrap = (f: string, isGen: boolean) => (streamsFn(ty(n.id), rho) && !isGen ? `$lift(${f})` : f);
      switch (t.kind) {
        case "binder": {
          const kind = arrNow.get(n.target), split = splitAt.get(n.target), view = views.get(n.target);
          if (split) return construct(split.variant, split.fields);
          if (view) return `$toList(${view.a}.slice(${view.i}))`;
          if (boolParams.has(n.target)) return `(${local(n.target)} ? $T : $F)`;
          return kind ? `$toList(${kind === "front" ? local(n.target) : `$fromBack(${local(n.target)})`})` : local(n.target);
        }
        case "def": {
          const s = specAt(n.id, n.target, rho, undefined, undefined, false, sp.lat, sp.at);
          if (!isFnDef(n.target)) return `${s.name}()`;
          // A function without Choice, where a Choice function goes (a list
          // holding both kinds): lifted to a stream of one result.
          return wrap(asValue(s), s.streams);
        }
        case "variant":
          if (effectOf(n.target) && isLater(n.target)) return `(function* (...a) {\nreturn ${perform(n.target, ["...a"])};\n})`;
          if (effectOf(n.target)) return wrap(`((...a) => ${perform(n.target, ["...a"])})`, false);
          if (n.target === TRUE) return "$T";
          if (n.target === FALSE) return "$F";
          if (n.target === NIL) return "$nil";
          if (n.target === UNIT_V) return "$unit";
          if (!t.fields.length) return hoist(`{ tag: ${tag(n.target)}, fields: [] }`);
          return wrap(`((${t.fields.map((_, i) => `a${i}`).join(", ")}) => ${construct(n.target, t.fields.map((_, i) => `a${i}`))})`, false);
        case "field": return wrap(`((d) => d.fields[${fieldIndex(n.target)}])`, false);
        case "builtin": {
          // Where functions are looked inside (inverse(show, …)), a builtin
          // value says which builtin it is, as the evaluator's do.
          const prim = (js: string) => (reflective ? `$prim(${js}, ${JSON.stringify(n.target)})` : js);
          if (INLINE[n.target]) {
            const ps = Array.from({ length: arity(n.id) }, (_, i) => `a${i}`);
            const js = INLINE[n.target].bool ? `$bool(${INLINE[n.target].js(ps)})` : INLINE[n.target].js(ps);
            return wrap(prim(`((${ps.join(", ")}) => ${js})`), false);
          }
          const runtime: Record<Id, [string, boolean]> = {
            [S.oneOf]: ["$oneOf", true], [S.fail]: ["$fail", true], [S.all]: ["$all", false], [S.count]: ["$count", false], [S.optional]: ["$optional", false],
            [S.equal]: ["((a, b) => $bool($eq(a, b)))", false],
          };
          if (n.target === S.first) return streamsFn(ty(n.id), rho) ? "$firstS" : "$first";
          if (n.target === S.seeded) return streamsFn(ty(n.id), rho) ? "$seededS" : "$seeded";
          if (manyOf(n.target)) return wrap(manyOf(n.target)!, true);
          if (implOf(n.target)) return wrap(reflective ? prim(`((...a) => ${implOf(n.target)!}(...a))`) : implOf(n.target)!, false);
          if (runtime[n.target]) return wrap(...runtime[n.target]);
          throw new Error(`${names[n.target] ?? n.target} can't be used as a value yet`);
        }
        default: throw new Error(`can't refer to a ${t.kind}`);
      }
    }
    const arity = (id: Id) => { const t = ty(id); return t.t === "fn" ? t.params.length : 0; };

    // set: the checker made sure the path is fields written in place, so
    // the positions are known now.
    function setCall(get: Id, record: string, value: string): string {
      const path = fieldPath(code, get)!.map(fieldIndex);
      return `$setPath(${record}, ${JSON.stringify(path)}, ${value})`;
    }

    // path (L98): a field path, or (t) ↦ t for the whole, known now too.
    function pathCall(get: Id): string {
      const steps = placePath(code, get)!.map((f) => ({ field: fieldIndex(f) }));
      return `$path.of(${JSON.stringify(steps)})`;
    }

    function construct(variant: Id, fields: string[]): string {
      if (variant === CONS) return `$cons(${fields.join(", ")})`;
      const js = `({ tag: ${tag(variant)}, fields: [${fields.join(", ")}] })`;
      pieces.set(js, { variant, fields });
      return js;
    }
    // A record's fields as arguments for `k`, without building it again.
    function fieldsFor(variant: Id, v: string): { pre: string; fields: string[] } {
      const p = pieces.get(v);
      if (p && p.variant === variant) return { pre: "", fields: p.fields };
      const t = temp("t"), n = node<"variant">(variant).fields.length;
      return { pre: `const ${t} = ${v};\n`, fields: Array.from({ length: n }, (_, i) => `${t}.fields[${i}]`) };
    }
    // A closure for the rest that takes a record's fields; the record is
    // built in it only if the rest uses it as a whole.
    function unpacked(variant: Id, r: string, k: K): string {
      const fs = node<"variant">(variant).fields.map(() => temp("f"));
      pieces.set(r, { variant, fields: fs });
      const rest = k(r);
      const whole = new RegExp(`(?<![\\p{L}\\p{N}_$])${r.replace(/\$/g, "\\$")}(?![\\p{L}\\p{N}_$])`, "u").test(rest);
      return `(${fs.join(", ")}) => {\n${whole ? `const ${r} = ({ tag: ${tag(variant)}, fields: [${fs.join(", ")}] });\n` : ""}${rest}\n}`;
    }
    // The fields a `$fields` copy left in `$got`, in locals at once (the
    // next such call writes over them); the record is built only if the
    // rest uses it as a whole.
    function fromGot(variant: Id, r: string, k: K): string {
      const fs = node<"variant">(variant).fields.map(() => temp("f"));
      pieces.set(r, { variant, fields: fs });
      const rest = k(r);
      const whole = new RegExp(`(?<![\\p{L}\\p{N}_$])${r.replace(/\$/g, "\\$")}(?![\\p{L}\\p{N}_$])`, "u").test(rest);
      return `const ${fs.map((f, i) => `${f} = $got[${i}]`).join(", ")};\n${whole ? `const ${r} = ({ tag: ${tag(variant)}, fields: [${fs.join(", ")}] });\n` : ""}${rest}`;
    }
    // A field of a record, read from its pieces when it was just built
    // from locals (anything else might have effects to run).
    function field(record: string, f: Id): string {
      const p = pieces.get(record);
      return p && p.fields.every((x) => /^[\p{L}\p{N}_$]+$/u.test(x)) ? p.fields[fieldIndex(f)] : `${record}.fields[${fieldIndex(f)}]`;
    }
    function fieldIndex(field: Id): number {
      const def = info.owner.get(field)!;
      const variant = node<"typedef">(node<"def">(def).body!).variants[0];
      return node<"variant">(variant).fields.indexOf(field);
    }

    function lambda(n: NodeOf<"lambda">): string {
      if (!reflective) return plainLambda(n);
      // The evaluator calls every function as a stream, so a plain function
      // it might call is wrapped.
      const env = captured(n.id).map((b) => {
        const t = ty(b);
        return `[${JSON.stringify(b)}, ${t.t === "fn" ? `$toEval(${local(b)}, ${streamsFn(t, rho)})` : local(b)}]`;
      });
      return `$meta(${plainLambda(n)}, ${JSON.stringify(n.id)}${env.length ? `, () => [${env.join(", ")}]` : ""})`;
    }
    // Function binders that hold a lambda returning a JS boolean, and the
    // lambda: `(p) => !(p === "")` instead of Bool data (GAPS.md G3).
    const boolFns = new Set<Id>();
    function boolLambda(n: NodeOf<"lambda">): string {
      const ps = n.params.map(local).join(", ");
      const b = code.nodes[n.body].kind;
      if (b === "match" || b === "fold" || (b === "call" && code.nodes[node<"call">(n.body).fn].kind === "lambda")) return `((${ps}) => {\n${ret(n.body, false, RETURN_BOOL)}\n})`;
      return `((${ps}) => ${exBool(n.body)})`;
    }
    function plainLambda(n: NodeOf<"lambda">): string {
      const ps = n.params.map(local).join(", ");
      if (laterFn(ty(n.id), sp.lat)) return `(function* (${ps}) {\n${scoped(false, () => inGen(true, () => ret(n.body)))}\n})`;
      if (streamsFn(ty(n.id), rho) && !plainHere.has(n.id)) return `(function* (${ps}) {\n${scoped(false, () => st(n.body, (v) => `yield ${v};`))}\n})`;
      const b = code.nodes[n.body].kind;
      const plainJs = b === "match" || b === "fold" || (b === "call" && code.nodes[node<"call">(n.body).fn].kind === "lambda") ? `((${ps}) => {\n${ret(n.body)}\n})` : `((${ps}) => ${ex(n.body)})`;
      // A block function (List Float64 to List Float64, AUDIO.md) that builds
      // its block also has a version that writes it into an array, for the
      // audio runtimes ($arrayOf).
      const t = ty(n.id);
      if (reflective || !isBlockFn(t) || !gainsIn(n.body, { rec: null, k: 0 }, null)) return plainJs;
      const d = temp("d");
      return `$withInto(${plainJs}, (${[d, ...n.params.map(local)].join(", ")}) => {\n${ret(n.body, false, intoOut(d, { rec: null, k: 0 }))}\n})`;
    }

    // A call with one result.
    function call(n: NodeOf<"call">): string {
      const f = code.nodes[n.fn];
      laterArgs(n);
      if (f.kind === "lambda") return block(n.id);
      if (f.kind === "ref" && boolFns.has(f.target)) return `$bool(${local(f.target)}(${n.args.map(ex).join(", ")}))`;
      const joined = f.kind === "ref" && f.target === TEXT_OPS.joinAll ? arraySource(n.args[0]) : null;
      if (joined) return `$text.joinAll(${inOrder(joined)}, ${ex(n.args[1])})`;
      const one = f.kind === "ref" && (f.target === TEXT_OPS.joinAll || code.nodes[f.target].kind === "def") ? fused(n) : null;
      if (one) return one;
      const linear = linearCall(n);
      if (linear) return linear;
      if (f.kind === "ref") {
        const t = code.nodes[f.target];
        if (t.kind === "builtin") {
          if (f.target === COMPARE) return `$ORDER[${orderJs(n.args[0], n.args.map(ex))} + 1]`;
          if (INLINE[f.target]) {
            const js = INLINE[f.target].js(n.args.map(INLINE[f.target]?.boolArgs ? exBool : ex), n.args.map(narrowText));
            return INLINE[f.target].bool ? `$bool(${js})` : js;
          }
          if (f.target === S.equal) return `$bool(${equality(n)})`;
          if (HANDLERS.has(f.target)) return handlerEx(f.target, n);
          if (f.target === S.seeded) return `$seeded(${ex(n.args[0])}, ${ex(n.args[1])})`;
          if (f.target === S.derivative) return `$derivative($program, ${ex(n.args[0])}, ${streamsFn(ty(n.id), rho)})`;
          if (f.target === S.gradient) return `$derivative($program, ${ex(n.args[0])}, ${streamsFn(ty(n.id), rho)}, ${JSON.stringify(S.gradient)})`;
          if (f.target === S.exists) return `$exists($program, ${ex(n.args[0])})`;
          if (f.target === SET) return setCall(n.args[0], ex(n.args[1]), ex(n.args[2]));
          if (f.target === CELL_OPS.path) return pathCall(n.args[0]);
          if (implOf(f.target)) return `${implOf(f.target)}(${n.args.map(ex).join(", ")})`;
        }
        if (t.kind === "variant" && isConst(n.id)) return hoist(construct(f.target, n.args.map(ex)));
        if (t.kind === "variant") return effectOf(f.target) ? perform(f.target, n.args.map(ex)) : construct(f.target, n.args.map(ex));
        if (t.kind === "field") return field(ex(n.args[0]), f.target);
        if (t.kind === "def") {
          const s = defCall(n);
          const c = callOf(s, argsOf(n, s));
          const v = s.bool ? `$bool(${c})` : c;
          return spends(f.target) ? `($spendOrThrow(), ${v})` : v;
        }
      }
      return laterFn(ty(n.fn), sp.lat) ? `(yield* ${ex(n.fn)}(${n.args.map(ex).join(", ")}))` : `${ex(n.fn)}(${n.args.map(ex).join(", ")})`;
    }

    // Linear functions composed (MATRICES.md layer 1, C30b): f(g(x)), where
    // f and g are definitions whose results are sums of their inputs'
    // Float64 parts times constants (linear.ts reads them), is one matrix
    // A·B and offset A·b + a, folded now and written as unrolled
    // multiply-adds, when that is fewer of them than f's and g's together.
    // A chain f(g(h(x))) folds all the way down. The folded constants are
    // rounded once instead of at each step, so a result may differ from the
    // evaluator's in its last bits, as any compiler's reassociation does.
    // Prior art: constant folding of affine maps (LLVM's and MLIR's affine
    // analysis); the product rule is the textbook matrix of a composition.
    function linearCall(n: NodeOf<"call">): string | null {
      const l = reflective ? null : linearOf(n.id);
      return l && l.args !== n.args ? emitLinear(l.map, l.args) : null;
    }
    // A call of a linear definition, with the arguments it reads; `fold`
    // folds its own argument in too when that is a linear call that pays.
    function linearOf(id: Id, fold = true): { map: LinearMap; args: Id[] } | null {
      const n = code.nodes[id];
      if (n.kind !== "call") return null;
      const f = code.nodes[n.fn];
      if (f.kind !== "ref" || code.nodes[f.target]?.kind !== "def" || spends(f.target)) return null;
      const def = node<"def">(f.target);
      if (def.way || !def.body || code.nodes[def.body].kind !== "lambda") return null;
      if (!linearMaps.has(f.target)) linearMaps.set(f.target, linearMap(code, f.target));
      const map = linearMaps.get(f.target);
      if (!map || map.params.length !== n.args.length || map.params.some((p) => p === null)) return null;
      // Only Float64s: a generic `a + a` called on Ints stays a call.
      if (!floats(map.output ?? "number", n.id) || !map.params.every((p, i) => floats(p, n.args[i]))) return null;
      if (fold && n.args.length === 1) {
        const inner = linearOf(n.args[0]);
        const both = inner && map.params[0] === (inner.map.output ?? "number") ? composeLinear(map, inner.map) : null;
        if (inner && both && [...both.matrix.flat(), ...both.offset].every(Number.isFinite) && less(madds(both), addCost(madds(map), madds(inner.map)))) return { map: both, args: inner.args };
      }
      return { map, args: n.args };
    }
    // A Float64, or a record of Float64s and nothing else.
    function floats(shape: Id | "number" | null, at: Id): boolean {
      const t = ty(at);
      if (shape === "number") return t.t === "con" && t.id === NUMBER;
      if (shape === null || t.t !== "con" || t.args.length) return false;
      return node<"variant">(shape).fields.every((f) => {
        const ft = code.nodes[node<"field">(f).type];
        return ft?.kind === "tref" && ft.target === NUMBER && !ft.args.length;
      });
    }
    // Multiplies and adds a map costs, on the shared scale (cost.ts).
    const madds = (m: LinearMap): readonly number[] =>
      costSteps(m.matrix.flat().filter((x) => x !== 0).length + m.offset.filter((x) => x !== 0).length);
    function emitLinear(m: LinearMap, args: Id[]): string {
      const simple = (js: string) => /^[\p{L}\p{N}_$]+$|^\(?-?\d[\d.e+-]*\)?$/u.test(js);
      const bound: [string, string][] = [];
      const vals = args.map((a, i) => {
        const js = ex(a), p = pieces.get(js);
        const reads = m.params[i] === "number" ? simple(js) : simple(js) || (p !== undefined && p.fields.every(simple));
        if (reads) return js;
        const t = temp("m");
        bound.push([t, js]);
        return t;
      });
      const input = m.inputs.map((c) => (c.field === null ? vals[c.param] : field(vals[c.param], c.field)));
      const num = (x: number) => (Object.is(x, -0) ? "0" : String(x));
      const rows = m.matrix.map((row, i) => {
        const terms = row.flatMap((a, j) => (a === 0 ? [] : [a === 1 ? input[j] : a === -1 ? `-${input[j]}` : `${num(a)} * ${input[j]}`]));
        if (m.offset[i] !== 0) terms.push(num(m.offset[i]));
        return terms.length ? `(${terms.join(" + ")})` : "0";
      });
      const out = m.output === null ? rows[0] : construct(m.output, rows);
      return bound.length ? `((${bound.map(([t]) => t).join(", ")}) => ${out})(${bound.map(([, js]) => js).join(", ")})` : out;
    }

    // A function that waits on an operation answered later, passed where
    // the callee would call it as a plain function (`map`'s, whose row is
    // any): its generator would come back unrun, so that waits for C40's
    // next step.
    function laterArgs(n: NodeOf<"call">) {
      const f = code.nodes[n.fn];
      if (!n.args.some((a) => laterFn(ty(a), sp.lat))) return;
      // A search written in place, inside a generator (handlerEx).
      if (gen && f.kind === "ref" && [S.first, S.all, S.optional, S.count].includes(f.target) && thunk(n.args[0])) return;
      // A definition's copy waits where its argument does (`specAt`).
      const def = f.kind === "ref" && code.nodes[f.target]?.kind === "def" ? defCall(n) : null;
      const t = def ? info.schemes.get(def.def)!.type : f.kind === "ref" && code.nodes[f.target]?.kind === "variant" ? null : ty(n.fn);
      n.args.forEach((a, i) => {
        if (t && laterFn(ty(a), sp.lat) && !(t.t === "fn" && t.params[i] && laterFn(t.params[i], def?.lat))) throw notYet(`a function that waits on an operation answered later, given to ${f.kind === "ref" ? names[f.target] ?? f.target : "a function"}`);
      });
    }

    // Handlers whose thunks are written in place become loops; otherwise
    // the runtime's versions are called with the thunks as values.
    const thunk = (id: Id) => (code.nodes[id].kind === "lambda" && !node<"lambda">(id).params.length ? node<"lambda">(id) : null);
    function handlerEx(h: Id, n: NodeOf<"call">): string {
      const body = thunk(n.args[h === S.fuel ? 1 : 0]);
      // The search runs inside an arrow function of its own, so that its
      // searches can take closures for the rest (GAPS.md G11); stopping
      // early is that arrow returning true.
      const search = (leaf: K) => `(() => {\n${scoped(true, () => st(body!.body, leaf))}\n})();`;
      // A search that waits on an operation answered later (C40): its
      // statements in a generator of their own, so the rest of the wait
      // keeps the search's other choices; no closures for the rest.
      if (!reflective && body && h !== S.fuel && gen && laterFn(ty(n.args[0]), sp.lat)) {
        const inner = (leaf: K) => scoped(false, () => inGen(true, () => st(body.body, leaf)));
        const w = (js: string) => `(yield* (function* () {\n${js}\n})())`;
        const acc = temp("got"), g = n.args[1] ? thunk(n.args[1]) : null;
        if (h === S.first && g) return w(`${inner((v) => `return ${v};`)}\nreturn ${ex(g.body)};`);
        if (h === S.all) return w(`const ${acc} = [];\n${inner((v) => `${acc}.push(${v});`)}\nreturn $toList(${acc});`);
        if (h === S.optional) return w(`${inner((v) => `return { tag: ${tag(SOME)}, fields: [${v}] };`)}\nreturn { tag: ${tag(NONE)}, fields: [] };`);
        if (h === S.count) return w(`let ${acc} = 0;\n${inner(() => `${acc}++;`)}\nreturn ${acc};`);
      }
      if (!reflective && body && h !== S.fuel) {
        const got = temp("got");
        if (h === S.first && oneAnswer(body.body, null)) {
          // At most one answer: no search to stop (GAPS.md G24).
          const g = thunk(n.args[1]);
          return `(() => {\n${scoped(false, () => st(body.body, (v) => `return ${v};`))}\nreturn ${g ? ex(g.body) : `${ex(n.args[1])}()`};\n})()`;
        }
        if (h === S.first) {
          const g = thunk(n.args[1]);
          return `(() => {\nlet ${got} = $no;\n${search((v) => `${got} = ${v};\nreturn true;`)}\nif (${got} !== $no) return ${got};\nreturn ${g ? ex(g.body) : `${ex(n.args[1])}()`};\n})()`;
        }
        if (h === S.all) return `(() => {\nconst ${got} = [];\n${search((v) => `${got}.push(${v});`)}\nreturn $toList(${got});\n})()`;
        if (h === S.optional) return `(() => {\nlet ${got} = $no;\n${search((v) => `${got} = ${v};\nreturn true;`)}\nreturn ${got} !== $no ? { tag: ${tag(SOME)}, fields: [${got}] } : { tag: ${tag(NONE)}, fields: [] };\n})()`;
        if (h === S.count) return `(() => {\nlet ${got} = 0;\n${search(() => `${got}++;`)}\nreturn ${got};\n})()`;
      }
      if (h === S.first) {
        const g = thunk(n.args[1]);
        if (!body) return `$first(${ex(n.args[0])}, ${ex(n.args[1])})`;
        return `(() => {\n${st(body.body, (v) => `return ${v};`)}\nreturn ${g ? ex(g.body) : `${ex(n.args[1])}()`};\n})()`;
      }
      if (h === S.all) {
        if (!body) return `$all(${ex(n.args[0])})`;
        const acc = temp("all");
        return `(() => {\nconst ${acc} = [];\n${st(body.body, (v) => `${acc}.push(${v});`)}\nreturn $toList(${acc});\n})()`;
      }
      if (h === S.optional) {
        if (!body) return `$optional(${ex(n.args[0])})`;
        return `(() => {\n${st(body.body, (v) => `return { tag: ${tag(SOME)}, fields: [${v}] };`)}\nreturn { tag: ${tag(NONE)}, fields: [] };\n})()`;
      }
      if (h === S.count) {
        if (!body) return `$count(${ex(n.args[0])})`;
        const c = temp("count");
        return `(() => {\nlet ${c} = 0;\n${st(body.body, () => `${c}++;`)}\nreturn ${c};\n})()`;
      }
      throw new Error("with fuel always has Choice");
    }

    // Code that performs no operation (C64): every call in it is of a
    // named function or constructor, taking no function, whose own type's
    // row has no effect but Diverge (which only spends steps). The row at
    // the call itself isn't asked: it is the caller's, joined.
    function performsNothing(root: Id): boolean {
      return subtree(code, root).every((id) => {
        const c = code.nodes[id];
        if (c.kind !== "call") return true;
        const f = code.nodes[c.fn];
        if (f?.kind !== "ref" || effectOf(f.target)) return false;
        const t = ty(c.fn);
        if (t.t !== "fn" || t.params.some((x) => sub.zonk(x).t === "fn")) return false;
        const target = code.nodes[f.target];
        const own = target?.kind === "builtin" ? SIGS[f.target]?.(new Subst()) : target?.kind === "def" ? info.schemes.get(f.target)?.type : target?.kind === "variant" ? t : undefined;
        return own?.t === "fn" && own.eff.effs.every((e) => e === DIVERGE);
      });
    }

    // A handler: its cases as functions, answers and escapes apart (an
    // answer never has Choice; an escape may, when the match does).
    function handlerCases(n: NodeOf<"match">, streams: boolean): [string, string] {
      const arms = n.arms.map((a) => node<"arm">(a));
      const fn = (a: NodeOf<"arm">, gen: boolean) => {
        const ps = a.binds.map(local).join(", ");
        return gen ? `function* (${ps}) {\n${scoped(false, () => st(a.body, (v) => `yield ${v};`))}\n}` : `((${ps}) => {\n${ret(a.body)}\n})`;
      };
      const table = (as: NodeOf<"arm">[], gen: boolean) => `{ ${as.map((a) => `${tag(a.variant)}: ${fn(a, gen)}`).join(", ")} }`;
      const answers = arms.filter((a) => node<"variant">(a.variant).returns);
      return [table(answers, false), table(arms.filter((a) => !answers.includes(a)), streams)];
    }
    function handleEx(n: NodeOf<"match">, finish = (body: string) => body): string {
      const arms = n.arms.map((a) => node<"arm">(a));
      if (n.otherwise) {
        // The normal finish (L57): the computation's value comes out marked,
        // so the case for it runs outside the handler and an escape's value
        // passes as it is.
        if (arms.some((a) => isLater(a.variant))) return handleLater(n, arms);
        const mark = temp("finished"), r = temp("r");
        const handled = handleEx({ ...n, otherwise: null }, (body) => `return [${mark}, (() => {\n${body}\n})()];`);
        return `(() => {\nconst ${mark} = {};\nconst ${r} = ${handled};\nreturn Array.isArray(${r}) && ${r}[0] === ${mark} ? (${ex(n.otherwise)})(${r}[1]) : ${r};\n})()`;
      }
      if (arms.some((a) => isLater(a.variant))) return handleLater(n, arms);
      if (!arms.some((a) => node<"variant">(a.variant).returns)) {
        // Only escapes: a try/catch (GAPS.md G18), no tables or closures.
        const h = temp("h"), e = temp("e");
        const cases = arms.map((a) => `if (${e}.op === ${tag(a.variant)}) {${binds(a, e, "args")}\n${ret(a.body)}\n}`).join("\n");
        return `(() => {\nconst ${h} = $enter(${JSON.stringify(handlerOf(n))});\ntry {\n${finish(ret(n.scrutinee))}\n} catch (${e}$) {\nconst ${e} = $caught(${e}$, ${h});\n${cases}\nthrow new Error("unhandled escape");\n} finally {\n$leave(${h});\n}\n})()`;
      }
      const [answers, escapes] = handlerCases(n, false);
      // Cases that answer and perform nothing (C64) run with no handlers
      // hidden: there is nothing in them that could see one.
      const quiet = arms.filter((a) => node<"variant">(a.variant).returns).every((a) => performsNothing(a.body));
      return `$handle(${JSON.stringify(handlerOf(n))}, ${answers}, ${escapes}, () => {\n${finish(ret(n.scrutinee))}\n}${quiet ? ", true" : ""})`;
    }

    // A handler with a case for an operation answered later: the handled
    // computation is a generator that $handleL drives. Each such case gets
    // the rest as its last input, a function that resumes the generator
    // once under the same handler (deep).
    function handleLater(n: NodeOf<"match">, arms: NodeOf<"arm">[]): string {
      const rests = arms.filter((a) => isLater(a.variant)).map((a) => a.binds[a.binds.length - 1]);
      // The match itself may wait on another handler's operation (the rest's
      // row says so): then it is a generator too ($handleLG). Its cases are
      // generators, it passes what it doesn't handle outward, and the rest
      // waits as the match does.
      const waits = rests.some((r) => laterFn(ty(r), sp.lat));
      const fn = (a: NodeOf<"arm">) => (waits ? `(function* (${a.binds.map(local).join(", ")}) {\n${scoped(false, () => inGen(true, () => ret(a.body)))}\n})` : `((${a.binds.map(local).join(", ")}) => {\n${scoped(false, () => ret(a.body))}\n})`);
      const table = (as: NodeOf<"arm">[]) => `{ ${as.map((a) => `${tag(a.variant)}: ${fn(a)}`).join(", ")} }`;
      const returns = (a: NodeOf<"arm">) => !isLater(a.variant) && !!node<"variant">(a.variant).returns;
      // A case answered at once answers in place, as a plain function, even
      // where the match waits: one that would wait itself isn't compiled yet.
      const now = (as: NodeOf<"arm">[]) => {
        const t = `{ ${as.map((a) => `${tag(a.variant)}: ((${a.binds.map(local).join(", ")}) => {\n${scoped(false, () => inGen(false, () => ret(a.body)))}\n})`).join(", ")} }`;
        try { new Function(`"use strict";\n(${t})`); } catch { throw notYet("a handler that waits, with a case answered at once that waits too"); }
        return t;
      };
      const ops = `{ ${arms.filter((a) => isLater(a.variant)).map((a) => `${tag(a.variant)}: ${JSON.stringify(names[a.variant] ?? a.variant)}`).join(", ")} }`;
      const body = scoped(false, () => inGen(true, () => ret(n.scrutinee)));
      try { new Function(`"use strict";\n(function* () {\n${body}\n})`); } catch { throw notYet("an operation answered later performed inside a function the compiler makes (a search, a loop)"); }
      // The case for the normal finish (L57) runs on the computation's value
      // when it finishes, after however many rests (I37).
      const done = n.otherwise ? `, ${ex(n.otherwise)}${waits && laterFn(ty(n.otherwise), sp.lat) ? ", true" : ""}` : "";
      if (!waits && n.otherwise && laterFn(ty(n.otherwise), sp.lat)) throw notYet("a handler's case for the normal finish that waits on another handler's operation");
      if (waits) return `(yield* $handleLG(${JSON.stringify(handlerOf(n))}, ${table(arms.filter((a) => isLater(a.variant)))}, ${ops}, ${now(arms.filter(returns))}, ${table(arms.filter((a) => !isLater(a.variant) && !returns(a)))}, function* () {\n${body}\n}${done}))`;
      return `$handleL(${JSON.stringify(handlerOf(n))}, ${table(arms.filter((a) => isLater(a.variant)))}, ${ops}, ${table(arms.filter(returns))}, ${table(arms.filter((a) => !isLater(a.variant) && !returns(a)))}, function* () {\n${body}\n}${done})`;
    }

    function match(n: NodeOf<"match">): string {
      if (handlerOf(n)) return handleEx(n);
      const arms = n.arms.map((a) => node<"arm">(a));
      if (isBoolMatch(n)) {
        const [t, e] = boolArms(n);
        return `(${exBool(n.scrutinee)} ? ${ex(t)} : ${ex(e)})`;
      }
      return block(n.id);
    }
    // Only the fields the arm uses are taken out.
    const binds = (a: NodeOf<"arm">, s: string, of = "fields") => a.binds.map((b, i) => (referenced.has(b) ? `\nconst ${local(b)} = ${s}.${of}[${i}];` : "")).join("");
    const isBoolMatch = (n: NodeOf<"match">) => n.arms.every((a) => [TRUE, FALSE].includes(node<"arm">(a).variant)) && (n.arms.length === 2 || (n.arms.length === 1 && !!n.otherwise));
    const boolArms = (n: NodeOf<"match">): [Id, Id] => {
      const arm = (v: Id) => n.arms.map((a) => node<"arm">(a)).find((a) => a.variant === v)?.body ?? n.otherwise!;
      return [arm(TRUE), arm(FALSE)];
    };

    // fold: a loop, children first (bottom-up).
    const foldEx = (n: NodeOf<"fold">) => block(n.id);

    // An expression that needs statements (a let, a match, a fold) inside
    // an expression.
    const block = (id: Id) => (gen ? `(yield* (function* () {\n${ret(id)}\n})())` : `(() => {\n${ret(id)}\n})()`);

    // Statements that return the value of `id` (no Choice). Lets become
    // consts, matches become switches, folds local recursive functions.
    // `tail`: these statements end the definition's own body, so a call
    // of the definition to itself here is a jump back to its start.
    // `out`: what to do with the value (return it, or put it in a
    // variable), and whether it's wanted as a JS boolean instead of Bool
    // data.
    // `reuse`: the matched cell `s`, owned, that a cons here may be built
    // in (GAPS.md G25), if the run from `root` to it doesn't use `cell`.
    function ret(id: Id, tail = false, out: Out = RETURN, reuse: Reuse | null = null): string {
      // A field the reused cell already holds.
      const same = (a: Id, i: number) => { const x = code.nodes[a]; return x.kind === "ref" && x.target === reuse?.binds[i]; };
      const n = code.nodes[id];
      if (streamy(id)) throw new Error(`internal: ${id} in ${names[sp.def]} has Choice but is compiled as a plain expression`);
      if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") {
        const li = out.into && !out.into.done ? letInto(n, out.into.shape) : null;
        const t = li ? intoCallee(li.call, out.into!.shape) : null;
        if (li && t) {
          // The value written into the array; another answer puts its own
          // items there instead.
          const { d } = out.into!, at = temp("n");
          intoDone.add(li.p);
          const instead: Out = { ...out, into: undefined, leaf: (js) => `${d}.length = ${at};\n${out.leaf(js)}` };
          return `const ${at} = ${d}.length;\n${t.name}(${[d, ...argsOf(li.call, t)].join(", ")});\n${ret(li.body, tail, { ...instead, into: { d, shape: out.into!.shape, done: li.p } }, reuse)}`;
        }
        const f = node<"lambda">(n.fn);
        return f.params.map((p, i) => bindLet(p, letArg(p, n.args[i]))).join("") + ret(f.body, tail, out, reuse);
      }
      if (n.kind === "match") {
        if (handlerOf(n)) return out.leaf(out.bool ? `(${handleEx(n)}.tag === ${JSON.stringify(TRUE)})` : handleEx(n));
        const m = out.into && !out.into.done ? intoMatch(n, out.into.shape) : null;
        if (m && intoCallee(m.call, m.to) && (m.kind === "field" || pure(m.head!))) return intoMatchJs(m, tail, out);
        if (isBoolMatch(n)) {
          const [t, e] = boolArms(n);
          return `${condition(n.scrutinee, (c) => `if (${c}) {\n${ret(t, tail, out, reuse)}\n}\n${ret(e, tail, out, reuse)}`)}`;
        }
        const view = listMatch(n) ? viewOf(n.scrutinee, n) : null;
        if (view) {
          // A list that is an array from `split` (or a part of one), taken
          // apart: an index into the array, and no cells (GAPS.md G23).
          const arm = (v: Id) => n.arms.map((a) => node<"arm">(a)).find((a) => a.variant === v);
          const nil = arm(NIL), cons = arm(CONS);
          const ifNil = nil ? ret(nil.body, tail, out, reuse) : ret(n.otherwise!, tail, out, reuse);
          let ifCons: string;
          if (cons) {
            const [h, rest] = cons.binds, j = views.get(rest)?.i ?? temp("j");
            const head = referenced.has(h) ? `\nconst ${local(h)} = ${view.a}[${view.i}];` : "";
            const next = referenced.has(rest) ? `\nconst ${j} = ${view.i === "0" ? "1" : `${view.i} + 1`};` : "";
            if (referenced.has(rest)) views.set(rest, { a: view.a, i: j });
            ifCons = `${head}${next}\n${ret(cons.body, tail, out, reuse)}`;
          } else ifCons = ret(n.otherwise!, tail, out, reuse);
          return `${view.pre}if (${view.i} >= ${view.a}.length) {\n${ifNil}\n} else {${ifCons}\n}`;
        }
        const s = temp("s");
        const scrut = code.nodes[n.scrutinee];
        if (scrut.kind === "call" && code.nodes[scrut.fn].kind === "ref" && node<"ref">(scrut.fn).target === COMPARE) {
          // A match on `compare`: on the number, with no Order built.
          const at: Id[] = [ORDER_V.before, ORDER_V.same, ORDER_V.after];
          const cases = n.arms.map((a) => node<"arm">(a)).map((a) => `case ${at.indexOf(a.variant) - 1}: {\n${ret(a.body, tail, out, reuse)}\n}`);
          if (n.otherwise) cases.push(`default: {\n${ret(n.otherwise, tail, out, reuse)}\n}`);
          return `const ${s} = ${orderJs(scrut.args[0], scrut.args.map(ex))};\nswitch (${s}) {\n${cases.join("\n")}\n}`;
        }
        const mine = !sp.streams && once.has(id) && scrut.kind === "ref" && ownedAt(scrut.target, n.scrutinee, sp.own, new Set());
        const cases = n.arms.map((a) => node<"arm">(a)).map((a) => {
          const r = mine && a.variant === CONS ? { s, cell: (scrut as NodeOf<"ref">).target, root: a.body, binds: a.binds } : reuse;
          return `case ${tag(a.variant)}: {${binds(a, s)}\n${ret(a.body, tail, out, r)}\n}`;
        });
        if (n.otherwise) cases.push(`default: {\n${ret(n.otherwise, tail, out, reuse)}\n}`);
        return `const ${s} = ${ex(n.scrutinee)};\nswitch (${s}.tag) {\n${cases.join("\n")}\n}`;
      }
      if (n.kind === "fold" && !out.bool) return out === RETURN ? foldLoop(n) : out.leaf(foldEx(n));
      if (out.into) { const js = intoJs(n, tail, out); if (js !== null) return js; }
      // A cons built in the matched cell, which nothing else holds.
      const inCell = reuse && n.kind === "call" && code.nodes[n.fn].kind === "ref" && node<"ref">(n.fn).target === CONS && !isConst(id) &&
        !mentions(id, reuse.cell) && clearOf(id, reuse.cell, reuse.root) ? reuse.s : null;
      if (tail && holes && holeCall(n)) {
        // Tail recursion modulo cons (G22): the cell is made now with its
        // last field empty, hung where the answer goes, and the loop runs
        // again to fill that field. Friedman and Wise, "Unwinding stylized
        // recursions into iterations" (1975); OCaml's [@tail_mod_cons].
        jumps = true;
        const c = n as NodeOf<"call">, last = c.args.length - 1;
        const lam = node<"lambda">(d.body!);
        const fields = c.args.slice(0, last).map(ex);
        const args = loopArgs(node<"call">(c.args[last]), sp);
        const spend = spends(sp.def) ? "$spendOrThrow();\n" : "";
        let cell = inCell;
        const made = cell ? same(c.args[0], 0) ? "" : `${cell}.fields[0] = ${fields[0]};\n` : `const ${(cell = temp("cell"))} = { tag: ${tag(node<"ref">(c.fn).target)}, fields: [${[...fields, "undefined"].join(", ")}] };\n`;
        // A reused cell is usually still where the last one points.
        const hang = inCell ? `if (${holes.at}.fields[${holes.i}] !== ${cell}) ${holes.at}.fields[${holes.i}] = ${cell};` : `${holes.at}.fields[${holes.i}] = ${cell};`;
        return made + `${hang}\n${holes.at} = ${cell};\n${holes.i} = ${last};\n` +
          `${spend}${paramNames(sp).map((p, i) => `${p}$in = ${args[i]};`).join("\n")}\ncontinue;`;
      }
      if (inCell) {
        const c = n as NodeOf<"call">, vs = c.args.map((a, i) => (same(a, i) ? null : [temp(i ? "t" : "h"), ex(a)]));
        const set = vs.flatMap((v, i) => (v ? [`${inCell}.fields[${i}] = ${v[0]};`] : []));
        const lets = vs.filter((v) => v).map((v) => `${v![0]} = ${v![1]}`);
        return `${lets.length ? `const ${lets.join(", ")};\n` : ""}${set.join("\n")}\n${out.leaf(inCell)}`;
      }
      if (tail && selfCall(n)) {
        // The new arguments go into the loop's inputs, and the body runs
        // again with them: no JS stack (COMPILER.md, stage 2½).
        jumps = true;
        const lam = node<"lambda">(d.body!);
        const args = loopArgs(n as NodeOf<"call">, sp);
        const spend = spends(sp.def) ? "$spendOrThrow();\n" : "";
        return `${spend}${paramNames(sp).map((p, i) => `${p}$in = ${args[i]};`).join("\n")}\ncontinue;`;
      }
      // `first` of one answer or none, given back from here: its statements
      // in place, then the other way (GAPS.md P6; G24 in a closure).
      const body = n.kind === "call" && !reflective && refTo(n.fn, S.first) ? thunk(n.args[0]) : null;
      if (body && oneAnswer(body.body, null)) {
        const c = n as NodeOf<"call">, g = thunk(c.args[1]);
        const leaf = (v: string) => out.leaf(out.bool ? `(${v}.tag === ${JSON.stringify(TRUE)})` : v);
        return `${scoped(false, () => st(body.body, leaf))}\n${g ? ret(g.body, tail, out) : leaf(`${ex(c.args[1])}()`)}`;
      }
      return out.leaf(out.bool ? exBool(id) : ex(id));
    }

    // A test of a Bool. When it is decided by a match (`is mark` in calc),
    // the match runs as statements that set a JS boolean, instead of a
    // function called in place that returns Bool data.
    function condition(id: Id, k: (c: string) => string): string {
      const n = code.nodes[id];
      if (n.kind !== "match" || handlerOf(n)) return k(exBool(id));
      const c = temp("c"), done = temp("done");
      return `let ${c};\n${done}: {\n${ret(id, false, { bool: true, leaf: (js) => `${c} = ${js};\nbreak ${done};` })}\n}\n${k(c)}`;
    }
    // A call of this very specialization of the definition.
    let jumps = false;
    // Where the answer goes, when the definition fills holes (G22): the
    // last cell made and which of its fields is empty.
    let holes: { at: string; i: string } | null = null;
    // A constructor (not an effect) whose last field is a call of the
    // definition to itself.
    function holeCall(n: Node): boolean {
      if (n.kind !== "call" || !n.args.length) return false;
      const f = code.nodes[n.fn];
      if (f.kind !== "ref" || code.nodes[f.target].kind !== "variant" || effectOf(f.target)) return false;
      return selfCall(code.nodes[n.args[n.args.length - 1]]);
    }
    // Is there one in a tail position of `id`? The same positions as ret's.
    function fillsHoles(id: Id): boolean {
      const n = code.nodes[id];
      if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") return fillsHoles(node<"lambda">(n.fn).body);
      if (n.kind === "match") {
        if (handlerOf(n)) return false;
        return n.arms.some((a) => fillsHoles(node<"arm">(a).body)) || (!!n.otherwise && fillsHoles(n.otherwise));
      }
      return holeCall(n);
    }
    // ---- an `$into` copy's answers (P4)
    // What isn't written out (a list only had as a value) is copied in.
    const intoOut = (d: string, shape: Into): Out => ({
      bool: false,
      into: { d, shape },
      leaf: (js) => {
        if (shape.rec === null) return `$pushList(${d}, ${js});\nreturn;`;
        const r = temp("r");
        return `const ${r} = ${js};\n$pushList(${d}, ${r}.fields[${shape.k}]);\nreturn ${r}.fields[${1 - shape.k}];`;
      },
    });
    // Lists whose items a call has already pushed: their one use is done.
    const intoDone = new Set<Id>();
    // The `$into` copy a call can hand the array to, if it has one worth
    // having.
    function intoCallee(n: NodeOf<"call">, shape: Into): Spec | null {
      const g = refTarget(n.fn);
      if (!g || code.nodes[g]?.kind !== "def" || !sameInto(intoShape(g), shape) || !intoGain(g) || callStreams(n)) return null;
      const c = defCall(n);
      if (c.streams || c.bool) return null;
      return spec(c.def, c.rho, c.plain, false, c.arr, false, false, shape, c.lat, keyAt(c));
    }
    // A call that writes into the array `d`: a jump if it is this copy.
    function intoCallJs(n: NodeOf<"call">, t: Spec, tail: boolean, d: string, pre = ""): string {
      if (tail && t.name === sp.name) {
        jumps = true;
        const args = loopArgs(n, t);
        const spend = spends(sp.def) ? "$spendOrThrow();\n" : "";
        return `${pre}${spend}${paramNames(sp).map((p, i) => `${p}$in = ${args[i]};`).join("\n")}\ncontinue;`;
      }
      return `${pre}return ${t.name}(${[d, ...argsOf(n, t)].join(", ")});`;
    }
    function intoMatchJs(m: NonNullable<ReturnType<typeof intoMatch>>, tail: boolean, out: Out): string {
      const { d } = out.into!, t = intoCallee(m.call, m.to)!;
      if (m.kind === "pass") {
        const h = temp("h");
        return intoCallJs(m.call, t, tail, d, `const ${h} = ${ex(m.head!)};\n${d}.push(${h});\n`);
      }
      const other = m.arm.binds[1 - m.to.k];
      intoDone.add(m.arm.binds[m.to.k]);
      const call = `${t.name}(${[d, ...argsOf(m.call, t)].join(", ")})`;
      return `${referenced.has(other) ? `const ${local(other)} = ${call};` : `${call};`}\n${ret(m.arm.body, tail, out)}`;
    }
    // A list's items pushed in order: the cons cells written out, and the
    // rest copied in.
    function pushInto(id: Id, d: string): string {
      const n = code.nodes[id];
      if (n.kind === "ref" && n.target === NIL) return "";
      if (n.kind === "call" && refTarget(n.fn) === CONS) return `${d}.push(${ex(n.args[0])});\n${pushInto(n.args[1], d)}`;
      return `$pushList(${d}, ${ex(id)});\n`;
    }
    function intoJs(n: Node, tail: boolean, out: Out): string | null {
      const { d, shape, done } = out.into!;
      if (n.kind === "ref" && intoDone.has(n.target)) return "return;";
      if (done) return null;
      if (shape.rec === null && n.kind === "ref" && n.target === NIL) return "return;";
      if (n.kind !== "call") return null;
      const f = refTarget(n.fn);
      if (shape.rec === null && f === CONS) return `${pushInto(n.id, d)}return;`;
      if (shape.rec !== null && f === shape.rec) {
        // The fields in order: the list pushed, the other kept.
        const o = temp("o");
        const parts = n.args.map((a, i) => (i === shape.k ? pushInto(a, d) : `const ${o} = ${ex(a)};\n`));
        return `${parts.join("")}return ${o};`;
      }
      const t = intoCallee(n as NodeOf<"call">, shape);
      return t ? intoCallJs(n as NodeOf<"call">, t, tail, d) : null;
    }

    function selfCall(n: Node): boolean {
      if (n.kind !== "call") return false;
      const f = code.nodes[n.fn];
      return f.kind === "ref" && f.target === sp.def && defCall(n).name === sp.name;
    }

    // A fold without Choice is a loop, not a recursion, so a list of a
    // million items needs no JS stack. One function, `step`, runs an arm
    // given a value and the folded results of its recursive fields. Children
    // are folded before parents, as the evaluator does it.
    //  - When no case has more than one recursive field (lists, Nat, any
    //    chain), walk down the spine into an array, then run the steps back
    //    up it.
    //  - Otherwise (trees), keep an explicit stack of values whose children
    //    are being folded.
    //  - When a field holds the type nested in a container (a rose tree's
    //    List Tree), `parts` lists the trees inside it (ters/src/
    //    lang/nested.ts) and puts their results back in a copy of it.
    // How it loops is the fold job of the storage its input has
    // (ters/src/lang/represent.ts, `foldPlan`).
    function foldLoop(n: NodeOf<"fold">): string {
      const plan = foldPlan(code, n);
      switch (plan.rep.jobs.fold) {
        case "cells.loop": {
          const arr = arrayFold(n) ? arraySource(plan.on) : null;
          return arr ? foldArray(n, arr) : foldCells(n, ex(plan.on));
        }
        case "text.reverse": return foldText(n, ex(plan.on));
        case "count.down": return foldCount(n, ex(plan.on), plan.rep.meaning === INT_OPS.range);
        default: throw new Error(`no template for ${plan.rep.jobs.fold}`);
      }
    }

    // A fold over a chain whose recursive case adds an item to the rest
    // (`item + rest`, `rest + item`, or × instead), maybe only when a test
    // holds (`if test then rest + 1 else rest`), and whose other case, items
    // and tests have no effects: Int + and × are associative and
    // commutative (exact, unlike Float64's), so the items can be combined
    // from the front.
    const ORDERLESS = new Set<Id>([INT_OPS.add, INT_OPS.mul]);
    function pure(id: Id): boolean {
      return subtree(code, id).every((x) => {
        const c = code.nodes[x];
        if (c.kind === "solve") return false;
        if (c.kind !== "call") return true;
        const t = ty(c.fn), f = code.nodes[c.fn];
        if (f.kind === "ref" && info.divergent.has(f.target)) return false;
        if (t.t !== "fn") return false;
        const row = sub.resolveRow(t.eff);
        return !row.effs.length && (row.tail === null || !rho.get(row.tail));
      });
    }
    // How a step changes the accumulator, as JS, or null if it isn't one of
    // those shapes.
    type Step = (acc: string) => string;
    function forward(arms: NodeOf<"arm">[], recOf: (a: NodeOf<"arm">) => number[]) {
      if (arms.length !== 2) return null;
      const on = arms.find((a) => recOf(a).length === 1), end = arms.find((a) => recOf(a).length === 0);
      if (!on || !end) return null;
      const at = recOf(on)[0], rest = on.results[at]!;
      const usesRest = (x: Id) => subtree(code, x).some((y) => { const r = code.nodes[y]; return r.kind === "ref" && r.target === rest; });
      const free = (x: Id) => !usesRest(x) && pure(x);
      let op: Id | null = null;
      const shape = (x: Id): Step | null => {
        const b = code.nodes[x];
        if (b.kind === "ref" && b.target === rest) return (acc) => acc;
        if (b.kind === "call" && b.args.length === 2 && code.nodes[b.fn].kind === "ref") {
          const f = node<"ref">(b.fn).target;
          if (!ORDERLESS.has(f) || (op && op !== f)) return null;
          const [p, q] = b.args;
          const item = code.nodes[p].kind === "ref" && node<"ref">(p).target === rest ? q : code.nodes[q].kind === "ref" && node<"ref">(q).target === rest ? p : null;
          if (!item || !free(item)) return null;
          op = f;
          return (acc) => INLINE[f].js([ex(item), acc]);
        }
        if (b.kind === "match" && isBoolMatch(b) && free(b.scrutinee)) {
          const [t, e] = boolArms(b).map(shape);
          if (!t || !e) return null;
          return (acc) => `(${exBool(b.scrutinee)} ? ${t(acc)} : ${e(acc)})`;
        }
        return null;
      };
      const step = shape(on.body);
      if (!step || !op || !pure(end.body) || end.binds.some((x) => referenced.has(x))) return null;
      return { on, end, at, step };
    }


    // ---- fusion (GAPS.md G16): a chain like `length(keep(split(t, " "),
    // p))` or `joinAll(map(characters(t), f), "")` runs as one loop, with
    // no list between the steps. The list comes from a builtin that makes a
    // JS array (split, characters) or is walked as it is; each step is a
    // definition that keeps or changes each item in order (prelude's keep
    // and map, or any definition of the same shape), inlined; the end is a
    // fold that runs from the front (G15, such as length), joinAll, or a list.
    // Prior art: deforestation (Wadler, 1990) and short-cut fusion (Gill,
    // Launchbury and Peyton Jones, 1993); this is the special case where the
    // steps are known definitions, done by inlining.
    type Emit = (item: string, next: K) => string;
    const refTo = (id: Id, target: Id) => { const r = code.nodes[id]; return r.kind === "ref" && r.target === target; };
    const uses = (id: Id, b: Id) => subtree(code, id).some((x) => refTo(x, b));
    // No effects other than Choice: an item may be dropped, nothing else.
    const onlyChoice = (id: Id) => subtree(code, id).every((x) => {
      const c = code.nodes[x];
      if (c.kind === "solve") return false;
      if (c.kind !== "call") return true;
      const t = ty(c.fn), f = code.nodes[c.fn];
      if (f.kind === "ref" && info.divergent.has(f.target)) return false;
      if (t.t !== "fn") return false;
      return sub.resolveRow(t.eff).effs.every((e) => e === CHOICE);
    });
    const steps = new Map<Id, { li: number; emit: Emit } | null>();
    function stepOf(def: Id): { li: number; emit: Emit } | null {
      if (steps.has(def)) return steps.get(def)!;
      let r: { li: number; emit: Emit } | null = null;
      if (isFnDef(def) && !info.divergent.has(def)) {
        const lam = node<"lambda">(node<"def">(def).body!);
        const param = (id: Id) => { const x = code.nodes[id]; return x.kind === "ref" ? lam.params.indexOf(x.target) : -1; };
        const b = code.nodes[lam.body];
        // all(() => let x = one of(list) in E): E's answers for each item.
        if (b.kind === "call" && refTo(b.fn, S.all) && thunk(b.args[0])) {
          const c = code.nodes[thunk(b.args[0])!.body];
          const v = c.kind === "call" && code.nodes[c.fn].kind === "lambda" && c.args.length === 1 ? code.nodes[c.args[0]] : null;
          if (c.kind === "call" && v?.kind === "call" && refTo(v.fn, S.oneOf) && param(v.args[0]) >= 0) {
            const li = param(v.args[0]), inner = node<"lambda">(c.fn);
            if (!uses(inner.body, lam.params[li]) && onlyChoice(inner.body))
              r = { li, emit: (item, next) => `const ${local(inner.params[0])} = ${item};\n${st(inner.body, next)}` };
          }
        }
        // match list { nil → nil; cons(x, rest) → cons(E, self(rest, …)) }
        if (b.kind === "match" && !handlerOf(b) && !b.otherwise && b.arms.length === 2 && param(b.scrutinee) >= 0) {
          const li = param(b.scrutinee), arms = b.arms.map((a) => node<"arm">(a));
          const nil = arms.find((a) => a.variant === NIL), cons = arms.find((a) => a.variant === CONS);
          const body = cons && code.nodes[cons.body];
          if (nil && cons && refTo(nil.body, NIL) && body?.kind === "call" && refTo(body.fn, CONS)) {
            const [e, more] = body.args, again = code.nodes[more];
            const same = again.kind === "call" && refTo(again.fn, def) && again.args.every((a, i) => refTo(a, i === li ? cons.binds[1] : lam.params[i]));
            if (same && !uses(e, cons.binds[1]) && pure(e)) r = { li, emit: (item, next) => `const ${local(cons.binds[0])} = ${item};\n${next(ex(e))}` };
          }
        }
      }
      steps.set(def, r);
      return r;
    }
    // Where the items end up: the call's list argument, what to set up
    // before the loop, what each item does, and the value after it.
    function sinkOf(n: NodeOf<"call">): { li: number; before: string; each: (item: string) => string; after: string } | null {
      const f = code.nodes[n.fn];
      if (f.kind !== "ref") return null;
      if (f.target === TEXT_OPS.joinAll) {
        const parts = temp("parts"), by = temp("by");
        return { li: 0, before: `const ${by} = ${ex(n.args[1])};\nconst ${parts} = [];\n`, each: (x) => `${parts}.push(${x});`, after: `${parts}.join(${by})` };
      }
      if (code.nodes[f.target].kind !== "def" || !isFnDef(f.target) || info.divergent.has(f.target)) return null;
      // A step as the sink: its own step on each item, then pushed (GAPS.md
      // M1: `keep(split(line, " "), test)` had pushed the items untested).
      const own = stepOf(f.target);
      if (own) {
        const out = temp("out");
        return { li: own.li, before: `const ${out} = [];\n`, each: (x) => `{\n${own.emit(x, (v) => `${out}.push(${v});`)}\n}`, after: `$toList(${out})` };
      }
      const lam = node<"lambda">(node<"def">(f.target).body!), b = code.nodes[lam.body];
      if (b.kind !== "fold") return null;
      const li = lam.params.findIndex((p) => refTo(b.scrutinee, p));
      const arms = b.arms.map((a) => node<"arm">(a));
      const recOf = (a: NodeOf<"arm">) => a.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      if (li < 0 || !arms.every((a) => recOf(a).length <= 1) || !arms.every((a) => a.variant === NIL || a.variant === CONS)) return null;
      const fwd = forward(arms, recOf);
      if (!fwd || fwd.on.variant !== CONS || fwd.at !== 1 || referenced.has(fwd.on.binds[1])) return null;
      const acc = temp("acc");
      return {
        li, before: `let ${acc} = ${ex(fwd.end.body)};\n`, after: acc,
        each: (x) => `${referenced.has(fwd.on.binds[0]) ? `const ${local(fwd.on.binds[0])} = ${x};\n` : ""}${acc} = ${fwd.step(acc)};`,
      };
    }
    function fused(n: NodeOf<"call">): string | null {
      if (reflective || streamy(n.id)) return null;
      const top = code.nodes[n.fn];
      if (top.kind !== "ref") return null;
      const seen = new Set<Id>([sp.def, top.target]);
      const chain: { call: NodeOf<"call">; def: Id; emit: Emit }[] = [];
      const sink = sinkOf(n);
      if (!sink) return null;
      let at: Id | null = n.args[sink.li];
      // Walk down through steps to the list they start from.
      for (;;) {
        const c: Node | null = at ? code.nodes[at] : null;
        if (!c || c.kind !== "call" || code.nodes[c.fn].kind !== "ref") break;
        const d: Id = node<"ref">(c.fn).target, step: { li: number; emit: Emit } | null = code.nodes[d].kind === "def" ? stepOf(d) : null;
        if (!step || seen.has(d)) break;
        seen.add(d);
        chain.unshift({ call: c, def: d, emit: step.emit });
        at = c.args[step.li];
      }
      if (!chain.length && !(at && arrayKind(at))) return null;
      // Every other argument has no effects, and the functions given choose
      // nothing; they're bound once, before the loop.
      const calls = [n, ...chain.map((c) => c.call)];
      const bindsOf: string[] = [];
      for (const c of calls) {
        const d = node<"ref">(c.fn).target;
        if (code.nodes[d].kind !== "def") continue;
        const li = c === n ? sink.li : stepOf(d)!.li;
        const params = node<"lambda">(node<"def">(d).body!).params;
        for (const [i, a] of c.args.entries()) {
          if (i === li) continue;
          // (A lambda written here may carry Choice in its type without
          // choosing: COMPILER.md, "one known imprecision".)
          const t = ty(a), lam = code.nodes[a];
          const plainFn = t.t === "fn" && (!streamsFn(t, rho) || (lam.kind === "lambda" && !streamy(lam.body)));
          if (!onlyChoice(a) || streamy(a) || (t.t === "fn" && !plainFn)) return null;
        }
      }
      for (const c of calls) {
        const d = node<"ref">(c.fn).target;
        if (code.nodes[d].kind !== "def") continue;
        const li = c === n ? sink.li : stepOf(d)!.li;
        const params = node<"lambda">(node<"def">(d).body!).params;
        c.args.forEach((a, i) => {
          if (i === li) return;
          if (ty(a).t === "fn") { fusePlain.add(params[i]); if (code.nodes[a].kind === "lambda") plainHere.add(a); }
          if (!referenced.has(params[i])) return;
          // A test written here returns a JS boolean (GAPS.md G3).
          const lam = code.nodes[a], t = sub.zonk(ty(a));
          if (lam.kind === "lambda" && t.t === "fn" && isBool(t.ret) && !streamy(lam.body) && calledParams(d).has(params[i])) {
            boolFns.add(params[i]);
            bindsOf.push(`const ${local(params[i])} = ${boolLambda(lam)};\n`);
          } else {
            boolFns.delete(params[i]);
            bindsOf.push(`const ${local(params[i])} = ${boolParams.has(params[i]) ? exBool(a) : ex(a)};\n`);
          }
        });
      }
      const x = temp("x");
      const run = (i: number, item: string): string => (i === chain.length ? sink.each(item) : `{\n${chain[i].emit(item, (v) => run(i + 1, v))}\n}`);
      const body = scoped(true, () => run(0, x));
      const array = at ? arraySource(at) : null;
      const loop = array
        ? eachOf(array, x, body, "list")
        : (() => { const l = temp("l"); return `for (let ${l} = ${ex(at!)}; ${l}.tag === ${JSON.stringify(CONS)}; ${l} = ${l}.fields[1]) {\nconst ${x} = ${l}.fields[0];\n${body}\n}`; })();
      return `(() => {\n${bindsOf.join("")}${sink.before}${loop}\nreturn ${sink.after};\n})()`;
    }

    function foldCells(n: NodeOf<"fold">, input: string): string {
      const arms = n.arms.map((a) => node<"arm">(a));
      const recOf = (a: NodeOf<"arm">) => a.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      if (arms.some((a) => recOf(a).some((i) => nestedShape(a, i)))) return foldNested(input, arms, recOf);
      const chain = arms.every((a) => recOf(a).length <= 1);
      const step = temp("step"), s = temp("s"), rs = temp("rs");
      const cases = arms.map((a) => {
        const rec = recOf(a).map((i, k) => `\nconst ${local(a.results[i]!)} = ${chain ? rs : `${rs}[${k}]`};`).join("");
        return `case ${tag(a.variant)}: {${binds(a, s)}${rec}\n${ret(a.body)}\n}`;
      });
      const recursive = arms.filter((a) => recOf(a).length);
      const fn = `const ${step} = (${s}, ${rs}) => {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\n};\n`;
      const v = temp("v"), r = temp("r");
      const fwd = chain ? forward(arms, recOf) : null;
      if (fwd) {
        // Exact Int + or ×, which don't care about order: the items from the
        // front, into an accumulator, with no spine (GAPS.md G15).
        const { end, on, at, step } = fwd, acc = temp("acc"), l = temp("l");
        return `let ${acc} = ${ex(end.body)};\nlet ${l} = ${input};\n` +
          `for (; ${l}.tag === ${tag(on.variant)}; ${l} = ${l}.fields[${at}]) {${binds(on, l)}\n${acc} = ${step(acc)};\n}\nreturn ${acc};`;
      }
      if (chain) {
        const spine = temp("spine"), i = temp("i");
        const next = recursive.map((a) => `${v}.tag === ${tag(a.variant)} ? ${recOf(a)[0]} : `).join("") + "-1";
        const k = temp("k");
        return `${fn}const ${spine} = [];\nlet ${v} = ${input};\n` +
          `for (let ${k} = ${next}; ${k} >= 0; ${k} = ${next}) {\n${spine}.push(${v});\n${v} = ${v}.fields[${k}];\n}\n` +
          `let ${r} = ${step}(${v});\nfor (let ${i} = ${spine}.length - 1; ${i} >= 0; ${i}--) ${r} = ${step}(${spine}[${i}], ${r});\nreturn ${r};`;
      }
      const todo = temp("todo"), top = temp("top"), ix = temp("ix");
      const fields = `{ ${recursive.map((a) => `${tag(a.variant).split(" ")[0]}: [${recOf(a).join(", ")}]`).join(", ")} }`;
      return `${fn}const ${ix} = ${fields};\nconst ${todo} = [{ v: ${input}, i: 0, rs: [] }];\n` +
        `for (;;) {\nconst ${top} = ${todo}[${todo}.length - 1];\nconst ${v} = ${ix}[${top}.v.tag];\n` +
        `if (${v} && ${top}.i < ${v}.length) {\n${todo}.push({ v: ${top}.v.fields[${v}[${top}.i++]], i: 0, rs: [] });\ncontinue;\n}\n` +
        `const ${r} = ${step}(${top}.v, ${top}.rs);\n${todo}.pop();\nif (!${todo}.length) return ${r};\n${todo}[${todo}.length - 1].rs.push(${r});\n}`;
    }

    // A fold over a list held as a JS array (GAPS.md G21): an index loop
    // from the end, or from the front when the step doesn't care about
    // order (G15). No cells and no spine.
    function foldArray(n: NodeOf<"fold">, input: { js: string; kind: Kind }): string {
      const arms = n.arms.map((a) => node<"arm">(a));
      const recOf = (a: NodeOf<"arm">) => a.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      const fwd = forward(arms, recOf), a = temp("a"), x = temp("x"), held = { js: a, kind: input.kind };
      if (fwd && fwd.on.variant === CONS && fwd.at === 1) {
        const acc = temp("acc"), item = fwd.on.binds[0];
        return `let ${acc} = ${ex(fwd.end.body)};\nconst ${a} = ${input.js};\n` +
          `${eachOf(held, x, `${referenced.has(item) ? `const ${local(item)} = ${x};\n` : ""}${acc} = ${fwd.step(acc)};`, "any")}\nreturn ${acc};`;
      }
      const f = foldArms(n);
      return `${f.pre}const ${a} = ${input.js};\n${f.start}\n${eachOf(held, x, f.step(x), "end")}\nreturn ${f.end};`;
    }

    // A fold over `characters(t)`, run on t: the characters from the end,
    // a surrogate pair taken as one, as `characters` splits them. No list.
    function foldText(n: NodeOf<"fold">, input: string): string {
      const f = foldArms(n), i = temp("i");
      const t = temp("t"), j = temp("j");
      return `${f.pre}const ${t} = ${input};\n${f.start}\n` +
        `for (let ${i} = ${t}.length, ${j}; ${i} > 0; ${i} = ${j}) {\n${j} = ${i} - 1;\n` +
        `if (${j} > 0 && (${t}.charCodeAt(${j}) & 0xfc00) === 0xdc00 && (${t}.charCodeAt(${j} - 1) & 0xfc00) === 0xd800) ${j}--;\n` +
        `${f.step(`${t}.slice(${j}, ${i})`)}\n}\nreturn ${f.end};`;
    }

    // A fold over `range(n)`, run on n: the cons arm for n − 1 down to 0,
    // as many as `range` makes (the whole part of n for a Float64, none for
    // NaN or below 1). No list.
    function foldCount(n: NodeOf<"fold">, input: string, int: boolean): string {
      const f = foldArms(n), i = temp("i");
      return `${f.pre}${f.start}\n` +
        `for (let ${i} = ${int ? `Number(${input})` : `Math.floor(${input})`} - 1; ${i} >= 0; ${i}--) ${f.step(i)}\nreturn ${f.end};`;
    }

    // The two arms of a fold over a list as local functions, for the
    // templates that run it on other storage: () for nil, (item, folded
    // rest) for cons. `pre` comes before the loop, `start` runs nil, `step`
    // runs cons on an item, and `end` is the answer.
    // When the answer is a record (a type with one case, such as
    // chapters' `pile`) and the cons arm only reads fields of the folded
    // rest, the fields are carried in separate locals and the record is
    // built once, at the end: the arms set the locals instead of returning
    // a record per item (GAPS.md G13 again).
    function foldArms(n: NodeOf<"fold">): { pre: string; start: string; step: (x: string) => string; end: string } {
      const arm = (v: Id) => n.arms.map((a) => node<"arm">(a)).find((a) => a.variant === v)!;
      const nil = arm(NIL), cons = arm(CONS);
      const ifNil = temp("nil"), ifCons = temp("cons");
      const c = referenced.has(cons.binds[0]) ? local(cons.binds[0]) : temp("c");
      const rest = cons.results[1];
      const variant = recordOf(ty(n.id));
      if (variant && rest && onlyFieldsOf(cons.body, rest)) {
        const rs = node<"variant">(variant).fields.map(() => temp("r"));
        const afters = rs.map(() => temp("after"));
        const leaf = (js: string) => {
          const p = pieces.get(js);
          if (p?.variant === variant) return `${rs.map((r, i) => `${r} = ${p.fields[i]};`).join("\n")}\nreturn;`;
          const t = temp("t");
          return `const ${t} = ${js};\n${rs.map((r, i) => `${r} = ${t}.fields[${i}];`).join("\n")}\nreturn;`;
        };
        const out: Out = { bool: false, leaf };
        splitAt.set(rest, { variant, fields: afters });
        const consFn = `const ${ifCons} = (${[c, ...afters].join(", ")}) => {\n${ret(cons.body, false, out)}\n};\n`;
        return {
          pre: `let ${rs.join(", ")};\nconst ${ifNil} = () => {\n${ret(nil.body, false, out)}\n};\n${consFn}`,
          start: `${ifNil}();`, step: (x) => `${ifCons}(${[x, ...rs].join(", ")});`, end: construct(variant, rs),
        };
      }
      const r = temp("r"), after = rest ? local(rest) : temp("after");
      return {
        pre: `const ${ifNil} = () => {\n${ret(nil.body)}\n};\nconst ${ifCons} = (${c}, ${after}) => {\n${ret(cons.body)}\n};\n`,
        start: `let ${r} = ${ifNil}();`, step: (x) => `${r} = ${ifCons}(${x}, ${r});`, end: r,
      };
    }
    // The case of a type with one case and some fields, not a list.
    function recordOf(t: Type): Id | null {
      const z = sub.zonk(t), d = z.t === "con" ? code.nodes[z.id] : null;
      const td = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
      if (td?.kind !== "typedef" || td.effect || td.variants.length !== 1) return null;
      const v = td.variants[0];
      return v !== CONS && node<"variant">(v).fields.length > 0 ? v : null;
    }
    // Is every use of `b` in `id` a field read?
    function onlyFieldsOf(id: Id, b: Id): boolean {
      const all = subtree(code, id), read = new Set<Id>();
      for (const x of all) {
        const c = code.nodes[x], f = c.kind === "call" && c.args.length === 1 ? code.nodes[c.fn] : null;
        if (c.kind === "call" && f?.kind === "ref" && code.nodes[f.target].kind === "field") read.add(c.args[0]);
      }
      return all.every((x) => !refTo(x, b) || read.has(x));
    }

    function foldNested(input: string, arms: NodeOf<"arm">[], recOf: (a: NodeOf<"arm">) => number[]): string {
      const step = temp("step"), s = temp("s"), rs = temp("rs"), parts = temp("parts");
      const cases = arms.map((a) => {
        const rec = recOf(a).map((i, k) => `\nconst ${local(a.results[i]!)} = ${rs}[${k}];`).join("");
        return `case ${tag(a.variant)}: {${binds(a, s)}${rec}\n${ret(a.body)}\n}`;
      });
      const partCases = arms.filter((a) => recOf(a).length).map((a) => `case ${tag(a.variant)}: return [${recOf(a).map((i) => {
        const shape = nestedShape(a, i);
        return shape ? `$spread(${JSON.stringify(shape)}, ${s}.fields[${i}])` : `$self(${s}.fields[${i}])`;
      }).join(", ")}];`);
      const todo = temp("todo"), top = temp("top"), r = temp("r"), at = temp("at");
      return `const ${step} = (${s}, ${rs}) => {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\n};\n` +
        `const ${parts} = (${s}) => {\nswitch (${s}.tag) {\n${partCases.join("\n")}\ndefault: return [];\n}\n};\n` +
        `const ${todo} = [{ v: ${input}, ps: null, kids: null, i: 0, rs: [] }];\n` +
        `for (;;) {\nconst ${top} = ${todo}[${todo}.length - 1];\n` +
        `if (!${top}.ps) { ${top}.ps = ${parts}(${top}.v); ${top}.kids = ${top}.ps.flatMap((p) => p.children); }\n` +
        `if (${top}.i < ${top}.kids.length) {\n${todo}.push({ v: ${top}.kids[${top}.i++], ps: null, kids: null, i: 0, rs: [] });\ncontinue;\n}\n` +
        `let ${at} = 0;\nconst ${r} = ${step}(${top}.v, ${top}.ps.map((p) => p.rebuild(${top}.rs.slice(${at}, (${at} += p.children.length)))));\n` +
        `${todo}.pop();\nif (!${todo}.length) return ${r};\n${todo}[${todo}.length - 1].rs.push(${r});\n}`;
    }

    // `let x = v`, or just `v;` for the `_` of a sequence.
    function bindLet(p: Id, v: string): string {
      if (referenced.has(p)) return `const ${local(p)} = ${v};\n`;
      return /^[\p{L}\p{N}_$]+$/u.test(v) ? "" : `${v};\n`;
    }

    // ---- expressions with Choice: statements that run `k` once per result
    // Plain code in a search that may run out of fuel: running out there is
    // this branch's failure, as in the evaluator, and the search goes on
    // (COMPILER.md, "Diverge and fuel"). Only in programs with `with fuel`.
    function guarded(id: Id, js: string, k: K): string {
      if (!fueled || !subtree(code, id).some((x) => {
        const c = code.nodes[x];
        if (c.kind !== "call") return false;
        const t = ty(c.fn);
        return t.t === "fn" && (t.eff.effs.includes(DIVERGE) || t.eff.tail !== null);
      })) return k(js);
      const v = temp("v"), d = temp("d");
      return `let ${v};\nconst ${d} = $rec.d;\ntry {\n${v} = ${js};\n} catch (e) {\nif (!$outOfFuel(e)) throw e;\n$rec.d = ${d};\n${v} = $no;\n}\nif (${v} !== $no) {\n${k(v)}\n}`;
    }
    function st(id: Id, k: K): string {
      if (!streamy(id)) return guarded(id, ex(id), k);
      const n = code.nodes[id];
      switch (n.kind) {
        case "call": return stCall(n, k);
        case "match": {
          if (!handlerOf(n)) return stMatch(n, k);
          if (n.arms.some((a) => isLater(node<"arm">(a).variant))) throw notYet("an operation answered later handled around a search");
          const [answers, escapes] = handlerCases(n, true), r = temp("r");
          return `for (const ${r} of $handleS(${JSON.stringify(handlerOf(n))}, ${answers}, ${escapes}, function* () {\n${scoped(false, () => st(n.scrutinee, (v) => `yield ${v};`))}\n})) {\n${k(r)}\n}`;
        }
        case "fold": return stFold(n, k);
        case "solve": {
          return parts(givenOf(n), (vals) => {
            const sol = temp("sol");
            const bs = Object.values(n.binds).map((b, i) => `const ${local(b)} = ${sol}[${i}];`).join(" ");
            const f = solver(n);
            const bound = Object.values(n.binds);
            if (arrayAt?.solve === n.id) { const { d } = arrayAt; return `${d}.length = 0;\nif (${f}$into(${[d, ...vals].join(", ")})) {\nconst ${local(bound[0])} = ${d};\n${st(n.body, k)}\n}`; }
            if (onceSolvers.has(n.id) && bound.length === 1) return `const ${local(bound[0])} = ${f}$one(${vals.join(", ")});\nif (${local(bound[0])} !== $no) {\n${st(n.body, k)}\n}`;
            if (onceSolvers.has(n.id)) return `const ${sol} = ${f}$one(${vals.join(", ")});\nif (${sol} !== $no) {\n${bs}\n${st(n.body, k)}\n}`;
            return `for (const ${sol} of ${f}(${vals.join(", ")})) {\n${bs}\n${st(n.body, k)}\n}`;
          });
        }
        default: throw new Error(`internal: a ${n.kind} with Choice`);
      }
    }

    // Evaluate parts left to right, earlier choices varying slowest (as the
    // evaluator does). A part without Choice that a later part loops over
    // is computed once, before the loop.
    function parts(ids: Id[], k: (vals: string[]) => string, i = 0, acc: string[] = []): string {
      if (i === ids.length) return k(acc);
      const id = ids[i];
      if (streamy(id)) return st(id, (v) => {
        if (/^[\p{L}\p{N}_$]+$/u.test(v)) return parts(ids, k, i + 1, [...acc, v]);
        const t = temp();
        return `const ${t} = ${v};\n${parts(ids, k, i + 1, [...acc, t])}`;
      });
      const kind = code.nodes[id].kind;
      // A let: its bindings as statements, then its body (not a closure).
      const n = code.nodes[id];
      if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") {
        const f = node<"lambda">(n.fn);
        return f.params.map((p, j) => bindLet(p, letArg(p, n.args[j]))).join("") + parts([...ids.slice(0, i), f.body, ...ids.slice(i + 1)], k, i, acc);
      }
      if (kind === "lit" || kind === "ref" || !ids.slice(i + 1).some(streamy)) return parts(ids, k, i + 1, [...acc, ex(id)]);
      const t = temp();
      return `const ${t} = ${ex(id)};\n${parts(ids, k, i + 1, [...acc, t])}`;
    }

    // Run k more than once only if it's short; otherwise loop over a local
    // generator and run k once, after it.
    function fewConstants(id: Id): Id[] | null {
      const items: Id[] = [];
      for (let n = code.nodes[id]; ; n = code.nodes[n.args[1]]) {
        if (n.kind === "ref" && n.target === NIL) return items.length && items.length <= 4 ? items : null;
        if (n.kind !== "call" || !refTo(n.fn, CONS)) return null;
        const x = code.nodes[n.args[0]];
        if (!(x.kind === "lit" || (x.kind === "ref" && code.nodes[x.target]?.kind === "variant" && !node<"variant">(x.target).fields.length))) return null;
        items.push(n.args[0]);
      }
    }
    function branch(k: K, gen: (y: K) => string): string {
      const probe = k("$$");
      if (probe.length < 160) return gen(k);
      const r = temp("r");
      if (cps) {
        // The rest, once, as a local function each branch calls.
        const rest = temp("rest");
        return `const ${rest} = (${r}) => {\n${k(r)}\n};\n${gen((v) => `if (${rest}(${v})) return true;`)}`;
      }
      return `for (const ${r} of (function* () {\n${scoped(false, () => gen((v) => `yield ${v};`))}\n})()) {\n${k(r)}\n}`;
    }

    function stCall(n: NodeOf<"call">, k: K): string {
      const f = code.nodes[n.fn];
      if (f.kind === "lambda") {
        // A let given an array keeps it (GAPS.md G21); making one has no
        // effects, so it can be left out of the order of the others.
        const own = f.params.map((p, i) => { const k = arrayKind(n.args[i], true); return k && fits(p, k) ? letArg(p, n.args[i]) : null; });
        return parts(n.args.filter((_, i) => own[i] === null), (vals) => {
          let j = 0;
          return `${f.params.map((p, i) => bindLet(p, own[i] ?? vals[j++])).join("")}${st(f.body, k)}`;
        });
      }
      if (f.kind === "ref" && code.nodes[f.target].kind === "builtin") {
        const h = f.target;
        if (h === S.fail) return "/* fail */";
        const items = h === S.oneOf ? arraySource(n.args[0]) : null;
        if (items) {
          const x = temp("x");
          return eachOf(items, x, k(x), "list");
        }
        // A few constants written in place (`one of([true, false])`): each
        // in turn, with no list (GAPS.md G12).
        const few = h === S.oneOf ? fewConstants(n.args[0]) : null;
        if (few) return branch(k, (y) => few.map((i) => `{\n${y(ex(i))}\n}`).join("\n"));
        if (h === S.oneOf) return parts(n.args, ([xs]) => {
          const l = temp("l"), x = temp("x");
          return `for (let ${l} = ${xs}; ${l}.tag === ${JSON.stringify(CONS)}; ${l} = ${l}.fields[1]) {\nconst ${x} = ${l}.fields[0];\n${k(x)}\n}`;
        });
        if (h === S.first && callStreams(n)) {
          const body = thunk(n.args[0]), g = thunk(n.args[1]);
          if (body && g) return branch(k, (y) => {
            const L = temp("first");
            if (cps) {
              const got = temp("got");
              return `let ${got} = $no;\n(() => {\n${st(body.body, (v) => `${got} = ${v};\nreturn true;`)}\n})();\nif (${got} !== $no) {\n${y(got)}\n} else {\n${st(g.body, y)}\n}`;
            }
            return `${L}: {\n${scoped(false, () => st(body.body, (v) => `${y(v)}\nbreak ${L};`))}\n${st(g.body, y)}\n}`;
          });
        }
        if (h === S.seeded && callStreams(n)) return parts(n.args, ([seed, body]) => {
          const r = temp("r");
          return `for (const ${r} of $seededS(${seed}, ${body})) {\n${k(r)}\n}`;
        });
        if (h === S.fuel) return parts(n.args, ([fuel, body]) => {
          const r = temp("r");
          return `for (const ${r} of $fuel(${fuel}, ${body}, ${streamsFn(ty(n.args[1]), rho)})) {\n${k(r)}\n}`;
        });
      }
      const target = f.kind === "ref" ? f.target : null;
      const kind = target ? code.nodes[target].kind : null;
      const callee = kind === "def" ? defCall(n) : null;
      const params = callee && isFnDef(callee.def) ? node<"lambda">(node<"def">(callee.def).body!).params : [];
      const own = n.args.map((a, i) => (callee?.arr.has(params[i]) ? arrArg(a, callee.arr.get(params[i])!) : null));
      return parts([n.fn, ...n.args.filter((_, i) => own[i] === null)], ([fn, ...rest]) => {
        let j = 0;
        const args = own.map((o, i) => o ?? (boolParams.has(params[i]) ? `(${rest[j++]}.tag === ${JSON.stringify(TRUE)})` : rest[j++]));
        let c: string;
        if (callee) c = callee.bool ? `$bool(${callee.name}(${args.join(", ")}))` : `${callee.name}(${args.join(", ")})`;
        else if (kind === "variant") c = effectOf(target!) ? perform(target!, args) : construct(target!, args);
        else if (kind === "field") c = field(args[0], target!);
        else if (target === COMPARE) c = `$ORDER[${orderJs(n.args[0], args)} + 1]`;
        else if (kind === "builtin" && INLINE[target!]) {
          const js = INLINE[target!].js(INLINE[target!]?.boolArgs ? args.map((a) => `(${a}.tag === ${JSON.stringify(TRUE)})`) : args);
          c = INLINE[target!].bool ? `$bool(${js})` : js;
        } else if (target === S.equal) c = `$bool(${equalJs(n.args[0], args)})`;
        else if (target === S.derivative) c = `$derivative($program, ${args[0]}, ${streamsFn(ty(n.id), rho)})`;
        else if (target === S.gradient) c = `$derivative($program, ${args[0]}, ${streamsFn(ty(n.id), rho)}, ${JSON.stringify(S.gradient)})`;
        else if (target === S.exists) c = `$exists($program, ${args[0]})`;
        else if (target === SET) c = setCall(n.args[0], args[1], args[2]);
        else if (target === CELL_OPS.path) c = pathCall(n.args[0]);
        else if (kind === "builtin" && (oneOf(target!) ?? implOf(target!))) c = `${oneOf(target!) ?? implOf(target!)}(${args.join(", ")})`;
        else c = `${fn}(${args.join(", ")})`;
        let out: string;
        if (callStreams(n)) {
          const r = temp("r");
          const rec = callee?.single ? unpackOf(callee) : null;
          if (callee && rec) {
            const viaF = spec(callee.def, callee.rho, callee.plain, false, callee.arr, callee.own, true, null, callee.lat, keyAt(callee));
            out = `if (${viaF.name}(${args.join(", ")})) {\n${fromGot(rec, r, k)}\n}`;
          } else if (callee?.single || (kind === "builtin" && oneOf(target!))) out = `const ${r} = ${c};\nif (${r} !== $no) {\n${k(r)}\n}`;
          else if (callee?.sus) {
            // A search that waits: its waits go on to whoever answers them,
            // and the answer comes back in.
            if (!gen) throw notYet(`${names[callee.def] ?? callee.def} has Choice and waits, called where nothing can wait`);
            const g = temp("g"), s = temp("s"), a = temp("a");
            out = `{\nconst ${g} = ${c};\nlet ${a};\nfor (let ${s} = ${g}.next(); !${s}.done; ${s} = ${g}.next(${a})) {\n${a} = undefined;\nif ($isLater(${s}.value)) {\n${a} = yield ${s}.value;\ncontinue;\n}\nconst ${r} = ${s}.value;\n${k(r)}\n}\n}`;
          } else if (callee && cps) {
            const viaK = spec(callee.def, callee.rho, callee.plain, true, callee.arr, false, false, null, callee.lat, keyAt(callee)), rec = unpackOf(viaK);
            out = `if (${viaK.name}(${[...args, rec ? unpacked(rec, r, k) : `(${r}) => {\n${k(r)}\n}`].join(", ")})) return true;`;
          } else out = `for (const ${r} of ${c}) {\n${k(r)}\n}`;
        } else out = guarded(n.id, c, k);
        // Out of fuel: this call has no result, the others carry on.
        return target && spends(target) ? `if ($spend()) {\n${out}\n}` : out;
      });
    }

    function stMatch(n: NodeOf<"match">, k: K): string {
      return parts([n.scrutinee], ([s]) => {
        // A record that arrived as its fields: the one arm that can match,
        // bound straight from them.
        const p = pieces.get(s), arm = p && n.arms.map((a) => node<"arm">(a)).find((a) => a.variant === p.variant);
        if (p && arm && /^[\p{L}\p{N}_$]+$/u.test(s)) return `{${arm.binds.map((b, i) => (referenced.has(b) ? `\nconst ${local(b)} = ${p.fields[i]};` : "")).join("")}\n${st(arm.body, k)}\n}`;
        return stMatchCases(n, k, s);
      });
    }
    function stMatchCases(n: NodeOf<"match">, k: K, s: string): string {
      return branch(k, (y) => {
        if (isBoolMatch(n)) {
          const [t, e] = boolArms(n);
          const sc = code.nodes[n.scrutinee];
          const c = (sc.kind === "call" && !streamy(n.scrutinee)) || (sc.kind === "ref" && boolParams.has(sc.target)) ? exBool(n.scrutinee) : `(${s}.tag === ${JSON.stringify(TRUE)})`;
          return `if (${c}) {\n${st(t, y)}\n} else {\n${st(e, y)}\n}`;
        }
        const v = temp("s");
        const cases = n.arms.map((a) => node<"arm">(a)).map((a) => `case ${tag(a.variant)}: {${binds(a, v)}\n${st(a.body, y)}\nbreak;\n}`);
        if (n.otherwise) cases.push(`default: {\n${st(n.otherwise, y)}\n}`);
        return `{\nconst ${v} = ${s};\nswitch (${v}.tag) {\n${cases.join("\n")}\n}\n}`;
      });
    }

    // A fold with Choice: a local generator; each combination of the
    // children's results is a separate branch.
    function stFold(n: NodeOf<"fold">, k: K): string {
      const f = temp("fold"), s = temp("s");
      const nested = n.arms.some((id) => { const a = node<"arm">(id); return a.results.some((r, i) => r && nestedShape(a, i)); });
      if (cps && !nested) {
        // A local search in the same style: each child's results as a
        // closure, the fold's own answers to `kf`.
        const kf = temp("k");
        const cases = n.arms.map((id) => {
          const a = node<"arm">(id);
          let inner = st(a.body, (v) => `if (${kf}(${v})) return true;`);
          for (let i = a.results.length - 1; i >= 0; i--) {
            const r = a.results[i];
            if (r) inner = `if (${f}(${s}.fields[${i}], (${local(r)}) => {\n${inner}\n})) return true;`;
          }
          return `case ${tag(a.variant)}: {${binds(a, s)}\n${inner}\nbreak;\n}`;
        });
        const r = temp("r");
        return `const ${f} = (${s}, ${kf}) => {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\nreturn false;\n};\n` +
          parts([n.scrutinee], ([v]) => `if (${f}(${v}, (${r}) => {\n${k(r)}\n})) return true;`);
      }
      return stFoldGen(n, k, f, s);
    }
    function stFoldGen(n: NodeOf<"fold">, k: K, f: string, s: string): string {
      const cases = n.arms.map((id) => {
        const a = node<"arm">(id);
        let inner = scoped(false, () => st(a.body, (v) => `yield ${v};`));
        for (let i = a.results.length - 1; i >= 0; i--) {
          const r = a.results[i];
          const shape = r ? nestedShape(a, i) : null;
          if (r) inner = `for (const ${local(r)} of ${shape ? `$foldNested(${f}, $spread(${JSON.stringify(shape)}, ${s}.fields[${i}]))` : `${f}(${s}.fields[${i}])`}) {\n${inner}\n}`;
        }
        return `case ${tag(a.variant)}: {${binds(a, s)}\n${inner}\nbreak;\n}`;
      });
      const r = temp("r");
      return `const ${f} = function* (${s}) {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\n};\n` +
        parts([n.scrutinee], ([v]) => `for (const ${r} of ${f}(${v})) {\n${k(r)}\n}`);
    }

    // ---- the definition itself
    const b = d.body!;
    const header = `// ${names[sp.def] ?? sp.def}${sp.rho.size && [...sp.rho.values()].some(Boolean) ? " (called with a Choice function)" : ""}`;
    if (isFnDef(sp.def)) {
      const lam = node<"lambda">(b);
      const ps = paramNames(sp).join(", ");
      const meta = reflective ? `\n$meta(${sp.name}, ${JSON.stringify(b)});` : "";
      if (sp.out) {
        const rec = unpackOf(sp)!;
        const leaf = (v: string) => {
          const { pre, fields } = fieldsFor(rec, v);
          const gs = fields.map(() => temp("g"));
          return `${pre}const ${gs.map((g, i) => `${g} = ${fields[i]}`).join(", ")};\n${gs.map((g, i) => `$got[${i}] = ${g};`).join("\n")}\nreturn true;`;
        };
        return `${header} (its ${names[rec] ?? "answer"}'s fields in \`$got\`)\nfunction ${sp.name}(${ps}) {\n${st(lam.body, leaf)}\nreturn false;\n}`;
      }
      if (sp.single) return `${header}\nfunction ${sp.name}(${ps}) {\n${st(lam.body, (v) => `return ${v};`)}\nreturn $no;\n}${meta}`;
      if (sp.cps) {
        const k = temp("k");
        const rec = unpackOf(sp);
        const leaf = (v: string) => {
          if (!rec) return `if (${k}(${v})) return true;`;
          const { pre, fields } = fieldsFor(rec, v);
          return `${pre}if (${k}(${fields.join(", ")})) return true;`;
        };
        return `${header} (the rest of the search as \`${k}\`${rec ? `, given the fields of each ${names[rec] ?? "answer"}` : ""})\nfunction ${sp.name}(${[...paramNames(sp), k].join(", ")}) {\n${scoped(true, () => st(lam.body, leaf))}\nreturn false;\n}`;
      }
      if (sp.streams && sp.sus) {
        const js = `function* ${sp.name}(${ps}) {\n${inGen(true, () => st(lam.body, (v) => `yield ${v};`))}\n}`;
        try { new Function(`"use strict";\n${js}`); } catch { throw notYet(`${names[sp.def] ?? sp.def} has Choice and waits on an operation answered later inside a function it makes`); }
        return `${header} (a generator of its answers and its waits)\n${js}`;
      }
      if (sp.streams) return `${header}\nfunction* ${sp.name}(${ps}) {\n${st(lam.body, (v) => `yield ${v};`)}\n}${meta}`;
      if (sp.into) {
        // Its list pushed onto `d` (P4); a record's other field returned.
        jumps = false;
        holes = null;
        const d = temp("d"), { rec } = sp.into;
        const stmts = ret(lam.body, true, intoOut(d, sp.into));
        const what = rec ? `its ${names[rec] ?? "record"}'s list pushed onto \`${d}\`, the other field returned` : `its list pushed onto \`${d}\``;
        if (!jumps) return `${header} (${what})\nfunction ${sp.name}(${[d, ...paramNames(sp)].join(", ")}) {\n${stmts}\n}`;
        const ins = paramNames(sp).map((p) => `${p}$in`);
        const fresh = lam.params.length ? `const ${paramNames(sp).map((p) => `${p} = ${p}$in`).join(", ")};\n` : "";
        return `${header} (${what})\nfunction ${sp.name}(${[d, ...ins].join(", ")}) {\nfor (;;) {\n${fresh}${stmts}\n}\n}`;
      }
      // A definition that fills holes returns the first cell it made, kept
      // in a field of a cell made up for it; every other answer goes into
      // the last hole.
      const write = (name: string, star: string) => {
        jumps = false;
        holes = null;
        let start = "";
        let out = sp.bool ? RETURN_BOOL : RETURN;
        if (!sp.bool && fillsHoles(lam.body)) {
          const top = temp("top");
          holes = { at: temp("at"), i: temp("i") };
          start = `const ${top} = { fields: [undefined] };\nlet ${holes.at} = ${top}, ${holes.i} = 0;\n`;
          const { at, i } = holes;
          out = { bool: false, leaf: (js) => `${at}.fields[${i}] = ${js};\nreturn ${top}.fields[0];` };
        }
        const stmts = ret(lam.body, true, out);
        // Self tail calls jump: the parameters become the loop's inputs, and
        // each pass binds them afresh, so a function made in one pass keeps
        // that pass's values.
        if (jumps) {
          const ins = paramNames(sp).map((p) => `${p}$in`).join(", ");
          const fresh = lam.params.length ? `const ${paramNames(sp).map((p) => `${p} = ${p}$in`).join(", ")};\n` : "";
          return `function${star} ${name}(${ins}) {\n${start}for (;;) {\n${fresh}${stmts}\n}\n}`;
        }
        return `function${star} ${name}(${ps}) {\n${stmts}\n}`;
      };
      if (sp.sus) {
        // Its one copy, a generator (`isLater`); a mistake in what it
        // writes would be a syntax error here, not in the program.
        const js = inGen(true, () => write(sp.name, "*"));
        try { new Function(`"use strict";\n${js}`); } catch { throw notYet(`${names[sp.def] ?? sp.def} waits on an operation answered later inside a function it makes`); }
        return `${header} (a generator: it may wait on an operation answered later)\n${js}${meta}`;
      }
      const direct = write(sp.name, "");
      const deep = !reflective && cycles(sp.def, sp.def) ? heapCopy(sp, () => write(`${sp.name}$h`, "*")) : null;
      if (!deep) return `${header}\n${direct}${meta}`;
      // Past DEPTH calls of copies like this one, the call runs its heap
      // copy instead, whose calls in the cycle are steps of $drive's loop.
      return `${header} (past ${DEPTH} calls deep, its copy on the heap)\nfunction ${sp.name}(${ps}) {\nif ($rec.d > ${DEPTH}) return $drive(${sp.name}$h(${ps}));\n$rec.d++;\nconst r$ = ${sp.name}$b(${ps});\n$rec.d--;\nreturn r$;\n}\n${direct.replace(`function ${sp.name}(`, `function ${sp.name}$b(`)}\n${deep}${meta}`;
    }
    const cell = temp("value");
    return `${header}\nlet ${cell};\nfunction ${sp.name}() {\nreturn ${cell} ??= ${ex(b)};\n}`;
  }

  // ---- the module
  const out: string[] = [];
  const exported: string[] = [];
  for (const name of opts.exports) {
    // The program's own first: it comes after the modules (load.ts base),
    // and may use a name a module also uses (plus, minus).
    const def = code.defs.findLast((d) => names[d] === name);
    if (!def) throw new Error(`no definition named ${name}`);
    exported.push(`  ${JSON.stringify(name)}: ${asValue(spec(def, new Map()))},`);
  }
  const made: [Spec, string][] = [];
  for (let s; (s = queue.shift());) made.push([s, body(s)]);
  // Asking which copy a call needs makes that copy, so a search that is only
  // ever called through its `$k` copy also has a generator nobody uses.
  // Keep what the exports reach.
  const uses = (js: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}_$])${name.replace(/\$/g, "\\$")}(?![\\p{L}\\p{N}_$])`, "u").test(js);
  const keep = new Set<string>();
  const reach = (js: string) => {
    js = js.replace(/\/\/[^\n]*|\/\*.*?\*\//g, "");
    for (const [s, b] of made) if (!keep.has(s.name) && uses(js, s.name)) { keep.add(s.name); reach(b); }
  };
  reach(exported.join("\n") + solverCode.join("\n") + constants.join("\n"));
  // A copy in a cycle with no heap copy of its own: called from the heap
  // as it is.
  for (const [s, b] of made) if (keep.has(s.name)) out.push(heapCalled.has(s.name) && !heapCopies.has(s.name) ? `${b}\nfunction* ${s.name}$h(...a) {\nreturn ${s.name}(...a);\n}` : b);

  const helpers = ["$isLater", "$no", "$stream0", "$showAny", "$compare", "$int", "$text", "$impl", "$many", "$partial", "$setPath", "$T", "$F", "$unit", "$nil", "$cons", "$bool", "$toList", "$snoc", "$fromBack", "$range", "$eq", "$show", "$mod", "$fin", "$div", "$sqrt", "$log", "$pow", "$mapParts", "$zipParts", "$total", "$first", "$firstS",
    "$all", "$count", "$oneOf", "$fail", "$lift", "$one", "$hole", "$fuel", "$enter", "$caught", "$leave", "$spend", "$spendOrThrow", "$outOfFuel", "$ok", "$clean", "$key",
    "$close", "$near", "$sameNumber", "$planned", "$solveRuntime", "$print", "$FN", "$perform", "$handle", "$handleS", "$io", "$seeded", "$seededS", "$optional", "$cells", "$listArrays", "$path", "$spread", "$self", "$foldNested", "$drive", "$rec", "$pushList", "$withInto", "$intoArray", "$later", "$handleL", "$handleLG",
    "$ORDER", "$compareN", "$numberOrder", "$intOrder", "$textOrder",
    ...(reflective ? ["$loadProgram", "$meta", "$prim", "$toEval", "$relate", "$derivative", "$exists"] : [])];
  const orders = [...orderFns.values()].flatMap((e) => (e.js && e.name ? [e.js] : []));
  // The interpreter's copy of the program, and which definitions spend fuel.
  const program = reflective ? [`const $program = $loadProgram(${JSON.stringify(reflected(code))}, ${JSON.stringify([...info.divergent])});`] : [];
  return indent([
    `// Generated by compiler/src/compile.ts from a typed program. Do not edit.`,
    opts.link === "global" ? `const { ${helpers.join(", ")} } = ${opts.runtime};` : `import { ${helpers.join(", ")} } from ${JSON.stringify(opts.runtime)};`,
    ``,
    ...program,
    // Only when the code kept shows a case: a library function that does
    // (the html module's px) isn't a reason when nothing calls it.
    ...orders,
    ...([...out, ...exported, ...solverCode, ...constants, ...orders].some((b) => /\$order(?![\w$])/.test(b)) ? [`const $order = new Map(${JSON.stringify(Object.values(code.nodes).flatMap((n) => (n.kind === "typedef" ? n.variants.map((v, i) => [v, i]) : [])))});`] : []),
    ...([...out, ...exported, ...solverCode, ...constants].some((b) => b.includes("$showAny(")) ? [`const $names = ${JSON.stringify(Object.fromEntries(Object.values(code.nodes).filter((n) => n.kind === "variant" && names[n.id] !== undefined).map((n) => [n.id, names[n.id]])))};`] : []),
    ...solverCode,
    ...constants,
    ``,
    out.join("\n\n"),
    ``,
    `${opts.link === "global" ? "" : "export "}const defs = {\n${exported.join("\n")}\n};`,
    ``,
  ].join("\n"));
}

// Indent by brackets, so the output is readable: one level for each line
// that leaves brackets open, however many it opens.
function indent(src: string): string {
  // How many brackets each open level holds.
  const open: number[] = [];
  const close = () => { if (open.length && --open[open.length - 1] === 0) open.pop(); };
  return src.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return "";
    // Brackets in text and comments don't count.
    const code = t.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\*.*?\*\/|\/\/.*$/g, "");
    // A line that starts by closing brackets lines up with the line that
    // opened them, even when it doesn't close all of them.
    let i = 0, partly = false;
    for (; i < code.length && /[})\]\s]/.test(code[i]); i++) if (code[i] !== " ") { const n = open.length; close(); partly = open.length === n; }
    const out = "  ".repeat(open.length - (partly ? 1 : 0)) + t;
    let opened = 0;
    for (; i < code.length; i++) {
      if ("{([".includes(code[i])) opened++;
      else if ("})]".includes(code[i])) { if (opened) opened--; else close(); }
    }
    if (opened) open.push(opened);
    return out;
  }).join("\n");
}

// How many calls of definitions with a heap copy run on JavaScript's own
// stack before the heap copies take over (C21): well under the stack's
// size with the other calls between them.
const DEPTH = 1000;

const RESERVED = new Set(("break case catch class const continue debugger default delete do else export extends false finally for function if " +
  "import in instanceof new null return super switch this throw true try typeof var void while with yield let static enum await implements " +
  "package protected interface private public arguments eval undefined NaN Infinity Math Object Array Number String Symbol defs").split(" "));

// The interpreter's copy of a program: the core (std and the prelude's
// builtins), the program's own definitions, and what they reach by name,
// type or case. A library module's definitions nothing uses stay out
// (the trees for Map and Set, the html module's).
function reflected(code: Code): Code {
  const modules = new Set(MODULES.flatMap((m) => m.code.defs));
  const owner = new Map<Id, Id>();
  for (const d of code.defs) {
    const td = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""];
    if (td?.kind === "typedef") for (const v of td.variants) { owner.set(v, d); for (const f of (code.nodes[v] as NodeOf<"variant">).fields) owner.set(f, d); }
  }
  const seen = new Set<Id>();
  const todo = [...Object.keys(CORE.nodes), ...code.defs.filter((d) => !modules.has(d))];
  for (let id; (id = todo.pop()) !== undefined;) {
    if (seen.has(id) || !code.nodes[id]) continue;
    seen.add(id);
    const n = code.nodes[id];
    todo.push(...pointsAt(n));
    const o = owner.get(id);
    if (o) todo.push(o);
  }
  return { nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => seen.has(id))), defs: code.defs.filter((d) => seen.has(d)) };
}

