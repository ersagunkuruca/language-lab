// A use's binds and body, now that a use may come without them (L211,
// PORTS-2026-11-01.md §3): one with no body gives its produced ports, the
// ones not given, in port order, as a tuple, or the one value when it
// produces one.
//
// The compilers take such a use as ports.ts `filled` reads it, the use that
// binds each produced port and gives them back (C161), checked again so
// the nodes that made have their types: `withBodies` at each entry
// (compile.ts compile, scalar.ts lowerScalar). A use whose ports aren't
// known (a hole, an unknown target) stays without, and isn't compiled.

import type { Code, Id, Use } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";
import { filled } from "../../ters/src/lang/ports.ts";

export const bindsOf = (n: Use): Record<string, Id> => n.binds ?? {};

export function bodyOf(n: Use): Id {
  if (n.body === undefined) throw new Error(`a use whose ports aren't known gives its ports as one value, which isn't compiled (${n.id})`);
  return n.body;
}

// The code with every use that has no body filled, and checked again;
// the same code and info when there is none. Kept by the info it was given,
// so the entries below one another check once.
const done = new WeakMap<Info, { code: Code; info: Info }>();
export function withBodies(code: Code, info: Info, names: Names): { code: Code; info: Info } {
  const out = filled(code);
  if (out === code) return { code, info };
  let r = done.get(info);
  if (!r || r.code !== out) { r = { code: out, info: infer(out, names, undefined, info.options) }; done.set(info, r); done.set(r.info, r); }
  return r;
}
