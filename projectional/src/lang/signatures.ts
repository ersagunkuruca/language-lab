// Signatures as pins (REVIEW.md §4.6). Types are never written by hand; a
// pin freezes the type the checker inferred for a definition, so it becomes
// an interface:
//
//   - edits inside the definition must keep it (the checker says so at the
//     definition, not at some caller far away);
//   - callers are checked against the pin, not against the body;
//   - so checking can stop at a pin: a change inside a pinned definition
//     never needs its callers rechecked (recheck, below).
//
// A pin is a side table keyed by id, like names: `signatures.json` next to
// code.json, and `pins` in a module. Published definitions are always pinned
// (src/lang/modules.ts), and the editor can pin any definition. A body may
// be more general than its pin (a pin can promise less), never less general
// and never with more effects.

import { children, type Code, type Id } from "../model.ts";
import { defDeps } from "../hash.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info, type Options } from "./infer.ts";
import { showType, type Row, type Scheme, type Subst, type Type } from "./types.ts";

// A scheme with its variables numbered 0, 1, … by first appearance, rows
// after them. Equal pins are equal JSON.
export type Pin = Scheme;
export type Pins = Record<Id, Pin>;

export function canonical(sc: Scheme): Pin {
  const vars = new Map<number, number>();
  const rows = new Map<number, number>();
  const bound = new Set(sc.vars), boundRows = new Set(sc.rows);
  const walk = (t: Type) => {
    if (t.t === "var") { if (bound.has(t.v) && !vars.has(t.v)) vars.set(t.v, vars.size); }
    else if (t.t === "con") t.args.forEach(walk);
    else { t.params.forEach(walk); walk(t.ret); if (t.eff.tail !== null && boundRows.has(t.eff.tail) && !rows.has(t.eff.tail)) rows.set(t.eff.tail, -1); }
  };
  walk(sc.type);
  let next = vars.size;
  for (const r of rows.keys()) rows.set(r, next++);
  const go = (t: Type): Type => {
    if (t.t === "var") return { t: "var", v: vars.get(t.v) ?? t.v };
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(go) };
    const eff: Row = { effs: [...t.eff.effs].sort(), tail: t.eff.tail === null ? null : rows.get(t.eff.tail) ?? t.eff.tail };
    return { t: "fn", params: t.params.map(go), ret: go(t.ret), eff };
  };
  const plain = new Set(sc.plain ?? []), numbers = new Set(sc.numbers ?? []);
  const out: Pin = { vars: [...vars.values()], rows: [...rows.values()], type: go(sc.type), plain: [...vars].filter(([v]) => plain.has(v)).map(([, i]) => i) };
  // Only when there are any, so every signature written before keeps its hash.
  const nums = [...vars].filter(([v]) => numbers.has(v)).map(([, i]) => i);
  if (nums.length) out.numbers = nums;
  for (const k of ["arith", "ordered"] as const) {
    const these = new Set(sc[k] ?? []);
    const at = [...vars].filter(([v]) => these.has(v)).map(([, i]) => i);
    if (at.length) out[k] = at;
  }
  return out;
}

export const pinKey = (sc: Scheme | undefined) => (sc ? JSON.stringify(canonical(sc)) : "");
export const showPin = (p: Pin, names: Names) => showType(p.type, names);

// Pin these definitions at the types the checker gives them now.
export function pinsOf(info: Info, defs: Id[]): Pins {
  const out: Pins = {};
  for (const d of defs) { const sc = info.schemes.get(d); if (sc) out[d] = canonical(sc); }
  return out;
}

// A pin's own copy for one run of the checker: its variables renumbered
// past everything the checker has made, so they can't meet live ones.
export function fresh(p: Pin, s: Subst): Scheme {
  const m = new Map<number, number>();
  for (const v of [...p.vars, ...p.rows]) m.set(v, s.next++);
  const go = (t: Type): Type => {
    if (t.t === "var") return { t: "var", v: m.get(t.v) ?? t.v };
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(go) };
    return { t: "fn", params: t.params.map(go), ret: go(t.ret), eff: { effs: t.eff.effs, tail: t.eff.tail === null ? null : m.get(t.eff.tail) ?? t.eff.tail } };
  };
  return { vars: p.vars.map((v) => m.get(v)!), rows: p.rows.map((r) => m.get(r)!), type: go(p.type), plain: (p.plain ?? []).map((v) => m.get(v)!), numbers: (p.numbers ?? []).map((v) => m.get(v)!),
    ...(p.arith ? { arith: p.arith.map((v) => m.get(v)!) } : {}), ...(p.ordered ? { ordered: p.ordered.map((v) => m.get(v)!) } : {}) };
}

// The pin's type with its variables made rigid: each one a type of its own
// that only matches itself, each row tail an effect of its own. A body
// fits the pin when its type, instantiated, unifies with this.
export const RIGID = "pin.";
export function rigid(sc: Scheme): Type {
  const plain = new Set(sc.plain ?? []), numbers = new Set(sc.numbers ?? []);
  const arith = new Set(sc.arith ?? []), ordered = new Set(sc.ordered ?? []);
  const kind = (v: number) => (numbers.has(v) ? "numbers" : ordered.has(v) ? "ordered" : arith.has(v) ? "arith" : plain.has(v) ? "plain" : "any");
  const go = (t: Type): Type => {
    if (t.t === "var") return sc.vars.includes(t.v) ? { t: "con", id: `${RIGID}${kind(t.v)}.${t.v}`, args: [] } : t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(go) };
    const tail = t.eff.tail;
    const eff: Row = tail !== null && sc.rows.includes(tail) ? { effs: [...t.eff.effs, `${RIGID}row.${tail}`], tail: null } : t.eff;
    return { t: "fn", params: t.params.map(go), ret: go(t.ret), eff };
  };
  return go(sc.type);
}

// Who calls whom, among the program's definitions.
export function callers(code: Code): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (const d of code.defs) for (const t of defDeps(code, d)) if (t !== d) out.set(t, [...(out.get(t) ?? []), d]);
  return out;
}

// Check a program after the definitions in `changed` were edited, starting
// from the check before the edit. Only those definitions are checked again,
// then the callers of any whose type moved, and so on outwards: a pinned
// definition's type can't move, so checking stops there. Returns the full
// result, the same a whole check would give, and which definitions it
// actually looked at.
export function recheck(code: Code, names: Names, prev: Info, changed: Iterable<Id>, opts: Options = {}): { info: Info; checked: Set<Id> } {
  const isValue = (d: Id) => { const n = code.nodes[d]; return n?.kind === "def" && !(n.body && code.nodes[n.body]?.kind === "typedef"); };
  const typeChanged = [...changed].some((d) => code.nodes[d] && !isValue(d));
  // A data type's change reaches everything that uses it: check it all.
  if (typeChanged) { const info = infer(code, names, undefined, opts); return { info, checked: new Set(code.defs.filter(isValue)) }; }
  const only = new Set([...changed].filter(isValue));
  const by = callers(code);
  for (;;) {
    const info = infer(code, names, { from: prev, only }, opts);
    const more = [...only]
      .filter((d) => pinKey(info.schemes.get(d)) !== pinKey(prev.schemes.get(d)))
      .flatMap((d) => by.get(d) ?? [])
      .filter((c) => !only.has(c) && isValue(c));
    if (!more.length) return { info: fill(code, info, prev, only), checked: only };
    more.forEach((c) => only.add(c));
  }
}

// What the definitions not checked again keep from the earlier check.
function fill(code: Code, info: Info, prev: Info, only: Set<Id>): Info {
  const inside = new Set<Id>();
  for (const d of only) {
    const todo: Id[] = [d];
    while (todo.length) {
      const id = todo.pop()!;
      if (inside.has(id)) continue;
      inside.add(id);
      const n = code.nodes[id];
      if (n) for (const c of children(n)) todo.push(c);
    }
  }
  const z = (t: Type) => prev.subst.zonk(t);
  for (const [id, t] of prev.typeOf) if (!inside.has(id) && !info.typeOf.has(id) && code.nodes[id]) info.typeOf.set(id, z(t));
  for (const [id, h] of prev.holes) {
    if (inside.has(id) || info.holes.has(id) || code.nodes[id]?.kind !== "hole") continue;
    info.holes.set(id, { ...h, expected: z(h.expected), scope: h.scope.map((b) => ({ id: b.id, type: z(b.type) })), row: prev.subst.resolveRow(h.row) });
  }
  info.errors.push(...prev.errors.filter((e) => !inside.has(e.id) && code.nodes[e.id]));
  return info;
}
