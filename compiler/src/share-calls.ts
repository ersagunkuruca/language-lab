// A call of a pure function made twice with the same inputs, in one
// function, where both are worked out whenever either is: made once, into
// a local both read (C189, GAPS.md round 12 B3). break's `moved` reads
// its ball's `heading` (a square root and a division) for its place and
// for its velocity: 28 to 25 ms.
//
// Pure: the function and everything it calls does nothing but compute,
// and always answers (not partial). Nothing is moved past a branch: the
// let goes at the smallest part holding both calls that runs each of
// them whenever it runs, and only where what the calls read is bound
// outside that part.

import type { CoreIR, SExpr } from "./scalar.ts";

const ONE = ["cond", "then", "else", "value", "body", "rec", "fn", "scrut", "otherwise", "ok", "reason", "arm", "release", "list", "dflt"] as const;
const MANY = ["args", "items", "caps", "arms"] as const;

type Slot = { key: string; at?: number };

function kids(e: SExpr): [Slot, SExpr][] {
  const out: [Slot, SExpr][] = [];
  const r = e as unknown as Record<string, unknown>;
  for (const k of ONE) { const x = r[k]; if (x && typeof x === "object" && "k" in x) out.push([{ key: k }, x as SExpr]); }
  for (const k of MANY) { const xs = r[k]; if (Array.isArray(xs)) xs.forEach((x, i) => { if (x && typeof x === "object" && "k" in x) out.push([{ key: k, at: i }, x as SExpr]); }); }
  return out;
}

// Whether a child runs whenever its parent does.
function always(e: SExpr, s: Slot): boolean {
  switch (e.k) {
    case "if": return s.key === "cond";
    case "case": return s.key === "scrut";
    case "op": return !(e.op === "and" || e.op === "or") || s.at === 0;
    case "let": case "call": case "make": case "new": case "rt": case "list": case "get": case "field": case "tag": case "closure": case "set": return true;
    default: return false;
  }
}

// Locals a node gives a value to.
function binds(e: SExpr): number[] {
  const r = e as unknown as Record<string, unknown>;
  switch (e.k) {
    case "let": return [e.i];
    case "case": return [e.s];
    case "attempt": return [e.res];
    case "budget": return [e.save, e.res];
    case "list": return [e.item, e.acc];
    case "apply": return [e.tmp];
    default: return ["save", "reason", "st", "res"].map((k) => r[k]).filter((x): x is number => typeof x === "number");
  }
}

// The runtime's functions that only read and compute (scalar.ts RT,
// ARRAY_RT's reads); not one that may change an array or a table in place.
const SAFE_RT = (fn: string) => /^(int\.|text\.|number\.|pick:|array\.(first|rest|length|at|of|items|empty)\.)/.test(fn);

// Functions that only compute: no world, no closures called, no effects
// handled or performed, no boxes set; and that always answer.
function pureFuncs(ir: CoreIR): Set<number> {
  const calls = ir.funcs.map(() => new Set<number>());
  // Effects nowhere in it (but calls), and no answer only inside an attempt.
  const answers = ir.funcs.map(() => true);
  const quiet = ir.funcs.map((f, i) => {
    let ok = true;
    const walk = (e: SExpr, tried: boolean) => {
      if (!ok) return;
      switch (e.k) {
        case "world": case "apply": case "abort": case "handle": case "released": case "set": case "choose": case "search": case "budget": ok = false; return;
        case "fail": if (!tried) answers[i] = false; return;
        case "rt": if (e.host || !SAFE_RT(e.fn)) { ok = false; return; } break;
        case "zero": if (e.none && !tried) answers[i] = false; break;
        case "call": if (e.cps) { ok = false; return; } if (ir.funcs[e.fn].partial && !tried) answers[i] = false; calls[i].add(e.fn); break;
        case "attempt": if (e.spent || e.resumes) { ok = false; return; } walk(e.body, true); walk(e.ok, tried); walk(e.otherwise, tried); return;
      }
      for (const [, k] of kids(e)) walk(k, tried);
    };
    walk(f.body, false);
    return ok && !f.multi;
  });
  const effectless = new Set(ir.funcs.map((_, i) => i).filter((i) => quiet[i]));
  for (let changed = true; changed;) {
    changed = false;
    for (const i of effectless) if ([...calls[i]].some((j) => !effectless.has(j))) { effectless.delete(i); changed = true; }
  }
  return new Set([...effectless].filter((i) => !ir.funcs[i].partial && answers[i]));
}

// An input read as it is: a constant, a local, a field of one.
function simple(e: SExpr): boolean {
  switch (e.k) {
    case "num": case "int": case "bool": case "text": case "local": return true;
    case "get": case "field": return simple(e.rec);
    default: return false;
  }
}
function readsOf(e: SExpr, out: Set<number> = new Set()): Set<number> {
  if (e.k === "local") out.add(e.i);
  for (const [, k] of kids(e)) readsOf(k, out);
  return out;
}
// A simple input as text, and a call of simple inputs.
function said(e: SExpr): string {
  switch (e.k) {
    case "num": return `n${e.v}`;
    case "int": return `i${e.v}`;
    case "bool": return `b${e.v}`;
    case "text": return `t${JSON.stringify(e.v)}`;
    case "local": return `l${e.i}`;
    case "get": return `g${e.i}(${said(e.rec)})`;
    case "field": return `f${e.c}.${e.i}(${said(e.rec)})`;
    default: return "?";
  }
}
const keyOf = (e: Extract<SExpr, { k: "call" }>) => `${e.fn}(${e.args.map(said).join(",")})`;
// A node and the nodes in it copied; the types they carry kept as they are.
function copy(e: SExpr): SExpr {
  const out = { ...e } as unknown as Record<string, unknown>;
  for (const k of ONE) { const x = out[k]; if (x && typeof x === "object" && "k" in x) out[k] = copy(x as SExpr); }
  for (const k of MANY) { const xs = out[k]; if (Array.isArray(xs)) out[k] = xs.map((x) => (x && typeof x === "object" && "k" in x ? copy(x as SExpr) : x)); }
  return out as unknown as SExpr;
}

export function shareCalls(ir: CoreIR): number {
  const pure = pureFuncs(ir);
  let shared = 0;
  ir.funcs.forEach((f) => {
    // The body is changed in place: a copy first, as a node may be shared.
    let copied = false;
    for (let round = 0; round < 32; round++) {
      // Each candidate call with its path from the body: the slots taken.
      const seen = new Map<string, { node: SExpr; paths: [SExpr, Slot][][] }>();
      const walk = (e: SExpr, path: [SExpr, Slot][]) => {
        if (e.k === "call" && !e.cps && !e.tail && pure.has(e.fn) && e.args.every(simple)) {
          const k = keyOf(e);
          const s = seen.get(k) ?? { node: e, paths: [] };
          s.paths.push(path);
          seen.set(k, s);
        }
        for (const [slot, k] of kids(e)) walk(k, [...path, [e, slot]]);
      };
      walk(f.body, []);
      let done = false;
      for (const { node, paths } of seen.values()) {
        if (paths.length < 2) continue;
        // The common part: the longest prefix of the paths.
        let n = 0;
        while (paths.every((p) => p.length > n && p[n][0] === paths[0][n][0] && p[n][1].key === paths[0][n][1].key && p[n][1].at === paths[0][n][1].at)) n++;
        // At n the paths part (or one call holds another, n = its length).
        const top = n < paths[0].length ? paths[0][n][0] : null;
        if (!top || !paths.every((p) => p[n][0] === top)) continue;
        if (!paths.every((p) => p.slice(n).every(([e, s]) => always(e, s)))) continue;
        // What the calls read is bound outside the part.
        const reads = readsOf(node);
        const bound = new Set<number>();
        const collect = (e: SExpr) => { for (const b of binds(e)) bound.add(b); for (const [, k] of kids(e)) collect(k); };
        collect(top);
        if ([...reads].some((r) => bound.has(r))) continue;
        if (!copied) { copied = true; f.body = copy(f.body); done = true; break; }
        // let t = call in top, each call t.
        const call = node as Extract<SExpr, { k: "call" }>;
        const t = f.locals.push(ir.funcs[call.fn].result) - 1;
        for (const p of paths) {
          const [parent, slot] = p[p.length - 1];
          const r = parent as unknown as Record<string, unknown>;
          if (slot.at === undefined) r[slot.key] = { k: "local", i: t };
          else (r[slot.key] as SExpr[])[slot.at] = { k: "local", i: t };
        }
        const moved = { ...top } as SExpr;
        const wrapped: SExpr = { k: "let", i: t, value: { ...call, args: call.args.map(copy) }, body: moved };
        // Put the let where top was.
        const holder = n > 0 ? paths[0][n - 1] : null;
        if (!holder) f.body = wrapped;
        else {
          const r = holder[0] as unknown as Record<string, unknown>;
          if (holder[1].at === undefined) r[holder[1].key] = wrapped;
          else (r[holder[1].key] as SExpr[])[holder[1].at] = wrapped;
        }
        shared++;
        done = true;
        break;
      }
      if (!done) break;
    }
  });
  return shared;
}
