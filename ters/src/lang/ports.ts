// The ports of a function, read off the program (PORTS-2026-11-01.md,
// L128b): what each result is called, so a part of what a call gives can be
// shown by the name its function gave it (`r.length`) though it is read by
// position.

import type { Code, Id, Node, Use } from "../model.ts";
import { fieldPorts, useTarget } from "../model.ts";
import { SIGS, TUPLE_MAX, tupleVariant } from "./std.ts";
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

// A use with no body (L211, PORTS-2026-11-01.md §3 "Decided (L179)") gives
// its produced ports, the ones not given, in port order, as a tuple, or
// the one value when it produces one. Until the readers take it as it is,
// it is read as the use that binds each produced port and gives them back:
// a binder `<use>.bind.<port>` for each, and the body `<use>.tuple`. The
// ids come from the use's, so filling the same program twice gives the
// same nodes. A use whose ports aren't known (a hole, an unknown target)
// is left alone.
export function fillUses(code: Code): void {
  for (const [id, n] of Object.entries(code.nodes)) {
    if (n.kind !== "call" || !n.given || (n as { body?: Id }).body !== undefined) continue;
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
