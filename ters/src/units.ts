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
// A value's units, by where they sit in its type (L252d, L252e; Kennedy's
// dimension types over containers): a number's unit is the value's own
// slot, and a value of a data type with parameters has a slot per
// parameter, the unit of the numbers of that parameter in it. A slot is a
// path of parameter numbers, with the zeros it ends in left off, so the
// first parameter's slot is the value's own: a List (Float64 m) is m, as
// its items are (L252d); a Map Int (Float64 s) is a plain number at its
// keys' slot and s at its values' ("1"); a List (Int, Float64 s), its
// entries, s at "0.1". A slot's term is the value's with the path after it.
// The slots each program's values may have are these, one parameter deep
// and a list's items' parts (a map's entries). A flow of a value (a name,
// a let, a case, a function's answer) says its slots are the other's, but
// only the slots something says a unit of are said (`close` below): said
// for every slot, a program's constraints were several times as many, and
// trek's check took twice as long.
const SLOTS: number[][] = [[], [1], [2], [0, 1], [0, 2]];
const SLOT = "\u0002";
const slotKey = (p: number[]) => p.join(".");
const KNOWN = new Set(SLOTS.map(slotKey));
const canon = (p: number[]) => { let n = p.length; while (n && p[n - 1] === 0) n--; return p.slice(0, n); };
export const slotTerm = (term: string, path: number[] | string) => { const k = typeof path === "string" ? path : slotKey(canon(path)); return k ? term + SLOT + k : term; };
const baseOf = (term: string): [string, string] => { const i = term.indexOf(SLOT); return i < 0 ? [term, ""] : [term.slice(0, i), term.slice(i)]; };

// The data types with parameters (not an interface, not an effect), read
// once per program: for each case, each field's slots that are a
// parameter's, as (the field's path, the parameter); and each field's
// units its type writes (`speed: Float64 m/s`, `heights: List (Float64 m)`).
type Holds = [number[], number][];
type DataTypes = { fields: Map<Id, Holds>; params: Map<Id, Id[]> };
const dataTypes = new WeakMap<Code, DataTypes>();
const typedefOf = (code: Code, def: Id) => { const d = code.nodes[def]; const b = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined; return b?.kind === "typedef" ? b : undefined; };
const isData = (code: Code, def: Id) => { const td = typedefOf(code, def); return !!td && !td.interface && !td.effect; };
function typesOf(code: Code): DataTypes {
  let m = dataTypes.get(code);
  if (m) return m;
  dataTypes.set(code, (m = { fields: new Map(), params: new Map() }));
  // (A pick reads the typedef, not the def: a pick's test sees one node.)
  for (const tid of nodesWhere(code, "a data type with parameters", (n) => n.kind === "typedef" && n.params.length > 0 && !n.interface && !n.effect)) {
    const td = code.nodes[tid] as Extract<Node, { kind: "typedef" }>;
    const walk = (t: Id, path: number[], out: Holds, depth: number) => {
      const n = code.nodes[t];
      if (n?.kind !== "tref" || depth > 3) return;
      const p = td.params.indexOf(n.target);
      if (p >= 0) out.push([path, p]);
      else if (isData(code, n.target)) n.args.forEach((a, j) => walk(a, [...path, j], out, depth + 1));
    };
    for (const v of td.variants) {
      const vn = code.nodes[v];
      if (vn?.kind !== "variant") continue;
      for (const f of vn.fields) {
        const fn = code.nodes[f];
        const out: Holds = [];
        if (fn?.kind === "field") walk(fn.type, [], out, 0);
        m.fields.set(f, out);
      }
      m.params.set(v, vn.fields);
    }
  }
  return m;
}
// The units a type writes, by slot: `Float64 m/s` at its own, `Map Int
// (Float64 s)` at its values'.
const typeUnits = (code: Code, t: Id, path: number[] = [], out: [string, Unit][] = []): [string, Unit][] => {
  const n = code.nodes[t];
  if (n?.kind !== "tref" || path.length > 3) return out;
  if (n.unit) { const k = slotKey(canon(path)); if (KNOWN.has(k)) out.push([k, n.unit]); return out; }
  if (isData(code, n.target)) n.args.forEach((a, j) => typeUnits(code, a, [...path, j], out));
  return out;
};
const fieldUnits = (code: Code, field: Id): [string, Unit][] => {
  const f = code.nodes[field];
  return f?.kind === "field" ? typeUnits(code, f.type) : [];
};

// Constraints for one def. Calls to other defs are inlined under a prefix,
// so a def used twice can take different units each time (it's polymorphic
// in whatever its own body leaves free). Every number-valued expression node
// has a unit; Bool-valued ones (equal, and, for some) just pass constraints
// through. A recursive call isn't inlined again (`path` holds the defs being
// inlined): unfolding it 20 deep was exponential once a def called a
// recursive group more than once, and froze the editor.
type Fn = { params: string[]; body: string };
// Two terms whose slots follow each other's: slot P + s of a is slot Q + s
// of b, for each slot s (a flow is P = Q = []). Its row for s = [] is said
// where it is made, the others by `close`.
type Follows = { a: string; p: number[]; b: string; q: number[]; why: string; node: Id };
let following: Follows[] | null = null;
export function constraints(code: Code, defId: Id, prefix = "", bindings: Map<Id, string> = new Map(), path: Id[] = [], fns: Map<Id, Fn> = new Map()): Constraint[] {
  // A callee read through adds to its caller's.
  if (following) return collect(code, defId, prefix, bindings, path, fns, following);
  const fs: Follows[] = [];
  following = fs;
  try { return close(collect(code, defId, prefix, bindings, path, fns, fs), fs, []); } finally { following = null; }
}

// The rows of slots past a value's own that the constraints come to: from
// each slot some row names (a field's unit, a summary's), or `seeds`, each
// Follows says the slot it follows, and so on. Slots no unit reaches say
// nothing, so they are left out.
function close(out: Constraint[], fs: Follows[], seeds: string[]): Constraint[] {
  const by = new Map<string, Follows[]>();
  for (const f of fs) for (const x of [f.a, f.b]) { let l = by.get(x); if (!l) by.set(x, (l = [])); l.push(f); }
  const seen = new Set<string>(), todo: string[] = [];
  const mention = (term: string) => { if (term.includes(SLOT) && !seen.has(term)) { seen.add(term); todo.push(term); } };
  for (const c of out) for (const [x] of c.terms) mention(x);
  seeds.forEach(mention);
  // s, where slot `key` is slot P + s; null where it isn't one.
  const after = (key: string, p: number[]): number[] | null => {
    const m = key.split(".").map(Number);
    return m.length > p.length && p.every((x, i) => m[i] === x) ? m.slice(p.length) : null;
  };
  const said = new Set<string>();
  while (todo.length) {
    const term = todo.pop()!, [base, slot] = baseOf(term), key = slot.slice(SLOT.length);
    for (const f of by.get(base) ?? []) {
      for (const [x, p, y, q] of [[f.a, f.p, f.b, f.q], [f.b, f.q, f.a, f.p]] as const) {
        if (x !== base) continue;
        const s = after(key, p);
        if (!s) continue;
        const ky = slotKey(canon([...q, ...s]));
        if (!KNOWN.has(ky)) continue;
        const [l, r] = x === f.a ? [term, slotTerm(y, ky)] : [slotTerm(y, ky), term];
        const k = l + "\u0003" + r;
        if (said.has(k)) continue;
        said.add(k);
        out.push({ terms: [[l, 1], [r, -1]], rhs: ZERO, why: f.why, node: f.node });
        mention(slotTerm(y, ky));
      }
    }
  }
  return out;
}

function collect(code: Code, defId: Id, prefix: string, bindings: Map<Id, string>, path: Id[], fns: Map<Id, Fn>, fs: Follows[]): Constraint[] {
  if (path.length > 20 || path.includes(defId)) return [];
  const out: Constraint[] = [];
  const def = get(code, defId, "def");
  if (!def.body) return out;
  const t = (id: string) => bindings.get(id) ?? prefix + id;
  // Two terms whose values sit in each other's slots: slot P + s of a is
  // slot Q + s of b, for every slot s. A flow (`same`) is P = Q = [].
  const terms = (a: string, p: number[], b: string, q: number[], why: string, node: Id) => {
    const pa = slotKey(canon(p)), pb = slotKey(canon(q));
    if (KNOWN.has(pa) && KNOWN.has(pb)) out.push({ terms: [[slotTerm(a, pa), 1], [slotTerm(b, pb), -1]], rhs: ZERO, why, node });
    fs.push({ a, p, b, q, why, node });
  };
  const same = (a: Id, b: Id, why: string, node: Id) => terms(t(a), [], t(b), [], why, node);
  // A value of a data type and one of its fields' values: the field's
  // slots that are a parameter's are the value's at that parameter.
  const holds = (value: Id, field: Id, part: Id, why: string, node: Id) => {
    for (const [q, i] of typesOf(code).fields.get(field) ?? []) terms(t(value), [i], t(part), q, why, node);
  };
  const typed = (term: Id, field: Id, node: Id) => {
    for (const [k, u] of fieldUnits(code, field)) out.push({ terms: [[slotTerm(t(term), k), 1]], rhs: toVec(u), why: FIELD + formatUnit(u), node });
  };

  const declare = (id: Id) => {
    const u = unitOf(code.nodes[id]);
    if (u) out.push({ terms: [[t(id), 1]], rhs: toVec(u), why: "declared unit", node: id });
  };
  // The terms of a function given as an input: a lambda written there, or
  // a function this one was given in turn.
  const fnOf = (a: Id | undefined): Fn | undefined => {
    const x = a === undefined ? undefined : code.nodes[a];
    if (x?.kind === "lambda") return { params: x.params.map(t), body: t(x.body) };
    if (x?.kind === "ref" && fns.has(x.target)) return fns.get(x.target);
    return undefined;
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
        // A list written out, [a, b]: one unit for its items (L252d).
        if (callee.kind === "builtin" && callee.op === "list.of") { n.args.forEach((a) => terms(t(id), [0], t(a), [], "a list's items", id)); return; }
        // An item of a list, and the answers of a search: the unit of what
        // they're of (L252d).
        if (callee.kind === "builtin" && callee.op === "oneOf" && n.args[0]) { terms(t(n.args[0]), [0], t(id), [], "an item of a list", id); return; }
        if (callee.kind === "builtin" && callee.op === "all" && n.args[0]) { terms(t(id), [0], thunk(n.args[0]), [], "the answers", id); return; }
        // first's inputs are thunks: what each gives is its body (L257).
        if (callee.kind === "builtin" && callee.op === "first") { for (const k of ["0", "1"]) if (n.args[+k]) terms(thunk(n.args[+k]), [], t(id), [], id, id); return; }
        // An Int is a plain number (a unit's number is never one, L252b),
        // so its operations and its Float64 are plain: length(xs) divides
        // a sum of metres into metres.
        if (callee.kind === "builtin" && callee.op.startsWith("int.")) { for (const x of [id, ...n.args]) out.push({ terms: [[t(x), 1]], rhs: ZERO, why: "an Int", node: x }); return; }
        if (callee.kind === "builtin") { out.push(...rules(callee.op, port, id, id)); return; }
        // Trig's operations, sin(x) at any type with Trig, are its
        // builtins' at Float64, units and all (L257).
        if (callee.kind === "field" && fn.target.startsWith(TRIG_FIELD)) { out.push(...rules(fn.target.slice(TRIG_FIELD.length), port, id, id)); return; }
        // A case made with a field whose type has a unit: the value given
        // has it. A field read: what it gives has it (L252).
        if (callee.kind === "variant") {
          callee.fields.forEach((f, i) => { if (n.args[i] === undefined) return; typed(n.args[i], f, n.args[i]); holds(id, f, n.args[i], "what it holds", id); });
          return;
        }
        // A function given as an input, called (L252d): `change(item)` in
        // map is the lambda the caller gave, inputs and answer.
        if (callee.kind === "binder" && fns.has(fn.target)) {
          const f = fns.get(fn.target)!;
          f.params.forEach((p, i) => { if (n.args[i] !== undefined) terms(p, [], t(n.args[i]), [], "a function's input", id); });
          terms(t(id), [], f.body, [], "a function's answer", id);
          return;
        }
        // A field read: what it gives has its type's units, and the slots
        // of the value read (`e.second` of a (Int, Float64 s) is s).
        if (callee.kind === "field") {
          typed(id, fn.target, id);
          if (n.args[0] !== undefined) holds(n.args[0], fn.target, id, "a field read", id);
          return;
        }
        if (callee.kind === "def") {
          const keys = paramsOf(fn.target);
          // The functions it's given, written out or passed on (L252d).
          const given = new Map<Id, Fn>();
          keys.forEach((k, i) => { const f = fnOf(n.args[i]); if (f) given.set(k, f); });
          out.push(...calleeConstraints(code, fn.target, (k) => (k === "out" ? t(id) : t(n.args[keys.indexOf(k)])), `${prefix}${id}/`, [...path, defId], given));
        }
        return;
      }
      case "match": case "fold": {
        visit(n.scrutinee);
        for (const a of n.arms) {
          const arm = code.nodes[a] as Extract<Node, { kind: "arm" }>;
          // A case's fields, taken out: each has its field's unit.
          const v = code.nodes[arm.variant];
          // An item of a list taken out, and its rest: the list's unit
          // (L252d); a tuple's parts, its slots (L252e).
          if (v?.kind === "variant") arm.binds.forEach((b, i) => { const f = v.fields[i]; if (!b || !f) return; typed(b, f, b); holds(n.scrutinee, f, b, "what it holds", b); });
          // A fold's result for the rest is what the fold gives.
          if (n.kind === "fold") arm.results.forEach((r) => { if (r) same(r, id, "a fold's result", r); });
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
const stack: Id[] = [];
let cuts = 0;
let reading: [Id, Node][][] = [];
function summaryOf(code: Code, fn: Id): Constraint[] {
  const def = code.nodes[fn];
  const was = summaries.get(def);
  if (was && was.read.every(([id, n]) => code.nodes[id] === n)) { reading[reading.length - 1]?.push(...was.read); return was.out; }
  // A callee being summarised calls itself: as when inlining, the inner
  // call adds nothing. A summary made while one it calls, not itself, was
  // cut short so (a group calling each other) isn't kept: it lacks what
  // that one says, which its own check reads in full.
  if (summarising.has(fn)) { if (stack[stack.length - 1] !== fn) cuts++; return []; }
  summarising.add(fn);
  stack.push(fn);
  const cutsBefore = cuts;
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
    // Every slot of every port, so a caller's finds what its own slots
    // follow here: reverse's answer's parts are its input's.
    const was = following, fs: Follows[] = [];
    following = fs;
    let cs: Constraint[];
    try { cs = cb ? collect(code, fn, "\u0001/", map, [], new Map(), fs) : []; } finally { following = was; }
    const seeds = [...map.values()].flatMap((p) => [...KNOWN].filter(Boolean).map((k) => slotTerm(p, k)));
    const out = project(close(cs, fs, seeds), (t) => t.startsWith(PORT), fn);
    if (cuts === cutsBefore) summaries.set(def, { out, read });
    return out;
  } finally {
    summarising.delete(fn);
    stack.pop();
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

function calleeConstraints(code: Code, fn: Id, port: (k: string) => string, prefix: string, path: Id[], given: Map<Id, Fn> = new Map()): Constraint[] {
  const cdef = get(code, fn, "def");
  const cb = cdef.body ? code.nodes[cdef.body] : null;
  if (!cb) return [];
  // A callee given a function (map, keep) is read through: its summary
  // can't say what the function does (L252d). So is the program's own
  // that the definition calls itself, so a message can name the terms
  // inside it (drift, drop). Deeper, the program's own are said by their
  // summaries, their ports' constraints alone, as the library's are: read
  // through all the way, every definition held its whole call tree, and
  // depot's main solved 6,160 rows (GAPS round 17 D2, I278).
  if (given.size || (!isPublished(fn) && path.length <= 1)) {
    const map = new Map<Id, string>();
    if (cb.kind === "lambda") {
      cb.params.forEach((p) => map.set(p, port(p)));
      map.set(cb.body, port("out"));
    } else map.set(cdef.body!, port("out"));
    return constraints(code, fn, prefix, map, path, given);
  }
  const ports = new Map<string, string>();
  if (cb.kind === "lambda") cb.params.forEach((p) => ports.set(PORT + p, port(p)));
  ports.set(PORT + "out", port("out"));
  return summaryOf(code, fn).map((c) => ({ ...c, terms: c.terms.map(([t, v]) => { const [b, slot] = baseOf(t), p = ports.get(b); return [p === undefined ? t : p + slot, v] as [string, number]; }) }));
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
  conflicts: { why: string; node?: Id; sides?: [string, Unit][]; was?: Unit; want?: Unit }[];
  unit: (term: string) => Unit | undefined;
}

// With no unit declared anywhere every constraint is homogeneous (each
// right side is zero), so nothing conflicts and no term gets a unit worth
// showing: Tumble's tap places spent 8 s solving such a system (QA10 H1).
const declares = new WeakMap<Code, boolean>();
const UNITLESS: Inference = { ok: true, conflicts: [], unit: () => undefined };
export function infer(code: Code, defId: Id, extra: Constraint[] = [], own?: Constraint[]): Inference {
  let any = declares.get(code);
  if (any === undefined) declares.set(code, (any = nodesWhere(code, "has a unit", (n) => !!unitOf(n)).length > 0));
  if (!any && extra.every((c) => c.rhs.every((x) => x === 0))) return UNITLESS;
  const sys = new System();
  const conflicts: Inference["conflicts"] = [];
  for (const c of [...(own ?? constraints(code, defId)), ...extra]) {
    if (sys.add(c)) continue;
    // What each side already was, so the message can name both units: a
    // constraint that conflicts leaves the system as it was, so they are
    // read after it, only for a conflict (I260: reading them for every
    // constraint was most of a check of trek's 96 definitions).
    const sides = c.terms.length === 2 ? c.terms.map(([t]) => [t, sys.value(t)] as const).filter((x): x is [string, Unit] => !!x[1]) : [];
    const was = c.terms.length === 1 ? sys.value(c.terms[0][0]) : undefined;
    // What the one term is said to be: a callee's summary says a port's
    // unit outright (`time of`'s part is s), with no name to give it.
    const want = c.terms.length === 1 ? toUnit(c.rhs.map((x) => x / c.terms[0][1])) : undefined;
    conflicts.push({ why: c.why, node: c.node, sides: sides.length === 2 ? sides : undefined, was, want });
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
// A definition's conflicts are a function of its constraints alone, and
// most checks (each MCP edit checks the whole program two or three times)
// see the same constraints for every definition but the one edited: found
// by them, a few hundred kept (I260: trek's 96 definitions solved again
// were most of a replace's 1.5 s and more).
// The signature a definition shows reads the same solved system (I278:
// solving it again was as long as the check).
const solvedBy = new Map<string, Inference>();
const constrained = new WeakMap<Code, Map<Id, Constraint[]>>();
function constraintsOf(code: Code, d: Id): Constraint[] {
  let m = constrained.get(code);
  if (!m) constrained.set(code, (m = new Map()));
  if (!m.has(d)) m.set(d, constraints(code, d));
  return m.get(d)!;
}
function solved(code: Code, d: Id): { cs: Constraint[]; inf: Inference } {
  const cs = constraintsOf(code, d), k = JSON.stringify(cs.map((c) => [c.terms, c.rhs, c.why, c.node]));
  const had = solvedBy.get(k);
  if (had) { solvedBy.delete(k); solvedBy.set(k, had); return { cs, inf: had }; }
  const inf = infer(code, d, [], cs);
  solvedBy.set(k, inf);
  if (solvedBy.size > 500) solvedBy.delete(solvedBy.keys().next().value!);
  return { cs, inf };
}
const conflictsOf = (code: Code, d: Id): Inference["conflicts"] => solved(code, d).inf.conflicts;
function conflictsWith(code: Code, d: Id, before?: UnitsBefore, quick = false): Inference["conflicts"] {
  const was = before?.of(d);
  if (!was) return conflictsOf(code, d);
  const cs = constraints(code, d), left = new Map(was.keys), added: Constraint[] = [];
  for (const c of cs) { const k = key(c), n = left.get(k) ?? 0; if (n) left.set(k, n - 1); else added.push(c); }
  if ([...left.values()].some((n) => n > 0)) return conflictsOf(code, d);
  if (!added.length) return [];
  const sys = was.sys.copy();
  return added.some((c) => !sys.add(c)) ? (quick ? unworded : conflictsOf(code, d)) : [];
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
// Kept per program: signatureUnits asks for each definition shown, and
// each scan of trek's nodes was a third of its check.
const declaring = new WeakMap<Code, boolean>();
const declaresUnit = (code: Code) => {
  let d = declaring.get(code);
  if (d === undefined) declaring.set(code, (d = nodesWhere(code, "declares a unit", (n) => !!unitOf(n) && !isPublished(n.id)).length > 0));
  return d;
};

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
  // A slot's term isn't the node's own value (a list's, not its items'
  // parts), so it isn't named by the node.
  if (term.includes(SLOT)) return undefined;
  const id = term.slice(term.lastIndexOf("/") + 1);
  const n = code.nodes[id];
  if (names[id]) return names[id];
  if (n?.kind === "ref") return names[n.target];
  if (isCall(n) && code.nodes[n.fn]?.kind === "ref") { const f = names[(code.nodes[n.fn] as { target: Id }).target]; return f && `${f}(…)`; }
  return undefined;
}

function unitMessage(code: Code, { why, node, sides, was, want }: Inference["conflicts"][number], names: Record<Id, string>): string {
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
  if (was && want) return `units don't agree here: ${formatUnit(was)} can't meet ${formatUnit(want)}`;
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
// Units by slot ("" a number's own, "1" a map's values', L252e).
export type Slots = Record<string, Unit>;
export type SignatureUnits = { params: (Unit | undefined)[]; result?: Unit; slots: { params: Slots[]; result: Slots } };
const signatures = new WeakMap<Code, Map<Id, SignatureUnits | null>>();
export function signatureUnits(code: Code, defId: Id): SignatureUnits | null {
  let m = signatures.get(code);
  if (!m) signatures.set(code, (m = new Map()));
  if (!m.has(defId)) m.set(defId, declaresUnit(code) ? signatureOf(code, defId) : null);
  return m.get(defId)!;
}
function signatureOf(code: Code, defId: Id): SignatureUnits | null {
  const def = code.nodes[defId];
  if (def?.kind !== "def" || !def.body) return null;
  const { cs, inf } = solved(code, defId);
  if (!inf.ok) return null;
  const known = (term: string) => { const u = inf.unit(term); return u && Object.keys(u).length ? u : undefined; };
  // Only the slots some constraint names can have a unit.
  const named = new Set(cs.flatMap((c) => c.terms.map(([x]) => x)));
  const slots = (term: Id): Slots => { const o: Slots = {}; for (const k of KNOWN) { const x = slotTerm(term, k); const u = (!k || named.has(x)) && known(x); if (u) o[k] = u; } return o; };
  const body = code.nodes[def.body];
  if (body?.kind !== "lambda") { const r = slots(def.body); return { params: [], result: r[""], slots: { params: [], result: r } }; }
  const ps = body.params.map(slots), r: Slots = body.results?.length ? {} : slots(body.body);
  return { params: ps.map((x) => x[""]), result: r[""], slots: { params: ps, result: r } };
}
