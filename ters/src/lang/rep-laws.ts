// A representation's laws (REPRESENTATIONS.md step 4, BACKLOG L108d): each
// job a representation R of T does agrees with T's own through `meaning`.
// For a job f of T done at R by f′:
//
//   meaning(f′(x′, …)) = f(meaning(x′), …)    when f gives a T,
//   f′(x′, …)          = f(meaning(x′), …)    otherwise,
//
// for every input x′ an R value is built from. Inputs are small values,
// as in lab test (tests.ts): a T is built by T's own jobs that give one
// (zero, succ; nil, cons; empty map, put), each run twice, once at T and
// once at R, so both sides hold the same value and R's stays inside what
// R's jobs make (an Int representing Nat is never negative). A job taking
// a function (match, fold, update at) isn't tried: a function can't be
// picked as a small value. They are the definitions' law, the same one a
// T7 law states between two ways, checked by the evaluator like any test.
//
// Prior art: QuickCheck's (Claessen and Hughes, ICFP 2000) and
// SmallCheck's (Runciman, Naylor and Lindblad, 2008) small values; a
// representation's meaning as an abstraction function (Hoare, "Proof of
// correctness of data representations", 1972). CREDITS.md.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import type { Representation } from "./represent.ts";
import { equal, makeRunner, showValue, type Value } from "./run.ts";
import { smallValues } from "./tests.ts";
import type { Type } from "./types.ts";

export interface LawFailure { inputs: string[]; what: string }
export interface LawResult { rep: string; job: string; cases: number; failures: LawFailure[] }

const POOL = 24, ARGS = 4, CASES = 60;

export function representationLaws(code: Code, info: Info, names: Names, reps: Representation[]): LawResult[] {
  const r = makeRunner(code, info, { print: () => {}, names });
  const first = (xs: Iterable<Value>) => { for (const x of xs) return x; throw new Error("no answer"); };
  // A job with no inputs (zero, nil) is a value.
  const call = (fn: Id, args: Value[]): Value => { const f = r.value(fn); return !args.length && typeof f !== "function" ? f : first(r.call(f, ...args) as Iterable<Value>); };
  const show = (v: Value) => showValue(v, code, names);
  const out: LawResult[] = [];
  for (const rep of reps) {
    if (!rep.meaning || rep.type === rep.of) continue;
    const isT = (t: Type) => t.t === "con" && t.id === rep.of;
    const typeOfJob = (job: Id): (Type & { t: "fn" }) | null => {
      const n = code.nodes[job];
      const t0 = n?.kind === "variant" ? constructorType(code, info, job) : info.typeOf.get(job);
      const t = t0 && info.subst.zonk(t0);
      // A job that is a value (empty map) takes nothing.
      return t?.t === "fn" ? t : t ? { t: "fn", params: [], ret: t, eff: { effs: [], tail: null } } : null;
    };
    const jobs = Object.entries(rep.impl).filter(([k]) => k !== "match" && k !== "fold")
      .flatMap(([k, at]) => { const t = typeOfJob(k); return t ? [{ k, at, t }] : []; });
    // Each job's plain inputs, a few small values each; null when one is a function.
    const plain = (t: Type) => { const vs = smallValues(t, code); return vs ? vs.slice(0, ARGS) : null; };
    const meaning = (x: Value) => call(rep.meaning!, [x]);

    // The pool: T values built by T's jobs that give one, at T and at R.
    const pool: { t: Value; r: Value; text: string }[] = [];
    const builders = jobs.filter((j) => isT(j.t.ret));
    for (let round = 0; round < 5 && pool.length < POOL; round++) {
      const before = [...pool];
      for (const j of builders) {
        const choices = j.t.params.map((p) => (isT(p) ? (before.length ? before : null) : plain(p)?.map((v) => ({ t: v, r: v, text: show(v) })) ?? null));
        if (choices.some((c) => !c || !c.length)) continue;
        for (const args of product(choices as { t: Value; r: Value; text: string }[][], 6)) {
          if (pool.length >= POOL) break;
          try {
            const t = call(j.k, args.map((a) => a.t)), rv = call(j.at, args.map((a) => a.r));
            const text = `${names[j.k] ?? j.k}(${args.map((a) => a.text).join(", ")})`;
            if (!pool.some((x) => equal(x.t, t))) pool.push({ t, r: rv, text });
          } catch { /* outside the job's inputs: not a value to build on */ }
        }
      }
    }

    for (const j of jobs) {
      const res: LawResult = { rep: rep.name, job: names[j.k] ?? j.k, cases: 0, failures: [] };
      const choices = j.t.params.map((p) => (isT(p) ? pool : plain(p)?.map((v) => ({ t: v, r: v, text: show(v) })) ?? null));
      if (choices.some((c) => !c || !c.length)) continue;
      for (const args of product(choices as { t: Value; r: Value; text: string }[][], CASES)) {
        let want: Value;
        try { want = call(j.k, args.map((a) => a.t)); } catch { continue; } // T's own job doesn't take these
        res.cases++;
        const inputs = args.map((a) => a.text);
        try {
          const got0 = call(j.at, args.map((a) => a.r));
          const got = isT(j.t.ret) ? meaning(got0) : got0;
          if (!equal(got, want)) res.failures.push({ inputs, what: `at ${rep.name} gives ${show(got)}, ${names[rep.of] ?? rep.of}'s own ${show(want)}` });
        } catch (e) {
          res.failures.push({ inputs, what: `at ${rep.name} stops: ${(e as Error).message}` });
        }
      }
      out.push(res);
    }
  }
  return out;
}

// A constructor's type: its fields to its type.
// A constructor's type: its fields to its type, the type's parameters
// left as variables (small values tries them at Int).
function constructorType(code: Code, info: Info, variant: Id): Type | undefined {
  const owner = info.owner.get(variant);
  if (!owner) return undefined;
  let v = 0;
  const vars = new Map<Id, Type>();
  const te = (id: Id): Type | undefined => {
    const n = code.nodes[id];
    if (n?.kind !== "tref") return undefined;
    if (code.nodes[n.target]?.kind === "binder") { if (!vars.has(n.target)) vars.set(n.target, { t: "var", v: -1 - v++ }); return vars.get(n.target); }
    const args = n.args.map(te);
    return args.every(Boolean) ? { t: "con", id: n.target, args: args as Type[] } : undefined;
  };
  const fields = (code.nodes[variant] as NodeOf<"variant">).fields.map((f) => te((code.nodes[f] as NodeOf<"field">).type));
  if (fields.some((f) => !f)) return undefined;
  return { t: "fn", params: fields as Type[], ret: { t: "con", id: owner, args: [] }, eff: { effs: [], tail: null } };
}

// Combinations of one choice per input, smallest first, at most `limit`.
function* product<T>(choices: T[][], limit: number): Generator<T[]> {
  let n = 0;
  const go = function* (i: number, acc: T[]): Generator<T[]> {
    if (n >= limit) return;
    if (i === choices.length) { n++; yield acc; return; }
    for (const c of choices[i]) { yield* go(i + 1, [...acc, c]); if (n >= limit) return; }
  };
  yield* go(0, []);
}
