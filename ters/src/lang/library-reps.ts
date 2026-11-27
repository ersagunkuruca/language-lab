// Library representations chosen without the program asking (BACKLOG C47,
// C48; DATA-STRUCTURES.md step 2). A program that uses std's Map or Set
// gets the representation the chooser picks from the costs of the jobs it
// uses: the sorted entries or items as defined, or the library's
// weight-balanced tree (LIBRARY.reps, from the trees module, C51). A
// representation the program writes for the type (lab, #97) still wins.
//
// A tree isn't a canonical spelling, so equal, show and compare on one
// are its row's `byType`, which go through its meaning (the sorted list).
// Where the type sits inside another value (a list of maps, a pair of
// sets, a map's values, main's answer) they are given the value with each
// tree inside it turned into its meaning, by a definition made for that
// type (C52). A map's keys or a set's items that hold one would be ordered
// by the tree's shape, so such a program keeps the definition.

import { COPIED_FROM, NODE_COPIED_FROM, originalOf, PRELUDE_DEFS, SPLIT_COPIED_FROM } from "./prelude-ids.ts";
// These types and every type their fields name, through those (a pool's
// tables, each of whose tables holds slots).
function typesWithin(code: Code, types: Id[]): Id[] {
  const seen = new Set<Id>(), todo = [...types];
  while (todo.length) {
    const t = todo.pop()!;
    if (seen.has(t)) continue;
    seen.add(t);
    const td = code.nodes[(code.nodes[t] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef") continue;
    const named = (n: Id): void => { const x = code.nodes[n]; if (x?.kind === "tref") { todo.push(x.target); x.args.forEach(named); } else if (x?.kind === "tfun") [...x.params, x.result].forEach(named); };
    for (const v of td.variants) for (const f of (code.nodes[v] as NodeOf<"variant">).fields) named((code.nodes[f] as NodeOf<"field">).type);
  }
  return [...seen];
}
// The pool's jobs told their shapes (compiler/src/pool-shapes.ts, G4).
const SHAPED_JOBS = new Set(["updated in pool shaped", "updated in pool keeping shapes", "kept in pool shaped", "pool items shaped"].map((n) => PRELUDE_DEFS[n]));
import { stableIds } from "../stable-ids.ts";
import { bindsOf, children, ownerOfTypeParts, dependencies, dependenciesOfAll, layerOf, onLayer, freshId, idsMadeBy, mapIds, merge, subtree, type Code, type Id, type Node, type NodeData, type NodeOf, isUse, isCall, type Call, copyNodes, nodeEntries, withNodes, ownNodeIds, sameValue, litOrigin, idsPlace, moveIdsTo, nodesOver, changedOwn, derivedFrom } from "../model.ts";
import type { Names } from "../presentation.ts";
import { checksKept, infer, inferEdited, type Info } from "./infer.ts";
import { Lang } from "./dsl.ts";
import { digest, hashes } from "../hash.ts";
import { LIBRARY, TREES } from "./library.ts";
import { intCases, usesIntCases } from "./int-cases.ts";
import { CARRIED, choose, represent, uses, type Measured, type Representation } from "./represent.ts";
import { LADDER } from "./cost.ts";
import { listGroups } from "./rep-groups.ts";
import { consOnto, type ConsOnto } from "./cons-onto.ts";
import { splitLists } from "./rep-split.ts";
import { carriedChoice } from "./carried-reps.ts";
import { COMPANIONS, TOGETHER } from "./together.ts";
import { keyGroups, trefGroup, type Groups } from "./map-groups.ts";
import { ownLibraryHolders } from "./own-holders.ts";
import { keptMap } from "../kept.ts";
import { ARRAY_OPS, CELL_OPS, COMPARE, CONS, LIST, MAP, MAP_V, NIL, PAIR_V, POOL, S, SET, SET_TYPE, SHOW_ANY, SIGS, TABLE_OPS } from "./std.ts";
import { ARRAY, INT, STRING, Subst, type Type } from "./types.ts";
import type { Pins } from "./signatures.ts";

// What equal, show and compare see of a value: these, given a stored one,
// are its row's (byType), which go through its meaning.
export const BY_VALUE: Record<Id, "equal" | "show" | "compare"> = { [S.equal]: "equal", [SHOW_ANY]: "show", [COMPARE]: "compare" };

// `insiders`: the representations' definitions, which may call the
// private constructors they represent (infer.ts Options). The library's
// own are insiders already (load.ts checkOptions).
// What was chosen for a type, for the program's choices (choices.ts,
// L280a): the row it is stored as and, for a split, the definitions whose
// lists start it.
export interface Pick { of: Id; rep: string; from?: Id[] }
export interface Chosen { code: Code; names: Names; chosen: string[]; insiders: Id[]; info?: Info; picks?: Pick[] }

// `defs`: the program's own definitions, which the rewrite changes;
// `asked`: the program's own representations, whose types are left alone.
// A choice that doesn't check is no choice (I105): the program checked as
// written, so a rewrite that makes it fail (a signature it pins to List,
// say) is dropped, the list row first, and the program runs as written.
// The check made is handed back as `info`.
// `hostMaps`: the program runs where std's Table is (the evaluator and
// compiled JavaScript), so a Map may be a hash table changed in place
// (C63b); WebAssembly, C and shaders have none, but see `tables`.
// `tables`: the program is compiled to C or WebAssembly, whose runtimes
// have their own Map and Set tables for Int and Text keys and tuples and
// records of them (C63h, C63i, C63k: compiler/src/c.ts `tableC`; C63j:
// compiler/src/wasm-table.ts).
// `split`: false keeps one representation of List for the whole program
// (trees where parts of it would take arrays, C93 s3b). Only where
// `hostMaps` is (JavaScript): WebAssembly's arrays copy on every replace,
// and machine split took 26 s there for primes 20000 against its trees'
// 0.3 s (C93 s5).
// `sound`: the program is a sound, played a block at a time (AUDIO.md):
// a list made in its audio loop is an object an item as written, which
// the garbage collector takes back while blocks are due, so where lists
// as arrays cost what the definition does, arrays (C196: "pedal is
// creating cons lists in the audio loop. That's just wrong").
// `dataKeys`: the target's hash tables take keys that are data (C243,
// HASH-KEYS-2026-11-15.md): a list, a set as written.
// `held`: the rows a person held in the program's choices (L280c,
// CHOICES-2026-11-20.md), by the type's id: the row's name, which must be
// one the chooser could pick here, so the meaning is kept.
export interface LibraryOptions { hostMaps?: boolean; tables?: boolean; split?: boolean; sound?: boolean; dataKeys?: boolean; held?: ReadonlyMap<Id, string>; measured?: ReadonlyMap<Id, Measured> }

// The rows the chooser picks from for each type a program stores: its own
// representations, and the library's rows for a type stored whole (std's
// Nat, as written or as an Int: the numbers module's, L249), beside the
// program's own for it, where the program names the type, a case of it or
// a definition on it. A type with rows read through their meaning by type
// (Map, Set, List) is chosen for by withLibraryRepresentations.
export function storedRows(code: Code, own: Id[], reps: Representation[]): Representation[] {
  const byType = new Set(LIBRARY.reps.filter((r) => r.byType).map((r) => r.of));
  const whole = LIBRARY.reps.filter((r) => !byType.has(r.of));
  if (!whole.length) return reps;
  const named = new Set<Id>();
  for (const d of own) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n?.kind === "ref" || n?.kind === "tref") named.add(n.target);
    else if (n?.kind === "arm") named.add(n.variant);
  }
  const wanted = new Set(whole.filter((r) => named.has(r.of) || Object.keys(r.cost).some((j) => named.has(j))).map((r) => r.of));
  return [...reps, ...whole.filter((r) => wanted.has(r.of))];
}

// A program's own definitions its check found end (no Diverge), for the
// check of a rewrite of it (infer.ts Options `ends`, L250).
export function endedAsWritten(info: Info, defs: Iterable<Id>): Id[] {
  return [...defs].filter((d) => info.typeOf.has(d) && !info.divergent.has(d));
}

// Pins without those that name one of `types` anywhere, on a definition
// `takes` says (the sounds module's `wav of` on Bytes, not Map's own
// `put`: crew-page's page lost its arrays when those went); null where
// none does.
function unpinnedOf(pins: Pins | undefined, types: Set<Id>, takes: (d: Id) => boolean): Pins | null {
  if (!pins) return null;
  const names = (t: Type): boolean => t.t === "con" ? types.has(t.id) || t.args.some(names) : t.t === "fn" ? [...t.params, t.ret].some(names) : false;
  const out: Pins = {};
  let dropped = false;
  for (const d in pins) { if (names(pins[d].type) && takes(d)) dropped = true; else out[d] = pins[d]; }
  return dropped ? out : null;
}

// The choice's program with each node it holds itself that is the same
// as the last choice's of these definitions the last one's object (its
// ids are named by what they hold, stably): what is kept by node objects
// (the check's texts of definitions, check-cache.ts defText; the passes
// after) finds them, where the rewrite made every node it holds anew.
const lastChosen = keptMap<string, Code>();
function sameNodesAsBefore(code: Code): void {
  const key = code.defs.join(" ");
  const was = lastChosen.get(key);
  if (lastChosen.size >= 8 && !was) lastChosen.clear();
  lastChosen.set(key, code);
  if (!was || was === code) return;
  const own = ownNodeIds(code.nodes), theirs = new Set(ownNodeIds(was.nodes));
  for (const id of own) {
    if (!theirs.has(id)) continue;
    const a = code.nodes[id], b = was.nodes[id];
    // (A literal copied from the same one: model.ts litOrigin.)
    if (a !== b && a !== undefined && b !== undefined && sameValue(a, b) && litOrigin(a) === litOrigin(b)) code.nodes[id] = b;
  }
}

// The last choice made from each program, by what it was asked: an edit
// of a body that leaves alone everything the chooser reads (each changed
// node's type holds nothing a row stores, nor a type of the program's
// holding one, and the edited definitions' nodes keep their types) is
// the same choice of the edited program, its rewrite the last rewrite
// with the edit's nodes put in, where the rewrite left the nodes it
// changes as they were. Null where it can't be (a definition added or
// removed, a node removed, a copy of an edited definition, a node the
// rewrite changed among those edited): chosen again.
const lastChoice = keptMap<string, { code: Code; info: Info; options: LibraryOptions; r: Chosen & { reps: Representation[] }; ids: [number | null, number | null]; checked?: Info }>();
// Options as text, to know the same ones made again.
const optionsText = (o: object | undefined): string | undefined => { try { return JSON.stringify(o ?? null, (_, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)); } catch { return undefined; } };
// How many choices were taken again so (the tests).
export let choicesReplayed = 0;
const REP_OF = new Set(LIBRARY.reps.map((r) => r.of));
function replayed(key: string, code: Code, info: Info, defs: Id[], options: LibraryOptions, idsAt: number | null): (Chosen & { reps: Representation[] }) | null {
  const was = lastChoice.get(key);
  if (!was || was.code === code) return null;
  const { code: C, info: I, r } = was;
  // Its ids drawn from where the last one's were, so a choice made again
  // would make the same ones, and those after it start where they did.
  if (idsAt !== was.ids[0]) return null;
  if (!r.reps.length || C.defs.length !== code.defs.length || C.defs.some((d, i) => d !== code.defs[i])) return null;
  const sameKeys = (a: object | undefined, b: object | undefined) => { const x = (a ?? {}) as Record<string, unknown>, y = (b ?? {}) as Record<string, unknown>; const ks = new Set([...Object.keys(x), ...Object.keys(y)]); return [...ks].every((k) => x[k] === y[k]); };
  if (!sameKeys(was.options, options)) return null;
  const io = info.options as Record<string, unknown> | undefined, wo = I.options as Record<string, unknown> | undefined;
  // (Options made again for each round: insiders, pins, ends.)
  if (!sameKeys(wo, io)) {
    const text = (o: object | undefined) => { try { return JSON.stringify(o ?? null, (_, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)); } catch { return undefined; } };
    const a = text(wo);
    if (a === undefined || a !== text(io)) return null;
  }
  // Each definition's nodes as they were and are, by object: a node map
  // over another can hide what changed below it.
  // (Walked here without subtree's kept walks, which a walk of the last
  // program would move on.)
  const walk = (c: Code, root: Id): Id[] => { const out: Id[] = [], todo = [root]; while (todo.length) { const id = todo.pop()!; out.push(id); const n = c.nodes[id]; if (n) todo.push(...children(n)); } return out; };
  let changed: Id[] | undefined = changedOwn(C.nodes, code.nodes);
  if (!changed) {
    changed = [];
    const seen = new Set<Id>();
    for (const d of defs) for (const id of [...walk(code, d), ...walk(C, d)]) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (C.nodes[id] !== code.nodes[id]) changed.push(id);
    }
  }
  if (!changed.length) return null;
  if (changed.some((id) => code.nodes[id] === undefined || C.nodes[id]?.kind === "def" || code.nodes[id].kind === "def")) return null;
  // The definitions holding the changed nodes, each read as it was and is.
  const ownDefs = new Set(defs);
  const inDef = new Map<Id, Id>();
  for (const d of defs) for (const id of walk(code, d)) inDef.set(id, d);
  const edited = new Set<Id>();
  for (const id of changed) { const d = inDef.get(id); if (d === undefined || !ownDefs.has(d)) return null; edited.add(d); }
  // A copy of one (a split's, or the library's for a type) is made anew.
  for (const from of [SPLIT_COPIED_FROM, COPIED_FROM]) for (const [, o] of from) if (edited.has(o)) return null;
  for (const d of r.code.defs) if (edited.has(originalOf(d)) && d !== originalOf(d)) return null;
  const holds = new Map<Id, boolean>();
  const ownHolds = (t: Id): boolean => {
    if (holds.has(t)) return holds.get(t)!;
    holds.set(t, true);
    const td = code.nodes[(code.nodes[t] as NodeOf<"def"> | undefined)?.body ?? ""];
    const ok = td?.kind === "typedef" && td.variants.every((v) => (code.nodes[v] as NodeOf<"variant">).fields.every((fl) => plainTree(code.nodes[(code.nodes[fl] as NodeOf<"field">).type])));
    holds.set(t, !ok);
    return !ok;
  };
  const plainTree = (n: Node | undefined): boolean => n?.kind === "tfun" ? [...n.params, n.result].every((x) => plainTree(code.nodes[x])) : n?.kind === "tref" ? !REP_OF.has(n.target) && !(ownDefs.has(n.target) && ownHolds(n.target)) && n.args.every((x) => plainTree(code.nodes[x])) : true;
  const plain = (t: Type | undefined, s: Subst): boolean => {
    if (!t) return false;
    t = s.zonk(t);
    if (t.t === "var") return true;
    if (t.t === "fn") return [...t.params, t.ret].every((x) => plain(x, s));
    return !REP_OF.has(t.id) && !(ownDefs.has(t.id) && ownHolds(t.id)) && t.args.every((x) => plain(x, s));
  };
  // Two types alike, their variables (and rows') one for one.
  const vs = new Map<number, number>(), vsBack = new Map<number, number>(), rs = new Map<unknown, unknown>(), rsBack = new Map<unknown, unknown>();
  const pair = <K>(m: Map<K, K>, back: Map<K, K>, a: K, b: K) => { const x = m.get(a), y = back.get(b); if (x === undefined && y === undefined) { m.set(a, b); back.set(b, a); return true; } return x === b && y === a; };
  const alike = (a0: Type | undefined, b0: Type | undefined): boolean => {
    if (!a0 || !b0) return a0 === b0;
    const a = I.subst.zonk(a0), b = info.subst.zonk(b0);
    if (a.t !== b.t) return false;
    if (a.t === "var") return pair(vs, vsBack, a.v, (b as typeof a).v);
    if (a.t === "con") { const y = b as typeof a; return a.id === y.id && a.args.length === y.args.length && a.args.every((x, i) => alike(x, y.args[i])); }
    const y = b as typeof a;
    if (a.params.length !== y.params.length || !a.params.every((x, i) => alike(x, y.params[i])) || !alike(a.ret, y.ret)) return false;
    const ra = I.subst.resolveRow(a.eff), rb = info.subst.resolveRow(y.eff);
    if (ra.effs.length !== rb.effs.length || ra.effs.some((e, i) => e !== rb.effs[i])) return false;
    if ((ra.tail === null) !== (rb.tail === null) || (ra.tail !== null && !pair(rs, rsBack, ra.tail, rb.tail))) return false;
    return ra.effs.every((e) => { const xa = ra.args?.[e] ?? [], xb = rb.args?.[e] ?? []; return xa.length === xb.length && xa.every((x, i) => alike(x, xb[i])); });
  };
  // Each node changed in place is where the rewrite left it: in its
  // definition, or in one holding that definition's body (main as
  // stored), not in a copy of it (a loop's, cons-onto.ts) with the
  // original left behind.
  const placed = new Set<Id>();
  for (const d of edited) {
    const mine = new Set(walk(C, d));
    for (const x of [d, ...r.code.defs.filter((m) => { const b = (r.code.nodes[m] as NodeOf<"def"> | undefined)?.body; return b !== undefined && b !== null && m !== d && mine.has(b); })]) for (const id of walk(r.code, x)) placed.add(id);
  }
  const into: Record<Id, Node> = {};
  for (const d of edited) {
    if (!alike(I.typeOf.get(d), info.typeOf.get(d))) return null;
    for (const id of walk(code, d)) {
      const n = code.nodes[id], before = C.nodes[id];
      if (before === n) {
        // Kept, and typed as it was.
        if (!alike(I.typeOf.get(id), info.typeOf.get(id))) return null;
        continue;
      }
      if (before) {
        // Changed in place, the rewrite having left it as it was: what is
        // in it put anew (each new node plain) or, plain itself, anything.
        if (!placed.has(id) || !sameValue(r.code.nodes[id], before)) return null;
        // Each of its children where it was, or new (a node moved to
        // another place in it could change what flows where).
        const now = children(n), then = children(before);
        if (now.length !== then.length || now.some((x, i) => x !== then[i] && C.nodes[x] !== undefined)) return null;
        const same = n.kind === before.kind && (n.kind !== "ref" || n.target === (before as NodeOf<"ref">).target) && (!isCall(n) || n.fn === (before as Call).fn) && alike(I.typeOf.get(id), info.typeOf.get(id));
        if (!same && (!plain(info.typeOf.get(id), info.subst) || !plain(I.typeOf.get(id), I.subst))) return null;
      } else if (!plain(info.typeOf.get(id), info.subst) || r.code.nodes[id] !== undefined || n.kind === "arm" || n.kind === "match" || n.kind === "fold") return null;
      // What the definition reaches is as it was (a split's sides).
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "def" && !(before?.kind === "ref" && before.target === n.target)) return null;
      into[id] = n;
    }
  }
  // No node of an edited definition left behind.
  for (const id of changed) if (!inDef.has(id)) return null;
  for (const d of edited) for (const id of walk(C, d)) if (!inDef.has(id)) return null;
  choicesReplayed++;
  if (was.ids[1] !== null) moveIdsTo(was.ids[1]);
  const nodes = copyNodes(r.code.nodes);
  const replaced: Id[] = [];
  for (const id in into) if (into[id] !== r.code.nodes[id]) { nodes[id] = into[id]; replaced.push(id); }
  // What the replay replaced, so the check after it need not look for it
  // (inferEdited); no node is gone.
  const out = { nodes, defs: r.code.defs };
  derivedFrom(out, r.code, replaced, true);
  return { ...r, code: out };
}

export function withLibraryRepresentations(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[] = [], options: LibraryOptions = {}): Chosen {
  // A match on an Int's cases is written out on Int before Nat is stored
  // (int-cases.ts, L249b).
  if (usesIntCases(code)) ({ code, info, names } = intCases(code, info, names));
  const skip = new Set<Id>();
  for (;;) {
    const choose = () => choiceOf(code, info, names, main, defs, asked, skip, options);
    const replayKey = checksKept(info.options) ? `${main} ${defs.join(" ")}|${asked.map((x) => `${x.of} ${x.name}`).join(",")}|${[...skip].join(",")}` : undefined;
    const idsBefore = idsPlace();
    const last = replayKey ? lastChoice.get(replayKey) : undefined;
    const again = replayKey ? replayed(replayKey, code, info, defs, options, idsBefore) : null;
    const r = again || (checksKept(info.options) ? stably(idsMadeBy(choose), code, defs) : choose());
    const kept: { code: Code; info: Info; options: LibraryOptions; r: Chosen & { reps: Representation[] }; ids: [number | null, number | null]; checked?: Info } | undefined = replayKey ? { code, info, options, r, ids: [idsBefore, idsPlace()] } : undefined;
    if (replayKey) lastChoice.set(replayKey, kept!);
    if (!r.reps.length) return { code, names, chosen: [], insiders: [] };
    if (checksKept(info.options)) sameNodesAsBefore(r.code);
    // The program's own options where nothing is added, so the check reads
    // through to the library's, kept for those options (infer.ts `under`):
    // checked anew, the library is most of a second (C196's splits).
    // On the library's layer as the program was (load.ts base), so the
    // check scans only what isn't the library's (model.ts onLayer).
    const layer = layerOf(code);
    if (layer && layer !== r.code) onLayer(r.code, layer);
    // What ended as written ends rewritten (infer.ts Options `ends`, L250).
    const ends = endedAsWritten(info, defs);
    // Its units aren't checked again: a rewrite changes none (I261).
    const checkWith = { ...info.options, ...(r.insiders.length ? { insiders: [...(info.options?.insiders ?? []), ...r.insiders] } : {}), ends, units: false as const };
    const carried = carriedChoice(code, info, r.code, r.reps, defs);
    // A choice taken again is checked over the last one's check, as the
    // edit was (infer.ts inferEdited).
    const lastCheck = again && last?.checked?.options && !carried && optionsText(last.checked.options) === optionsText(checkWith) ? inferEdited(last.r.code, r.code, r.names, last.checked, last.checked.options) : null;
    let checked = carried ? { ...carried, options: checkWith } : lastCheck ?? infer(r.code, r.names, undefined, checkWith);
    if (kept) kept.checked = checked;
    // A pin that names a type stored now (the sounds module's on Bytes,
    // L271c) is the meaning's: the definitions under it take the stored
    // type, as the check carried says (carried-reps.ts). Where the check
    // made again (TERS_RECHECK, carried-types.test) refuses the rewrite
    // with such pins, it reads those definitions by their bodies.
    // Only on a definition the rewrite changed, or one that calls one
    // (`sample at` passes its Bytes to `bytes as 16 bits`): Map's own `put`
    // keeps its pin, as crew-page's page needs.
    const changed = (d: Id) => r.code.nodes[d] !== code.nodes[d] || subtree(r.code, d).some((x) => r.code.nodes[x] !== code.nodes[x]);
    // Worked out only where read: lists chosen and checked need none
    // (machine: a pin's walk of its definitions each, 25 ms of an edit).
    let unpinned: Pins | null | undefined;
    const unpinnedNow = () => (unpinned === undefined ? (unpinned = unpinnedOf(info.options?.pins, new Set(r.reps.map((x) => x.of)), (d) => changed(d) || [...dependenciesOfAll(r.code, [d])].some((x) => x !== d && code.nodes[x]?.kind === "def" && changed(x)))) : unpinned);

    if (!carried && checked.errors.length > info.errors.length && unpinnedNow()) checked = infer(r.code, r.names, undefined, { ...checkWith, pins: unpinnedNow()! });
    if (checked.errors.length <= info.errors.length) {
      // Lists go alone (choiceOf); with Map or Set chosen first, they're
      // chosen again on what that made, the Map and Set rows asked for as
      // the program's own (C93).
      if (r.reps.some((x) => x.of === LIST) || asked.some((x) => x.of === LIST)) return { code: r.code, names: r.names, chosen: r.chosen, insiders: r.insiders, info: checked, picks: r.picks };
      const insiders = [...(info.options?.insiders ?? []), ...r.insiders];
      // A chosen row's own type that holds lists (a pool's slots) made the
      // program's own, so its lists are stored as the program's are.
      // With the types it holds (a pool's tables hold slots, G4).
      const held = r.reps.some((x) => TOGETHER[x.of]) ? ownLibraryHolders(r.code, { ...checked, options: { ...checked.options, insiders } }, r.names, main, defs, typesWithin(r.code, r.reps.map((x) => x.type))) : null;
      // Those pins are dropped for the lists' choice on what this made, so
      // it checks those definitions by their bodies.
      const next = held ? { code: held.code, info: held.info, names: held.names, defs: held.own } : { code: r.code, info: { ...checked, options: { ...checked.options, insiders, ...(unpinnedNow() ? { pins: unpinnedNow()! } : {}) } }, names: r.names, defs };
      const lists = withLibraryRepresentations(next.code, next.info, next.names, main, next.defs, [...asked, ...r.reps], options);
      return lists.chosen.length
        ? { ...lists, chosen: [...r.chosen, ...lists.chosen], insiders: [...r.insiders, ...lists.insiders], picks: [...(r.picks ?? []), ...(lists.picks ?? [])] }
        : held ? { code: held.code, names: held.names, chosen: r.chosen, insiders: r.insiders, info: held.info, picks: r.picks } : { code: r.code, names: r.names, chosen: r.chosen, insiders: r.insiders, info: checked, picks: r.picks };
    }
    // A type chosen per group that doesn't check is chosen whole.
    if ((r as { split?: boolean }).split) { for (const x of r.reps) skip.add("split " + x.of); continue; }
    const list = r.reps.find((x) => x.of === LIST);
    // Lists as arrays for the whole that don't check (a sound's function
    // given to `listen`, which takes lists, C354): split, as where the
    // boundary refuses them.
    if (list && r.chosen.includes(`${names[LIST] ?? LIBRARY.names[LIST]} as ${list.name}`) && !skip.has(WHOLE_LISTS)) { skip.add(WHOLE_LISTS); continue; }
    // A hash table that doesn't check gives way to the tree, not to the
    // definition.
    const table = r.reps.find((x) => x.oneHolder);
    for (const x of table ? [table] : list ? [list] : r.reps) skip.add(table ? x.name + " " + x.of : x.of);
  }
}

// The choice's new nodes named by what they hold (stable-ids.ts), so the
// check of what it made finds its groups kept from the last compile, in
// this process or on disk: machine's was checked again whole each time.
// Only where checks are kept (`ters`, the editor): elsewhere nothing
// finds them, and naming them is 80 ms of machine's.
function stably({ result: r, made }: { result: Chosen & { reps: Representation[] }; made: Set<Id> }, before: Code, defs: Id[]): Chosen & { reps: Representation[] } {
  if (!r.reps.length || !made.size) return r;
  const was = new Set(before.defs);
  const { code, rename } = stableIds(r.code, made, dependenciesOfAll(r.code, defs), [...defs, ...r.code.defs.filter((d) => !was.has(d))]);
  if (!rename.size) return r;
  const f = (id: Id) => rename.get(id) ?? id;
  const names: Names = {};
  for (const k in r.names) names[f(k)] = r.names[k];
  for (const from of [COPIED_FROM, SPLIT_COPIED_FROM]) for (const [a, b] of rename) { const o = from.get(a); if (o !== undefined) from.set(b, o); }
  return { ...r, code, names, insiders: r.insiders.map(f) };
}

// What choiceOf decided, kept between compiles (the incremental compile)
// by the program but for its numbers, texts and truth values, which no
// decision reads (only the rewrite does, and a representation's own
// hidden fields, read before: `asked` is in the key whole): rows of the
// library's representations by their place in it, or which split was
// made. An edit of a number found the same choice of greenhouse-page's
// map and lists again, 0.2 s of a recompile.
// Kept only inside `choosingFor`, given the key of the program the whole
// choice starts from (represented.ts): each choice made from it is known
// by its place in that compile, what was asked and what was skipped, so
// no choice's program (a second of greenhouse-page's, a megabyte written
// out) is keyed itself.
export type Decided = { split: "groups"; made: GroupSplit } | { split: "holders"; tree: number } | { chosen: number[] };
const decidedKept = keptMap<string, Decided>();
// And on disk where the command line keeps them (L280b, library-store.ts
// decidedStore): the next command's compile of the same program, but for
// its numbers, texts and truth values, takes the choice without the
// chooser (machine: about 0.3 s of a cold compile).
export interface DecidedStore { load(key: string): Decided | undefined; save(key: string, d: Decided): void }
let decidedStore: DecidedStore | null = null;
export function keepDecisionsIn(store: DecidedStore | null) { decidedStore = store; }
let context: { key: string; n: number } | undefined;
export function choosingFor<T>(key: string, f: () => T): T {
  const was = context;
  context = { key, n: 0 };
  try { return f(); } finally { context = was; }
}

// The types of a definition's nodes, zonked: found once for a program
// and its check while the check binds nothing more, where each type test
// of the chooser below zonked every node of every definition again (some
// 80 ms of machine's choice).
const zonkedKept = new WeakMap<Code, WeakMap<Info, { at: number; defs: Map<Id, Type[]> }>>();
function typesIn(code: Code, info: Info, d: Id): Type[] {
  const at = info.subst.bound();
  let byInfo = zonkedKept.get(code);
  if (!byInfo) zonkedKept.set(code, (byInfo = new WeakMap()));
  let k = byInfo.get(info);
  if (!k || k.at !== at) byInfo.set(info, (k = { at, defs: new Map() }));
  let ts = k.defs.get(d);
  if (!ts) {
    ts = [];
    for (const id of subtree(code, d)) { const t = info.typeOf.get(id); if (t) ts.push(info.subst.zonk(t)); }
    k.defs.set(d, ts);
  }
  return ts;
}

// A choice that didn't check, so lists aren't held one way for the whole.
const WHOLE_LISTS = "whole " + LIST;
function choiceOf(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[], skip: Set<Id>, options: LibraryOptions): Chosen & { reps: Representation[] } {
  const chosen: Representation[] = [];
  // Where a type's rows are chosen per group (C358): each row's groups,
  // and the sites' groups.
  const groupsOf = new Map<Representation, Set<string>>();
  let sites: Groups | null = null;
  const key = context && `${context.key}#${context.n++}|${JSON.stringify([asked, [...skip].sort()])}`;
  const was = key ? decidedKept.get(key) ?? decidedStore?.load(key) : undefined;
  const keep = (d: Decided) => { if (!key) return; if (decidedKept.size >= 16) decidedKept.clear(); decidedKept.set(key, d); decidedStore?.save(key, d); };
  let replayed = false;
  if (was && "split" in was) {
    const s = was.split === "groups" ? splitByGroups(code, info, names, main, defs, was.made) : splitByHolders(code, info, names, main, defs, LIBRARY.reps[was.tree]);
    if (s) return s;
  } else if (was) {
    chosen.push(...was.chosen.map((i) => LIBRARY.reps[i]));
    replayed = true;
  }
  let backwards: boolean | undefined;
  // A solve on lists, or a function on lists handed to a definition that
  // solves (conjugate's bands, run backwards by inverse).
  const listed = (t: Type | undefined): boolean => { if (!t) return false; t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || t.args.some(listed) : t.t === "fn" ? [...t.params, t.ret].some(listed) : false; };
  const runsBackwards = () => {
    if (backwards !== undefined) return backwards;
    const reach = [main, ...dependencies(code, main)].filter((d) => code.nodes[d]?.kind === "def");
    const solves = new Map<Id, boolean>();
    const solving = (d: Id): boolean => {
      if (solves.has(d)) return solves.get(d)!;
      solves.set(d, false);
      const yes = subtree(code, d).some((x) => { const n = code.nodes[x]; return isUse(n) || (n.kind === "ref" && n.target !== d && code.nodes[n.target]?.kind === "def" && solving(n.target)); });
      solves.set(d, yes);
      return yes;
    };
    return (backwards = reach.some((d) => subtree(code, d).some((x) => {
      const n = code.nodes[x];
      if (isUse(n)) return [...Object.values(n.given), ...Object.values(bindsOf(n)), n.id].some((y) => listed(info.typeOf.get(y)));
      if (!isCall(n)) return false;
      const f = code.nodes[n.fn];
      return f?.kind === "ref" && code.nodes[f.target]?.kind === "def" && solving(f.target)
        && n.args.some((a) => { const g = code.nodes[a]; return g?.kind === "ref" && code.nodes[g.target]?.kind === "def" && listed(info.typeOf.get(a)); });
    })));
  };
  // The types already chosen to be hash tables, which no key can hold.
  const tabled = () => new Set(chosen.filter((r) => r.oneHolder).map((r) => r.of));
  // A type in the keys of a hash table chosen already stays as written
  // (C243): a key is hashed by its one spelling, which a tree or an array
  // of it isn't.
  const inTableKeys = (ty: Id) => {
    const holders = tabled();
    if (!holders.size) return false;
    const has = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" && (t.id === ty || t.args.some(has)); };
    return defs.some((d) => typesIn(code, info, d).some((t) => t.t === "con" && holders.has(t.id) && !!t.args[0] && has(t.args[0])));
  };
  // A row and the rows of the types stored with it, by the same name
  // (together.ts: a pool's slots and its keys').
  const pick = (row: Representation) => { chosen.push(row, ...(TOGETHER[row.of] ?? []).flatMap((c) => LIBRARY.reps.filter((r) => r.of === c && r.name === row.name))); };
  // What a row chosen already does in its meaning's place: a pool in
  // slots never runs the pool's Map, so the Map's jobs aren't counted
  // through it. The types stored together (a pool) go first, so the
  // types their meanings use are chosen for what is left.
  const replaced = () => chosen.flatMap((r) => (r.canonical ? [] : Object.keys(r.impl)));
  const byType = [...new Set(LIBRARY.reps.filter((r) => r.byType && !COMPANIONS.has(r.of)).map((r) => r.of))];
  // Lists last: a choice of them goes alone and ends this one, so a type
  // after them (Bytes, read by position in wav-file) was never looked at.
  if (!replayed) types: for (const ty of [...byType.filter((t) => TOGETHER[t]), ...byType.filter((t) => !TOGETHER[t] && t !== LIST), ...byType.filter((t) => t === LIST)]) {
    const spec = LIBRARY.reps.find((r) => r.of === ty && r.canonical)!;
    const hold = options.held?.get(ty);
    const refuse = (why: string): never => { throw new Error(`${names[ty] ?? LIBRARY.names[ty] ?? ty} can't be held as ${hold} here: ${why}`); };
    // A list's split held (`array of List from a, b`): split off from
    // those definitions, where the lists can be (rep-split.ts), alone as
    // the chooser's splits are.
    if (ty === LIST && hold?.includes(" from ") && !asked.some((r) => r.of === LIST)) {
      if (skip.has(LIST)) refuse("the program stored so doesn't check");
      if (chosen.length) continue;
      return heldSplit(code, info, names, main, defs, hold, refuse);
    }
    if (hold !== undefined && hold !== spec.name && !asked.some((r) => r.of === ty)) {
      if (!LIBRARY.reps.some((r) => r.of === ty && r.name === hold)) refuse(`it is stored as ${LIBRARY.reps.filter((r) => r.of === ty).map((r) => r.name).join(", ")}`);
      if (skip.has(ty) || skip.has(hold + " " + ty)) refuse("the program stored so doesn't check");
      if (inTableKeys(ty)) refuse("it is in a hash table's keys, which hash it as written");
    }
    if (hold === spec.name) continue;
    if (asked.some((r) => r.of === ty) || skip.has(ty) || inTableKeys(ty)) continue;
    // A hash table only where it is (hostMaps), and only where every map
    // has one holder, so a put changing it in place can't be seen.
    // A program that runs something on lists backwards (a solve, inverse)
    // keeps them off the tree: its jobs are definitions of its own (a
    // weight-balanced tree's), and a search run backwards through them
    // never finishes, where an array runs backwards as a list does
    // (conjugate's bands given to inverse, beside a page whose `styled`
    // appends in a loop, I292).
    const rows = LIBRARY.reps.filter((r) => r.of === ty && r.byType && !skip.has(r.name + " " + ty) && !(r.name === "tree of List" && runsBackwards())
      && (!r.oneHolder || (options.hostMaps && inPlace(code, info, main, defs, r, tabled(), options.dataKeys))
        || (options.tables && (ty === MAP || ty === SET_TYPE) && inPlace(code, info, main, defs, r, tabled(), options.dataKeys))));
    if (hold !== undefined) {
      // Held: that row, where the chooser could have picked it (L280c).
      const row = rows.find((r) => r.name === hold) ?? refuse(LIBRARY.reps.find((r) => r.of === ty && r.name === hold)?.oneHolder ? "a map or set here has more than one holder, so a put in place could be seen"
        : ty === LIST && hold === "tree of List" ? "it runs something on lists backwards, which the chooser leaves as written" : "the chooser can't pick it here");
      if (!uses(code, main, [spec, row], false, replaced()).length) refuse(`main doesn't use it`);
      // A whole program's lists held (array or tree): alone, as the
      // chooser's are (in a round of their own, after the types chosen
      // with them here), and only where every list the program reaches can
      // be one (listBoundary); a sound played in blocks keeps arrays.
      if (ty === LIST) {
        if (chosen.length) continue;
        if (options.sound && row.name !== "array of List") refuse("a sound played in blocks keeps its lists as arrays");
        // Not where something runs on lists backwards: the chooser leaves
        // those as written, and conjugate's inverse held on arrays never
        // ends.
        if (runsBackwards()) refuse("it runs something on lists backwards, which the chooser leaves as written");
        if (keyed(info, defs, code, ty) || generic(info, defs, code, row)) refuse("its values cross where it can't be converted");
        if (!listBoundary(withTrees(code, [row]), info, defs, row, asked)) refuse("some list the program reaches can't be one; a split can be held instead");
        pick(row);
        continue;
      }
      if (keyed(info, defs, code, ty) || generic(info, defs, code, row) || !plainBoundary(code, defs, row)) refuse("its values cross where it can't be converted");
      pick(row);
      continue;
    }
    if (!rows.length || !uses(code, main, [spec, ...rows], false, replaced()).length) continue;
    // What an edge does with its own lists (Bytes' `byte at`, by position)
    // is no job of theirs: the edge keeps them as written.
    const edges = ty === LIST ? (() => { const { edge } = listEdges(code, info, new Set(defs), new Set(asked.map((r) => r.of))); return code.defs.filter((d) => edge(d)); })() : [];
    // The next best where the best can't be had for the whole: arrays
    // where some list can't be one go to the tree, if it is cheaper than
    // as written (C45's appends and changes by position, now that an
    // append onto what a loop carries is the array's own, C234).
    const left = [...rows];
    // A Map's groups by key type, each stored its own way where they'd be
    // chosen apart (map-groups.ts, C358): crew's maps by name as hash
    // tables, its map by worker number, which gives its smallest key, a
    // tree. Not where a run measured the type, whose sizes are the whole's.
    if (ty === MAP && !skip.has("split " + ty) && !options.measured?.get(ty)) {
      const g = keyGroups(code, info, [main, ...defs], ty, new Set(LIBRARY.reps.filter((r) => r.of === ty).flatMap((r) => Object.keys(r.cost))));
      if (g && g.heads.length > 1) {
        const target = (id: Id) => (code.nodes[id] as NodeOf<"ref">).target;
        const referred = new Set([...g.of.keys()].map(target));
        const opaque = [...asked.flatMap((r) => Object.keys(r.impl)), ...replaced(), ...edges];
        const per = g.heads.map((h) => [h, choose(code, main, [spec, ...left], undefined, opaque, undefined, { jobs: new Set([...g.of].filter(([, x]) => x === h).map(([id]) => target(id))), referred }).rep] as const);
        const rowsOf = new Set(per.map(([, r]) => r));
        if (rowsOf.size > 1 && !rowsOf.has(spec) && !keyed(info, defs, code, ty) && [...rowsOf].every((r) => !generic(info, defs, code, r) && plainBoundary(code, defs, r))) {
          for (const r of rowsOf) { pick(r); groupsOf.set(r, new Set(per.filter(([, x]) => x === r).map(([h]) => h))); }
          sites = g;
          continue;
        }
      }
    }
    for (;;) {
      // A pool whose systems were told their shapes (compiler/src/pool-shapes.ts,
      // G4) as a table per shape: the ladder can't write the part of n a
      // shaped job walks there, so its costs tie with the slots'.
      const opaque = [...asked.flatMap((r) => Object.keys(r.impl)), ...replaced(), ...edges];
      const shapedPool = ty === POOL && uses(code, main, [spec, ...left], true, opaque).some((j) => SHAPED_JOBS.has(j));
      const tree = choose(code, main, [spec, ...left], options.sound && ty === LIST ? (r) => r.name === "array of List" : shapedPool ? (r) => r.name === "tables" : undefined, opaque, options.measured?.get(ty)).rep;
      if (tree === spec || keyed(info, defs, code, ty) || generic(info, defs, code, tree)) continue types;
      // Lists as trees for the whole, where parts of it would have arrays
      // (machine's step loop): those parts as arrays, the rest as written,
      // converted where a list crosses (rep-split.ts, C93 s3b). Only where
      // the trees could be had, so a program kept as written stays so; and
      // where they couldn't for the whole (break's list of lists, which no
      // boundary turns into arrays), the parts still can (C188). On every
      // target, host maps or not: a program using Bytes, which holds a
      // List, has its table as an array in C and WebAssembly too (C192).
      if (tree.of === LIST && tree.name === "tree of List" && options.split !== false && !chosen.length) {
        const s = splitByGroups(code, info, names, main, defs);
        if (s) { keep({ split: "groups", made: s.made }); return s; }
      }
      // Lists as arrays (C30d3b): alone, and only where every list the
      // program reaches can be one (listBoundary); otherwise each of the
      // program's definitions that never sees a library type holding lists
      // (a page's Html) takes them, and the rest keep lists as written,
      // converted where they cross (C196: the pedal's sound beside its page).
      if (tree.of === LIST && !chosen.length && (skip.has(WHOLE_LISTS) || !listBoundary(withTrees(code, [tree]), info, defs, tree, asked))) {
        const s = options.split !== false ? splitByHolders(code, info, names, main, defs, tree) : null;
        if (s) { keep({ split: "holders", tree: LIBRARY.reps.indexOf(tree) }); return s; }
        left.splice(left.indexOf(tree), 1);
        if (tree.name === "array of List" && left.length) continue;
        continue types;
      }
      if (tree.of === LIST && chosen.length) continue types;
      if (tree.of !== LIST && !plainBoundary(code, defs, tree)) continue types;
      pick(tree);
      break;
    }
  }
  if (!replayed && !groupsOf.size && chosen.every((r) => LIBRARY.reps.includes(r))) keep({ chosen: chosen.map((r) => LIBRARY.reps.indexOf(r)) });
  if (!chosen.length) return { code, names, chosen: [], insiders: [], reps: [] };
  // The trees' module, which the library leaves out (library.ts): only
  // the definitions the chosen rows use, since the program is checked
  // again with them (the whole module is about 2,500 nodes).
  code = withTrees(code, chosen);
  names = { ...TREES.names, ...names };
  // Lists as arrays reach the library's own definitions on lists (map,
  // sum, …): the program gets its own copies of them, which the rewrite
  // changes, and the library's stay as they are for everything else.
  const lists = chosen.find((r) => r.of === LIST), boundary = lists && listBoundary(code, info, defs, lists, asked)!;
  let copies: Id[] = [];
  if (boundary) {
    let withBoundary: Code = { nodes: withNodes(code.nodes, boundary.nodes), defs: [...code.defs, ...boundary.made] };
    const c = loopsOnto(withBoundary, info, names, defs, lists);
    if (c) {
      withBoundary = { nodes: withNodes(withBoundary.nodes, c.nodes), defs: [...withBoundary.defs, ...c.made] };
      code = { nodes: withNodes(code.nodes, c.nodes), defs: [...code.defs, ...c.made] };
      names = { ...names, ...c.names };
      defs = [...defs, ...c.made];
    }
    // Only those with a list somewhere in them: one generic in what it is
    // given (conjugate, inverse, applied) the rewrite leaves as it is, and
    // a copy would hide it from what knows it by its id (the compiler's
    // inverses.ts, which writes the pedal's solves out, C196).
    const listed = (t: Type | undefined): boolean => { if (!t) return false; t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || t.args.some(listed) : t.t === "fn" ? [...t.params, t.ret].some(listed) : false; };
    const library = boundary.reached.filter((d) => !defs.includes(d) && subtree(code, d).some((x) => listed(info.typeOf.get(x))));
    // And each that calls one of those (show decimals, whose padded
    // digits folds over a range): left as it is, it would call the
    // library's own, which the rewrite then reaches through it and
    // changes (round 13 P1).
    for (let grew = true; grew;) {
      grew = false;
      for (const d of boundary.reached) if (!defs.includes(d) && !library.includes(d) && subtree(code, d).some((x) => { const n = code.nodes[x]; return n.kind === "ref" && library.includes(n.target); })) { library.push(d); grew = true; }
    }
    // Each copy's ids come from what it copies, as it is with the
    // boundary's changes (src/hash.ts, which reaches what it calls): the
    // same copy each run, so the check of a rewrite finds its groups kept
    // from the last (check-cache.ts), on any program that copies them so
    // (I264). Its original's id is in it too: two definitions written alike
    // copy apart.
    const memo = hashes(withBoundary, library);
    const fresh = new Map<Id, Id>();
    for (const d of library) for (const id of subtree(withBoundary, d)) fresh.set(id, digest(["copy", d, memo.get(d)!, id]));
    const f = (id: Id) => fresh.get(id) ?? id;
    // Known by their originals' ids too (pure-branches.ts): each takes and
    // gives its lists as the original does.
    for (const d of library) COPIED_FROM.set(f(d), originalOf(d));
    for (const [from, to] of fresh) NODE_COPIED_FROM.set(to, from);
    const nodes = copyNodes(withBoundary.nodes);
    for (const d of library) for (const id of subtree(withBoundary, d)) { const n = mapIds(withBoundary.nodes[id], f); nodes[n.id] = n; }
    for (const d of defs) for (const id of subtree(withBoundary, d)) nodes[id] = mapIds(withBoundary.nodes[id], f);
    // The boundary's changes are the copies'; the library's own stay as
    // written, for whatever else calls them (a Map row's meaning, C93).
    for (const d of library) for (const id of subtree(code, d)) nodes[id] = code.nodes[id];
    code = { nodes, defs: [...code.defs, ...boundary.made, ...library.map(f)] };
    names = { ...names, ...Object.fromEntries(library.map((d) => [f(d), names[d] ?? LIBRARY.names[d] ?? d])), ...Object.fromEntries(boundary.made.map((d) => [d, "stored list"])) };
    copies = library.map(f);
    // The library's copies too (zipped, numbered): typed as their originals.
    const back = new Map([...fresh].map(([a, b]) => [b, a]));
    const lc = loopsOnto(code, info, names, copies, lists, (to, from) => { const t = info.typeOf.get(back.get(from) ?? from); if (t) info.typeOf.set(to, t); });
    if (lc) {
      code = { nodes: withNodes(code.nodes, lc.nodes), defs: [...code.defs, ...lc.made] };
      names = { ...names, ...lc.names };
      copies = [...copies, ...lc.made];
    }
  }
  // equal, show and compare on a stored value: the row's own, through its
  // meaning; on a value with one inside, given that value as meanings.
  const k = new Lang(code);
  const bounds = chosen.filter((r) => r.of !== LIST).map((r) => plainBoundary(code, defs, r, names)!);
  const copyOf = new Map(bounds.flatMap((b) => [...b.copyOf]));
  // A type's row: by its key type where its rows are chosen per group.
  const rowFor = (t: Type & { t: "con" }) => chosen.find((r) => {
    if (r.of !== t.id) return false;
    const gs = groupsOf.get(r);
    if (!gs) return true;
    const a = t.args[0] && info.subst.zonk(t.args[0]);
    return !!a && a.t === "con" && gs.has(a.id);
  });
  const meanings = asMeanings(k, code, info, names, chosen, copyOf, rowFor);
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  const typeOf = (id: Id) => { const t = info.typeOf.get(id); return t && info.subst.zonk(t); };
  const rowOf = (id: Id) => { const t = typeOf(id); return t?.t === "con" ? rowFor(t) : undefined; };
  const call = (fn: Id, arg: Id): Id => { const r = freshId(), c = freshId(); nodes[r] = { id: r, kind: "ref", target: fn }; nodes[c] = { id: c, kind: "call", fn: r, args: [arg] }; return c; };
  for (const b of bounds) { Object.assign(nodes, b.nodes); Object.assign(names, b.names); }
  const copied = bounds.flatMap((b) => b.made);
  for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    // A match on a stored value's items (keys, entries) whose cons case
    // doesn't use the rest needs only the first: its row's head, down the
    // left of the tree, not the whole list (GAPS.md M3).
    if (n.kind === "match") {
      const s = code.nodes[n.scrutinee], f = isCall(s) ? code.nodes[s.fn] : undefined;
      const head = isCall(s) && f?.kind === "ref" && s.args[0] ? rowOf(s.args[0])?.heads?.[f.target] : undefined;
      const cons = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a.variant === CONS);
      const rest = cons?.binds[1];
      if (head && rest && !subtree(code, cons.body).some((x) => { const r = code.nodes[x]; return r.kind === "ref" && r.target === rest; })) {
        const r = freshId();
        nodes[r] = { id: r, kind: "ref", target: head };
        nodes[s.id] = { ...(s as Call), fn: r };
      }
      continue;
    }
    if (!isCall(n)) continue;
    const f = code.nodes[n.fn];
    const job = f?.kind === "ref" ? BY_VALUE[f.target] : undefined;
    if (!job || !n.args[0]) continue;
    const row = rowOf(n.args[0]), t = typeOf(n.args[0])!;
    if (row && t.t === "con" && !t.args.some((a) => meanings(a))) {
      const r = freshId();
      nodes[r] = { id: r, kind: "ref", target: row.byType![job] };
      nodes[id] = { ...n, fn: r };
      continue;
    }
    const m = meanings(t);
    if (m) nodes[id] = { ...n, args: n.args.map((a) => call(m, a)) };
  }
  // main's answer, for whoever shows it: main gives what it gave, as meanings.
  const answer = (() => { const t = typeOf(main); return t?.t === "fn" ? meanings(info.subst.zonk(t.ret)) : t ? meanings(t) : null; })();
  let own = [...defs, ...copies, ...copied];
  // main's inputs, from whoever runs it (the command line's arguments): a
  // plain list comes as written and is stored on the way in (C93).
  const mainType = typeOf(main), mainBody = code.nodes[(nodes[main] as NodeOf<"def">).body!];
  const stores = lists && mainType?.t === "fn" && mainBody?.kind === "lambda"
    ? mainType.params.map((p) => { const t = info.subst.zonk(p); return t.t === "con" && t.id === LIST && !t.args.some(withList) ? storeOf(k, lists) : null; })
    : [];
  if (answer || stores.some((x) => x)) {
    const def = nodes[main] as NodeOf<"def">, inner = k.def(`${names[main] ?? "main"} as stored`);
    const body = code.nodes[def.body!];
    k.code.nodes[inner] = { ...(k.code.nodes[inner] as NodeOf<"def">), body: def.body };
    const result = (r: Id) => (answer ? k.call(answer, r) : r);
    nodes[main] = { ...def, body: body?.kind === "lambda"
      ? k.fn(body.params.map((p) => names[p] ?? "x"), (...xs) => result(k.call(inner, ...xs.map((x, i) => (stores[i] ? k.call(stores[i]!, x) : x)))))
      : result(k.x(inner)) };
    own = [...own, inner];
  }
  const made = k.code.defs.filter((d) => !code.nodes[d]);
  const all = { nodes: withNodes(k.code.nodes, nodes), defs: [...code.defs, ...copied, ...made] };
  // The way back from a builtin's list (listBoundary's `made`) is written
  // on List, and stays so.
  // So are an asked row's own definitions (Bytes as a byte array's,
  // written on List Int), where lists go to arrays beside it.
  const rowsAsked = lists ? asked.filter((r) => plainRow(code, r)).flatMap((r) => [...Object.values(r.impl), ...(r.meaning ? [r.meaning] : []), ...(r.store ? [r.store] : [])]) : [];
  // A runtime-read type (a mesh, a page's Html) keeps its lists as written:
  // listBoundary converts what goes into one.
  const kept = [...made.filter((d) => !own.includes(d)), ...(boundary ? [...boundary.made, ...boundary.edges, ...RUNTIME_READ] : []), ...rowsAsked];
  // A row chosen for some groups only rewrites their sites; a type
  // reference without a named key goes by its definition's sites.
  const only = (r: Representation) => {
    const gs = groupsOf.get(r);
    if (!gs || !sites) return undefined;
    const g = sites;
    return (id: Id, def: Id) => {
      const n = code.nodes[id];
      const h = n?.kind === "ref" ? g.of.get(id) : n?.kind === "tref" ? trefGroup(code, n) : undefined;
      if (h !== undefined) return gs.has(h);
      const here = g.inDef.get(def);
      return !!here && here.size === 1 && gs.has([...here][0]);
    };
  };
  const out = chosen.reduce((c, rep) => represent(c, own, rep, kept, only(rep)), all);
  const keys = (r: Representation) => { const gs = groupsOf.get(r); return gs ? ` for ${[...gs].map((h) => names[h] ?? LIBRARY.names[h] ?? h).join(", ")} keys` : ""; };
  return { code: out, names: { ...names, ...k.names }, chosen: chosen.map((r) => `${names[r.of] ?? LIBRARY.names[r.of]} as ${r.name}${keys(r)}`), insiders: made, reps: chosen, picks: chosen.map((r) => ({ of: r.of, rep: r.name })), ...(groupsOf.size ? { split: true } : {}) };
}

// A definition consing onto a call of itself appends at the back instead,
// a loop (cons-onto.ts), where lists are stored as `rep` and that pays:
// its cons is a call and its append cheap (a tree's, C232), or its
// append onto what a loop carries is one step (an array's push at its
// free end, C234, C240). The one place this is decided for every way a
// list is stored, the whole program's (here) or one side of a split
// (rep-split.ts), so no target makes such a loop again (C252). Each copy
// gets its original's type (`info.typeOf` set, or `typed` told). Null
// where nothing is rewritten.
export function loopsOnto(code: Code, info: Info, names: Names, defs: Id[], rep: Representation, typed?: (copy: Id, from: Id) => void): ConsOnto | null {
  const spec = LIBRARY.reps.find((r) => r.of === LIST && r.canonical)!;
  if (!(((rep.cost[CONS] ?? "1") !== "1" && cheaperOn(rep, spec, prelude("append"))) || rep.cost[CARRIED + prelude("append")] === "1")) return null;
  const c = consOnto(code, names, defs, PRELUDE_DEFS["added at end"]);
  if (!c.made.length) return null;
  for (const [to, from] of c.copiedFrom) { if (typed) typed(to, from); else { const t = info.typeOf.get(from); if (t) info.typeOf.set(to, t); } }
  return c;
}

// A job the tree does in fewer steps than the list as written.
function cheaperOn(tree: Representation, spec: Representation, j: Id): boolean {
  const t = LADDER.indexOf(tree.cost[j] ?? "");
  return t >= 0 && t < LADDER.indexOf(spec.cost[j] ?? "n²");
}

// Whether one of defs calls itself with a list it was given carried on
// through a job (its first input, where the list as written pays: a take,
// a drop, an append's front), there or in a def of defs it hands it to, or
// folds a list grown through one.
// machine's `reached` appends a few places before its worklist, which as
// written is as cheap: the worklist is the append's second input.
function carriesThroughJob(code: Code, defs: Id[], job: (j: Id) => boolean): boolean {
  const own = new Set(defs);
  const params = new Map<Id, Id[]>();
  for (const d of defs) { const b = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""]; if (b?.kind === "lambda") params.set(d, b.params); }
  // A let's binder (a lambda called where it's written) stands for its value.
  const values = new Map<Id, Id>();
  for (const d of defs) for (const x of subtree(code, d)) {
    const n = code.nodes[x];
    if (!isCall(n)) continue;
    const f = code.nodes[n.fn];
    if (f?.kind === "lambda") f.params.forEach((q, i) => { if (n.args[i]) values.set(q, n.args[i]); });
  }
  const mentions = (e: Id, p: Id, seen = new Set<Id>()): boolean => subtree(code, e).some((x) => {
    const n = code.nodes[x];
    if (n.kind !== "ref") return false;
    if (n.target === p) return true;
    const v = values.get(n.target);
    return !!v && !seen.has(n.target) && (seen.add(n.target), mentions(v, p, seen));
  });
  const callee = (n: Call): Id | null => { const f = code.nodes[n.fn]; return f?.kind === "ref" ? f.target : null; };
  // Which inputs of which defs reach a job's first input.
  const feeds = new Set<string>();
  const flowsIn = (e: Id, p: Id): boolean => subtree(code, e).some((x) => {
    const n = code.nodes[x];
    if (!isCall(n)) return false;
    const g = callee(n);
    if (!g) return false;
    if (job(g)) return !!n.args[0] && mentions(n.args[0], p);
    return own.has(g) && n.args.some((a, k) => feeds.has(`${g} ${k}`) && mentions(a, p));
  });
  for (let changed = true; changed;) {
    changed = false;
    for (const [d, ps] of params) ps.forEach((p, i) => {
      if (!feeds.has(`${d} ${i}`) && flowsIn((code.nodes[d] as NodeOf<"def">).body!, p)) { feeds.add(`${d} ${i}`); changed = true; }
    });
  }
  // A self-call's inputs, or a fold's arm's result so far (a list grown
  // by appending to it, each turn).
  return defs.some((d) => subtree(code, d).some((x) => {
    const n = code.nodes[x], ps = params.get(d) ?? [];
    if (n.kind === "arm") return n.results.some((r) => !!r && flowsIn(n.body, r));
    return isCall(n) && callee(n) === d && n.args.some((a, i) => !!ps[i] && flowsIn(a, ps[i]));
  }));
}

// The program's groups that would take arrays (rep-groups.ts) as seeds of
// a split: all of them, else each that can be one with those before it.
// The split splitByGroups made: the seeds and depth of the splitLists
// that gave it, and the roots it names.
interface GroupSplit { seeds: Id[]; deep: boolean; roots: Id[] }
function splitByGroups(code: Code, info: Info, names: Names, main: Id, defs: Id[], kept?: GroupSplit): (Chosen & { reps: Representation[]; made: GroupSplit }) | null {
  const array = LIBRARY.reps.find((r) => r.of === LIST && r.name === "array of List");
  if (!array) return null;
  const out = (s: NonNullable<ReturnType<typeof splitLists>>, made: GroupSplit) => {
    const from = s.seeds.filter((d) => made.roots.includes(d));
    return { code: s.code, names: s.names, chosen: [`List as array of List from ${from.map((d) => names[d] ?? d).join(", ")}`], insiders: [], reps: [array], made, picks: [{ of: LIST, rep: array.name, from }] };
  };
  // As the last compile of this program but for its numbers split it
  // (choiceOf's `decidedKept`): its one splitLists again.
  if (kept && [...kept.seeds, ...kept.roots].every((d) => defs.includes(d))) {
    const s = splitLists(code, info, names, defs, main, kept.seeds, array, kept.deep);
    if (s) return out(s, kept);
  }
  const all = listGroups(code, main, defs).groups;
  // A part that keeps the tree, and whose loop carries a list on through
  // a job the tree does cheaper than the list as written (examples/buffer's
  // `edited`, whose buffer is taken, dropped and appended each turn, L248):
  // the tree for the whole, since split off as written that list is walked
  // every turn, and its arrays' parts read the tree in log n.
  const spec = LIBRARY.reps.find((r) => r.of === LIST && r.canonical)!, tree = LIBRARY.reps.find((r) => r.of === LIST && r.name === "tree of List");
  if (tree && all.some((g) => g.rep === tree.name && carriesThroughJob(code, g.defs, (j) => cheaperOn(tree, spec, j)))) return null;
  const groups = all.filter((g) => g.rep === array.name && g.root !== main);
  const roots = groups.map((g) => g.root);
  // Not one called from a loop of the rest's: its lists would be
  // converted at every turn (machine's `items of words`, once a line).
  const refs = (d: Id) => new Set(subtree(code, d).flatMap((x) => { const n = code.nodes[x]; return n.kind === "ref" && code.nodes[n.target]?.kind === "def" ? [n.target] : []; }));
  const calls = new Map(defs.map((d) => [d, refs(d)]));
  const loops = (d: Id) => { const seen = new Set<Id>(), todo = [...(calls.get(d) ?? [])]; while (todo.length) { const x = todo.pop()!; if (x === d) return true; if (seen.has(x)) continue; seen.add(x); todo.push(...(calls.get(x) ?? [])); } return false; };
  // Unless the group itself loops over its lists by position (break's
  // `soonest from`, `item at` once a turn: n² on a cons list a call), where
  // converting once a call, n, is the cheaper (GAPS.md round 12 B1).
  // Its own body reads by position, not a definition it calls: machine's
  // `items of words` loops over its words and leaves `item at` to `word
  // at`, read a few times a line, so converting there costs more (10%).
  const itemAt = (d: Id) => subtree(code, d).some((x) => { const n = code.nodes[x]; return n.kind === "ref" && LIBRARY.names[n.target] === "item at" && !!LIBRARY.code.nodes[n.target]; });
  const byPosition = (g: (typeof groups)[number]) => g.defs.some((d) => loops(d) && itemAt(d));
  roots.splice(0, roots.length, ...roots.filter((r) => byPosition(groups.find((g) => g.root === r)!) || !defs.some((d) => d !== r && calls.get(d)?.has(r) && loops(d))));
  if (!roots.length) return null;
  let s = splitLists(code, info, names, defs, main, roots, array), by = { seeds: roots, deep: false };
  if (!s) {
    let seeds: Id[] = [];
    for (const r of roots) { const t = splitLists(code, info, names, defs, main, [...seeds, r], array); if (t) { s = t; by = { seeds: [...seeds, r], deep: false }; seeds = [...seeds, r]; } }
  }
  // A group whose lists cross holding lists (the strum tuner's analysis,
  // its templates a list of lists, read by position: C271) splits off
  // with those converted whole, a list of lists item by item (rep-split.ts
  // `deep`), where what that makes checks; else it stays with its caller.
  for (const r of roots) {
    if (s?.seeds.includes(r)) continue;
    const seeds = [...(s?.seeds ?? []), r];
    const t = splitLists(code, info, names, defs, main, seeds, array, true);
    if (t && infer(t.code, t.names, undefined, { ...info.options, ends: endedAsWritten(info, defs), units: false }).errors.length <= info.errors.length) { s = t; by = { seeds, deep: true }; }
  }
  if (!s) return null;
  return out(s, { ...by, roots });
}

// A split held in the program's choices (L280c): arrays of List from the
// definitions it names, by their names among the program's, as a split
// by groups makes them (not converting a list of lists whole, else so).
function heldSplit(code: Code, info: Info, names: Names, main: Id, defs: Id[], hold: string, refuse: (why: string) => never): Chosen & { reps: Representation[] } {
  const [, as, from] = /^(.+?) from (.+)$/.exec(hold)!;
  const array = LIBRARY.reps.find((r) => r.of === LIST && r.name === "array of List")!;
  if (as !== array.name) refuse(`only ${array.name} is split off from definitions`);
  const seeds = from.split(", ").map((n) => {
    const ds = defs.filter((d) => code.nodes[d]?.kind === "def" && (names[d] ?? d) === n);
    return ds.length === 1 ? ds[0] : refuse(ds.length ? `${n} names ${ds.length} definitions` : `the program has no definition ${n}`);
  });
  if (seeds.includes(main)) refuse(`${names[main] ?? "main"} keeps its lists as written in a split`);
  for (const deep of [false, true]) {
    const s = splitLists(code, info, names, defs, main, seeds, array, deep);
    if (s) return { code: s.code, names: s.names, chosen: [`List as ${array.name} from ${from}`], insiders: [], reps: [array], picks: [{ of: LIST, rep: array.name, from: s.seeds.filter((d) => seeds.includes(d)) }] };
  }
  return refuse("its lists can't be split off there");
}

// Lists as `rep` in each of the program's definitions that never sees a
// value of a library type holding lists (Html, Algebra), nor of a type
// that isn't data with lists among its arguments (a Cell of lists): the
// seeds of a split (rep-split.ts), main and the rest keeping lists as
// written. Null where the split is refused.
function splitByHolders(code: Code, info: Info, names: Names, main: Id, defs: Id[], rep: Representation): (Chosen & { reps: Representation[] }) | null {
  const own = new Set(defs), holds = holdsType(code, LIST);
  const isData = (id: Id) => code.nodes[(code.nodes[id] as NodeOf<"def"> | undefined)?.body ?? ""]?.kind === "typedef";
  const lists = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || t.args.some(lists) : t.t === "fn" ? [...t.params, t.ret].some(lists) : false; };
  const held = (t: Type): boolean => {
    t = info.subst.zonk(t);
    if (t.t === "fn") return [...t.params, t.ret].some(held);
    if (t.t !== "con") return false;
    return (t.id !== LIST && !own.has(t.id) && (holds(t.id) || (!isData(t.id) && t.args.some(lists)))) || t.args.some(held);
  };
  const seeds = defs.filter((d) => d !== main && !isData(d) && code.nodes[d]?.kind === "def" && !subtree(code, d).some((x) => { const t = info.typeOf.get(x); return !!t && held(t); }));
  if (!seeds.length) return null;
  const s = splitLists(code, info, names, defs, main, seeds, rep, true);
  if (!s) return null;
  return { code: s.code, names: s.names, chosen: [`List as ${rep.name} beside ${names[main] ?? "main"}'s lists as written`], insiders: [], reps: [rep], picks: [{ of: LIST, rep: rep.name, from: seeds }] };
}

// A list as written, stored: the row's own way (`store by`), else one
// constructor a time.
function storeOf(k: Lang, rep: Representation): Id {
  if (rep.store) return rep.store;
  const d = k.def("stored list");
  k.define(d, k.fn(["list"], (l) => k.fold(l, [
    { variant: NIL, names: [], body: () => k.x(rep.impl[NIL]) },
    { variant: CONS, names: ["item", "rest"], results: [null, "the rest stored"], body: ([x], [, r]) => k.call(rep.impl[CONS], x, r!) },
  ])));
  return d;
}
const withList = (t: Type): boolean => t.t === "con" && (t.id === LIST || t.args.some(withList));

const prelude = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// For a type with a stored value somewhere inside, a definition giving the
// value with each one as its meaning (null if it has none): a list item by
// item, a case field by field, a map's values. The definitions aren't the
// program's, so representing it leaves the meanings they build alone.
function asMeanings(k: Lang, code: Code, info: Info, names: Names, chosen: Representation[], copyOf: Map<Id, Id> = new Map(), rowFor: (t: Type & { t: "con" }) => Representation | undefined = (t) => chosen.find((r) => r.of === t.id)) {
  const made = new Map<string, Id | null>();
  // A case of another type has one if its own fields do (GAPS.md M2: the
  // program's record holding a map).
  const has = (t: Type): boolean => t.t === "con" && (chosen.some((r) => r.of === t.id) || t.args.some((a) => has(info.subst.zonk(a))) || holds(t.id) || copyOf.has(t.id));
  const key = (t: Type): string => (t.t === "con" ? `${t.id}(${t.args.map((a) => key(info.subst.zonk(a))).join(",")})` : t.t);
  const meanings = (t: Type): Id | null => {
    t = info.subst.zonk(t);
    if (t.t !== "con" || !has(t)) return null;
    const ks = key(t);
    if (made.has(ks)) return made.get(ks)!;
    const d = k.def(`as meanings`);
    made.set(ks, d);
    const row = rowFor(t);
    const args = t.args.map((a) => info.subst.zonk(a));
    if (row?.of === LIST) {
      // An array's items, each as its meaning when it holds some. A fold
      // written here, not the prelude's map, which the program's arrays
      // reach and so is rewritten.
      const inner = meanings(args[0]);
      k.define(d, inner
        ? k.fn(["array"], (a) => k.fold(k.call(row.meaning!, a), [
          { variant: NIL, names: [], body: () => k.x(NIL) },
          { variant: CONS, names: ["item", "rest"], results: [null, "the rest's meanings"], body: ([x], [, r]) => k.call(CONS, k.call(inner, x), r!) },
        ]))
        // A function written out, not the meaning's name: WebAssembly and C
        // compile only functions written in the program (I150).
        : k.fn(["array"], (a) => k.call(row.meaning!, a)));
      return d;
    }
    if (row) {
      // A map's values that hold some: its entries' values as meanings.
      const inner = t.id === MAP ? meanings(args[1]) : null;
      k.define(d, inner
        ? k.fn(["tree"], (tr) => k.call(MAP_V, k.call(prelude("map"), k.call(row.impl[prelude("entries of")], tr), k.fn(["entry"], (e) =>
          k.match(e, [{ variant: PAIR_V, names: ["key", "value"], body: ([kk, v]) => k.call(PAIR_V, kk, k.call(inner, v)) }])))))
        : k.fn(["stored"], (v) => k.call(row.meaning!, v)));
      return d;
    }
    if (t.id === LIST) {
      const item = meanings(args[0])!;
      k.define(d, k.fn(["list"], (xs) => k.call(prelude("map"), xs, k.x(item))));
      return d;
    }
    // A case of another type: each field that holds some, as meanings.
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def">)?.body ?? ""];
    if (td?.kind !== "typedef") { made.set(ks, null); return null; }
    const params = new Map(td.params.map((p, i) => [p, args[i]] as const));
    const fieldType = (id: Id): Type => {
      const n = code.nodes[id];
      if (n.kind === "tref") return params.get(n.target) ?? { t: "con", id: n.target, args: n.args.map(fieldType) };
      return { t: "var", v: -1 };
    };
    // A type whose own fields hold a stored value is rewritten too, so its
    // meanings are built in a copy that isn't (GAPS.md M2).
    // A builtin's type the program has its own copy of (plainBoundary,
    // L189e): the copy's value, as the builtin's type.
    const into = copyOf.has(t.id) ? td.variants : holds(t.id) ? (k.code.nodes[(k.code.nodes[shadow(t.id)] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants : td.variants;
    k.define(d, k.fn(["value"], (v) => k.match(v, td.variants.map((variant, j) => {
      const fields = (code.nodes[variant] as NodeOf<"variant">).fields;
      const each = fields.map((f) => meanings(fieldType((code.nodes[f] as NodeOf<"field">).type)));
      return { variant: copyOf.get(variant) ?? variant, names: fields.map((_, i) => `field ${i + 1}`), body: (xs: Id[]) => (fields.length ? k.call(into[j], ...xs.map((x, i) => (each[i] ? k.call(each[i]!, x) : x))) : k.x(into[j])) };
    }))));
    return d;
  };
  // Does a type's definition name a stored type in its fields, itself or
  // through another type that does (not through its parameters)?
  const holding = new Map<Id, boolean>();
  const holds = (id: Id): boolean => {
    if (holding.has(id)) return holding.get(id)!;
    // A runtime-read type's lists are as written (listBoundary, C354).
    if (RUNTIME_READ.has(id)) return false;
    holding.set(id, false);
    const td = code.nodes[(code.nodes[id] as NodeOf<"def">)?.body ?? ""];
    const names = (n: Id): boolean => {
      const x = code.nodes[n];
      if (x?.kind === "tref") return chosen.some((r) => r.of === x.target) || (x.target !== id && holds(x.target)) || x.args.some(names);
      if (x?.kind === "tfun") return [...x.params, x.result].some(names);
      return false;
    };
    const r = td?.kind === "typedef" && td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => names((code.nodes[f] as NodeOf<"field">).type)));
    holding.set(id, r);
    return r;
  };
  // The copy: the same cases and names, with each type that holds one
  // (itself too) replaced by its copy, so the stored types stay meanings.
  const shadows = new Map<Id, Id>();
  const shadow = (id: Id): Id => {
    if (shadows.has(id)) return shadows.get(id)!;
    const td = code.nodes[(code.nodes[id] as NodeOf<"def">).body!] as NodeOf<"typedef">;
    const ty = (n: Id, ps: Id[]): Id => {
      const x = code.nodes[n];
      if (x?.kind === "tref") {
        const p = td.params.indexOf(x.target);
        return k.tref(p >= 0 ? ps[p] : holds(x.target) ? shadow(x.target) : x.target, ...x.args.map((a) => ty(a, ps)));
      }
      if (x?.kind === "tfun") return k.tfun(x.params.map((a) => ty(a, ps)), ty(x.result, ps), x.effects);
      return n;
    };
    const made = k.type(names[id] ?? "copy", td.params.map((p) => names[p] ?? "a"), td.variants.map((v) =>
      [names[v] ?? "case", (code.nodes[v] as NodeOf<"variant">).fields.map((f) => [names[f] ?? "field", (self: Id, ps: Id[]) => (shadows.set(id, self), ty((code.nodes[f] as NodeOf<"field">).type, ps))] as [string, (self: Id, ps: Id[]) => Id])]));
    shadows.set(id, made.def);
    return made.def;
  };
  return meanings;
}

// A map's keys or a set's items that hold the type (a set of sets): the
// tree orders them by compare, which would see their shapes.
// The table's keys, wherever the program's own definitions name one, are
// Int or Text, which the table keeps as they are (a Float64's equal is
// near), or tuples of them, kept by their spelling (C63f). A helper
// generic in the key is given maps made elsewhere, where
// their keys are named. Whether each map has one holder no longer decides
// it (C71): every version of a table stays a value (std.ts Table), so a
// map read again after a change is still right; one holder is what makes
// each change constant.
function inPlace(code: Code, info: Info, main: Id, defs: Id[], row: Representation, tabled: ReadonlySet<Id> = new Set(), dataKeys = false): boolean {
  for (const d of defs) for (const t of typesIn(code, info, d)) if (t.t === "con" && t.id === row.of && !hashable(t.args[0])) return false;
  return true;
  // Int, Text, or a tuple of them (C63f, std.ts `spelling`), or a record
  // of the program's own (a type with one case) whose fields are (C63g):
  // with one case its spelling needs no tag. Not a type inside itself.
  // With `dataKeys` (C243), data of any cases whose fields are, a type
  // inside itself too (a list), but not this row's type or one already a
  // hash table, which have no one spelling.
  function hashable(k: Type, within: ReadonlySet<Id> = new Set()): boolean {
    if (k.t === "var") return true;
    if (k.t !== "con") return false;
    const inner = (a: Type) => { const z = info.subst.zonk(a); return z.t === "var" ? dataKeys : hashable(z, within); };
    if (k.id === INT || k.id === STRING) return true;
    // A tuple's part generic as its own key is (rota's `offs of`, a Set
    // of (Text, a) for any Number): fixed where it is used, and checked
    // there.
    if (/^std\.tuple\d+$/.test(k.id)) return k.args.every((a) => info.subst.zonk(a).t === "var" || inner(a));
    const d = code.nodes[k.id], td = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
    if (td?.kind !== "typedef" || td.effect || td.interface) return false;
    if (dataKeys && (k.id === row.of || tabled.has(k.id))) return false;
    if (within.has(k.id)) return dataKeys;
    if (td.variants.length !== 1 && !dataKeys) return false;
    const params = new Map(td.params.map((p, i) => [p, k.args[i]] as const));
    const typeOf = (tid: Id): Type | null => {
      const t = code.nodes[tid];
      if (t?.kind !== "tref") return null;
      const own = params.get(t.target);
      if (own) return own;
      const args = t.args.map(typeOf);
      return args.every((a) => a) ? { t: "con", id: t.target, args: args as Type[] } : null;
    };
    const fields = td.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant">).fields.map((f) => typeOf((code.nodes[f] as NodeOf<"field">).type)));
    const deeper = new Set([...within, k.id]);
    // A type variable is fixed where the definition is used, and checked there.
    return (fields.length > 0 || dataKeys) && fields.every((f) => { if (!f) return false; const z = info.subst.zonk(f); return z.t === "var" ? dataKeys : hashable(z, deeper); });
  }
}

// A list's rows never look at its items, so a list of lists is no reason;
// a list in a map's keys or a set's items is, where those rows compare
// them (C93).
function keyed(info: Info, defs: Id[], code: Code, of: Id): boolean {
  // (Types zonked already: typesIn.)
  const has = (t: Type): boolean => t.t === "con" && (t.id === of || t.args.some(has));
  const holders = of === LIST ? new Set<Id>([MAP, SET_TYPE]) : new Set<Id>([of]);
  const deep = (t: Type): boolean => {
    if (t.t === "con") return (holders.has(t.id) && !!t.args[0] && has(t.args[0])) || t.args.some(deep);
    if (t.t === "fn") return [...t.params, t.ret].some(deep);
    return false;
  };
  return defs.some((d) => typesIn(code, info, d).some(deep));
}

// A stored value given to a definition where its type is a variable
// (`describe(x) = show(x)`, called with a set): what that definition does
// with it is decided for every type, so the rewrite above can't find its
// show by type, and it would see the tree's shape. Such a program keeps
// the definition. The representation's own jobs are replaced, so they
// don't count. Only a variable the definition looks at counts (C70,
// GAPS.md round 6 N1): one whose values reach show, equal or compare,
// there or in a definition it hands them to (`looked`). `map`, `first`,
// `keep` and `sort by` pass their items on unseen, so a map over pairs
// that hold a map keeps the trees.
// The value variable of a hash table builtin's type (its table's second
// argument), and a type with that variable unseen.
const valueVar = (t: Type): number | undefined => { const tb = t.t === "fn" ? t.params[0] : undefined; const v = tb?.t === "con" ? tb.args[1] : undefined; return v?.t === "var" ? v.v : undefined; };
const without = (t: Type, v: number): Type => (t.t === "var" ? (t.v === v ? { t: "con", id: "", args: [] } : t) : t.t === "con" ? { ...t, args: t.args.map((x) => without(x, v)) } : t.t === "fn" ? { ...t, params: t.params.map((x) => without(x, v)), ret: without(t.ret, v) } : t);
function generic(info: Info, defs: Id[], code: Code, rep: Representation): boolean {
  // A list is in nearly every type's definition (a Set, a Map, a record
  // with a list field), so for List the types' definitions count too.
  const inside = rep.of === LIST ? holdsType(code, rep.of) : () => false;
  const has = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === rep.of || inside(t.id) || t.args.some(has) : t.t === "fn" ? [...t.params, t.ret].some(has) : false; };
  // Where the callee's own type has a variable, does the argument's type have the type?
  const open = (param: Type, arg: Type): boolean => {
    arg = info.subst.zonk(arg);
    if (param.t === "var") return has(arg);
    if (param.t === "con" && arg.t === "con") return param.args.some((p, i) => !!arg.args[i] && open(p, arg.args[i]));
    if (param.t === "fn" && arg.t === "fn") return param.params.some((p, i) => !!arg.params[i] && open(p, arg.params[i])) || open(param.ret, arg.ret);
    return false;
  };
  const looks = looked(code, info);
  // The callee's parameter type with only its looked-at variables left
  // variables (the others can't see the value).
  const seen = (t: Type, vs: Set<number>): Type => (t.t === "var" ? (vs.has(t.v) ? t : { t: "con", id: "", args: [] }) : t.t === "con" ? { ...t, args: t.args.map((x) => seen(x, vs)) } : t.t === "fn" ? { ...t, params: t.params.map((x) => seen(x, vs)), ret: seen(t.ret, vs) } : t);
  return defs.some((d) => subtree(code, d).some((id) => {
    const n = code.nodes[id];
    if (!isCall(n)) return false;
    const f = code.nodes[n.fn];
    const scheme = f?.kind === "ref" && !(f.target in rep.impl) ? info.schemes.get(f.target) : undefined;
    if (scheme?.type.t !== "fn") return false;
    // A builtin is looked at as before; a definition, by what it looks at.
    const vs = code.nodes[(f as NodeOf<"ref">).target]?.kind === "def" ? looks((f as NodeOf<"ref">).target) : null;
    // A hash table's builtin doesn't see its values.
    const v = TABLE_BUILTINS.has((f as NodeOf<"ref">).target) ? valueVar(scheme.type) : undefined;
    const params = v === undefined ? scheme.type.params : scheme.type.params.map((p) => without(p, v));
    return n.args.some((a, i) => !!params[i] && !!info.typeOf.get(a) && open(vs ? seen(params[i], vs) : params[i], info.typeOf.get(a)!));
  }));
}

// The variables of each definition's type (its scheme's) whose values it
// shows, compares or checks for equality, itself or through a definition
// or builtin it hands them to; for a builtin other than those three,
// every variable it is given (it isn't read). A library definition's body
// has variables of its own, read off its lambda paired with the scheme.
// The same reading as the compiler's copies per compared type (GAPS.md
// M4, compile.ts `compared`).
function looked(code: Code, info: Info): (def: Id) => Set<number> {
  const memo = new Map<Id, Set<number>>();
  const zonk = (t: Type) => info.subst.zonk(t);
  const varsOf = (t: Type, out: Set<number>): Set<number> => {
    t = zonk(t);
    if (t.t === "var") out.add(t.v);
    else if (t.t === "con") t.args.forEach((x) => varsOf(x, out));
    else if (t.t === "fn") { t.params.forEach((x) => varsOf(x, out)); varsOf(t.ret, out); }
    return out;
  };
  const LOOKS = new Set<Id>(Object.keys(BY_VALUE));
  const self = (def: Id): Set<number> => {
    if (memo.has(def)) return memo.get(def)!;
    const out = new Set<number>();
    memo.set(def, out);
    const sc = info.schemes.get(def), d = code.nodes[def];
    if (!sc || !sc.vars.length || d?.kind !== "def" || !d.body) return out;
    const toScheme = new Map<number, number>(sc.vars.map((v) => [v, v]));
    const pair = (a: Type, b: Type) => {
      b = zonk(b);
      if (a.t === "var") { if (b.t === "var") toScheme.set(b.v, a.v); return; }
      if (a.t === "con" && b.t === "con") a.args.forEach((x, i) => b.args[i] && pair(x, b.args[i]));
      if (a.t === "fn" && b.t === "fn") { a.params.forEach((x, i) => b.params[i] && pair(x, b.params[i])); pair(a.ret, b.ret); }
    };
    const bt = info.typeOf.get(d.body);
    if (bt) pair(sc.type, bt);
    const add = (vs: Set<number>) => { for (const v of vs) { const w = toScheme.get(v); if (w !== undefined && sc.vars.includes(w)) out.add(w); } };
    for (const x of subtree(code, def)) {
      const n = code.nodes[x];
      if (n.kind !== "ref" || n.target === def) continue;
      const at = info.typeOf.get(x);
      if (!at) continue;
      const target = code.nodes[n.target];
      // equal, show, compare, or a builtin we don't read: all it's given.
      if (target?.kind !== "def") {
        // (A hash table's builtin, only its keys.)
        if (TABLE_BUILTINS.has(n.target)) { const t = zonk(at), tb = t.t === "fn" && t.params[0] ? zonk(t.params[0]) : undefined; if (tb?.t === "con" && tb.args[0]) add(varsOf(tb.args[0], new Set())); }
        else if (LOOKS.has(n.target) || (SIGS[n.target] && !PASSES_ON.has(n.target) && !STRUCTURAL.has(n.target))) { const t = zonk(at); if (t.t === "fn") t.params.forEach((p) => add(varsOf(p, new Set()))); }
        continue;
      }
      const g = self(n.target);
      if (!g.size) continue;
      const gs = info.schemes.get(n.target);
      if (!gs) continue;
      // The types the callee's looked-at variables stand for here.
      const bindVars = (a: Type, b: Type) => {
        b = zonk(b);
        if (a.t === "var") { if (g.has(a.v)) add(varsOf(b, new Set())); return; }
        if (a.t === "con" && b.t === "con") a.args.forEach((y, i) => b.args[i] && bindVars(y, b.args[i]));
        if (a.t === "fn" && b.t === "fn") { a.params.forEach((y, i) => b.params[i] && bindVars(y, b.params[i])); bindVars(a.ret, b.ret); }
      };
      bindVars(gs.type, at);
    }
    return out;
  };
  return self;
}

// Lists as arrays (C30d3b) or trees (C45): where the program's lists meet
// code the rewrite can't change. A builtin taking or giving a `List x` (x
// with no list in it) gets the row's meaning (`items of array`) around the
// argument and the way back around the answer (`array of`, or for another
// row a fold of the list by its own nil and cons, made here: `made`); one that only passes a value on (first, optional,
// all) can pass an array. Anything else that would see a list as an array
// keeps List as written: a builtin with a list deeper in a parameter
// (Cell (List a)), equal, show or compare on a list inside the library
// (the program's own are rewritten by type above), a relation run
// backwards (solve), or a definition the array's own jobs use, which the
// rewrite leaves as it is. Null when one is found; otherwise the nodes
// that put the boundary in.
// first, optional, all, seeded and with fuel run a function and hand on
// what it answers (dice's `seeded` given a function making a list, C196).
const PASSES_ON = new Set<Id>([S.first, S.optional, S.all, S.seeded, S.fuel]);
// What a canvas renders (FRAMES.md): a frame's passes, a pass's draws, a
// mesh's corners and triangles and an image's texels are read only by the
// runtime (raster.ts, gpu-frame.ts), which takes an array or a list alike.
// So the program may
// pass them about holding arrays: a list made into one of their cases is
// converted as a builtin's is, and only taking one apart (a field read, a
// match) keeps List as written.
const RUNTIME_READ = new Set<Id>(["std.frame", "std.pass", "std.mesh", "std.image", "std.html", "std.attribute"]);
// Builtins that only move values of a variable type about (C70).
// A cell keeps what it's given as it is, and each in array hands the
// items to the program's own function (C354: a page's list as an array).
const STRUCTURAL = new Set<Id>([S.oneOf, S.fail, ...Object.values(ARRAY_OPS), CELL_OPS.cell, CELL_OPS.formula, CELL_OPS.read, CELL_OPS.write, CELL_OPS.each, CELL_OPS.eachArray]);
// A hash table's builtins, which hash and compare its keys but keep its
// values as they are given (C363): a list held in its values (depot's
// routes, crew's needs by name) may stay an array.
const TABLE_BUILTINS = new Set<Id>(Object.values(TABLE_OPS));
// Builtins that hand on what they're given as it is: an array written into
// a cell is read back the same array, and `value of` answers what an
// optional holds (C354: board's cards). Arrays only: a page carries its
// cells over from the interpreted page, which cells.ts handOver makes
// arrays of, not trees.
const AS_GIVEN = new Set<Id>([CELL_OPS.cell, CELL_OPS.formula, CELL_OPS.read, CELL_OPS.write, S.valueOf]);
// `owned`: the program's own types the rewrite leaves as they are, whose
// lists are converted where they're read and made (rep-split.ts, C93 s3).
// `asWritten`: definitions the program's arrays never reach, called with
// values no list crosses in (rep-split.ts): not looked into, and a value
// of a library type holding lists (bounce's Algebra) may be passed about,
// only not taken apart or made, since its lists stay as written.
export function listBoundary(code: Code, info: Info, defs: Id[], rep: Representation, asked: Representation[] = [], owned: Set<Id> = new Set(), asWritten?: Set<Id>): { nodes: Record<Id, Node>; reached: Id[]; made: Id[]; edges: Id[] } | null {
  const stored = new Set([...asked.map((r) => r.of), ...RUNTIME_READ]);
  const program = new Set([...defs, ...owned]), inside = holdsType(code, LIST);
  // A runtime-read type (a frame's pass) holds what the runtime reads either
  // way, and a type an asked row stores (Bytes as a byte array) no list.
  const hasList = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || (inside(t.id) && !stored.has(t.id)) || t.args.some(hasList) : t.t === "fn" ? [...t.params, t.ret].some(hasList) : false; };
  // A type the library defines with a list in it (Set and Map as written,
  // Algebra): its definition isn't the program's, so the rewrite leaves
  // its fields List while the values in them would be arrays. A type
  // already stored by an asked row (Map as a hash table) holds no list.
  const libraryHolder = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? (t.id !== LIST && !program.has(t.id) && !stored.has(t.id) && inside(t.id)) || t.args.some(libraryHolder) : t.t === "fn" ? [...t.params, t.ret].some(libraryHolder) : false; };
  const rowDefsOf = new Set(asked.filter((r) => plainRow(code, r)).flatMap((r) => [...Object.values(r.impl), ...(r.meaning ? [r.meaning] : []), ...(r.store ? [r.store] : [])]));
  const { closed, edge } = listEdges(code, info, program, stored, rowDefsOf);
  const openHolder = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? (!closed(t) && t.id !== LIST && !program.has(t.id) && !stored.has(t.id) && inside(t.id)) || t.args.some(openHolder) : t.t === "fn" ? [...t.params, t.ret].some(openHolder) : false; };
  // What the rewrite reaches (represent.ts), and what it keeps as it is.
  const own = new Set<Id>();
  const rowDefs = [...Object.values(rep.impl), rep.meaning!, ...(rep.store ? [rep.store] : [])];
  for (const x of [...rowDefs, ...dependenciesOfAll(code, rowDefs)]) own.add(x);
  const reached = new Set<Id>(), todo = [...defs];
  while (todo.length) {
    const d = todo.pop()!;
    // An asked row's meaning is written on its type as written, and stays.
    if (reached.has(d) || rep.impl[d] || asked.some((r) => r.meaning === d) || asWritten?.has(d) || edge(d) || rowDefsOf.has(d)) continue;
    const def = code.nodes[d];
    if (def?.kind !== "def" || (def.body && code.nodes[def.body]?.kind === "typedef")) continue;
    if (own.has(d)) return null;
    reached.add(d);
    for (const id of subtree(code, d)) { const n = code.nodes[id]; if (n.kind === "ref" && code.nodes[n.target]?.kind === "def") todo.push(n.target); }
  }
  // Reading a library type's field, making one of its cases, or matching
  // on one.
  let partOf: Map<Id, Id> | undefined;
  const ownerOf = (x: Id) => {
    if (!partOf) {
      partOf = new Map();
      for (const d of code.defs) {
        const t = code.nodes[(code.nodes[d] as NodeOf<"def"> | undefined)?.body ?? ""];
        if (t?.kind === "typedef") for (const v of t.variants) { partOf.set(v, d); for (const fl of (code.nodes[v] as NodeOf<"variant">).fields) partOf.set(fl, d); }
      }
    }
    return partOf.get(x);
  };
  const takesApart = (n: Node): boolean => {
    if (n.kind === "arm") return !program.has(ownerOf(n.variant) ?? "");
    if (n.kind !== "ref") return false;
    const k = code.nodes[n.target]?.kind, owner = ownerOf(n.target) ?? "";
    // Made, a runtime-read type's case is given lists (below).
    if (k === "variant" && RUNTIME_READ.has(owner)) return false;
    return (k === "variant" || k === "field") && !program.has(owner);
  };
  const nodes: Record<Id, Node> = {}, made: Id[] = [];
  const call = (fn: Id, arg: Id): Id => { const r = freshId(), c = freshId(); nodes[r] = { id: r, kind: "ref", target: fn }; nodes[c] = { id: c, kind: "call", fn: r, args: [arg] }; return c; };
  // The row's own way to store a whole list (`store by`: the array's
  // builtin, the tree's balanced build, C76), else one constructor a time.
  let back: Id | undefined = rep.store;
  const wayBack = (): Id => {
    if (back) return back;
    const k = new Lang(code), d = k.def("stored list");
    k.define(d, k.fn(["list"], (l) => k.fold(l, [
      { variant: NIL, names: [], body: () => k.x(rep.impl[NIL]) },
      { variant: CONS, names: ["item", "rest"], results: [null, "the rest stored"], body: ([x], [, r]) => k.call(rep.impl[CONS], x, r!) },
    ])));
    Object.assign(nodes, Object.fromEntries(nodeEntries(k.code.nodes).filter(([id]) => !code.nodes[id])));
    made.push(d);
    return (back = d);
  };
  // `List x` with no list in x: the boundary can turn it into an array.
  const plainList = (p: Type, t: Type) => p.t === "con" && p.id === LIST && (t = info.subst.zonk(t)).t === "con" && t.id === LIST && !t.args.some(hasList);
  const calledBy = new Map<Id, Call>();
  for (const d of reached) for (const id of subtree(code, d)) { const n = code.nodes[id]; if (isCall(n)) calledBy.set(n.fn, n); }
  // A runtime-read case taken apart (html's `with`): its lists are as
  // written, so each one bound is stored where it's used, unless it goes
  // straight into another such case (C354).
  const madeCase = (n: Node | undefined): n is Call => !!n && isCall(n) && (() => { const f = code.nodes[n.fn]; return f?.kind === "ref" && code.nodes[f.target]?.kind === "variant" && RUNTIME_READ.has(ownerOf(f.target) ?? ""); })();
  const apart = new Set<Id>(), straight = new Set<Id>();
  for (const d of reached) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind === "arm" && RUNTIME_READ.has(ownerOf(n.variant) ?? "")) for (const b of n.binds) { const t = info.typeOf.get(b), z = t && info.subst.zonk(t); if (z?.t === "con" && z.id === LIST && !z.args.some(hasList)) apart.add(b); }
    if (madeCase(n)) for (const a of n.args) { const x = code.nodes[a]; if (x?.kind === "ref") straight.add(a); }
  }
  for (const d of reached) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind === "ref" && apart.has(n.target)) {
      if (straight.has(id)) continue;
      const r = freshId();
      nodes[r] = { id: r, kind: "ref", target: n.target };
      const s = freshId();
      nodes[s] = { id: s, kind: "ref", target: wayBack() };
      nodes[id] = { id, kind: "call", fn: s, args: [r] };
      continue;
    }
    // A relation run backwards over lists stays as written; one generic in
    // what it runs (inverse's `applied`, given the pedal's bands) runs the
    // program's own code, which the rewrite changes with the rest, and an
    // array runs backwards as a list does (front and push front, modes.ts).
    if (isUse(n) && [...Object.values(n.given), ...Object.values(bindsOf(n)), n.id].some((x) => { const t = info.typeOf.get(x); return !!t && hasList(t); })) return null;
    const ty = info.typeOf.get(id);
    if (ty && libraryHolder(ty) && ((!asWritten && openHolder(ty)) || takesApart(n))) return null;
    const target = n.kind === "ref" ? n.target : null;
    // A runtime-read type's case made with the program's arrays: each
    // list it's given becomes one, as a builtin's list does.
    if (target && code.nodes[target]?.kind === "variant" && RUNTIME_READ.has(ownerOf(target) ?? "")) {
      const c = calledBy.get(id);
      if (!c) continue;
      const args = c.args.map((a) => { const t = info.typeOf.get(a), z = t && info.subst.zonk(t), x = code.nodes[a]; return z?.t === "con" && z.id === LIST && !z.args.some(hasList) && !(x?.kind === "ref" && apart.has(x.target)) ? call(rep.meaning!, a) : a; });
      if (args.some((a, i) => a !== c.args[i])) nodes[c.id] = { ...c, args };
      continue;
    }
    const edgeOf = target ? edge(target) : null;
    if (!target || (!edgeOf && (!SIGS[target] || code.nodes[target]?.kind === "def"))) continue;
    // A builtin whose job the row does (each, C354): the rewrite calls the
    // row's own.
    if (rep.impl[target]) continue;
    const at = info.typeOf.get(id);
    if (!at || !hasList(at)) continue;
    // A builtin with a list in its type: only called, by the rules above.
    const c = calledBy.get(id);
    // A field an implementation leaves to its interface's ways is filled
    // in by the compiler, never run as itself (impact's colliders, C196).
    if (!c && target === S.byItsWays) continue;
    if (!c) return null;
    if (target in BY_VALUE) { if (program.has(d)) continue; return null; }
    // `fail` makes nothing and `one of` gives one of what it's given: an
    // array passes as it is (bands' odd sample out, C196). `set` copies a
    // record with one field changed: the record, the path and the value
    // move about as they are (depot's day, its stations a field of it,
    // C227). Only on a record whose type the rewrite changes: one kept as
    // written (`owned`, rep-split.ts) has its lists converted where read,
    // which would put `array of` inside the path (clinic's desks).
    const rec = target === SET ? info.typeOf.get(c.args[1]) : undefined, recT = rec && info.subst.zonk(rec);
    const setPasses = target === SET && recT?.t === "con" && program.has(recT.id) && !owned.has(recT.id);
    // `list of` given lists (a Sound's channels, `[left, right]`) makes a
    // list of them as they are: its answer is stored whole, its items
    // already the row's (L271c).
    const ofLists = target === S.listOf && c.args.length > 0;
    const passes = PASSES_ON.has(target) || (AS_GIVEN.has(target) && rep.type === ARRAY) || target === S.oneOf || target === S.fail || setPasses || ofLists;
    const sig = edgeOf ?? SIGS[target](new Subst());
    if (sig.t !== "fn") return null;
    const args = c.args.map((a, i) => {
      const t = info.typeOf.get(a);
      if (!t || !hasList(t) || closed(info.subst.zonk(t))) return a;
      // `list of` takes any number of inputs, each of its one parameter's type (L181).
      return plainList(sig.params[i] ?? sig.params[sig.params.length - 1], t) ? call(rep.meaning!, a) : passes ? a : null;
    });
    if (args.includes(null)) return null;
    const ret = info.typeOf.get(c.id);
    const changed = args.some((a, i) => a !== c.args[i]);
    if (ret && hasList(ret) && !closed(info.subst.zonk(ret)) && (ofLists || !(passes && !plainList(sig.ret, ret)))) {
      if (!ofLists && !plainList(sig.ret, ret)) return null;
      // The call keeps its id, so its name and comments stay on it.
      const inner = freshId(), of = freshId();
      nodes[inner] = { ...c, id: inner, args: args as Id[] };
      nodes[of] = { id: of, kind: "ref", target: wayBack() };
      nodes[c.id] = { id: c.id, kind: "call", fn: of, args: [inner] };
    } else if (changed) nodes[c.id] = { ...c, args: args as Id[] };
  }
  return { nodes, reached: [...reached], made, edges: code.defs.filter((d) => edge(d)) };
}

// A library type with no parameters holding lists of its own (Bytes): it
// never holds the program's lists, so the program can pass one about as
// it is, so long as only the library takes it apart, in a definition kept
// as written. Such a definition is an edge: one between such a type and
// plain lists (`byte items`, `utf8 of`), called as a builtin is, its lists
// converted where they cross (pack's bytes, GAPS round 18 P1). `edge`
// gives its type, or null.
// An asked row's own definitions (Bytes as a byte array: `byte array
// bytes of`, given a List Int) are edges too, where each part of their
// type is a plain list or holds none (`rowDefs`): written on List, their
// lists converted where they cross (L271c, lists as arrays beside it).
export function listEdges(code: Code, info: Info, program: Set<Id>, stored: Set<Id> = new Set(), rowDefs: Set<Id> = new Set()) {
  const inside = holdsType(code, LIST);
  const hasList = (t: Type): boolean => { t = info.subst.zonk(t); return t.t === "con" ? t.id === LIST || inside(t.id) || t.args.some(hasList) : t.t === "fn" ? [...t.params, t.ret].some(hasList) : false; };
  // Its fields are plain lists, or hold none (Bytes' List Int); not a
  // tree of itself through its lists (Html's children), which a page
  // builds and takes apart all through the library.
  const flat = (n: Id): boolean => { const x = code.nodes[n]; return x?.kind === "tref" && x.target !== LIST && !inside(x.target) && x.args.every(flat); };
  const plainField = (n: Id): boolean => { const x = code.nodes[n]; return x?.kind === "tref" && (x.target === LIST ? x.args.every(flat) : flat(n)); };
  const closed = (t: Type) => {
    if (t.t !== "con" || t.args.length || t.id === LIST || program.has(t.id) || stored.has(t.id) || !inside(t.id)) return false;
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    return td?.kind === "typedef" && !td.params.length && td.variants.every((v) => (code.nodes[v] as NodeOf<"variant">).fields.every((f) => plainField((code.nodes[f] as NodeOf<"field">).type)));
  };
  const plain = (t: Type) => t.t === "con" && t.id === LIST && !t.args.some(hasList);
  const edgeType = new Map<Id, Type | null>();
  const edge = (d: Id): Type | null => {
    if (edgeType.has(d)) return edgeType.get(d)!;
    let t = program.has(d) || code.nodes[d]?.kind !== "def" ? undefined : info.typeOf.get(d);
    t = t && info.subst.zonk(t);
    const parts = t?.t === "fn" ? [...t.params, t.ret].map((p) => info.subst.zonk(p)) : [];
    const yes = (parts.some(closed) || (rowDefs.has(d) && parts.some(plain))) && parts.every((p) => closed(p) || plain(p) || !hasList(p) || stored.has(p.t === "con" ? p.id : ""));
    edgeType.set(d, yes ? t! : null);
    return yes ? t! : null;
  };
  return { closed, edge };
}

// A builtin whose own type names a stored type with no parameters (Bytes:
// `read bytes`, `write bytes`, L189b) is given the meaning where it takes
// one, and what it gives is stored by the row's `store by`: the nodes that
// do so. A record of no parameters it takes or gives with the type in
// its own fields (a Request's body, a Response's: L189e) becomes the
// program's own copy, whose fields the representation rewrites as it does
// the program's types; the call goes from one to the other. Null where a
// builtin names the type any other way (a list of Bytes), and the program
// keeps the definition.
// A builtin that only passes a value on (first, a match's) has a type
// variable there, and is left alone.
function plainBoundary(code: Code, defs: Id[], rep: Representation, given: Names = {}): Boundary | null {
  const nodes: Record<Id, Node> = {}, made: Id[] = [], names: Names = {};
  const typedef = code.nodes[(code.nodes[rep.of] as NodeOf<"def"> | undefined)?.body ?? ""];
  const copies = new Map<Id, Id>(), copyOf = new Map<Id, Id>();
  if (typedef?.kind !== "typedef" || typedef.params.length || !rep.meaning || !rep.store) return { nodes, made, names, copyOf };
  const inside = holdsType(code, rep.of);
  const plain = (t: Type) => t.t === "con" && t.id === rep.of && !t.args.length;
  const named = (t: Type): boolean => t.t === "con" ? t.id === rep.of || inside(t.id) || t.args.some(named) : t.t === "fn" ? [...t.params, t.ret].some(named) : false;
  const add = (n: NodeData): Id => { const i = freshId(); nodes[i] = { ...n, id: i } as Node; return i; };
  const call = (fn: Id, ...args: Id[]): Id => add({ kind: "call", fn: add({ kind: "ref", target: fn }), args });
  const mentions = (n: Id): boolean => { const x = code.nodes[n]; return x?.kind === "tref" ? x.target === rep.of || inside(x.target) || x.args.some(mentions) : x?.kind === "tfun" ? [...x.params, x.result].some(mentions) : false; };
  // A type of no parameters a builtin takes or gives whose fields are the
  // type itself or don't name it (a Request, a Response): its variants,
  // with which of each one's fields are the type.
  const fieldsOf = (t: Type): [Id, boolean[]][] | null => {
    if (t.t !== "con" || t.args.length || t.id === rep.of) return null;
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.params.length) return null;
    const out: [Id, boolean[]][] = [];
    for (const v of td.variants) {
      const flags: boolean[] = [];
      for (const f of (code.nodes[v] as NodeOf<"variant">).fields) {
        const ty = (code.nodes[f] as NodeOf<"field">).type, x = code.nodes[ty];
        if (x?.kind === "tref" && x.target === rep.of && !x.args.length) flags.push(true);
        else if (!mentions(ty)) flags.push(false);
        else return null;
      }
      out.push([v, flags]);
    }
    return out;
  };
  // The program's own copy of such a type (L189e), whose fields the
  // representation rewrites as it does the program's own types; the
  // builtin keeps std's, and the call goes from one to the other.
  const copy = (t: Id): void => {
    if (copies.has(t)) return;
    const td = code.nodes[(code.nodes[t] as NodeOf<"def">).body!] as NodeOf<"typedef">;
    const ty = (n: Id): Id => { const x = code.nodes[n]; return x?.kind === "tref" ? add({ kind: "tref", target: x.target, args: x.args.map(ty) }) : n; };
    const variants = td.variants.map((v) => {
      const fields = (code.nodes[v] as NodeOf<"variant">).fields.map((f) => { const c = add({ kind: "field", type: ty((code.nodes[f] as NodeOf<"field">).type) }); names[c] = given[f] ?? "field"; return c; });
      const c = add({ kind: "variant", fields });
      copyOf.set(v, c); names[c] = given[v] ?? "case";
      return c;
    });
    const d = add({ kind: "def", body: add({ kind: "typedef", params: [], variants }) });
    copies.set(t, d); copyOf.set(t, d); names[d] = given[t] ?? "copy";
    made.push(d);
  };
  // `value` matched and built again as `to`'s (each variant's own, or its
  // copy's), each field that is the type given to `by`.
  const each = (value: Id, variants: [Id, boolean[]][], from: (v: Id) => Id, to: (v: Id) => Id, by: Id): Id =>
    add({ kind: "match", scrutinee: value, otherwise: null, arms: variants.map(([v, flags]) => {
      const binds = flags.map(() => add({ kind: "binder" }));
      const xs = binds.map((b, i) => { const r = add({ kind: "ref", target: b }); return flags[i] ? call(by, r) : r; });
      return add({ kind: "arm", variant: from(v), binds, results: [], body: xs.length ? call(to(v), ...xs) : add({ kind: "ref", target: to(v) }) });
    }) } as NodeData);
  const calledBy = new Map<Id, Call>();
  for (const d of defs) for (const id of subtree(code, d)) { const n = code.nodes[id]; if (isCall(n)) calledBy.set(n.fn, n); }
  const calls: [Call, Type & { t: "fn" }][] = [];
  for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind !== "ref" || !SIGS[n.target] || code.nodes[n.target]?.kind === "def" || n.target in BY_VALUE) continue;
    const sig = SIGS[n.target](new Subst());
    if (!named(sig)) continue;
    const c = calledBy.get(id);
    if (!c || sig.t !== "fn") return null;
    if ([...sig.params, sig.ret].some((t) => named(t) && !plain(t) && !fieldsOf(t))) return null;
    for (const t of [...sig.params, sig.ret]) if (t.t === "con" && named(t) && !plain(t)) copy(t.id);
    calls.push([c, sig]);
  }
  // The program's own definitions on the copies: its constructors,
  // matches and types.
  const own = (id: Id) => copyOf.get(id) ?? id;
  if (copies.size) for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if ((n.kind === "ref" || n.kind === "tref") && copyOf.has(n.target)) nodes[id] = { ...n, target: own(n.target) };
    else if (n.kind === "arm" && copyOf.has(n.variant)) nodes[id] = { ...n, variant: own(n.variant) };
  }
  const same = (v: Id) => v;
  for (const [c0, sig] of calls) {
    const c = (nodes[c0.id] as Call | undefined) ?? c0;
    const across = (t: Type, x: Id, into: boolean): Id => {
      if (plain(t)) return call(into ? rep.store! : rep.meaning!, x);
      const vs = named(t) ? fieldsOf(t) : null;
      return vs ? (into ? each(x, vs, same, own, rep.store!) : each(x, vs, own, same, rep.meaning!)) : x;
    };
    const args = c.args.map((a, i) => (sig.params[i] ? across(sig.params[i], a, false) : a));
    if (!named(sig.ret)) { nodes[c.id] = { ...c, args }; continue; }
    // The call keeps its id, so its name and comments stay on it.
    const inner = add({ ...c, args } as NodeData);
    nodes[c.id] = { ...nodes[across(sig.ret, inner, true)], id: c.id };
  }
  return { nodes, made, names, copyOf };
}
// `copyOf`: each type copied, and each of its variants, to the copy's.
interface Boundary { nodes: Record<Id, Node>; made: Id[]; names: Names; copyOf: Map<Id, Id> }

// Does a type's definition name `of` in its fields, itself or through
// another type that does?
// A row of a type with no parameters (Bytes as a byte array), whose
// definitions read the type as written, a plain list inside: those stay
// written on List beside lists as arrays. A Map's or a Set's row is
// rewritten with the program (swarm's table keys into an array, C58j).
function plainRow(code: Code, r: Representation): boolean {
  const td = code.nodes[(code.nodes[r.of] as NodeOf<"def"> | undefined)?.body ?? ""];
  return td?.kind === "typedef" && !td.params.length;
}
function holdsType(code: Code, of: Id): (id: Id) => boolean {
  const memo = new Map<Id, boolean>();
  const holds = (id: Id): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, false);
    const td = code.nodes[(code.nodes[id] as NodeOf<"def"> | undefined)?.body ?? ""];
    const names = (n: Id): boolean => {
      const x = code.nodes[n];
      if (x?.kind === "tref") return x.target === of || holds(x.target) || x.args.some(names);
      if (x?.kind === "tfun") return [...x.params, x.result].some(names);
      return false;
    };
    const r = td?.kind === "typedef" && td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => names((code.nodes[f] as NodeOf<"field">).type)));
    memo.set(id, r);
    return r;
  };
  return holds;
}

// The program with the part of the trees' module the rows use, made once
// for a program and rows: a split tried seed by seed made it again for
// every try, a merge of the whole program twice (I203: a fifth of
// clinic's check for running).
const withTreesMade = new WeakMap<Code, Map<string, Code>>();
export function withTrees(code: Code, rows: Representation[]): Code {
  let made = withTreesMade.get(code);
  if (!made) withTreesMade.set(code, (made = new Map()));
  const key = rows.map((r) => `${r.of}|${r.name}`).join("\n");
  let c = made.get(key);
  if (!c) made.set(key, (c = merge(treesFor(code, rows), code)));
  return c;
}

// The part of the trees' module the rows use: their definitions (the
// checker reads a row's match from it), their jobs, and what those
// reach in the module.
export function treesFor(code: Code, rows: Representation[]): Code {
  // What the roots reach in the module and the program together, read
  // from each (merged, the two were copied whole for it: L266).
  const keep = new Set<Id>();
  const roots = rows.flatMap((r) => [...(r.def ? [r.def] : []), ...Object.values(r.impl), ...(r.meaning ? [r.meaning] : []), ...Object.values(r.byType ?? {}), ...Object.values(r.heads ?? {}), ...(r.store ? [r.store] : [])]);
  const at = (id: Id): Node | undefined => code.nodes[id] ?? TREES.code.nodes[id];
  const owners = [ownerOfTypeParts(code), ownerOfTypeParts(TREES.code)];
  const reached = (root: Id): Set<Id> => {
    const seen = new Set<Id>();
    const visit = (id: Id) => {
      const walk = (x: Id) => {
        const node = at(x)!;
        const target = node.kind === "ref" ? node.target : node.kind === "tref" ? node.target : node.kind === "arm" ? node.variant : null;
        for (let t of [target, ...(node.kind === "tfun" ? node.effects ?? [] : []), ...(node.kind === "typedef" ? node.row ?? [] : [])]) {
          if (t) t = owners[0].get(t) ?? owners[1].get(t) ?? t;
          if (!t || seen.has(t)) continue;
          const d = at(t);
          if (d?.kind === "def" || d?.kind === "builtin") { seen.add(t); visit(t); }
        }
        for (const c of children(node)) walk(c);
      };
      walk(id);
    };
    visit(root);
    return seen;
  };
  for (const d of roots) for (const x of [d, ...reached(d)]) if (TREES.code.nodes[x]) keep.add(x);
  const defs = TREES.code.defs.filter((d) => keep.has(d));
  const nodes: Record<Id, Node> = {};
  for (const d of defs) for (const id of subtree(TREES.code, d)) nodes[id] = TREES.code.nodes[id];
  return { nodes, defs };
}
