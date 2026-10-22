// What a built-in is, so nothing in a graph is a black box. A built-in like
// + is a relation: one equation between its ports, which the solver can run
// in any direction it determines. Selecting a node that uses one shows the
// equation and each direction it can run.

import { analyze, defineRelation, directions, showEq } from "../../invertible/src/index.js";
import { call, v } from "../../invertible/src/expr.js";
import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { impl } from "../src/prelude.ts";
import { RELATIONS, VARIADIC } from "../src/relational.ts";
import { relationFor } from "../src/lang/solve.ts";

interface Rel { name: string; ports: string[]; eqs: unknown[] }
export interface Definition {
  op: string;
  equations: string[];
  // Each minimal set of ports you can give it, and what it then works out.
  ways: { given: string[]; steps: string[]; several: boolean }[];
}

export function builtinOf(code: Code, id: Id | null): Id | null {
  const n = id ? code.nodes[id] : null;
  if (!n) return null;
  const t = n.kind === "builtin" ? n.id : n.kind === "call" ? (code.nodes[n.fn]?.kind === "ref" ? (code.nodes[n.fn] as { target: Id }).target : null)
    : n.kind === "ref" ? n.target : n.kind === "part" || n.kind === "solve" ? n.fn : null;
  return t && code.nodes[t]?.kind === "builtin" ? t : null;
}

const cache = new Map<Id, Definition | null>();

export function definitionOf(code: Code, fn: Id): Definition | null {
  if (cache.has(fn)) return cache.get(fn)!;
  let out: Definition | null = null;
  try {
    const op = (code.nodes[fn] as { op: string }).op;
    let rel: Rel;
    if (op in impl) {
      // Name the ports the way the graph shows them.
      const f = impl[op as keyof typeof impl];
      const args = f.length === 1 ? ["x"] : ["a", "b"].slice(0, f.length);
      rel = (defineRelation as unknown as (s: object) => Rel)({ name: op, ports: [...args, "result"], eqs: [{ lhs: v("result"), rhs: call(op, ...args.map((a) => v(a))) }] });
    } else if (op in VARIADIC) rel = relationFor(code, fn, ["a", "b", VARIADIC[op as keyof typeof VARIADIC].total]) as unknown as Rel;
    else if (op in RELATIONS) rel = relationFor(code, fn, []) as unknown as Rel;
    else return null;
    const ways = (directions as unknown as (r: Rel) => string[][])(rel).map((given) => {
      const a = (analyze as unknown as (r: Rel, k: string[]) => { steps: { kind: string; text: string; raw: { branches?: unknown[] } }[] })(rel, given);
      const steps = a.steps.filter((s) => s.kind !== "check");
      return { given, steps: steps.map((s) => s.text), several: steps.some((s) => / or |k₁/.test(s.text)) };
    });
    out = { op, equations: (rel.eqs as { law?: boolean }[]).filter((e) => !e.law).map((e) => (showEq as unknown as (e: unknown) => string)(e)), ways };
  } catch {
    out = null;
  }
  cache.set(fn, out);
  return out;
}

// For messages and headings.
export const builtinName = (names: Names, fn: Id, d: Definition) => names[fn] ?? d.op;
