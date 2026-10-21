// Units as types. Every value in a def has a physical dimension: a vector of
// exponents over base units (m, s, kg, A, rad). Each builtin says how its
// ports' dimensions relate (add: all equal; mul: exponents add; sqrt: halve),
// which gives a system of linear equations over the exponents. Inference is
// solving that system exactly; a type error is the system being
// inconsistent. Ports nothing pins down stay polymorphic.
//
// The editor uses this to refuse a connection before it exists, the same way
// it refuses a reference to a variable that isn't in scope.

import type { Code, Id, Node } from "./model.ts";
import { get } from "./model.ts";
import { portsOf } from "./relational.ts";

export const BASE = ["m", "s", "kg", "A", "rad"] as const;
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
const RAD: Vec = toVec({ rad: 1 });

function rules(op: string, port: (k: string) => string, why: string, node: Id): Constraint[] {
  const eq = (a: string, b: string): Constraint => ({ terms: [[a, 1], [b, -1]], rhs: ZERO, why, node });
  const is = (a: string, v: Vec): Constraint => ({ terms: [[a, 1]], rhs: v, why, node });
  switch (op) {
    case "add": case "sub": return [eq(port("0"), port("out")), eq(port("1"), port("out"))];
    case "neg": return [eq(port("0"), port("out"))];
    case "mul": return [{ terms: [[port("out"), 1], [port("0"), -1], [port("1"), -1]], rhs: ZERO, why, node }];
    case "div": return [{ terms: [[port("out"), 1], [port("0"), -1], [port("1"), 1]], rhs: ZERO, why, node }];
    case "sqrt": return [{ terms: [[port("out"), 2], [port("0"), -1]], rhs: ZERO, why, node }];
    case "pow": return [is(port("1"), ZERO)];
    case "sin": case "cos": return [is(port("0"), RAD), is(port("out"), ZERO)];
    case "exp": case "log": return [is(port("0"), ZERO), is(port("out"), ZERO)];
    // relations from ../invertible
    case "polar": return [eq(port("x"), port("r")), eq(port("y"), port("r")), is(port("θ"), RAD)];
    case "sumDiff": return [eq(port("a"), port("c")), eq(port("b"), port("c")), eq(port("d"), port("c"))];
    case "ohm": return [is(port("V"), toVec(NAMED[3][1])), is(port("I"), toVec({ A: 1 })), is(port("R"), toVec(NAMED[4][1])), is(port("P"), toVec(NAMED[2][1]))];
    default: return [];
  }
}

const unitOf = (n: Node | undefined): Unit | undefined => (n as { unit?: Unit } | undefined)?.unit;

// Constraints for one def. Calls to other defs (and parts using them) are
// inlined under a prefix, so a def used twice can take different units each
// time (it's polymorphic in whatever its own body leaves free).
export function constraints(code: Code, defId: Id, prefix = "", bindings: Map<Id, string> = new Map(), depth = 0): Constraint[] {
  if (depth > 20) return [];
  const out: Constraint[] = [];
  const def = get(code, defId, "def");
  if (!def.body) return out;
  const t = (id: string) => bindings.get(id) ?? prefix + id;
  const label = (id: Id) => id;
  const body = code.nodes[def.body];

  const declare = (id: Id) => {
    const u = unitOf(code.nodes[id]);
    if (u) out.push({ terms: [[t(id), 1]], rhs: toVec(u), why: "declared unit", node: id });
  };

  if (body.kind === "network") {
    [...body.params, ...body.wires].forEach(declare);
    for (const pid of body.parts) {
      const part = get(code, pid, "part");
      const port = (k: string) => (part.bind[k] ? t(part.bind[k]) : `${prefix}${pid}:${k}`);
      if (part.fn === null) {
        // Zero is the one number that is every unit at once.
        if (part.unit || part.value !== 0) out.push({ terms: [[port("out"), 1]], rhs: toVec(part.unit ?? {}), why: "constant", node: pid });
        continue;
      }
      const callee = code.nodes[part.fn];
      if (callee.kind === "builtin" && (callee.op === "sum" || callee.op === "product")) {
        const total = callee.op === "sum" ? "total" : "product";
        // The spare addend of a sum counts too, so it already "has" the
        // total's unit and can say what it would accept.
        const terms = (callee.op === "sum" ? portsOf(code, part.fn, part.bind) : Object.keys(part.bind)).filter((k) => k !== total);
        if (callee.op === "sum") out.push(...terms.map((k): Constraint => ({ terms: [[port(k), 1], [port(total), -1]], rhs: ZERO, why: pid, node: pid })));
        else out.push({ terms: [[port(total), 1], ...terms.map((k): [string, number] => [port(k), -1])], rhs: ZERO, why: pid, node: pid });
        continue;
      }
      if (callee.kind === "builtin") { out.push(...rules(callee.op, port, label(pid), pid)); continue; }
      out.push(...calleeConstraints(code, part.fn, (k) => port(k), `${prefix}${pid}/`, depth));
    }
    return out;
  }

  // Expression def: every expression node has a unit.
  const visit = (id: Id) => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": if (typeof n.value === "number" && n.value !== 0) out.push({ terms: [[t(id), 1]], rhs: ZERO, why: "a plain number", node: id }); return;
      case "ref": {
        const target = code.nodes[n.target];
        if (target.kind === "binder") out.push({ terms: [[t(id), 1], [t(n.target), -1]], rhs: ZERO, why: "variable", node: id });
        return;
      }
      case "lambda": n.params.forEach(declare); visit(n.body); return;
      case "call": {
        const fn = code.nodes[n.fn];
        n.args.forEach(visit);
        const port = (k: string) => (k === "out" ? t(id) : t(n.args[+k]));
        if (fn.kind === "lambda") {
          fn.params.forEach((p, i) => { declare(p); out.push({ terms: [[t(p), 1], [t(n.args[i]), -1]], rhs: ZERO, why: "let", node: id }); });
          visit(fn.body);
          out.push({ terms: [[t(id), 1], [t(fn.body), -1]], rhs: ZERO, why: "let", node: id });
          return;
        }
        if (fn.kind !== "ref") return;
        const callee = code.nodes[fn.target];
        if (callee.kind === "builtin") { out.push(...rules(callee.op, port, label(id), id)); return; }
        if (callee.kind === "def") {
          const cb = callee.body ? code.nodes[callee.body] : null;
          const keys = cb?.kind === "lambda" ? cb.params : [];
          out.push(...calleeConstraints(code, fn.target, (k) => (k === "out" ? t(id) : t(n.args[keys.indexOf(k)])), `${prefix}${id}/`, depth));
        }
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
  if (cb.kind === "network") cb.params.forEach((p) => map.set(p, port(p)));
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

// The term a network port or outer port is known by in the constraints.
export function portTerm(code: Code, partOrPort: Id, key?: string): string {
  if (key === undefined) return partOrPort;
  const part = get(code, partOrPort, "part");
  return part.bind[key] ?? `${partOrPort}:${key}`;
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
