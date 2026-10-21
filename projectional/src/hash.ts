// Content hash of a definition, in the spirit of Unison. Ids and names are
// both left out: binders are numbered by position, refs to other defs are
// replaced by those defs' hashes. So two people who write the same function
// independently, with different ids and different names, get the same hash,
// and renaming anything never changes it.

import type { Code, Id } from "./model.ts";

type Canon = unknown[];

export function hashDef(code: Code, defId: Id, memo = new Map<Id, string>(), stack = new Set<Id>()): string {
  if (memo.has(defId)) return memo.get(defId)!;
  if (stack.has(defId)) throw new Error("recursive defs are not hashed yet (needs SCC hashing)");
  stack.add(defId);
  const def = code.nodes[defId];
  if (def.kind !== "def") throw new Error(`${defId} is not a def`);
  const binders = new Map<Id, number>();

  const canon = (id: Id): Canon => {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": return ["lit", n.value];
      case "hole": return ["hole"];
      case "binder": binders.set(id, binders.size); return n.unit ? ["bind", unitKey(n.unit)] : ["bind"];
      case "ref": {
        const t = code.nodes[n.target];
        if (t.kind === "binder") {
          if (!binders.has(n.target)) throw new Error(`ref to out-of-scope binder ${n.target}`);
          return ["var", binders.get(n.target)];
        }
        if (t.kind === "builtin") return ["builtin", t.op];
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
      default: throw new Error(`unexpected ${n.kind}`);
    }
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
