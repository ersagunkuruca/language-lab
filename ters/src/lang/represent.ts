// Representations: the same program, run on a different data type
// (NUMBERS.md). A representation of a type T is
//
//   - another type R, with an abstraction function `meaning : R → T` (an
//     ordinary definition; run backwards it encodes, canonical first),
//   - definitions that do T's jobs on R: each constructor, `match`, `fold`,
//     and any function on T it can do faster,
//   - what each job costs, in the size of the number or structure.
//
// It's a side table keyed by ids, like names and comments. The program
// doesn't change: `represent` makes a new program in which T's jobs are
// done by R's definitions, and `choose` picks a representation from the
// costs of the jobs a program actually uses. The evaluator stays the
// meaning: tests check every implementation against the definition it
// replaces, through `meaning`.

import { children, changedFromLayer, parentLookup, dependenciesOfAll, freshId, layerOf, nodesWhere, nodesOfKind, scanningOnLayer, subtree, subtreeKept, type Code, type Id, type Node, type NodeData, type NodeOf, isCall, type Call, isUse, isBound, bindsOf, useKids, copyNodes, nodeValues, sameValue } from "../model.ts";
import { notePieces, type Info } from "./infer.ts";
import { CONS, COST, INT_OPS, JOBS, LIST, LITERAL_V, REPRESENTATION_V, S, TEXT_OPS, writtenItems } from "./std.ts";
import { INT, NUMBER } from "./types.ts";
import { COPIED_FROM, PRELUDE_DEFS } from "./prelude-ids.ts";
import { add, compare, LADDER, NEVER, possible, steps, type Cost } from "./cost.ts";
import { keptMap } from "../kept.ts";

export interface Representation {
  name: string;
  of: Id;             // the type being represented (its def)
  type: Id;           // the type that represents it (equal to `of` for the definition itself)
  meaning: Id | null; // R → T; null when R is T
  // Every value has one spelling, so structural equality is equality of
  // meanings. A representation that isn't canonical must implement `equal`.
  canonical: boolean;
  // Keys: a variant of T (its constructor), "match", "fold", or a def or
  // builtin on T.
  impl: Record<string, Id>;
  // A function given each literal of T, when R spells literals differently
  // (or rounds them: Float32).
  literal?: Id;
  // Its laws hold only approximately (floats), so the chooser never picks
  // it by cost; a program asks for it (NUMBERS.md).
  approximate?: boolean;
  // Chosen only where every value of T has one holder, so an update may
  // change it in place (one-holder.ts, C63), and only for targets with a
  // host map (JavaScript).
  oneHolder?: boolean;
  // The same keys, plus "space". Values are on the ladder below.
  cost: Record<string, string>;
  // A representation that isn't canonical: equal, show and compare where
  // an argument's type is T, done through `meaning` (map-tree.ts). The
  // rewrite finds those calls by type (C47).
  byType?: { equal: Id; show: Id; compare: Id };
  // For a job that gives a list (a set's items, a map's keys or entries),
  // a definition giving only its first item, as a list of one or nil: a
  // match on the job's list whose cons case doesn't use the rest is that
  // (library-reps.ts, GAPS.md M3).
  heads?: Record<Id, Id>;
  // Fields, by variant, that R doesn't keep as values of T (`hides`, L117):
  // made only when an arm reads them, as Storage's `hidden` below.
  hidden?: Record<Id, number[]>;
  // A definition storing a value of T as R in one go (`store by`, C76):
  // where a value comes from outside (a builtin's list), it is stored so
  // rather than by R's constructors one at a time.
  store?: Id;
  // The definition that writes it, for one a program writes (L108).
  def?: Id;
  // Declared costs its jobs' definitions raised (job-cost.ts, L247).
  raised?: import("./job-cost.ts").Raised[];
}

export { LADDER } from "./cost.ts";
// The ladder as the language writes it: std's Cost, in the same order.
const COSTS = ["constant", "logarithmic", "polylogarithmic", "linear", "linearithmic", "quadratic"].map((c) => `${COST}.${c}`);

// The representations a program writes (REPRESENTATIONS.md, L108): each
// definition whose body is `representation(meaning, space, jobs)`, read
// into the record the chooser and the rewrite take. Its name is the
// definition's; t and r are what the checker made of it. A meaning that is
// `(x) => x` is t itself, with its own costs.
export function representationsIn(code: Code, info: Info, names: Record<Id, string> = {}, defs: Id[] = code.defs): Representation[] {
  const out: Representation[] = [];
  const refOf = (id: Id): Id | null => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : null; };
  const costOf = (id: Id): string | undefined => { const i = COSTS.indexOf(refOf(id) ?? ""); return i < 0 ? undefined : LADDER[i]; };
  for (const d of defs) {
    const def = code.nodes[d];
    const body = def?.kind === "def" && def.body ? code.nodes[def.body] : null;
    if (!isCall(body) || refOf(body.fn) !== REPRESENTATION_V) continue;
    const ty = info.typeOf.get(body.id), t = ty && info.subst.zonk(ty);
    if (t?.t !== "con" || t.args.length !== 2) continue;
    const [m, space, jobs] = body.args;
    const lam = code.nodes[m];
    const same = lam?.kind === "lambda" && lam.params.length === 1 && refOf(lam.body) === lam.params[0];
    // t is what the meaning gives; for `(x) => x`, the type whose
    // constructors the jobs name.
    const listed: Id[] = writtenItems(code.nodes, jobs) ?? [];
    const named = listed.map((j) => { const n = code.nodes[j], kind = isCall(n) ? refOf(n.fn) : null; return isCall(n) && (kind === JOBS.job || kind === JOBS.asWritten) ? refOf(n.args[0]) : null; });
    const [ty0, as] = t.args.map((a) => info.subst.zonk(a));
    const of = ty0.t === "con" ? ty0.id : named.map((v) => v && info.owner.get(v)).find(Boolean);
    if (!of || (!same && as.t !== "con")) continue;
    const rep: Representation = { def: d, name: names[d] ?? d, of, type: same || as.t !== "con" ? of : as.id, meaning: same ? null : refOf(m), canonical: true, impl: {}, cost: {} };
    const sp = costOf(space);
    if (sp) rep.cost.space = sp;
    // The jobs, a list written out: cons(job, rest) down to nil.
    for (const id of listed) {
      const j = code.nodes[id];
      if (!isCall(j)) continue;
      const kind = refOf(j.fn), a = j.args.map(refOf), cost = costOf(j.args[j.args.length - 1]);
      // How equal, show and compare see it, when it isn't one spelling per value.
      const seen = kind === JOBS.equalBy ? "equal" : kind === JOBS.showBy ? "show" : kind === JOBS.compareBy ? "compare" : null;
      if (seen && a[0]) { rep.canonical = false; (rep.byType ??= { equal: "", show: "", compare: "" })[seen] = a[0]; continue; }
      if (kind === JOBS.headBy && a[0] && a[1]) { (rep.heads ??= {})[a[0]] = a[1]; continue; }
      if (kind === JOBS.inPlace) { rep.oneHolder = true; continue; }
      if (kind === JOBS.storeBy && a[0]) { rep.store = a[0]; continue; }
      if (kind === JOBS.hides && a[0]) {
        const lit = code.nodes[j.args[1]], at = lit?.kind === "lit" ? Number(lit.value) : -1;
        if (Number.isInteger(at) && at >= 0 && at < ((code.nodes[a[0]] as NodeOf<"variant"> | undefined)?.fields.length ?? 0)) (rep.hidden ??= {})[a[0]] = [...(rep.hidden?.[a[0]] ?? []), at];
        continue;
      }
      if (kind === JOBS.carried && a[0]) { if (cost) rep.cost[CARRIED + a[0]] = cost; continue; }
      const key = kind === JOBS.job || kind === JOBS.asWritten ? a[0] : kind === JOBS.matchBy || kind === JOBS.matchAsWritten ? "match" : kind === JOBS.foldBy || kind === JOBS.foldAsWritten ? "fold" : kind === JOBS.foldOfItems ? FOLD_OF_ITEMS : null;
      if (!key) continue;
      const by = kind === JOBS.job ? a[1] : kind === JOBS.matchBy || kind === JOBS.foldBy ? a[0] : null;
      if (by) rep.impl[key] = by;
      if (cost) rep.cost[key] = cost;
    }
    out.push(rep);
  }
  return out;
}

// A builtin type such as Float64 has no cases: its jobs are its builtins.
const variantsOf = (code: Code, type: Id) => {
  const d = code.nodes[type];
  return d?.kind === "def" ? (code.nodes[d.body!] as NodeOf<"typedef">).variants : [];
};
// Is this node a literal of type t?
const literalOf = (n: Node, t: Id) => n.kind === "lit" && (n.of ? n.of === t : t === NUMBER && typeof n.value === "number");

// The jobs on T a definition uses, transitively: constructors, matches,
// folds, and calls to functions some representation implements.
// The job of building a v whose field i is that field taken out of another
// v by a match (`x :: rest` in a cons arm).
export const ontoField = (v: Id, i: number) => `${v} onto its field ${i}`;
// A fold whose cases read no rest (a sum, a count) is fold(meaning(x)), by
// the law fold′(x) = fold(meaning(x)): a representation that lists its
// items in n (a tree) does it that way where its own fold rebuilds each
// arm's rest (C75). Its own job, at the cost the representation gives it,
// else its fold's.
export const FOLD_OF_ITEMS = "fold of items";
const readsNoRest = (code: Code, n: NodeOf<"fold">, t: Id) => n.arms.every((a) => {
  const arm = code.nodes[a] as NodeOf<"arm">;
  const fields = (code.nodes[arm.variant] as NodeOf<"variant"> | undefined)?.fields ?? [];
  const rests = new Set(arm.binds.filter((_, i) => { const ty = code.nodes[(code.nodes[fields[i]] as NodeOf<"field"> | undefined)?.type ?? ""]; return ty?.kind === "tref" && ty.target === t; }));
  return !rests.size || !subtree(code, arm.body).some((x) => { const r = code.nodes[x]; return r?.kind === "ref" && rests.has(r.target); });
});
const foldJob = (code: Code, n: NodeOf<"match"> | NodeOf<"fold">, t: Id) => (n.kind === "fold" && readsNoRest(code, n, t) ? FOLD_OF_ITEMS : n.kind);
// A match on `items of(s)` (or keys, entries) whose cons case doesn't use
// the rest reads only the first: a job of its own, `HEAD` and the job's
// id, which a row with a head for it does down the left of a tree (log n,
// GAPS.md M3) and any other row as its whole listing. Dijkstra's frontier
// (routes' `settle`) takes the smallest so, once per town: on a hash set
// it was a sort per town (C63f). The refs read so, by node id.
export const HEAD = "head of ";
// Each node's contribution, for the nodes of a program on the library's
// layer: the layer's found once, then those of the nodes not the layer's
// and of the layer nodes holding one changed (L266: headRefs and
// carriedRefs each scanned all ~50k nodes for each program the chooser
// made).
function bySource(code: Code, kept: WeakMap<Code, Map<Id, Id[]>>, from: (code: Code, n: Node, put: (id: Id) => void) => void): Set<Id> {
  const r = new Set<Id>();
  const layer = layerOf(code), changed = layer && changedFromLayer(code);
  if (!layer || !changed) { for (const n of nodeValues(code.nodes)) from(code, n, (id) => r.add(id)); return r; }
  let base = kept.get(layer);
  if (!base) {
    kept.set(layer, (base = new Map()));
    for (const n of nodeValues(layer.nodes)) { const got: Id[] = []; from(layer, n, (id) => got.push(id)); if (got.length) base.set(n.id, got); }
  }
  const again = new Set<Id>(changed), up = parentLookup(layer);
  for (const id of changed) if (layer.nodes[id] !== undefined) for (let at = up(id); at !== undefined && !again.has(at); at = up(at)) again.add(at);
  for (const [src, ids] of base) if (!again.has(src)) for (const id of ids) r.add(id);
  for (const id of again) { const n = code.nodes[id]; if (n) from(code, n, (x) => r.add(x)); }
  return r;
}
const headsRead = new WeakMap<Code, Set<Id>>(), headsUnder = new WeakMap<Code, Map<Id, Id[]>>();
function headRefs(code: Code): Set<Id> {
  let r = headsRead.get(code);
  if (r) return r;
  headsRead.set(code, (r = bySource(code, headsUnder, (code, n, put) => {
    if (n.kind !== "match") return;
    const s = code.nodes[n.scrutinee];
    if (!isCall(s) || code.nodes[s.fn]?.kind !== "ref") return;
    const cons = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">).find((a) => a?.variant === CONS), rest = cons?.binds[1];
    if (rest && !subtree(code, cons.body).some((x) => { const y = code.nodes[x]; return y.kind === "ref" && y.target === rest; })) put(s.fn);
  })));
  return r;
}
// A job given what a loop carries, its answer carried on in the same
// place: a parameter of the definition it's in, given to a call of that
// definition in the same place (`unpacked(rest, append(out, [b]))`,
// cons-onto.ts's `so far`), or the rest's answer in a fold's arm, as its
// answer (`flatten`'s `append(x, the rest's answer)`). What it was given
// is read no more but by the job, so a row that writes at a free end does
// it in place, where the job as a whole copies (C234). Its own job,
// `CARRIED` and the job's id, at the cost a row gives it, else the job's.
// The refs, by node id.
export const CARRIED = "carried ";
const carriedRead = new WeakMap<Code, Set<Id>>(), carriedUnder = new WeakMap<Code, Map<Id, Id[]>>();
function carriedRefs(code: Code): Set<Id> {
  let r = carriedRead.get(code);
  if (r) return r;
  carriedRead.set(code, (r = bySource(code, carriedUnder, (code, d, put) => {
    // A call of a function given one of `carried`, as x is or through lets.
    const given = (x: Id, carried: (y: Id) => boolean): Id | null => {
      const j = code.nodes[x];
      if (!isCall(j) || !j.args?.length) return null;
      const f = code.nodes[j.fn];
      if (f?.kind === "lambda" && f.params.length === j.args.length) return given(f.body, carried);
      return f?.kind === "ref" && code.nodes[f.target]?.kind === "def" && j.args.some((a) => { const y = code.nodes[a]; return y?.kind === "ref" && carried(y.target); }) ? j.fn : null;
    };
    if (d.kind === "arm") {
      const answers = new Set(d.results?.filter((b): b is Id => !!b) ?? []);
      const j = answers.size ? given(d.body, (y) => answers.has(y)) : null;
      if (j) put(j);
      return;
    }
    if (d.kind !== "def" || !d.body) return;
    const lam = code.nodes[d.body];
    if (lam?.kind !== "lambda") return;
    for (const x of subtree(code, d.body)) {
      const c = code.nodes[x];
      if (!isCall(c) || !c.args) continue;
      const f = code.nodes[c.fn];
      if (f?.kind !== "ref" || f.target !== d.id) continue;
      c.args.forEach((a, k) => { const j = given(a, (y) => y === lam.params[k]); if (j) put(j); });
    }
  })));
  return r;
}
// Carried only where some row says what that costs (an array's append).
const jobOf = (code: Code, n: NodeOf<"ref">, costed: Set<string>) => (costed.has(CARRIED + n.target) && carriedRefs(code).has(n.id) ? CARRIED + n.target : headRefs(code).has(n.id) ? HEAD + n.target : n.target);

// Which variant's field each binder of a match arm over T is: once per
// program and type, as headRefs is (rep-groups.ts asks for every
// definition's jobs, and this walked the whole library each time).
const fieldsRead = new WeakMap<Code, Map<Id, Map<Id, [Id, number]>>>();
function fieldsOf(code: Code, t: Id, variants: Set<Id>): Map<Id, [Id, number]> {
  let byType = fieldsRead.get(code);
  if (!byType) fieldsRead.set(code, (byType = new Map()));
  let r = byType.get(t);
  if (r) return r;
  byType.set(t, (r = new Map()));
  // On its layer, the layer's arms found once (L266: a scan of every node
  // for each program and type the chooser asks of).
  const arms = layerOf(code) ? scanningOnLayer(code, () => nodesWhere(code, `arms of ${t}`, (n) => n.kind === "arm" && variants.has(n.variant))).map((id) => code.nodes[id]) : nodesOfKind(code, "arm");
  for (const n of arms) if (n.kind === "arm" && variants.has(n.variant)) n.binds.forEach((b, i) => r!.set(b, [n.variant, i]));
  return r;
}

// `absorbed`: leave out a job every use of which is on a list just made
// (freshUses), as `choose` does.
// Each definition's own jobs are found once per program and rows
// (jobsKept): the chooser asks for every definition's reach (rep-groups.ts),
// and walked each definition again for each that reaches it (L266: 0.5 s
// of machine's compile). A reach's jobs are its definitions' own, in the
// order they were found.
const jobsKept = new WeakMap<Code, Map<string, Map<Id, string[]>>>();
// What a definition's jobs are worked out of: its rows' costs and the
// jobs they implement (a representation is made again for each program).
const repKeys = new WeakMap<Representation, string>();
const repKey = (r: Representation) => { let k = repKeys.get(r); if (k === undefined) repKeys.set(r, (k = JSON.stringify([r.of, r.cost, Object.keys(r.impl)]))); return k; };
// A definition's own jobs, and what looped finds in it, kept from one
// compile to the next (plan doc "Incremental compile after edits"): they
// read its nodes, the nodes its refs name (a definition or not, a
// binder's), and the cases its arms are of with their fields' types. Kept
// while each of those is the same node, so an edit works out the jobs of
// only the definitions it changed (machine: 90 ms of a body edit's choice).
// Library definitions are the same nodes in every program, so theirs serve
// every program. Some versions of each are kept: a definition may be in
// two of the programs the chooser makes, referring to a different copy
// in each (withTrees, rep-split.ts).
type Deps = { ids: Id[]; nodes: (Node | undefined)[]; ver: number };
const depsKept = keptMap<Id, Deps[]>(), factsKept = keptMap<string, Map<Id, { ver: number; v: unknown }[]>>();
const versionsAt = new WeakMap<Code, Map<Id, number>>();
let versions = 0;
// How many were worked out (the tests).
export let factsMade = 0;
const VERSIONS = 4;
function depsOf(code: Code, def: Id): Id[] {
  const ids = subtree(code, def), out = [...ids];
  for (const id of ids) {
    const n = code.nodes[id];
    if (n.kind === "ref") out.push(n.target);
    else if (n.kind === "arm") {
      out.push(n.variant);
      const v = code.nodes[n.variant];
      if (v?.kind === "variant") for (const fl of v.fields) { out.push(fl); const f = code.nodes[fl]; if (f?.kind === "field") out.push(f.type); }
    }
  }
  return out;
}
function versionOf(code: Code, def: Id): number {
  let at = versionsAt.get(code);
  if (!at) versionsAt.set(code, (at = new Map()));
  let v = at.get(def);
  if (v !== undefined) return v;
  const was = depsKept.get(def) ?? [];
  // (A node made again as it was is the same: a copy's refs are made
  // again in each program the chooser makes.)
  v = was.find((w) => w.ids.every((id, i) => { const n = code.nodes[id]; return n === w.nodes[i] || sameValue(n, w.nodes[i]); }))?.ver;
  if (v === undefined) {
    if (depsKept.size > 100_000) { depsKept.clear(); factsKept.clear(); }
    const ids = depsOf(code, def);
    depsKept.set(def, [{ ids, nodes: ids.map((id) => code.nodes[id]), ver: (v = ++versions) }, ...was.slice(0, VERSIONS - 1)]);
  }
  at.set(def, v);
  return v;
}
function keptFact<T>(code: Code, key: string, def: Id, make: () => T): T {
  const ver = versionOf(code, def);
  let m = factsKept.get(key);
  if (!m) factsKept.set(key, (m = new Map()));
  const was = m.get(def) ?? [];
  const at = was.find((w) => w.ver === ver);
  if (at) return at.v as T;
  factsMade++;
  const v = make();
  m.set(def, [{ ver, v }, ...was.slice(0, VERSIONS - 1)]);
  return v;
}
export function uses(code: Code, entry: Id, reps: Representation[], absorbed = false, opaque: Iterable<Id> = []): string[] {
  const t = reps[0].of;
  const opaques = [...opaque];
  const variants = new Set(variantsOf(code, t));
  const implemented = new Set([...reps.flatMap((r) => Object.keys(r.impl)), ...opaques]);
  const costed = new Set(reps.flatMap((r) => Object.keys(r.cost)));
  let fieldOf: Map<Id, [Id, number]> | null = null;
  let byRows = jobsKept.get(code);
  if (!byRows) jobsKept.set(code, (byRows = new Map()));
  const key = `${absorbed}|${reps.map(repKey).join(",")}|${opaques.join(",")}`;
  let own = byRows.get(key);
  if (!own) byRows.set(key, (own = new Map()));
  const factKey = `jobs ${key}|${[...variants].join(",")}`;
  const ownJobs = (def: Id): string[] => {
    let jobs = own!.get(def);
    if (jobs) return jobs;
    own!.set(def, (jobs = keptFact(code, factKey, def, () => jobsIn(def))));
    return jobs;
  };
  const jobsIn = (def: Id): string[] => {
    fieldOf ??= fieldsOf(code, t, variants);
    // A list just made is the definition's own: the lets and calls that
    // make one are in it (freshUses).
    const fresh = absorbed ? freshUses(code, [def], reps) : new Set<Id>();
    const out = new Set<string>();
    for (const id of subtree(code, def)) {
      const n = code.nodes[id];
      if (n.kind === "ref" && (variants.has(n.target) || costed.has(n.target)) && !fresh.has(id)) out.add(jobOf(code, n, costed));
      if ((n.kind === "match" || n.kind === "fold") && armsOver(code, n, variants)) out.add(foldJob(code, n, t));
      // A constructor given a field a match took out of another value
      // (`x :: rest` in a cons arm): its own job, since a representation
      // that hides that field shares it with the value it came from.
      if (isCall(n)) {
        const c = code.nodes[n.fn];
        const v = c?.kind === "ref" && variants.has(c.target) ? c.target : null;
        if (v) n.args.forEach((a, i) => { const r = code.nodes[a], f = r?.kind === "ref" ? fieldOf!.get(r.target) : undefined; if (f?.[0] === v && f[1] === i) out.add(ontoField(v, i)); });
      }
    }
    return [...out];
  };
  // A function some representation implements is one job: don't look
  // inside it, since its body is what gets replaced (`add item` builds a
  // `set of`, which the tree never does).
  const seen = new Set<Id>();
  const visit = (def: Id) => {
    if (seen.has(def)) return;
    seen.add(def);
    if (implemented.has(def) && def !== entry) return;
    for (const d of directRefs(code, def)) visit(d);
  };
  visit(entry);
  const out = new Set<string>();
  for (const d of seen) if (!implemented.has(d) || d === entry) for (const j of ownJobs(d)) out.add(j);
  return [...out];
}

// The jobs of `uses` that run in a loop: inside a fold's arms, inside a
// function given to another (map, keep, a fold of the library's), or in a
// definition that calls itself, or reached from one of those (C63c). Each
// may run once per item, so `choose` weighs it by n: a lookup done for
// every town costs n log n on a tree and n on a table, and outweighs a
// listing of the keys done once.
export function looped(code: Code, entry: Id, reps: Representation[], opaque: Iterable<Id> = []): Set<string> {
  const t = reps[0].of;
  const variants = new Set(variantsOf(code, t));
  const implemented = new Set([...reps.flatMap((r) => Object.keys(r.impl)), ...opaque]);
  const costed = new Set(reps.flatMap((r) => Object.keys(r.cost)));
  const out = new Set<string>();
  // The definitions reachable from entry, not looking inside a job's own.
  const graph = new Map<Id, Id[]>();
  const reach = (d: Id) => {
    if (graph.has(d)) return;
    const next = implemented.has(d) && d !== entry ? [] : directRefs(code, d);
    graph.set(d, next);
    for (const x of next) reach(x);
  };
  reach(entry);
  const callsItself = (d: Id) => {
    const seen = new Set<Id>(), todo = [...graph.get(d)!];
    while (todo.length) { const x = todo.pop()!; if (x === d) return true; if (seen.has(x)) continue; seen.add(x); todo.push(...(graph.get(x) ?? [])); }
    return false;
  };
  // What a definition's body gives, walked in a loop or not: the jobs in
  // a loop, and the definitions it refers to, each in a loop or not (a
  // definition's refs only to definitions: any of them may be one the
  // entry reaches).
  type Walked = { jobs: string[]; calls: [Id, boolean][] };
  const factKey = `looped ${reps.map(repKey).join(",")}|${[...variants].join(",")}`;
  const walkedOf = (d: Id, body: Id, loop: boolean): Walked => {
    const onFresh = freshUses(code, [d], reps), jobs = new Set<string>(), calls: [Id, boolean][] = [];
    const walk = (id: Id, loop: boolean): void => {
      const n = code.nodes[id];
      if (!n) return;
      if (loop) {
        if (n.kind === "ref" && (variants.has(n.target) || costed.has(n.target)) && !onFresh.has(id)) jobs.add(jobOf(code, n, costed));
        if ((n.kind === "match" || n.kind === "fold") && armsOver(code, n, variants)) jobs.add(foldJob(code, n, t));
      }
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "def") calls.push([n.target, loop]);
      if (n.kind === "fold") { walk(n.scrutinee, loop); for (const a of n.arms) walk(a, true); return; }
      if (isCall(n)) {
        walk(n.fn, loop);
        // A thunk (no parameters) is run once or not at all: `first`'s.
        for (const a of n.args) { const l = code.nodes[a]; walk(a, loop || (l?.kind === "lambda" && l.params.length > 0)); }
        return;
      }
      for (const c of children(n)) walk(c, loop);
    };
    walk(body, loop);
    return { jobs: [...jobs], calls };
  };
  const done = new Set<string>();
  const visit = (d: Id, loop: boolean) => {
    loop ||= callsItself(d);
    const key = `${d} ${loop}`;
    if (done.has(key) || (loop && done.has(`${d} true`))) return;
    done.add(key);
    if (implemented.has(d) && d !== entry) return;
    const def = code.nodes[d];
    if (def?.kind !== "def" || !def.body) return;
    const body = def.body;
    const w = keptFact(code, `${factKey}|${loop}`, d, () => walkedOf(d, body, loop));
    for (const j of w.jobs) out.add(j);
    for (const [x, l] of w.calls) if (graph.has(x)) visit(x, l);
  };
  visit(entry, false);
  return out;
}

// A priced function of one list whose steps are at most linear (`length`;
// and `append`, linear in its first input as written and in every row,
// C234), given there a
// list a call has just made (`length(keep(…))`, chapters' `words`), or a
// let has just bound to one (`length(chapters)`), takes no more steps than
// making it took, which the jobs inside that call count: its order is the
// making's. So it isn't weighed once per item of a loop it is in (only
// over the list it was given), and where every use is so, it isn't a job
// to choose by. A list read from elsewhere (a field, a parameter, a job's
// answer such as `rest`) isn't one just made. The refs, by node id.
function freshUses(code: Code, defs: Id[], reps: Representation[]): Set<Id> {
  // Only a List's: making one costs n in every representation, which a
  // Nat stored as an Int doesn't (numbers' `number(factorial(n))`).
  if (reps[0].of !== LIST) return new Set();
  const variants = new Set(variantsOf(code, reps[0].of));
  const implemented = new Set(reps.flatMap((r) => Object.keys(r.impl)));
  const costed = new Set(reps.flatMap((r) => Object.keys(r.cost)));
  const linear = (j: Id) => reps.some((r) => r.cost[j] === "n") && reps.every((r) => LADDER.indexOf(r.cost[j] ?? "1") <= LADDER.indexOf("n"));
  const made = (x: Id | undefined): boolean => {
    const a = x ? code.nodes[x] : undefined;
    if (!a || !isCall(a)) return false;
    const g = code.nodes[a.fn];
    // `take(bits, 8)`: at most 8 items, in 8 steps as written (pack's
    // `packed`, a byte at a time, C234).
    if (g?.kind === "ref" && g.target === PRELUDE_DEFS.take && code.nodes[a.args[1]]?.kind === "lit") return true;
    return g?.kind === "ref" && code.nodes[g.target]?.kind === "def" && !costed.has(g.target) && !implemented.has(g.target);
  };
  const bound = new Set<Id>(), out = new Set<Id>();
  const all = defs.flatMap((d) => subtree(code, d));
  // A let: a lambda called where it is written.
  for (const id of all) {
    const n = code.nodes[id];
    if (!isCall(n)) continue;
    const l = code.nodes[n.fn];
    if (l?.kind === "lambda") l.params.forEach((p, i) => { if (made(n.args[i])) bound.add(p); });
  }
  for (const id of all) {
    const n = code.nodes[id];
    if (!isCall(n) || !n.args?.length) continue;
    const f = code.nodes[n.fn], a = code.nodes[n.args[0]];
    if (n.args.length > 1 && !(f?.kind === "ref" && f.target === PRELUDE_DEFS.append)) continue;
    if (f?.kind !== "ref" || variants.has(f.target) || !costed.has(f.target) || !linear(f.target)) continue;
    if (made(n.args[0]) || (a?.kind === "ref" && bound.has(a.target))) out.add(f.id);
  }
  return out;
}

// The types, other than T, whose fields name T and whose cases a
// definition makes or matches on: a library type holding a Map (Priority
// queue's entries, std.ts), whose field is the representation too where
// the definitions reaching it are rewritten, and so is every definition
// making or matching one (C186).
export function holders(code: Code, def: Id, t: Id): Id[] {
  const out = new Set<Id>();
  for (const id of subtree(code, def)) {
    const n = code.nodes[id];
    const v = n.kind === "ref" ? n.target : n.kind === "arm" ? n.variant : null;
    const owner = v && code.nodes[v]?.kind === "variant" ? ownerOf(code, v) : null;
    if (owner && owner !== t && !out.has(owner) && namesType(code, owner, t)) out.add(owner);
  }
  return [...out];
}
// The types whose cases a definition makes or matches.
// What a definition's refs and arms name, kept by its walk (the same
// while its nodes are).
const namedKept = new WeakMap<readonly Id[], Id[]>();
export function madeOrMatched(code: Code, def: Id): Set<Id> {
  const ids = subtreeKept(code, def);
  let named = namedKept.get(ids);
  if (!named) {
    const vs = new Set<Id>();
    for (const id of ids) { const n = code.nodes[id], v = n.kind === "ref" ? n.target : n.kind === "arm" ? n.variant : null; if (v) vs.add(v); }
    namedKept.set(ids, (named = [...vs]));
  }
  const out = new Set<Id>();
  for (const v of named) { const o = code.nodes[v]?.kind === "variant" ? ownerOf(code, v) : null; if (o) out.add(o); }
  return out;
}
let owners: { code: Code; of: Map<Id, Id> } | null = null;
function ownerOf(code: Code, variant: Id): Id | null {
  if (owners?.code !== code) {
    const of = new Map<Id, Id>();
    for (const d of code.defs) {
      const td = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""];
      if (td?.kind === "typedef") for (const v of td.variants) of.set(v, d);
    }
    owners = { code, of };
  }
  return owners.of.get(variant) ?? null;
}
function namesType(code: Code, typedef: Id, t: Id): boolean {
  const td = code.nodes[(code.nodes[typedef] as NodeOf<"def">).body ?? ""];
  // A builtin holder of no parameters (a Response's Bytes) gets the
  // program's own copy instead (library-reps.ts plainBoundary), the
  // builtin's type left as it is. The program's own (a record with a Nat
  // field, L251) is rewritten with the definitions.
  if (td?.kind !== "typedef" || (!td.params.length && /^(std|type)\./.test(typedef))) return false;
  const mentions = (x: Id): boolean => { const n = code.nodes[x]; return n?.kind === "tref" ? n.target === t || n.args.some(mentions) : n?.kind === "tfun" ? [...n.params, n.result].some(mentions) : false; };
  return td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => mentions((code.nodes[f] as NodeOf<"field">).type)));
}

const refsKept = new WeakMap<Code, Map<Id, Id[]>>();
function directRefs(code: Code, def: Id): Id[] {
  let kept = refsKept.get(code);
  if (!kept) refsKept.set(code, (kept = new Map()));
  let out = kept.get(def);
  if (out) return out;
  out = [];
  for (const id of subtree(code, def)) {
    const n = code.nodes[id];
    if (n.kind === "ref" && code.nodes[n.target]?.kind === "def") out.push(n.target);
  }
  kept.set(def, out);
  return out;
}

const armsOver = (code: Code, n: NodeOf<"match"> | NodeOf<"fold">, variants: Set<Id>) =>
  n.arms.some((a) => variants.has((code.nodes[a] as NodeOf<"arm">).variant));

// The job a match or fold on T is (`match`, `fold`, `fold of items`), or
// undefined where its arms aren't T's (L280d's measured runs count it).
export const matchJob = (code: Code, n: NodeOf<"match"> | NodeOf<"fold">, t: Id): string | undefined => (armsOver(code, n, new Set(variantsOf(code, t))) ? foldJob(code, n, t) : undefined);

export interface Choice {
  rep: Representation;
  table: { rep: string; costs: Record<string, string> }[];
  jobs: string[];
}

// Pick the representation whose jobs cost least added up, on the scale
// the way picker uses too (cost.ts): the highest order first, so the one
// whose worst job is cheapest wins, then how many jobs are at that order,
// then the next order down; then the smallest; and on a tie the
// definition as written, since a rewrite has to buy something. A job a
// representation doesn't implement is done by its definition, which costs what it costs
// in T's own terms; one with no cost at all is NEVER.
// prefer: between representations whose costs tie, the one to take
// before the definition as written (a sound's lists as arrays, C196).
// `opaque`: definitions another type's chosen representation does (Bytes'
// byte at, as a byte array): their bodies, the lists as written, don't run.
// A run's measurements of a type (L280d, the choices' measured entry):
// how often each job was called, by the job (its definition's or
// constructor's id), and the largest value seen, in items.
export interface Measured { calls: ReadonlyMap<string, number>; size: number }
// A ladder order's steps at n items.
const stepsAt = (order: string, n: number): number => {
  const lg = Math.log2(Math.max(n, 2));
  return order === "1" ? 1 : order === "log n" ? lg : order === "log² n" ? lg * lg : order === "n" ? n : order === "n log n" ? n * lg : order === "n²" ? n * n : Infinity;
};
// `measured`: where a run was measured, the rows are ordered by the steps
// its calls would have taken at its largest size first (each job's
// count times its order at that n), in place of guessing which jobs are in
// a loop; the ladder after, for the jobs not measured (matches, folds).
// `only`: one group of the type's uses (map-groups.ts, C358): the jobs
// referred to at its sites, and the rest that aren't references (a match).
export function choose(code: Code, entry: Id, reps: Representation[], prefer?: (r: Representation) => boolean, opaque: Iterable<Id> = [], measured?: Measured, only?: { jobs: ReadonlySet<string>; referred: ReadonlySet<string> }): Choice {
  const jobs = uses(code, entry, reps, true, opaque).filter((j) => !only || only.jobs.has(j) || !only.referred.has(j));
  const spec = reps.find((r) => r.type === r.of && !Object.keys(r.impl).length)!;
  // Building a v onto a field taken out of another value costs v's
  // constructor where the field is a value kept (the definition as
  // written: a cons cell points at its rest). Where the representation
  // hides that field, the field is a view into the value it came from,
  // which still sees the same slots, so the constructor copies: the
  // representation's space, n for `array of List` (std.ts pushFront
  // writes in place only at the buffer's free end, REVIEW-2026-11-01 §2).
  const onto = (r: Representation, j: string) => {
    const at = variantsOf(code, r.of).flatMap((v) => (code.nodes[v] as NodeOf<"variant">).fields.map((_, i) => [v, i] as const)).find(([v, i]) => ontoField(v, i) === j);
    if (!at) return undefined;
    const [v, i] = at;
    return r.hidden?.[v]?.includes(i) ? (r.cost.space ?? "n") : (r.cost[v] ?? spec.cost[v]);
  };
  const own = (r: Representation, j: string): string | undefined => j.startsWith(CARRIED) ? (r.cost[j] ?? own(r, j.slice(CARRIED.length))) : j.startsWith(HEAD) ? (r.heads?.[j.slice(HEAD.length)] ? "log n" : own(r, j.slice(HEAD.length))) : r.cost[j] ?? (j === FOLD_OF_ITEMS ? r.cost.fold : undefined);
  const costs = (r: Representation) => Object.fromEntries([...jobs, "space"].map((j) => [j, own(r, j) ?? onto(r, j) ?? own(spec, j) ?? "?"]));
  const step = (c: string): Cost => (LADDER.includes(c) ? steps(1, c) : NEVER);
  // A job in a loop runs about n times (C63c): one order up, n² at most.
  const inLoop = looped(code, entry, reps, opaque);
  const times = (c: string) => (c === "1" ? "n" : c === "log n" ? "n log n" : LADDER.includes(c) ? "n²" : c);
  const score = (r: Representation) => { const c = costs(r); return { jobs: add(...jobs.map((j) => step(inLoop.has(j) ? times(c[j]) : c[j]))), space: step(c.space) }; };
  const took = new Map<Representation, number>();
  const ran = (r: Representation): number => {
    let t = took.get(r);
    if (t !== undefined) return t;
    t = 0;
    for (const [j, k] of measured!.calls) { const c = own(r, j) ?? onto(r, j) ?? own(spec, j); if (c !== undefined) t += k * stepsAt(c, measured!.size); }
    took.set(r, t);
    return t;
  };
  const best = reps.filter((r) => !r.approximate).sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    const can = Number(possible(y.jobs)) - Number(possible(x.jobs));
    const d = measured ? ran(a) - ran(b) : 0;
    if (measured && (can || (d && !Number.isNaN(d)))) return can || d;
    return compare(x.jobs, y.jobs) || compare(x.space, y.space) || Number(!!prefer?.(b)) - Number(!!prefer?.(a)) || Number(b === spec) - Number(a === spec);
  })[0];
  return { rep: best, jobs, table: reps.map((r) => ({ rep: r.name, costs: costs(r) })) };
}

// A job does what it replaces and nothing more: its effects are the ones
// the replaced definition's type has, and none for a constructor, a match
// or a fold (their cases' effects come in through the functions they're
// given, as a type variable). Otherwise the program's type wouldn't say
// what the represented program does: effects come from the meaning
// (NUMBERS.md). Null when every job keeps to it; `info` is the program's
// check, which types the representation's code too.
export function jobProblem(info: Info, rep: Representation, names: Record<Id, string> = {}): string | null {
  const effects = (d: Id) => { const t = info.typeOf.get(d); return t?.t === "fn" ? info.subst.resolveRow(t.eff).effs : []; };
  for (const [job, impl] of Object.entries(rep.impl)) {
    const allowed = job === "match" || job === "fold" ? [] : effects(job);
    const extra = effects(impl).filter((e) => !allowed.includes(e));
    if (extra.length) return `${names[impl] ?? impl} does ${extra.map((e) => names[e] ?? e).join(", ")}, which ${job === "match" || job === "fold" ? `a ${job}` : names[job] ?? job} doesn't, so it can't do its job in ${rep.name}`;
  }
  return null;
}

// The program from `entries`, with T's jobs done by `rep`. Node ids are kept
// where a node is replaced (a match becomes a call to the representation's
// match), so names and comments stay attached.
// `keep`: definitions written on T that it reaches but leaves as they are
// (library-reps.ts's meanings of a value with a stored one inside).
// `only`: where the type is stored this way when not everywhere (a Map's
// group by key type, C358), asked of each job's reference, type reference
// and match on the type, with the definition it is in.
export function represent(code: Code, entries: Id[], rep: Representation, keep: Id[] = [], only?: (id: Id, def: Id) => boolean): Code {
  // The definition itself; a representation by the same type changes the
  // jobs (Float32 rounds each one).
  if (rep.type === rep.of && !Object.keys(rep.impl).length && !rep.literal) return code;
  // What its matches give as pieces, before they are put in place
  // (infer.ts notePieces).
  if (rep.impl.match) notePieces(code, [rep.impl.match]);
  const t = rep.of;
  const variants = new Set(variantsOf(code, t));
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  const add = (n: NodeData): Id => {
    const id = freshId();
    nodes[id] = { ...n, id } as Node;
    return id;
  };
  const ref = (target: Id) => add({ kind: "ref", target });
  const binder = () => add({ kind: "binder" });
  // T's Literal's from fraction, when the row does it (Nat's `nat
  // literal` stored as an Int, L249b): a literal written at T becomes that
  // job's call, given its top and bottom as Ints.
  // (The definitions read once, not once for each job: a fifth of
  // represent's time in machine's choice.)
  const literalJobs = new Set<Id>();
  for (const d of code.defs) {
    const b = code.nodes[(code.nodes[d] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (!isCall(b) || b.args.length !== 1) continue;
    const f = code.nodes[b.fn], a = code.nodes[b.args[0]];
    if (f?.kind === "ref" && f.target === LITERAL_V && a?.kind === "ref" && Object.hasOwn(rep.impl, a.target)) literalJobs.add(a.target);
  }
  const fromFraction = Object.keys(rep.impl).find((j) => literalJobs.has(j));

  // The representation's own code stays as it is: it's written on R, and
  // `meaning` is written on T.
  const own = new Set<Id>(keep);
  // Walked together, so what the jobs share is walked once.
  const rowDefs = [...Object.values(rep.impl), ...(rep.meaning ? [rep.meaning] : []), ...(rep.literal ? [rep.literal] : []), ...(rep.store ? [rep.store] : [])];
  for (const d of rowDefs) own.add(d);
  for (const x of dependenciesOfAll(code, rowDefs)) own.add(x);
  // Rewrite what the entry reaches, not going inside replaced functions.
  const todo = new Set<Id>();
  // A job's copy (a library definition the lists' rewrite copied, as it
  // copies `natural`, which folds a range) is the job too: Nat as an Int
  // takes `natural` from the copy as from the original (pack, GAPS
  // round 18).
  const jobOf = (d: Id): Id | undefined => rep.impl[d] ?? (COPIED_FROM.has(d) ? rep.impl[COPIED_FROM.get(d)!] : undefined);
  const reach = (def: Id) => {
    if (todo.has(def) || own.has(def) || jobOf(def)) return;
    todo.add(def);
    for (const d of directRefs(code, def)) reach(d);
    // A holder's every definition goes with it, reached or not, since the
    // program is checked again whole.
    for (const h of holders(code, def, t)) if (!todo.has(h)) { reach(h); for (const d of makersOf(h)) reach(d); }
  };
  // The definitions making or matching each type, in the program's order,
  // found in one walk: each holder walked every definition again (I203:
  // an eighth of bounce's check for running).
  let makers: Map<Id, Id[]> | null = null;
  const makersOf = (h: Id): Id[] => {
    if (!makers) {
      makers = new Map();
      for (const d of code.defs) for (const td of madeOrMatched(code, d)) { let ds = makers.get(td); if (!ds) makers.set(td, (ds = [])); ds.push(d); }
    }
    return makers.get(h) ?? [];
  };
  entries.forEach(reach);

  // Copy a subtree with fresh ids (binders too), for an `otherwise` used by
  // several cases.
  const copy = (id: Id, renames = new Map<Id, Id>()): Id => {
    const n = nodes[id];
    const fresh = freshId();
    if (n.kind === "binder") renames.set(id, fresh);
    const c = structuredClone(n) as Record<string, unknown>;
    c.id = fresh;
    const kid = (x: Id) => copy(x, renames);
    switch (n.kind) {
      case "ref": c.target = renames.get(n.target) ?? n.target; break;
      case "call":
        if (isUse(n)) {
          c.fn = kid(n.fn);
          c.given = Object.fromEntries(Object.entries(n.given).map(([k, v]) => [k, kid(v)]));
          if (isBound(n)) { c.binds = Object.fromEntries(Object.entries(n.binds).map(([k, v]) => [k, kid(v)])); c.body = kid(n.body); }
          break;
        }
        c.fn = kid(n.fn); c.args = n.args.map(kid); break;
      case "lambda": c.params = n.params.map(kid); c.body = kid(n.body); if (n.results) c.results = n.results.map(kid); break;
      case "match": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); c.otherwise = n.otherwise && kid(n.otherwise); break;
      case "fold": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); break;
      case "arm": c.binds = n.binds.map(kid); c.results = n.results.map((r) => r && kid(r)); c.body = kid(n.body); break;
    }
    nodes[fresh] = c as unknown as Node;
    return fresh;
  };

  const recursive = (variant: Id) => (nodes[variant] as NodeOf<"variant">).fields.map((f) => {
    const ty = nodes[(nodes[f] as NodeOf<"field">).type];
    return ty.kind === "tref" && ty.target === t;
  });

  let at: Id = "";
  const here = (id: Id) => !only || only(id, at);
  const rewrite = (id: Id) => {
    const n = nodes[id];
    for (const c of childrenOf(n)) rewrite(c);
    if (n.kind === "ref" && jobOf(n.target)) { if (here(id)) nodes[id] = { ...n, target: jobOf(n.target)! }; }
    else if (fromFraction && n.kind === "lit" && n.of === t && /^\s*\d+\s*$/.test(String(n.value))) {
      nodes[id] = { id, kind: "call", fn: ref(rep.impl[fromFraction]), args: [add({ kind: "lit", value: String(n.value).trim().length <= 15 ? Number(n.value) : String(n.value).trim(), of: INT }), add({ kind: "lit", value: 1, of: INT })] };
    }
    else if (rep.literal && literalOf(n, t)) {
      const { id: _, ...lit } = n;
      nodes[id] = { id, kind: "call", fn: ref(rep.literal), args: [add(lit)] };
    }
    else if (n.kind === "tref" && n.target === t) { if (here(id)) nodes[id] = { ...n, target: rep.type }; }
    else if (only && (n.kind === "match" || n.kind === "fold") && armsOver(code, n, variants) && !here(id)) { /* the other group's */ }
    else if (n.kind === "fold" && rep.meaning && rep.cost[FOLD_OF_ITEMS] && armsOver(code, n, variants) && readsNoRest(code, n, t)) {
      nodes[id] = { ...n, scrutinee: add({ kind: "call", fn: ref(rep.meaning), args: [n.scrutinee] }) };
    }
    else if ((n.kind === "match" || n.kind === "fold") && armsOver(code, n, variants)) {
      const arms = new Map(n.arms.map((a) => { const arm = nodes[a] as NodeOf<"arm">; return [arm.variant, arm]; }));
      // One function per case, in the type's order: its fields, then (fold)
      // the folded value of each recursive field.
      const cases = variantsOf(code, t).map((v) => {
        const arm = arms.get(v);
        const fields = (nodes[v] as NodeOf<"variant">).fields;
        const rec = recursive(v);
        if (!arm) {
          const params = [...fields.map(binder), ...(n.kind === "fold" ? rec.filter(Boolean).map(binder) : [])];
          return add({ kind: "lambda", params, body: copy((n as NodeOf<"match">).otherwise!) });
        }
        const results = n.kind === "fold" ? rec.flatMap((r, i) => (r ? [arm.results[i] ?? binder()] : [])) : [];
        return add({ kind: "lambda", params: [...arm.binds, ...results], body: arm.body });
      });
      nodes[id] = { id, kind: "call", fn: ref(rep.impl[n.kind]), args: [n.scrutinee, ...cases] };
      if (n.kind === "match") inline(id);
    }
  };
  // A match job that isn't recursive and calls each case at most once is
  // put in place, its cases where it calls them: a definition that
  // matches and calls itself in a case (a map over the list) then calls
  // itself, not through a function it hands on, so the compilers see the
  // recursion (a loop, or the heap past 1000 calls deep). The input is
  // bound once, by a let; a case called is its function applied there,
  // which is a let too. The rest a case is given is still a piece of the
  // input for the termination check (infer.ts `piecesOf`). GHC inlines the
  // same way, a function used once at its call (Peyton Jones and Marlow,
  // "Secrets of the Glasgow Haskell Compiler inliner", JFP 2002).
  const inline = (id: Id) => {
    const c = nodes[id] as Call, job = (nodes[c.fn] as NodeOf<"ref">).target;
    const def = code.nodes[job];
    const fn = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
    if (fn?.kind !== "lambda" || fn.params.length !== c.args.length || directRefs(code, job).includes(job)) return;
    const uses = (p: Id) => subtree(code, fn.body).filter((x) => { const r = code.nodes[x]; return r.kind === "ref" && r.target === p; });
    if (fn.params.slice(1).some((p) => uses(p).length > 1)) return;
    const renames = new Map<Id, Id>();
    const params = fn.params.map((p) => copy(p, renames));
    const body = copy(fn.body, renames);
    // Each case where the job calls it; the input, once, by a let.
    for (let i = 1; i < fn.params.length; i++) {
      const at = subtree({ ...code, nodes }, body).find((x) => { const r = nodes[x]; return r.kind === "ref" && r.target === params[i]; });
      if (at) nodes[at] = { ...nodes[c.args[i]], id: at } as Node;
    }
    nodes[id] = { id, kind: "call", fn: add({ kind: "lambda", params: [params[0]], body }), args: [c.args[0]] };
  };

  for (const d of todo) { at = d; rewrite(d); }
  return { nodes, defs: code.defs };
}

function childrenOf(n: Node): Id[] {
  switch (n.kind) {
    case "call":
      if (isUse(n)) return useKids(n);
      return [n.fn, ...n.args];
    case "lambda": return [n.body];
    case "def": return n.body ? [n.body] : [];
    case "typedef": return n.variants;
    case "variant": return n.fields;
    case "field": return [n.type];
    case "tref": return n.args;
    case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms];
    case "arm": return [n.body];
    default: return [];
  }
}

// ---- Representations the compiler stores itself
//
// The rows above are written in the language: their jobs are definitions.
// These rows are the backends' own storage, so their jobs are templates,
// code each backend emits, named here. The first is `cells`: a value stored
// as the definition writes it, one object per case, linked by fields. Its
// fold is the loop the compiler makes for any fold without Choice (a spine
// for chains, an explicit stack for trees). Other rows make the same fold
// run on other storage, for a value made by their `meaning`
// (NUMBERS.md, "Folds run the way their value is stored").

export interface Storage {
  name: string;
  // The type it stores, or "data" for every data type.
  of: Id | "data";
  // The function whose result is stored this way, for a value it makes.
  meaning: Id | null;
  // Job → the template that does it.
  jobs: Record<string, string>;
  cost: Record<string, string>;
  // Fields, by variant, that this storage doesn't hold as values of the
  // type: the rest of a list stored as text is a position in a string, not
  // a list. A fold whose arms read one of them raw runs on cells instead.
  hidden?: Record<Id, number[]>;
}

export const CELLS: Storage = { name: "cells", of: "data", meaning: null, jobs: { fold: "cells.loop" }, cost: { fold: "n", space: "n" } };
// A list of one-character texts, kept as the text it was split from. Its
// fold walks the string's characters from the end, which is the order a
// fold over the list runs its arms in (children first).
export const TEXT: Storage = {
  name: "text", of: LIST, meaning: TEXT_OPS.characters, jobs: { fold: "text.reverse" },
  cost: { fold: "n", space: "n" }, hidden: { [CONS]: [1] },
};
// 0, 1, …, n − 1, kept as n. Its fold counts down from n − 1, running the
// cons arm on each number. The rest of such a list is a count too, so it
// is hidden like text's.
const counted = (name: string, meaning: Id): Storage => ({
  name, of: LIST, meaning, jobs: { fold: "count.down" }, cost: { fold: "n", space: "1" }, hidden: { [CONS]: [1] },
});
export const COUNTED = counted("counted", S.range);
export const COUNTED_INT = counted("counted Int", INT_OPS.range);
export const STORAGES: Storage[] = [CELLS, TEXT, COUNTED, COUNTED_INT];

// Which storage runs a fold, and the node whose value it runs on: the
// argument of a `meaning` when the fold's input is made by one (the law
// fold′(x) = fold(meaning(x)) read backwards), else the input itself.
export interface FoldPlan { rep: Storage; on: Id }
export function foldPlan(code: Code, fold: NodeOf<"fold">): FoldPlan {
  const input = code.nodes[fold.scrutinee];
  const made = isCall(input) ? code.nodes[input.fn] : undefined;
  for (const rep of STORAGES) {
    if (!rep.meaning || made?.kind !== "ref" || made.target !== rep.meaning || !isCall(input)) continue;
    if (fold.arms.some((a) => readsHidden(code, code.nodes[a] as NodeOf<"arm">, rep))) continue;
    return { rep, on: input.args[0] };
  }
  return { rep: CELLS, on: fold.scrutinee };
}

function readsHidden(code: Code, arm: NodeOf<"arm">, rep: Storage): boolean {
  const hidden = new Set((rep.hidden?.[arm.variant] ?? []).map((i) => arm.binds[i]));
  if (!hidden.size) return false;
  return subtree(code, arm.body).some((id) => { const n = code.nodes[id]; return n.kind === "ref" && hidden.has(n.target); });
}
