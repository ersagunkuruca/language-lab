// A Float64's overflow check made once where it can't fail again (C207h).
// A value is checked finite where something observes it (scalar.ts `fin`:
// a comparison, a show), so a loop checks its unchanged inputs on every
// step: queens-first's `safe` its column and distance four times an item,
// divisors its number each step. Here, going through each function in the
// order it runs, a local already checked, or made finite (a finite number,
// a finite one plus a number below 2^970, its abs, floor or negation, a
// check's own value), isn't checked again. And a call to a function made by
// the lowering (a loop's own function, called only directly) whose inputs
// are known finite there goes to a copy of it that knows them too: the
// loop's first step checks them, every later step runs the copy, so a step
// checks only what it changes. A check is dropped only where it can't fail,
// so no answer and no stop changes. Hand-written C's loop, which hoists
// what's the same every step.
// Prior art: loop-invariant code motion (Aho, Sethi and Ullman's dragon
// book §10.7), here by specializing the loop on what its first step proved
// (Mueller and Whalley, "Avoiding conditional branches by code
// replication", PLDI 1995); call-site specialization on argument facts, as
// a JIT's type guards (Chambers and Ungar, "Customization", PLDI 1989).

import { kids, mapKids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const COPIES = 64;

// `if not ((l - l) = 0) then stop … else e`: the shape scalar.ts `fin` makes.
function checkOf(e: SExpr): number | null {
  if (e.k !== "if" || !e.check) return null;
  const c = e.cond;
  if (c.k !== "op" || c.op !== "not") return null;
  const q = c.args[0];
  if (q.k !== "op" || q.op !== "equal" || q.args[1].k !== "num" || q.args[1].v !== 0) return null;
  const s = q.args[0];
  if (s.k !== "op" || s.op !== "sub" || s.args[0].k !== "local" || s.args[1].k !== "local" || s.args[0].i !== s.args[1].i) return null;
  if (e.then.k !== "op" || e.then.op !== "stop") return null;
  return s.args[0].i;
}

// The locals a let binds once and nothing else binds: facts about them hold
// wherever they're read.
function steady(f: SFunc): Set<number> {
  const lets = new Map<number, number>(), other = new Set<number>();
  const walk = (e: SExpr) => {
    if (e.k === "let") lets.set(e.i, (lets.get(e.i) ?? 0) + 1);
    else if (e.k === "case") other.add(e.s);
    else if (e.k === "list") { other.add(e.item); other.add(e.acc); }
    else if (e.k === "budget") { other.add(e.save); other.add(e.res); }
    else if (e.k === "attempt") other.add(e.res);
    else if (e.k === "handle") { other.add(e.reason); other.add(e.save); }
    else if (e.k === "released" && e.st !== undefined) other.add(e.st);
    else if (e.k === "apply") other.add(e.tmp);
    kids(e).forEach(walk);
  };
  walk(f.body);
  const out = new Set<number>();
  f.params.forEach((_, j) => { if (!lets.has(j) && !other.has(j)) out.add(j); });
  for (const [i, n] of lets) if (n === 1 && !other.has(i) && i >= f.params.length) out.add(i);
  return out;
}

export function finiteChecks(ir: CoreIR): number {
  const { funcs } = ir;
  // Functions called only directly, made by the lowering: their callers
  // are all in sight.
  const closed = new Set<number>();
  funcs.forEach((g, j) => { if (g.inner) closed.add(j); });
  const seeClosures = (e: SExpr) => { if (e.k === "closure") closed.delete(e.fn); kids(e).forEach(seeClosures); };
  funcs.forEach((g) => seeClosures(g.body));
  const copies = new Map<string, number>();
  // What each copy was made from, and what it knows.
  const baseOf = new Map<number, number>(), knownOf = new Map<number, number[]>();
  let dropped = 0, made = 0;
  const done = new Set<number>();
  const queue: { j: number; known: Set<number> }[] = funcs.map((_, j) => ({ j, known: new Set<number>() }));
  // A copy of function j knowing inputs `known` finite.
  const copyOf = (j: number, known: number[]): number => {
    const key = `${j}:${known.join(",")}`;
    const had = copies.get(key);
    if (had !== undefined) return had;
    if (made >= COPIES) return j;
    const g = funcs[j];
    const c: SFunc = { ...g, name: `${g.name}.finite`, locals: [...g.locals] };
    const at = funcs.push(c) - 1;
    copies.set(key, at);
    closed.add(at);
    made++;
    queue.push({ j: at, known: new Set(known) });
    return at;
  };
  for (let q = queue.shift(); q; q = queue.shift()) {
    if (done.has(q.j)) continue;
    done.add(q.j);
    const f = funcs[q.j], stable = steady(f);
    const finite = (e: SExpr, k: Set<number>): boolean => {
      if (e.k === "num") return Number.isFinite(e.v);
      if (e.k === "local") return k.has(e.i);
      if (e.k === "op" && (e.op === "abs" || e.op === "floor" || e.op === "neg")) return finite(e.args[0], k);
      if (e.k === "op" && (e.op === "add" || e.op === "sub")) {
        const [a, b] = e.args;
        const small = (x: SExpr) => x.k === "num" && Math.abs(x.v) < 2 ** 970;
        return (finite(a, k) && small(b)) || (small(a) && finite(b, k));
      }
      if (checkOf(e) !== null) return e.k === "if" && finite(e.else, new Set([...k, checkOf(e)!]));
      if (e.k === "let") return finite(e.body, k);
      if (e.k === "if") return finite(e.then, k) && finite(e.else, k);
      return false;
    };
    // e rewritten knowing k, and what's known finite once it has run.
    const go = (e: SExpr, k: Set<number>): { e: SExpr; k: Set<number> } => {
      const l = checkOf(e);
      if (l !== null && e.k === "if") {
        if (k.has(l)) { dropped++; return go(e.else, k); }
        const after = stable.has(l) ? new Set([...k, l]) : k;
        const r = go(e.else, after);
        return { e: { ...e, else: r.e }, k: r.k };
      }
      switch (e.k) {
        case "let": {
          const v = go(e.value, k);
          const k2 = new Set(v.k);
          if (stable.has(e.i) && finite(v.e, v.k)) k2.add(e.i); else k2.delete(e.i);
          const b = go(e.body, k2);
          return { e: { ...e, value: v.e, body: b.e }, k: b.k };
        }
        case "op": case "rt": case "make": case "new": case "world": {
          let kk = k;
          const args = e.args.map((a) => { const r = go(a, kk); kk = r.k; return r.e; });
          return { e: { ...e, args } as SExpr, k: kk };
        }
        case "call": {
          let kk = k;
          const args = e.args.map((a) => { const r = go(a, kk); kk = r.k; return r.e; });
          // Inputs known finite here, to a copy that knows them.
          let fn = e.fn;
          if (closed.has(e.fn) && !e.cps) {
            const g = funcs[e.fn];
            const known = args.flatMap((a, j) => (g.params[j] === "f64" && finite(a, kk) ? [j] : []));
            const base = baseOf.get(e.fn) ?? e.fn, had = knownOf.get(e.fn) ?? [];
            const all = [...new Set([...had, ...known])].sort((x, y) => x - y);
            if (all.length > had.length) {
              fn = copyOf(base, all);
              if (fn !== base) { baseOf.set(fn, base); knownOf.set(fn, all); }
              else fn = e.fn;
            }
          }
          return { e: { ...e, fn, args }, k: kk };
        }
        case "if": {
          const c = go(e.cond, k);
          const t = go(e.then, c.k), x = go(e.else, c.k);
          const both = new Set([...t.k].filter((i) => x.k.has(i)));
          return { e: { ...e, cond: c.e, then: t.e, else: x.e }, k: both };
        }
        default:
          // Facts from before hold inside; none are learned for after.
          return { e: mapKids(e, (x) => go(x, k).e), k };
      }
    };
    const start = new Set([...q.known].filter((j) => stable.has(j)));
    f.body = go(f.body, start).e;
  }
  return dropped;
}
