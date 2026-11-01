// The ports of a function, read off the program (PORTS-2026-11-01.md,
// L128b): what each result is called, so a part of what a call gives can be
// shown by the name its function gave it (`r.length`) though it is read by
// position.

import type { Code, Id, Node } from "../model.ts";

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
