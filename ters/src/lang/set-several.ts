// Several fields of a record changed at once (BACKLOG L167,
// REVIEW-2026-11-02d §1), written out as one `set` per field before
// anything runs.
//
// `set((m) ↦ (m.pc, m.registers), machine, (pc, registers))` is the
// machine with both fields changed. The checker has made sure the path is
// a tuple of field paths from its parameter, none twice and none inside
// another (records.ts `fieldPaths`), so the parts can be set in any order
// and the answer is the same. This code → code pass turns the call into
// nested one-field sets, `set(m ↦ m.pc, set(m ↦ m.registers, machine,
// t.second), t.first)` with the tuple named t first (as spread.ts names
// one), so the evaluator, relate.ts and every compiler target see the
// `set` they already run. A tuple written in place, `(pc, registers)`, is
// used part by part, with nothing named.
//
// Prior art: OCaml's and Elm's `{ r with a = …; b = … }`, and Haskell's
// record update `r { a = …, b = … }`, which change several fields in one
// expression; here it is `set`'s path given as a tuple, with no new
// construct.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId, isCall, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { fieldPaths } from "./records.ts";
import { SET, tuplePart } from "./std.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

const severalAt = (code: Code, n: Node): Id[][] | null => {
  if (!isCall(n) || n.args.length !== 3) return null;
  const fn = code.nodes[n.fn];
  return fn?.kind === "ref" && fn.target === SET ? fieldPaths(code, n.args[0]) : null;
};

export const usesSetSeveral = (code: Code) => Object.values(code.nodes).some((n) => severalAt(code, n));

export function setSeveral(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const calls = Object.values(code.nodes).flatMap((n) => { const paths = severalAt(code, n); return paths ? [{ id: n.id, paths }] : []; });
  if (!calls.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const out: Names = { ...names };
  for (const { id, paths } of calls) {
    const n = nodes[id] as Call;
    const size = paths.length;
    // One field's path as a lambda of its own: q ↦ q.home.city.
    const one = (path: Id[]) => {
      const q = add({ kind: "binder" });
      out[q] = out[(code.nodes[n.args[0]] as NodeOf<"lambda">).params[0]] ?? "it";
      return add({ kind: "lambda", params: [q], body: path.reduce<Id>((e, f) => add({ kind: "call", fn: ref(f), args: [e] }), ref(q)) });
    };
    const value = nodes[n.args[2]];
    const written = isCall(value) && nodes[value.fn]?.kind === "ref" && (nodes[value.fn] as NodeOf<"ref">).target === `std.tuple${size}.tuple` ? value.args : null;
    const whole = written ? null : add({ kind: "binder" });
    if (whole) out[whole] = "parts";
    const part = (i: number) => (written ? written[i] : add({ kind: "call", fn: ref(tuplePart(size, i)), args: [ref(whole!)] }));
    // Innermost first: the record the person gave, then each field in turn.
    const nested = paths.reduceRight<Id>((record, path, i) => add({ kind: "call", fn: ref(SET), args: [one(path), record, part(i)] }), n.args[1]);
    // The call keeps its id: the outermost set, or the let that names the
    // tuple, (parts ↦ set(…))(value).
    nodes[id] = whole
      ? { id, kind: "call", fn: add({ kind: "lambda", params: [whole], body: nested }), args: [n.args[2]] }
      : { ...(nodes[nested] as Call), id };
    if (!whole) delete nodes[nested];
  }
  const next: Code = { ...code, nodes };
  return { code: next, info: infer(next, out, undefined, info.options), names: out };
}
