// A push to the front of an array nobody else holds, made on the view it
// was given (C196): a function building an array item by item, its rest
// first (the pedal's `following`, `matching`, `bands` and a map, a block
// of 128 samples), makes a new view for each item otherwise, where a cons
// list makes a cell; now it makes none.
//
// Whose view nobody else holds: what a call gave back, read once, where
// every answer of the function called is a new array (a push's, or the
// empty one), or a record made then whose field is one. The runtime's
// pushFrontOwned moves that view's start back into the free slot in
// front; an empty array, which is shared, or one with no room there, is
// the plain push (std.ts pushFront). Changes no answer: nothing else can
// read the view it changes.

import { isArray, kids, mapKids, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

const PUSH = /^array\.pushFront\.a(\d+)$/;
const EMPTY = /^array\.empty\.a\d+$/;

// What a function gives back that is new: the whole answer, or field i of
// a record made for it.
type Fresh = "whole" | number;

// roots: the functions called from outside, with arrays of anyone's.
export function ownedPushes(ir: CoreIR, roots: number[] = []): number {
  // Functions that are only a push of their inputs (`array cons`): their
  // calls become the push, so the rest given is seen there.
  const wrapper = ir.funcs.map((g) => {
    const b = g.body;
    return !g.multi && b.k === "rt" && PUSH.test(b.fn) && b.args.length === 2 && b.args.every((a) => a.k === "local" && a.i < g.params.length)
      && new Set(b.args.map((a) => (a as { i: number }).i)).size === 2 && g.params.length === 2;
  });
  // Not into a function that may stop and go on later (a call that keeps
  // the rest, a handler, a wait): what it holds across a stop is saved in
  // a frame laid out when lowered, and a local added now isn't in it
  // (inline-small.ts). The functions array-offsets.ts made are inner but
  // plain, so an inner function is otherwise taken.
  const stops = (e: SExpr): boolean => ((e.k === "call" || e.k === "apply") && !!e.cps) || e.k === "handle" || e.k === "world" || e.k === "choose" || e.k === "search"
    || ((e.k === "attempt" || e.k === "budget") && !!e.resumes) || kids(e).some(stops);
  for (const f of ir.funcs) {
    if (f.multi || stops(f.body)) continue;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      if (r.k !== "call" || r.cps || !wrapper[r.fn]) return r;
      const g = ir.funcs[r.fn], b = g.body as Extract<SExpr, { k: "rt" }>;
      // The inputs in order, as the call had them, then the push; a local
      // given is read there as it is.
      const at = r.args.map((a, j) => (a.k === "local" ? -1 : f.locals.push(g.locals[j]) - 1));
      const input = (j: number): SExpr => (at[j] < 0 ? r.args[j] : { k: "local", i: at[j] });
      const push: SExpr = { k: "rt", fn: b.fn, args: b.args.map((a) => input((a as { i: number }).i)) };
      return r.args.reduceRight<SExpr>((body, value, j) => (at[j] < 0 ? body : { k: "let", i: at[j], value, body }), push);
    };
    f.body = put(f.body);
  }
  // Each function's new answer, then the inputs that carry an array being
  // built, then the new answers again, as those give theirs back.
  let fresh = freshAnswers(ir, new Map());
  const carried = carriers(ir, fresh, new Set(roots), stops);
  fresh = freshAnswers(ir, carried);
  let n = 0;
  for (const f of ir.funcs) {
    if (f.multi) continue;
    const lets = new Map<number, SExpr>();
    const reads = new Map<number, number>();
    const scan = (e: SExpr) => {
      if (e.k === "let") lets.set(e.i, e.value);
      if (e.k === "local") reads.set(e.i, (reads.get(e.i) ?? 0) + 1);
      kids(e).forEach(scan);
    };
    scan(f.body);
    const once = (i: number) => reads.get(i) === 1;
    // A call whose answer (field j of it, or the whole) is new.
    const newCall = (e: SExpr | undefined, s: Fresh) => e?.k === "call" && !e.cps && fresh.get(e.fn) === s;
    const own = carried.get(ir.funcs.indexOf(f));
    const owned = (rest: SExpr): boolean => {
      if (newCall(rest, "whole")) return true;
      if (rest.k === "local" && own?.has(rest.i)) return true;
      if (rest.k !== "local" || !once(rest.i)) return false;
      const v = lets.get(rest.i);
      if (newCall(v, "whole")) return true;
      // Field j of a record a call made, read for that field only once.
      if (v && (v.k === "field" || v.k === "get") && v.rec.k === "local") {
        const q = v.rec.i, j = v.i;
        if (!newCall(lets.get(q), j)) return false;
        let ok = true;
        const check = (e: SExpr) => {
          if ((e.k === "field" || e.k === "get") && e.rec.k === "local" && e.rec.i === q) { if (e.i === j && e !== v) ok = false; return; }
          if (e.k === "local" && e.i === q) ok = false;
          kids(e).forEach(check);
        };
        check(f.body);
        return ok;
      }
      return false;
    };
    const mark = (e: SExpr) => {
      if (e.k === "rt" && PUSH.test(e.fn) && e.args[0] && owned(e.args[0])) { e.fn = e.fn.replace("array.pushFront.", "array.pushFrontOwned."); n++; }
      kids(e).forEach(mark);
    };
    mark(f.body);
  }
  return n;
}

// Each function's new answer, assumed, then dropped where an answer
// isn't, until none changes. An input that carries an array being built
// is new where it is given back.
function freshAnswers(ir: CoreIR, carried: Map<number, Set<number>>): Map<number, Fresh> {
  const fresh = new Map<number, Fresh>();
  ir.funcs.forEach((g, i) => { const s = shapeOf(g, carried.get(i)); if (s !== undefined) fresh.set(i, s); });
  for (let changed = true; changed;) {
    changed = false;
    for (const [i, s] of fresh) if (!answers(ir.funcs[i].body).every((v) => isFresh(v, s, ir, fresh, carried.get(i)))) { fresh.delete(i); changed = true; }
  }
  return fresh;
}

// Inputs that only carry an array being built (a map's loop, its answer
// so far): every call gives a new one, and the function reads it only to
// push onto it, give it back, or hand it to itself in the same place,
// once on any way through. Not a function called from outside, nor one
// made a value (a closure), whose callers aren't seen.
function carriers(ir: CoreIR, fresh: Map<number, Fresh>, roots: Set<number>, stops: (e: SExpr) => boolean): Map<number, Set<number>> {
  const valued = new Set<number>();
  const calls: { from: number; e: Extract<SExpr, { k: "call" }> }[] = [];
  ir.funcs.forEach((g, from) => {
    const walk = (e: SExpr) => { if (e.k === "closure") valued.add(e.fn); if (e.k === "call") calls.push({ from, e }); kids(e).forEach(walk); };
    walk(g.body);
  });
  const out = new Map<number, Set<number>>();
  ir.funcs.forEach((g, gi) => {
    if (g.multi || roots.has(gi) || valued.has(gi) || stops(g.body)) return;
    const ps = g.params.flatMap((t, p) => (isArray(t) && usesOf(g.body, p, gi, true) <= 1 ? [p] : []));
    if (ps.length) out.set(gi, new Set(ps));
  });
  // Only where the calls are all seen: one never called here is called
  // from outside, if at all.
  const called = new Set(calls.filter((c) => c.from !== c.e.fn).map((c) => c.e.fn));
  for (const gi of [...out.keys()]) if (!called.has(gi)) out.delete(gi);
  for (let changed = true; changed;) {
    changed = false;
    for (const { from, e } of calls) {
      const ps = out.get(e.fn);
      if (!ps) continue;
      for (const p of [...ps]) {
        const a = e.args[p];
        const ok = !e.cps && !!a && ((from === e.fn && a.k === "local" && a.i === p) || newArray(a, ir, fresh, from === e.fn ? ps : undefined));
        if (!ok) { ps.delete(p); changed = true; }
      }
      if (!ps.size) out.delete(e.fn);
    }
  }
  return out;
}
// How many times input p is read on the way through e that reads it most:
// Infinity where it is read other than to push onto, give back (ans: e is
// an answer) or hand to f itself in place p.
function usesOf(e: SExpr, p: number, fi: number, ans: boolean): number {
  const sum = (xs: SExpr[]) => xs.reduce((n, x) => n + usesOf(x, p, fi, false), 0);
  const mine = (x: SExpr | undefined) => x?.k === "local" && x.i === p;
  switch (e.k) {
    case "local": return e.i === p ? (ans ? 1 : Infinity) : 0;
    case "rt": if (PUSH.test(e.fn) && mine(e.args[0])) return 1 + sum(e.args.slice(1)); break;
    case "call": if (e.fn === fi && !e.cps && mine(e.args[p])) return 1 + sum(e.args.filter((_, j) => j !== p)); break;
    case "let": return usesOf(e.value, p, fi, false) + usesOf(e.body, p, fi, ans);
    case "if": return usesOf(e.cond, p, fi, false) + Math.max(usesOf(e.then, p, fi, ans), usesOf(e.else, p, fi, ans));
    case "case": return usesOf(e.scrut, p, fi, false) + Math.max(0, ...e.arms.map((a) => (a ? usesOf(a, p, fi, ans) : 0)));
  }
  return sum(kids(e));
}

// The values a body gives back: through lets, ifs and a match's arms.
function answers(e: SExpr): SExpr[] {
  switch (e.k) {
    case "let": return answers(e.body);
    case "if": return [...answers(e.then), ...answers(e.else)];
    case "case": return e.arms.flatMap((a) => (a ? answers(a) : []));
    default: return [e];
  }
}

// The new answer a function may have, from its first answer that says.
function shapeOf(g: SFunc, own?: Set<number>): Fresh | undefined {
  if (g.multi) return undefined;
  const push = (e: SExpr) => { const v = last(e); return (v.k === "rt" && PUSH.test(v.fn)) || (v.k === "local" && !!own?.has(v.i)); };
  for (const v of answers(g.body)) {
    if (push(v)) return "whole";
    if (v.k === "make" || v.k === "new") { const j = v.args.findIndex(push); if (j >= 0) return j; }
  }
  return undefined;
}
// What lets end in.
const last = (e: SExpr): SExpr => (e.k === "let" ? last(e.body) : e);

// A new array: a push, or the empty one (shared, so never changed: the
// runtime sees it has no items), or a call giving one back; or no answer.
function isFresh(v: SExpr, s: Fresh, ir: CoreIR, fresh: Map<number, Fresh>, own?: Set<number>): boolean {
  if (v.k === "fail") return true;
  if (s === "whole") return newArray(v, ir, fresh, own);
  return (v.k === "make" || v.k === "new") && !!v.args[s] && newArray(v.args[s], ir, fresh, own);
}
// own: the inputs carrying an array being built, where e is read.
function newArray(e: SExpr, ir: CoreIR, fresh: Map<number, Fresh>, own?: Set<number>): boolean {
  const v = last(e);
  if (v.k === "local") return !!own?.has(v.i);
  if (v.k === "rt") return PUSH.test(v.fn) || EMPTY.test(v.fn) || /^array\.pushFrontOwned\./.test(v.fn);
  if (v.k === "call" && !v.cps) {
    if (fresh.get(v.fn) === "whole") return true;
    // A function of no inputs giving the empty array (`array nil`), kept
    // once made: shared, but empty.
    const g = ir.funcs[v.fn];
    return g.params.length === 0 && g.body.k === "rt" && EMPTY.test(g.body.fn);
  }
  return false;
}
