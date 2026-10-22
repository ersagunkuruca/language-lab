// Content hash of a definition, in the spirit of Unison. Ids and names are
// both left out: binders are numbered by position, refs to other defs are
// replaced by those defs' hashes. So two people who write the same function
// independently, with different ids and different names, get the same hash,
// and renaming anything never changes it.

import type { Code, Id } from "./model.ts";

type Canon = unknown[];

export function hashDef(code: Code, defId: Id, memo = new Map<Id, string>(), stack = new Set<Id>()): string {
  if (memo.has(defId)) return memo.get(defId)!;
  stack.add(defId);
  const def = code.nodes[defId];
  if (def.kind !== "def") throw new Error(`${defId} is not a def`);
  const binders = new Map<Id, number>();

  const canon = (id: Id): Canon => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": return n.of ? ["lit", n.value, n.of] : ["lit", n.value];
      case "hole": return ["hole"];
      case "binder": binders.set(id, binders.size); return n.unit ? ["bind", unitKey(n.unit)] : ["bind"];
      case "ref": {
        const t = code.nodes[n.target];
        if (t.kind === "binder") {
          if (!binders.has(n.target)) throw new Error(`ref to out-of-scope binder ${n.target}`);
          return ["var", binders.get(n.target)];
        }
        if (t.kind === "builtin") return ["builtin", t.op];
        if (t.kind === "variant" || t.kind === "field") return [t.kind, part(n.target)];
        // A def that is still being hashed is a recursive reference: name it
        // by its place on the stack instead (enough for self-recursion and
        // for a fixed traversal order of a mutually recursive group).
        if (stack.has(n.target)) return ["rec", [...stack].indexOf(n.target)];
        return ["def", hashDef(code, n.target, memo, stack)];
      }
      case "call": return ["call", canon(n.fn), ...n.args.map(canon)];
      case "lambda": return ["lam", n.params.map(canon), canon(n.body)];
      case "network": return ["net", n.params.map(canon), n.wires.map(canon), n.parts.map(canon)];
      case "part": {
        // Port keys that are the callee's param ids become positions too.
        const callee = n.fn ? code.nodes[n.fn] : null;
        const body = callee?.kind === "def" && callee.body ? code.nodes[callee.body] : null;
        const params = body && (body.kind === "lambda" || body.kind === "network") ? body.params : [];
        const fn = !callee ? ["const", n.value, ...(n.unit ? [unitKey(n.unit)] : [])] : callee.kind === "builtin" ? ["builtin", callee.op] : ["def", hashDef(code, n.fn!, memo, stack)];
        const ports = Object.entries(n.bind)
          .map(([k, w]) => [params.includes(k) ? `p${params.indexOf(k)}` : k, binders.get(w)] as const)
          .sort(([a], [b]) => (a < b ? -1 : 1));
        return ["part", fn, ports];
      }
      case "typedef": return ["type", n.params.map(canon), n.variants.map(canon)];
      case "variant": return ["variant", n.fields.map(canon)];
      case "field": return ["field", canon(n.type)];
      case "tref": {
        const t = code.nodes[n.target];
        const head = t.kind === "binder" ? ["var", binders.get(n.target)] : t.kind === "builtin" ? ["builtin", t.op]
          : stack.has(n.target) ? ["rec", [...stack].indexOf(n.target)] : ["def", hashDef(code, n.target, memo, stack)];
        return ["tref", head, ...n.args.map(canon)];
      }
      case "tfun": return ["tfun", n.params.map(canon), canon(n.result)];
      case "match": return ["match", canon(n.scrutinee), n.arms.map(canon), n.otherwise ? canon(n.otherwise) : null];
      case "solve": {
        const t = code.nodes[n.fn];
        const fn = t.kind === "builtin" ? ["builtin", t.op] : stack.has(n.fn) ? ["rec", [...stack].indexOf(n.fn)] : ["def", hashDef(code, n.fn, memo, stack)];
        const body = t.kind === "def" && t.body ? code.nodes[t.body] : null;
        const params = body && (body.kind === "lambda" || body.kind === "network") ? body.params : [];
        const key = (k: string) => (params.includes(k) ? `p${params.indexOf(k)}` : k);
        const given = Object.entries(n.given).map(([k, e]) => [key(k), canon(e)] as const).sort(([a], [b]) => (a < b ? -1 : 1));
        const binds = Object.entries(n.binds).map(([k, b]) => [key(k), canon(b)] as const).sort(([a], [b]) => (a < b ? -1 : 1));
        return ["solve", fn, given, binds, canon(n.body)];
      }
      case "fold": return ["fold", canon(n.scrutinee), n.arms.map(canon)];
      case "arm": return ["arm", part(n.variant), n.binds.map(canon), n.results.map((r) => (r ? canon(r) : null)), canon(n.body)];
      default: throw new Error(`unexpected ${n.kind}`);
    }
  };

  // A variant or field is identified by its type's hash and its position.
  const part = (id: Id): Canon => {
    for (const d of code.defs) {
      const td = code.nodes[d]?.kind === "def" && (code.nodes[d] as { body: Id | null }).body;
      const body = td ? code.nodes[td] : null;
      if (body?.kind !== "typedef") continue;
      for (const [vi, v] of body.variants.entries()) {
        const variant = code.nodes[v];
        if (variant.kind !== "variant") continue;
        const own = d === defId || stack.has(d) ? ["rec", [...stack].indexOf(d)] : ["def", hashDef(code, d, memo, stack)];
        if (v === id) return [own, vi];
        const fi = variant.fields.indexOf(id);
        if (fi >= 0) return [own, vi, fi];
      }
    }
    return ["extern", id];
  };

  // An extern has no content to hash, so its identity is its id.
  const body = def.body === null ? ["extern", defId] : canon(def.body);
  const h = fnv1a64(JSON.stringify(body));
  stack.delete(defId);
  memo.set(defId, h);
  return h;
}

// Units are part of the meaning: a length and a time with the same number are
// different values. Sorted so key order doesn't matter.
const unitKey = (u: Record<string, number | undefined>) => Object.entries(u).filter(([, e]) => e).sort(([a], [b]) => (a < b ? -1 : 1));

// Plain-JS 64-bit FNV-1a so this runs unchanged in the browser editor. Fine
// for a prototype; a real codebase would want a cryptographic hash.
function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
