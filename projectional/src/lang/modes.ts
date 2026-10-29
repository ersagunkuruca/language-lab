// Modes: which order a function's goals run in when some of its ports are
// known, how many answers that can give, and whether it ends, decided from
// the code before anything runs (MODES.md).
//
// A mode is a definition (or a lambda) and the set of its ports that are
// known: its parameters and its result, "out". Forward is the mode where
// the parameters are known. Each node is a goal over slots (the values of
// nodes and binders): it is ready when what it needs is known, and gives
// the rest. The analysis runs the goals in the best order it can: one
// answer first, then checks, then choices, then what may not end. A match
// or a fold is a choice of arms, and each arm goes on with the goals left,
// as `conj(disj(a, b), c)` is `disj(conj(a, c), conj(b, c))`. When nothing
// is ready and goals are left, the mode is stuck: in relate.ts those goals
// would be left waiting, and an answer with waits left isn't an answer.
//
// Whether a mode ends is the size-change check (Lee, Jones and Ben-Amram,
// POPL 2001; infer.ts runs it for forward totality) with the known ports
// as what's measured. Taking a known value apart gives smaller parts, in
// either direction: a case's fields are smaller than the value examined,
// and a constructor's fields are smaller than its known result. So `map`
// solved for its list from a known result ends: each call's result is the
// tail of the last one's. Prior art for measuring the known ports: TermiLog
// (Lindenstrauss and Sagiv, ICLP 1997) and cTI (Mesnard and Neumerkel, SAS
// 2001). The determinism categories are Mercury's (Somogyi, Henderson and
// Conway, JLP 1996).
//
// Known is two levels here, known or not, where MODES.md plans three (a
// value whose case is known but not its fields). Nothing in the examples
// needs the third yet; a projection run backwards waits for its record.
//
// The checker (infer.ts) types a relational solve from its verdict:
// Diverge only when it may not end, and an error when it's stuck.
// test/modes.test.ts compares what it says with what relate.ts does.

import type { Code, Id, NodeOf } from "../model.ts";
import { children, ownerOfTypeParts, subtree } from "../model.ts";
import { NUMERIC } from "./equations.ts";
import { planSolve, type SolvePlan } from "./solve.ts";
import { computedForward } from "./directions.ts";
import { INT_OPS, S, SET, STD_IMPL, STD_MANY, TEXT_OPS } from "./std.ts";

// How many answers: whether there can be none, and whether there can be
// more than one. det = neither, semidet = may fail, multi = may give
// several, nondet = both (Mercury's names).
export interface Answers { fail: boolean; many: boolean }
const ONE: Answers = { fail: false, many: false };
const CHECK: Answers = { fail: true, many: false };
const MANY: Answers = { fail: true, many: true };
const both = (a: Answers, b: Answers): Answers => ({ fail: a.fail || b.fail, many: a.many || b.many });
export const determinism = (a: Answers) => (a.fail ? (a.many ? "nondet" : "semidet") : a.many ? "multi" : "det");

export interface Verdict {
  answers: Answers;
  ends: boolean;
  // Why it may not end, in words, when it may not.
  loops: string[];
  // Goals nothing makes ready, in words. Empty when the mode isn't stuck.
  stuck: string[];
  // Goals whose order is decided at run time (equations solved together,
  // a call of a function only known then).
  dynamic: string[];
  // The goals in the order they ran, in words (the first branch's).
  order: string[];
  // The schedule relate.ts runs (MODES.md, step 3).
  plan: Plan;
}

// A mode, as relate.ts asks for one: the ports known, and the functions
// known for function parameters.
export interface Mode { known: string[]; spec: [number, Fn][] }

// One goal of a schedule, as relate.ts runs it. Ids are nodes, or the
// slots of a fold run one level down (`<fold>#part`, `<fold>#out`).
// waits: a goal the plan never made ready (the mode is stuck); it runs
// only once what it needs is known.
export type Exec = { waits?: true } & (
  // A literal, or a reference to something defined.
  | { k: "given"; node: Id }
  // A function written here.
  | { k: "closure"; node: Id }
  // A call, and the mode its function runs in when that's known here.
  | { k: "call"; node: Id; callee?: Mode }
  // Two slots that are one value.
  | { k: "same"; a: Id; b: Id }
  // The value examined is this case, with these fields.
  | { k: "case"; value: Id; variant: Id; binds: Id[] }
  // A recursive part (field `index` of `variant`) and its folded
  // value: the fold one level down, run by its own plan.
  | { k: "unfold"; fold: Id; variant: Id; index: number; part: Id; result: Id; plan: () => Plan }
  | { k: "solve"; node: Id; callee?: Mode }
  | { k: "hole"; node: Id });

// The goals in order, then a choice of arms, each going on with its own
// plan (the goals after the choice are in each arm's).
export interface Plan { steps: Exec[]; branch?: Choice }
export interface Choice {
  node: Id; value: Id; out: Id;
  // The value examined was known: exactly one arm applies, and its fields
  // are taken from the value.
  exclusive: boolean;
  arms: { variant: Id | null; binds: Id[]; plan: Plan }[];
}
const NO_PLAN: Plan = { steps: [] };

// A function known before running: a definition, a builtin, a case or a
// field, or a lambda written in place.
export type Fn = { k: "def" | "builtin" | "variant" | "field" | "lambda"; id: Id };
const fnKey = (f: Fn) => `${f.k}:${f.id}`;

type Port = string;
// What a slot is known to be no bigger than: measured port -> strictly smaller.
type Size = Map<Port, boolean>;

interface Firing {
  gives: Id[];
  answers: Answers;
  ends: boolean;
  why?: string;
  dynamic?: string;
  // Sizes for the slots given (by slot).
  sizes?: [Id, Size][];
  // A choice of arms: each one goes on as its own branch.
  branches?: Branch[];
  // Run when this goal is the one chosen (a call's size-change graph).
  chosen?: () => void;
  // Arms are exclusive (the value examined was known), so at most one runs.
  exclusive?: boolean;
  // The result is known and no two arms build it with the same case, so
  // at most one arm can give it.
  disjoint?: boolean;
  // Where the choice is, for the plan.
  at?: { node: Id; value: Id; out: Id };
  // What relate.ts runs, when it's more than the goal's own exec says.
  exec?: Exec;
  cost: number;
}
interface Branch { goals: Goal[]; gives: Id[]; sizes: [Id, Size][]; text: string; variant: Id | null; binds: Id[] }
// posts: relate.ts can post it before it's ready, as a constraint that
// waits and never branches (join text, show), which a choice it constrains
// can then see.
interface Goal { text: string; slots: Id[]; numeric?: boolean; posts?: boolean; exec: Exec; ready(st: St): Firing | null }

interface St {
  known: Set<Id>;
  // After equations solved together, what they give is known only if the
  // solver finishes them: the goals after that wait for it in relate.ts.
  soft?: boolean;
  // Goals already posted as constraints (see Goal.posts).
  posted?: Set<Goal>;
  sizes: Map<Id, Size>;
  goals: Goal[];
  answers: Answers;
  ends: boolean;
  loops: string[];
  dynamic: string[];
  order: string[];
}

const strict = (s: Size | undefined): Size => new Map([...(s ?? new Map()).keys()].map((p) => [p, true]));
const same = (s: Size | undefined): Size => new Map(s ?? []);

// plansOnly: for relate.ts, which needs the schedules and not whether
// they end (the size-change check, run again for each mode planned while
// the search runs, would be most of its time).
export function analyzer(code: Code, names: Record<Id, string> = {}, { plansOnly = false } = {}) {
  const nodes = code.nodes;
  const owner = ownerOfTypeParts(code);
  const nm = (id: Id) => names[id] ?? id;

  // Slots: refs to a binder are the binder, a let's parameter is its
  // argument, and a let is its body.
  const parent = new Map<Id, Id>();
  const find = (id: Id): Id => { let r = id; while (parent.has(r)) r = parent.get(r)!; return r; };
  const union = (a: Id, b: Id) => { const x = find(a), y = find(b); if (x !== y) parent.set(x, y); };
  const isLet = (n: NodeOf<"call">) => nodes[n.fn]?.kind === "lambda" && (nodes[n.fn] as NodeOf<"lambda">).params.length === n.args.length;
  // Nodes can be added while a program runs (a derivative is a new
  // lambda), so the slots are brought up to date when one is asked for.
  const seen = new Set<Id>();
  const refresh = () => {
    for (const n of Object.values(nodes)) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.kind === "ref" && nodes[n.target]?.kind === "binder") union(n.id, n.target);
      if (n.kind === "call" && isLet(n)) {
        const lam = nodes[n.fn] as NodeOf<"lambda">;
        lam.params.forEach((p, i) => union(p, n.args[i]));
        union(n.id, lam.body);
      }
    }
  };
  refresh();
  const slot = find;
  // The plans of a lambda made after the analyzer was.
  const fresh = (lam: Id) => { if (!seen.has(lam)) refresh(); };

  // Binders a lambda uses from outside itself.
  const freeOf = new Map<Id, Id[]>();
  const free = (lam: Id): Id[] => {
    if (!freeOf.has(lam)) {
      const inside = new Set(subtree(code, lam));
      freeOf.set(lam, [...new Set(subtree(code, lam).flatMap((x) => {
        const n = nodes[x];
        return n.kind === "ref" && nodes[n.target]?.kind === "binder" && !inside.has(n.target) ? [slot(n.target)] : [];
      }))]);
    }
    return freeOf.get(lam)!;
  };

  const fieldCount = (v: Id) => (nodes[v] as NodeOf<"variant">).fields.length;
  const variantsOf = (v: Id): Id[] => (nodes[(nodes[owner.get(v)!] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants;
  // Text that can't be empty: a literal with something in it, a number
  // shown, or a join with such a side.
  const nonEmptyText = (id: Id): boolean => {
    const n = nodes[id];
    if (n.kind === "lit") return typeof n.value === "string" && n.value !== "";
    if (n.kind !== "call") return false;
    const f = nodes[n.fn];
    if (f?.kind !== "ref") return false;
    return f.target === S.show || (f.target === S.concat && n.args.some(nonEmptyText));
  };

  // Call graphs between modes, for the size-change check: an arc i -> j
  // says the callee's port j is no bigger (strict: smaller) than the
  // caller's port i.
  type Arc = [number, number, boolean];
  interface Graph { from: string; to: string; arcs: Arc[] }
  const graphs: Graph[] = [];
  const memo = new Map<string, Verdict>();
  const running = new Set<string>();

  // ----------------------------------------------------------- modes

  // A function in a mode: which of its ports are known (parameter
  // positions, and "out"), and which of its function parameters are
  // known functions.
  function mode(f: Fn, known: Set<string>, spec: Map<number, Fn>): Verdict {
    if (f.k === "def") {
      const body = nodes[(nodes[f.id] as NodeOf<"def">).body!];
      if (body?.kind !== "lambda") return { answers: known.has("out") ? CHECK : ONE, ends: true, loops: [], stuck: [], dynamic: [], order: [], plan: NO_PLAN };
      return lambdaMode(body.id, known, spec, f.id);
    }
    if (f.k === "lambda") return lambdaMode(f.id, known, spec, null);
    return { answers: ONE, ends: true, loops: [], stuck: [], dynamic: [], order: [], plan: NO_PLAN };
  }

  // A lambda's mode, or (with root a definition's body that isn't a
  // lambda) a value defined once, whose only port is "out".
  function lambdaMode(lam: Id, known: Set<string>, spec: Map<number, Fn>, def: Id | null): Verdict {
    const l = nodes[lam].kind === "lambda" ? nodes[lam] as NodeOf<"lambda"> : { params: [] as Id[], body: lam };
    const key = `${lam}|${[...known].sort().join(",")}|${[...spec].map(([i, f]) => `${i}=${fnKey(f)}`).sort().join(",")}`;
    const ports: Port[] = [...l.params.map((_, i) => String(i)), "out"];
    const hit = memo.get(key);
    if (hit) return hit;
    if (running.has(key)) return { answers: ONE, ends: true, loops: [], stuck: [], dynamic: [], order: [], plan: NO_PLAN };
    running.add(key);
    const st: St = { known: new Set(), sizes: new Map(), goals: [], answers: ONE, ends: true, loops: [], dynamic: [], order: [] };
    const fns = new Map<Id, Fn>();
    l.params.forEach((p, i) => {
      if (known.has(String(i))) { st.known.add(slot(p)); st.sizes.set(slot(p), new Map([[String(i), false]])); }
      const f = spec.get(i);
      if (f) fns.set(slot(p), f);
    });
    // What the lambda uses from outside is known where it's called.
    for (const b of free(lam)) st.known.add(b);
    if (known.has("out")) { st.known.add(slot(l.body)); st.sizes.set(slot(l.body), new Map([["out", false]])); }
    const ctx: Ctx = { key, ports, fns, def };
    st.goals = goalsOf(l.body, ctx);
    const need = [...l.params.map(slot), slot(l.body)];
    let v = run(st, need, ctx);
    running.delete(key);
    // Its own recursion, as far as it's known now (a cycle through a mode
    // still being worked out is checked again at the end, in checked()).
    const t = plansOnly ? { ok: true } : terminates(key);
    if (!t.ok) v = { ...v, ends: false, loops: [...v.loops, `${def ? nm(def) : "a function"} calls itself on something that isn't smaller`] };
    memo.set(key, v);
    return v;
  }

  interface Ctx { key: string; ports: Port[]; fns: Map<Id, Fn>; def: Id | null }

  // The function a slot holds, when it's known before running.
  function fnAt(id: Id, ctx: Ctx): Fn | null {
    const n = nodes[id];
    if (n.kind === "ref") {
      const t = nodes[n.target];
      if (t.kind === "def" || t.kind === "builtin" || t.kind === "variant" || t.kind === "field") return { k: t.kind, id: t.id };
      return ctx.fns.get(slot(n.target)) ?? null;
    }
    if (n.kind === "lambda") return { k: "lambda", id };
    return ctx.fns.get(slot(id)) ?? null;
  }

  // ----------------------------------------------------------- the search

  function run(st: St, need: Id[], ctx: Ctx): Verdict {
    const steps: Exec[] = [];
    for (;;) {
      let best: { g: Goal; f: Firing } | null = null;
      for (const g of st.goals) {
        const f = g.ready(st) ?? (g.slots.length && g.slots.every((s) => st.known.has(s)) ? checkOf() : null);
        if (f && (!best || f.cost < best.f.cost)) best = { g, f };
      }
      if (!best) {
        // Equations left with several unknowns are solved together, as
        // relate.ts hands them to the solver as a block.
        // Fewest unknowns first, so the solver can start on one it can
        // undo (in polar, length · length = x² + y² before 0 = length ·
        // cos(angle), which on its own splits).
        const unknowns = (g: Goal) => new Set(g.slots.filter((x) => !st.known.has(x))).size;
        const eqs = st.goals.filter((g) => g.numeric).map((g, i) => ({ g, i, u: unknowns(g) })).sort((a, b) => a.u - b.u || a.i - b.i).map((e) => e.g);
        if (!eqs.length) break;
        st.goals = st.goals.filter((g) => !g.numeric);
        for (const g of eqs) for (const s of g.slots) st.known.add(s);
        st.answers = both(st.answers, MANY);
        st.dynamic.push(`equations solved together: ${eqs.map((g) => g.text).join(", ")}`);
        st.order.push("equations together");
        steps.push(...eqs.map((g) => g.exec));
        st.soft = true;
        continue;
      }
      const { g, f } = best;
      st.goals = st.goals.filter((x) => x !== g);
      st.order.push(g.text);
      // A choice goes after the constraints on what it gives: cutting text
      // after a number can only cut where a number ends.
      // So do the constraints on those, all the way down.
      if (f.answers.many && !f.branches) {
        const near = new Set(f.gives);
        for (let grew = true; grew;) {
          grew = false;
          for (const x of st.goals) {
            if (!x.posts || x === g || st.posted?.has(x) || !x.slots.some((sl) => near.has(sl))) continue;
            (st.posted ??= new Set()).add(x);
            x.slots.forEach((sl) => near.add(sl));
            steps.push(x.exec);
            grew = true;
          }
        }
      }
      if (!f.branches && !st.posted?.has(g)) steps.push(st.soft && !g.numeric ? { ...(f.exec ?? g.exec), waits: true } : f.exec ?? g.exec);
      f.chosen?.();
      for (const s of f.gives) st.known.add(s);
      for (const [s, z] of f.sizes ?? []) st.sizes.set(s, mergeSize(st.sizes.get(s), z));
      st.answers = both(st.answers, f.answers);
      if (!f.ends) { st.ends = false; st.loops.push(f.why ?? g.text); }
      if (f.dynamic) st.dynamic.push(f.dynamic);
      if (f.branches) {
        const out = f.branches.map((b) => {
          const sub: St = { soft: st.soft, posted: new Set(st.posted), known: new Set(st.known), sizes: new Map(st.sizes), goals: [...b.goals, ...st.goals], answers: st.answers, ends: st.ends, loops: [...st.loops], dynamic: [...st.dynamic], order: [...st.order, b.text] };
          for (const s of b.gives) sub.known.add(s);
          for (const [s, z] of b.sizes) sub.sizes.set(s, mergeSize(sub.sizes.get(s), z));
          return run(sub, need, ctx);
        });
        const live = out.filter((v) => !v.stuck.length);
        const answers = live.reduce<Answers>((a, v) => ({ fail: a.fail && v.answers.fail, many: a.many || v.answers.many }), { fail: true, many: false });
        if (!f.exclusive && !f.disjoint && live.length > 1) answers.many = true;
        if (f.disjoint) answers.fail = true;
        if (f.exclusive) answers.fail = live.some((v) => v.answers.fail) || live.length < out.length;
        return {
          answers: live.length ? answers : CHECK,
          ends: out.every((v) => v.ends),
          loops: [...new Set(out.flatMap((v) => v.loops))],
          // Stuck only when every arm is: an arm that's stuck gives no
          // answers, which the others may still give.
          stuck: live.length ? [] : [...new Set(out.flatMap((v) => v.stuck))],
          dynamic: [...new Set(out.flatMap((v) => v.dynamic))],
          order: (live[0] ?? out[0]).order,
          plan: { steps, branch: { ...f.at!, exclusive: !!f.exclusive, arms: f.branches.map((b, i) => ({ variant: b.variant, binds: b.binds, plan: out[i].plan })) } },
        };
      }
    }
    const stuck = [...st.goals.map((g) => g.text), ...need.filter((s) => !st.known.has(s)).map((s) => `nothing gives ${describe(s)}`)];
    // Goals left wait, in the order they're written: relate.ts runs each
    // once what it needs is known, and an answer that leaves one waiting
    // isn't pinned down.
    steps.push(...st.goals.map((g): Exec => ({ ...g.exec, waits: true })));
    return { answers: st.answers, ends: st.ends, loops: st.loops, stuck, dynamic: st.dynamic, order: st.order, plan: { steps } };
  }

  function mergeSize(a: Size | undefined, b: Size): Size {
    const out = new Map(a ?? []);
    for (const [p, s] of b) out.set(p, s || (out.get(p) ?? false));
    return out;
  }

  // A goal run once everything it touches is known: a check.
  const checkOf = (): Firing => ({ gives: [], answers: CHECK, ends: true, cost: 0 });

  const describe = (s: Id) => {
    const n = nodes[s];
    return n?.kind === "binder" ? nm(s) : n?.kind === "call" ? `the value of a call of ${describeFn(n.fn)}` : `a ${n?.kind ?? "value"}`;
  };
  const describeFn = (id: Id): string => { const n = nodes[id]; return n?.kind === "ref" ? nm(n.target) : n?.kind ?? id; };

  // ----------------------------------------------------------- goals

  // The goals of an expression, not going into arms (they're added when
  // their arm is chosen) or into lambdas that aren't lets (they run when
  // called).
  function goalsOf(root: Id, ctx: Ctx): Goal[] {
    const out: Goal[] = [];
    // A node can be in the tree twice (the same call written once, used
    // twice): it's one goal.
    const seen = new Set<Id>();
    const walk = (id: Id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const n = nodes[id];
      switch (n.kind) {
        case "lit": out.push(given(id, `${JSON.stringify(n.value)}`)); return;
        case "ref": {
          const t = nodes[n.target];
          if (t.kind !== "binder") out.push(given(id, nm(n.target)));
          return;
        }
        case "lambda": out.push(closure(id)); return;
        case "hole": out.push({ text: "a hole", slots: [slot(id)], exec: { k: "hole", node: id }, ready: () => null }); return;
        case "call":
          if (isLet(n)) { n.args.forEach(walk); walk((nodes[n.fn] as NodeOf<"lambda">).body); return; }
          if (nodes[n.fn].kind !== "ref" && nodes[n.fn].kind !== "lambda") walk(n.fn);
          else if (nodes[n.fn].kind === "lambda") walk(n.fn);
          n.args.forEach(walk);
          out.push(callGoal(n, ctx));
          return;
        case "match": walk(n.scrutinee); out.push(matchGoal(n, ctx)); return;
        case "fold": walk(n.scrutinee); out.push(foldGoal(n, ctx)); return;
        case "solve": {
          Object.values(n.given).forEach(walk);
          out.push(solveGoal(n, ctx), sameValue(n.body, n.id));
          walk(n.body);
          return;
        }
        default: for (const c of children(n)) walk(c);
      }
    };
    walk(root);
    return out;
  }

  // A literal or a reference to something defined: known from the start.
  const given = (id: Id, text: string): Goal => ({
    text, slots: [slot(id)], exec: { k: "given", node: id },
    ready: (st) => ({ gives: st.known.has(slot(id)) ? [] : [slot(id)], answers: st.known.has(slot(id)) ? CHECK : ONE, ends: true, cost: -1 }),
  });

  // A lambda's value is known once what it uses from outside is.
  const closure = (id: Id): Goal => ({
    text: "a function written here", slots: [slot(id)], exec: { k: "closure", node: id },
    ready: (st) => (st.known.has(slot(id)) ? { gives: [], answers: ONE, ends: true, cost: -1 }
      : free(id).every((b) => st.known.has(b)) ? { gives: [slot(id)], answers: ONE, ends: true, cost: -1 } : null),
  });

  // A goal over sides (inputs, then the value), from a list of ways to run
  // it: what each way needs known, and what it gives.
  interface Way { needs: number[]; gives: number[]; answers: Answers; ends?: boolean; why?: string; dynamic?: string; sizes?: (sides: Id[], st: St) => [Id, Size][]; cost?: number }
  function sided(text: string, sides: Id[], exec: Exec, ways: Way[], extra: Partial<Goal> = {}): Goal {
    const ss = sides.map(slot);
    return {
      text, slots: ss, exec,
      ready: (st) => {
        for (const w of ways) {
          if (!w.needs.every((i) => st.known.has(ss[i]))) continue;
          const gives = w.gives.map((i) => ss[i]).filter((s) => !st.known.has(s));
          // Everything known already: a check, which may still match more
          // than once (one of a list with the item in it twice). A check
          // goes before anything else that's ready, so it cuts a branch
          // before calls in it run: in fib's arm where n isn't 1 or 2, the
          // check n ≠ 2 is waiting when a guess makes n 2 (BACKLOG L82).
          if (!gives.length) {
            if (ss.every((s) => st.known.has(s))) return { gives: [], answers: { fail: true, many: w.answers.many }, ends: true, cost: w.answers.many ? 0 : -2 };
            continue;
          }
          const answers = w.answers;
          return {
            gives, answers, ends: w.ends ?? true, why: w.why, dynamic: w.dynamic, sizes: w.sizes?.(ss, st),
            cost: w.cost ?? (answers.many ? 3 : answers.fail ? 0 : 0) + (w.ends === false ? 10 : 0) + (w.dynamic ? 20 : 0),
          };
        }
        return null;
      },
      ...extra,
    };
  }

  // Each side given is no bigger than the known side `from` (strictly
  // smaller when `strictly`).
  const within = (from: number, to: number[], strictly: (sides: Id[]) => boolean[] = () => to.map(() => false)) =>
    (ss: Id[], st: St): [Id, Size][] => { const s = strictly(ss); return to.map((i, k) => [ss[i], s[k] ? strict(st.sizes.get(ss[from])) : same(st.sizes.get(ss[from]))]); };

  function callGoal(n: NodeOf<"call">, ctx: Ctx): Goal {
    const sides = [...n.args, n.id];
    const o = n.args.length;
    const all = n.args.map((_, i) => i);
    const fn = fnAt(n.fn, ctx);
    const text = `${fn ? (fn.k === "lambda" ? "a function written here" : nm(fn.id)) : "a function"}(${n.args.length ? "…" : ""})`;
    const call: Exec = { k: "call", node: n.id };
    if (!fn) {
      // A function only known when the program runs.
      return sided(text, [n.fn, ...sides], call, [
        { needs: [0, ...all.map((i) => i + 1)], gives: [o + 1], answers: ONE, dynamic: "a call of a function only known when it runs" },
        { needs: [0, o + 1], gives: all.map((i) => i + 1), answers: MANY, ends: false, why: "a call of a function only known when it runs, backwards", dynamic: "a call of a function only known when it runs" },
      ]);
    }
    if (fn.k === "variant") {
      // Taken apart, a known value is this variant or not, unless its type
      // has no other: then it always is (a Pair, a record).
      const only = variantsOf(fn.id).length === 1;
      return sided(text, sides, call, [
        { needs: all, gives: [o], answers: ONE },
        { needs: [o], gives: all, answers: only ? ONE : CHECK, sizes: within(o, all, () => all.map(() => true)) },
      ]);
    }
    if (fn.k === "field") {
      const v = (nodes[owner.get(fn.id)!] as NodeOf<"def">);
      const one = (nodes[v.body!] as NodeOf<"typedef">).variants.length === 1 && fieldCount((nodes[v.body!] as NodeOf<"typedef">).variants[0]) === 1;
      return sided(text, sides, call, [
        { needs: [0], gives: [1], answers: ONE, sizes: within(0, [1], () => [true]) },
        ...(one ? [{ needs: [1], gives: [0], answers: ONE }] : []),
      ]);
    }
    if (fn.k === "builtin") return builtinGoal(fn.id, text, n, sides, ctx);
    // A definition or a lambda: its own mode, with what's known here.
    return {
      text, slots: sides.map(slot), exec: call,
      ready: (st) => {
        const ss = sides.map(slot);
        const known = new Set<string>(ss.flatMap((s, i) => (st.known.has(s) ? [i === o ? "out" : String(i)] : [])));
        if (known.size === ss.length || !known.size && o > 0) return null;
        const spec = new Map<number, Fn>();
        n.args.forEach((a, i) => { const f = fnAt(a, ctx); if (f) spec.set(i, f); });
        const v = mode(fn, known, spec);
        if (v.stuck.length) return null;
        // The size-change graph of this call, from the caller's measured
        // ports to the callee's known ones.
        const calleeKey = keyOf(fn, known, spec);
        const chosen = () => {
          if (!calleeKey) return;
          const arcs: Arc[] = [];
          ss.forEach((s, j) => {
            if (!st.known.has(s)) return;
            for (const [p, strictly] of st.sizes.get(s) ?? []) {
              const i = ctx.ports.indexOf(p);
              if (i >= 0) arcs.push([i, j, strictly]);
            }
          });
          if (!plansOnly) graphs.push({ from: ctx.key, to: calleeKey, arcs });
        };
        return {
          // A call that makes an input up and may not end doing it (a
          // recursion guessing what it isn't given) waits in relate.ts
          // until its inputs or its value are known instead.
          chosen, exec: { k: "call", node: n.id, callee: { known: [...known], spec: [...spec] }, ...(!known.has("out") && known.size < o && !v.ends ? { waits: true as const } : {}) },
          gives: ss.filter((s) => !st.known.has(s)), answers: v.answers, ends: v.ends, why: v.loops[0],
          // With its result unknown and an input unknown too, the call
          // makes that input up: only when nothing else can run (relate.ts
          // computes a call's inputs before it, for the same reason).
          dynamic: v.dynamic[0], cost: (v.answers.many ? 3 : 0) + (v.ends ? 0 : 10) + (v.dynamic.length ? 20 : 0) + (known.has("out") ? 1 : known.size < o ? 25 : 0),
        };
      },
    };
  }

  function keyOf(f: Fn, known: Set<string>, spec: Map<number, Fn>): string | null {
    const lam = f.k === "lambda" ? f.id : f.k === "def" ? (nodes[(nodes[f.id] as NodeOf<"def">).body!]?.kind === "lambda" ? (nodes[f.id] as NodeOf<"def">).body! : null) : null;
    return lam ? `${lam}|${[...known].sort().join(",")}|${[...spec].map(([i, g]) => `${i}=${fnKey(g)}`).sort().join(",")}` : null;
  }

  function builtinGoal(id: Id, text: string, n: NodeOf<"call">, sides: Id[], ctx: Ctx): Goal {
    const o = n.args.length;
    const ins = n.args.map((_, i) => i);
    const call: Exec = { k: "call", node: n.id };
    const forward: Way = { needs: ins, gives: [o], answers: STD_MANY[id] ? MANY : ONE };
    if (NUMERIC[id]) {
      const op = NUMERIC[id];
      const exact = op === "add" || op === "sub" || op === "neg";
      const ways: Way[] = [forward];
      // Any side from the others: one answer for + and −, at most one for
      // × and ÷ (a zero), several for the rest (both square roots, every
      // 2πk, cut off at 64 in relate.ts).
      for (let i = 0; i < o; i++) ways.push({ needs: [...ins.filter((j) => j !== i), o], gives: [i], answers: exact ? ONE : op === "mul" || op === "div" ? CHECK : MANY });
      return sided(text, sides, call, ways, { numeric: true });
    }
    const fnArg = (i: number) => fnAt(n.args[i], ctx);
    const forwardOf = (i: number): Way => {
      // first, all, count and optional run their action forward.
      const f = fnArg(i);
      const v = f ? mode(f, new Set(), new Map()) : null;
      return { needs: ins, gives: [o], answers: ONE, ends: v ? v.ends && !v.stuck.length : false, why: v ? v.loops[0] : "an action only known when it runs", dynamic: v ? v.dynamic[0] : "an action only known when it runs" };
    };
    switch (id) {
      case S.concat: {
        const lit = (i: number) => nonEmptyText(n.args[i]);
        return sided(text, sides, call, [
          forward,
          { needs: [0, 2], gives: [1], answers: CHECK, sizes: within(2, [1], () => [lit(0)]) },
          { needs: [1, 2], gives: [0], answers: CHECK, sizes: within(2, [0], () => [lit(1)]) },
          { needs: [2], gives: [0, 1], answers: MANY, sizes: within(2, [0, 1], () => [lit(1), lit(0)]) },
        ], { posts: true });
      }
      case S.show: return sided(text, sides, call, [forward, { needs: [1], gives: [0], answers: CHECK }], { posts: true });
      case S.less: return sided(text, sides, call, [forward]);
      case S.equal: return sided(text, sides, call, [forward, { needs: [0, 2], gives: [1], answers: CHECK }, { needs: [1, 2], gives: [0], answers: CHECK }]);
      case S.and: case S.hence: case S.or: case S.not: return sided(text, sides, call, [forward, { needs: [o], gives: ins, answers: MANY }]);
      case S.oneOf: return sided(text, sides, call, [{ needs: [0], gives: [1], answers: MANY, sizes: within(0, [1], () => [true]) }]);
      case S.fail: return { text, slots: [slot(n.id)], exec: call, ready: (st) => ({ gives: st.known.has(slot(n.id)) ? [] : [slot(n.id)], answers: { fail: true, many: false }, ends: true, cost: 0 }) };
      case S.first: case S.all: case S.count: case S.optional: return sided(text, sides, call, [forwardOf(0)]);
      case S.fuel: return sided(text, sides, call, [{ needs: ins, gives: [o], answers: MANY }]);
      case S.exists: {
        const f = fnArg(0);
        const v = f ? mode(f, new Set(["out"]), new Map()) : null;
        return sided(text, sides, call, [{ needs: [0], gives: [o], answers: MANY, ends: v?.ends ?? false, why: v?.loops[0] ?? "for some of a function only known when it runs" }]);
      }
    }
    if (id === INT_OPS.add || id === INT_OPS.sub || id === INT_OPS.neg) {
      const all = [...ins, o];
      return sided(text, sides, call, all.map((i) => ({ needs: all.filter((j) => j !== i), gives: [i], answers: ONE })));
    }
    if (id === TEXT_OPS.split) return sided(text, sides, call, [forward, { needs: [1, 2], gives: [0], answers: CHECK }]);
    if (id === SET || STD_IMPL[id] || STD_MANY[id]) return sided(text, sides, call, [forward]);
    return sided(text, sides, call, [forward]);
  }

  // A case taken apart: the value examined and the arm's fields. Known
  // value: the fields, each smaller. Known fields: the value.
  function caseGoal(value: Id, variant: Id, binds: Id[], text: string): Goal {
    const sides = [...binds, value];
    const o = binds.length;
    return sided(text, sides, { k: "case", value, variant, binds }, [
      { needs: [o], gives: binds.map((_, i) => i), answers: ONE, sizes: within(o, binds.map((_, i) => i), () => binds.map(() => true)), cost: -1 },
      { needs: binds.map((_, i) => i), gives: [o], answers: ONE, cost: -1 },
    ]);
  }

  // An arm chosen by the value examined: its fields are known, each
  // smaller than the value. Chosen by the result, the case is a goal.
  const taken = (exclusive: boolean, v: Id, binds: Id[], st: St): { gives: Id[]; sizes: [Id, Size][] } =>
    exclusive ? { gives: binds.map(slot), sizes: binds.map((b): [Id, Size] => [slot(b), strict(st.sizes.get(v))]) } : { gives: [], sizes: [] };

  // The cases a value can be built with, seen from the node that makes it,
  // or null when that can't be told: a case applied, a match or a let
  // that ends in one, or `fail`, which builds nothing.
  function heads(id: Id): Set<Id> | null {
    const n = nodes[id];
    if (n?.kind === "ref") return nodes[n.target]?.kind === "variant" ? new Set([n.target]) : null;
    if (n?.kind === "call") {
      if (isLet(n)) return heads((nodes[n.fn] as NodeOf<"lambda">).body);
      const f = nodes[n.fn];
      if (f?.kind !== "ref") return null;
      if (f.target === S.fail) return new Set();
      return nodes[f.target]?.kind === "variant" ? new Set([f.target]) : null;
    }
    if (n?.kind === "match") {
      const all = [...n.arms.map((a) => (nodes[a] as NodeOf<"arm">).body), ...(n.otherwise ? [n.otherwise] : [])].map(heads);
      return all.some((h) => !h) ? null : new Set(all.flatMap((h) => [...h!]));
    }
    return null;
  }
  const disjoint = (bodies: Id[]) => {
    const hs = bodies.map(heads), seen = new Set<Id>();
    for (const h of hs) for (const v of h ?? [""]) { if (!h || seen.has(v)) return false; seen.add(v); }
    return true;
  };

  // A match is a choice of arms. With the value examined known, exactly
  // one arm runs; with the result known, each arm is tried, and when no
  // two build it with the same case at most one gives it (Haar's split
  // run backwards: an empty list or a pair at the front). Mercury's
  // determinism analysis does the same for a switch on an output.
  function matchGoal(n: NodeOf<"match">, ctx: Ctx): Goal {
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const others = arms.length && n.otherwise ? variantsOf(arms[0].variant).filter((v) => !arms.some((a) => a.variant === v)) : [];
    const v = slot(n.scrutinee), out = slot(n.id);
    return {
      text: "match", slots: [v, out], exec: { k: "same", a: n.id, b: n.id },
      ready: (st) => {
        const exclusive = st.known.has(v);
        // Neither the value examined nor the result known: relate.ts tries
        // each case anyway, so this is the last thing to do.
        const guess = !exclusive && !st.known.has(out);
        const branches: Branch[] = [
          ...arms.map((arm) => ({
            text: `arm ${nm(arm.variant)}`, variant: arm.variant, binds: arm.binds,
            goals: [...(exclusive ? [] : [caseGoal(n.scrutinee, arm.variant, arm.binds, `case ${nm(arm.variant)}`)]), ...goalsOf(arm.body, ctx), sameValue(arm.body, n.id)],
            ...taken(exclusive, v, arm.binds, st),
          })),
          ...(n.otherwise ? [{
            text: "otherwise", variant: null, binds: [],
            // The value is some other case: its fields aren't known here.
            goals: [...goalsOf(n.otherwise, ctx), sameValue(n.otherwise, n.id), ...(others.every((o) => fieldCount(o) === 0) && others.length === 1 ? [] : [])],
            gives: others.length === 1 && fieldCount(others[0]) === 0 ? [v] : [], sizes: [],
          }] : []),
        ];
        const one = !exclusive && st.known.has(out) && disjoint([...arms.map((a) => a.body), ...(n.otherwise ? [n.otherwise] : [])]);
        return { gives: [], answers: ONE, ends: true, branches, exclusive, disjoint: one, at: { node: n.id, value: v, out }, cost: exclusive ? 1 : guess ? 30 : 4 };
      },
    };
  }

  // Two slots that are one value (an arm's body is the match's value).
  const sameValue = (a: Id, b: Id): Goal => sided("", [a, b], { k: "same", a, b }, [
    { needs: [0], gives: [1], answers: ONE, sizes: within(0, [1]), cost: -1 },
    { needs: [1], gives: [0], answers: ONE, sizes: within(1, [0]), cost: -1 },
  ]);

  // A fold: a choice of arms, as a match, where each recursive part's
  // folded value is the fold again, one level down. Run backwards (the
  // result known) it unfolds, which ends when each recursive part's folded
  // value is smaller than the result it came from.
  // v and out are the slots of the value folded and the result: the
  // fold's own, or (one level down) a part and its folded value.
  function foldGoal(n: NodeOf<"fold">, ctx: Ctx, v = slot(n.scrutinee), out = slot(n.id)): Goal {
    const measure = `fold:${n.id}`;
    return {
      text: "fold", slots: [v, out], exec: { k: "same", a: n.id, b: n.id },
      ready: (st) => {
        const exclusive = st.known.has(v);
        const guess = !exclusive && !st.known.has(out);
        const sizes: [Id, Size][] = exclusive ? [] : [[out, mergeSize(st.sizes.get(out), new Map([[measure, false]]))]];
        const branches: Branch[] = n.arms.map((a) => {
          const arm = nodes[a] as NodeOf<"arm">;
          const outside = free(n.id).filter((b) => st.known.has(b));
          const children: Goal[] = arm.results.flatMap((r, i) => (r ? [unfold(n, ctx, outside, arm.variant, i, r, measure)] : []));
          const t = taken(exclusive, v, arm.binds, st);
          return {
            text: `arm ${nm(arm.variant)}`, variant: arm.variant, binds: arm.binds,
            goals: [...(exclusive ? [] : [caseGoal(v, arm.variant, arm.binds, `case ${nm(arm.variant)}`)]), ...goalsOf(arm.body, ctx), sameValue(arm.body, out), ...children],
            gives: t.gives, sizes: [...sizes, ...t.sizes],
          };
        });
        const at = { node: n.id, value: v, out };
        if (guess) return { gives: [], answers: ONE, ends: false, why: `a fold over ${describe(v)}, which nothing gives, unfolded case by case`, branches, at, cost: 30 };
        return { gives: [], answers: ONE, ends: true, branches, exclusive, at, cost: exclusive ? 1 : 4 };
      },
    };
  }

  // A recursive part and its folded value: the fold one level down.
  // Forward (the part known) it ends, the part being smaller; backwards
  // (the folded value known) only if that value is smaller than the result.
  // outside: the slots from outside the fold known when it was chosen,
  // which one level down are known too.
  const unfold = (n: NodeOf<"fold">, ctx: Ctx, outside: Id[], variant: Id, index: number, result: Id, measure: Port): Goal => {
    const arm = nodes[n.arms.find((a) => (nodes[a] as NodeOf<"arm">).variant === variant)!] as NodeOf<"arm">;
    const part = arm.binds[index];
    const p = slot(part), r = slot(result);
    const exec = (has: "part" | "result" | "neither"): Exec => ({ k: "unfold", fold: n.id, variant, index, part, result, plan: () => foldPlan(n, ctx, outside, has) });
    return {
      text: `fold the rest of a ${nm(variant)}`, slots: [p, r], exec: exec("neither"),
      ready(st) {
        if (st.known.has(p) && !st.known.has(r)) return { gives: [r], answers: ONE, ends: true, exec: exec("part"), cost: 1 };
        if (st.known.has(r) && !st.known.has(p)) {
          const shrinks = st.sizes.get(r)?.get(measure) === true;
          return { gives: [p], answers: ONE, ends: shrinks, why: shrinks ? undefined : `a fold run backwards from ${describe(r)}, which isn't smaller each time`, sizes: [[p, same(st.sizes.get(r))]], exec: exec("result"), cost: shrinks ? 2 : 12 };
        }
        // Neither: it unfolds by guessing, as the fold above it did.
        if (!st.known.has(p) && !st.known.has(r)) return { gives: [], answers: MANY, ends: false, why: `a fold over ${describe(p)}, which nothing gives, unfolded case by case`, cost: 30 };
        return null;
      },
    };
  };

  // The plan for a fold one level down: its value folded and its result
  // are slots of their own, and what came from outside is as it was.
  const foldPlans = new Map<string, Plan>();
  function foldPlan(n: NodeOf<"fold">, ctx: Ctx, outside: Id[], has: "part" | "result" | "neither"): Plan {
    const key = `${n.id}|${has}|${ctx.key}|${[...outside].sort().join(",")}`;
    const hit = foldPlans.get(key);
    if (hit) return hit;
    const part = `${n.id}#part`, out = `${n.id}#out`;
    const st: St = { known: new Set(outside), sizes: new Map(), goals: [foldGoal(n, ctx, part, out)], answers: ONE, ends: true, loops: [], dynamic: [], order: [] };
    if (has === "part") st.known.add(part);
    if (has === "result") st.known.add(out);
    const { plan } = run(st, [], ctx);
    foldPlans.set(key, plan);
    return plan;
  }

  // A solve inside: the function in the mode it names.
  function solveGoal(n: NodeOf<"solve">, ctx: Ctx): Goal {
    const givenSlots = Object.values(n.given).map(slot);
    const bound = Object.values(n.binds).map(slot);
    return {
      text: `solve ${nm(n.fn)}`, slots: [...givenSlots, ...bound], exec: { k: "solve", node: n.id },
      ready: (st) => {
        if (!givenSlots.every((s) => st.known.has(s)) || bound.every((s) => st.known.has(s))) return null;
        const v = solveVerdict(n, ctx);
        if (!v || v.stuck.length) return null;
        const k = solveKey(n, ctx);
        const exec: Exec = { k: "solve", node: n.id, callee: k ? { known: [...k.known], spec: [...k.spec] } : undefined };
        return { gives: bound, answers: v.answers, ends: v.ends, why: v.loops[0], exec, cost: (v.answers.many ? 3 : 0) + (v.ends ? 0 : 10) };
      },
    };
  }

  function solveVerdict(n: NodeOf<"solve">, ctx?: Ctx): Verdict | null {
    // Equations the solver plans before running: its plan says how many
    // answers, and its search ends (solve.ts).
    let plan: SolvePlan | null = null;
    try { plan = planSolve(code, n); } catch { return null; }
    if (plan.mode === "solver") return { answers: { fail: plan.canFail, many: plan.many }, ends: true, loops: [], stuck: [], dynamic: [], order: [], plan: NO_PLAN };
    if (nodes[n.fn].kind !== "def") return { answers: MANY, ends: true, loops: [], stuck: [], dynamic: [], order: [], plan: NO_PLAN };
    const k = solveKey(n, ctx);
    return k && mode({ k: "def", id: n.fn }, k.known, k.spec);
  }

  // The mode a solve node names: its given ports, and the functions given.
  function solveKey(n: NodeOf<"solve">, ctx?: Ctx): { known: Set<string>; spec: Map<number, Fn> } | null {
    const f = nodes[n.fn];
    const lam = f.kind === "def" ? nodes[f.body!] : null;
    if (lam?.kind !== "lambda") return null;
    const known = new Set<string>(Object.keys(n.given).map((p) => (p === "out" ? "out" : String(lam.params.indexOf(p)))));
    const spec = new Map<number, Fn>();
    for (const [p, e] of Object.entries(n.given)) {
      if (p === "out") continue;
      const g = fnAt(e, ctx ?? { key: "", ports: [], fns: new Map(), def: null });
      if (g) spec.set(lam.params.indexOf(p), g);
    }
    return { known, spec };
  }

  // ----------------------------------------------------------- ending

  // Size-change: every composed graph from a mode back to itself that's
  // its own square needs a port that strictly shrinks around it.
  // from: only the call graphs reachable from this mode.
  function terminates(from?: string): { ok: boolean; at: string[] } {
    const norm = (g: Graph): Graph => {
      const best = new Map<string, Arc>();
      for (const [i, j, s] of g.arcs) { const k = `${i},${j}`; best.set(k, [i, j, s || (best.get(k)?.[2] ?? false)]); }
      return { from: g.from, to: g.to, arcs: [...best.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
    };
    const key = (g: Graph) => `${g.from}\u0000${g.to}\u0000${g.arcs.map((a) => a.join(",")).join(";")}`;
    const compose = (g: Graph, h: Graph) => norm({ from: g.from, to: h.to, arcs: g.arcs.flatMap(([i, j, s1]) => h.arcs.filter(([k]) => k === j).map(([, l, s2]): Arc => [i, l, s1 || s2])) });
    const all = new Map<string, Graph>();
    let todo = graphs.map(norm);
    if (from) {
      const reach = new Set([from]);
      for (let grew = true; grew;) { grew = false; for (const g of todo) if (reach.has(g.from) && !reach.has(g.to)) { reach.add(g.to); grew = true; } }
      todo = todo.filter((g) => reach.has(g.from));
    }
    while (todo.length) {
      const g = todo.pop()!;
      const k = key(g);
      if (all.has(k)) continue;
      all.set(k, g);
      if (all.size > 4000) return { ok: false, at: ["too many call patterns to check"] };
      for (const h of [...all.values()]) {
        if (g.to === h.from) todo.push(compose(g, h));
        if (h.to === g.from) todo.push(compose(h, g));
      }
    }
    const bad = [...all.values()].filter((g) => g.from === g.to && key(compose(g, g)) === key(g) && !g.arcs.some(([i, j, s]) => i === j && s));
    return { ok: !bad.length, at: [...new Set(bad.map((g) => g.from))] };
  }

  // A verdict with recursion checked: one mode of a function, or a solve
  // node's.
  function checked(get: () => { v: Verdict | null; key: string | null }): Verdict | null {
    graphs.length = 0;
    memo.clear();
    const { v, key } = get();
    if (!v) return null;
    if (!key) return v;
    const t = terminates(key);
    if (t.ok) return v;
    const name = (k: string) => { const lam = k.split("|")[0]; const d = code.defs.find((d) => (nodes[d] as NodeOf<"def">).body === lam); return d ? nm(d) : "a function"; };
    return { ...v, ends: false, loops: [...v.loops, ...t.at.map((k) => `${name(k)} calls itself on something that isn't smaller`)] };
  }
  const ofSolve = (n: NodeOf<"solve">) => checked(() => {
    const v = solveVerdict(n);
    const s = solveKey(n);
    return { v, key: s && keyOf({ k: "def", id: n.fn }, s.known, s.spec) };
  });
  // known: parameter positions as "0", "1", …, and "out".
  const ofMode = (def: Id, known: string[], spec: Map<number, Fn> = new Map()) =>
    checked(() => ({ v: mode({ k: "def", id: def }, new Set(known), spec), key: keyOf({ k: "def", id: def }, new Set(known), spec) }))!;

  // The plan relate.ts runs for a function in a mode, and for a value
  // defined once (with its result known or not).
  const planOf = (f: Fn, m: Mode): Plan => { fresh(f.id); return mode(f, new Set(m.known), new Map(m.spec)).plan; };
  const planOfValue = (def: Id, known: boolean): Plan =>
    lambdaMode((nodes[def] as NodeOf<"def">).body!, new Set(known ? ["out"] : []), new Map(), def).plan;

  return { ofSolve, ofMode, planOf, planOfValue, slot, isLet, fresh };
}

// The verdict for one solve node, or null when it isn't run by the
// relational interpreter's kind of search (a builtin's own equation).
// Kept per program (and names, which only the messages use): the palette
// asks it for each filling twice, for the plan and for the type check, and
// each time it would build the analyzer over the whole program again.
const NO_NAMES: Record<Id, string> = {};
const verdicts = new WeakMap<Code, WeakMap<Record<Id, string>, Map<Id, Verdict | null>>>();
export function solveMode(code: Code, n: NodeOf<"solve">, names: Record<Id, string> = NO_NAMES): Verdict | null {
  let byNames = verdicts.get(code);
  if (!byNames) verdicts.set(code, (byNames = new WeakMap()));
  const key = Object.keys(names).length ? names : NO_NAMES;
  let m = byNames.get(key);
  if (!m) byNames.set(key, (m = new Map()));
  if (!m.has(n.id)) m.set(n.id, analyzer(code, names).ofSolve(n));
  return m.get(n.id)!;
}

// Does this solve always give exactly one answer, so its type has no
// Choice (MODES.md, L11d)? The equation solver's unique directions, and a
// relational mode that's det and ends: one answer, found in finite time.
const single = new WeakMap<Code, Map<Id, boolean>>();
export function oneAnswer(code: Code, n: NodeOf<"solve">): boolean {
  let m = single.get(code);
  if (!m) single.set(code, (m = new Map()));
  if (!m.has(n.id)) {
    const p = planSolve(code, n);
    const v = p.mode === "relational" ? solveMode(code, n) : null;
    m.set(n.id, computedForward(code, n) || (v ? !v.stuck.length && v.ends && determinism(v.answers) === "det" : p.unique));
  }
  return m.get(n.id)!;
}

// In words, as the editor will say it.
export function describeVerdict(v: Verdict): string {
  if (v.stuck.length) return `can't be run this way: ${v.stuck[0]}`;
  const many = { det: "exactly one answer", semidet: "at most one answer", multi: "at least one answer", nondet: "any number of answers" }[determinism(v.answers)];
  return v.ends ? `ends, ${many}` : `may not end (${v.loops[0]}), ${many}`;
}

