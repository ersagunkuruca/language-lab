// Code as equations, for the relation solver in ../../invertible.
//
// There is one kind of function. Some of them can also be read as a system
// of equations, and then the solver can plan a direction for them before
// the program runs (src/lang/solve.ts) and the compiler can write that plan
// out as arithmetic (../../compiler/src/relation.ts). Everything else runs
// backwards through the relational interpreter (relate.ts), which hands the
// same solver whatever arithmetic it meets on the way.
//
// Two shapes read as equations:
//
//   a number     f(x, y) = x·y + 1 is the equation out = x·y + 1, over the
//                ports x, y and out.
//   a predicate  a function returning Bool built from `equal`, `and`,
//                `hence`, lets, `for some` and calls to other predicates. Each `equal` is
//                an equation, `and` collects them, and a `for some` names
//                an unknown that isn't a port. Its ports are its parameters,
//                and solving it means asking for the values that make it
//                true. This is what a network was: an equal is a wire, the
//                unknowns of `for some` are the wires inside, and the
//                parameters are the outer ports.
//
// Calls to other definitions are inlined, so their insides are solved too.

import { defineRelation } from "../../../invertible/src/index.js";
import { call, num, v } from "../../../invertible/src/expr.js";
import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import { ARITH, S, TRUE } from "./std.ts";
import { INT } from "./types.ts";

export type Expr = ReturnType<typeof v> | ReturnType<typeof num> | ReturnType<typeof call>;
export interface Eq { lhs: Expr; rhs: Expr; law?: boolean }
export interface Relation { name: string; ports: string[]; eqs: Eq[]; vars: string[] }
const define = defineRelation as unknown as (spec: { name: string; ports: string[]; eqs?: Eq[]; laws?: Eq[] }) => Relation;

export class NotEquations extends Error {}

// Numeric builtins, by the name the solver knows them under.
// The generic + − · −x solve as Float64's do: on Float64s, which is where
// equations are solved, they are Float64's own.
export const NUMERIC: Record<Id, string> = {
  ...Object.fromEntries(Object.keys(impl).map((op) => [`builtin.${op}`, op])), [S.abs]: "abs",
  [ARITH.add]: "add", [ARITH.sub]: "sub", [ARITH.mul]: "mul", [ARITH.neg]: "neg",
};
const arityOf = (op: string) => (op === "abs" ? 1 : impl[op as keyof typeof impl].length);

// What a variable stands for: an expression for the solver, or (for a let
// of something that isn't a number, like a Bool) the code itself, read
// where it is used. So a dot on any wire leaves the equations as they were.
// A let whose value is never read that way (it prints, say) isn't
// equations at all.
interface Deferred { k: "code"; id: Id; env: Env; used: boolean }
type Binding = Expr | Deferred;
type Env = Map<Id, Binding>;
const isCode = (b: Binding | undefined): b is Deferred => b?.k === "code";
const use = (b: Deferred) => ((b.used = true), b);

const MAX_DEPTH = 32;
interface Ctx { fresh: (hint: Id) => string; depth: number }

const lambdaOf = (code: Code, id: Id): NodeOf<"lambda"> | null => {
  const n = code.nodes[id];
  if (n?.kind === "lambda") return n;
  if (n?.kind === "ref") {
    const t = code.nodes[n.target];
    if (t?.kind === "def" && t.body && code.nodes[t.body]?.kind === "lambda") return code.nodes[t.body] as NodeOf<"lambda">;
  }
  return null;
};
// What a call calls: the code in its function position, after following
// lets (a dot on the wire into a call's function slot).
function head(code: Code, id: Id, env: Env): { id: Id; env: Env } {
  for (let n = code.nodes[id]; n?.kind === "ref"; n = code.nodes[id]) {
    const b = env.get(n.target);
    if (!isCode(b)) break;
    use(b);
    id = b.id;
    env = b.env;
  }
  return { id, env };
}
const targetOf = (code: Code, id: Id, env: Env): Id | null => { const n = code.nodes[head(code, id, env).id]; return n?.kind === "ref" ? n.target : null; };

// A call to a lambda or to a defined function, with its parameters bound to
// the arguments' expressions. A let is the first kind.
function inline(code: Code, n: NodeOf<"call">, env: Env, ctx: Ctx, then: (body: Id, env: Env, ctx: Ctx) => void) {
  const h = head(code, n.fn, env);
  const lam = lambdaOf(code, h.id);
  if (!lam || lam.params.length !== n.args.length) throw new NotEquations("this call isn't arithmetic");
  if (ctx.depth > MAX_DEPTH) throw new NotEquations("recursion doesn't make a finite set of equations");
  const fromDef = code.nodes[h.id].kind === "ref";
  const inner: Env = new Map(fromDef ? [] : h.env);
  const deferred: Deferred[] = [];
  lam.params.forEach((p, i) => {
    try { inner.set(p, numeric(code, n.args[i], env, ctx)); }
    catch (e) {
      if (!(e instanceof NotEquations) || fromDef) throw e;
      const d: Deferred = { k: "code", id: n.args[i], env, used: false };
      deferred.push(d);
      inner.set(p, d);
    }
  });
  then(lam.body, inner, { ...ctx, depth: ctx.depth + 1 });
  if (deferred.some((d) => !d.used)) throw new NotEquations("this let isn't arithmetic");
}

// A number-valued expression as one solver expression.
export function numeric(code: Code, id: Id, env: Env = new Map(), ctx: Ctx = fresh()): Expr {
  const n = code.nodes[id];
  switch (n?.kind) {
    case "lit":
      if (typeof n.value !== "number") throw new NotEquations("only numbers can be solved for");
      // A whole number makes the generic + − · around it Int's (L38), which
      // the relational interpreter solves in whole numbers; the solver here
      // is Float64's.
      if (n.of === INT) throw new NotEquations("whole numbers are solved by the relational interpreter");
      return num(n.value);
    case "ref": {
      const t = code.nodes[n.target];
      if (t.kind === "binder") {
        const b = env.get(n.target);
        return isCode(b) ? numeric(code, use(b).id, b.env, ctx) : b ?? v(n.target);
      }
      if (t.kind === "def" && t.body && code.nodes[t.body].kind !== "lambda") return numeric(code, t.body, new Map(), ctx);
      throw new NotEquations("a function isn't a number");
    }
    case "call": {
      const op = NUMERIC[targetOf(code, n.fn, env) ?? ""];
      if (op) return call(op, ...n.args.map((a) => numeric(code, a, env, ctx)));
      let out: Expr | null = null;
      inline(code, n, env, ctx, (body, inner, c) => (out = numeric(code, body, inner, c)));
      return out!;
    }
    default: throw new NotEquations(`a ${n?.kind ?? "missing node"} isn't arithmetic`);
  }
}

// A Bool-valued expression as the equations that make it true. `law`: they
// follow from others (the right side of a hence).
export function holds(code: Code, id: Id, env: Env, ctx: Ctx, eqs: Eq[], law = false): void {
  const n = code.nodes[id];
  if (n?.kind === "ref" && n.target === TRUE) return;
  if (n?.kind === "ref" && isCode(env.get(n.target))) { const b = use(env.get(n.target) as Deferred); return holds(code, b.id, b.env, ctx, eqs, law); }
  if (n?.kind !== "call") throw new NotEquations("only equal, and, for some and lets read as equations");
  const f = targetOf(code, n.fn, env);
  if (f === S.and) { for (const a of n.args) holds(code, a, env, ctx, eqs, law); return; }
  if (f === S.hence) { holds(code, n.args[0], env, ctx, eqs, law); holds(code, n.args[1], env, ctx, eqs, true); return; }
  if (f === S.equal) { eqs.push({ lhs: numeric(code, n.args[0], env, ctx), rhs: numeric(code, n.args[1], env, ctx), law }); return; }
  if (f === S.exists) {
    const h = head(code, n.args[0], env);
    const lam = code.nodes[h.id];
    if (lam?.kind !== "lambda") throw new NotEquations("for some needs the function written in place");
    const inner = new Map(h.env);
    for (const p of lam.params) inner.set(p, v(ctx.fresh(p)));
    holds(code, lam.body, inner, ctx, eqs, law);
    return;
  }
  inline(code, n, env, ctx, (body, inner, c) => holds(code, body, inner, c, eqs, law));
}

function fresh(): Ctx {
  let k = 0;
  return { fresh: (hint) => `${hint}.${++k}`, depth: 0 };
}

// A defined function as a relation, if it reads as one. `predicate` says
// which shape: its ports are then its parameters (solving asks for it to be
// true), else its parameters and "out".
export interface DefRelation { rel: Relation; predicate: boolean }

const cache = new WeakMap<Code, Map<Id, DefRelation | NotEquations>>();

export function defRelation(code: Code, defId: Id): DefRelation {
  let c = cache.get(code);
  if (!c) cache.set(code, (c = new Map()));
  if (!c.has(defId)) {
    try { c.set(defId, readDef(code, defId)); } catch (e) { if (e instanceof NotEquations) c.set(defId, e); else throw e; }
  }
  const r = c.get(defId)!;
  if (r instanceof NotEquations) throw r;
  return r;
}

function readDef(code: Code, defId: Id): DefRelation {
  const def = code.nodes[defId];
  const lam = def?.kind === "def" && def.body ? code.nodes[def.body] : null;
  if (lam?.kind !== "lambda") throw new NotEquations("only a function has ports");
  try {
    return { rel: define({ name: defId, ports: [...lam.params, "out"], eqs: [{ lhs: v("out"), rhs: numeric(code, lam.body) }] }), predicate: false };
  } catch (e) {
    if (!(e instanceof NotEquations)) throw e;
  }
  const eqs: Eq[] = [];
  holds(code, lam.body, new Map(), fresh(), eqs);
  const strip = ({ lhs, rhs }: Eq): Eq => ({ lhs, rhs });
  return { rel: define({ name: defId, ports: [...lam.params], eqs: eqs.filter((e) => !e.law).map(strip), laws: eqs.filter((e) => e.law).map(strip) }), predicate: true };
}

// `fn` (a numeric builtin or a definition) as a relation.
export function relationFor(code: Code, fn: Id): DefRelation {
  const t = code.nodes[fn];
  if (t?.kind === "def") return defRelation(code, fn);
  const op = NUMERIC[fn];
  if (!op) throw new NotEquations(`${t?.kind === "builtin" ? t.op : fn} doesn't read as equations`);
  const args = Array.from({ length: arityOf(op) }, (_, i) => String(i));
  return { rel: define({ name: op, ports: [...args, "out"], eqs: [{ lhs: v("out"), rhs: call(op, ...args.map((a) => v(a))) }] }), predicate: false };
}

export const isPredicate = (code: Code, fn: Id) => { try { return relationFor(code, fn).predicate; } catch { return false; } };

// Display label for one port: the names table first, then sensible defaults.
export function portLabel(code: Code, names: Names, fn: Id | null, key: string): string {
  if (fn && names[`${fn}#${key}`] !== undefined) return names[`${fn}#${key}`];
  if (key === "out") return "=";
  // A builtin's ports are numbered; a function's are its parameters' ids,
  // which can be all digits too, so a key that names a node isn't a number.
  if (/^\d+$/.test(key) && !code.nodes[key]) {
    const op = fn ? NUMERIC[fn] : undefined;
    return op && arityOf(op) === 1 ? "x" : "abcdefgh"[+key] ?? `#${key}`;
  }
  return names[key] ?? key;
}
