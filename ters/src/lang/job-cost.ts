// Costs worked out, not only declared (L247, NUMBERS.md stage 7). A
// representation declares what each of its jobs costs; the job's
// definition says what it always does at least. Where that is more than
// the declaration (examples/waiting's `front first`, whose `behind` is
// declared constant but is `append(r, [p])`, a walk of the whole line),
// the chooser takes the worked-out cost, and `ters check` says so.
//
// What is worked out is a lower bound: the least a call can take on a big
// value, whatever path it goes. A declaration above it stands, since an
// amortized cost (two lists' served, which turns the newest around once
// for all of them) or a balanced tree's depth isn't seen from one call.
//
// A value is big when it is, or comes from, an input of the type the job
// works on (the representation's, or the type's own): a field of it that
// holds the same type (a list's rest), or what a call on it gives of a
// data type. Its size in n, the size of the value the job stands for, is
// the representation's space (a Binary's bits are log n). Then:
//   - a fold over a big value visits all of it: its size;
//   - a match or an if takes the least of its arms;
//   - a definition that, on every path, calls itself on a big input's
//     recursive field, walks that input to its end: its size (reverse
//     onto, a list's length);
//   - a call of another type's job (std's append on the list inside) takes
//     the least of that job's own definition, worked out the same way, and
//     what each of the type's other representations declares for it (a
//     tree appends in log n);
//   - a constructor, a builtin and a function given as an input take
//     nothing of their own.

import { type Code, type Id, type NodeOf, SCHEMA, isCall, subtree } from "../model.ts";
import type { Info } from "./infer.ts";
import { LADDER } from "./cost.ts";
import type { Representation } from "./represent.ts";

// A declaration the worked-out cost raised: the job, what it declared,
// what its definition `by` always takes, and the call that takes it.
export interface Raised { job: Id; declared: string; least: string; by: Id; calls?: Id }

const at = (c: string) => Math.max(0, LADDER.indexOf(c));
const most = (...cs: number[]) => Math.max(0, ...cs);

// A cost in a size m, written in n where m is `size` of n.
function within(c: number, size: string): number {
  if (size === "n" || c === 0) return c;
  const n = at("n");
  if (size === "1") return 0;
  // A size below n: a walk of it is that size, less is constant (a lower
  // bound, rounded down).
  if (c >= n) return c >= at("n²") ? at("log² n") : at(size);
  return 0;
}

// The jobs' worked-out lower bounds for `rep`, the representations of the
// other types it reaches in `others`; and which declarations they raise.
export function workedOut(code: Code, info: Info, rep: Representation, others: Representation[]): { cost: Record<string, string>; raised: Raised[] } {
  const size = rep.cost.space ?? "n";
  const nodes = code.nodes;
  const raised: Raised[] = [];
  const cost = { ...rep.cost };
  const memo = new Map<string, number>();
  const stack = new Set<string>();
  const jobsOf = new Map<Id, Representation[]>();
  // Each job of another type, by the representations that do it some
  // other way than its own definition, at what they declare.
  for (const r of others) for (const j of Object.keys(r.cost)) if (j !== "space" && r.impl[j] !== undefined) (jobsOf.get(j) ?? jobsOf.set(j, []).get(j)!).push(r);

  const typeOfNode = (id: Id) => { const t = info.typeOf.get(id); return t ? info.subst.zonk(t) : null; };
  // A type that holds itself (a list, a line), whose values can be big.
  const recursive = new Map<Id, boolean>();
  const holdsItself = (t: Id): boolean => {
    if (recursive.has(t)) return recursive.get(t)!;
    recursive.set(t, false);
    const d = nodes[t];
    const td = d?.kind === "def" && d.body ? nodes[d.body] : null;
    const yes = td?.kind === "typedef" && !td.interface && !td.effect && td.variants.some((v) => (nodes[v] as NodeOf<"variant">).fields.some((f) => mentionsType(fieldType(f), t)));
    recursive.set(t, !!yes);
    return !!yes;
  };
  const fieldType = (f: Id): Id | null => (nodes[f] as NodeOf<"field">).type ?? null;
  const mentionsType = (tr: Id | null, t: Id): boolean => {
    const n = tr ? nodes[tr] : null;
    if (n?.kind === "tref") return n.target === t || n.args.some((a) => mentionsType(a, t));
    return false;
  };
  const isData = (id: Id) => { const t = typeOfNode(id); return t?.t === "con" && (holdsItself(t.id) || t.id === rep.of || t.id === rep.type); };

  const mentions = (e: Id, big: Set<Id>): boolean => {
    const n = nodes[e];
    if (!n) return false;
    if (n.kind === "ref") return big.has(n.target);
    return children(e).some((c) => mentions(c, big));
  };
  const children = (id: Id): Id[] => {
    const n = nodes[id] as unknown as Record<string, unknown>;
    const slots = (SCHEMA as unknown as Record<string, Record<string, string>>)[nodes[id].kind] ?? {};
    return Object.entries(slots).flatMap(([k, s]) => {
      if (s !== "child") return [];
      const v = n[k];
      return Array.isArray(v) ? v.filter((x): x is Id => typeof x === "string") : typeof v === "string" ? [v] : [];
    });
  };
  const bigNow = (e: Id, big: Set<Id>) => mentions(e, big) && isData(e);

  // The arm's binders that are big: the fields holding the scrutinee's own
  // type, when the scrutinee is big.
  const armBig = (arm: NodeOf<"arm">, scrBig: boolean, big: Set<Id>): Set<Id> => {
    if (!scrBig) return big;
    const v = nodes[arm.variant] as NodeOf<"variant"> | undefined;
    const t = info.owner.get(arm.variant);
    const out = new Set(big);
    arm.binds.forEach((b, i) => { const f = v?.fields[i]; if (f && t && mentionsType(fieldType(f), t)) out.add(b); else if (isData(b)) out.add(b); });
    return out;
  };

  function least(e: Id, big: Set<Id>, self: Id): number {
    const n = nodes[e];
    if (!n) return 0;
    switch (n.kind) {
      case "lit": case "ref": case "lambda": case "hole": return 0;
      case "match": {
        const scr = least(n.scrutinee, big, self), sb = bigNow(n.scrutinee, big) || mentions(n.scrutinee, big) && isData(n.scrutinee);
        const arms = n.arms.map((a) => { const arm = nodes[a] as NodeOf<"arm">; return least(arm.body, armBig(arm, sb, big), self); });
        if (n.otherwise) arms.push(least(n.otherwise, big, self));
        return most(scr, arms.length ? Math.min(...arms) : 0);
      }
      case "fold": {
        const sb = bigNow(n.scrutinee, big);
        const arms = n.arms.map((a) => { const arm = nodes[a] as NodeOf<"arm">; return least(arm.body, armBig(arm, sb, big), self); });
        return most(least(n.scrutinee, big, self), sb ? at(size) : 0, arms.length ? Math.min(...arms) : 0);
      }
      case "call": {
        if (!isCall(n)) return most(...children(e).map((c) => least(c, big, self)));
        const args = most(...n.args.map((a) => least(a, big, self)));
        const f = nodes[n.fn];
        if (f?.kind === "lambda") {
          const inner = new Set(big);
          f.params.forEach((p, i) => { if (n.args[i] && bigNow(n.args[i], big)) inner.add(p); });
          return most(args, least(f.body, inner, self));
        }
        if (f?.kind !== "ref") return most(args, least(n.fn, big, self));
        const g = f.target;
        if (g === self || nodes[g]?.kind !== "def") return args;
        return most(args, called(g, n.args.map((a) => bigNow(a, big))));
      }
      default: return most(...children(e).map((c) => least(c, big, self)));
    }
  }

  // A call of g with these inputs big.
  function called(g: Id, bigs: boolean[]): number {
    if (!bigs.some(Boolean)) return 0;
    // The type's own definition is one way, each representation another:
    // the least of them is what the call takes at least.
    const elsewhere = (jobsOf.get(g) ?? []).map((r) => within(at(r.cost[g]), size));
    return Math.min(defLeast(g, bigs), ...elsewhere);
  }

  function defLeast(g: Id, bigs: boolean[]): number {
    const key = `${g} ${bigs.map(Number).join("")}`;
    if (memo.has(key)) return memo.get(key)!;
    if (stack.has(key)) return 0;
    stack.add(key);
    const d = nodes[g] as NodeOf<"def">;
    const lam = d.body ? nodes[d.body] : null;
    let c = 0;
    if (lam?.kind === "lambda") {
      const big = new Set(lam.params.filter((_, i) => bigs[i]));
      c = least(lam.body, big, g);
      if (walksToEnd(g, lam, big)) c = most(c, at(size));
    } else if (d.body) c = least(d.body, new Set(), g);
    stack.delete(key);
    memo.set(key, c);
    return c;
  }

  // Whether g, on every path, calls itself with a big input's recursive
  // field where that input was: a walk to its end.
  function walksToEnd(g: Id, lam: NodeOf<"lambda">, big: Set<Id>): boolean {
    // The body is a match on a big input (lets before it aside).
    let e = lam.body;
    for (;;) {
      const n = nodes[e];
      if (isCall(n) && nodes[n.fn]?.kind === "lambda") { e = (nodes[n.fn] as NodeOf<"lambda">).body; continue; }
      break;
    }
    const m = nodes[e];
    if (m?.kind !== "match" || m.otherwise) return false;
    const s = nodes[m.scrutinee];
    if (s?.kind !== "ref" || !big.has(s.target)) return false;
    const pos = lam.params.indexOf(s.target);
    if (pos < 0) return false;
    const t = info.owner.get((nodes[m.arms[0]] as NodeOf<"arm">)?.variant ?? "");
    let descends = false;
    const all = m.arms.every((a) => {
      const arm = nodes[a] as NodeOf<"arm">;
      const v = nodes[arm.variant] as NodeOf<"variant">;
      const rec = arm.binds.filter((_, i) => !!t && mentionsType(fieldType(v.fields[i]), t));
      // A case holding none of its own type ends the walk: the walk's end.
      if (!rec.length) return v.fields.every((f) => !t || !mentionsType(fieldType(f), t));
      // One holding two or more (a tree's node) is gone down one of them,
      // as deep as the tree is: nothing said about its size.
      if (v.fields.filter((f) => !!t && mentionsType(fieldType(f), t)).length > 1) return false;
      descends = true;
      return always(arm.body, g, pos, new Set(rec));
    });
    return all && descends;
  }

  // Every path through e calls g with one of `rest` at position pos.
  function always(e: Id, g: Id, pos: number, rest: Set<Id>): boolean {
    const n = nodes[e];
    if (!n) return false;
    if (n.kind === "lambda" || n.kind === "lit" || n.kind === "ref" || n.kind === "hole") return false;
    if (n.kind === "match") {
      if (always(n.scrutinee, g, pos, rest)) return true;
      const arms = n.arms.map((a) => (nodes[a] as NodeOf<"arm">).body);
      if (n.otherwise) arms.push(n.otherwise);
      return arms.length > 0 && arms.every((a) => always(a, g, pos, rest));
    }
    if (n.kind === "fold") return always(n.scrutinee, g, pos, rest);
    if (isCall(n)) {
      const f = nodes[n.fn];
      if (f?.kind === "ref" && f.target === g) { const a = nodes[n.args[pos]]; if (a?.kind === "ref" && rest.has(a.target)) return true; }
      if (n.args.some((a) => always(a, g, pos, rest))) return true;
      return f?.kind === "lambda" && always(f.body, g, pos, rest);
    }
    return children(e).some((c) => always(c, g, pos, rest));
  }

  for (const [job, by] of Object.entries(rep.impl)) {
    const d = nodes[by];
    if (d?.kind !== "def" || job === "match" || job === "fold") continue;
    const lam = d.body ? nodes[d.body] : null;
    // Its inputs of the type it works on are big.
    const bigs = lam?.kind === "lambda" ? lam.params.map((p) => { const t = typeOfNode(p); return t?.t === "con" && (t.id === rep.type || t.id === rep.of); }) : [];
    const c = lam?.kind === "lambda" ? defLeast(by, bigs) : 0;
    const declared = rep.cost[job];
    if (declared && LADDER.includes(declared) && c > at(declared)) {
      cost[job] = LADDER[c];
      // The call it takes that at: the first that does.
      const lamB = lam as NodeOf<"lambda">, big = new Set(lamB.params.filter((_, i) => bigs[i]));
      const calls = subtree(code, lamB.body).map((x) => nodes[x]).find((n) => {
        if (!isCall(n)) return false;
        const f = nodes[n.fn];
        return f?.kind === "ref" && f.target !== by && nodes[f.target]?.kind === "def" && called(f.target, n.args.map((a) => bigNow(a, big))) >= c;
      }) as { fn: Id } | undefined;
      const callee = calls ? (nodes[calls.fn] as NodeOf<"ref">).target : undefined;
      raised.push({ job, declared, least: LADDER[c], by, ...(callee ? { calls: callee } : {}) });
    }
  }
  return { cost, raised };
}

// A program's representations with their worked-out costs: each job at
// the most of what it declares and what its definition always takes, the
// library's representations standing for the other types' ways. Each
// keeps the declarations raised, for `ters check` to say.
export function withWorkedOutCosts(code: Code, info: Info, reps: Representation[], others: Representation[]): Representation[] {
  return reps.map((r) => {
    const w = workedOut(code, info, r, [...others, ...reps.filter((x) => x !== r)]);
    return w.raised.length ? { ...r, cost: w.cost, raised: w.raised } : r;
  });
}

// What `ters check` says of a raised declaration, in the program's names.
export function raisedText(rep: Representation, r: Raised, names: Record<Id, string>): string {
  const nm = (x: Id) => names[x] ?? x;
  const said = (c: string) => ({ "1": "constant", "log n": "logarithmic", "log² n": "polylogarithmic", "n": "linear", "n log n": "linearithmic", "n²": "quadratic" } as Record<string, string>)[c] ?? c;
  return `${rep.name} declares ${nm(r.job)} ${said(r.declared)}, but ${nm(r.by)} always takes at least ${r.least}${r.calls ? ` (it calls ${nm(r.calls)})` : ""}: counted at ${r.least}`;
}
