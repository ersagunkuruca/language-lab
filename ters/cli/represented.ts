// A program with each type it uses stored as the chooser picks (lab.ts's
// `ters compile`, `ters run`, and a sound's `ters render`, C137 s1).

import { changedOwn, dependencies, idsSeeded, layerOf, litOrigin, nodesOfKind, onLayer, sameValue, nodesOver, steadied, subtree, type Code, type Id, type Node } from "../src/model.ts";
import type { Pins } from "../src/lang/signatures.ts";
import type { Names } from "../src/presentation.ts";
import { checksKept, infer, type Info } from "../src/lang/infer.ts";
import { choose, jobProblem, represent, type Measured, type Representation } from "../src/lang/represent.ts";
import { choosingFor, endedAsWritten, storedRows, withLibraryRepresentations, type Pick } from "../src/lang/library-reps.ts";
import { classKey, optionsText } from "../src/lang/class-key.ts";
import { keepingWhole } from "../src/lang/check-cache.ts";
import { ownLibraryHolders } from "../src/lang/own-holders.ts";
import { nearByPlaces, nearOnGrid } from "../src/lang/near-grid.ts";
import { shareFoldItems } from "../../compiler/src/fold-items.ts";
import { fuseWalks } from "../../compiler/src/fuse-walks.ts";
import { replaceReads } from "../../compiler/src/replace-reads.ts";
import { firstSorted } from "../../compiler/src/first-sorted.ts";
import { intCases, usesIntCases } from "../src/lang/int-cases.ts";
import { expandArrayGradients } from "../src/lang/pullback.ts";
import { TREES } from "../src/lang/library.ts";
import { keptMap } from "../src/kept.ts";

// `held`: the rows a person held in the program's choices (L280c), by the
// type's id.
export interface Program { title: string; code: Code; own: Id[]; names: Names; info: Info; reps: Representation[]; options?: unknown; chosen?: string[]; picks?: Pick[]; held?: ReadonlyMap<Id, string>; measured?: ReadonlyMap<Id, Measured>; fused?: { at: Id; walker: Id; over: string; made?: Id }[] }

function fail(message: string): never { throw new Error(message); }

// The program from `main`, with each type it uses stored the way the
// chooser picks from the declared costs (the definition itself is one of
// the choices). Library types (std's Map) are chosen for too, unless the
// table has a row for them (library-reps.ts, C47). The rewrite is checked
// again, like any program.
// `sound`: main is a sound played in blocks (library-reps.ts).
// `dataKeys`: the target's tables take keys that are data (C's, C243).
export function represented<P extends Program>(p00: P, main: Id, hostMaps: boolean, tables = false, sound = false, dataKeys = false): P {
  // Where checks are kept, the ids the steps make are drawn the same way
  // each compile (model.ts idsSeeded), so their checks again find their
  // groups kept. The choices made are kept too, by this program but for
  // its numbers, texts and truth values (library-reps.ts choosingFor), and
  // its whole checks by groups (check-cache.ts keepingWhole).
  // What it makes as it was made before is given as the same nodes
  // (model.ts steadied), so a recompile reads again only what changed.
  const go = () => { const r = representedIn(p00, main, hostMaps, tables, sound, dataKeys); const code = steadied(r.code); return code === r.code ? r : { ...r, code }; };
  if (!checksKept(p00.info.options)) return go();
  const key = classKey(p00.code, [optionsText(p00.info.options), main, p00.own, p00.reps, hostMaps, tables, sound, dataKeys, [...(p00.held ?? [])].sort(), [...(p00.measured ?? [])].map(([t, m]) => [t, m.size, [...m.calls].sort()])]);
  const again = butLiterals(key, p00);
  if (again) return again;
  const out = idsSeeded(`representing ${main}`, () => keepingWhole(() => choosingFor(key, go)));
  if (literalsKept.size >= 4) literalsKept.clear();
  literalsKept.set(key, { given: p00, out });
  return out;
}

// The last choice made from this program but for its literals' values
// (the key leaves those out but for their sign and kind: classKey), kept
// with what it was made from: a program that differs from that one only
// in some literals' values (an edit of a number, the editor's drag) takes
// it again with those values put in, and with its check. No decision
// reads a literal's value (the key),
// and the rewrite only carries it: a literal it left where it was takes
// the new value there. One the rewrite copied or turned into something
// else (a copy for one side of a split, a literal job's call) has no
// node to take it, so the choice is made again; so it is when anything
// made has a literal of the same value, which may be its copy (machine:
// 0.47 of a recompile's 1.15 s).
// How many choices were taken again so (the tests).
export let choicesAgain = 0;
const literalsKept = keptMap<string, { given: Program; out: Program; made?: Made }>();
const litText = (v: unknown) => `${typeof v === "string" ? "s" : "v"}${String(v).trim()}`;
function butLiterals<P extends Program>(key: string, q: P): P | null {
  const was = literalsKept.get(key);
  if (!was) return null;
  const p = was.given, out = was.out as P;
  if (q.code === p.code && q.names === p.names && q.info === p.info) return out;
  if (q.info.errors.length !== p.info.errors.length || q.code.defs.length !== p.code.defs.length || q.code.defs.some((d, i) => d !== p.code.defs[i])) return null;
  if (q.names !== p.names && !sameNames(q.names, p.names)) return null;
  const changed = changedOwn(p.code.nodes, q.code.nodes);
  if (!changed) return null;
  const made = (was.made ??= madeLiterals(p.code, out.code));
  const into: Record<Id, Node> = {};
  for (const id of changed) {
    const a = p.code.nodes[id], b = q.code.nodes[id];
    if (a?.kind !== "lit" || b?.kind !== "lit" || !sameValue({ ...a, value: b.value }, b)) return null;
    if (made.unknown.has(litText(a.value))) return null;
    for (const at of [id, ...(made.copies.get(id) ?? [])]) {
      const n = out.code.nodes[at];
      if (n === undefined && at === id) continue;
      if (n?.kind !== "lit" || !sameValue({ ...n, id }, a)) return null;
      into[at] = { ...n, value: b.value } as Node;
    }
  }
  if (!Object.keys(into).length) return null;
  // Over the choice's nodes, which stay the ones kept (`was` isn't moved
  // on): a copy of them all was 14 ms of machine's number edit.
  const code: Code = { ...out.code, nodes: nodesOver(out.code.nodes, into) };
  const layer = layerOf(out.code);
  if (layer) onLayer(code, layer);
  // Its check is the last one's: each literal changed stays in its class,
  // all a check tells of it (class-key.ts), over a trial of its
  // substitution, which the steps after bind variables of their own in.
  const info = { ...out.info, subst: out.info.subst.trial() };
  choicesAgain++;
  return { ...out, code, info };
}
// The literals the choice made: copies of the program's (model.ts
// litOrigin), by the one copied, and the values of the rest (a job's
// constant, or a copy made otherwise), any of which may be a copy.
type Made = { copies: Map<Id, Id[]>; unknown: Set<string> };
function madeLiterals(given: Code, out: Code): Made {
  const copies = new Map<Id, Id[]>(), unknown = new Set<string>();
  for (const n of nodesOfKind(out, "lit")) {
    // The program's own, or the trees module's as it is (library-reps.ts withTrees).
    if (given.nodes[n.id] !== undefined || TREES.code.nodes[n.id] === n) continue;
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
function representedIn<P extends Program>(p00: P, main: Id, hostMaps: boolean, tables: boolean, sound: boolean, dataKeys: boolean): P {
  // A match on an Int's cases written out on Int first (int-cases.ts,
  // L249b): what it gives is a Nat, stored as the chooser picks.
  const cased = usesIntCases(p00.code) ? intCases(p00.code, p00.info, p00.names) : null;
  const p01 = cased ? { ...p00, ...cased } : p00;
  // gradient(f) over an array, of a function written there, made ahead as
  // the code of its pullback (pullback.ts, L285), the program's own.
  const grads = expandArrayGradients(p01.code, p01.names, p01.info);
  const p0 = grads.expanded.length ? { ...p01, code: grads.code, names: grads.names, own: [...p01.own, ...grads.code.defs.filter((d) => !p01.code.defs.includes(d))], info: infer(grads.code, grads.names, undefined, p01.info.options) } : p01;
  const reached = reachedFrom(p0, main);
  // A library type holding lists (std's Pool) the program's own, so its
  // lists are stored as the program's are (own-holders.ts, C58d).
  const held = ownLibraryHolders(reached.code, reached.info, reached.names, main, reached.own);
  const p10 = held ? { ...reached, code: held.code, names: held.names, own: held.own, info: held.info } : reached;
  // C and WebAssembly (`tables`) find neighbours on a grid written in Ters
  // (near-grid.ts, C292), the program's own so it is stored as the rest.
  // Elsewhere each is given its places alone, so its items may be columns.
  const gridded = tables ? nearOnGrid(p10.code, p10.info, p10.names, main, p10.own) : null;
  const placed = tables ? null : nearByPlaces(p10.code, p10.info, p10.names, main, p10.own);
  const p11 = gridded ? { ...p10, code: gridded.code, names: gridded.names, own: gridded.own, info: gridded.info } : placed ? { ...p10, code: placed.code, info: placed.info } : p10;
  // A map over a list numbered that replaces one item, `replace at`
  // (replace-reads.ts, C330).
  const replaced = (typeof process !== "undefined" && process.env.NO_REPLACE_READS) ? null : replaceReads(p11.code, p11.info, p11.names, p11.own, { ...(p11.options as Parameters<typeof infer>[3]), units: false });
  const p12 = replaced ? { ...p11, code: replaced.code, info: replaced.info } : p11;
  // A sorted list read only for its first item, the first by key
  // (first-sorted.ts, C356).
  const firsts = (typeof process !== "undefined" && process.env.NO_FIRST_SORTED) ? null : firstSorted(p12.code, p12.info, p12.names, p12.own, { ...(p12.options as Parameters<typeof infer>[3]), units: false });
  const p1 = firsts ? { ...p12, code: firsts.code, info: firsts.info } : p12;
  // A walk over a list made by map or flat map, a walk over what they were
  // given, so no list is made (fuse-walks.ts, G3b); its walks are the
  // program's own, stored as the rest.
  const walks = (typeof process !== "undefined" && process.env.NO_FUSE_WALKS) ? null : fuseWalks(p1.code, p1.info, p1.names, { ...(p1.options as Parameters<typeof infer>[3]), units: false });
  const p = walks?.made.length ? { ...p1, code: walks.code, info: walks.info, names: walks.names, own: [...p1.own, ...walks.made], fused: walks.fused } : p1;
  // Every definition the program has, so the ones main shares with others
  // change together; types stay as they are for its own representations.
  // The library's are chosen over the types too, so a field typed Map
  // becomes the tree its code builds (GAPS.md M2).
  // A representation's own definition says which definitions do the jobs:
  // it is read, not rewritten or run, so the represented program leaves it out.
  const reps = new Set(p.reps.map((r) => r.def));
  const defs = p.own.filter((d) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return (!b || p.code.nodes[b]?.kind !== "typedef") && !reps.has(d); });
  // A fold's costly work on each item made a map first (fold-items.ts,
  // C42e), so the map's list is chosen for as any other: an array, whose
  // map C shares out on its threads.
  const shared = (typeof process !== "undefined" && process.env.NO_FOLD_ITEMS) ? { shared: 0, code: p.code } : shareFoldItems(p.code, p.info);
  const pinfo = shared.shared ? infer(shared.code, p.names, undefined, { ...(p.options as Parameters<typeof infer>[3]), units: false }) : p.info;
  const lib = withLibraryRepresentations(shared.code, pinfo, p.names, main, p.own, p.reps, { hostMaps, tables, sound, dataKeys, held: p.held, measured: p.measured });
  let code = lib.code;
  const names = lib.names, chosen = [...lib.chosen], picks = [...(lib.picks ?? [])];
  const rows = storedRows(p.code, p.own, p.reps);
  let pins = (p.options as Parameters<typeof infer>[3])?.pins;
  for (const of of new Set(rows.map((r) => r.of))) {
    const hold = p.held?.get(of), candidates = rows.filter((r) => r.of === of);
    const rep = hold === undefined ? choose(code, main, candidates, undefined, [], p.measured?.get(of)).rep : candidates.find((r) => r.name === hold) ?? fail(`${p.names[of] ?? of} can't be held as ${hold}: it is stored as ${candidates.map((r) => r.name).join(", ")}`);
    if (rep.type === rep.of) continue;
    const problem = jobProblem(p.info, rep, p.names);
    if (problem) fail(`${p.title} can't be stored as ${rep.name}: ${problem}`);
    const before = code;
    code = represent(code, defs, rep);
    // A pinned definition the rewrite changed (std's `natural`, (Int) ->
    // Nat, built by Binary's jobs) is pinned to the type stored: its
    // callers are all here, stored so too.
    pins = storedPins(pins, before, code, of, rep.type);
    chosen.push(`${p.names[of] ?? of} as ${rep.name}`);
    picks.push({ of, rep: rep.name });
  }
  if (!chosen.length) return shared.shared ? { ...p, code: shared.code, info: pinfo } : held || replaced || firsts || walks?.made.length ? p : p0;
  // So does a library row's (std's Nat as an Int): written on the type's
  // own definitions, which a rewrite onto another row changes.
  const rowDefs = new Set(rows.flatMap((r) => (r.def ? [r.def] : [])));
  code = { ...code, defs: code.defs.filter((d) => !rowDefs.has(d)) };
  // The library's representations may call the constructors they stand for.
  const options = p.options as Parameters<typeof infer>[3];
  // Where only the library's rows were chosen, withLibraryRepresentations
  // checked this same program with these same insiders: its check is it
  // (I203: bounce's Run main checked it twice, 1.3 s the second time).
  const same = lib.info && !reps.size && chosen.length === lib.chosen.length;
  // A rewrite changes no answer, so a definition that ended as written
  // ends stored too, Diverge kept off its type and its callers' (L250):
  // a walk over an array (first and rest of a list made an array) isn't
  // one the checker sees getting smaller, and would spend a step a call
  // (C184: the pedal's following, matching and bands), nor is `is even`
  // through `match Nat′`. library-reps.ts checks its rewrite so too.
  const info = same ? lib.info! : infer(code, names, undefined, { ...options, ...(pins ? { pins } : {}), insiders: [...(options?.insiders ?? []), ...lib.insiders], ends: endedAsWritten(p.info, p.own), units: false });
  if (info.errors.length) fail(`${p.title} doesn't check on ${chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, code, names, info, chosen, picks };
}


// The program cut to what `main` reaches, with its types and its own
// representations (whose jobs main reaches only once they're chosen): a
// definition main never runs (a page's style sheet, beside the sound
// `ters render` plays) doesn't hold the choice back (C196), nor is
// rewritten.
function reachedFrom<P extends Program>(p: P, main: Id): P {
  const isType = (d: Id) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return !!b && p.code.nodes[b]?.kind === "typedef"; };
  const roots = [main, ...p.reps.flatMap((r) => [r.def, ...Object.values(r.impl), ...(r.meaning ? [r.meaning] : []), ...(r.store ? [r.store] : [])].filter((d): d is Id => !!d))];
  const keep = new Set(roots.flatMap((d) => (p.code.nodes[d] ? [d, ...dependencies(p.code, d)] : [])));
  const own = p.own.filter((d) => keep.has(d) || isType(d));
  if (own.length === p.own.length) return p;
  const gone = new Set(p.own.filter((d) => !own.includes(d)));
  const code = { ...p.code, defs: p.code.defs.filter((d) => !gone.has(d)) };
  // A cut of a checked program: its units were checked whole (I261).
  const info = infer(code, p.names, undefined, { ...(p.options as Parameters<typeof infer>[3]), units: false });
  // A cut that doesn't check (it shouldn't: nothing kept names what went)
  // is no cut.
  if (info.errors.length > p.info.errors.length) return p;
  return { ...p, code, own, info };
}

// The pins whose definitions a rewrite of `of` onto `to` changed (or
// what they call), with
// `of` read as `to` (the rest as they were, the same object where none).
function storedPins(pins: Pins | undefined, before: Code, after: Code, of: Id, to: Id): Pins | undefined {
  if (!pins) return pins;
  const swap = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(swap);
    if (!x || typeof x !== "object") return x;
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = swap(o[k]);
    if (o.t === "con" && o.id === of) out.id = to;
    return out;
  };
  const mentions = (x: unknown): boolean => Array.isArray(x) ? x.some(mentions) : !!x && typeof x === "object" && ((x as { t?: string; id?: string }).t === "con" && (x as { id?: string }).id === of || Object.values(x).some(mentions));
  const changed = new Map<Id, boolean>();
  const own = (d: Id) => { let c = changed.get(d); if (c === undefined) changed.set(d, (c = subtree(after, d).some((id) => after.nodes[id] !== before.nodes[id]))); return c; };
  let out: Pins | undefined;
  for (const d of Object.keys(pins)) {
    // Changed itself, or through what it calls (`nat literal`, by natural).
    if (!after.nodes[d] || !mentions(pins[d].type) || !(own(d) || dependencies(after, d).some((x) => after.nodes[x]?.kind === "def" && own(x)))) continue;
    out ??= { ...pins };
    out[d] = swap(pins[d]) as Pins[string];
  }
  return out ?? pins;
}
