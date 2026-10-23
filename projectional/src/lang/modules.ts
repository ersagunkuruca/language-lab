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
import { pinKey, pinsOf, type Pins } from "./signatures.ts";
import { showType } from "./types.ts";

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
export function makeModule(title: string, code: Code, names: Names, exports: Id[], pins: Pins, comments: Comments = {}): Module {
  const defs = defGroups(code, exports).flat().filter(isPublished);
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
  for (const d of m.code.defs) if (!m.pins[d]) return `${m.names[d] ?? d} has no pin`;
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
  // A builtin has no parameter nodes: its ports are positions, 0, 1, ….
  if (n.kind === "solve") out.push(n.fn, ...(n.fn.startsWith("builtin.") ? [] : [...Object.keys(n.given), ...Object.keys(n.binds)].filter((k) => k !== "out")));
  if (n.kind === "tfun") out.push(...(n.effects ?? []));
  if (n.kind === "lit" && n.of) out.push(n.of);
  return out;
}

// --------------------------------------------------------------------- load

// What a program is checked and shown with: the base, the modules on top,
// their names under the program's, their pins, and their helpers hidden.
// The same definition in two modules is one definition.
export interface Library { code: Code; names: Names; comments: Comments; pins: Pins; hidden: Set<Id>; modules: Module[] }

export function library(base: Code, baseNames: Names, modules: Module[]): Library {
  const exported = new Set(modules.flatMap((m) => m.exports));
  return {
    code: merge(base, ...modules.map((m) => m.code)),
    names: layer<Names>(baseNames, ...modules.map((m) => m.names)),
    comments: Object.assign({}, ...modules.map((m) => m.comments ?? {})),
    pins: Object.assign({}, ...modules.map((m) => m.pins)),
    hidden: new Set(modules.flatMap((m) => m.code.defs).filter((d) => !exported.has(d))),
    modules,
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

// ------------------------------------------------------------------ upgrade

// Move a program from one published definition to another (a module's
// `replaces`). Every reference to the old one, and the ports of any place
// it's run backwards, now lead to the new one. Done only when the new one
// has the same pin: then nothing that uses it can break, and nothing needs
// checking again. A different type is refused, with the places that use it.
export function upgrade(code: Code, from: Id, to: Id, pins: Pins, names: Names = {}): Result<{ code: Code; uses: number }> {
  const a = pins[from], b = pins[to];
  if (!a || !b) return { ok: false, reason: "both definitions need pins" };
  if (pinKey(a) !== pinKey(b)) return { ok: false, reason: `its type changed from ${showType(a.type, names)} to ${showType(b.type, names)}` };
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
