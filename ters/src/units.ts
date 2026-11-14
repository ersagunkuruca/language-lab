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
import { get, useTarget, isCall, isUse, isBound, bindsOf, isPublished, children, nodesWhere } from "./model.ts";

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

// A unit as formatUnit writes it, read back (L252): base units and the
// named ones, each with an exponent (s², s^2, s⁻¹), joined by · or *, and
// everything after a / divides: `m/s²`, `kg·m/s²`, `N`, `1/s`. Null when
// it isn't one, so a type's word can be tried as a unit after its names.
const SUPER: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
export function parseUnit(text: string): Unit | null {
  const [num, ...dens] = text.split("/");
  if (dens.length > 1) return null;
  const v = BASE.map(() => 0);
  const part = (s: string, sign: number): boolean => {
    if (s === "1") return true;
    for (const f of s.split(/[·*]/)) {
      const m = /^([A-Za-zΩ]+)(?:\^(-?\d+)|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/.exec(f);
      if (!m) return false;
      const e = m[2] !== undefined ? Number(m[2]) : m[3] ? Number([...m[3]].map((c) => SUPER[c]).join("")) : 1;
      const named = NAMED.find(([n]) => n === m[1])?.[1];
      const base = (BASE as readonly string[]).indexOf(m[1]);
      if (!named && base < 0) return false;
      if (named) toVec(named).forEach((x, i) => (v[i] += sign * e * x));
      else v[base] += sign * e;
    }
    return true;
  };
  if (!num || !part(num, 1) || (dens.length && !part(dens[0], -1))) return null;
  return toUnit(v);
}

// ---------------------------------------------------------------- constraints

// sum(coef · U(term)) = rhs, per base dimension. `why` names the node the
// constraint came from, so a conflict can say what it conflicts with.
interface Constraint { terms: [string, number][]; rhs: Vec; why: string; node?: Id }

const ZERO: Vec = BASE.map(() => 0);

function rules(op: string, port: (k: string) => string, why: string, node: Id): Constraint[] {
  const eq = (a: string, b: string): Constraint => ({ terms: [[a, 1], [b, -1]], rhs: ZERO, why, node });
  const is = (a: string, v: Vec): Constraint => ({ terms: [[a, 1]], rhs: v, why, node });
  // The generic + − · −x < (arith.add…) keep units as Float64's own do.
  switch (op.replace(/^arith\./, "")) {
    // The two sides first, so a clash between them is named as theirs
    // (speed is m/s, time is s) rather than one side's against the answer.
    case "add": case "sub": return [eq(port("0"), port("1")), eq(port("0"), port("out"))];
    case "neg": case "abs": case "floor": case "float32": return [eq(port("0"), port("out"))];
    // mod(7 m, 3 m) is 1 m: both sides and the answer share a unit.
    case "mod": return [eq(port("0"), port("1")), eq(port("0"), port("out"))];
    case "mul": return [{ terms: [[port("out"), 1], [port("0"), -1], [port("1"), -1]], rhs: ZERO, why, node }];
    case "div": return [{ terms: [[port("out"), 1], [port("0"), -1], [port("1"), 1]], rhs: ZERO, why, node }];
    case "sqrt": return [{ terms: [[port("out"), 2], [port("0"), -1]], rhs: ZERO, why, node }];
    case "pow": return [is(port("1"), ZERO)];
    case "sin": case "cos": case "tan": return [is(port("0"), ZERO), is(port("out"), ZERO)];
    case "atan2": return [eq(port("0"), port("1")), is(port("out"), ZERO)];
    case "exp": case "log": case "asin": case "acos": return [is(port("0"), ZERO), is(port("out"), ZERO)];
    // first(x, else d) is x or d (L257): one unit for all three.
    case "first": return [eq(port("0"), port("out")), eq(port("1"), port("out"))];
    // Comparing two numbers: a wire between them, so the same unit.
    case "equal": case "less": return [eq(port("0"), port("1"))];
    default: return [];
  }
}

// Trig's operations' ids (std.ts TRIG_V), named here so units.ts doesn't
// load the library.
const TRIG_FIELD = "std.trig.trig.";
const unitOf = (n: Node | undefined): Unit | undefined => (n as { unit?: Unit } | undefined)?.unit;
// A constraint from a field's type names the unit, for the message.
const FIELD = "field's unit ";
// The unit a field's type says (`speed: Float64 m/s`, L252), if it says one.
const fieldUnit = (code: Code, field: Id): Unit | undefined => {
  const f = code.nodes[field];
  return f?.kind === "field" ? unitOf(code.nodes[f.type]) : undefined;
};

// Constraints for one def. Calls to other defs are inlined under a prefix,
// so a def used twice can take different units each time (it's polymorphic
// in whatever its own body leaves free). Every number-valued expression node
// has a unit; Bool-valued ones (equal, and, for some) just pass constraints
// through. A recursive call isn't inlined again (`path` holds the defs being
// inlined): unfolding it 20 deep was exponential once a def called a
// recursive group more than once, and froze the editor.
export function constraints(code: Code, defId: Id, prefix = "", bindings: Map<Id, string> = new Map(), path: Id[] = []): Constraint[] {
  if (path.length > 20 || path.includes(defId)) return [];
  const out: Constraint[] = [];
  const def = get(code, defId, "def");
  if (!def.body) return out;
  const t = (id: string) => bindings.get(id) ?? prefix + id;
  const same = (a: Id, b: Id, why: string, node: Id) => out.push({ terms: [[t(a), 1], [t(b), -1]], rhs: ZERO, why, node });

  const declare = (id: Id) => {
    const u = unitOf(code.nodes[id]);
    if (u) out.push({ terms: [[t(id), 1]], rhs: toVec(u), why: "declared unit", node: id });
  };
  const thunk = (a: Id) => { const l = code.nodes[a]; return t(l?.kind === "lambda" && !l.params.length ? l.body : a); };
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
        // A value named, `earth radius` (L257): what its definition says of
        // its value is said of this use, so 6371000.0 m is a length here.
        else if (target.kind === "def" && target.body && code.nodes[target.body]?.kind !== "lambda") out.push(...calleeConstraints(code, n.target, (k) => (k === "out" ? t(id) : `${prefix}${id}:${k}`), `${prefix}${id}/`, [...path, defId]));
        return;
      }
      case "lambda": n.params.forEach(declare); visit(n.body); return;
      case "call": {
        if (isUse(n)) {
          // A call read sideways: each port is a given expression or a binder.
          Object.values(n.given).forEach(visit);
          const term = (k: string) => (n.given[k] ? t(n.given[k]) : bindsOf(n)[k] ? t(bindsOf(n)[k]) : `${prefix}${id}:${k}`);
          if (code.nodes[useTarget(code.nodes, n)]?.kind === "def") out.push(...calleeConstraints(code, useTarget(code.nodes, n), term, `${prefix}${id}/`, [...path, defId]));
          else if (code.nodes[useTarget(code.nodes, n)]?.kind === "builtin") out.push(...rules((code.nodes[useTarget(code.nodes, n)] as { op: string }).op, term, id, id));
          if (isBound(n)) { visit(n.body); same(id, n.body, "solve", id); }
          return;
        }
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
        // first's inputs are thunks: what each gives is its body (L257).
        if (callee.kind === "builtin" && callee.op === "first") { out.push(...rules("first", (k) => (k === "out" ? t(id) : thunk(n.args[+k])), id, id)); return; }
        if (callee.kind === "builtin") { out.push(...rules(callee.op, port, id, id)); return; }
        // Trig's operations, sin(x) at any type with Trig, are its
        // builtins' at Float64, units and all (L257).
        if (callee.kind === "field" && fn.target.startsWith(TRIG_FIELD)) { out.push(...rules(fn.target.slice(TRIG_FIELD.length), port, id, id)); return; }
        // A case made with a field whose type has a unit: the value given
        // has it. A field read: what it gives has it (L252).
        if (callee.kind === "variant") {
          callee.fields.forEach((f, i) => { const u = fieldUnit(code, f); if (u && n.args[i] !== undefined) out.push({ terms: [[t(n.args[i]), 1]], rhs: toVec(u), why: FIELD + formatUnit(u), node: n.args[i] }); });
          return;
        }
        if (callee.kind === "field") {
          const u = fieldUnit(code, fn.target);
          if (u) out.push({ terms: [[t(id), 1]], rhs: toVec(u), why: FIELD + formatUnit(u), node: id });
          return;
        }
        if (callee.kind === "def") {
          const keys = paramsOf(fn.target);
          out.push(...calleeConstraints(code, fn.target, (k) => (k === "out" ? t(id) : t(n.args[keys.indexOf(k)])), `${prefix}${id}/`, [...path, defId]));
        }
        return;
      }
      case "match": case "fold": {
        visit(n.scrutinee);
        for (const a of n.arms) {
          const arm = code.nodes[a] as Extract<Node, { kind: "arm" }>;
          // A case's fields, taken out: each has its field's unit.
          const v = code.nodes[arm.variant];
          if (v?.kind === "variant") arm.binds.forEach((b, i) => { const u = v.fields[i] && fieldUnit(code, v.fields[i]); if (u) out.push({ terms: [[t(b), 1]], rhs: toVec(u), why: FIELD + formatUnit(u), node: b }); });
          visit(arm.body);
          same(id, arm.body, "a case", id);
        }
        if (n.kind === "match" && n.otherwise) { visit(n.otherwise); same(id, n.otherwise, "a case", id); }
        return;
      }
      default: return;
    }
  };
  visit(def.body);
  return out;
}

// A callee's constraints with its ports bound to the caller's terms.
// A call of a published definition (a module's, L210's steady pow among
// them) has its callee's constraints said of its ports only: the
// callee's own constraints with every term inside it eliminated, worked
// out once per callee and program (Gaussian elimination, as System solves
// them). Inlining the whole body at each call instead grew as the product
// of the calls along each path: steady pow's fdlibm steps (L210) made the
// palette's unit check of one filling take seconds, and editing's
// swapAndUndo ran out of memory.
// Kept by the callee's definition node, with every node the summary read
// (its body's and, through the summaries it used, its callees'), so a
// program made from another by a few nodes (each filling the palette
// tries) finds it again while those nodes are the same.
type Summary = { out: Constraint[]; read: [Id, Node][] };
const summaries = new WeakMap<Node, Summary>();
const PORT = "\u0000";
let summarising: Set<Id> = new Set();
let reading: [Id, Node][][] = [];
function summaryOf(code: Code, fn: Id): Constraint[] {
  const def = code.nodes[fn];
  const was = summaries.get(def);
  if (was && was.read.every(([id, n]) => code.nodes[id] === n)) { reading[reading.length - 1]?.push(...was.read); return was.out; }
  // A callee being summarised calls itself: as when inlining, the inner
  // call adds nothing.
  if (summarising.has(fn)) return [];
  summarising.add(fn);
  const read: [Id, Node][] = [];
  reading.push(read);
  try {
    const cdef = get(code, fn, "def");
    const cb = cdef.body ? code.nodes[cdef.body] : null;
    const map = new Map<Id, string>();
    if (cb?.kind === "lambda") {
      cb.params.forEach((p) => map.set(p, PORT + p));
      map.set(cb.body, PORT + "out");
    } else if (cdef.body) map.set(cdef.body, PORT + "out");
    for (const id of subtreeIds(code, fn)) read.push([id, code.nodes[id]]);
    const out = project(cb ? constraints(code, fn, "\u0001/", map, []) : [], (t) => t.startsWith(PORT), fn);
    summaries.set(def, { out, read });
    return out;
  } finally {
    summarising.delete(fn);
    reading.pop();
    reading[reading.length - 1]?.push(...read);
  }
}
const subtreeIds = (code: Code, root: Id): Id[] => { const out: Id[] = []; const walk = (id: Id) => { out.push(id); for (const c of children(code.nodes[id])) walk(c); }; walk(root); return out; };

// The constraints `cs` say of the terms `keep` takes, every other term
// eliminated: a row with another term defines it from the rest, so it is
// used to take that term out of the others and then dropped. A row left
// with no terms and a right side is a contradiction, kept as one.
function project(cs: Constraint[], keep: (t: string) => boolean, fn: Id): Constraint[] {
  type Row = { coef: Map<string, number>; rhs: Vec; why: string; node?: Id };
  const rows = new Set<Row>();
  const uses = new Map<string, Set<Row>>();
  const index = (r: Row) => { for (const k of r.coef.keys()) { let u = uses.get(k); if (!u) uses.set(k, (u = new Set())); u.add(r); } };
  for (const c of cs) {
    const coef = new Map<string, number>();
    for (const [k, v] of c.terms) coef.set(k, (coef.get(k) ?? 0) + v);
    for (const [k, v] of coef) if (Math.abs(v) < EPS) coef.delete(k);
    const r: Row = { coef, rhs: [...c.rhs], why: c.why, node: c.node };
    rows.add(r);
    index(r);
  }
  for (const [term, users] of uses) {
    if (keep(term) || !users.size) continue;
    const pivot = users.values().next().value!;
    const pv = pivot.coef.get(term)!;
    rows.delete(pivot);
    for (const k of pivot.coef.keys()) uses.get(k)?.delete(pivot);
    for (const r of [...users]) {
      const c = r.coef.get(term)! / pv;
      for (const [k, v] of pivot.coef) {
        const nv = (r.coef.get(k) ?? 0) - c * v;
        if (Math.abs(nv) < EPS) { r.coef.delete(k); uses.get(k)?.delete(r); }
        else { if (!r.coef.has(k)) { let u = uses.get(k); if (!u) uses.set(k, (u = new Set())); u.add(r); } r.coef.set(k, nv); }
      }
      r.rhs = r.rhs.map((x, i) => x - c * pivot.rhs[i]);
    }
  }
  const out: Constraint[] = [];
  for (const r of rows) {
    if (!r.coef.size && r.rhs.every((x) => Math.abs(x) < EPS)) continue;
    out.push({ terms: [...r.coef], rhs: r.rhs, why: r.coef.size ? r.why : `${r.why} (inside ${fn})`, node: r.node });
  }
  return out;
}

function calleeConstraints(code: Code, fn: Id, port: (k: string) => string, prefix: string, path: Id[]): Constraint[] {
  const cdef = get(code, fn, "def");
  const cb = cdef.body ? code.nodes[cdef.body] : null;
  if (!cb) return [];
  // A program's own callee is read through, so a message can name the
  // terms inside it (drift, drop).
  if (!isPublished(fn)) {
    const map = new Map<Id, string>();
    if (cb.kind === "lambda") {
      cb.params.forEach((p) => map.set(p, port(p)));
      map.set(cb.body, port("out"));
    } else map.set(cdef.body!, port("out"));
    return constraints(code, fn, prefix, map, path);
  }
  const ports = new Map<string, string>();
  if (cb.kind === "lambda") cb.params.forEach((p) => ports.set(PORT + p, port(p)));
  ports.set(PORT + "out", port("out"));
  return summaryOf(code, fn).map((c) => ({ ...c, terms: c.terms.map(([t, v]) => [ports.get(t) ?? t, v] as [string, number]) }));
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

  copy(): System {
    const s = new System();
    s.rows = this.rows.map((r) => ({ coef: new Map(r.coef), rhs: [...r.rhs], pivot: r.pivot }));
    return s;
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
  conflicts: { why: string; node?: Id; sides?: [string, Unit][]; was?: Unit }[];
  unit: (term: string) => Unit | undefined;
}

// With no unit declared anywhere every constraint is homogeneous (each
// right side is zero), so nothing conflicts and no term gets a unit worth
// showing: Tumble's tap places spent 8 s solving such a system (QA10 H1).
const declares = new WeakMap<Code, boolean>();
const UNITLESS: Inference = { ok: true, conflicts: [], unit: () => undefined };
export function infer(code: Code, defId: Id, extra: Constraint[] = []): Inference {
  let any = declares.get(code);
  if (any === undefined) declares.set(code, (any = nodesWhere(code, "has a unit", (n) => !!unitOf(n)).length > 0));
  if (!any && extra.every((c) => c.rhs.every((x) => x === 0))) return UNITLESS;
  const sys = new System();
  const conflicts: Inference["conflicts"] = [];
  for (const c of [...constraints(code, defId), ...extra]) {
    // What each side already was, so the message can name both units.
    const sides = c.terms.length === 2 ? c.terms.map(([t]) => [t, sys.value(t)] as const).filter((x): x is [string, Unit] => !!x[1]) : [];
    const was = c.terms.length === 1 ? sys.value(c.terms[0][0]) : undefined;
    if (!sys.add(c)) conflicts.push({ why: c.why, node: c.node, sides: sides.length === 2 ? sides : undefined, was });
  }
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

// The palette tries hundreds of fillings of one hole, each a program that
// differs from the one before in a few nodes. A definition's constraints
// then are the earlier ones and a few more, so the earlier system, solved
// once, takes just the new ones. Only when the earlier one had no
// conflict: then the new ones conflict, in any order, exactly when the
// whole set does. Anything else is solved from the start.
export class UnitsBefore {
  private solved = new Map<Id, { sys: System; keys: Map<string, number> } | null>();
  private code: Code;
  // A filling declares no unit, so the program has one just when the one
  // before it does.
  readonly anyUnit: boolean;
  constructor(code: Code) { this.code = code; this.anyUnit = declaresUnit(code); }
  of(d: Id) {
    if (!this.solved.has(d)) {
      const sys = new System(), cs = constraints(this.code, d);
      this.solved.set(d, cs.every((c) => sys.add(c)) ? { sys, keys: counts(cs) } : null);
    }
    return this.solved.get(d)!;
  }
}
const key = (c: Constraint) => JSON.stringify([c.terms, c.rhs]);
const counts = (cs: Constraint[]) => { const m = new Map<string, number>(); for (const c of cs) m.set(key(c), (m.get(key(c)) ?? 0) + 1); return m; };

// With `quick`, a conflict the earlier system finds is said without its
// message (the whole set solved again to word it): the palette asks only
// whether a filling brings one.
// A definition the earlier system solved had no conflict, so any it has
// now is new.
const UNWORDED = "\u0000a conflict, not worded";
const unworded: Inference["conflicts"] = [{ why: UNWORDED }];
function conflictsWith(code: Code, d: Id, before?: UnitsBefore, quick = false): Inference["conflicts"] {
  const was = before?.of(d);
  if (!was) return infer(code, d).conflicts;
  const cs = constraints(code, d), left = new Map(was.keys), added: Constraint[] = [];
  for (const c of cs) { const k = key(c), n = left.get(k) ?? 0; if (n) left.set(k, n - 1); else added.push(c); }
  if ([...left.values()].some((n) => n > 0)) return infer(code, d).conflicts;
  if (!added.length) return [];
  const sys = was.sys.copy();
  return added.some((c) => !sys.add(c)) ? (quick ? unworded : infer(code, d).conflicts) : [];
}

// Unit conflicts in every function of a program, as messages, or in the
// ones in `only` (the palette trying a filling rechecks just the
// definitions it can affect, `before` its program without the filling).
// Only programs that declare a unit somewhere are checked: without one,
// every unit is free and nothing can conflict. The library's own units
// (since L188b the prelude's durations are in seconds) don't count, and
// its definitions aren't checked again in every program: otherwise every
// program was checked for units, and tumble's took minutes (inlining
// calls 20 deep). A program that declares a unit sees a library
// definition's units where it calls it.
// A pick (model.ts nodesWhere), so a program on the library's layer reads
// the library's once and looks only at its own nodes (E253b).
const declaresUnit = (code: Code) => nodesWhere(code, "declares a unit", (n) => !!unitOf(n) && !isPublished(n.id)).length > 0;

export function unitProblems(code: Code, names: Record<Id, string> = {}, only?: Set<Id>, before?: UnitsBefore, quick = false): { id: Id; message: string }[] {
  if (!(before ? before.anyUnit : declaresUnit(code))) return [];
  const out: { id: Id; message: string }[] = [];
  for (const d of code.defs) {
    if ((only && !only.has(d)) || isPublished(d)) continue;
    const def = code.nodes[d];
    // A value's own body too (L257): `limit = 3.0 m + 1.0 s`.
    if (def?.kind !== "def" || !def.body) continue;
    for (const c of conflictsWith(code, d, before, quick)) out.push({ id: c.node ?? d, message: c.why === UNWORDED ? UNWORDED : unitMessage(code, c, names) });
  }
  return out;
}

// A term's id is a node's, maybe under a callee's prefix ("a/b/id").
function termName(code: Code, names: Record<Id, string>, term: string): string | undefined {
  const id = term.slice(term.lastIndexOf("/") + 1);
  const n = code.nodes[id];
  if (names[id]) return names[id];
  if (n?.kind === "ref") return names[n.target];
  if (isCall(n) && code.nodes[n.fn]?.kind === "ref") { const f = names[(code.nodes[n.fn] as { target: Id }).target]; return f && `${f}(…)`; }
  return undefined;
}

function unitMessage(code: Code, { why, node, sides, was }: Inference["conflicts"][number], names: Record<Id, string>): string {
  if (why === "declared unit" && node) {
    const u = unitOf(code.nodes[node]);
    return `declared ${u ? formatUnit(u) : "a unit"}, but the rest ${was ? `makes it ${formatUnit(was)}` : "says otherwise"}`;
  }
  if (why.startsWith(FIELD)) return `the field's type says ${why.slice(FIELD.length)}, but ${was ? `this is ${formatUnit(was)}` : "the rest says otherwise"}`;
  if (why === "a plain number") return "a plain number can't stand where a unit is needed";
  if (sides) {
    const [[a, ua], [b, ub]] = sides, na = termName(code, names, a), nb = termName(code, names, b);
    return na && nb && na !== nb ? `units don't agree here: ${na} is ${formatUnit(ua)}, ${nb} is ${formatUnit(ub)}` : `units don't agree here: ${formatUnit(ua)} can't meet ${formatUnit(ub)}`;
  }
  return "units don't agree here";
}

// ---------------------------------------------------------------- signatures

// The units a definition's signature shows (L252; Ersagun, 2026-11-13:
// known units only): each input's and the result's unit where one is
// written or follows from the body, and none where the number is plain or
// its unit is free (a function generic over its unit shows plain Float64).
// Null where the units don't agree, which the check reports.
// A program that writes no unit of its own shows none, as unitProblems
// checks none there: inferring each definition's units through the
// library's (the prelude's seconds) took tumble's check from 2 s to over
// 120 s and froze its page in the editor (#2631). Kept per program and
// definition, as render.ts asks again on every draw.
const signatures = new WeakMap<Code, Map<Id, { params: (Unit | undefined)[]; result?: Unit } | null>>();
export function signatureUnits(code: Code, defId: Id): { params: (Unit | undefined)[]; result?: Unit } | null {
  let m = signatures.get(code);
  if (!m) signatures.set(code, (m = new Map()));
  if (!m.has(defId)) m.set(defId, declaresUnit(code) ? signatureOf(code, defId) : null);
  return m.get(defId)!;
}
function signatureOf(code: Code, defId: Id): { params: (Unit | undefined)[]; result?: Unit } | null {
  const def = code.nodes[defId];
  if (def?.kind !== "def" || !def.body) return null;
  const inf = infer(code, defId);
  if (!inf.ok) return null;
  const known = (term: Id) => { const u = inf.unit(term); return u && Object.keys(u).length ? u : undefined; };
  const body = code.nodes[def.body];
  if (body?.kind !== "lambda") return { params: [], result: known(def.body) };
  return { params: body.params.map(known), result: body.results?.length ? undefined : known(body.body) };
}
