// A fold of a list into a Map that counts (C42h): in
//
//   fold xs
//     nil → empty map
//     cons(x, rest) with counts → update at(counts, k(x), 0, (c) => c + d(x))
//
// where k and d read the item (and steps before them may too) but never
// the rest or counts, the items can be counted in runs, each run into a
// Map of its own from empty, and the runs' Maps then added together key by
// key: Int addition is exact and a Map's entries are in its keys' order,
// so the Map is the fold's whatever the order. On C the runs go to the
// threads (c.ts `par:chunks`), so the item's own work (k and d, a word
// made) and the counting are both shared out, and only the Maps, a few
// and as big as the keys are many, are put together.
//
// Prior art: MapReduce's combiner (Dean and Ghemawat, OSDI 2004), which
// counts each worker's words before they are sent; a Map with + as a
// commutative monoid (Bird and de Moor's homomorphisms of lists).
//
// Matched on the core IR after representations, where `update at` of a
// hash table or a tree is that representation's own job (map-tree.ts), and
// after arithmetic, where + is Int's.

import { isCall, subtree, type Code, type Id, type NodeOf } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { ABORT, CONS, NIL } from "../../ters/src/lang/std.ts";
import { ownEffects } from "../../ters/src/lang/pure-branches.ts";
import { originalOf, PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";

const ADDS = new Set(["builtin.int.add", "builtin.arith.add"]);

export function countsInto(code: Code, info: Info, fold: NodeOf<"fold">): boolean {
  const arms = fold.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
  const cons = arms.find((a) => a.variant === CONS), nil = arms.find((a) => a.variant === NIL);
  if (arms.length !== 2 || !cons || !nil || cons.binds.length !== 2 || cons.results[0] || !cons.results[1]) return false;
  const r = cons.results[1]!, rest = cons.binds[1];
  const refTo = (id: Id | undefined): Id | undefined => { const n = id ? code.nodes[id] : undefined; return n?.kind === "ref" ? originalOf(n.target) : undefined; };
  const refs = (id: Id): Id[] => subtree(code, id).flatMap((x) => { const n = code.nodes[x]; return n?.kind === "ref" ? [n.target] : []; });
  // The empty map, as the table's own.
  const z = code.nodes[nil.body];
  // A hash table's or a tree's (map-tree.ts), each with its own update at.
  const emptyAt = [PRELUDE_DEFS["empty table map"], PRELUDE_DEFS["empty tree"]].find((e) => refTo(nil.body) === e || (z && isCall(z) && !z.args.length && refTo(z.fn) === e));
  if (!emptyAt) return false;
  const updateAt = emptyAt === PRELUDE_DEFS["empty tree"] ? PRELUDE_DEFS["tree update at"] : PRELUDE_DEFS["table update at"];
  // Steps first, (v) => b given e, each e without the rest or counts.
  let at = cons.body;
  for (;;) {
    const n = code.nodes[at];
    if (!n || !isCall(n)) return false;
    const lam = code.nodes[n.fn];
    if (lam?.kind !== "lambda") break;
    if (n.args.length !== lam.params.length || n.args.some((a) => refs(a).some((x) => x === r || x === rest))) return false;
    at = lam.body;
  }
  const call = code.nodes[at];
  if (!call || !isCall(call) || refTo(call.fn) !== updateAt || call.args.length !== 4) return false;
  const [m, key, d, change] = call.args.map((a) => code.nodes[a]);
  if (refTo(m?.id) !== r || refs(key!.id).some((x) => x === r || x === rest)) return false;
  if (d?.kind !== "lit" || d.value !== 0) return false;
  // (c) => c + e, or e + c, e without c, counts or the rest.
  if (change?.kind !== "lambda" || change.params.length !== 1) return false;
  const c = change.params[0], add = code.nodes[change.body];
  if (!add || !isCall(add) || !ADDS.has(refTo(add.fn) ?? "") || add.args.length !== 2) return false;
  const [p, q] = add.args, e = refTo(p) === c ? q : refTo(q) === c ? p : null;
  if (!e || refs(e).some((x) => x === c || x === r || x === rest)) return false;
  // Nothing but computing: an abort met in a run need not be the one the
  // fold in turn meets first.
  const own = ownEffects(code, info, cons.body);
  return !!own && !own.has(ABORT);
}
