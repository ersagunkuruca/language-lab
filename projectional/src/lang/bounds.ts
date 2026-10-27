// What a recursive function can return, as an interval, from what's known
// of its inputs: the stopping rule for a search run backwards (BACKLOG
// L83b, BACKWARDS.md "Why the fast version did worse").
//
// `fib3(a, b, k) = if k = 0 then a else fib3(b, a + b, k − 1)` asked for
// `fib3(13, 21, k) = 8` can't give 8: every call it makes has `a` at 13 or
// more, and what it returns is some call's `a`. The search can't see that
// by itself, so past fibFast's first answer it walked `a` upwards until its
// step budget ended. This reads the body as arithmetic on intervals
// instead of numbers:
//
// - The inputs of every call the function makes of itself are gathered
//   into one interval per parameter, starting from the call being asked
//   about: a hull of every call the recursion can reach.
// - What it returns is gathered the same way, a recursive call standing for
//   what has been gathered so far, starting from nothing (Kleene's
//   iteration).
// - A bound still moving after a few rounds jumps to infinity (widening),
//   so it ends. `a` goes 13, 13 to 21, 13 to 34, then 13 to ∞.
//
// When the answer asked for is outside what the function can return, the
// search drops that branch. The analysis only answers when it is sure: a
// match on data, a call of another function, text, or anything else it
// doesn't read makes the result "anything", and then nothing is dropped.
// Prior art: abstract interpretation over intervals with widening (Patrick
// and Radhia Cousot, "Abstract interpretation: a unified lattice model for
// static analysis of programs", POPL 1977).

import type { Code, Id, NodeOf } from "../model.ts";
import { B } from "../prelude.ts";
import { FALSE, INT_OPS, S, TRUE } from "./std.ts";
import { INT } from "./types.ts";

export interface Iv { lo: number; hi: number }
// An interval, a truth value (or either), "nothing yet" (no call has
// returned), or null: anything at all.
type AV = Iv | "true" | "false" | "bool" | "none" | null;

// Bounds are rounded outwards, so an interval holds every value the
// program can compute, a Float64 rounded its way or an Int too big for a
// double: one step past each end unless both ends are exact whole numbers.
const down = (x: number) => x - (Math.abs(x) * 2.3e-16 + Number.MIN_VALUE);
const up = (x: number) => x + (Math.abs(x) * 2.3e-16 + Number.MIN_VALUE);
const exact = (x: number) => Number.isSafeInteger(x) || !Number.isFinite(x);
function iv(lo: number, hi: number): AV {
  if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
  return { lo: exact(lo) ? lo : down(lo), hi: exact(hi) ? hi : up(hi) };
}
// What's known of a value: a Float64 is itself; an Int beyond 2^53 is the
// doubles around it.
export const around = (x: number | bigint): Iv => iv(Number(x), Number(x)) as Iv;
const isIv = (a: AV): a is Iv => typeof a === "object" && a !== null;
const isBool = (a: AV): a is "true" | "false" | "bool" => a === "true" || a === "false" || a === "bool";

function join(a: AV, b: AV): AV {
  if (a === "none") return b;
  if (b === "none") return a;
  if (isIv(a) && isIv(b)) return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
  if (isBool(a) && isBool(b)) return a === b ? a : "bool";
  return null;
}

// A bound that moved since the last round goes to infinity.
function widen(was: AV, now: AV): AV {
  if (!isIv(was) || !isIv(now)) return now;
  return { lo: now.lo < was.lo ? -Infinity : now.lo, hi: now.hi > was.hi ? Infinity : now.hi };
}

const same = (a: AV, b: AV) => (isIv(a) && isIv(b) ? a.lo === b.lo && a.hi === b.hi : a === b);

// Arithmetic on intervals. A NaN (0 · ∞, ∞ − ∞) means the bound is lost.
function arith(op: "add" | "sub" | "mul" | "neg" | "abs", xs: AV[]): AV {
  if (xs.some((x) => x === "none")) return "none";
  if (!xs.every(isIv)) return null;
  const [a, b] = xs as Iv[];
  switch (op) {
    case "add": return iv(a.lo + b.lo, a.hi + b.hi);
    case "sub": return iv(a.lo - b.hi, a.hi - b.lo);
    case "neg": return { lo: -a.hi, hi: -a.lo };
    case "abs": return a.lo >= 0 ? a : a.hi <= 0 ? { lo: -a.hi, hi: -a.lo } : { lo: 0, hi: Math.max(-a.lo, a.hi) };
    case "mul": {
      const ps = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
      return ps.some(Number.isNaN) ? null : iv(Math.min(...ps), Math.max(...ps));
    }
  }
}

const truth = (b: boolean | undefined): AV => (b === undefined ? "bool" : b ? "true" : "false");
function compare(op: "equal" | "less", a: AV, b: AV): AV {
  if (a === "none" || b === "none") return "none";
  if (op === "equal" && isBool(a) && isBool(b)) return a === "bool" || b === "bool" ? "bool" : truth(a === b);
  if (!isIv(a) || !isIv(b)) return "bool";
  if (op === "less") return truth(a.hi < b.lo ? true : a.lo >= b.hi ? false : undefined);
  // `=` on Float64 allows a gap of about 1e-9 (run.ts close), so two
  // intervals are unequal only when they are further apart than that at
  // their nearest ends.
  const apart = (x: number, y: number) => y - x > 1e-9 * (1 + Math.abs(x) + Math.abs(y));
  if (apart(a.hi, b.lo) || apart(b.hi, a.lo)) return "false";
  return truth(a.lo === a.hi && b.lo === b.hi && a.lo === b.lo ? true : undefined);
}
function logic(op: "and" | "or" | "not", xs: AV[]): AV {
  if (xs.some((x) => x === "none")) return "none";
  if (!xs.every(isBool)) return null;
  if (op === "not") return xs[0] === "bool" ? "bool" : xs[0] === "true" ? "false" : "true";
  const [a, b] = xs;
  if (op === "and") return a === "false" || b === "false" ? "false" : a === "true" && b === "true" ? "true" : "bool";
  return a === "true" || b === "true" ? "true" : a === "false" && b === "false" ? "false" : "bool";
}

const ARITH: Record<Id, "add" | "sub" | "mul" | "neg" | "abs"> = {
  [B.add]: "add", [B.sub]: "sub", [B.mul]: "mul", [B.neg]: "neg", [S.abs]: "abs",
  [INT_OPS.add]: "add", [INT_OPS.sub]: "sub", [INT_OPS.mul]: "mul", [INT_OPS.neg]: "neg", [INT_OPS.abs]: "abs",
};
const COMPARE: Record<Id, "equal" | "less"> = { [S.equal]: "equal", [S.less]: "less", [INT_OPS.less]: "less" };
const LOGIC: Record<Id, "and" | "or" | "not"> = { [S.and]: "and", [S.or]: "or", [S.not]: "not" };

const ROUNDS = 12, WIDEN_AFTER = 2;

// The interval a call of `lambda` (the body of a recursive definition) can
// return, given an interval for each argument (null: unknown) and for the
// variables it uses from outside. Null when it can't tell.
export function resultBounds(code: Code, lambda: Id, args: (Iv | null)[], outside: (binder: Id) => Iv | null = () => null): Iv | null {
  const nodes = code.nodes;
  const lam = nodes[lambda] as NodeOf<"lambda">;
  const self = code.defs.find((d) => (nodes[d] as NodeOf<"def">).body === lambda);
  if (!self) return null;
  let params: AV[] = args, result: AV = "none";
  for (let round = 0; round < ROUNDS; round++) {
    let gathered: AV[] = params;
    const env = new Map<Id, AV>(lam.params.map((p, i) => [p, params[i]]));
    const ev = (id: Id): AV => {
      const n = nodes[id];
      switch (n?.kind) {
        case "lit": {
          if (typeof n.value === "string" && n.of !== INT) return null;
          return around(typeof n.value === "string" ? BigInt(n.value) : n.value);
        }
        case "ref": {
          if (env.has(n.target)) return env.get(n.target)!;
          const t = nodes[n.target];
          if (t?.kind === "binder") return outside(n.target);
          if (n.target === TRUE) return "true";
          if (n.target === FALSE) return "false";
          return null;
        }
        case "call": {
          const f = nodes[n.fn];
          if (f?.kind === "lambda" && f.params.length === n.args.length) {
            f.params.forEach((p, i) => env.set(p, ev(n.args[i])));
            return ev(f.body);
          }
          const xs = n.args.map(ev);
          const target = f?.kind === "ref" ? f.target : n.fn;
          if (target === self) {
            gathered = gathered.map((g, i) => join(g, xs[i] ?? null));
            return result;
          }
          if (ARITH[target]) return arith(ARITH[target], xs);
          if (COMPARE[target]) return compare(COMPARE[target], xs[0], xs[1]);
          if (LOGIC[target]) return logic(LOGIC[target], xs);
          return null;
        }
        case "match": {
          const c = ev(n.scrutinee);
          if (c === "none") return "none";
          if (!isBool(c)) return null;
          let out: AV = "none";
          const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
          for (const v of [TRUE, FALSE]) {
            if (c !== "bool" && c !== (v === TRUE ? "true" : "false")) continue;
            const arm = arms.find((a) => a.variant === v);
            const body = arm ? arm.body : n.otherwise;
            if (!body) return null;
            out = join(out, ev(body));
          }
          return out;
        }
        default: return null;
      }
    };
    const r = ev(lam.body);
    let nextParams = gathered, nextResult = join(result, r);
    if (round >= WIDEN_AFTER) {
      nextParams = nextParams.map((p, i) => widen(params[i], p));
      nextResult = widen(result, nextResult);
    }
    if (nextResult === null) return null;
    if (nextParams.every((p, i) => same(p, params[i])) && same(nextResult, result)) return isIv(result) ? result : null;
    params = nextParams;
    result = nextResult;
  }
  return null;
}

// Can a value the function returns be `x`, to the language's tolerance for
// Float64 equality (run.ts sameNumber: about 1e-9 relative)?
export const within = (x: number, b: Iv): boolean => {
  const slack = 2e-9 * (1 + Math.abs(x));
  return x >= b.lo - slack && x <= b.hi + slack;
};
