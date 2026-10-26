// A list named first and then walked (BACKLOG C49): `let xs = range(n)`
// and then `fold xs` built the list and walked it, where `fold range(n)`
// is a counted loop with no list. The loops are chosen from what made the
// fold's input (projectional/src/lang/represent.ts, `foldPlan`; the
// scalar profile's fold over `characters`), so a let whose value is such a
// list, with no effects in what it's made from, and whose name is used
// once where it runs at most once (not inside a function, nor in a fold's
// arm, which runs per item), is put where its name is. The program means
// the same: the value is pure and still made at most once.
// That's GHC's inlining of a binding that occurs once, in a place that runs
// at most once (Peyton Jones and Marlow, "Secrets of the Glasgow Haskell
// Compiler inliner", JFP 2002), kept to the lists a fold or fusion looks for.

import { subtree, type Code, type Id, type NodeOf } from "../../projectional/src/model.ts";
import type { Info } from "../../projectional/src/lang/infer.ts";
import { STORAGES } from "../../projectional/src/lang/represent.ts";

const MAKERS = new Set<Id>(STORAGES.flatMap((s) => (s.meaning ? [s.meaning] : [])));

export function inlineLists(code: Code, info: Info): { code: Code; inlined: number } {
  let inlined = 0;
  // One at a time, each on the code the last one left.
  for (let c = candidate(code, info); c; c = candidate(code, info)) {
    const nodes = { ...code.nodes };
    nodes[c.ref] = { ...code.nodes[c.value], id: c.ref };
    nodes[c.let] = { ...nodes[c.body], id: c.let };
    code = { ...code, nodes };
    inlined++;
  }
  return { code, inlined };
}

function candidate(code: Code, info: Info): { let: Id; value: Id; ref: Id; body: Id } | null {
  // Names, literals and builtins with no effects: what range's and
  // characters' inputs are, in practice.
  const pure = (id: Id) => subtree(code, id).every((x) => {
    const c = code.nodes[x];
    if (c.kind === "ref" || c.kind === "lit") return true;
    if (c.kind !== "call") return false;
    const f = code.nodes[c.fn], t = info.typeOf.get(c.fn) && info.subst.zonk(info.typeOf.get(c.fn)!);
    return f.kind === "ref" && code.nodes[f.target]?.kind === "builtin" && t?.t === "fn" && !info.subst.resolveRow(t.eff).effs.length;
  });
  // Whether `target` is reached from `id` only through places that run
  // once or not at all: a call's arguments, a let's body, a match's input
  // and arms, a fold's input.
  const once = (id: Id, target: Id): boolean => {
    if (id === target) return true;
    const n = code.nodes[id];
    if (!n) return false;
    if (n.kind === "call") {
      const f = code.nodes[n.fn];
      const let_ = f?.kind === "lambda" && f.params.length === n.args.length;
      return n.args.some((a) => once(a, target)) || (let_ && once(f.body, target));
    }
    if (n.kind === "match") return once(n.scrutinee, target) || n.arms.some((a) => once((code.nodes[a] as NodeOf<"arm">).body, target)) || (!!n.otherwise && once(n.otherwise, target));
    if (n.kind === "fold") return once(n.scrutinee, target);
    return false;
  };
  for (const id of code.defs.flatMap((d) => subtree(code, d))) {
    const c = code.nodes[id];
    if (c.kind !== "call" || c.args.length !== 1) continue;
    const lam = code.nodes[c.fn];
    if (lam?.kind !== "lambda" || lam.params.length !== 1) continue;
    const value = code.nodes[c.args[0]], b = lam.params[0];
    const made = value?.kind === "call" ? code.nodes[value.fn] : undefined;
    if (value?.kind !== "call" || made?.kind !== "ref" || !MAKERS.has(made.target) || !value.args.every(pure)) continue;
    const refs = subtree(code, lam.body).filter((x) => { const r = code.nodes[x]; return r.kind === "ref" && r.target === b; });
    if (refs.length === 1 && once(lam.body, refs[0])) return { let: c.id, value: value.id, ref: refs[0], body: lam.body };
  }
  return null;
}
