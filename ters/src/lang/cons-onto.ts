// A definition building a list by cons onto a call of itself, an item a
// call (pack's `prose`, `cons(word, prose(…))`; its `tokens`), written for
// a row whose cons is a call and whose append is cheap (`tree of List`):
// a copy taking the items so far, appended at the back as each is made,
// so every call of itself is a tail call, a loop on every target (C232).
// As written the cons cell's own tail-modulo-cons made it a loop (C24,
// and C222 for arrays); a tree's cons is a job, a call, and the recursion
// went as deep as the items, past WebAssembly's stack at 6400 words.
//
//   f(p)          = f onto(p, nil)
//   f onto(p, acc) = acc ++ f(p), case by case:
//     nil                → acc
//     cons(x, f(a))      → let item = x in f onto(a, added at end(acc, item))
//     f(a)               → f onto(a, acc)
//
// The item is worked out before the call's inputs, as it was, so what
// fails or prints does so in the same order. Taken only where every way
// out of the body (through its matches and lets) is one of the three, and
// f calls itself nowhere else.

import { freshId, mapIds, subtree, isCall, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { CONS, NIL } from "./std.ts";

export interface ConsOnto { nodes: Record<Id, Node>; made: Id[]; names: Names; copiedFrom: Map<Id, Id> }

// For each of defs that takes it, its rewrite and its copy taking the items
// so far; `atEnd` is the prelude's `added at end`, append(list, [item]),
// which an array does as a push (C250).
export function consOnto(code: Code, names: Names, defs: Id[], atEnd: Id): ConsOnto {
  const out: ConsOnto = { nodes: {}, made: [], names: {}, copiedFrom: new Map() };
  for (const d of defs) {
    const def = code.nodes[d];
    if (def?.kind !== "def" || !def.body) continue;
    const lam = code.nodes[def.body];
    if (lam?.kind !== "lambda" || lam.results) continue;
    const self = (x: Id) => { const n = code.nodes[x]; return n?.kind === "ref" && n.target === d; };
    const selfCall = (x: Id): x is Id => { const n = code.nodes[x]; return isCall(n) && !!n.args && self(n.fn); };
    // The ways out, and the calls of itself they hold; null where one isn't
    // one of the three.
    const tails: Id[] = [], ok = new Set<Id>();
    let conses = 0;
    const walk = (x: Id): boolean => {
      const n = code.nodes[x];
      if (!n) return false;
      if (n.kind === "match") return n.arms.every((a) => walk((code.nodes[a] as NodeOf<"arm">).body));
      if (n.kind === "ref" && n.target === NIL) { tails.push(x); return true; }
      if (!isCall(n) || !n.args) return false;
      const f = code.nodes[n.fn];
      if (f?.kind === "lambda" && f.params.length === n.args.length) return walk(f.body);
      if (self(n.fn)) { tails.push(x); ok.add(x); return true; }
      if (f?.kind === "ref" && f.target === CONS && n.args.length === 2 && selfCall(n.args[1])) { tails.push(x); ok.add(n.args[1]); conses++; return true; }
      return false;
    };
    if (!walk(lam.body) || !conses) continue;
    // Calls of itself only in those places.
    const within = subtree(code, def.body);
    if (within.filter((x) => self(x)).length !== ok.size) continue;
    // The copy: its body's nodes afresh, and one more parameter.
    const fresh = new Map<Id, Id>();
    for (const x of within) fresh.set(x, freshId());
    const f = (x: Id) => fresh.get(x) ?? x;
    const onto = freshId(), acc = freshId(), body = freshId();
    const add = (n: Node) => { out.nodes[n.id] = n; return n.id; };
    const ref = (target: Id) => add({ id: freshId(), kind: "ref", target });
    for (const x of within) out.nodes[f(x)] = mapIds(code.nodes[x], f);
    const tailSet = new Set(tails);
    for (const t of tailSet) {
      const n = code.nodes[t];
      if (n.kind === "ref") { out.nodes[f(t)] = { id: f(t), kind: "ref", target: acc }; continue; }
      const call = n as NodeOf<"call">;
      if (self(call.fn)) { out.nodes[f(t)] = { id: f(t), kind: "call", fn: ref(onto), args: [...call.args!.map(f), ref(acc)] }; continue; }
      // cons(x, f(a)): the item first, as a let, then the call.
      const [item, rest] = call.args!, inner = code.nodes[rest] as NodeOf<"call">;
      const b = add({ id: freshId(), kind: "binder" });
      const grown = add({ id: freshId(), kind: "call", fn: ref(atEnd), args: [ref(acc), ref(b)] });
      const next = add({ id: freshId(), kind: "call", fn: ref(onto), args: [...inner.args!.map(f), grown] });
      const let_ = add({ id: freshId(), kind: "lambda", params: [b], body: next });
      out.nodes[f(t)] = { id: f(t), kind: "call", fn: let_, args: [f(item)] };
      out.names[b] = "item";
    }
    add({ id: acc, kind: "binder" });
    const copied = out.nodes[f(def.body)] as NodeOf<"lambda">;
    out.nodes[f(def.body)] = { ...copied, params: [...copied.params, acc] };
    out.nodes[onto] = { id: onto, kind: "def", body: f(def.body) };
    // The definition itself: its copy given nothing so far.
    const params = lam.params.map(() => freshId());
    for (const p of params) add({ id: p, kind: "binder" });
    add({ id: body, kind: "lambda", params, body: add({ id: freshId(), kind: "call", fn: ref(onto), args: [...params.map(ref), ref(NIL)] }) });
    out.nodes[d] = { ...def, body };
    lam.params.forEach((p, i) => { if (names[p]) out.names[params[i]] = names[p]; });
    for (const x of within) if (names[x]) out.names[f(x)] = names[x];
    out.names[onto] = `${names[d] ?? "it"} onto`;
    out.names[acc] = "so far";
    out.made.push(onto);
    for (const x of within) out.copiedFrom.set(f(x), x);
  }
  return out;
}
