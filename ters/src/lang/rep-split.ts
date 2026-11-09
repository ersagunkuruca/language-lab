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
// A value of any type with lists in it is converted by a function made for
// its type (C196): a list item by item where its items hold lists, a pair
// or an option case by case, a function its inputs one way and its answer
// the other, so a seed used as a value too (spacetime's). A type of the
// program's own with a list among its type's arguments, or a library type
// that isn't data (a Cell of lists), is refused. Null where refused.
// SETL's representation sublanguage converted where a value moved between
// variables represented differently (Schonberg, Schwartz and Sharir, 1981).

import { dependencies, freshId, mapIds, merge, subtree, isCall, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { BY_VALUE, listBoundary, treesFor } from "./library-reps.ts";
import { represent, type Representation } from "./represent.ts";
import { Lang } from "./dsl.ts";
import { LIBRARY } from "./library.ts";
import { LIST } from "./std.ts";

// The prelude's map, as written: the conversions' own, which the rewrite
// leaves alone.
const MAP_FN = LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === "map")!;
import type { Type } from "./types.ts";

export interface Split { code: Code; names: Names; seeds: Id[]; copies: Id[]; types: Id[] }

// `deep`: every type holding lists converts (C196); otherwise only a plain
// `List x` does, as C93's splits by position have it.
export function splitLists(code: Code, info: Info, names: Names, own: Id[], main: Id, seeds: Id[], rep: Representation, deep = false): Split | null {
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
  // A value no list can cross in, the program's types aside that hold
  // lists only inside the library's own (Space's Algebra, whose lists stay
  // as written whatever the program's are).
  const ownSet0 = new Set(own);
  const ownHolds = new Map<Id, boolean>();
  const treeLists = (n: Node | undefined): boolean => {
    if (n?.kind === "tfun") return [...n.params, n.result].some((x) => treeLists(code.nodes[x]));
    if (n?.kind !== "tref") return false;
    return n.target === LIST || (ownSet0.has(n.target) && holdsOwn(n.target)) || n.args.some((x) => treeLists(code.nodes[x]));
  };
  const holdsOwn = (d: Id): boolean => {
    if (ownHolds.has(d)) return ownHolds.get(d)!;
    ownHolds.set(d, false);
    const t = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""] as NodeOf<"typedef"> | undefined;
    const r = !!t && t.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((fl) => treeLists(code.nodes[(code.nodes[fl] as NodeOf<"field">).type])));
    ownHolds.set(d, r);
    return r;
  };
  const free = (t: Type | undefined): boolean => {
    if (!t) return false;
    t = info.subst.zonk(t);
    if (t.t === "fn") return [...t.params, t.ret].every(free);
    if (t.t !== "con") return true;
    if (t.id === LIST || (ownSet0.has(t.id) && holdsOwn(t.id))) return false;
    return t.args.every(free);
  };
  // The seeds' side reaches what it calls, but for a definition it only
  // ever calls with values no list crosses in (geometric product, given
  // bounce's Space and two multivectors): that one stays as written, its
  // lists (the Algebra's) too, and serves both sides.
  const asWritten = new Set<Id>();
  const reachSeeds = (roots: Id[]) => {
    const seen = new Set<Id>(), todo = [...roots];
    while (todo.length) {
      const d = todo.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      for (const x of subtree(code, d)) {
        const n = code.nodes[x];
        if (n.kind !== "ref" || !isDef(n.target) || isType(n.target) || repOwn.has(n.target) || rep.impl[n.target]) continue;
        if (!seedSet.has(n.target) && free(info.typeOf.get(x))) { asWritten.add(n.target); continue; }
        todo.push(n.target);
      }
    }
    return seen;
  };
  let aw: Set<Id>, bw: Set<Id>, aTypes: Set<Id>;
  for (;;) {
    asWritten.clear();
    aw = deep ? reachSeeds([...seedSet]) : reach([...seedSet], new Set());
    bw = reach([main], seedSet);
    aTypes = new Set([...aw].flatMap((d) => [...madeBy(d)]));
    const more = [...bw].filter((d) => [...madeBy(d)].some((t) => aTypes.has(t)));
    if (!more.length) break;
    if (more.includes(main)) return null;
    more.forEach((d) => seedSet.add(d));
  }
  const ownSet = new Set(own);
  // Copied for the seeds' side: what the other side reaches too, and the
  // library's, but for a library definition with no list in it or in what
  // it reaches (conjugate, inverse, louder), which the rewrite leaves as it
  // is: a copy would hide it from what knows it by its id (the compiler's
  // inverses.ts) and be checked again (C196).
  const listed = (t: Type | undefined): boolean => { if (!t) return false; t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || t.args.some(listed) : t.t === "fn" ? [...t.params, t.ret].some(listed) : false; };
  const listFree = (d: Id) => [d, ...dependencies(code, d)].every((x) => !isDef(x) || !subtree(code, x).some((y) => listed(info.typeOf.get(y))));
  const kept = new Set([...aw].filter((d) => !ownSet.has(d) && listFree(d)));
  const shared = [...aw].filter((d) => (bw.has(d) || !ownSet.has(d)) && !kept.has(d));
  const fresh = new Map<Id, Id>(), origin = new Map<Id, Id>();
  for (const d of shared) for (const id of subtree(code, d)) { const x = freshId(); fresh.set(id, x); origin.set(x, id); }
  const f = (id: Id) => fresh.get(id) ?? id;
  for (const d of shared) for (const id of subtree(code, d)) { const n = mapIds(code.nodes[id], f); nodes[n.id] = n; }
  // The library's kept as they are: its nodes untouched, so the check
  // still reads through to the library's (infer.ts `under`).
  const aOnly = [...aw].filter((d) => !fresh.has(d) && !kept.has(d));
  for (const d of aOnly) for (const id of subtree(code, d)) nodes[id] = mapIds(code.nodes[id], f);
  const aDefs = [...aOnly, ...shared.map(f)];
  const bDefs = [...bw];
  seeds = [...seedSet];

  const outNames: Names = { ...names, ...Object.fromEntries(shared.map((d) => [f(d), names[d] ?? d])) };
  const wrapped = new Map<Id, Id>();
  // A copy's node has its original's type.
  const typed = { ...info, typeOf: { get: (id: Id) => info.typeOf.get(origin.get(id) ?? id) } as Info["typeOf"] };
  const typeOf = (id: Id): Type | undefined => { const t = typed.typeOf.get(wrapped.get(id) ?? id); return t && info.subst.zonk(t); };
  const hasList = (t: Type): boolean => t.t === "con" ? t.id === LIST || t.args.some(hasList) : t.t === "fn" ? [...t.params, t.ret].some(hasList) : false;
  // Whether a value of type t can cross as it is: no list but inside the
  // program's types, which convert their own fields.
  const crosses = (t: Type | undefined) => !t || !hasList(t);
  // The functions converting a type's values: `stored` (each list in it as
  // the row has it), or back to lists as written. Null where it can't.
  const k = new Lang({ nodes, defs: code.defs });
  const convs = new Map<string, Id | null>(), pending = new Set<string>();
  const keyOf = (t: Type): string => (t.t === "con" ? `${t.id}(${t.args.map(keyOf).join(",")})` : t.t === "fn" ? `(${t.params.map(keyOf).join(",")})${keyOf(t.ret)}` : "?");
  const converter = (t0: Type, stored: boolean): Id | null => {
    const t = info.subst.zonk(t0);
    if (!deep && !(t.t === "con" && t.id === LIST && !t.args.some(hasList))) return null;
    const ks = `${stored}${keyOf(t)}`;
    if (convs.has(ks)) return convs.get(ks)!;
    if (pending.has(ks)) return null;
    pending.add(ks);
    const made = convertOf(t, stored);
    pending.delete(ks);
    convs.set(ks, made);
    return made;
  };
  const convertOf = (t: Type, stored: boolean): Id | null => {
    // Identity where it holds no list.
    const each = (x: Type, way: boolean): Id | null | false => (crosses(x) ? false : converter(x, way));
    if (t.t === "fn") {
      const ps = t.params.map((p) => each(p, !stored)), r = each(t.ret, stored);
      if (ps.includes(null) || r === null) return null;
      const d = k.def(stored ? "stored function" : "function on lists");
      k.define(d, k.fn(["f"], (f) => k.fn(t.params.map((_, i) => `x${i + 1}`), (...xs) => {
        const out = k.call(f, ...xs.map((x, i) => (ps[i] ? k.call(ps[i] as Id, x) : x)));
        return r ? k.call(r, out) : out;
      })));
      return d;
    }
    if (t.t !== "con") return null;
    if (t.id === LIST) {
      const item = each(t.args[0], stored);
      if (item === null) return null;
      if (!item) return stored ? rep.store! : rep.meaning!;
      const d = k.def(stored ? "stored lists" : "lists as written");
      k.define(d, k.fn(["list"], (l) => (stored ? k.call(rep.store!, k.call(MAP_FN, l, k.x(item))) : k.call(MAP_FN, k.call(rep.meaning!, l), k.x(item)))));
      return d;
    }
    // The program's own types convert their own fields where they're read
    // and made (above), unless a list is among their arguments.
    if (ownSet.has(t.id)) return null;
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.effect || td.interface) return null;
    const params = new Map(td.params.map((q, i) => [q, t.args[i]] as const));
    const fieldType = (id: Id): Type | null => {
      const n = code.nodes[id];
      if (n?.kind !== "tref") return null;
      const own = params.get(n.target);
      if (own) return own;
      const args = n.args.map(fieldType);
      return args.every((x) => x) ? { t: "con", id: n.target, args: args as Type[] } : null;
    };
    const variants = td.variants.map((v) => code.nodes[v] as NodeOf<"variant">);
    const fields = variants.map((v) => v.fields.map((fl) => fieldType((code.nodes[fl] as NodeOf<"field">).type)));
    if (fields.some((fs) => fs.some((x) => !x))) return null;
    const convs2 = fields.map((fs) => fs.map((x) => each(x!, stored)));
    if (convs2.some((cs) => cs.includes(null))) return null;
    const d = k.def(stored ? "stored" : "as written");
    k.define(d, k.fn(["value"], (x) => k.match(x, variants.map((v, j) => ({
      variant: v.id, names: v.fields.map((_, i) => `field ${i + 1}`),
      body: (xs: Id[]) => (xs.length ? k.call(v.id, ...xs.map((y, i) => (convs2[j][i] ? k.call(convs2[j][i] as Id, y) : y))) : k.x(v.id)),
    })))));
    return d;
  };
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
    for (const d of defs) for (const id of subtree({ nodes, defs: [] }, d)) {
      const n = nodes[id];
      if (n.kind === "arm" && holders.has(n.variant) && other(holders.get(n.variant)!)) {
        // A match on one: its list binders converted, by a let.
        n.binds.forEach((b, i) => {
          if (!b) return;
          const t = typeOf(b);
          if (crosses(t)) return;
          const from = converter(t!, a);
          if (!from) { refused = true; return; }
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
          // Converted as a function from this side (a call converts at the call).
          const parent = Object.values(nodes).find((p) => isCall(p) && p.fn === id);
          if (!parent) { const c = deep && converter(t!, false); if (c) wrap(id, c); else refused = true; }
        }
        continue;
      }
      if (!isCall(n)) continue;
      const fn = nodes[n.fn];
      if (fn?.kind !== "ref") continue;
      const target = fn.target;
      // equal, show or compare on a list of the seeds' side, which the
      // whole program's row rewrites by type: not here.
      if (a && target in BY_VALUE && n.args.some((x) => !crosses(typeOf(x)))) { refused = true; continue; }
      const field = code.nodes[target]?.kind === "field" && holders.has(target) && other(holders.get(target)!);
      const variant = code.nodes[target]?.kind === "variant" && holders.has(target) && other(holders.get(target)!);
      const seed = !a && seedSet.has(target);
      if (!field && !variant && !seed) continue;
      if (variant || seed) n.args.forEach((x) => { const t = typeOf(x); if (crosses(t)) return; const c = converter(t!, variant ? !a : true); if (!c) { refused = true; return; } wrap(x, c); });
      if (field || seed) { const t = typeOf(id); if (crosses(t)) continue; const c = converter(t!, field ? a : false); if (!c) { refused = true; continue; } wrap(id, c); }
    }
  };
  convert(aDefs, true);
  convert(bDefs, false);
  if (refused) return null;
  const seedsNow = seeds.map(f);
  let out: Code = { nodes: { ...nodes, ...k.code.nodes }, defs: [...code.defs, ...shared.map(f), ...k.code.defs] };
  // Builtins on lists the seeds' side calls: given its lists as written
  // and theirs stored, as with one representation (library-reps.ts).
  const types = [...aTypes];
  const boundary = listBoundary(out, typed, aDefs, rep, [], new Set(own.filter(isType)), new Set([...[...asWritten].filter((d) => !aw.has(d)), rep.meaning, rep.store, ...k.code.defs]));
  if (!boundary) return null;
  out = { nodes: { ...out.nodes, ...boundary.nodes }, defs: [...out.defs, ...boundary.made] };
  out = represent(out, [...aDefs, ...types], rep, [...boundary.made, ...k.code.defs, ...bDefs, ...[...asWritten].filter((d) => !aw.has(d)), ...own.filter((d) => isType(d) && !aTypes.has(d))]);
  return { code: out, names: { ...outNames, ...k.names, ...Object.fromEntries(boundary.made.map((d) => [d, "stored list"])) }, seeds: seedsNow, copies: shared.map(f), types };
}
