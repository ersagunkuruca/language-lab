// The ports of a function, read off the program (PORTS-2026-11-01.md,
// L128b): what each result is called, so a part of what a call gives can be
// shown by the name its function gave it (`r.length`) though it is read by
// position.

import type { Code, Id, Node, Use } from "../model.ts";
import { fieldPorts, useTarget } from "../model.ts";
import { SIGS, TUPLE_MAX, tupleVariant, tuplePart } from "./std.ts";
import { Subst } from "./types.ts";

// The binders naming the result ports of the function an expression is: a
// lambda written there, or a definition (or a let's name) bound to one.
// Null when it has none named.
export function resultPorts(code: Code, fn: Id): Id[] | null {
  let n: Node | undefined = code.nodes[fn];
  for (let hops = 0; n?.kind === "ref" && hops < 4; hops++) {
    const t: Node | undefined = code.nodes[n.target];
    n = t?.kind === "def" && t.body ? code.nodes[t.body] : undefined;
  }
  return n?.kind === "lambda" && n.results?.length ? n.results : null;
}

// A use's given ports in port order (SPEC §7.2b, S10): the order its
// definition lists its parameters, then `out`; a field's or a builtin's
// ports by position. Their effects happen in this order, before the solve,
// so they don't depend on how a saved file happened to order its keys.
export function givenInOrder(code: Code, n: Use): string[] {
  const keys = Object.keys(n.given);
  const t = code.nodes[useTarget(code.nodes, n)];
  const lam = t?.kind === "def" && t.body ? code.nodes[t.body] : undefined;
  const params = lam?.kind === "lambda" ? lam.params : [];
  const rank = (k: string) => {
    if (k === "out") return Infinity;
    const i = params.indexOf(k);
    return i >= 0 ? i : /^\d+$/.test(k) ? Number(k) : params.length + keys.indexOf(k);
  };
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

// Every port of the relation a use runs, in port order: a definition's
// parameters and then `out`, a field's ports by position, a builtin's
// inputs by position and then `out`. Null when it isn't known here.
export function usePorts(code: Code, n: { fn: Id }): string[] | null {
  const target = useTarget(code.nodes, n as Use);
  const t = code.nodes[target];
  if (t?.kind === "def") {
    const lam = t.body ? code.nodes[t.body] : undefined;
    return lam?.kind === "lambda" ? [...lam.params, "out"] : null;
  }
  if (t?.kind === "field") {
    const fp = fieldPorts(code.nodes, t);
    return fp ? [...fp.ins, ...fp.outs].map(String) : null;
  }
  const sig = SIGS[target]?.(new Subst());
  return sig?.t === "fn" ? [...sig.params.map((_, i) => String(i)), "out"] : null;
}

// The ports a use answers (L211d): its binders', in order, or with no
// body the ones it produces, the ports not given, in port order.
export const answerKeys = (code: Code, n: Use): string[] => (n.body !== undefined ? Object.keys(n.binds ?? {}) : (usePorts(code, n) ?? []).filter((k) => !(k in n.given)));

// A use with no body (L211, PORTS-2026-11-01.md §3 "Decided (L179)") gives
// its produced ports, the ones not given, in port order, as a tuple, or
// the one value when it produces one. Until the readers take it as it is,
// it is read as the use that binds each produced port and gives them back:
// a binder `<use>.bind.<port>` for each, and the body `<use>.tuple`. The
// ids come from the use's, so filling the same program twice gives the
// same nodes. A use whose ports aren't known (a hole, an unknown target)
// is left alone.
// `own`: the nodes to look at (a program's own, not the library under it).
export function fillUses(code: Code, own: Iterable<Id> = Object.keys(code.nodes)): void {
  for (const id of own) {
    const n = code.nodes[id];
    if (n?.kind !== "call" || !n.given || (n as { body?: Id }).body !== undefined) continue;
    const ports = usePorts(code, n);
    const produced = ports?.filter((k) => !(k in n.given!));
    if (!produced?.length || produced.length > TUPLE_MAX) continue;
    const binds = Object.fromEntries(produced.map((k) => [k, `${id}.bind.${k}`]));
    for (const b of Object.values(binds)) code.nodes[b] = { id: b, kind: "binder" };
    const refs = produced.map((k) => { const r = `${id}.part.${k}`; code.nodes[r] = { id: r, kind: "ref", target: binds[k] }; return r; });
    let body = refs[0];
    if (refs.length > 1) {
      const fn = `${id}.tuple.fn`;
      code.nodes[fn] = { id: fn, kind: "ref", target: tupleVariant(refs.length) };
      body = `${id}.tuple`;
      code.nodes[body] = { id: body, kind: "call", fn, args: refs };
    }
    code.nodes[id] = { ...n, binds, body } as Node;
  }
}

// The program with each use that has no body read as fillUses reads one
// (L211e): for the passes that work on slots, the modes analysis and the
// relational interpreter, whose slots are binders. Its meaning is the same
// (L211a); the copy is made once per program, and only when one is there.
const filledOnce = new WeakMap<Code, Code>();
export function filled(code: Code): Code {
  let out = filledOnce.get(code);
  if (!out) {
    const bare = Object.keys(code.nodes).filter((id) => { const n = code.nodes[id]; return n?.kind === "call" && !!(n as Use).given && (n as Use).body === undefined; });
    if (bare.length) { out = { ...code, nodes: { ...code.nodes } }; fillUses(out, bare); }
    else out = code;
    filledOnce.set(code, out);
  }
  return out;
}


// A saved use that binds its ports and has a body, moved to today's shape
// (L211g, model.ts SHAPE_STEPS): the use gives its produced ports with no
// body, and its old body becomes a let of that, in the use's place. A read
// of a port's old binder becomes a part read of the let's variable
// (`value.second` for the second produced port), or the variable itself
// when the use produces one. A body that only gives the one binder back is
// the use itself. A use whose ports aren't known here, one that binds a
// port it doesn't produce, or one whose binder carries a unit (a let's
// variable can't say a part's) stays as it is: binds and body are still
// read. `library`: the definitions a use may run, besides the program's.
export function usesGiveTheirPorts(nodes: Record<Id, unknown>, library: Record<Id, Node>): void {
  const all = Object.assign(Object.create(library) as Record<Id, Node>, nodes as Record<Id, Node>);
  const code: Code = { nodes: all, defs: [] };
  const reads = new Map<Id, Id[]>();
  for (const x of Object.values(nodes)) { const r = x as Node; if (r?.kind === "ref") reads.set(r.target, [...(reads.get(r.target) ?? []), r.id]); }
  for (const id of Object.keys(nodes)) {
    const n = nodes[id] as Node;
    if (n?.kind !== "call" || !n.given || !n.binds || n.body === undefined) continue;
    const produced = (usePorts(code, n) ?? []).filter((k) => !(k in n.given!));
    const binds = n.binds, body = n.body;
    if (!produced.length || produced.length > TUPLE_MAX || Object.keys(binds).some((k) => !produced.includes(k))) continue;
    if (Object.values(binds).some((b) => (nodes[b] as { unit?: unknown } | undefined)?.unit)) continue;
    const bare = { ...n } as Record<string, unknown>;
    delete bare.binds; delete bare.body;
    const only = produced.length === 1 ? binds[produced[0]] : undefined;
    const b = nodes[body] as Node | undefined;
    if (only !== undefined && b?.kind === "ref" && b.target === only && (reads.get(only) ?? []).length === 1) {
      nodes[id] = bare; delete nodes[body]; delete nodes[only];
      continue;
    }
    const use = `${id}.use`, fn = `${id}.let`, value = `${id}.value`;
    nodes[use] = { ...bare, id: use };
    nodes[value] = { id: value, kind: "binder" };
    nodes[fn] = { id: fn, kind: "lambda", params: [value], body };
    nodes[id] = { id, kind: "call", fn, args: [use] };
    for (const [port, binder] of Object.entries(binds)) {
      for (const r of reads.get(binder) ?? []) {
        if (produced.length === 1) { nodes[r] = { id: r, kind: "ref", target: value }; continue; }
        const part = `${r}.part`, of = `${r}.of`;
        nodes[part] = { id: part, kind: "ref", target: tuplePart(produced.length, produced.indexOf(port)) };
        nodes[of] = { id: of, kind: "ref", target: value };
        nodes[r] = { id: r, kind: "call", fn: part, args: [of] };
      }
      delete nodes[binder];
    }
  }
}
