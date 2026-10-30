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

import { dependencies, freshId, subtree, type Code, type Id, type Node, type NodeData, type NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { CONS, COST, INT_OPS, JOBS, LIST, REPRESENTATION_V, S, TEXT_OPS } from "./std.ts";
import { NUMBER } from "./types.ts";

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
  // The definition that writes it, for one a program writes (L108).
  def?: Id;
}

export const LADDER = ["1", "log n", "log² n", "n", "n log n", "n²"];
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
    if (body?.kind !== "call" || refOf(body.fn) !== REPRESENTATION_V) continue;
    const ty = info.typeOf.get(body.id), t = ty && info.subst.zonk(ty);
    if (t?.t !== "con" || t.args.length !== 2) continue;
    const [m, space, jobs] = body.args;
    const lam = code.nodes[m];
    const same = lam?.kind === "lambda" && lam.params.length === 1 && refOf(lam.body) === lam.params[0];
    // t is what the meaning gives; for `(x) => x`, the type whose
    // constructors the jobs name.
    const listed: Id[] = [];
    for (let l = code.nodes[jobs]; l?.kind === "call" && refOf(l.fn) === CONS; l = code.nodes[l.args[1]]) listed.push(l.args[0]);
    const named = listed.map((j) => { const n = code.nodes[j], kind = n?.kind === "call" ? refOf(n.fn) : null; return n?.kind === "call" && (kind === JOBS.job || kind === JOBS.asWritten) ? refOf(n.args[0]) : null; });
    const [ty0, as] = t.args.map((a) => info.subst.zonk(a));
    const of = ty0.t === "con" ? ty0.id : named.map((v) => v && info.owner.get(v)).find(Boolean);
    if (!of || (!same && as.t !== "con")) continue;
    const rep: Representation = { def: d, name: names[d] ?? d, of, type: same || as.t !== "con" ? of : as.id, meaning: same ? null : refOf(m), canonical: true, impl: {}, cost: {} };
    const sp = costOf(space);
    if (sp) rep.cost.space = sp;
    // The jobs, a list written out: cons(job, rest) down to nil.
    for (const id of listed) {
      const j = code.nodes[id];
      if (j?.kind !== "call") continue;
      const kind = refOf(j.fn), a = j.args.map(refOf), cost = costOf(j.args[j.args.length - 1]);
      // How equal, show and compare see it, when it isn't one spelling per value.
      const seen = kind === JOBS.equalBy ? "equal" : kind === JOBS.showBy ? "show" : kind === JOBS.compareBy ? "compare" : null;
      if (seen && a[0]) { rep.canonical = false; (rep.byType ??= { equal: "", show: "", compare: "" })[seen] = a[0]; continue; }
      if (kind === JOBS.headBy && a[0] && a[1]) { (rep.heads ??= {})[a[0]] = a[1]; continue; }
      const key = kind === JOBS.job || kind === JOBS.asWritten ? a[0] : kind === JOBS.matchBy || kind === JOBS.matchAsWritten ? "match" : kind === JOBS.foldBy || kind === JOBS.foldAsWritten ? "fold" : null;
      if (!key) continue;
      const by = kind === JOBS.job ? a[1] : kind === JOBS.matchBy || kind === JOBS.foldBy ? a[0] : null;
      if (by) rep.impl[key] = by;
      if (cost) rep.cost[key] = cost;
    }
    out.push(rep);
  }
  return out;
}
const rank = (c: string | undefined) => (c === undefined ? LADDER.length : LADDER.indexOf(c));

// A builtin type such as Float64 has no cases: its jobs are its builtins.
const variantsOf = (code: Code, type: Id) => {
  const d = code.nodes[type];
  return d?.kind === "def" ? (code.nodes[d.body!] as NodeOf<"typedef">).variants : [];
};
// Is this node a literal of type t?
const literalOf = (n: Node, t: Id) => n.kind === "lit" && (n.of ? n.of === t : t === NUMBER && typeof n.value === "number");

// The jobs on T a definition uses, transitively: constructors, matches,
// folds, and calls to functions some representation implements.
export function uses(code: Code, entry: Id, reps: Representation[]): string[] {
  const t = reps[0].of;
  const variants = new Set(variantsOf(code, t));
  const implemented = new Set(reps.flatMap((r) => Object.keys(r.impl)));
  const costed = new Set(reps.flatMap((r) => Object.keys(r.cost)));
  const out = new Set<string>();
  const walk = (def: Id) => {
    for (const id of subtree(code, def)) {
      const n = code.nodes[id];
      if (n.kind === "ref" && (variants.has(n.target) || costed.has(n.target))) out.add(n.target);
      if ((n.kind === "match" || n.kind === "fold") && armsOver(code, n, variants)) out.add(n.kind);
    }
  };
  // A function some representation implements is one job: don't look
  // inside it, since its body is what gets replaced (`add item` builds a
  // `set of`, which the tree never does).
  const seen = new Set<Id>();
  const visit = (def: Id) => {
    if (seen.has(def)) return;
    seen.add(def);
    if (implemented.has(def) && def !== entry) return;
    walk(def);
    for (const d of directRefs(code, def)) visit(d);
  };
  visit(entry);
  return [...out];
}

function directRefs(code: Code, def: Id): Id[] {
  const out: Id[] = [];
  for (const id of subtree(code, def)) {
    const n = code.nodes[id];
    if (n.kind === "ref" && code.nodes[n.target]?.kind === "def") out.push(n.target);
  }
  return out;
}

const armsOver = (code: Code, n: NodeOf<"match"> | NodeOf<"fold">, variants: Set<Id>) =>
  n.arms.some((a) => variants.has((code.nodes[a] as NodeOf<"arm">).variant));

export interface Choice {
  rep: Representation;
  table: { rep: string; costs: Record<string, string> }[];
  jobs: string[];
}

// Pick the representation whose worst job is cheapest, then the cheapest
// in total, then the smallest. A job a representation doesn't implement is
// done by its definition, which costs what it costs in T's own terms.
export function choose(code: Code, entry: Id, reps: Representation[]): Choice {
  const jobs = uses(code, entry, reps);
  const spec = reps.find((r) => r.type === r.of && !Object.keys(r.impl).length)!;
  const costs = (r: Representation) => Object.fromEntries([...jobs, "space"].map((j) => [j, r.cost[j] ?? spec.cost[j] ?? "?"]));
  const score = (r: Representation) => {
    const c = costs(r);
    const rs = jobs.map((j) => rank(c[j]));
    return [Math.max(...rs), rs.reduce((a, b) => a + b, 0), rank(c.space)];
  };
  const best = reps.filter((r) => !r.approximate).sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
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
export function represent(code: Code, entries: Id[], rep: Representation, keep: Id[] = []): Code {
  // The definition itself; a representation by the same type changes the
  // jobs (Float32 rounds each one).
  if (rep.type === rep.of && !Object.keys(rep.impl).length && !rep.literal) return code;
  const t = rep.of;
  const variants = new Set(variantsOf(code, t));
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: NodeData): Id => {
    const id = freshId();
    nodes[id] = { ...n, id } as Node;
    return id;
  };
  const ref = (target: Id) => add({ kind: "ref", target });
  const binder = () => add({ kind: "binder" });

  // The representation's own code stays as it is: it's written on R, and
  // `meaning` is written on T.
  const own = new Set<Id>(keep);
  for (const d of [...Object.values(rep.impl), ...(rep.meaning ? [rep.meaning] : []), ...(rep.literal ? [rep.literal] : [])]) {
    own.add(d);
    for (const x of dependencies(code, d)) own.add(x);
  }
  // Rewrite what the entry reaches, not going inside replaced functions.
  const todo = new Set<Id>();
  const reach = (def: Id) => {
    if (todo.has(def) || own.has(def) || rep.impl[def]) return;
    todo.add(def);
    for (const d of directRefs(code, def)) reach(d);
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
      case "call": c.fn = kid(n.fn); c.args = n.args.map(kid); break;
      case "lambda": c.params = n.params.map(kid); c.body = kid(n.body); break;
      case "match": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); c.otherwise = n.otherwise && kid(n.otherwise); break;
      case "fold": c.scrutinee = kid(n.scrutinee); c.arms = n.arms.map(kid); break;
      case "arm": c.binds = n.binds.map(kid); c.results = n.results.map((r) => r && kid(r)); c.body = kid(n.body); break;
      case "solve":
        c.given = Object.fromEntries(Object.entries(n.given).map(([k, v]) => [k, kid(v)]));
        c.binds = Object.fromEntries(Object.entries(n.binds).map(([k, v]) => [k, kid(v)]));
        c.body = kid(n.body);
        break;
    }
    nodes[fresh] = c as unknown as Node;
    return fresh;
  };

  const recursive = (variant: Id) => (nodes[variant] as NodeOf<"variant">).fields.map((f) => {
    const ty = nodes[(nodes[f] as NodeOf<"field">).type];
    return ty.kind === "tref" && ty.target === t;
  });

  const rewrite = (id: Id) => {
    const n = nodes[id];
    for (const c of childrenOf(n)) rewrite(c);
    if (n.kind === "ref" && rep.impl[n.target]) nodes[id] = { ...n, target: rep.impl[n.target] };
    else if (rep.literal && literalOf(n, t)) {
      const { id: _, ...lit } = n;
      nodes[id] = { id, kind: "call", fn: ref(rep.literal), args: [add(lit)] };
    }
    else if (n.kind === "tref" && n.target === t) nodes[id] = { ...n, target: rep.type };
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
    }
  };
  for (const d of todo) rewrite(d);
  return { nodes, defs: code.defs };
}

function childrenOf(n: Node): Id[] {
  switch (n.kind) {
    case "call": return [n.fn, ...n.args];
    case "lambda": return [n.body];
    case "def": return n.body ? [n.body] : [];
    case "typedef": return n.variants;
    case "variant": return n.fields;
    case "field": return [n.type];
    case "tref": return n.args;
    case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms];
    case "arm": return [n.body];
    case "solve": return [...Object.values(n.given), n.body];
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
  const made = input?.kind === "call" ? code.nodes[input.fn] : undefined;
  for (const rep of STORAGES) {
    if (!rep.meaning || made?.kind !== "ref" || made.target !== rep.meaning || input?.kind !== "call") continue;
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
