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
//
// The same for arithmetic made twice (C175): `sin(0.7 · t)` that each of
// a gradient's per-axis copies works out, or a shader's `p.x − 0.55 ·
// sin(1.1 · t)` written in two places. Only what computes on Float64s and
// Bools and always answers (no Int that may give up past 32 bits, no
// finiteness check); bit for bit the same, since each is worked out the
// same way once.

import { OPS, type CoreIR, type Op, type SExpr } from "./scalar.ts";

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

// Arithmetic that only computes and always answers.
const PURE_OPS = new Set<Op>(["add", "sub", "mul", "div", "neg", "sqrt", "abs", "floor", "float32", "sin", "cos", "tan", "exp", "log", "pow", "atan2", "mod", "less", "equal", "beq", "and", "or", "not", "itof"]);
// A value worked out from locals and constants by pure arithmetic, pure
// calls and records.
function pureTree(e: SExpr, pure: Set<number>): boolean {
  switch (e.k) {
    case "num": case "int": case "bool": case "text": case "local": return true;
    case "get": case "field": return pureTree(e.rec, pure);
    case "op": return PURE_OPS.has(e.op) && e.args.every((a) => pureTree(a, pure));
    case "make": case "new": return e.args.every((a) => pureTree(a, pure));
    case "call": return !e.cps && !e.tail && pure.has(e.fn) && e.args.every((a) => pureTree(a, pure));
    default: return false;
  }
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
// A type as a number, for keys: types are compared by identity.
const typeIds = new WeakMap<object, number>();
let typeCount = 0;
const typeId = (t: object) => { if (!typeIds.has(t)) typeIds.set(t, ++typeCount); return typeIds.get(t)!; };
// A pure value as text: equal text, the same value.
function said(e: SExpr): string {
  switch (e.k) {
    case "num": return `n${e.v}`;
    case "int": return `i${e.v}`;
    case "bool": return `b${e.v}`;
    case "text": return `t${JSON.stringify(e.v)}`;
    case "local": return `l${e.i}`;
    case "get": return `g${e.i}(${said(e.rec)})`;
    case "field": return `f${e.c}.${e.i}(${said(e.rec)})`;
    case "op": return `${e.op}(${e.args.map(said).join(",")})`;
    case "make": return `m${typeId(e.t)}(${e.args.map(said).join(",")})`;
    case "new": return `c${typeId(e.t)}.${e.c}(${e.args.map(said).join(",")})`;
    case "call": return `${e.fn}(${e.args.map(said).join(",")})`;
    default: return "?";
  }
}
// Whether a value has arithmetic or a call in it: worth a local. Not the
// sign of a local alone (−x costs nothing).
const works = (e: SExpr): boolean => (e.k === "op" ? !((e.op === "neg" || e.op === "not") && simple(e.args[0])) : e.k === "call" || ((e.k === "get" || e.k === "field") ? works(e.rec) : (e.k === "make" || e.k === "new") && e.args.some(works)));
// A node and the nodes in it copied; the types they carry kept as they are.
function copy(e: SExpr): SExpr {
  const out = { ...e } as unknown as Record<string, unknown>;
  for (const k of ONE) { const x = out[k]; if (x && typeof x === "object" && "k" in x) out[k] = copy(x as SExpr); }
  for (const k of MANY) { const xs = out[k]; if (Array.isArray(xs)) out[k] = xs.map((x) => (x && typeof x === "object" && "k" in x ? copy(x as SExpr) : x)); }
  return out as unknown as SExpr;
}

// Shared: a pure call (unless `calls` is false), and (`ops`) pure
// arithmetic over locals. WGSL keeps its calls, which its printer reads
// through for the GPU's own (x / |x| is normalize(x)).
export function shareCalls(ir: CoreIR, opts: { ops?: boolean; calls?: boolean } = {}): number {
  const pure = pureFuncs(ir);
  let shared = 0;
  ir.funcs.forEach((f) => {
    // The body is changed in place: a copy first, as a node may be shared.
    let copied = false;
    for (let round = 0; round < (opts.ops ? 512 : 32); round++) {
      // Each candidate call with its path from the body: the slots taken.
      const seen = new Map<string, { node: SExpr; paths: [SExpr, Slot][][] }>();
      const walk = (e: SExpr, path: [SExpr, Slot][]) => {
        if (e.k === "call" ? opts.calls !== false && !e.cps && !e.tail && pure.has(e.fn) && e.args.every(opts.ops ? (a) => pureTree(a, pure) : simple) : opts.ops && e.k === "op" && works(e) && pureTree(e, pure) && readsOf(e).size > 0) {
          const k = said(e);
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
        const t = f.locals.push(node.k === "call" ? ir.funcs[node.fn].result : OPS[(node as Extract<SExpr, { k: "op" }>).op].t) - 1;
        for (const p of paths) {
          const [parent, slot] = p[p.length - 1];
          const r = parent as unknown as Record<string, unknown>;
          if (slot.at === undefined) r[slot.key] = { k: "local", i: t };
          else (r[slot.key] as SExpr[])[slot.at] = { k: "local", i: t };
        }
        const moved = { ...top } as SExpr;
        const wrapped: SExpr = { k: "let", i: t, value: copy(node), body: moved };
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
