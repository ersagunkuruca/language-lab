// Two representations of List in one program (C93 s3,
// docs/design/data/REPRESENTATION-PER-VALUE-2026-11-05.md): what `seeds`
// reach takes `rep` (machine's step loop: arrays), the rest keeps List as
// written (its assembler: cons lists), and a list is converted where it
// crosses from one to the other.
//
// - The seeds' side: every definition the seeds reach. One the other side
//   reaches too (or the library's) is copied, so each side has its own.
// - A type of the program's with a list in a field is on the side that
//   makes it (machine's Machine on the seeds' side, Program on the other).
//   Reading such a field on the other side converts what's read; making
//   one there converts what goes in.
// - A call from the other side of a seed converts the lists it hands in
//   (`store`, n) and the list it gets back (`meaning`, n).
// Only a plain `List x` (no list inside x) is converted; a list anywhere
// else that crosses (a list of lists, a pair of lists, a function on
// lists) is refused, and so is a seed used as a value. Null where refused.
// SETL's representation sublanguage converted where a value moved between
// variables represented differently (Schonberg, Schwartz and Sharir, 1981).

import { dependencies, freshId, mapIds, merge, subtree, isCall, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { listBoundary, treesFor } from "./library-reps.ts";
import { represent, type Representation } from "./represent.ts";
import { LIST } from "./std.ts";
import type { Type } from "./types.ts";

export interface Split { code: Code; names: Names; seeds: Id[]; copies: Id[]; types: Id[] }

export function splitLists(code: Code, info: Info, names: Names, own: Id[], main: Id, seeds: Id[], rep: Representation): Split | null {
  if (!rep.meaning || !rep.store) return null;
  code = merge(treesFor(code, [rep]), code);
  const nodes: Record<Id, Node> = { ...code.nodes };
  const isDef = (d: Id) => code.nodes[d]?.kind === "def";
  const isType = (d: Id) => isDef(d) && code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""]?.kind === "typedef";
  // The representation's own code stays as it is.
  const repOwn = new Set<Id>();
  for (const d of [...Object.values(rep.impl), rep.meaning, rep.store]) { repOwn.add(d); if (code.nodes[d]) for (const x of dependencies(code, d)) repOwn.add(x); }
  const refsOf = (d: Id) => subtree(code, d).flatMap((x) => { const n = code.nodes[x]; return n.kind === "ref" && isDef(n.target) && !isType(n.target) && !repOwn.has(n.target) && !rep.impl[n.target] ? [n.target] : []; });
  const reach = (roots: Id[], stop: Set<Id>) => {
    const seen = new Set<Id>(), todo = [...roots];
    while (todo.length) { const d = todo.pop()!; if (seen.has(d) || stop.has(d)) continue; seen.add(d); todo.push(...refsOf(d)); }
    return seen;
  };
  // The program's types with a list in a field, by the side that makes them.
  const fieldType = (fl: Id) => code.nodes[(code.nodes[fl] as NodeOf<"field">).type];
  const holders = new Map<Id, Id>();   // variant or field → its type
  for (const d of own) {
    if (!isType(d)) continue;
    const t = code.nodes[(code.nodes[d] as NodeOf<"def">).body!] as NodeOf<"typedef">;
    const vs = t.variants.map((v) => code.nodes[v] as NodeOf<"variant">);
    if (!vs.some((v) => v.fields.some((fl) => { const ty = fieldType(fl); return ty?.kind === "tref" && ty.target === LIST; }))) continue;
    for (const v of vs) { holders.set(v.id, d); for (const fl of v.fields) holders.set(fl, d); }
  }
  const madeBy = (d: Id) => new Set(subtree(code, d).flatMap((x) => {
    const n = code.nodes[x];
    if (!isCall(n)) return [];
    const fn = code.nodes[n.fn];
    return fn?.kind === "ref" && code.nodes[fn.target]?.kind === "variant" && holders.has(fn.target) ? [holders.get(fn.target)!] : [];
  }));
  // A definition of the other side making a type the seeds' side makes is
  // a seed too: the other side calls it, converting.
  const seedSet = new Set(seeds);
  let aw: Set<Id>, bw: Set<Id>, aTypes: Set<Id>;
  for (;;) {
    aw = reach([...seedSet], new Set());
    bw = reach([main], seedSet);
    aTypes = new Set([...aw].flatMap((d) => [...madeBy(d)]));
    const more = [...bw].filter((d) => [...madeBy(d)].some((t) => aTypes.has(t)));
    if (!more.length) break;
    if (more.includes(main)) return null;
    more.forEach((d) => seedSet.add(d));
  }
  const ownSet = new Set(own);
  // Copied for the seeds' side: what the other side reaches too, and the
  // library's.
  const shared = [...aw].filter((d) => bw.has(d) || !ownSet.has(d));
  const fresh = new Map<Id, Id>();
  for (const d of shared) for (const id of subtree(code, d)) fresh.set(id, freshId());
  const f = (id: Id) => fresh.get(id) ?? id;
  for (const d of shared) for (const id of subtree(code, d)) { const n = mapIds(code.nodes[id], f); nodes[n.id] = n; }
  const aOnly = [...aw].filter((d) => !fresh.has(d));
  for (const d of aOnly) for (const id of subtree(code, d)) nodes[id] = mapIds(code.nodes[id], f);
  const aDefs = [...aOnly, ...shared.map(f)];
  const bDefs = [...bw];
  seeds = [...seedSet];

  // Checked with the copies, before anything is converted.
  const outNames: Names = { ...names, ...Object.fromEntries(shared.map((d) => [f(d), names[d] ?? d])) };
  const checked = infer({ nodes, defs: [...code.defs, ...shared.map(f)] }, outNames, undefined, info.options);
  if (checked.errors.length > info.errors.length) return null;
  const wrapped = new Map<Id, Id>();
  const typeOf = (id: Id): Type | undefined => { const t = checked.typeOf.get(wrapped.get(id) ?? id); return t && checked.subst.zonk(t); };
  const hasList = (t: Type): boolean => t.t === "con" ? t.id === LIST || t.args.some(hasList) : t.t === "fn" ? [...t.params, t.ret].some(hasList) : false;
  const plain = (t: Type | undefined) => !!t && t.t === "con" && t.id === LIST && !t.args.some(hasList);
  // Whether a value of type t can cross as it is: no list but inside the
  // program's types, which convert their own fields.
  const crosses = (t: Type | undefined) => !t || !hasList(t);
  let refused = false;
  const ref = (target: Id) => { const id = freshId(); nodes[id] = { id, kind: "ref", target }; return id; };
  // Node `id` becomes conv(what it was).
  const wrap = (id: Id, conv: Id) => {
    const inner = freshId();
    nodes[inner] = { ...nodes[id], id: inner } as Node;
    wrapped.set(inner, wrapped.get(id) ?? id);
    nodes[id] = { id, kind: "call", fn: ref(conv), args: [inner] } as Node;
  };
  // On side `a` (the seeds') or not: what's read from the other side's
  // types, and what goes into them.
  const convert = (defs: Id[], a: boolean) => {
    const other = (t: Id) => (a ? !aTypes.has(t) : aTypes.has(t));
    const into = a ? rep.meaning! : rep.store!, from = a ? rep.store! : rep.meaning!;
    for (const d of defs) for (const id of subtree({ nodes, defs: [] }, d)) {
      const n = nodes[id];
      if (n.kind === "arm" && holders.has(n.variant) && other(holders.get(n.variant)!)) {
        // A match on one: its list binders converted, by a let.
        n.binds.forEach((b, i) => {
          if (!b) return;
          const t = typeOf(b);
          if (crosses(t)) return;
          if (!plain(t)) { refused = true; return; }
          const b2 = freshId(), call = freshId(), lam = freshId();
          nodes[b2] = { id: b2, kind: "binder" } as Node;
          nodes[lam] = { id: lam, kind: "lambda", params: [b], body: (nodes[id] as NodeOf<"arm">).body } as Node;
          const conv = freshId();
          nodes[conv] = { id: conv, kind: "call", fn: ref(from), args: [ref(b2)] } as Node;
          nodes[call] = { id: call, kind: "call", fn: lam, args: [conv] } as Node;
          const arm = nodes[id] as NodeOf<"arm">;
          nodes[id] = { ...arm, binds: arm.binds.map((x, j) => (j === i ? b2 : x)), body: call } as Node;
        });
        continue;
      }
      if (n.kind === "ref" && !isCall(n) && seedSet.has(n.target) && !a) {
        // A seed used other than called, from the other side.
        const t = typeOf(id);
        if (!crosses(t)) {
          const parent = Object.values(nodes).find((p) => isCall(p) && p.fn === id);
          if (!parent) refused = true;
        }
        continue;
      }
      if (!isCall(n)) continue;
      const fn = nodes[n.fn];
      if (fn?.kind !== "ref") continue;
      const target = fn.target;
      const field = code.nodes[target]?.kind === "field" && holders.has(target) && other(holders.get(target)!);
      const variant = code.nodes[target]?.kind === "variant" && holders.has(target) && other(holders.get(target)!);
      const seed = !a && seedSet.has(target);
      if (!field && !variant && !seed) continue;
      if (variant || seed) n.args.forEach((x) => { const t = typeOf(x); if (crosses(t)) return; if (!plain(t)) { refused = true; return; } wrap(x, variant ? into : rep.store!); });
      if (field || seed) { const t = typeOf(id); if (crosses(t)) continue; if (!plain(t)) { refused = true; continue; } wrap(id, field ? from : rep.meaning!); }
    }
  };
  convert(aDefs, true);
  convert(bDefs, false);
  if (refused) return null;
  const seedsNow = seeds.map(f);
  let out: Code = { nodes, defs: [...code.defs, ...shared.map(f)] };
  // Builtins on lists the seeds' side calls: given its lists as written
  // and theirs stored, as with one representation (library-reps.ts).
  const types = [...aTypes];
  const boundary = listBoundary(out, checked, aDefs, rep, [], new Set(own.filter(isType)));
  if (!boundary) return null;
  out = { nodes: { ...out.nodes, ...boundary.nodes }, defs: [...out.defs, ...boundary.made] };
  out = represent(out, [...aDefs, ...types], rep, [...boundary.made, ...bDefs, ...own.filter((d) => isType(d) && !aTypes.has(d))]);
  return { code: out, names: { ...outNames, ...Object.fromEntries(boundary.made.map((d) => [d, "stored list"])) }, seeds: seedsNow, copies: shared.map(f), types };
}
