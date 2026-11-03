// The ports of a function, read off the program (PORTS-2026-11-01.md,
// L128b): what each result is called, so a part of what a call gives can be
// shown by the name its function gave it (`r.length`) though it is read by
// position.

import type { Code, Id, Node, Use } from "../model.ts";
import { useTarget } from "../model.ts";

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
