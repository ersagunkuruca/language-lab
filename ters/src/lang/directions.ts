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

import type { Code, Id, Node, NodeOf, Use } from "../model.ts";
import { conditionResults, directionOf, isUse, useTarget, isCall, fieldPorts, type Call, bindsOf, isBound } from "../model.ts";
import { derivedFrom, nodesWhere, portsOf, subtree } from "../model.ts";
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
    const of = directionOf(code.nodes, d);
    if (of) out.set(of, [...(out.get(of) ?? []), d]);
  }
  return out;
}

// What's wrong with a direction definition, or null: it has results, of a
// relation with results, and the same number of ports.
export function directionProblem(code: Code, d: Id, nm: (id: Id) => string): string | null {
  const rel = directionOf(code.nodes, d)!, of = code.nodes[rel];
  if (of?.kind !== "def" || !conditionResults(code.nodes, of.id)) return `${nm(d)} is a direction of ${nm(rel)}, which has no results to give another direction of`;
  if (!conditionResults(code.nodes, d)) return `${nm(d)} is a direction of ${nm(rel)}, so it names its results`;
  const mine = paramsOf(code, d), theirs = paramsOf(code, rel);
  if (!mine || !theirs || mine.length !== theirs.length) return `${nm(d)} is a direction of ${nm(rel)}, so it has ${nm(rel)}'s ${theirs?.length ?? 0} ports, in order`;
  return null;
}

// An interface's field with results reads its ports one way; another field
// of the same interface over the same ports, reading them the other way, is
// its other direction (Trig's polar and unpolar, POLAR.md step 3). Ports
// are positions there, so only the function changes.
function fieldDirection(code: Code, n: Use, f: NodeOf<"field">): Retargeted | null {
  // Its given ports, by name where the field names them.
  const name = (g: NodeOf<"field">, k: string) => (k === "out" ? k : g.ports?.[Number(k)] ?? k);
  const given = Object.keys(n.given).filter((k) => k !== "out").map((k) => name(f, k));
  const reads = (g: NodeOf<"field">) => {
    const ins = fieldPorts(code.nodes, g)?.ins.map((i) => name(g, String(i))) ?? [];
    return ins.length === given.length && ins.every((i) => given.includes(i));
  };
  if (reads(f)) return null;
  const v = Object.values(code.nodes).find((x): x is NodeOf<"variant"> => x.kind === "variant" && x.fields.includes(f.id));
  const ports = (g: NodeOf<"field">) => [...(g.ports ?? [])].sort().join();
  for (const id of v?.fields ?? []) {
    const g = code.nodes[id];
    if (g?.kind !== "field" || !fieldPorts(code.nodes, g) || id === f.id || !g.ports || ports(g) !== ports(f) || !reads(g)) continue;
    // The same ports, perhaps in another order: each moved to g's position.
    const key = (k: string) => (k === "out" ? k : String(g.ports!.indexOf(name(f, k))));
    const re = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, x]) => [key(k), x]));
    return { use: { ...n, given: re(n.given), ...(isBound(n) && { binds: re(n.binds) }) }, target: id };
  }
  return null;
}

// A use rewritten to run another relation: its ports renamed for that one
// (`use`), and the relation its ref then points at (`target`).
type Retargeted = { use: Use; target: Id };

// The solve rewritten onto the direction that its given ports ask for, or
// null when none does (the relation is then solved as it always was).
export function directionFor(code: Code, n: Use, ways = directionsIn(code)): Retargeted | null {
  const f = code.nodes[useTarget(code.nodes, n)];
  if (f?.kind === "field" && fieldPorts(code.nodes, f)) return fieldDirection(code, n, f);
  const ds = ways.get(useTarget(code.nodes, n));
  const theirs = ds && paramsOf(code, useTarget(code.nodes, n));
  if (!theirs) return null;
  const given = new Set(Object.keys(n.given).filter((k) => k !== "out").map((k) => theirs.indexOf(k)));
  if (given.has(-1)) return null;
  for (const d of ds) {
    const mine = paramsOf(code, d), def = code.nodes[d] as NodeOf<"def">;
    const defResults = conditionResults(code.nodes, d);
    if (!mine || mine.length !== theirs.length || !defResults) continue;
    const ins = mine.map((p, i) => (defResults.includes(p) ? -1 : i)).filter((i) => i >= 0);
    if (ins.length !== given.size || !ins.every((i) => given.has(i))) continue;
    const key = (k: string) => (k === "out" ? k : mine[theirs.indexOf(k)]);
    const re = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [key(k), v]));
    return { use: { ...n, given: re(n.given), ...(isBound(n) && { binds: re(n.binds) }) }, target: d };
  }
  return null;
}

// Every such solve rewritten; the same code back when there are none.
export function useDirections(code: Code): Code {
  const ways = directionsIn(code);
  const asked = (n: Use) => { const f = code.nodes[useTarget(code.nodes, n)]; return ways.has(useTarget(code.nodes, n)) || (f?.kind === "field" && !!fieldPorts(code.nodes, f)); };
  let nodes: Code["nodes"] | null = null;
  const rewritten: Id[] = [];
  for (const id of nodesWhere(code, "use", isUse)) {
    const n = code.nodes[id] as Use;
    if (!asked(n)) continue;
    const r = directionFor(code, n, ways);
    if (!r) continue;
    nodes ??= { ...code.nodes };
    nodes[n.id] = r.use;
    nodes[n.fn] = { id: n.fn, kind: "ref", target: r.target };
    rewritten.push(n.id, n.fn);
  }
  if (!nodes) return code;
  // Derived from this program by the solves rewritten, so a scan of the
  // result can start from this one's (model.ts nodesWhere).
  const out = { ...code, nodes };
  derivedFrom(out, code, rewritten);
  return out;
}

// A body that gives each result as an expression of the other ports,
// `r1 = e1 and r2 = e2` (RESULTS.md's `= e1, e2`): the expressions, in the
// results' order, or null.
export function givenBy(code: Code, b: Id, results: Id[]): Id[] | null {
  const node = (id: Id) => code.nodes[id];
  const parts: Id[] = [];
  const calls = (n: Node | undefined, f: Id): n is Call => isCall(n) && n.args.length === 2 && node(n.fn)?.kind === "ref" && (node(n.fn) as NodeOf<"ref">).target === f;
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
export function computedForward(code: Code, n: Use): boolean {
  const def = code.nodes[useTarget(code.nodes, n)];
  const ports = def?.kind === "def" ? portsOf(code.nodes, def.id) : null;
  if (!ports?.condition || def?.kind !== "def") return false;
  const lam = code.nodes[def.body!] as NodeOf<"lambda">;
  const ins = ports.inputs;
  const given = Object.keys(n.given).filter((k) => k !== "out");
  return given.length === ins.length && ins.every((p) => given.includes(p)) && Object.keys(bindsOf(n)).every((k) => ports.results.includes(k)) && !!givenBy(code, lam.body, ports.results);
}
