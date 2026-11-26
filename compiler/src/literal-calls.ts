// A pure builtin called on literals alone, made once (C346): inside a
// function, `characters("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")`
// gave the same list at every call, and the library's base64 decoder
// called it for each character it read (digits' 99 KB: some 130K lists
// of 64 texts, L291). Such a call becomes a definition of no inputs of
// its own, which every printer keeps once worked out (C173: JavaScript's
// `??=`, a static in C, a global in WebAssembly), and the call a use of
// it. Only calls whose answer is made (a text, a list, data, an array):
// a number is as cheap to work out again as to read. Only on texts, so
// what is kept is no bigger than what is written (`range(1000000)` would
// hold a million Ints for good), and not in the program's own roots
// (main), which run once. Calls with the same builtin and literals share
// one definition.
//
// Prior art: constant hoisting to the top level (GHC's full laziness
// floats closed expressions out of lambdas; Peyton Jones, Partain and
// Santos, "Let-floating", ICFP 1996). hoist.ts floats work out of a lambda
// to the call it is given to; this floats it out of every function.
//
// A code → code pass, the program checked again only when one was found.

import type { Code, Id, NodeOf } from "../../ters/src/model.ts";
import { copyNodes, freshId, isCall, isUse, nodeEntries, subtree, useTarget } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";
import { CELL, HASH_SET, INT, NUMBER, Subst, TABLE } from "../../ters/src/lang/types.ts";
import { SIGS } from "../../ters/src/lang/std.ts";
import { PRELUDE_DEFS, originalOf } from "../../ters/src/lang/prelude-ids.ts";

const INVERSE = PRELUDE_DEFS["inverse"];

// Answers not worth keeping: numbers, and what can change.
const NOT_KEPT = new Set<Id>([NUMBER, INT, CELL, TABLE, HASH_SET]);

export function literalCalls(code: Code, info: Info, names: Names, roots: readonly Id[] = []): { code: Code; names: Names; made: Id[] } {
  const made: Id[] = [];
  let nodes: Code["nodes"] | null = null;
  const more: Names = {};
  const byKey = new Map<string, Id>();
  const solved = solvedDefs(code);
  for (const d of code.defs) {
    const def = code.nodes[d];
    if (def?.kind !== "def" || !def.body || code.nodes[def.body]?.kind !== "lambda" || roots.includes(d) || solved.has(d)) continue;
    for (const id of subtree(code, def.body)) {
      const call = code.nodes[id];
      if (!isCall(call) || !call.args.length) continue;
      const fn = code.nodes[call.fn];
      if (fn?.kind !== "ref" || code.nodes[fn.target]?.kind !== "builtin") continue;
      if (!call.args.every((a) => { const l = code.nodes[a]; return l?.kind === "lit" && typeof l.value === "string"; })) continue;
      const own = SIGS[fn.target]?.(new Subst());
      if (own?.t !== "fn" || own.eff.effs.length || own.params.some((p) => p.t === "fn")) continue;
      const t = info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
      if (t.t !== "con" || NOT_KEPT.has(t.id)) continue;
      const key = JSON.stringify([fn.target, ...call.args.map((a) => { const l = code.nodes[a] as NodeOf<"lit">; return [l.value, l.unit ?? null]; })]);
      nodes ??= copyNodes(code.nodes);
      let k = byKey.get(key);
      if (!k) {
        // The definition's body is the call as it was, under fresh ids.
        const body = freshId(), f = freshId();
        nodes[f] = { ...fn, id: f };
        const args = call.args.map((a) => { const x = freshId(); nodes![x] = { ...code.nodes[a], id: x }; return x; });
        nodes[body] = { ...call, id: body, fn: f, args };
        k = freshId();
        nodes[k] = { id: k, kind: "def", body };
        byKey.set(key, k);
        made.push(k);
        more[k] = `${names[fn.target] ?? "value"}, once`;
      }
      nodes[id] = { id, kind: "ref", target: k };
    }
  }
  if (!nodes) return { code, names, made };
  return { code: { nodes, defs: [...code.defs, ...made] }, names: { ...names, ...more }, made };
}

// The definitions a solve runs (a `use`, or what `inverse` is given:
// json read's json spelled run backwards) and those they call: their literals stay where they are
// written, as the solver plans a call of a builtin on literals and not a
// definition's value (C346 had json read refused, "data holding a Bool").
function solvedDefs(code: Code): Set<Id> {
  const out = new Set<Id>(), todo: Id[] = [];
  const defsIn = (id: Id) => { for (const x of subtree(code, id)) { const r = code.nodes[x]; if (r?.kind === "ref" && code.nodes[r.target]?.kind === "def") todo.push(r.target); } };
  for (const [, n] of nodeEntries(code.nodes)) {
    if (isUse(n)) todo.push(useTarget(code.nodes, n));
    else if (isCall(n) && n.args.length) { const f = code.nodes[n.fn]; if (f?.kind === "ref" && originalOf(f.target) === INVERSE) defsIn(n.args[0]); }
  }
  while (todo.length) {
    const d = todo.pop()!;
    const def = code.nodes[d];
    if (out.has(d) || def?.kind !== "def" || !def.body) continue;
    out.add(d);
    defsIn(def.body);
  }
  return out;
}

export function withLiteralCalls(code: Code, info: Info, names: Names, roots: readonly Id[]): { code: Code; info: Info; names: Names } {
  const r = literalCalls(code, info, names, roots);
  if (!r.made.length) return { code, info, names };
  const checked = infer(r.code, r.names, undefined, info.options);
  return checked.errors.length <= info.errors.length ? { code: r.code, info: checked, names: r.names } : { code, info, names };
}
