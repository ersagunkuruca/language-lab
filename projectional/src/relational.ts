// Networks: functions without a direction, solved by the relation solver in
// ../../invertible. A network's parts are builtins, relations (polar, ...)
// or other defs, wired by binder ids. Which external ports are known is not
// part of the code; it's chosen per use, and the solver derives the program
// for that choice. Inverting a function means choosing different ports.

import { analyze, defineRelation, evaluate as solveRelation, examples } from "../../invertible/src/index.js";
import { call, num, v } from "../../invertible/src/expr.js";
import type { Code, Id, Node } from "./model.ts";
import { freshId, get } from "./model.ts";
import type { Names } from "./presentation.ts";
import { B, impl } from "./prelude.ts";

type Expr = ReturnType<typeof v> | ReturnType<typeof num> | ReturnType<typeof call>;
interface Relation { name: string; ports: string[]; eqs: unknown[]; vars: string[] }
const define = defineRelation as unknown as (spec: { name: string; ports: string[]; eqs?: unknown[]; laws?: unknown[]; uses?: unknown[] }) => Relation;

// Relations from the invertible prototype, exposed as builtins.
export const RELATIONS = {
  polar: examples.polar,
  sumDiff: examples.sumDiff,
  ohm: examples.ohm,
} as Record<string, Relation>;

export const R = Object.fromEntries(Object.keys(RELATIONS).map((op) => [op, `builtin.${op}`])) as Record<string, Id>;

export const relationPrelude: Code = {
  nodes: Object.fromEntries(Object.keys(RELATIONS).map((op) => [R[op], { id: R[op], kind: "builtin", op } as Node])),
  defs: [],
};

// Port labels are presentation too: `<fn>#<port>` in a names table.
export const relationNames: Names = {
  [R.polar]: "polar",
  [`${R.polar}#r`]: "length",
  [`${R.polar}#θ`]: "angle",
  [R.sumDiff]: "sum & difference",
  [`${R.sumDiff}#c`]: "a + b",
  [`${R.sumDiff}#d`]: "a − b",
  [R.ohm]: "Ohm's law",
};

const isOp = (op: string): op is keyof typeof impl => op in impl;

// The ports a part gets when it uses `fn`. Keys are what `part.bind` uses.
export function portsOf(code: Code, fn: Id | null): string[] {
  if (fn === null) return ["out"];
  const t = code.nodes[fn];
  if (t.kind === "builtin") {
    if (isOp(t.op)) return [...Array.from({ length: impl[t.op].length }, (_, i) => String(i)), "out"];
    return RELATIONS[t.op]?.ports ?? [];
  }
  if (t.kind === "def" && t.body) {
    const b = code.nodes[t.body];
    if (b.kind === "lambda") return [...b.params, "out"];
    if (b.kind === "network") return [...b.params];
  }
  return [];
}

// Display label for one port: names table first, then sensible defaults.
export function portLabel(code: Code, names: Names, fn: Id | null, key: string): string {
  if (fn && names[`${fn}#${key}`] !== undefined) return names[`${fn}#${key}`];
  if (key === "out") return "=";
  if (/^\d+$/.test(key)) {
    const n = fn ? portsOf(code, fn).length - 1 : 0;
    return n === 1 ? "x" : "abcdefgh"[+key];
  }
  return names[key] ?? key;
}

// ---------------------------------------------------------------- compiling

// An expression tree in the core becomes an expression tree for the solver.
// Calls to other defs are inlined, so their insides can be inverted too.
export function toSolverExpr(code: Code, id: Id, env: Map<Id, Expr> = new Map()): Expr {
  const n = code.nodes[id];
  switch (n.kind) {
    case "lit":
      if (typeof n.value !== "number") throw new Error("only numbers can be solved for");
      return num(n.value);
    case "ref": {
      const t = code.nodes[n.target];
      if (t.kind === "binder") return env.get(n.target) ?? v(n.target);
      if (t.kind === "def" && t.body && code.nodes[t.body].kind !== "lambda") return toSolverExpr(code, t.body);
      throw new Error("functions as values can't be solved for");
    }
    case "call": {
      const fn = code.nodes[n.fn];
      const args = n.args.map((a) => toSolverExpr(code, a, env));
      const target = fn.kind === "ref" ? code.nodes[fn.target] : fn;
      if (target.kind === "builtin" && isOp(target.op)) return call(target.op, ...args);
      const lam = target.kind === "lambda" ? target : target.kind === "def" && target.body ? code.nodes[target.body] : null;
      if (lam?.kind === "lambda") {
        const inner = new Map(env);
        lam.params.forEach((p, i) => inner.set(p, args[i]));
        return toSolverExpr(code, lam.body, inner);
      }
      throw new Error("this call can't be turned into an equation");
    }
    case "hole": throw new Error("the network has a hole");
    default: throw new Error(`can't solve through a ${n.kind}`);
  }
}

const cache = new WeakMap<Code, Map<string, Relation>>();

function defRelation(code: Code, defId: Id): Relation {
  const def = get(code, defId, "def");
  const body = def.body ? code.nodes[def.body] : null;
  if (body?.kind === "network") return networkRelation(code, defId);
  if (body?.kind === "lambda") {
    let c = cache.get(code);
    if (!c) cache.set(code, (c = new Map()));
    const hit = c.get(defId);
    if (hit) return hit;
    const rel = define({ name: defId, ports: [...body.params, "out"], eqs: [{ lhs: v("out"), rhs: toSolverExpr(code, body.body) }] });
    c.set(defId, rel);
    return rel;
  }
  throw new Error("an extern has no equations");
}

// The whole network as one relation over its external ports. `without`
// leaves one part out, which is how a part's port directions are found.
export function networkRelation(code: Code, defId: Id, without?: Id): Relation {
  const net = get(code, get(code, defId, "def").body!, "network");
  const eqs: { lhs: Expr; rhs: Expr }[] = [];
  const uses: { rel: Relation; bind: Record<string, string> }[] = [];
  for (const pid of net.parts) {
    if (pid === without) continue;
    const part = get(code, pid, "part");
    const w = (key: string) => part.bind[key] ?? `${pid}:${key}`;
    if (part.fn === null) {
      eqs.push({ lhs: v(w("out")), rhs: num(part.value ?? 0) });
      continue;
    }
    const t = code.nodes[part.fn];
    if (t.kind === "builtin" && isOp(t.op)) {
      const n = impl[t.op].length;
      eqs.push({ lhs: v(w("out")), rhs: call(t.op, ...Array.from({ length: n }, (_, i) => v(w(String(i))))) });
      continue;
    }
    const rel = t.kind === "builtin" ? RELATIONS[t.op] : defRelation(code, part.fn);
    if (!rel) throw new Error(`no relation for ${part.fn}`);
    uses.push({ rel, bind: Object.fromEntries(rel.ports.map((p: string) => [p, w(p)])) });
  }
  return define({ name: defId, ports: net.params, eqs, uses });
}

// ---------------------------------------------------------------- solving

export interface PortDirection { [port: string]: "in" | "out" | "free" }

export function analyzeNetwork(code: Code, defId: Id, known: Id[]) {
  return analyze(networkRelation(code, defId), known);
}

// The solver tears nonlinear blocks and searches them itself; only when it
// falls back to Newton's method does that find one root from one starting
// point, and a bad start (sqrt of a negative) finds none. Trying a few
// seeded random starts and pooling what they find is crude but recovers most
// cases, sometimes with more than one root.
function* starts(vars: string[], count = 40) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 20 - 10;
  yield Object.fromEntries(vars.map((x) => [x, 1]));
  for (let i = 0; i < count; i++) yield Object.fromEntries(vars.map((x) => [x, rnd()]));
}

export function solveNetwork(code: Code, defId: Id, values: Record<Id, number>) {
  const rel = networkRelation(code, defId);
  const first = solveRelation(rel, values, { window: 1 });
  if (first.status !== "solved" || !first.steps.some((s: { kind: string }) => s.kind === "newton")) return first;
  const seen = new Set<string>();
  const solutions: typeof first.solutions = [];
  for (const guess of starts(rel.vars)) {
    for (const sol of solveRelation(rel, values, { window: 1, guess }).solutions) {
      const key = Object.values(sol.values).map((x) => Math.round((x as number) * 1e8)).join();
      if (!seen.has(key)) { seen.add(key); solutions.push(sol); }
    }
  }
  return { ...first, solutions, canonical: solutions[0]?.values ?? null };
}

// For each part, which of its ports carry values the rest of the network
// already determines (inputs) and which it has to produce (outputs). This is
// what the user sees flip when they change which outer ports are known.
export function partDirections(code: Code, defId: Id, known: Id[]): Record<Id, PortDirection> {
  const net = get(code, get(code, defId, "def").body!, "network");
  const out: Record<Id, PortDirection> = {};
  for (const pid of net.parts) {
    const part = get(code, pid, "part");
    let determined = new Set<string>(known);
    try {
      const rel = networkRelation(code, defId, pid);
      const a = analyze(rel, known);
      determined = new Set([...known, ...rel.vars.filter((x: string) => !a.plan.unknown.includes(x))]);
    } catch {}
    out[pid] = Object.fromEntries(portsOf(code, part.fn).map((k) => {
      const wire = part.bind[k];
      return [k, !wire ? "free" : determined.has(wire) ? "in" : "out"];
    }));
  }
  return out;
}

// ---------------------------------------------------------------- converting

// Rewrite an expression def as a network with the same meaning: calls become
// parts (keeping their ids, so names and comments stay attached), each
// intermediate value becomes a wire, and the result becomes an extra port.
export function toNetwork(code: Code, defId: Id, resultName = "result"): { code: Code; names: Names } {
  const def = get(code, defId, "def");
  const lam = get(code, def.body!, "lambda");
  const nodes: Record<Id, Node> = { ...code.nodes };
  const names: Names = {};
  const wires: Id[] = [];
  const parts: Id[] = [];
  const alias = new Map<Id, Id>();
  const result = freshId();
  nodes[result] = { id: result, kind: "binder" };
  names[result] = resultName;

  const newWire = (): Id => {
    const id = freshId();
    nodes[id] = { id, kind: "binder" };
    wires.push(id);
    return id;
  };

  // Returns the wire carrying expression `id`'s value. `into` asks for the
  // value to land on a specific wire (used for the result).
  const wire = (id: Id, into?: Id): Id => {
    const n = code.nodes[id];
    if (n.kind === "ref" && code.nodes[n.target].kind === "binder" && !into) return alias.get(n.target) ?? n.target;
    if (n.kind === "lit" && typeof n.value === "number") {
      const out = into ?? newWire();
      const pid = freshId();
      nodes[pid] = { id: pid, kind: "part", fn: null, value: n.value, bind: { out } };
      parts.push(pid);
      return out;
    }
    if (n.kind === "call") {
      const fn = code.nodes[n.fn];
      if (fn.kind === "lambda") {
        fn.params.forEach((p, i) => alias.set(p, wire(n.args[i])));
        return wire(fn.body, into);
      }
      if (fn.kind !== "ref") throw new Error("can't convert a computed function");
      const args = n.args.map((a) => wire(a));
      const out = into ?? newWire();
      const keys = portsOf(code, fn.target);
      const bind: Record<string, Id> = { out };
      args.forEach((a, i) => (bind[keys[i]] = a));
      nodes[id] = { id, kind: "part", fn: fn.target, bind };
      parts.push(id);
      return out;
    }
    throw new Error(`can't convert a ${n.kind} into a network`);
  };

  wire(lam.body, result);
  const netId = lam.id;
  nodes[netId] = { id: netId, kind: "network", params: [...lam.params, result], wires, parts };
  return { code: { nodes, defs: code.defs }, names };
}
