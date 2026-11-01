// Modules, made of nothing new (LANGUAGE.md, "Modules").
//
// A draft definition has a random id, like every node. Publishing it
// renames it to its content hash (src/hash.ts): the def becomes `@hash`,
// and each node inside it `@hash:n`, n its place in the def. So:
//
//   - two people who publish the same definition publish the same nodes,
//     byte for byte, and putting their code together is a no-op instead of
//     a clash;
//   - a module can be checked against its own ids: rehash it, and every id
//     must come out the same (verify);
//   - an import is a reference. There are no import statements: a program
//     that uses `map` has a ref to `@…`, and loading it means having a
//     module that holds `@…`. Which module is a hint, not identity.
//
// A module is the published nodes plus the same side tables a program has:
// names (the author's; a program can rename anything for itself), a pin for
// each definition (signatures.ts), and which definitions it offers. The rest
// are helpers: usable by the module's own code, kept out of the palette.
// That's the whole design: identity by hash and modules as name layers are
// Unison's (https://www.unison-lang.org/docs/the-big-idea/); visibility and
// pins are what REVIEW.md §4.5 and §4.6 add.

import { children, collect, isPublished, mapIds, merge, subtree, type Code, type Id, type Node } from "../model.ts";
import { defGroups, hashes } from "../hash.ts";
import { layer, type Comments, type Names } from "../presentation.ts";
import { infer } from "./infer.ts";
import type { Representation } from "./represent.ts";
import { pinKey, pinsOf, type Pins } from "./signatures.ts";
import { schemeArith, showType } from "./types.ts";

export const MODULE_FORMAT = "projectional-module";

export interface Module {
  format: typeof MODULE_FORMAT;
  version: 1;
  title: string;
  // Only published nodes. defs: every definition in it, helpers included.
  code: Code;
  pins: Pins;
  names: Names;
  comments?: Comments;
  // What the palette offers from it.
  exports: Id[];
  // Updates: a new definition and the one it replaces (upgrade, below).
  replaces?: Record<Id, Id>;
  // Ways to store a type, in its definitions (represent.ts): the trees
  // module's rows for Map and Set.
  representations?: Representation[];
}

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

const nodeIds = (code: Code, def: Id) => subtree(code, def);
const hasHole = (code: Code, def: Id) => nodeIds(code, def).some((id) => code.nodes[id]?.kind === "hole");

// ------------------------------------------------------------------ publish

// Publish `defs` and every draft they depend on. `base` is what's always
// there (builtins, std) and is never republished. Refused while anything to
// be published has a hole, an error or no body: a published definition is
// finished, since its hash is its name forever.
export function publish(code: Code, names: Names, defs: Id[], base: Code): Result<{ code: Code; names: Names; rename: Map<Id, Id>; published: Id[]; pins: Pins }> {
  const nm = (d: Id) => names[d] ?? d;
  const drafts = defGroups(code, defs).flat().filter((d) => !isPublished(d) && !base.nodes[d]);
  for (const d of drafts) {
    if ((code.nodes[d] as { body: Id | null }).body === null) return { ok: false, reason: `${nm(d)} has no body, so there is nothing to name it by` };
    if (hasHole(code, d)) return { ok: false, reason: `${nm(d)} isn't finished: it has a hole` };
  }
  const h = hashes(code, drafts);
  const rename = new Map<Id, Id>();
  for (const d of drafts) {
    const id = `@${h.get(d)}`;
    nodeIds(code, d).forEach((n, i) => rename.set(n, i === 0 ? id : `${id}:${i}`));
  }
  const next = renameCode(code, rename);
  const info = infer(next, names);
  const published = drafts.map((d) => rename.get(d)!);
  const inside = new Set(published.flatMap((d) => nodeIds(next, d)));
  const bad = info.errors.find((e) => inside.has(e.id));
  if (bad) return { ok: false, reason: `${nm(bad.id)}: ${bad.message}` };
  return { ok: true, code: next, names: renameKeys(names, rename), rename, published, pins: pinsOf(info, published) };
}

// Every node, with the ids in `rename` replaced wherever they appear.
export function renameCode(code: Code, rename: Map<Id, Id>): Code {
  const f = (id: Id) => rename.get(id) ?? id;
  const nodes: Record<Id, Node> = {};
  for (const n of Object.values(code.nodes)) { const m = mapIds(n, f); nodes[m.id] = m; }
  return { nodes, defs: [...new Set(code.defs.map(f))] };
}

// A side table (names, comments, examples…) moved onto the new ids. Keys
// with a suffix (`def/port`, layout keys) are renamed piece by piece.
export function renameKeys<T>(table: Record<string, T>, rename: Map<Id, Id>): Record<string, T> {
  const f = (k: string) => rename.get(k) ?? k.split("/").map((p) => rename.get(p) ?? p).join("/");
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [f(k), v]));
}

// Make a module of published definitions: their nodes, names and pins.
// `helpers`: published with the module though nothing exported uses them
// (what a generic operation resolves to, arith.ts), and not offered.
export function makeModule(title: string, code: Code, names: Names, exports: Id[], pins: Pins, comments: Comments = {}, helpers: Id[] = []): Module {
  const defs = defGroups(code, [...exports, ...helpers]).flat().filter(isPublished);
  const ids = new Set(defs.flatMap((d) => nodeIds(code, d)));
  const pick = <T>(t: Record<Id, T>) => Object.fromEntries(Object.entries(t).filter(([k]) => ids.has(k)));
  return {
    format: MODULE_FORMAT, version: 1, title,
    code: { nodes: pick(code.nodes), defs },
    pins: Object.fromEntries(defs.map((d) => [d, pins[d]])),
    names: pick(names),
    comments: pick(comments),
    exports,
  };
}

// ------------------------------------------------------------------- verify

// Is this module what it says it is? Every definition hashes to its own id,
// every node is where its id says, nothing else is in it, every reference
// leads somewhere, and (with `checkPins`) every pin is the type the checker
// gives the definition. Returns the first thing wrong, or null.
export function verify(m: Module, base: Code, checkPins = false): string | null {
  if (m.format !== MODULE_FORMAT) return "it isn't a module";
  const code = merge(base, m.code);
  for (const d of m.code.defs) if (!isPublished(d) || code.nodes[d]?.kind !== "def") return `${d} isn't a published definition`;
  const memo = hashes(code, m.code.defs);
  const seen = new Set<Id>();
  for (const d of m.code.defs) {
    if (`@${memo.get(d)}` !== d) return `${m.names[d] ?? d} was changed after it was published: its content hashes to @${memo.get(d)}`;
    for (const [i, id] of nodeIds(code, d).entries()) {
      if (id !== (i === 0 ? d : `${d}:${i}`)) return `node ${id} is out of place in ${m.names[d] ?? d}`;
      seen.add(id);
    }
  }
  const stray = Object.keys(m.code.nodes).find((id) => !seen.has(id));
  if (stray) return `node ${stray} belongs to no definition`;
  for (const n of Object.values(m.code.nodes)) {
    const missing = pointsAt(n).find((t) => !code.nodes[t]);
    if (missing) return `node ${n.id} points at ${missing}, which isn't in the module or the base`;
  }
  for (const e of m.exports) if (!m.code.defs.includes(e)) return `it offers ${e}, which it doesn't have`;
  // A data type has no type of its own to pin; its constructors are typed
  // from it.
  const isType = (d: Id) => { const b = (m.code.nodes[d] as { body?: Id | null }).body; return !!b && m.code.nodes[b]?.kind === "typedef"; };
  for (const d of m.code.defs) if (!m.pins[d] && !isType(d)) return `${m.names[d] ?? d} has no pin`;
  if (checkPins) {
    const info = infer(code);
    const own = new Set(m.code.defs.flatMap((d) => nodeIds(code, d)));
    const bad = info.errors.find((e) => own.has(e.id));
    if (bad) return `${m.names[bad.id] ?? bad.id}: ${bad.message}`;
    for (const d of m.code.defs) if (pinKey(info.schemes.get(d)) !== pinKey(m.pins[d])) return `${m.names[d] ?? d} isn't pinned to its type`;
  }
  return null;
}

export function pointsAt(n: Node): Id[] {
  const out = [...children(n)];
  if (n.kind === "ref" || n.kind === "tref") out.push(n.target);
  if (n.kind === "arm") out.push(n.variant);
  // A solve's ports are the function's parameters, and "out", its result.
  // A builtin and an interface's field have no parameter nodes: their ports
  // are positions, 0, 1, ….
  if (n.kind === "solve") out.push(n.fn, ...(n.fn.startsWith("builtin.") ? [] : [...Object.keys(n.given), ...Object.keys(n.binds)].filter((k) => k !== "out" && !/^\d{1,2}$/.test(k))));
  if (n.kind === "tfun") out.push(...(n.effects ?? []));
  if (n.kind === "typedef") out.push(...(n.row ?? []));
  if (n.kind === "lit" && n.of) out.push(n.of);
  if (n.kind === "def" && n.way) out.push(n.way);
  if (n.kind === "def" && n.results) out.push(...n.results);
  if (n.kind === "def" && n.direction) out.push(n.direction);
  return out;
}

// --------------------------------------------------------------------- load

// What a program is checked and shown with: the base, the modules on top,
// their names under the program's, their pins, and their helpers hidden.
// The same definition in two modules is one definition.
// reps: every module's representation rows (the trees for Map and Set).
export interface Library { code: Code; names: Names; comments: Comments; pins: Pins; hidden: Set<Id>; modules: Module[]; reps: Representation[] }

export function library(base: Code, baseNames: Names, modules: Module[]): Library {
  const exported = new Set(modules.flatMap((m) => m.exports));
  return {
    code: merge(base, ...modules.map((m) => m.code)),
    names: layer<Names>(baseNames, ...modules.map((m) => m.names)),
    comments: Object.assign({}, ...modules.map((m) => m.comments ?? {})),
    pins: Object.assign({}, ...modules.map((m) => m.pins)),
    hidden: new Set(modules.flatMap((m) => m.code.defs).filter((d) => !exported.has(d))),
    modules,
    reps: modules.flatMap((m) => m.representations ?? []),
  };
}

// The published definitions a program refers to, and the module each one
// was found in: what a saved file lists, so a missing one can be named.
export function needs(own: Code, lib: Library): Record<Id, string> {
  const out: Record<Id, string> = {};
  for (const n of Object.values(own.nodes)) for (const t of pointsAt(n)) {
    if (!isPublished(t) || own.nodes[t]) continue;
    const def = t.split(":")[0];
    const m = lib.modules.find((x) => x.code.defs.includes(def));
    out[def] = m ? `${m.names[def] ?? def} from ${m.title}` : "unknown";
  }
  return out;
}

// -------------------------------------------------------------------- adopt

// Drafts that are the same as published definitions become references to
// those. Hashes say when two definitions are the same, whoever wrote them
// and whatever they called things, so a program that carried its own copy
// of `map` ends up using the library's, and its names for the copy are kept
// only where they differ from the library's.
export function adopt(code: Code, names: Names, lib: Library, comments: Comments = {}): { code: Code; names: Names; comments: Comments; adopted: Id[] } {
  const drafts = code.defs.filter((d) => !isPublished(d) && !lib.code.nodes[d]);
  const h = hashes(code, drafts);
  const rename = new Map<Id, Id>();
  const adopted: Id[] = [];
  for (const d of drafts) {
    const p = `@${h.get(d)}`;
    if (!lib.code.nodes[p]) continue;
    const mine = nodeIds(code, d), theirs = nodeIds(lib.code, p);
    if (mine.length !== theirs.length) continue;
    mine.forEach((id, i) => rename.set(id, theirs[i]));
    adopted.push(d);
  }
  if (!adopted.length) return { code, names, comments, adopted };
  const gone = new Set(adopted.flatMap((d) => nodeIds(code, d)));
  const kept: Code = { nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !gone.has(id))), defs: code.defs.filter((d) => !gone.has(d)) };
  const next = renameCode(kept, rename);
  const theirs = new Set(rename.values());
  const own = (t: Record<string, string>, same: Record<string, string>) => Object.fromEntries(Object.entries(renameKeys(t, rename)).filter(([k, v]) => !(theirs.has(k) && same[k] === v)));
  return { code: next, names: own(names, lib.names), comments: own(comments, lib.comments), adopted };
}

// ------------------------------------------------------------------ sameAs

// What each of a program's drafts is the same as (SHARING.md §7): the
// library's definitions with its hash, and the program's other drafts with
// it. Shown, never merged: the draft keeps its id, and an edit that moves
// its hash ends the match. A hash is the code up to names, so a match is
// rare and always right. Hidden definitions (a module's insides) aren't
// offered. Prior art: Unison reports a definition whose hash it already
// has as another name for it. Types aren't offered: two types of the same
// shape are still two types (Spot isn't Complex), and the checker keeps
// them apart.
export interface Same { library: Id[]; drafts: Id[] }
const libraryIndex = new WeakMap<Code, { index: Map<string, Id[]>; memo: Map<Id, string> }>();
const valueDef = (code: Code, d: Id) => { const n = code.nodes[d]; return n?.kind === "def" && n.body !== null && code.nodes[n.body]?.kind !== "typedef"; };
function indexOf(lib: Library) {
  let found = libraryIndex.get(lib.code);
  if (!found) {
    const index = new Map<string, Id[]>(), memo = hashes(lib.code, lib.code.defs.filter((d) => lib.code.nodes[d]?.kind === "def"));
    for (const d of lib.code.defs) if (valueDef(lib.code, d) && !lib.hidden.has(d)) { const k = memo.get(d)!; index.set(k, [...(index.get(k) ?? []), d]); }
    libraryIndex.set(lib.code, (found = { index, memo }));
  }
  return found;
}
// The library's hashes under a program's own: a draft that calls the
// library hashes only itself.
class Over extends Map<Id, string> {
  under: Map<Id, string>;
  // One whose hash underneath isn't read (orderFreeHash).
  hidden: Id | null = null;
  constructor(under: Map<Id, string>) { super(); this.under = under; }
  override has(k: Id) { return super.has(k) || (k !== this.hidden && this.under.has(k)); }
  override get(k: Id) { return super.get(k) ?? (k !== this.hidden ? this.under.get(k) : undefined); }
}
// `memo` carries the drafts' hashes from one call to the next while their
// code is the same (hash.ts `hashes`): the editor keeps it per version.
export function sameAs(code: Code, lib: Library, memo?: Map<Id, string>): Map<Id, Same> {
  const { index, memo: libMemo } = indexOf(lib);
  memo ??= new Over(libMemo);
  const drafts = code.defs.filter((d) => !isPublished(d) && !lib.code.nodes[d] && valueDef(code, d));
  const h = hashes(code, drafts, memo);
  const byHash = new Map<string, Id[]>();
  for (const d of drafts) { const k = h.get(d)!; byHash.set(k, [...(byHash.get(k) ?? []), d]); }
  const out = new Map<Id, Same>();
  for (const d of drafts) {
    const k = h.get(d)!;
    const same = { library: index.get(k) ?? [], drafts: (byHash.get(k) ?? []).filter((x) => x !== d) };
    if (same.library.length || same.drafts.length) out.set(d, same);
  }
  return out;
}

// The same up to the order of its inputs (PORTS-2026-11-01.md §7, L131):
// `f(x, y)` and the same body written `g(y, x)` are one function with its
// inputs in another order. A definition's hash stays what it is, its order
// included (it is the identity of published code, and two orders are two
// functions to call); this is a second hash beside it, taken with its
// inputs as a set: the least hash over every order of the inputs. Inputs
// the body treats alike tie, and any order of them gives the same least
// hash, so this is the canonical form of tree canonization (Aho, Hopcroft
// and Ullman) found by trying the orders, which is cheap for the few
// inputs a definition has. A recursive definition is left out: its own
// calls would need their arguments reordered too.
//
// The operands of + and · are sorted too, where the operation commutes
// (§7 part 2, L132): `x·x + y·y` and `y·y + x·x` are one. The generic +
// commutes for every number type the library has; the generic · doesn't
// (matrices, quaternions), so only Int's, Float64's and Algebraic's own
// · are sorted, which draft code reaches once its numbers are pinned.
// Sorting only: Float64's + doesn't associate, so sums aren't flattened.
export const COMMUTES: ReadonlySet<string> = new Set(["arith.add", "add", "mul", "int.add", "int.mul", "algebraic.add", "algebraic.mul"]);
const MAX_ORDERED = 5;
const permutations = <T>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
export function orderFreeHash(code: Code, d: Id, memo: Map<Id, string>): string | null {
  const def = code.nodes[d];
  const lam = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
  if (lam?.kind !== "lambda" || lam.params.length > MAX_ORDERED) return null;
  const group = defGroups(code, [d]).find((g) => g.includes(d));
  if (!group || group.length > 1 || subtree(code, lam.body).some((id) => { const n = code.nodes[id]; return n?.kind === "ref" && n.target === d; })) return null;
  let least: string | null = null;
  for (const order of permutations(lam.params)) {
    const swapped: Code = { ...code, nodes: { ...code.nodes, [lam.id]: { ...lam, params: order } } };
    // d's own hash must be taken again: hidden from what memo holds.
    const fresh = new Over(memo);
    fresh.hidden = d;
    const h = hashes(swapped, [d], fresh, COMMUTES).get(d)!;
    if (least === null || h < least) least = h;
  }
  return least;
}
const reorderIndex = new WeakMap<Code, Map<string, Id[]>>();
// Each draft that matches a library definition or another draft only with
// its inputs in another order (an exact match is sameAs's).
export function sameUpToOrder(code: Code, lib: Library): Map<Id, Same> {
  const { index: exact, memo: libMemo } = indexOf(lib);
  let index = reorderIndex.get(lib.code);
  if (!index) {
    index = new Map();
    for (const d of lib.code.defs) {
      if (!valueDef(lib.code, d) || lib.hidden.has(d)) continue;
      const k = orderFreeHash(lib.code, d, libMemo);
      if (k) index.set(k, [...(index.get(k) ?? []), d]);
    }
    reorderIndex.set(lib.code, index);
  }
  const memo = new Over(libMemo);
  const drafts = code.defs.filter((d) => !isPublished(d) && !lib.code.nodes[d] && valueDef(code, d));
  const h = hashes(code, drafts, memo);
  const free = new Map(drafts.map((d) => [d, orderFreeHash(code, d, memo)] as const));
  const byFree = new Map<string, Id[]>();
  for (const [d, k] of free) if (k) byFree.set(k, [...(byFree.get(k) ?? []), d]);
  const out = new Map<Id, Same>();
  for (const [d, k] of free) {
    if (!k) continue;
    const exactly = new Set([...(exact.get(h.get(d)!) ?? [])]);
    const library = (index.get(k) ?? []).filter((x) => !exactly.has(x) && libMemo.get(x) !== h.get(d));
    const drafts_ = (byFree.get(k) ?? []).filter((x) => x !== d && h.get(x) !== h.get(d));
    if (library.length || drafts_.length) out.set(d, { library, drafts: drafts_ });
  }
  return out;
}

// sameAs said in words, one line per draft that has a match, for `lab
// check` and the MCP server's check: "`sq` is the same as `square`
// (yours)", "`transform` is the same as `map` in the library".
export function sameLines(code: Code, names: Names, lib: Library): string[] {
  const where = (d: Id) => lib.modules.find((m) => m.code.nodes[d])?.title;
  const nm = (d: Id) => `\`${names[d] ?? lib.names[d] ?? d}\``;
  const say = (s: Same) => [
    ...s.library.map((x) => { const m = where(x); return `${nm(x)} ${m ? `in ${m}` : "in the library"}`; }),
    ...s.drafts.map((x) => `${nm(x)} (yours)`),
  ].join(" and ");
  return [
    ...[...sameAs(code, lib)].map(([d, s]) => `${nm(d)} is the same as ${say(s)}`),
    ...[...sameUpToOrder(code, lib)].map(([d, s]) => `${nm(d)} is the same as ${say(s)} with its inputs or operands in another order`),
  ];
}

// ------------------------------------------------------------------ upgrade

// Move a program from one published definition to another (a module's
// `replaces`). Every reference to the old one, and the ports of any place
// it's run backwards, now lead to the new one. Done only when the new one
// has the same pin: then nothing that uses it can break, and nothing needs
// checking again. A different type is refused, with the places that use it.
export function upgrade(code: Code, from: Id, to: Id, pins: Pins, names: Names = {}): Result<{ code: Code; uses: number }> {
  const a = pins[from], b = pins[to];
  if (!a || !b) return { ok: false, reason: "both definitions need pins" };
  if (pinKey(a) !== pinKey(b)) return { ok: false, reason: `its type changed from ${showType(a.type, names, schemeArith(a))} to ${showType(b.type, names, schemeArith(b))}` };
  const old = code.nodes[from], neu = code.nodes[to];
  if (old?.kind !== "def" || neu?.kind !== "def") return { ok: false, reason: "both definitions need to be loaded" };
  const params = (d: Node) => (d.kind === "def" && d.body && code.nodes[d.body]?.kind === "lambda" ? (code.nodes[d.body] as { params: Id[] }).params : []);
  const pa = params(old), pb = params(neu);
  const rename = new Map<Id, Id>([[from, to], ...pa.map((p, i) => [p, pb[i]] as [Id, Id])]);
  const keep = new Set([...nodeIds(code, from), ...nodeIds(code, to)]);
  let uses = 0;
  const nodes = { ...code.nodes };
  for (const n of Object.values(code.nodes)) {
    if (keep.has(n.id)) continue;
    const m = mapIds(n, (id) => (id === n.id ? id : rename.get(id) ?? id));
    if (JSON.stringify(m) !== JSON.stringify(n)) { nodes[n.id] = m; uses++; }
  }
  return { ok: true, code: collect({ nodes, defs: code.defs.map((d) => (d === from ? to : d)) }), uses };
}
