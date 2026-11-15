// An operation with an effect given as a value (C235, GAPS round 19 S1):
// `for each(lines, print)` hands `print` to `for each`. The lowering knows
// such a builtin only called, where it can go to a handler of the
// program's or to the world, so as a value it was refused on every
// compiled target ("uses print as a value"). Here each such use becomes
// the function that calls it, `(x) => print(x)`, which lowers as any
// lambda does, its call as any call of print. The program is checked
// again only when something changed.

import type { Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { freshId, isCall } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { leftToWays } from "../../ters/src/lang/ways.ts";

// The uses rewritten, and the program with them.
export function operationLambdas(code: Code, info: Info, names: Names): { code: Code; names: Names; made: Id[] } {
  const called = new Set<Id>();
  for (const n of Object.values(code.nodes)) if (isCall(n)) called.add(n.fn);
  const made: Id[] = [];
  let out: Code | null = null;
  const more: Names = {};
  for (const [id, n] of Object.entries(code.nodes)) {
    // The program's own uses: the library's are its, and checked as it is.
    // Not `by its ways` (an implementation's field left to its ways, C244):
    // any type, a function's with Choice in break's toucher, and replaced
    // by a way before compiling, not called.
    if (n.kind !== "ref" || called.has(id) || LIBRARY.code.nodes[id] || code.nodes[n.target]?.kind !== "builtin" || leftToWays(code, id)) continue;
    const t0 = info.typeOf.get(id), t = t0 && info.subst.zonk(t0);
    if (t?.t !== "fn" || t.eff.effs.length === 0) continue;
    out ??= { nodes: { ...code.nodes }, defs: [...code.defs] };
    const o = out;
    const add = (x: Omit<Node, "id">) => { const nid = freshId(); o.nodes[nid] = { id: nid, ...x } as Node; return nid; };
    const params = t.params.map((_, i) => { const b = add({ kind: "binder" } as Omit<Node, "id">); more[b] = `x${i + 1}`; return b; });
    const call = add({ kind: "call", fn: add({ kind: "ref", target: n.target } as Omit<Node, "id">), args: params.map((b) => add({ kind: "ref", target: b } as Omit<Node, "id">)) } as Omit<Node, "id">);
    o.nodes[id] = { id, kind: "lambda", params, body: call } as NodeOf<"lambda">;
    made.push(id);
  }
  return out ? { code: out, names: { ...names, ...more }, made } : { code, names, made };
}

export function withOperationLambdas(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const r = operationLambdas(code, info, names);
  if (!r.made.length) return { code, info, names };
  const checked = infer(r.code, r.names, undefined, info.options);
  return checked.errors.length <= info.errors.length ? { code: r.code, info: checked, names: r.names } : { code, info, names };
}
