// Work that doesn't change from one call of a lambda to the next, done once
// (C81, GAPS.md round 7 S2). sheet's `grid` is
// `map(rows, (r) => grid row(r, columns used(sheet), width of(results)))`:
// `columns used(sheet)` walks every cell, and it was walked again for every
// row. A call of a definition inside a lambda given to a call (`map`,
// `keep`, `for each`, any definition), whose inputs are all bound outside
// that lambda and which can do nothing but give its value (no effect in
// its type, not even Diverge, so it always ends), is worked out once, just
// before the call the lambda is given to: `(h ↦ map(rows, (r) ↦ grid row(r,
// h, …)))(columns used(sheet))`. A lambda that is never called then costs
// the call once; one that is called many times saves all but one.
//
// Prior art: loop-invariant code motion; in a functional language, GHC's
// full-laziness transformation (Peyton Jones, Partain and Santos, "Let-
// floating", ICFP 1996), which floats such expressions out of lambdas.
//
// A code → code pass, like lift-lets.ts. Calls inside a lambda written
// inside the lambda stay where they are (that one may run any number of
// times, or none). What has no effect needs no handler, so one around it
// doesn't keep it in.

import type { Code, Id, NodeOf } from "../../ters/src/model.ts";
import { freshId, subtree } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";
import { Subst, type Type } from "../../ters/src/lang/types.ts";
import { SIGS } from "../../ters/src/lang/std.ts";

export function hoistInvariants(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names; hoisted: number } {
  const nodes = { ...code.nodes };
  const ty = (id: Id): Type => info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  // Can only give its value: a call of a definition or builtin whose own
  // type has no effect, not even Diverge, and which takes no function (so
  // nothing it is given can bring one in). The type at the call itself
  // isn't asked: its row is the caller's, joined (compile.ts
  // performsNothing reads calls the same way).
  const plainCall = (call: NodeOf<"call">, defsOnly: boolean): boolean => {
    const f = nodes[call.fn];
    if (f?.kind !== "ref") return false;
    const target = nodes[f.target];
    if (target?.kind === "variant" || target?.kind === "field") return !defsOnly;
    let own: Type | undefined;
    if (target?.kind === "builtin" && !defsOnly) own = SIGS[f.target]?.(new Subst());
    else if (target?.kind === "def") {
      if (target.way || !target.body || nodes[target.body]?.kind !== "lambda" || info.divergent.has(f.target)) return false;
      own = info.schemes.get(f.target)?.type;
    }
    if (own?.t !== "fn" || own.eff.effs.length) return false;
    const t = ty(call.fn);
    return t.t === "fn" && !t.params.some((x) => info.subst.zonk(x).t === "fn");
  };
  const pure = (call: NodeOf<"call">) => plainCall(call, true);
  // Nothing inside it may do anything either, nor make a function.
  const quiet = (id: Id): boolean => subtree({ nodes, defs: [] }, id).every((x) => {
    const n = nodes[x];
    if (n.kind === "lambda" || n.kind === "solve" || n.kind === "hole") return false;
    return n.kind !== "call" || plainCall(n, false);
  });
  let hoisted = 0;
  // The lambdas given to calls, outermost first.
  const ids = code.defs.flatMap((d) => subtree(code, d));
  for (const id of ids) {
    const call = nodes[id];
    if (call?.kind !== "call" || nodes[call.fn]?.kind === "lambda") continue;
    for (const a of call.args) {
      const lam = nodes[a];
      if (lam?.kind !== "lambda") continue;
      const inside = new Set(subtree({ nodes, defs: [] }, a).filter((x) => nodes[x]?.kind === "binder"));
      lam.params.forEach((p) => inside.add(p));
      const found: Id[] = [];
      // Down the lambda's body, not into lambdas or handlers inside it.
      const walk = (x: Id) => {
        const n = nodes[x];
        if (!n || n.kind === "lambda") return;
        if (n.kind === "call" && pure(n) && quiet(x) && !subtree({ nodes, defs: [] }, x).some((y) => nodes[y]?.kind === "ref" && inside.has((nodes[y] as NodeOf<"ref">).target))) {
          found.push(x);
          return;
        }
        if (n.kind === "call") { walk(n.fn); n.args.forEach(walk); return; }
        if (n.kind === "match" || n.kind === "fold") { walk(n.scrutinee); n.arms.forEach((arm) => walk((nodes[arm] as NodeOf<"arm">).body)); if (n.kind === "match" && n.otherwise) walk(n.otherwise); return; }
      };
      walk(lam.body);
      if (!found.length) continue;
      // The call keeps its id, so whatever points at it still does: its old
      // contents move to a fresh node, and it becomes the let.
      const moved = freshId();
      nodes[moved] = { ...call, id: moved };
      const binders = found.map((x) => {
        const b = freshId();
        nodes[b] = { id: b, kind: "binder" };
        const name = nodes[(nodes[x] as NodeOf<"call">).fn];
        names = { ...names, [b]: `${name?.kind === "ref" ? names[name.target] ?? "value" : "value"}, once` };
        const value = freshId();
        nodes[value] = { ...nodes[x], id: value };
        nodes[x] = { id: x, kind: "ref", target: b };
        return { b, value };
      });
      const let_ = freshId();
      nodes[let_] = { id: let_, kind: "lambda", params: binders.map((x) => x.b), body: moved };
      nodes[id] = { id, kind: "call", fn: let_, args: binders.map((x) => x.value) };
      hoisted += found.length;
      break;
    }
  }
  if (!hoisted) return { code, info, names, hoisted };
  const out = { nodes, defs: code.defs };
  const checked = infer(out, names, undefined, info.options);
  // Checked again the same way as the program as it came is, since a check
  // again can find what the first (with its pins) didn't (stage.ts, I121).
  const before = Math.max(info.errors.length, infer(code, names, undefined, info.options).errors.length);
  if (checked.errors.length > before) return { code, info, names, hoisted: 0 };
  return { code: out, info: checked, names, hoisted };
}
