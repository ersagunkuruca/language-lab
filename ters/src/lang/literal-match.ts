// A match on plain values (BACKLOG L164c, GAPS round 9 MG3,
// REVIEW-2026-11-02d §3), written out as a chain of equal tests before
// anything runs.
//
// machine's `instruction of` chose among 21 names with 21 nested
// `if op = "…"`, and board's `stage from key` and `on key` did the same.
// A match whose arms are values says it as what it is:
//
//   match op
//     "set" → read d a(make set, …)
//     "add" → read a register and two values(make add, …)
//     otherwise → bad(line, "no instruction named " ++ op)
//
// The checker types each value as the scrutinee (infer.ts `byValue`) and
// requires the rest arm. This code → code pass turns the match into
// `(x ↦ if x = "set" then … else if x = "add" then … else …)(op)`, so the
// evaluator, relate.ts and every compiler target see the `if` and `equal`
// they already run; a target may still compile the chain as a switch.
// The match keeps its id, as the call that names the value.
//
// Prior art: C's `switch` and ML's and Haskell's literal patterns
// (`case op of "set" -> …`), which also need a default where the values
// aren't all listed.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { FALSE, S, TRUE } from "./std.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

const byValue = (code: Code, n: Node): n is NodeOf<"match"> =>
  n.kind === "match" && n.arms.some((a) => !!(code.nodes[a] as NodeOf<"arm"> | undefined)?.value);

export const usesLiteralMatch = (code: Code) => Object.values(code.nodes).some((n) => byValue(code, n));

export function literalMatch(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const matches = Object.values(code.nodes).filter((n) => byValue(code, n)) as NodeOf<"match">[];
  if (!matches.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const out: Names = { ...names };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  for (const m of matches) {
    if (!m.otherwise) continue; // the checker has said so
    const x = add({ kind: "binder" });
    out[x] = "value";
    const arms = m.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const chain = arms.reduceRight<Id>((rest, arm) => {
      const test = add({ kind: "call", fn: ref(S.equal), args: [ref(x), arm.value!] });
      const yes = add({ kind: "arm", variant: TRUE, binds: [], results: [], body: arm.body });
      const no = add({ kind: "arm", variant: FALSE, binds: [], results: [], body: rest });
      return add({ kind: "match", scrutinee: test, arms: [yes, no], otherwise: null });
    }, m.otherwise!);
    nodes[m.id] = { id: m.id, kind: "call", fn: add({ kind: "lambda", params: [x], body: chain }), args: [m.scrutinee] } as Node;
  }
  const next: Code = { ...code, nodes };
  return { code: next, info: infer(next, out, undefined, info.options), names: out };
}
