// Int's own definition as data, written out on Int (L249b): a match on an
// Int whose cases are Int as data's, and each use of a case, become what
// the evaluator, relate.ts and every compiler target already run.
//
//   match d
//     from(k) → A                 (x ↦ if x < 0 then (k ↦ B)(natural(−1 − x))
//     minus one minus(k) → B   ⇒                else (k ↦ A)(natural(x)))(d)
//
// and `from` and `minus one minus` named anywhere (called, or given as a
// function) are their numbers-module helpers, n and −1 − n. A Nat stored
// as an Int (its int row) makes natural(x) x, so the match is one test.
// An `otherwise` stands for the case not written. The match keeps its id,
// as the call that names the value.
//
// Prior art: Peano's integers as pairs of naturals; Agda's and Lean's Int,
// `ofNat n | negSucc n`, which these two cases are.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId, nodesWhere } from "../model.ts";
import type { Names } from "../presentation.ts";
import { inferRewritten, type Info } from "./infer.ts";
import { FALSE, INT_OPS, TRUE } from "./std.ts";
import { INT } from "./types.ts";
import { INT_CASES } from "./int-cases-ids.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

const isCase = (id: Id) => !!INT_CASES.type && (id === INT_CASES.from || id === INT_CASES.minus);
const onInt = (code: Code, n: Node): boolean =>
  (n.kind === "match" && n.arms.some((a) => isCase((code.nodes[a] as NodeOf<"arm"> | undefined)?.variant ?? ""))) || (n.kind === "ref" && isCase(n.target));
const usesIn = (code: Code) => nodesWhere(code, "int cases", (n) => onInt(code, n));
export const usesIntCases = (code: Code) => !!INT_CASES.type && usesIn(code).length > 0;

export function intCases(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  if (!INT_CASES.type) return { code, info, names };
  const found = usesIn(code).map((id) => code.nodes[id]);
  if (!found.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const out: Names = { ...names };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const int = (value: number) => add({ kind: "lit", value, of: INT });
  for (const n of found) {
    if (n.kind === "ref") { nodes[n.id] = { ...n, target: n.target === INT_CASES.from ? INT_CASES.fromFn : INT_CASES.minusFn }; continue; }
    const m = n as NodeOf<"match">;
    const x = add({ kind: "binder" });
    out[x] = "value";
    const arms = m.arms.map((a) => nodes[a] as NodeOf<"arm">);
    // A case's body with its Nat bound: (k ↦ body)(natural(of)).
    const side = (variant: Id, of: Id): Id => {
      const arm = arms.find((a) => a.variant === variant);
      if (!arm) return m.otherwise!;
      const nat = add({ kind: "call", fn: ref(INT_CASES.natural), args: [of] });
      if (!arm.binds.length) return arm.body;
      return add({ kind: "call", fn: add({ kind: "lambda", params: [arm.binds[0]], body: arm.body }), args: [nat] });
    };
    const negative = add({ kind: "call", fn: ref(INT_OPS.less), args: [ref(x), int(0)] });
    const below = side(INT_CASES.minus, add({ kind: "call", fn: ref(INT_OPS.sub), args: [int(-1), ref(x)] }));
    const above = side(INT_CASES.from, ref(x));
    const yes = add({ kind: "arm", variant: TRUE, binds: [], results: [], body: below });
    const no = add({ kind: "arm", variant: FALSE, binds: [], results: [], body: above });
    const test = add({ kind: "match", scrutinee: negative, arms: [yes, no], otherwise: null });
    nodes[m.id] = { id: m.id, kind: "call", fn: add({ kind: "lambda", params: [x], body: test }), args: [m.scrutinee] } as Node;
  }
  const next: Code = { ...code, nodes };
  return { code: next, info: inferRewritten(code, next, out, info, found.map((m) => m.id), []), names: out };
}
