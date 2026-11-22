// A closure made only to be applied at once is a direct call of its code
// (C288): fit's `predict` asks `value at(model, x)` for the model's
// function at x and applies it to the parameters, and `slopes` asks for
// that function's derivative and applies it, for every point at every
// step, so each point made three closures (one a derivative's) and called
// each through the runtime: 5,000 points 0.85 s, 0.45 s by hand without
// them. The ideal picks the model in a switch and computes.
//
// Known: a closure written there; a call of a function that only
// computes and always answers whose body is a choice (ifs, matches, lets)
// of closures written there, put in place; `derived` of a known closure,
// its derivative's maker put in place with the closure's captures; and a
// local bound once to one of these and read only there. Applied, each
// closure in the choice becomes a call of a copy of its code that takes
// the captures as inputs before the rest (`·direct`), so no closure is
// made. Applying a closure and calling its code compute the same, and
// what's moved to the apply only computes and always answers, so no
// answer and no stop changes. Not a code that reads its own closure
// otherwise (it calls itself), nor an apply that takes the rest of the
// run (cps).
// Prior art: the case-of-known-constructor and beta reduction of a
// known lambda (Peyton Jones and Santos, "A transformation-based optimiser
// for Haskell", 1998), with lambda lifting of the captures (Johnsson, 1985).

import type { CoreIR, LType, SExpr, SFunc } from "./scalar.ts";
import { kids, mapKids, mapLocals } from "./scalar.ts";
import { pureFuncs } from "./share-calls.ts";

type Closure = Extract<SExpr, { k: "closure" }>;

const readsOf = (e: SExpr, i: number): number => (e.k === "local" && e.i === i ? 1 : 0) + kids(e).reduce((n, k) => n + readsOf(k, i), 0);
const callsSelf = (e: SExpr, g: number): boolean => ((e.k === "call" || e.k === "closure") && e.fn === g) || kids(e).some((k) => callsSelf(k, g));

export function knownClosures(ir: CoreIR): number {
  const { funcs } = ir;
  const pure = pureFuncs(ir);
  // A body that is a choice of closures written there.
  const choice = (e: SExpr): boolean => {
    switch (e.k) {
      case "closure": return true;
      case "let": return choice(e.body);
      case "if": return choice(e.then) && choice(e.else);
      case "case": return e.arms.every((a) => !a || choice(a));
      default: return false;
    }
  };
  const maker = (g: number) => pure.has(g) && !callsSelf(funcs[g].body, g) && choice(funcs[g].body);
  // g's body put in f, its inputs `args` (lets, in order) and its locals
  // f's; caps: a closure's captures, for a derivative's maker reading its
  // closure only through them.
  const inlined = (f: SFunc, g: number, args: SExpr[], caps?: { shape: number; values: SExpr[] }): SExpr | null => {
    const h = funcs[g];
    if (caps && readsOf(h.body, 0)) return null;
    const at = h.locals.map((t) => f.locals.push(t) - 1);
    let body = mapLocals(h.body, (i) => at[i]);
    if (caps) {
      const put = (e: SExpr): SExpr => (e.k === "cap" && e.shape === caps.shape ? caps.values[e.i] : mapKids(e, put));
      body = put(body);
      return body;
    }
    return args.reduceRight<SExpr>((b, value, j) => ({ k: "let", i: at[j], value, body: b }), body);
  };
  // Each leaf of a choice given to `leaf`.
  const each = (e: SExpr, leaf: (c: Closure) => SExpr | null): SExpr | null => {
    switch (e.k) {
      case "closure": return leaf(e);
      case "let": { const b = each(e.body, leaf); return b && { ...e, body: b }; }
      case "if": { const t = each(e.then, leaf), x = each(e.else, leaf); return t && x && { ...e, then: t, else: x }; }
      case "case": {
        const arms = e.arms.map((a) => (a ? each(a, leaf) : a));
        return arms.every((a, j) => a !== null || e.arms[j] === null) ? { ...e, arms } : null;
      }
      default: return null;
    }
  };
  // The copy of a closure's code taking its captures first (·direct).
  const directs = new Map<number, number | null>();
  const direct = (c: Closure): number | null => {
    if (directs.has(c.fn)) return directs.get(c.fn)!;
    const g = funcs[c.fn];
    let made: number | null = null;
    if (!readsOf(g.body, 0) && !callsSelf(g.body, c.fn)) {
      const caps = ir.shapes[c.shape].caps as LType[], m = caps.length;
      const shifted = mapLocals(g.body, (i) => i - 1 + m);
      const put = (e: SExpr): SExpr => (e.k === "cap" && e.shape === c.shape ? { k: "local", i: e.i } : mapKids(e, put));
      made = funcs.push({ ...g, name: `${g.name}·direct`, params: [...caps, ...g.params.slice(1)], locals: [...caps, ...g.locals.slice(1)], body: put(shifted) }) - 1;
    }
    directs.set(c.fn, made);
    return made;
  };
  let n = 0;
  funcs.forEach((f) => {
    // Locals bound once to a value, and read once.
    const bound = new Map<number, SExpr>();
    const used = new Set<number>();
    const scan = (e: SExpr) => { if (e.k === "let" && e.i >= 0) bound.set(e.i, bound.has(e.i) ? (null as unknown as SExpr) : e.value); kids(e).forEach(scan); };
    scan(f.body);
    // A known choice for e, or null.
    const known = (e: SExpr, taken: number[]): SExpr | null => {
      switch (e.k) {
        case "closure": return e;
        case "local": {
          const v = bound.get(e.i);
          if (!v || readsOf(f.body, e.i) !== 1) return null;
          const r = known(v, taken);
          if (r) taken.push(e.i);
          return r;
        }
        case "let": { const b = known(e.body, taken); return b && { ...e, body: b }; }
        case "call": {
          if (e.cps || e.tail || !maker(e.fn)) return null;
          return inlined(f, e.fn, e.args);
        }
        case "rt": {
          if (e.fn !== "derived" || e.args.length !== 1) return null;
          const t = known(e.args[0], taken);
          return t && each(t, (c) => {
            if (c.d === undefined || !pure.has(c.d) || !choice(funcs[c.d].body)) return null;
            const b = inlined(f, c.d, [], { shape: c.shape, values: c.caps });
            return b && known(b, taken);
          });
        }
        default: return null;
      }
    };
    const go = (e: SExpr): SExpr => {
      const r = mapKids(e, go);
      if (r.k !== "apply" || r.cps) return r;
      const taken: number[] = [];
      const t = known(r.fn, taken);
      if (!t) return r;
      // The arguments first, each once, then the choice and the call.
      const at = r.args.map((a, j) => ({ i: f.locals.push(r.t.params[j]) - 1, a }));
      const call = each(t, (c) => {
        const d = direct(c);
        return d === null ? null : { k: "call", fn: d, args: [...c.caps, ...at.map((x) => ({ k: "local" as const, i: x.i }))], tail: r.tail };
      });
      if (!call) return r;
      taken.forEach((i) => used.add(i));
      n++;
      return at.reduceRight<SExpr>((b, x) => ({ k: "let", i: x.i, value: x.a, body: b }), call);
    };
    const body = go(f.body);
    if (body === f.body) return;
    // The lets whose value was moved to the apply, gone.
    const drop = (e: SExpr): SExpr => { const r = mapKids(e, drop); return r.k === "let" && used.has(r.i) && !readsOf(r.body, r.i) ? r.body : r; };
    f.body = drop(body);
  });
  return n;
}
