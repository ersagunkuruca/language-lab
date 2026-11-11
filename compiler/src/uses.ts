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

import type { Call, Code, Id, Use } from "../../ters/src/model.ts";
import { isUse } from "../../ters/src/model.ts";
import { OverMap, type Type } from "../../ters/src/lang/types.ts";
import { tupleType } from "../../ters/src/lang/std.ts";
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
  if (!r || r.code !== out) { r = { code: out, info: (!checkAgain() && carried(code, out, info)) || infer(out, names, undefined, info.options) }; done.set(info, r); done.set(r.info, r); }
  return r;
}

// BODIES_CHECK=1 checks the filled program again, to compare.
const checkAgain = () => typeof process !== "undefined" && !!process.env?.BODIES_CHECK;

// The filled program's types without checking it again (I203): a use
// filled (ports.ts fillUses) gives what it gave, its binders and their
// refs each produced port's type, the part of the tuple it gave, and the
// tuple's constructor a pure function of them. Null when a filled use's
// type isn't that tuple (the program is checked again).
function carried(code: Code, out: Code, info: Info): Info | null {
  const typeOf = new OverMap(info.typeOf);
  for (const id in out.nodes) {
    const was = code.nodes[id], n = out.nodes[id];
    if (n === was || !isUse(n) || !was || !isUse(was) || was.body !== undefined || n.body === undefined) continue;
    const t = info.typeOf.get(id);
    if (!t) return null;
    const binds = Object.values(n.binds ?? {});
    let parts: Type[];
    if (binds.length === 1) parts = [t];
    else {
      const r = info.subst.resolve(t);
      if (r.t !== "con" || r.id !== tupleType(binds.length) || r.args.length !== binds.length) return null;
      parts = r.args;
      typeOf.set(n.body, t);
      typeOf.set((out.nodes[n.body] as Call).fn, { t: "fn", params: parts, ret: t, eff: { effs: [], tail: null } });
    }
    binds.forEach((b, i) => {
      typeOf.set(b, parts[i]);
      const ref = `${id}.part.${Object.keys(n.binds!)[i]}`;
      if (out.nodes[ref]?.kind !== "ref") throw new Error(`no ${ref}`);
      typeOf.set(ref, parts[i]);
    });
  }
  return { ...info, typeOf };
}
