// What a step made from a program, made again for one that differs from
// the last it was given only in some number literals' values (an edit of a
// number, the editor's drag), as the choice is (ters/cli/represented.ts
// butLiterals): its last answer with the new values put in where it left
// the literals. For a step that reads numbers only through the check (as
// class-key.ts tells them: whole or not, their sign, whether 0), and
// carries them: each changed literal is in the same class as it was, so
// the check is the same, and the step made the same choices. A literal it
// copied or turned into something else (an Int literal at a type with a
// Literal, a copy for a type) has no node to take the new value, so the
// step is taken again; so it is when anything it made has a literal of the
// old value, which may be its copy, or when a literal is gone, which may
// have been worked into another.
// A step that reads some values (bake.ts runs calls) says which nodes it
// may have read (`reads`): a change to one of them makes it again.
import { dependenciesOfAll, subtree, subtreeKept, idsPlace, layerOf, moveIdsTo, nodeIds, nodesUnder, ownNodeIds, litOrigin, nodesOfKind, onLayer, sameValue, withNodes, type Code, type Id, type Node } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { sameOptions } from "./class-key.ts";
import { keptMap } from "../kept.ts";
import { sameValueReads, valueRead } from "./value-reads.ts";

type Stage = { code: Code; info: Info; names: Names };
type Made = { copies: Map<Id, Id[]>; unknown: Set<string> };
// `ids`: where the seeded ids were before the step and after it (model.ts
// idsPlace); taken again only from where it began.
// `reads`: the nodes whose values the step read, where it reads some (a
// change to one of them makes the step again).
type Kept = { given: Stage; out: Stage; made?: Made; ids: [number | null, number | null]; reads?: ReadonlySet<Id> };
const kept = keptMap<string, Kept>();
// How many steps were made again so (the tests).
export let stepsAgain = 0;

// The literals whose values the step being taken has read, where it
// tells them as it reads (`tracked`): stage.ts's evaluator, grades.ts's
// runs.
let reading: Set<Id> | null = null;
export const readLit = (id: Id) => { reading?.add(id); };
// A run of these nodes reads every literal under them and in what they
// reach (as bake.ts tells its runs').
export function readRuns(code: Code, ids: Id[]): void {
  if (!reading) return;
  for (const id of ids) for (const x of subtree(code, id)) reading.add(x);
  for (const d of dependenciesOfAll(code, ids)) if (code.nodes[d]?.kind === "def") for (const x of subtreeKept(code, d)) reading.add(x);
}

// `place`: the step and what else it reads (its roots, its target).
// `tracked`: the step tells the literals it reads (readLit, readRuns).
export function overLiterals<S extends Stage>(place: string, given: S, run: () => S & { reads?: ReadonlySet<Id> }, tracked = false): S {
  const was = kept.get(place), from = idsPlace();
  const again = was && was.ids[0] === from ? madeAgain(was, given) : null;
  if (again) {
    stepsAgain++;
    if (was!.ids[1] !== null) moveIdsTo(was!.ids[1]);
    kept.set(place, { ...was!, given, out: again });
    return handed(again) as S;
  }
  const outer = reading, mine = tracked ? new Set<Id>() : null;
  if (tracked) reading = mine;
  let ran: S & { reads?: ReadonlySet<Id> };
  try { ran = run(); } finally { if (tracked) { reading = outer; if (outer) for (const id of mine!) outer.add(id); } }
  const { reads: told, ...out } = ran;
  const reads = mine ? new Set([...mine, ...(told ?? [])]) : told;
  if (kept.size >= 16 && !kept.has(place)) kept.clear();
  kept.set(place, { given, out, ids: [from, idsPlace()], ...(reads ? { reads } : {}) });
  return handed(out as unknown as S);
}
// What is handed on checks on over a trial of the substitution kept
// (types.ts Subst.trial): the steps after bind variables of their own in
// it, which the next compile's steps would read.
const handed = <S extends Stage>(s: S): S => ({ ...s, info: { ...s.info, subst: s.info.subst.trial() } });

const numeric = (v: unknown): v is number | string => typeof v === "number" || (typeof v === "string" && /^-?\d+$/.test(v));
// What the check may tell of a number (class-key.ts).
const classOf = (v: number | string) => { const x = Number(v); return Object.is(x, -0) ? "-0" : `${typeof v === "string" || Number.isInteger(x) ? "i" : "f"}${Math.sign(x)}`; };
const litText = (v: unknown) => (numeric(v) ? `v${Number(v)}` : `s${String(v)}`);

function madeAgain(was: Kept, q: Stage): Stage | null {
  const p = was.given, out = was.out;
  if (q.code === p.code && q.info === p.info && q.names === p.names) return out;
  if (q.info.errors.length !== p.info.errors.length || q.code.defs.length !== p.code.defs.length || q.code.defs.some((d, i) => d !== p.code.defs[i])) return null;
  // (The nodes first: an edit of a body differs there, and is told so
  // before the names and options are read through.)
  const changed = differing(p.code.nodes, q.code.nodes);
  if (!changed?.length) return null;
  for (const id of changed) {
    const a = p.code.nodes[id], b = q.code.nodes[id];
    if (a?.kind !== "lit" || b?.kind !== "lit" || !numeric(a.value) || !numeric(b.value) || classOf(a.value) !== classOf(b.value) || !sameValue({ ...a, value: b.value }, b)) return null;
  }
  if (q.names !== p.names && !sameNames(q.names, p.names)) return null;
  if (q.info.options !== p.info.options && !sameOptions(q.info.options, p.info.options)) return null;
  const made = (was.made ??= madeLiterals(p.code, out.code));
  const into: Record<Id, Node> = {};
  // (Not a literal some pass reads the value of: value-reads.ts. The two
  // differ only in literals' values, so they read the same ones.)
  const readP = valueRead(p.code);
  sameValueReads(p.code, q.code);
  for (const id of changed) {
    if (readP(id)) return null;
    const a = p.code.nodes[id] as Node & { kind: "lit" }, b = q.code.nodes[id] as Node & { kind: "lit" };
    if (made.unknown.has(litText(a.value)) || was.reads?.has(id)) return null;
    // One in a definition the step left out (one the roots don't reach)
    // is in nothing it made.
    if (out.code.nodes[id] === undefined && !made.copies.get(id)?.length && leftOut(q.code, out.code, id)) continue;
    for (const at of [id, ...(made.copies.get(id) ?? [])]) {
      // One the step took out may have been worked into something else.
      const n = out.code.nodes[at];
      if (n?.kind !== "lit" || !numeric(n.value) || Number(n.value) !== Number(a.value)) return null;
      // As the step wrote it: an Int's digits as a number, or as text
      // past what a number holds exactly (arith.ts intLit).
      const v = typeof n.value === "string" ? String(BigInt(b.value)) : Number(b.value);
      if (typeof n.value === "number" && typeof b.value === "string" && !Number.isSafeInteger(v)) return null;
      into[at] = { ...n, value: v } as Node;
    }
  }
  // (Every one left out: the step's answer as it was.)
  if (!Object.keys(into).length) return { ...out, info: { ...out.info } };
  const code: Code = { ...out.code, nodes: withNodes(out.code.nodes, into) };
  const layer = layerOf(out.code);
  if (layer) onLayer(code, layer);
  return { ...out, code, info: { ...out.info } };
}

// Whether id's definition is one `out` left out, or there is none.
// (Each node's definition found once for a list of definitions, which
// an edit of a number keeps.)
const defsOf = new WeakMap<Id[], Map<Id, Id>>();
function leftOut(code: Code, out: Code, id: Id): boolean {
  let of = defsOf.get(code.defs);
  if (!of) { of = new Map(); for (const d of code.defs) for (const x of subtreeKept(code, d)) of.set(x, d); defsOf.set(code.defs, of); }
  // (One in no definition is in none the program runs.)
  const d = of.get(id);
  return d === undefined || out.nodes[d] === undefined;
}

// The ids whose node differs, in no set order: read from the nodes each
// holds itself when one sits over the other or both over the same (a
// walk of both in order, model.ts changedOver, was most of the time this
// takes), else from every node of both.
function differing(a: Record<Id, Node>, b: Record<Id, Node>): Id[] {
  const ua = nodesUnder(a), ub = nodesUnder(b);
  const own = ub === a ? ownNodeIds(b) : ua === b ? ownNodeIds(a) : ua && ua === ub ? [...new Set([...ownNodeIds(a), ...ownNodeIds(b)])] : null;
  if (own) return own.filter((id) => a[id] !== b[id]);
  const out: Id[] = [];
  for (const id of nodeIds(b)) if (a[id] !== b[id]) out.push(id);
  for (const id of nodeIds(a)) if (b[id] === undefined && a[id] !== undefined) out.push(id);
  return out;
}

// Whether two programs differ only in some literals' values.
export function onlyLiteralValues(a: Code, b: Code): boolean {
  if (a === b) return true;
  if (a.defs.length !== b.defs.length || a.defs.some((d, i) => d !== b.defs[i])) return false;
  // (A node made again as it was, other object or not, is the same.)
  // (A literal some pass reads the value of is no edit of a value alone:
  // value-reads.ts.)
  const changed = differing(a.nodes, b.nodes).filter((id) => { const x = a.nodes[id], y = b.nodes[id]; return !(x !== undefined && y !== undefined && sameValue(x, y)); });
  if (!changed.every((id) => { const x = a.nodes[id], y = b.nodes[id]; return x?.kind === "lit" && y?.kind === "lit" && sameValue({ ...x, value: y.value }, y); })) return false;
  if (!changed.length) return true;
  const ra = valueRead(a);
  sameValueReads(a, b);
  return changed.every((id) => !ra(id));
}

// The literals the step made: copies of the program's (model.ts
// litOrigin), by the one copied, and the values of the rest, any of which
// may be a copy.
function madeLiterals(given: Code, out: Code): Made {
  const copies = new Map<Id, Id[]>(), unknown = new Set<string>();
  for (const n of nodesOfKind(out, "lit")) {
    // The program's own, where it was (a literal a node of another
    // kind became may have been worked out of others).
    const g = given.nodes[n.id];
    if (g?.kind === "lit" && numeric(g.value) && numeric(n.value) && Number(g.value) === Number(n.value)) continue;
    if (g !== undefined) { unknown.add(litText(n.value)); continue; }
    const o = litOrigin(n);
    if (o !== undefined && given.nodes[o]?.kind === "lit") { let cs = copies.get(o); if (!cs) copies.set(o, (cs = [])); cs.push(n.id); }
    else unknown.add(litText(n.value));
  }
  return { copies, unknown };
}
function sameNames(a: Names, b: Names): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
