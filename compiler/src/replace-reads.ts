// A list with one item replaced, written as a map over it numbered (C330,
// GAPS.md round 24 TG1: typeset's `offer`):
//
//   map(numbered(xs), (p) => if p.first = c then v else p.second)
//
// read as `replace at(xs, c, v)`. As written, `numbered` makes a list of
// pairs, `map` a list of what the function gives, each item a call of it,
// and each map asks whether the workers would help; `replace at` copies
// the items before position c and shares the rest (an array: one copy,
// array-list.ts). The list chooser then stores xs as it would for the
// library's word.
//
// The answer is the same: a position is never negative, so one below 0
// keeps the list as it is, as `replace at` does, and so does a position
// past its end. Where c is the position, v is given there. The two read c
// and v a different number of times (the map once an item, `replace at`
// once), so both only compute: no effect, not even running long (a v that
// never ends, asked of a position past the end, the map never asks).
//
// Taken in the program's own definitions, before the list chooser
// (ters/cli/represented.ts).

import { freshId, isCall, subtree, copyNodes, dropNode, changedOver, type Code, type Id, type Node, type NodeOf } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, inferRewritten, type Info, type Options } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { FALSE, FIRST, SECOND, TRUE } from "../../ters/src/lang/std.ts";
import { does } from "./fuse-steps.ts";

const MAP = preludeDef("map"), NUMBERED = preludeDef("numbered"), REPLACE_AT = preludeDef("replace at");
const EQUAL = "builtin.equal";

interface Read { at: Id; xs: Id; c: Id; v: Id; gone: Id[] }

export function replaceReads(code: Code, info: Info, names: Names, own: Id[], opts: Options): { code: Code; info: Info; read: number } | null {
  if (!MAP || !NUMBERED || !REPLACE_AT) return null;
  const reads: Read[] = [];
  for (const d of own) for (const id of subtree(code, d)) {
    const r = readOf(code, info, id);
    if (r) reads.push(r);
  }
  if (!reads.length) return null;
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  for (const r of reads) {
    const f = freshId();
    nodes[f] = { id: f, kind: "ref", target: REPLACE_AT };
    nodes[r.at] = { id: r.at, kind: "call", fn: f, args: [r.xs, r.c, r.v] } as Node;
    for (const g of r.gone) dropNode(nodes, g);
  }
  const next: Code = { ...code, nodes };
  const changed = changedOver(code.nodes, nodes);
  const checked = info.options === opts && changed ? inferRewritten(code, next, names, info, [...changed].filter((id) => code.nodes[id] !== undefined), []) : infer(next, names, undefined, opts);
  if (checked.errors.length > info.errors.length) return null;
  return { code: next, info: checked, read: reads.length };
}

// The call at `id`, when it is such a map.
function readOf(code: Code, info: Info, id: Id): Read | null {
  const n = code.nodes[id];
  if (!isCall(n) || n.args?.length !== 2 || refTo(code, n.fn) !== MAP) return null;
  const [made, fn] = n.args;
  const m = code.nodes[made];
  if (!isCall(m) || m.args?.length !== 1 || refTo(code, m.fn) !== NUMBERED) return null;
  const lam = code.nodes[fn];
  if (lam?.kind !== "lambda" || lam.params.length !== 1) return null;
  const p = lam.params[0];
  const body = code.nodes[lam.body];
  if (body?.kind !== "match") return null;
  // `if` is a match on a truth value: its arms true and false, or one of
  // them and otherwise.
  const arms = body.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
  if (arms.some((a) => a?.kind !== "arm" || a.binds.length)) return null;
  const yes = arms.find((a) => a.variant === TRUE)?.body, no = arms.find((a) => a.variant === FALSE)?.body ?? body.otherwise ?? undefined;
  if (!yes || !no || arms.length + (body.otherwise ? 1 : 0) !== 2) return null;
  const test = code.nodes[body.scrutinee];
  if (!isCall(test) || test.args?.length !== 2 || refTo(code, test.fn) !== EQUAL) return null;
  const isP = (x: Id) => refTo(code, x) === p;
  const partOf = (x: Id, part: Id) => { const c = code.nodes[x]; return isCall(c) && c.args?.length === 1 && refTo(code, c.fn) === part && isP(c.args[0]); };
  const [l, r] = test.args;
  const c = partOf(l, FIRST) ? r : partOf(r, FIRST) ? l : null;
  if (!c || !partOf(no, SECOND)) return null;
  const reads = (x: Id) => subtree(code, x).some((y) => refTo(code, y) === p);
  if (reads(c) || reads(yes)) return null;
  const pure = (x: Id) => does(code, info, x)?.size === 0;
  if (!pure(c) || !pure(yes)) return null;
  const xs = m.args[0];
  const kept = new Set([...subtree(code, xs), ...subtree(code, c), ...subtree(code, yes)]);
  const gone = [...subtree(code, made), ...subtree(code, fn), n.fn].filter((x) => !kept.has(x));
  return { at: id, xs, c, v: yes, gone };
}

const refTo = (code: Code, id: Id): Id | undefined => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : undefined; };
