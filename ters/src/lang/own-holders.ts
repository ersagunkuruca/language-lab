// Library types that hold lists, made the program's own (C58d): std's
// Pool keeps its items and generations in lists, which a program's
// chooser can store as arrays (library-reps.ts) only where every list the
// program reaches can be one. A list inside a library type can't: the
// rewrite changes the program's definitions, and the library type's fields
// stay List while the values in them would be arrays (listBoundary's
// `libraryHolder`). So swarm on a Pool kept its slots as lists, and each
// lookup walked them: 190 s against the Map version's 2.6 s.
//
// Here such a type, and each library definition that uses it, are copied
// into the program under fresh ids, the program's uses moved onto the
// copies. The copies are the program's own, so the chooser changes them
// with the rest, and the library's stay as they are. Only plain data
// types the library writes in the language and nothing else knows by id
// (HOLDERS: Pool, Queue). Html, Attribute, Algebra and the rest are known
// to the compiler and the page runtime by their ids, and a type a builtin
// makes or takes is built by its runtime as the original, so they stay.

import { dependencies, freshId, mapIds, subtree, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { LIBRARY } from "./library.ts";
import { COPIED_FROM, originalOf } from "./prelude-ids.ts";
import { LIST, POOL, QUEUE, SIGS } from "./std.ts";

const HOLDERS = new Set<Id>([POOL, QUEUE]);
import { Subst, type Type } from "./types.ts";

// The type ids builtins' signatures name.
let builtinTypes: Set<Id> | undefined;
function namedByBuiltins(): Set<Id> {
  if (builtinTypes) return builtinTypes;
  const out = new Set<Id>();
  const walk = (t: Type): void => {
    if (t.t === "con") { out.add(t.id); t.args.forEach(walk); }
    else if (t.t === "fn") { t.params.forEach(walk); walk(t.ret); }
  };
  for (const sig of Object.values(SIGS)) { try { walk(sig(new Subst())); } catch { /* a signature that needs more than a fresh substitution */ } }
  return (builtinTypes = out);
}

export interface Owned { code: Code; names: Names; own: Id[]; info: Info; copied: string[] }

export function ownLibraryHolders(code: Code, info: Info, names: Names, main: Id, own: Id[]): Owned | null {
  const mine = new Set(own);
  const isTypedef = (d: Id) => code.nodes[(code.nodes[d] as NodeOf<"def"> | undefined)?.body ?? ""]?.kind === "typedef";
  const reached = new Set<Id>([main, ...dependencies(code, main), ...own.flatMap((d) => [d, ...dependencies(code, d)])]);
  const stored = new Set(LIBRARY.reps.map((r) => r.of)), byBuiltins = namedByBuiltins();
  // Whether a type's fields name a list, through the types they name.
  const memo = new Map<Id, boolean>();
  const holdsList = (id: Id): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, false);
    const td = code.nodes[(code.nodes[id] as NodeOf<"def"> | undefined)?.body ?? ""];
    const names_ = (n: Id): boolean => {
      const x = code.nodes[n];
      if (x?.kind === "tref") return x.target === LIST || holdsList(x.target) || x.args.some(names_);
      if (x?.kind === "tfun") return [...x.params, x.result].some(names_);
      return false;
    };
    const r = td?.kind === "typedef" && td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => names_((code.nodes[f] as NodeOf<"field">).type)));
    memo.set(id, r);
    return r;
  };
  const types = [...reached].filter((d) => HOLDERS.has(d) && !mine.has(d) && isTypedef(d) && d !== LIST && !stored.has(d) && !byBuiltins.has(d) && holdsList(d)
    && (() => { const td = code.nodes[(code.nodes[d] as NodeOf<"def">).body!] as NodeOf<"typedef">; return !td.effect && !td.interface; })());
  if (!types.length) return null;
  // Every id inside a copied type, and the library definitions that name
  // one of them or a copied definition, until none is left.
  const copiedIds = new Set<Id>(types.flatMap((d) => subtree(code, d)));
  const copiedDefs = new Set<Id>(types);
  for (let grew = true; grew;) {
    grew = false;
    for (const d of reached) {
      if (mine.has(d) || copiedDefs.has(d) || code.nodes[d]?.kind !== "def" || isTypedef(d)) continue;
      const uses = subtree(code, d).some((id) => {
        const n = code.nodes[id];
        const t = n.kind === "ref" || n.kind === "tref" ? n.target : n.kind === "arm" ? n.variant : null;
        return !!t && (copiedIds.has(t) || copiedDefs.has(t));
      });
      if (uses) { copiedDefs.add(d); for (const id of subtree(code, d)) copiedIds.add(id); grew = true; }
    }
  }
  const fresh = new Map<Id, Id>();
  for (const d of copiedDefs) for (const id of subtree(code, d)) fresh.set(id, freshId());
  const f = (id: Id) => fresh.get(id) ?? id;
  const nodes: Record<Id, Node> = { ...code.nodes };
  for (const d of copiedDefs) for (const id of subtree(code, d)) { const n = mapIds(code.nodes[id], f); nodes[n.id] = n; }
  for (const d of own) for (const id of subtree(code, d)) nodes[id] = mapIds(code.nodes[id], f);
  const copies = [...copiedDefs].map(f);
  for (const d of copiedDefs) COPIED_FROM.set(f(d), originalOf(d));
  const out: Code = { nodes, defs: [...code.defs, ...copies] };
  const outNames: Names = { ...names };
  for (const [from, to] of fresh) { const n = names[from] ?? LIBRARY.names[from]; if (n !== undefined) outNames[to] = n; }
  const checked = infer(out, outNames, undefined, { ...info.options, units: false });
  if (checked.errors.length > info.errors.length) return null;
  return { code: out, names: outNames, own: [...own, ...copies], info: checked, copied: types.map((d) => names[d] ?? LIBRARY.names[d] ?? d) };
}
