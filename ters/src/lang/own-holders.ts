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
// (HOLDERS: Pool, Queue; and a representation's own type holding lists,
// a pool's slots, once it is chosen: library-reps.ts). Html, Attribute, Algebra and the rest are known
// to the compiler and the page runtime by their ids, and a type a builtin
// makes or takes is built by its runtime as the original, so they stay.

import { dependenciesOfAll, freshId, mapIds, subtree, type Code, type Id, type Node, type NodeOf, copyNodes } from "../model.ts";
import type { Names } from "../presentation.ts";
import { checksKept, infer, type Info } from "./infer.ts";
import { stableIds } from "../stable-ids.ts";
import { LIBRARY } from "./library.ts";
import { COPIED_FROM, originalOf } from "./prelude-ids.ts";
import { BOOL, LIST, POOL, QUEUE, SIGS } from "./std.ts";

const HOLDERS = new Set<Id>([POOL, QUEUE]);
import { INT, NUMBER, STRING, Subst, type Type } from "./types.ts";

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

// And a plain record of the library's holding lists of lists (L271c: the
// sounds module's Sound, its channels a List (List Float64)): no
// parameters, its fields numbers, truths, texts and lists of them only,
// so nothing else of the library's is inside. One whose lists are all of
// plain items (Bytes) is an edge's instead (library-reps.ts listEdges),
// kept as written and converted where it crosses. A builtin naming it
// keeps it the library's (below).
const LEAVES = new Set<Id>([NUMBER, INT, STRING, BOOL]);
function plainHolders(code: Code): Id[] {
  const leaf = (n: Id): boolean => { const x = code.nodes[n]; return x?.kind === "tref" && (x.target === LIST ? x.args.length === 1 && leaf(x.args[0]) : LEAVES.has(x.target) && !x.args.length); };
  const nested = (n: Id): boolean => { const x = code.nodes[n], a = x?.kind === "tref" && x.target === LIST ? code.nodes[x.args[0]] : undefined; return a?.kind === "tref" && a.target === LIST; };
  return code.defs.filter((d) => {
    if (!LIBRARY.code.nodes[d]) return false;
    const td = code.nodes[(code.nodes[d] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.params.length) return false;
    const fields = td.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant">).fields.map((f) => (code.nodes[f] as NodeOf<"field">).type));
    return fields.some(nested) && fields.every(leaf);
  });
}

export interface Owned { code: Code; names: Names; own: Id[]; info: Info; copied: string[] }

export function ownLibraryHolders(code: Code, info: Info, names: Names, main: Id, own: Id[], more: Iterable<Id> = []): Owned | null {
  const plain = new Set(plainHolders(code)), holders = new Set([...HOLDERS, ...more, ...plain]);
  const mine = new Set(own);
  const isTypedef = (d: Id) => code.nodes[(code.nodes[d] as NodeOf<"def"> | undefined)?.body ?? ""]?.kind === "typedef";
  // Each definition walked once, not once for every own definition that
  // reaches it (L266: 125 ms of machine's compile).
  const reached = new Set<Id>([main]);
  dependenciesOfAll(code, [main], reached);
  for (const d of own) if (!reached.has(d)) { reached.add(d); dependenciesOfAll(code, [d], reached); }
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
  const types = [...reached].filter((d) => holders.has(d) && !mine.has(d) && isTypedef(d) && d !== LIST && !stored.has(d) && !byBuiltins.has(d) && holdsList(d)
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
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  for (const d of copiedDefs) for (const id of subtree(code, d)) { const n = mapIds(code.nodes[id], f); nodes[n.id] = n; }
  for (const d of own) for (const id of subtree(code, d)) nodes[id] = mapIds(code.nodes[id], f);
  let copies = [...copiedDefs].map(f);
  // The originals the program no longer reaches leave it where it was
  // reached only through them: a stored type's rewrite (Bytes as a byte
  // array) then changes what the copies call, which the originals would
  // call wrongly (L271c: sound of wav's `bytes as 16 bits`).
  const gone = new Set(types.some((d) => plain.has(d)) ? [...copiedDefs].filter((d) => LIBRARY.code.nodes[d]) : []);
  let out: Code = { nodes, defs: [...code.defs.filter((d) => !gone.has(d)), ...copies] };
  let outNames: Names = { ...names };
  for (const [from, to] of fresh) { const n = names[from] ?? LIBRARY.names[from]; if (n !== undefined) outNames[to] = n; }
  // The copies named by what they hold (stable-ids.ts) where checks are
  // kept, so the check below, and every check after it, finds their groups
  // kept from the last compile: with new ids each compile, greenhouse-page
  // checked 400 groups again after every edit.
  if (checksKept(info.options)) {
    const s = stableIds(out, new Set(fresh.values()), copies, own);
    if (s.rename.size) {
      const g = (id: Id) => s.rename.get(id) ?? id;
      out = s.code;
      copies = copies.map(g);
      const renamed: Names = {};
      for (const k in outNames) renamed[g(k)] = outNames[k];
      outNames = renamed;
      for (const [from, to] of fresh) fresh.set(from, g(to));
    }
  }
  for (const d of copiedDefs) COPIED_FROM.set(fresh.get(d)!, originalOf(d));
  const checked = infer(out, outNames, undefined, { ...info.options, units: false });
  if (checked.errors.length > info.errors.length) return null;
  return { code: out, names: outNames, own: [...own, ...copies], info: checked, copied: types.map((d) => names[d] ?? LIBRARY.names[d] ?? d) };
}
