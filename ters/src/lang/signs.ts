// What sign a Float64 can have where it is used (FLOAT-VALUES-2026-11-01.md,
// BACKLOG L125b). `x / y` has no answer when y is 0, `sqrt x` when x is
// negative, `log x` when x isn't positive: those are `Choice` in their
// types, and this drops the Choice at a call whose input is known to be
// fine. Nothing is written for it (no annotations, no hints): the facts
// come from the code itself, the way a reader sees them.
//
//   - a literal's own sign;
//   - a let's value, through the name;
//   - arithmetic: a sum of positives is positive, x · x and |x| are never
//     negative, eˣ and √ of a positive are positive, and so on;
//   - a branch: in the `else` of `if x = 0`, x isn't 0; in the `then` of
//     `if 0 < x`, x is positive (and `and`, `or`, `not` of such tests);
//   - a type's rule: a Rational's bottom is positive.
//
// A product of two nonzero floats can still underflow to 0; a divisor
// proved nonzero that underflows has no answer at run time all the same.
//
// Prior art: sign analysis is abstract interpretation's first example
// (Cousot and Cousot, POPL 1977); taking facts from branch tests is
// occurrence typing (Tobin-Hochstadt and Felleisen, ICFP 2010) and Liquid
// Haskell's path-sensitive refinements, which a divisor `{v /= 0}` asks
// for by annotation; here it's inferred. CREDITS.md.

import { children, type Code, type Id, type NodeOf } from "../model.ts";
import { B } from "../prelude.ts";
import { ARITH, FALSE, INT_OPS, RATIO, S, TRUE } from "./std.ts";

// A set of signs: which of −, 0, + the value can be.
export type Signs = number;
export const NEG = 1, ZERO = 2, POS = 4, ANY = 7;
const NONZERO = NEG | POS, NONNEG = ZERO | POS;

// The builtins with no answer at some inputs, and when an input is fine.
export const PARTIAL: Record<Id, (s: (i: number) => Signs, lit: (i: number) => number | null) => boolean> = {
  [B.div]: (s) => !(s(1) & ZERO),
  [S.mod]: (s) => !(s(1) & ZERO),
  [B.sqrt]: (s) => !(s(0) & NEG),
  [B.log]: (s) => s(0) === POS || !(s(0) & ~POS),
  // 0 to a negative power, or a negative one to a fractional power.
  [B.pow]: (s, lit) => {
    const b = lit(1), whole = b !== null && Number.isInteger(b);
    return !(s(0) & ~POS) || (whole && b! >= 0) || (whole && !(s(0) & ZERO));
  },
};

const flip = (x: Signs) => (x & NEG ? POS : 0) | (x & ZERO) | (x & POS ? NEG : 0);
function plus(a: Signs, b: Signs): Signs {
  let out = 0;
  for (const x of [NEG, ZERO, POS]) for (const y of [NEG, ZERO, POS]) {
    if (!(a & x) || !(b & y)) continue;
    out |= x === ZERO ? y : y === ZERO ? x : x === y ? x : ANY;
  }
  return out;
}
function times(a: Signs, b: Signs): Signs {
  let out = 0;
  for (const x of [NEG, ZERO, POS]) for (const y of [NEG, ZERO, POS]) {
    if (!(a & x) || !(b & y)) continue;
    out |= x === ZERO || y === ZERO ? ZERO : x === y ? POS : NEG;
  }
  return out;
}

const ADD = new Set<Id>([B.add, ARITH.add]), SUB = new Set<Id>([B.sub, ARITH.sub]), MUL = new Set<Id>([B.mul, ARITH.mul]), NEGATE = new Set<Id>([B.neg, ARITH.neg]);
const LESS = new Set<Id>([S.less, ARITH.less]);

// What is known of a name inside a definition's body, from a call to it.
type Env = Map<Id, { signs: Signs; lit: number | null }>;
const NONE: Env = new Map();

export function signAnalysis(code: Code) {
  // Each node's parent, built once.
  let parents: Map<Id, Id> | null = null;
  const parentOf = (id: Id) => {
    if (!parents) {
      parents = new Map();
      for (const [pid, n] of Object.entries(code.nodes)) for (const c of children(n)) parents.set(c, pid);
    }
    return parents.get(id);
  };
  const target = (id: Id): Id | undefined => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : undefined; };
  // Two expressions that are the same value: the same name, or the same
  // field or arithmetic of the same values (rad(x) · rad(x) is a square).
  // Only calls that always give the same answer for the same inputs count.
  const alike = (x: Id, y: Id, depth = 0): boolean => {
    if (x === y) return true;
    const a = code.nodes[x], b = code.nodes[y];
    if (!a || !b || depth > 4) return false;
    if (a.kind === "ref" && b.kind === "ref") return a.target === b.target;
    if (a.kind === "lit" && b.kind === "lit") return a.value === b.value;
    if (a.kind !== "call" || b.kind !== "call" || a.args.length !== b.args.length) return false;
    const f = target(a.fn);
    if (!f || f !== target(b.fn)) return false;
    const pure = code.nodes[f]?.kind === "field" || ADD.has(f) || SUB.has(f) || MUL.has(f) || NEGATE.has(f);
    return pure && a.args.every((arg, i) => alike(arg, b.args[i], depth + 1));
  };
  // A number known where it's written: a literal, a let or a definition
  // whose value is one, or an input given one.
  const numLit = (id: Id, env: Env = NONE, depth = 0): number | null => {
    const n = code.nodes[id];
    if (!n || depth > 8) return null;
    if (n.kind === "lit") {
      const v = typeof n.value === "number" ? n.value : /^-?\d+$/.test(n.value) ? Number(n.value) : null;
      return v === null || Number.isNaN(v) ? null : v;
    }
    if (n.kind !== "ref") return null;
    const t = code.nodes[n.target];
    if (t?.kind === "def") return t.body ? numLit(t.body, NONE, depth + 1) : null;
    if (t?.kind !== "binder") return null;
    if (env.has(n.target)) return env.get(n.target)!.lit;
    const v = letValue(n.target);
    return v ? numLit(v, env, depth + 1) : null;
  };
  // The value a let gives this name: `(b ↦ body)(value)`.
  const letValue = (b: Id): Id | undefined => {
    const p = parentOf(b), pn = p ? code.nodes[p] : undefined;
    if (pn?.kind !== "lambda") return undefined;
    const call = parentOf(p!), cn = call ? code.nodes[call] : undefined;
    return cn?.kind === "call" && cn.fn === p ? cn.args[pn.params.indexOf(b)] : undefined;
  };

  // What a test being `holds` says about the binder b.
  const said = (cond: Id, holds: boolean, b: Id, env: Env, depth: number): Signs => {
    const n = code.nodes[cond];
    if (n?.kind !== "call" || depth > 8) return ANY;
    const f = target(n.fn), [x, y] = n.args;
    const is = (a: Id | undefined) => a !== undefined && target(a) === b;
    const go = (c: Id, h: boolean) => said(c, h, b, env, depth + 1);
    if (f === S.not) return go(x, !holds);
    if (f === S.and) return holds ? go(x, true) & go(y, true) : go(x, false) | go(y, false);
    if (f === S.or) return holds ? go(x, true) | go(y, true) : go(x, false) & go(y, false);
    if (f === S.equal) {
      const c = is(x) ? numLit(y, env) : is(y) ? numLit(x, env) : null;
      if (c === null) return ANY;
      const at = c > 0 ? POS : c < 0 ? NEG : ZERO;
      return holds ? at : c === 0 ? NONZERO : ANY;
    }
    if (f && (LESS.has(f) || f === INT_OPS.less)) {
      // x < c: the binder is left; c < x: it is right.
      if (is(x) && numLit(y, env) !== null) { const c = numLit(y, env)!; return holds ? (c <= 0 ? NEG : ANY) : (c > 0 ? POS : c === 0 ? NONNEG : ANY); }
      if (is(y) && numLit(x, env) !== null) { const c = numLit(x, env)!; return holds ? (c >= 0 ? POS : ANY) : (c < 0 ? NEG : c === 0 ? NEG | ZERO : ANY); }
    }
    return ANY;
  };

  // The branches between `at` and the binder's scope, and what each says.
  const guarded = (at: Id, b: Id, env: Env): Signs => {
    let out = ANY, child = at;
    for (let p = parentOf(at); p; child = p, p = parentOf(p)) {
      const n = code.nodes[p];
      if (n?.kind === "arm" && n.binds.includes(b)) break;
      if (n?.kind === "lambda" && n.params.includes(b)) break;
      if (n?.kind !== "arm" || n.body !== child) continue;
      const m = parentOf(p), match = m ? code.nodes[m] : undefined;
      if (match?.kind !== "match" || (n.variant !== TRUE && n.variant !== FALSE)) continue;
      out &= said(match.scrutinee, n.variant === TRUE, b, env, 0);
    }
    return out;
  };

  const entered = new Set<Id>();
  const of = (id: Id, env: Env = NONE, depth = 0): Signs => {
    if (depth > 40) return ANY;
    const n = code.nodes[id];
    if (!n) return ANY;
    const lit = numLit(id, env);
    if (lit !== null) return lit > 0 ? POS : lit < 0 ? NEG : ZERO;
    if (n.kind === "ref") {
      const b = n.target, bn = code.nodes[b];
      // A definition's value.
      if (bn?.kind === "def") return bn.body && code.nodes[bn.body]?.kind !== "lambda" && !entered.has(b) ? within(b, () => of(bn.body!, NONE, depth + 1)) : ANY;
      if (bn?.kind !== "binder") return ANY;
      let s = ANY;
      if (env.has(b)) s = env.get(b)!.signs;
      else { const v = letValue(b); if (v) s = of(v, env, depth + 1); }
      // A type's rule: a Rational's bottom is positive.
      const p = parentOf(b), pn = p ? code.nodes[p] : undefined;
      if (pn?.kind === "arm" && pn.variant === RATIO && pn.binds.indexOf(b) === 1) s = POS;
      return s & guarded(id, b, env);
    }
    if (n.kind === "match") {
      let s = 0;
      for (const a of n.arms) s |= of((code.nodes[a] as NodeOf<"arm">).body, env, depth + 1);
      if (n.otherwise) s |= of(n.otherwise, env, depth + 1);
      return s || ANY;
    }
    if (n.kind !== "call") return ANY;
    const fnode = code.nodes[n.fn];
    if (fnode?.kind === "lambda") return of(fnode.body, env, depth + 1);
    const f = target(n.fn);
    if (!f) return ANY;
    const a = (i: number) => (n.args[i] ? of(n.args[i], env, depth + 1) : ANY);
    const same = n.args.length === 2 && alike(n.args[0], n.args[1]);
    if (ADD.has(f) || f === INT_OPS.add) return plus(a(0), a(1));
    if (SUB.has(f) || f === INT_OPS.sub) return same ? ZERO : plus(a(0), flip(a(1)));
    if (NEGATE.has(f)) return flip(a(0));
    if (MUL.has(f) || f === INT_OPS.mul) { const s = times(a(0), a(1)); return same ? s & NONNEG : s; }
    if (f === B.div) return times(a(0), a(1) & NONZERO);
    if (f === B.sqrt) return a(0) & POS ? (a(0) & ZERO ? NONNEG : POS) : ZERO;
    if (f === B.exp) return POS;
    if (f === B.log && numLit(n.args[0], env) !== null && numLit(n.args[0], env)! > 0) { const v = Math.log(numLit(n.args[0], env)!); return v > 0 ? POS : v < 0 ? NEG : ZERO; }
    if (f === B.pow) return a(0) === POS ? POS : ANY;
    if (f === S.abs || f === INT_OPS.abs) { const s = a(0); return (s & NONZERO ? POS : 0) | (s & ZERO); }
    if (f === INT_OPS.toNumber) return a(0);
    // A sum of squares, total(zip parts(·, x, x)), is never negative.
    if (f === S.total) {
      const z = code.nodes[n.args[0]];
      if (z?.kind === "call" && target(z.fn) === S.zipParts && MUL.has(target(z.args[0]) ?? "") && target(z.args[1]) !== undefined && target(z.args[1]) === target(z.args[2])) return NONNEG;
    }
    // A definition's call: its body, its inputs known from here.
    const d = code.nodes[f], body = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
    if (body?.kind === "lambda" && body.params.length === n.args.length && !entered.has(f)) {
      const inner: Env = new Map(body.params.map((p, i) => [p, { signs: a(i), lit: numLit(n.args[i], env) }]));
      return within(f, () => of(body.body, inner, depth + 1));
    }
    return ANY;
  };
  const within = <T>(d: Id, f: () => T): T => { entered.add(d); try { return f(); } finally { entered.delete(d); } };

  // Is this call to a partial builtin always answered?
  const answeredIn = (call: Id, env: Env): boolean => {
    const n = code.nodes[call];
    if (n?.kind !== "call") return false;
    const f = target(n.fn), ok = f ? PARTIAL[f] : undefined;
    return !!ok && ok((i) => (n.args[i] ? of(n.args[i], env) : ANY), (i) => (n.args[i] ? numLit(n.args[i], env) : null));
  };
  const answered = (call: Id) => answeredIn(call, NONE);

  // Is a call to a definition always answered with these inputs? Its
  // Choice must come only from partial builtins answered here, or from
  // definitions it calls that are, in turn (period(1, 9.81) divides by
  // 9.81). `searches` says which other builtins may give no answer.
  const totalIn = (d: Id, env: Env, searches: (f: Id) => boolean, depth: number): boolean => {
    const dn = code.nodes[d], body = dn?.kind === "def" && dn.body ? code.nodes[dn.body] : undefined;
    if (body?.kind !== "lambda" || depth > 6 || entered.has(d)) return false;
    return within(d, () => {
      for (const id of subtreeOf(body.body)) {
        const n = code.nodes[id];
        if (n?.kind === "solve") return false;
        if (n?.kind !== "call") continue;
        const fn = code.nodes[n.fn];
        if (fn?.kind === "lambda") continue;
        const f = target(n.fn);
        if (!f) return false;
        const t = code.nodes[f];
        if (t?.kind === "binder") return false;
        if (PARTIAL[f]) { if (!answeredIn(id, env)) return false; continue; }
        if (t?.kind === "def") {
          const callee = t.body ? code.nodes[t.body] : undefined;
          if (callee?.kind !== "lambda" || !searches(f)) continue;
          const inner: Env = new Map(callee.params.map((p, i) => [p, { signs: n.args[i] ? of(n.args[i], env) : ANY, lit: n.args[i] ? numLit(n.args[i], env) : null }]));
          if (!totalIn(f, inner, searches, depth + 1)) return false;
          continue;
        }
        if (searches(f)) return false;
      }
      return true;
    });
  };
  const subtreeOf = (root: Id): Id[] => { const out: Id[] = []; const go = (id: Id) => { out.push(id); const n = code.nodes[id]; if (n) for (const c of children(n)) go(c); }; go(root); return out; };
  const totalCall = (call: Id, searches: (f: Id) => boolean): boolean => {
    const n = code.nodes[call];
    if (n?.kind !== "call") return false;
    const f = target(n.fn), d = f ? code.nodes[f] : undefined, body = d?.kind === "def" && d.body ? code.nodes[d.body] : undefined;
    if (body?.kind !== "lambda" || body.params.length !== n.args.length) return false;
    const env: Env = new Map(body.params.map((p, i) => [p, { signs: of(n.args[i]), lit: numLit(n.args[i]) }]));
    return totalIn(f!, env, searches, 0);
  };
  return { of, answered, totalCall };
}
