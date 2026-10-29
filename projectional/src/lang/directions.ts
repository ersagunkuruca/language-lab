// A relation's other directions, given by definitions of their own
// (POLAR.md, BACKLOG L97b). `polar(length, angle) → x, y` is a relation
// with results; `unpolar(x, y) → length, angle`, marked as a direction of
// polar, has the same ports in the same order and declares the other
// results. A solve of polar given x and y is then a solve of unpolar, one
// answer from its own definition instead of a search, and the checker,
// the evaluator and the compiler all see it that way. This is a code →
// code pass like arith.ts: the solve keeps its id, only its function and
// its ports' keys change, so the program as written (and its hash) stays
// polar.
//
// Prior art: Mercury's mode-specific clauses and promise_equivalent_clauses,
// one predicate with a definition per mode, promised to agree.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { subtree } from "../model.ts";
import { S } from "./std.ts";

const paramsOf = (code: Code, d: Id): Id[] | null => {
  const def = code.nodes[d];
  const lam = def?.kind === "def" && def.body ? code.nodes[def.body] : null;
  return lam?.kind === "lambda" ? lam.params : null;
};

// Every direction definition, by the relation it gives a direction of.
export function directionsIn(code: Code): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (const d of code.defs) {
    const n = code.nodes[d];
    if (n?.kind === "def" && n.direction) out.set(n.direction, [...(out.get(n.direction) ?? []), d]);
  }
  return out;
}

// What's wrong with a direction definition, or null: it has results, of a
// relation with results, and the same number of ports.
export function directionProblem(code: Code, d: Id, nm: (id: Id) => string): string | null {
  const n = code.nodes[d] as NodeOf<"def">, of = code.nodes[n.direction!];
  if (of?.kind !== "def" || !of.results) return `${nm(d)} is a direction of ${nm(n.direction!)}, which has no results to give another direction of`;
  if (!n.results) return `${nm(d)} is a direction of ${nm(n.direction!)}, so it names its results`;
  const mine = paramsOf(code, d), theirs = paramsOf(code, n.direction!);
  if (!mine || !theirs || mine.length !== theirs.length) return `${nm(d)} is a direction of ${nm(n.direction!)}, so it has ${nm(n.direction!)}'s ${theirs?.length ?? 0} ports, in order`;
  return null;
}

// The solve rewritten onto the direction that its given ports ask for, or
// null when none does (the relation is then solved as it always was).
export function directionFor(code: Code, n: NodeOf<"solve">, ways = directionsIn(code)): NodeOf<"solve"> | null {
  const ds = ways.get(n.fn);
  const theirs = ds && paramsOf(code, n.fn);
  if (!theirs) return null;
  const given = new Set(Object.keys(n.given).filter((k) => k !== "out").map((k) => theirs.indexOf(k)));
  if (given.has(-1)) return null;
  for (const d of ds) {
    const mine = paramsOf(code, d), def = code.nodes[d] as NodeOf<"def">;
    if (!mine || mine.length !== theirs.length || !def.results) continue;
    const ins = mine.map((p, i) => (def.results!.includes(p) ? -1 : i)).filter((i) => i >= 0);
    if (ins.length !== given.size || !ins.every((i) => given.has(i))) continue;
    const key = (k: string) => (k === "out" ? k : mine[theirs.indexOf(k)]);
    const re = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [key(k), v]));
    return { ...n, fn: d, given: re(n.given), binds: re(n.binds) };
  }
  return null;
}

// Every such solve rewritten; the same code back when there are none.
export function useDirections(code: Code): Code {
  const ways = directionsIn(code);
  if (!ways.size) return code;
  let nodes: Code["nodes"] | null = null;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "solve" || !ways.has(n.fn)) continue;
    const r = directionFor(code, n, ways);
    if (r) (nodes ??= { ...code.nodes })[n.id] = r;
  }
  return nodes ? { ...code, nodes } : code;
}

// A body that gives each result as an expression of the other ports,
// `r1 = e1 and r2 = e2` (RESULTS.md's `= e1, e2`): the expressions, in the
// results' order, or null.
export function givenBy(code: Code, b: Id, results: Id[]): Id[] | null {
  const node = (id: Id) => code.nodes[id];
  const parts: Id[] = [];
  const calls = (n: Node | undefined, f: Id): n is NodeOf<"call"> => n?.kind === "call" && n.args.length === 2 && node(n.fn)?.kind === "ref" && (node(n.fn) as NodeOf<"ref">).target === f;
  const flat = (id: Id) => { const n = node(id); if (calls(n, S.and)) { flat(n.args[0]); flat(n.args[1]); } else parts.push(id); };
  flat(b);
  if (parts.length !== results.length) return null;
  const isRef = (id: Id, r: Id) => { const n = node(id); return n?.kind === "ref" && n.target === r; };
  const mentions = (id: Id) => subtree(code, id).some((x) => { const n = node(x); return n?.kind === "ref" && results.includes(n.target); });
  const out = results.map((r, i) => {
    const n = node(parts[i]);
    if (!calls(n, S.equal)) return null;
    const [a, c] = n.args;
    const e = isRef(a, r) ? c : isRef(c, r) ? a : null;
    return e && !mentions(e) ? e : null;
  });
  return out.every((e): e is Id => e !== null) ? out : null;
}

// A solve in the direction its definition declares, whose results are each
// given by an expression of the inputs: computed forward, one answer, the
// way a function is (sqrt(x² + y²) is no search for a length).
export function computedForward(code: Code, n: NodeOf<"solve">): boolean {
  const def = code.nodes[n.fn];
  if (def?.kind !== "def" || !def.results || !def.body) return false;
  const lam = code.nodes[def.body];
  if (lam?.kind !== "lambda") return false;
  const ins = lam.params.filter((p) => !def.results!.includes(p));
  const given = Object.keys(n.given).filter((k) => k !== "out");
  return given.length === ins.length && ins.every((p) => given.includes(p)) && Object.keys(n.binds).every((k) => def.results!.includes(k)) && !!givenBy(code, lam.body, def.results);
}
