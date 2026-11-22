// A definition given a function written where it's called gets a copy of
// its own for that function (C30 s2c1): the library's fold given chapters'
// `(word, rest, count) ↦ …` calls it directly instead of through a closure,
// and what the copy hands it only to be ignored is no longer made. On the
// core IR's JavaScript, an array's fold hands each arm the rest of the
// array as a view (scalar.ts restAsView); an arm that never reads the rest
// now gets the view the fold started with, so none is made per item.
// chapters stored as arrays: about a fifth faster (C30 s2c, measured by
// hand first).
// Prior art: specialization of higher-order functions to their function
// arguments (Chin and Darlington's higher-order removal, 1996; GHC's
// SpecConstr and call-pattern specialization), and dead argument
// elimination (LLVM's deadargelim).
import type { CoreIR, RType, SExpr, SFunc } from "./scalar.ts";
import { kids, mapKids } from "./scalar.ts";

type Let = Extract<SExpr, { k: "let" }>;
type Rebinds = (e: SExpr, i: number) => boolean;
// Whether e binds local i afresh (so a read of i after it isn't the input).
const rebinds: Rebinds = (e, i) => (e.k === "let" && e.i === i) || (e.k === "case" && e.s === i) || ((e.k === "attempt" || e.k === "search") && e.res === i)
  || (e.k === "apply" && e.tmp === i) || (e.k === "list" && (e.item === i || e.acc === i)) || (e.k === "handle" && (e.reason === i || e.save === i || e.frame === i))
  || (e.k === "budget" && (e.save === i || e.res === i));
const reads = (e: SExpr, i: number): boolean => (e.k === "local" && e.i === i) || kids(e).some((x) => reads(x, i));
const binds = (e: SExpr, i: number): boolean => rebinds(e, i) || kids(e).some((x) => binds(x, i));
// Local i bound in exactly one place in e.
const count = (e: SExpr, i: number): number => (rebinds(e, i) ? 1 : 0) + kids(e).reduce((n, k) => n + count(k, i), 0);
const once = (e: SExpr, i: number): boolean => count(e, i) === 1;

export function closureArgs(ir: CoreIR): void {
  const funcs = ir.funcs;
  type Cap = Extract<SExpr, { k: "cap" }>;
  const isCap = (e: SExpr, shape: number, c: number): e is Cap => e.k === "cap" && e.shape === shape && e.i === c;
  // Every read of a known local in body is a call of it, or it is handed
  // on as it is to another function's input only ever called, or captured
  // by a closure whose code only ever calls what it captured there.
  const onlyCalled = (body: SExpr, known: (i: number) => boolean, direct: (e: SExpr) => boolean): boolean => {
    let ok = true;
    // A let naming a known local (`l5 = l2`) names it too.
    const also = new Set<number>(), knows = (i: number) => known(i) || also.has(i);
    const walk = (e: SExpr) => {
      if (!ok) return;
      if (e.k === "let" && ((e.value.k === "local" && knows(e.value.i)) || direct(e.value)) && once(body, e.i)) { also.add(e.i); walk(e.body); return; }
      if (e.k === "apply" && ((e.fn.k === "local" && knows(e.fn.i)) || direct(e.fn))) { if (e.cps) ok = false; e.args.forEach(walk); return; }
      if (e.k === "call") {
        e.args.forEach((a, k) => { if (a.k === "local" && knows(a.i)) { if (e.cps || !applied(e.fn, k)) ok = false; } else walk(a); });
        return;
      }
      if (e.k === "closure" && !ir.shader) {
        e.caps.forEach((a, c) => { if (a.k === "local" && knows(a.i)) { if (!capApplied(e.fn, e.shape, c)) ok = false; } else walk(a); });
        return;
      }
      if ((e.k === "local" && knows(e.i)) || direct(e)) { ok = false; return; }
      kids(e).forEach(walk);
    };
    walk(body);
    return ok;
  };
  const never = () => false;
  // Input j of function fi is only ever called, or handed on as it is to
  // another function's input that is only ever called: optimistic, so a
  // loop handing it to itself counts.
  const memo = new Map<string, boolean>();
  const applied = (fi: number, j: number): boolean => {
    const key = `${fi}|${j}`;
    if (memo.has(key)) return memo.get(key)!;
    memo.set(key, true);
    const f = funcs[fi];
    const ok = !f.multi && f.answer === undefined && !binds(f.body, j) && onlyCalled(f.body, (i) => i === j, never);
    memo.set(key, ok);
    return ok;
  };
  // The locals a closure's code names capture c by (`let x = cap c`), each
  // bound once; null when the capture is read some other way.
  const capLocals = (g: SFunc, shape: number, c: number): Set<number> | null => {
    const xs = new Set<number>();
    let ok = true;
    const walk = (e: SExpr) => {
      if (e.k === "let" && isCap(e.value, shape, c)) xs.add(e.i);
      kids(e).forEach(walk);
    };
    walk(g.body);
    for (const x of xs) if (!once(g.body, x)) ok = false;
    return ok ? xs : null;
  };
  // Capture c of a closure of function g's (in shapes[shape]) is only ever
  // called: G1b4, `updated in pool`'s function, captured by the slot's
  // `(slot) => … some(f(item))` that map calls.
  const capMemo = new Map<string, boolean>();
  const capApplied = (gi: number, shape: number, c: number): boolean => {
    const key = `${gi}|${shape}|${c}`;
    if (capMemo.has(key)) return capMemo.get(key)!;
    capMemo.set(key, true);
    const g = funcs[gi];
    const xs = capLocals(g, shape, c);
    // (The let naming it is the one read that isn't a call.)
    const ok = !!xs && !g.multi && g.answer === undefined && onlyCalled(dropCapLets(g.body, shape, c), (i) => xs.has(i), (e) => isCap(e, shape, c));
    capMemo.set(key, ok);
    return ok;
  };
  const dropCapLets = (e: SExpr, shape: number, c: number): SExpr => {
    const x = mapKids(e, (k) => dropCapLets(k, shape, c));
    return x.k === "let" && isCap(x.value, shape, c) ? { ...x, value: { k: "num", v: 0 } as SExpr } : x;
  };
  // The copies made: function, input (or capture), the closure's function.
  const copies = new Map<string, number>();
  const limit = funcs.length * 2 + 64;
  // f's body with each known local's calls made calls of g directly.
  const rwKnown = (body: SExpr, known: (i: number) => boolean, direct: (e: SExpr) => boolean, g: number): SExpr => {
    const also = new Set<number>(), knows = (i: number) => known(i) || also.has(i);
    const rw = (e: SExpr): SExpr => {
      if (e.k === "let" && ((e.value.k === "local" && knows(e.value.i)) || direct(e.value)) && once(body, e.i)) also.add(e.i);
      if (e.k === "apply" && ((e.fn.k === "local" && knows(e.fn.i)) || direct(e.fn))) return { k: "call", fn: g, args: [e.fn, ...e.args.map(rw)], tail: e.tail };
      if (e.k === "call") {
        const k = e.args.findIndex((a) => a.k === "local" && knows(a.i));
        return { ...e, fn: k >= 0 ? copy(e.fn, k, g) : e.fn, args: e.args.map(rw) };
      }
      if (e.k === "closure" && !ir.shader) {
        const c = e.caps.findIndex((a) => a.k === "local" && knows(a.i));
        return { ...e, fn: c >= 0 ? capCopy(e.fn, e.shape, c, g) : e.fn, caps: e.caps.map(rw) };
      }
      return mapKids(e, rw);
    };
    return rw(body);
  };
  const copy = (fi: number, j: number, g: number): number => {
    const key = `${fi}|${j}|${g}`;
    if (copies.has(key)) return copies.get(key)!;
    if (funcs.length > limit) return fi;
    const f = funcs[fi];
    const c: SFunc = { ...f, name: `${f.name}·${funcs[g].name}`, inner: true, body: f.body };
    const ci = funcs.push(c) - 1;
    copies.set(key, ci);
    c.body = rwKnown(f.body, (i) => i === j, never, g);
    return ci;
  };
  // A copy of closure code h whose capture c is known to be g's closure.
  const capCopy = (hi: number, shape: number, c: number, g: number): number => {
    const key = `cap|${hi}|${shape}|${c}|${g}`;
    if (copies.has(key)) return copies.get(key)!;
    if (funcs.length > limit) return hi;
    const h = funcs[hi];
    const xs = capLocals(h, shape, c) ?? new Set<number>();
    const cc: SFunc = { ...h, name: `${h.name}·${funcs[g].name}`, inner: true, body: h.body };
    const ci = funcs.push(cc) - 1;
    copies.set(key, ci);
    cc.body = rwKnown(h.body, (i) => xs.has(i), (e) => isCap(e, shape, c), g);
    return ci;
  };
  // Each call given a closure where the function only calls it, copies
  // included: a copy's calls may be given closures written in it.
  for (let fi = 0; fi < funcs.length; fi++) {
    const rw = (e: SExpr): SExpr => {
      let r = mapKids(e, rw);
      // Each closure in turn: the copy for one is copied for the next.
      const done = new Set<number>();
      for (;;) {
        if (r.k !== "call" || r.cps) return r;
        const c = r;
        const j = c.args.findIndex((a, k) => !done.has(k) && a.k === "closure" && applied(c.fn, k));
        if (j < 0) return r;
        done.add(j);
        r = { ...c, fn: copy(c.fn, j, (c.args[j] as Extract<SExpr, { k: "closure" }>).fn) };
      }
    };
    funcs[fi].body = rw(funcs[fi].body);
  }
  for (const ci of copies.values()) unusedFields(ir, ci);
}

// The inputs function g never reads.
function unused(g: SFunc, i: number): boolean { return !reads(g.body, i); }

// A loop (fi calls itself as its next round) carrying a record in input p
// whose field c is read only to be handed to inputs nothing reads, and
// whose callers don't read field c of what it gives back: field c is
// carried as it was, not made again each round.
function unusedFields(ir: CoreIR, fi: number): void {
  const f = ir.funcs[fi];
  f.params.forEach((t, p) => {
    if (typeof t !== "object" || !("fields" in t) || !Array.isArray((t as RType).fields)) return;
    const rt = t as RType;
    rt.fields.forEach((_, c) => {
      if (deadIn(ir, f, fi, p, rt, c) && unreadByCallers(ir, fi, rt, c)) carry(f, fi, p, rt, c);
    });
  });
}

// Field c of input p (or a let naming it) read only into locals handed to
// inputs nothing reads; p itself otherwise only read by field, or given
// back whole as the result.
function deadIn(ir: CoreIR, f: SFunc, fi: number, p: number, t: RType, c: number): boolean {
  if (binds(f.body, p)) return false;
  const aliases = new Set([p]);
  const dead = new Set<number>();
  let ok = true, rounds = 0;
  const isP = (e: SExpr) => e.k === "local" && aliases.has(e.i);
  // A local read only as an input its callee never reads.
  const deadLocal = (body: SExpr, x: number): boolean => {
    let fine = true;
    const w = (e: SExpr) => {
      if (!fine) return;
      if (e.k === "call") { e.args.forEach((a, k) => { if (a.k === "local" && a.i === x) { if (!unused(ir.funcs[e.fn], k)) fine = false; } else w(a); }); return; }
      if (e.k === "local" && e.i === x) { fine = false; return; }
      kids(e).forEach(w);
    };
    w(body);
    return fine;
  };
  const walk = (e: SExpr, tail: boolean) => {
    if (!ok) return;
    if (e.k === "let") {
      if (isP(e.value)) { aliases.add(e.i); walk(e.body, tail); return; }
      if (e.value.k === "get" && isP(e.value.rec) && e.value.t.key === t.key) {
        if (e.value.i === c) { if (!deadLocal(e.body, e.i)) { ok = false; return; } dead.add(e.i); }
        walk(e.body, tail);
        return;
      }
      walk(e.value, false); walk(e.body, tail);
      return;
    }
    if (e.k === "get" && isP(e.rec)) { if (e.i === c) ok = false; return; }
    if (isP(e)) { if (!tail) ok = false; return; }
    if (e.k === "call" && e.fn === fi && e.tail) rounds++;
    if (e.k === "if") { walk(e.cond, false); walk(e.then, tail); walk(e.else, tail); return; }
    if (e.k === "case") { walk(e.scrut, false); e.arms.forEach((a) => a && walk(a, tail)); return; }
    kids(e).forEach((x) => walk(x, false));
  };
  walk(f.body, true);
  return ok && rounds > 0;
}

// Every call of fi, outside fi's own next rounds, is a let whose local is
// read by field, field c not at all.
function unreadByCallers(ir: CoreIR, fi: number, t: RType, c: number): boolean {
  let ok = true;
  ir.funcs.forEach((g, gi) => {
    const walk = (e: SExpr, bound: Let | null) => {
      if (!ok) return;
      if (e.k === "call" && e.fn === fi) {
        if (gi === fi && e.tail) { e.args.forEach((a) => walk(a, null)); return; }
        if (!bound || !fieldsOnly(bound.body, bound.i, t, c)) { ok = false; return; }
        e.args.forEach((a) => walk(a, null));
        return;
      }
      // A let's body is its value: what names the let names that.
      if (e.k === "let") { walk(e.value, under(e.value) ? e : null); walk(e.body, bound); return; }
      kids(e).forEach((x) => walk(x, null));
    };
    walk(g.body, null);
  });
  return ok;
  // The call is the value the let names, under lets of its own.
  function under(v: SExpr): boolean { while (v.k === "let") v = v.body; return v.k === "call" && v.fn === fi; }
}
// Local x read only by field, never field c (a let naming field c, its
// local unread, is fine).
function fieldsOnly(body: SExpr, x: number, t: RType, c: number): boolean {
  let ok = true;
  const walk = (e: SExpr) => {
    if (!ok) return;
    if (e.k === "let" && e.value.k === "get" && e.value.rec.k === "local" && e.value.rec.i === x && e.value.i === c) { if (reads(e.body, e.i)) ok = false; walk(e.body); return; }
    if (e.k === "get" && e.rec.k === "local" && e.rec.i === x && e.t.key === t.key) { if (e.i === c) ok = false; return; }
    if (e.k === "local" && e.i === x) { ok = false; return; }
    kids(e).forEach(walk);
  };
  walk(body);
  return ok;
}

// Each next round's record keeps field c as this round's.
function carry(f: SFunc, fi: number, p: number, t: RType, c: number): void {
  const keep: SExpr = { k: "get", rec: { k: "local", i: p }, t, i: c };
  const rw = (e: SExpr): SExpr => {
    if (e.k === "call" && e.fn === fi && e.tail) {
      const args = e.args.slice();
      args[p] = into(args[p]);
      return { ...e, args };
    }
    return mapKids(e, rw);
  };
  const into = (e: SExpr): SExpr => {
    if (e.k === "let") return { ...e, body: into(e.body) };
    if (e.k === "make" && e.t.key === t.key) { const args = e.args.slice(); args[c] = keep; return { ...e, args }; }
    return e;
  };
  f.body = rw(f.body);
}
