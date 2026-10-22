// Units as types. Every value in a def has a physical dimension: a vector of
// exponents over base units (m, s, kg, A). Each builtin says how its
// ports' dimensions relate (add: all equal; mul: exponents add; sqrt: halve),
// which gives a system of linear equations over the exponents. Inference is
// solving that system exactly; a type error is the system being
// inconsistent. Ports nothing pins down stay polymorphic.
//
// Units are checked with the types (src/lang/infer.ts reports conflicts as
// type errors), and the editor uses `compatible` to refuse a connection
// before it exists, the same way it refuses a reference to a variable that
// isn't in scope.

import type { Code, Id, Node } from "./model.ts";
import { get } from "./model.ts";

// Angles are plain numbers, as in SI: a radian is a length over a length.
export const BASE = ["m", "s", "kg", "A"] as const;
export type Base = (typeof BASE)[number];
export type Unit = Partial<Record<Base, number>>;
type Vec = number[];

const EPS = 1e-9;
const toVec = (u: Unit): Vec => BASE.map((b) => u[b] ?? 0);
const toUnit = (v: Vec): Unit => Object.fromEntries(BASE.map((b, i) => [b, round(v[i])]).filter(([, e]) => e !== 0));
const round = (x: number) => (Math.abs(x - Math.round(x)) < EPS ? Math.round(x) : Math.round(x * 1e6) / 1e6);

export const unitEq = (a: Unit, b: Unit) => toVec(a).every((x, i) => Math.abs(x - toVec(b)[i]) < EPS);

// Common derived units, for display and for the picker.
export const NAMED: [string, Unit][] = [
  ["N", { kg: 1, m: 1, s: -2 }],
  ["J", { kg: 1, m: 2, s: -2 }],
  ["W", { kg: 1, m: 2, s: -3 }],
  ["V", { kg: 1, m: 2, s: -3, A: -1 }],
  ["Ω", { kg: 1, m: 2, s: -3, A: -2 }],
];

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", ".": "·" };
const sup = (n: number) => (n === 1 ? "" : String(round(n)).split("").map((c) => SUP[c] ?? c).join(""));

export function formatUnit(u: Unit): string {
  const v = toVec(u);
  if (v.every((x) => Math.abs(x) < EPS)) return "1";
  for (const [name, n] of NAMED) if (unitEq(u, n)) return name;
  const num = BASE.filter((_, i) => v[i] > EPS).map((b) => b + sup(v[BASE.indexOf(b)])).join("·");
  const den = BASE.filter((_, i) => v[i] < -EPS).map((b) => b + sup(-v[BASE.indexOf(b)])).join("·");
  return den ? `${num || "1"}/${den}` : num;
}

// ---------------------------------------------------------------- constraints

// sum(coef · U(term)) = rhs, per base dimension. `why` names the node the
// constraint came from, so a conflict can say what it conflicts with.
interface Constraint { terms: [string, number][]; rhs: Vec; why: string; node?: Id }

const ZERO: Vec = BASE.map(() => 0);

function rules(op: string, port: (k: string) => string, why: string, node: Id): Constraint[] {
  const eq = (a: string, b: string): Constraint => ({ terms: [[a, 1], [b, -1]], rhs: ZERO, why, node });
  const is = (a: string, v: Vec): Constraint => ({ terms: [[a, 1]], rhs: v, why, node });
  switch (op) {
    case "add": case "sub": return [eq(port("0"), port("out")), eq(port("1"), port("out"))];
    case "neg": case "abs": return [eq(port("0"), port("out"))];
    case "mul": return [{ terms: [[port("out"), 1], [port("0"), -1], [port("1"), -1]], rhs: ZERO, why, node }];
    case "div": return [{ terms: [[port("out"), 1], [port("0"), -1], [port("1"), 1]], rhs: ZERO, why, node }];
    case "sqrt": return [{ terms: [[port("out"), 2], [port("0"), -1]], rhs: ZERO, why, node }];
    case "pow": return [is(port("1"), ZERO)];
    case "sin": case "cos": case "tan": return [is(port("0"), ZERO), is(port("out"), ZERO)];
    case "atan2": return [eq(port("0"), port("1")), is(port("out"), ZERO)];
    case "exp": case "log": return [is(port("0"), ZERO), is(port("out"), ZERO)];
    // Comparing two numbers: a wire between them, so the same unit.
    case "equal": case "less": return [eq(port("0"), port("1"))];
    default: return [];
  }
}

const unitOf = (n: Node | undefined): Unit | undefined => (n as { unit?: Unit } | undefined)?.unit;

// Constraints for one def. Calls to other defs are inlined under a prefix,
// so a def used twice can take different units each time (it's polymorphic
// in whatever its own body leaves free). Every number-valued expression node
// has a unit; Bool-valued ones (equal, and, for some) just pass constraints
// through.
export function constraints(code: Code, defId: Id, prefix = "", bindings: Map<Id, string> = new Map(), depth = 0): Constraint[] {
  if (depth > 20) return [];
  const out: Constraint[] = [];
  const def = get(code, defId, "def");
  if (!def.body) return out;
  const t = (id: string) => bindings.get(id) ?? prefix + id;
  const same = (a: Id, b: Id, why: string, node: Id) => out.push({ terms: [[t(a), 1], [t(b), -1]], rhs: ZERO, why, node });

  const declare = (id: Id) => {
    const u = unitOf(code.nodes[id]);
    if (u) out.push({ terms: [[t(id), 1]], rhs: toVec(u), why: "declared unit", node: id });
  };
  const paramsOf = (fn: Id): Id[] => {
    const callee = code.nodes[fn];
    const cb = callee?.kind === "def" && callee.body ? code.nodes[callee.body] : null;
    return cb?.kind === "lambda" ? cb.params : [];
  };

  const visit = (id: Id) => {
    const n = code.nodes[id];
    switch (n.kind) {
      // A number written down is a plain number unless it says otherwise
      // (9.81 m/s²). Zero is the one number that is every unit at once.
      case "lit":
        if (unitOf(n)) declare(id);
        else if (typeof n.value === "number" && n.value !== 0) out.push({ terms: [[t(id), 1]], rhs: ZERO, why: "a plain number", node: id });
        return;
      case "ref": {
        const target = code.nodes[n.target];
        if (target.kind === "binder") same(id, n.target, "variable", id);
        return;
      }
      case "lambda": n.params.forEach(declare); visit(n.body); return;
      case "call": {
        const fn = code.nodes[n.fn];
        n.args.forEach(visit);
        const port = (k: string) => (k === "out" ? t(id) : t(n.args[+k]));
        if (fn.kind === "lambda") {
          fn.params.forEach((p, i) => { declare(p); same(p, n.args[i], "let", id); });
          visit(fn.body);
          same(id, fn.body, "let", id);
          return;
        }
        if (fn.kind !== "ref") return;
        const callee = code.nodes[fn.target];
        if (callee.kind === "builtin") { out.push(...rules(callee.op, port, id, id)); return; }
        if (callee.kind === "def") {
          const keys = paramsOf(fn.target);
          out.push(...calleeConstraints(code, fn.target, (k) => (k === "out" ? t(id) : t(n.args[keys.indexOf(k)])), `${prefix}${id}/`, depth));
        }
        return;
      }
      case "match": case "fold": {
        visit(n.scrutinee);
        for (const a of n.arms) {
          const arm = code.nodes[a] as Extract<Node, { kind: "arm" }>;
          visit(arm.body);
          same(id, arm.body, "a case", id);
        }
        if (n.kind === "match" && n.otherwise) { visit(n.otherwise); same(id, n.otherwise, "a case", id); }
        return;
      }
      case "solve": {
        // A call read sideways: each port is a given expression or a binder.
        Object.values(n.given).forEach(visit);
        const term = (k: string) => (n.given[k] ? t(n.given[k]) : n.binds[k] ? t(n.binds[k]) : `${prefix}${id}:${k}`);
        if (code.nodes[n.fn]?.kind === "def") out.push(...calleeConstraints(code, n.fn, term, `${prefix}${id}/`, depth));
        else if (code.nodes[n.fn]?.kind === "builtin") out.push(...rules((code.nodes[n.fn] as { op: string }).op, term, id, id));
        visit(n.body);
        same(id, n.body, "solve", id);
        return;
      }
      default: return;
    }
  };
  visit(def.body);
  return out;
}

// A callee's constraints with its ports bound to the caller's terms.
function calleeConstraints(code: Code, fn: Id, port: (k: string) => string, prefix: string, depth: number): Constraint[] {
  const cdef = get(code, fn, "def");
  const cb = cdef.body ? code.nodes[cdef.body] : null;
  if (!cb) return [];
  const map = new Map<Id, string>();
  if (cb.kind === "lambda") {
    cb.params.forEach((p) => map.set(p, port(p)));
    map.set(cb.body, port("out"));
  }
  return constraints(code, fn, prefix, map, depth + 1);
}

// ---------------------------------------------------------------- solving

// Incremental Gaussian elimination. Rows are kept reduced against earlier
// pivots; a new constraint that reduces to 0 = nonzero is a conflict.
class System {
  rows: { coef: Map<string, number>; rhs: Vec; pivot: string }[] = [];

  reduce(coef: Map<string, number>, rhs: Vec) {
    coef = new Map(coef);
    rhs = [...rhs];
    for (const row of this.rows) {
      const c = coef.get(row.pivot);
      if (!c) continue;
      for (const [k, v] of row.coef) {
        const nv = (coef.get(k) ?? 0) - c * v;
        if (Math.abs(nv) < EPS) coef.delete(k); else coef.set(k, nv);
      }
      rhs = rhs.map((x, i) => x - c * row.rhs[i]);
    }
    return { coef, rhs };
  }

  // false when the constraint contradicts what's there.
  add(c: Constraint): boolean {
    const m = new Map<string, number>();
    for (const [k, v] of c.terms) m.set(k, (m.get(k) ?? 0) + v);
    for (const [k, v] of m) if (Math.abs(v) < EPS) m.delete(k);
    const { coef, rhs } = this.reduce(m, c.rhs);
    if (!coef.size) return rhs.every((x) => Math.abs(x) < EPS);
    const [pivot, pv] = [...coef].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    const norm = new Map([...coef].map(([k, v]) => [k, v / pv]));
    const nrhs = rhs.map((x) => x / pv);
    // keep earlier rows reduced against the new pivot
    for (const row of this.rows) {
      const k = row.coef.get(pivot);
      if (!k) continue;
      for (const [kk, v] of norm) {
        const nv = (row.coef.get(kk) ?? 0) - k * v;
        if (Math.abs(nv) < EPS) row.coef.delete(kk); else row.coef.set(kk, nv);
      }
      row.rhs = row.rhs.map((x, i) => x - k * nrhs[i]);
    }
    this.rows.push({ coef: norm, rhs: nrhs, pivot });
    return true;
  }

  // The term's unit if the system pins it down, else undefined.
  value(term: string): Unit | undefined {
    const { coef, rhs } = this.reduce(new Map([[term, 1]]), ZERO);
    if (coef.size) return undefined;
    return toUnit(rhs.map((x) => -x));
  }
}

export interface Inference {
  ok: boolean;
  // Constraints that couldn't be satisfied, with the node they came from.
  conflicts: { why: string; node?: Id }[];
  unit: (term: string) => Unit | undefined;
}

export function infer(code: Code, defId: Id, extra: Constraint[] = []): Inference {
  const sys = new System();
  const conflicts: { why: string; node?: Id }[] = [];
  for (const c of [...constraints(code, defId), ...extra]) if (!sys.add(c)) conflicts.push({ why: c.why, node: c.node });
  return { ok: !conflicts.length, conflicts, unit: (term) => sys.value(term) };
}

// Would making these two terms the same value still type-check?
export function compatible(code: Code, defId: Id, a: string, b: string): { ok: boolean; reason?: string } {
  const base = infer(code, defId);
  const ua = base.unit(a), ub = base.unit(b);
  const res = infer(code, defId, [{ terms: [[a, 1], [b, -1]], rhs: ZERO, why: "this connection" }]);
  if (res.ok || !base.ok) return { ok: true };
  return {
    ok: false,
    reason: ua && ub ? `${formatUnit(ua)} can't meet ${formatUnit(ub)}` : `the units around it can't agree (${[ua, ub].map((u) => (u ? formatUnit(u) : "free")).join(" vs ")})`,
  };
}

// Unit conflicts in every function of a program, as messages. Only programs
// that declare a unit somewhere are checked: without one, every unit is
// free and nothing can conflict.
export function unitProblems(code: Code): { id: Id; message: string }[] {
  if (!Object.values(code.nodes).some((n) => unitOf(n))) return [];
  const out: { id: Id; message: string }[] = [];
  for (const d of code.defs) {
    const def = code.nodes[d];
    if (def?.kind !== "def" || !def.body || code.nodes[def.body]?.kind !== "lambda") continue;
    for (const c of infer(code, d).conflicts) out.push({ id: c.node ?? d, message: unitMessage(code, c.why, c.node) });
  }
  return out;
}

function unitMessage(code: Code, why: string, node?: Id): string {
  if (why === "declared unit" && node) {
    const u = unitOf(code.nodes[node]);
    return `declared ${u ? formatUnit(u) : "a unit"}, but the rest says otherwise`;
  }
  return why === "a plain number" ? "a plain number can't stand where a unit is needed" : "units don't agree here";
}
