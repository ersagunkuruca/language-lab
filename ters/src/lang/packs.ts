// A packing type (L256, packing.ts) written as the record of closures it
// is, before anything runs, so the evaluator, relate.ts and every compiler
// target see ordinary code. For `Device = device(it: a) where a has
// Appliance`, Appliance's operations taking an a first:
//
//   type Device = device(draw: (Int) -> Float64, later: (Int) -> Device, label: () -> Text)
//   pack device(x) = device((t) => draw(x, t), (t) => pack device(later(x, t)), () => label(x))
//   appliance at device = appliance((d, t) => d.draw(t), (d, t) => d.later(t), (d) => d.label())
//
// and in the program: device(e) is pack device(e), or e itself when e is
// a Device already (a packed Device's operations are its own, so packing
// it again would only add a call to each); d.it is d; a match `device(x) →
// B` is (x ↦ B)(d), since x, the packed value, is used through what it
// has, and so is d. pack device is generic: arith.ts copies it per type
// packed, so draw(x, t) inside is a direct call of that type's own.
//
// Prior art: an existential type as an object (Pierce, Types and
// Programming Languages, ch. 24); type classes with existential types
// (Läufer, JFP 1996); Rust's `dyn Trait`, built the same way.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId, isCall, nodesWhere } from "../model.ts";
import type { Names } from "../presentation.ts";
import { inferRewritten, type Info } from "./infer.ts";
import { packingOf, type Packing } from "./packing.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

const packingsIn = (code: Code): Packing[] => code.defs.flatMap((d) => { const p = packingOf(code, d); return p && p.has.length ? [p] : []; });

export const usesPacking = (code: Code) => packingsIn(code).length > 0;

export function packsWritten(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const packings = packingsIn(code);
  if (!packings.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const out: Names = { ...names };
  const defs = [...code.defs];
  const made: Id[] = [];
  const changed: Id[] = [];
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const call = (fn: Id, args: Id[]) => add({ kind: "call", fn, args });
  const binder = (name: string) => { const b = add({ kind: "binder" }); out[b] = name; return b; };
  const lambda = (params: Id[], body: Id) => add({ kind: "lambda", params, body });
  const define = (name: string, body: Id) => { const d = add({ kind: "def", body }); out[d] = name; defs.push(d); made.push(d); return d; };
  const byVariant = new Map<Id, { p: Packing; pack: Id }>();
  const byField = new Map<Id, Packing>();
  for (const p of packings) {
    const self = (): Id => add({ kind: "tref", target: p.def, args: [] });
    // A type of an operation with the interface's variable made the
    // packing type: the packed value's operation gives a packed value.
    const copy = (id: Id, a: Id): Id => {
      const n = code.nodes[id];
      if (n.kind === "tref") return n.target === a ? self() : add({ kind: "tref", target: n.target, args: n.args.map((x) => copy(x, a)), ...(n.unit ? { unit: n.unit } : {}) });
      if (n.kind === "tfun") return add({ kind: "tfun", params: n.params.map((x) => copy(x, a)), result: copy(n.result, a), ...(n.effects ? { effects: [...n.effects] } : {}) });
      return id;
    };
    // Each operation of each interface had, as a closure field.
    const ops = p.has.flatMap(({ iface }) => {
      const td = code.nodes[(code.nodes[iface] as NodeOf<"def">).body!] as NodeOf<"typedef">;
      const a = td.params[0], v = code.nodes[td.variants[0]] as NodeOf<"variant">;
      return v.fields.map((op) => {
        const t = code.nodes[(code.nodes[op] as NodeOf<"field">).type] as NodeOf<"tfun">;
        const ft = add({ kind: "tfun", params: t.params.slice(1).map((x) => copy(x, a)), result: copy(t.result, a), ...(t.effects ? { effects: [...t.effects] } : {}) });
        const field = add({ kind: "field", type: ft });
        out[field] = names[op] ?? op;
        const gives = (code.nodes[t.result] as NodeOf<"tref">).kind === "tref" && (code.nodes[t.result] as NodeOf<"tref">).target === a;
        return { iface, iv: v.id, op, field, inputs: t.params.length - 1, gives };
      });
    });
    const variant = add({ kind: "variant", fields: ops.map((o) => o.field) });
    out[variant] = names[p.variant] ?? p.variant;
    const td = (code.nodes[p.def] as NodeOf<"def">).body!;
    nodes[td] = { ...(code.nodes[td] as NodeOf<"typedef">), variants: [variant] };
    changed.push(td);
    // pack device(x): each operation a closure over x.
    const pack = add({ kind: "def", body: null });
    out[pack] = `pack ${names[p.variant] ?? p.variant}`;
    defs.push(pack); made.push(pack);
    const x = binder("x");
    const closures = ops.map((o) => {
      const qs = Array.from({ length: o.inputs }, (_, i) => binder(`x${i + 1}`));
      const use = call(ref(o.op), [ref(x), ...qs.map(ref)]);
      return lambda(qs, o.gives ? call(ref(pack), [use]) : use);
    });
    (nodes[pack] as NodeOf<"def">).body = lambda([x], call(ref(variant), closures));
    // How the packing type has each interface: its fields, called.
    for (const { iface } of p.has) {
      const mine = ops.filter((o) => o.iface === iface);
      const fns = mine.map((o) => {
        const d = binder("packed"), qs = Array.from({ length: o.inputs }, (_, i) => binder(`x${i + 1}`));
        return lambda([d, ...qs], call(call(ref(o.field), [ref(d)]), qs.map(ref)));
      });
      define(`${names[iface] ?? iface} at ${names[p.def] ?? p.def}`, call(ref(mine[0].iv), fns));
    }
    byVariant.set(p.variant, { p, pack });
    byField.set(p.field, p);
  }
  const isPacked = (e: Id, p: Packing) => { const t = info.typeOf.get(e); const r = t && info.subst.resolve(t); return r?.t === "con" && r.id === p.def; };
  // A node made the node e is, under its own id (its parent keeps it).
  const become = (id: Id, e: Id) => { nodes[id] = { ...(nodes[e] as Node), id } as Node; changed.push(id); };
  const found = nodesWhere(code, "packing", (n) =>
    (n.kind === "ref" && (byVariant.has(n.target) || byField.has(n.target))) ||
    (isCall(n) && code.nodes[n.fn]?.kind === "ref" && (byVariant.has((code.nodes[n.fn] as NodeOf<"ref">).target) || byField.has((code.nodes[n.fn] as NodeOf<"ref">).target))) ||
    ((n.kind === "match" || n.kind === "fold") && n.arms.some((a) => byVariant.has((code.nodes[a] as NodeOf<"arm"> | undefined)?.variant ?? ""))));
  const done = new Set<Id>();
  for (const id of found) {
    const n = code.nodes[id];
    if (isCall(n) && n.args.length === 1) {
      const fn = (code.nodes[n.fn] as NodeOf<"ref">).target, [e] = n.args;
      done.add(n.fn);
      const v = byVariant.get(fn);
      if (v) { if (isPacked(e, v.p)) become(id, e); else { nodes[id] = { ...n, fn: ref(v.pack) }; changed.push(id); } }
      else become(id, e);
    }
  }
  for (const id of found) {
    const n = code.nodes[id];
    if (n.kind === "ref" && !done.has(id)) {
      const v = byVariant.get(n.target);
      // Given as a function: the packing, or the field, which is the value.
      if (v) nodes[id] = { ...n, target: v.pack };
      else { const d = binder("packed"); nodes[id] = { id, kind: "lambda", params: [d], body: ref(d) } as Node; }
      changed.push(id);
    }
    if (n.kind === "match" || n.kind === "fold") {
      const arm = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => byVariant.has(a.variant));
      const body = arm ? arm.body : (n as NodeOf<"match">).otherwise!;
      const x = arm?.binds[0];
      if (x) nodes[id] = { id, kind: "call", fn: lambda([x], body), args: [n.scrutinee] } as Node;
      else nodes[id] = { id, kind: "call", fn: lambda([binder("packed")], body), args: [n.scrutinee] } as Node;
      changed.push(id);
    }
  }
  const next: Code = { nodes, defs };
  return { code: next, info: inferRewritten(code, next, out, info, changed, made), names: out };
}
