// Bounded counting (BACKLOG L46, LANGUAGE-REVIEW-2026-10-24 §7): a
// definition that calls itself with an Int input moved one way by a
// positive literal, under a guard that compares that input with a bound
// the call keeps (a literal, or an input passed on unchanged), ends. The
// measure is the distance to the bound, a natural number that shrinks:
// `steps < 120` guarding `steps + 1`, or the otherwise of `120 < steps`,
// as raymarch's march has it. Dafny and Lean find a `decreases` measure
// from such a guard the same way.
//
// Only an Int counts. A Float64 count can stop moving (2⁵³ + 1 is 2⁵³) or
// be NaN, which every comparison calls false. A guard is read through and,
// or and not. Only a definition that calls itself directly (not a group of
// several) is read, and every one of its calls must count an input the
// same way towards the same bound or pass it on unchanged, so two calls
// can't count it towards two different bounds and ping-pong.
//
// The termination check in infer.ts and the mode check in modes.ts both
// take a counted input as one that strictly shrinks at that call.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { ARITH, FALSE, INT_OPS, S, TRUE } from "./std.ts";
import { INT } from "./types.ts";

const LESS = new Set<Id>([INT_OPS.less, ARITH.less]);
const UP = new Set<Id>([INT_OPS.add, ARITH.add]);
const DOWN = new Set<Id>([INT_OPS.sub, ARITH.sub]);

type Guard = { input: number; up: boolean; bound: string };
interface SelfCall { call: Id; unchanged: Set<number>; counts: { input: number; up: boolean; bound: string }[] }

const isPositiveInt = (n: Node | undefined) => n?.kind === "lit" && n.of === INT && Number(n.value) > 0;

// Expressions and binders under a node (types and variants left out).
function kids(n: Node): Id[] {
  switch (n.kind) {
    case "call": return [n.fn, ...n.args];
    case "lambda": return [n.body];
    case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms];
    case "arm": return [n.body];
    case "solve": return [...Object.values(n.given), n.body];
    default: return [];
  }
}

// The calls of `self` in its own body whose inputs count towards a bound,
// as `${call}:${input}`.
export function countedCalls(code: Code, self: Id, lam: NodeOf<"lambda">): Set<string> {
  const nodes = code.nodes;
  const inputOf = (id: Id) => { const n = nodes[id]; if (n?.kind !== "ref") return undefined; const i = lam.params.indexOf(n.target); return i < 0 ? undefined : i; };
  const boundOf = (id: Id): string | null => {
    const n = nodes[id];
    if (n?.kind === "lit" && n.of === INT) return `lit ${n.value}`;
    const i = inputOf(id);
    return i === undefined ? null : `input ${i}`;
  };
  const guardsOf = (cond: Id, holds: boolean): Guard[] => {
    const n = nodes[cond];
    if (n?.kind !== "call") return [];
    const f = nodes[n.fn];
    if (f?.kind !== "ref") return [];
    if (f.target === S.not) return guardsOf(n.args[0], !holds);
    // a and b true: both are; a or b false: neither is.
    if ((f.target === S.and && holds) || (f.target === S.or && !holds)) return n.args.flatMap((a) => guardsOf(a, holds));
    if (!LESS.has(f.target)) return [];
    // holds: a < b. Otherwise b ≤ a. The smaller side may count up towards
    // the larger, the larger down towards the smaller.
    const [lo, hi] = holds ? [n.args[0], n.args[1]] : [n.args[1], n.args[0]];
    const out: Guard[] = [];
    const ilo = inputOf(lo), ihi = inputOf(hi), bh = boundOf(hi), bl = boundOf(lo);
    if (ilo !== undefined && bh !== null) out.push({ input: ilo, up: true, bound: bh });
    if (ihi !== undefined && bl !== null) out.push({ input: ihi, up: false, bound: bl });
    return out;
  };

  const calls: SelfCall[] = [];
  const guards: Guard[] = [];
  let other = false; // self used other than called: nothing is counted
  const walk = (id: Id) => {
    const n = nodes[id];
    if (!n) return;
    if (n.kind === "ref" && n.target === self) { other = true; return; }
    if (n.kind === "call" && nodes[n.fn]?.kind === "ref" && (nodes[n.fn] as NodeOf<"ref">).target === self) {
      const call: SelfCall = { call: id, unchanged: new Set(), counts: [] };
      n.args.forEach((a, j) => {
        if (inputOf(a) === j) { call.unchanged.add(j); return; }
        const m = nodes[a];
        if (m?.kind !== "call") return;
        const op = nodes[m.fn];
        if (op?.kind !== "ref") return;
        const up = UP.has(op.target), down = DOWN.has(op.target);
        if (!up && !down) return;
        // x + c or c + x; x − c
        const [x, c] = up && inputOf(m.args[0]) === undefined ? [m.args[1], m.args[0]] : [m.args[0], m.args[1]];
        if (inputOf(x) !== j || !isPositiveInt(nodes[c])) return;
        const g = guards.find((g) => g.input === j && g.up === up);
        if (g) call.counts.push({ input: j, up, bound: g.bound });
      });
      calls.push(call);
      n.args.forEach(walk);
      return;
    }
    if (n.kind === "match") {
      walk(n.scrutinee);
      for (const a of n.arms) {
        const arm = nodes[a] as NodeOf<"arm">;
        const holds = arm.variant === TRUE ? true : arm.variant === FALSE ? false : null;
        const gs = holds === null ? [] : guardsOf(n.scrutinee, holds);
        guards.push(...gs);
        walk(a);
        guards.splice(guards.length - gs.length, gs.length);
      }
      if (n.otherwise) walk(n.otherwise);
      return;
    }
    kids(n).forEach(walk);
  };
  walk(lam.body);

  const out = new Set<string>();
  if (other) return out;
  const keeps = (bound: string) => bound.startsWith("lit ") || calls.every((c) => c.unchanged.has(Number(bound.slice(6))));
  for (let j = 0; j < lam.params.length; j++) {
    const counted = calls.flatMap((c) => c.counts.filter((x) => x.input === j));
    if (!counted.length) continue;
    const [first] = counted;
    const fine = keeps(first.bound) && calls.every((c) => c.unchanged.has(j) || c.counts.some((x) => x.input === j && x.up === first.up && x.bound === first.bound));
    if (fine) for (const c of calls) if (c.counts.some((x) => x.input === j)) out.add(`${c.call}:${j}`);
  }
  return out;
}
