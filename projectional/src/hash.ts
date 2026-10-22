// Content hash of a definition, in the spirit of Unison
// (https://www.unison-lang.org/docs/the-big-idea/, by Paul Chiusano, Rúnar
// Bjarnason, Arya Irani and the Unison team). Ids and names are both left
// out: binders are numbered by position, refs to other defs are replaced by
// those defs' hashes. So two people who write the same function
// independently, with different ids and different names, get the same hash,
// and renaming anything never changes it.
//
// A hash is also the identity of published code (src/lang/modules.ts), so it
// must not depend on anything incidental:
//
//   - Mutually recursive definitions are hashed as one group, in an order
//     that comes from their content, never from which one was asked about
//     first. This is how Unison hashes cycles: each member is first hashed
//     with references inside the group left anonymous, the members are
//     sorted by that, and then the group is hashed with each such reference
//     numbered by its target's place in the sorted order. Members that tie
//     are the same up to swapping them, so either order gives the same group.
//   - The hash is SHA-256 (src/sha256.ts), cut to 130 bits: the size of a
//     fresh id, and far past where two different definitions could share one.

import type { Code, Id, Node } from "./model.ts";
import { ownerOfTypeParts } from "./model.ts";
import { base32, sha256 } from "./sha256.ts";

type Canon = unknown[];

export const digest = (x: unknown): string => base32(sha256(JSON.stringify(x)));

// The defs a def refers to directly: by ref, as a type, by running it
// backwards, or through one of a data type's cases and fields.
export function defDeps(code: Code, def: Id, owner = ownerOfTypeParts(code)): Id[] {
  const out = new Set<Id>();
  const body = (code.nodes[def] as { body?: Id | null })?.body;
  if (!body) return [];
  const todo: Id[] = [body];
  while (todo.length) {
    const n = code.nodes[todo.pop()!];
    if (!n) continue;
    let t = target(n);
    if (t && owner.has(t)) t = owner.get(t)!;
    if (t && code.nodes[t]?.kind === "def") out.add(t);
    for (const c of kids(n)) todo.push(c);
  }
  return [...out];
}

const target = (n: Node): Id | null =>
  n.kind === "ref" || n.kind === "tref" ? n.target : n.kind === "solve" ? n.fn : n.kind === "arm" ? n.variant : null;

function kids(n: Node): Id[] {
  switch (n.kind) {
    case "call": return [n.fn, ...n.args];
    case "lambda": return [...n.params, n.body];
    case "typedef": return [...n.params, ...n.variants];
    case "variant": return n.fields;
    case "field": return [n.type];
    case "tref": return n.args;
    case "tfun": return [...n.params, n.result];
    case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms];
    case "arm": return [...n.binds, ...n.results.filter((r): r is Id => r !== null), n.body];
    case "solve": return [...Object.values(n.given), ...Object.values(n.binds), n.body];
    default: return [];
  }
}

// Strongly connected components of the defs reachable from `roots`,
// dependencies first (Tarjan's algorithm, iteratively).
export function defGroups(code: Code, roots: Id[], owner = ownerOfTypeParts(code)): Id[][] {
  const index = new Map<Id, number>(), low = new Map<Id, number>();
  const stack: Id[] = [], on = new Set<Id>(), out: Id[][] = [];
  const deps = new Map<Id, Id[]>();
  const depsOf = (d: Id) => deps.get(d) ?? (deps.set(d, defDeps(code, d, owner)), deps.get(d)!);
  for (const root of roots) {
    if (index.has(root)) continue;
    const frames: { d: Id; i: number }[] = [{ d: root, i: 0 }];
    index.set(root, index.size); low.set(root, index.get(root)!); stack.push(root); on.add(root);
    while (frames.length) {
      const f = frames.at(-1)!;
      const ds = depsOf(f.d);
      if (f.i < ds.length) {
        const w = ds[f.i++];
        if (!index.has(w)) {
          index.set(w, index.size); low.set(w, index.get(w)!); stack.push(w); on.add(w);
          frames.push({ d: w, i: 0 });
        } else if (on.has(w)) low.set(f.d, Math.min(low.get(f.d)!, index.get(w)!));
        continue;
      }
      frames.pop();
      if (frames.length) low.set(frames.at(-1)!.d, Math.min(low.get(frames.at(-1)!.d)!, low.get(f.d)!));
      if (low.get(f.d) === index.get(f.d)) {
        const group: Id[] = [];
        let w: Id;
        do { w = stack.pop()!; on.delete(w); group.push(w); } while (w !== f.d);
        out.push(group.reverse());
      }
    }
  }
  return out;
}

// The hash of every def reachable from `roots`. `memo` carries hashes
// between calls on the same code.
export function hashes(code: Code, roots: Id[], memo = new Map<Id, string>()): Map<Id, string> {
  const owner = ownerOfTypeParts(code);
  for (const group of defGroups(code, roots.filter((r) => !memo.has(r)), owner)) {
    if (group.every((d) => memo.has(d))) continue;
    const anon = new Map(group.map((d) => [d, null as number | null]));
    const sorted = group
      .map((d, i) => ({ d, i, key: digest(canon(code, d, anon, memo, owner)) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
      .map((x) => x.d);
    const place = new Map(sorted.map((d, i) => [d, i as number | null]));
    const groupHash = digest(["group", sorted.map((d) => canon(code, d, place, memo, owner))]);
    sorted.forEach((d, i) => memo.set(d, group.length === 1 ? groupHash : digest(["member", groupHash, i])));
  }
  return memo;
}

export function hashDef(code: Code, defId: Id, memo?: Map<Id, string>): string {
  if (code.nodes[defId]?.kind !== "def") throw new Error(`${defId} is not a def`);
  return hashes(code, [defId], memo).get(defId)!;
}

// The canonical form of one def. `group` gives the place of each def in the
// group being hashed (null: anonymous); every other def is already in memo.
function canon(code: Code, defId: Id, group: Map<Id, number | null>, memo: Map<Id, string>, owner: Map<Id, Id>): Canon {
  const def = code.nodes[defId] as { body: Id | null };
  const binders = new Map<Id, number>();
  const defRef = (id: Id): Canon => {
    if (group.has(id)) return ["rec", group.get(id)];
    const d = code.nodes[id];
    if (d?.kind === "builtin") return ["builtin", d.op];
    if (d?.kind !== "def") return ["extern", id];
    return ["def", memo.get(id)];
  };
  // A variant or field is identified by its type's hash and its position.
  const part = (id: Id): Canon => {
    const d = owner.get(id);
    if (!d) return ["extern", id];
    const td = code.nodes[(code.nodes[d] as { body: Id }).body];
    if (td.kind !== "typedef") return ["extern", id];
    for (const [vi, v] of td.variants.entries()) {
      if (v === id) return [defRef(d), vi];
      const fi = (code.nodes[v] as { fields: Id[] }).fields.indexOf(id);
      if (fi >= 0) return [defRef(d), vi, fi];
    }
    return ["extern", id];
  };
  const go = (id: Id): Canon => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": return n.of ? ["lit", n.value, n.of] : n.unit ? ["lit", n.value, unitKey(n.unit)] : ["lit", n.value];
      case "hole": return ["hole"];
      case "binder": binders.set(id, binders.size); return n.unit ? ["bind", unitKey(n.unit)] : ["bind"];
      case "ref": {
        const t = code.nodes[n.target];
        if (t?.kind === "binder") {
          if (!binders.has(n.target)) throw new Error(`ref to out-of-scope binder ${n.target}`);
          return ["var", binders.get(n.target)];
        }
        if (t?.kind === "variant" || t?.kind === "field") return [t.kind, part(n.target)];
        return defRef(n.target);
      }
      case "call": return ["call", go(n.fn), ...n.args.map(go)];
      case "lambda": return ["lam", n.params.map(go), go(n.body)];
      case "typedef": return ["type", n.params.map(go), n.variants.map(go)];
      case "variant": return ["variant", n.fields.map(go)];
      case "field": return ["field", go(n.type)];
      case "tref": {
        const head = binders.has(n.target) ? ["var", binders.get(n.target)] : defRef(n.target);
        return ["tref", head, ...n.args.map(go)];
      }
      case "tfun": return ["tfun", n.params.map(go), go(n.result)];
      case "match": return ["match", go(n.scrutinee), n.arms.map(go), n.otherwise ? go(n.otherwise) : null];
      case "solve": {
        const t = code.nodes[n.fn];
        const body = t?.kind === "def" && t.body ? code.nodes[t.body] : null;
        const params = body && body.kind === "lambda" ? body.params : [];
        const key = (k: string) => (params.includes(k) ? `p${params.indexOf(k)}` : k);
        const sorted = (r: Record<string, Id>) => Object.entries(r).map(([k, e]) => [key(k), e] as const).sort(([a], [b]) => (a < b ? -1 : 1));
        // Evaluated in canonical order, so binders are numbered the same
        // whatever order the record's keys were written in.
        const given = sorted(n.given).map(([k, e]) => [k, go(e)]);
        const binds = sorted(n.binds).map(([k, e]) => [k, go(e)]);
        return ["solve", defRef(n.fn), given, binds, go(n.body)];
      }
      case "fold": return ["fold", go(n.scrutinee), n.arms.map(go)];
      case "arm": return ["arm", part(n.variant), n.binds.map(go), n.results.map((r) => (r ? go(r) : null)), go(n.body)];
      default: throw new Error(`unexpected ${n.kind}`);
    }
  };
  // An extern has no content to hash, so its identity is its id.
  return def.body === null ? ["extern", defId] : go(def.body);
}

// Units are part of the meaning: a length and a time with the same number are
// different values. Sorted so key order doesn't matter.
const unitKey = (u: Record<string, number | undefined>) => Object.entries(u).filter(([, e]) => e).sort(([a], [b]) => (a < b ? -1 : 1));
