// A closure given to functions made for it, as what it captured (C327e
// on WebAssembly). The lowering writes `any`, `map`, `keep` and the like
// again for each function given them, a copy calling that function's code
// straight (`any pass·contains.λ`), and the copy still takes the closure,
// only to hand it to the code, which reads what it captured from it. So
// where every call of such a copy gives it, in one place, a closure of
// one code, or the closure its caller was given there, and the copy only
// hands it to the code or to another such place, the copy takes the
// captures instead, and so does a copy of the code: no closure is made.
// mini's `is number` makes 880 k fewer, typeset's `contains` 3.2 M.
//
// Not where the function is a closure's code itself, where the code reads
// itself other than by its captures, or where it carries a derivative.

import { kids, mapKids, mapLocals, type CoreIR, type SExpr, type SFunc } from "./scalar.ts";

type Closure = SExpr & { k: "closure" };

const walk = (e: SExpr, f: (x: SExpr) => void) => { f(e); kids(e).forEach((x) => walk(x, f)); };
// A place: function h's input m.
const key = (h: number, m: number) => `${h} ${m}`;

export function closureParts(ir: CoreIR): number {
  const { funcs } = ir;
  const derived = ir.derived ?? new Map();
  const codes = new Set<number>();
  funcs.forEach((f) => walk(f.body, (x) => { if (x.k === "closure") codes.add(x.fn); }));
  // Each place's code (and shape), from the closures given there: one
  // code, or the place is dropped.
  const code = new Map<string, { l: number; shape: number } | null>();
  funcs.forEach((f, h) => {
    if (codes.has(h) || f.multi || f.spends || f.budgeted) return;
    f.params.forEach((t, m) => { if (typeof t !== "string" && "params" in t && !derived.has(t.key)) code.set(key(h, m), { l: -1, shape: -1 }); });
  });
  funcs.forEach((f) => walk(f.body, (x) => {
    if (x.k !== "call") return;
    x.args.forEach((a, m) => {
      const k = key(x.fn, m), c = code.get(k);
      if (!c || a.k !== "closure") return;
      if (a.d !== undefined || (c.l >= 0 && c.l !== a.fn)) code.set(k, null);
      else code.set(k, { l: a.fn, shape: a.shape });
    });
  }));
  // And the closures given on: a place given its caller's place.
  for (let more = true; more;) {
    more = false;
    funcs.forEach((f, g) => walk(f.body, (x) => {
      if (x.k !== "call") return;
      x.args.forEach((a, m) => {
        const k = key(x.fn, m), c = code.get(k), from = a.k === "local" && a.i < f.params.length ? code.get(key(g, a.i)) : undefined;
        if (!c || !from || from.l < 0) return;
        if (c.l < 0) { code.set(k, { ...from }); more = true; } else if (c.l !== from.l) { code.set(k, null); more = true; }
      });
    }));
  }
  // The code reads itself by its captures alone.
  const selfless = (l: number) => { let self = false; walk(funcs[l].body, (x) => { if (x.k === "local" && x.i === 0) self = true; }); return funcs[l].params.length > 0 && !self; };
  for (const [k, c] of code) if (!c || c.l < 0 || !selfless(c.l)) code.delete(k);
  // Dropped until none is: a place given anything but its code's closure
  // or another place of the same code, or whose function uses what it was
  // given anywhere but in the code's first place or another such place.
  const at = (h: number, m: number) => code.get(key(h, m));
  const sameAs = (h: number, m: number, l: number) => at(h, m)?.l === l;
  let changed = true;
  while (changed) {
    changed = false;
    funcs.forEach((f, g) => walk(f.body, (x) => {
      if (x.k !== "call") return;
      x.args.forEach((a, m) => {
        const c = at(x.fn, m);
        if (!c) return;
        const fine = (a.k === "closure" && a.fn === c.l) || (a.k === "local" && a.i < f.params.length && sameAs(g, a.i, c.l));
        if (!fine) { code.delete(key(x.fn, m)); changed = true; }
      });
    }));
    for (const [k, c] of [...code]) {
      const [h, m] = k.split(" ").map(Number);
      let fine = true;
      const look = (x: SExpr, under: SExpr | null, j: number) => {
        if (x.k === "local" && x.i === m) {
          const u = under?.k === "call" ? under : null;
          if (!u || !((u.fn === c!.l && j === 0) || sameAs(u.fn, j, c!.l))) fine = false;
          return;
        }
        if ((x.k === "let" && x.i === m) || (x.k === "case" && x.s === m)) fine = false;
        kids(x).forEach((y) => look(y, x, x.k === "call" ? x.args.indexOf(y) : -1));
      };
      look(funcs[h].body, null, -1);
      if (!fine) { code.delete(k); changed = true; }
    }
  }
  if (!code.size) return 0;
  // Each code given its captures: a copy, its first input the captures.
  const parted = new Map<number, number>();
  const partsOf = (l: number, shape: number): number => {
    if (parted.has(l)) return parted.get(l)!;
    const c = funcs[l], caps = ir.shapes[shape].caps, n = caps.length;
    const swap = (x: SExpr): SExpr => (x.k === "cap" ? { k: "local", i: x.i } : mapKids(x, swap));
    const g: SFunc = { ...c, name: `${c.name}(parts)`, params: [...caps, ...c.params.slice(1)], locals: [...caps, ...c.locals.slice(1)], body: swap(mapLocals(c.body, (i) => i - 1 + n)), inner: true };
    parted.set(l, funcs.push(g) - 1);
    return parted.get(l)!;
  };
  for (const c of code.values()) partsOf(c!.l, c!.shape);
  // Each function: its places' captures where the place was, the other
  // locals moved on. A place's captures are first held as -1 - (m·4096 + k).
  for (let g = 0; g < funcs.length; g++) {
    const f = funcs[g];
    const places = f.params.map((_, m) => at(g, m));
    const caps = (m: number) => ir.shapes[places[m]!.shape].caps;
    const held = (m: number): SExpr[] => caps(m).map((_, k) => ({ k: "local", i: -1 - (m * 4096 + k) }));
    const redo = (x: SExpr): SExpr => {
      const y = mapKids(x, redo);
      if (y.k === "closure" || x.k !== "call" || y.k !== "call") return y;
      // The code, given a place's closure: its copy, given the captures.
      const a0 = x.args[0];
      if (a0?.k === "local" && places[a0.i] && places[a0.i]!.l === x.fn && parted.has(x.fn)) return { ...y, fn: parted.get(x.fn)!, args: [...held(a0.i), ...y.args.slice(1)] };
      if (![...Array(y.args.length).keys()].some((m) => at(x.fn, m))) return y;
      return { ...y, args: y.args.flatMap((a, m) => (!at(x.fn, m) ? [a] : a.k === "closure" ? (a as Closure).caps : a.k === "local" && a.i < 0 ? held(Math.floor((-1 - a.i) / 4096)) : x.args[m].k === "local" ? held((x.args[m] as { i: number }).i) : [a])) };
    };
    if (!places.some(Boolean) && !hasPlaced(f.body)) continue;
    // Where each input goes now.
    const to: number[] = [];
    let next = 0;
    f.params.forEach((_, m) => { to[m] = next; next += places[m] ? caps(m).length : 1; });
    const moved = next - f.params.length;
    const shift = (i: number) => (i < 0 ? to[Math.floor((-1 - i) / 4096)] + ((-1 - i) % 4096) : i < f.params.length ? to[i] : i + moved);
    funcs[g] = {
      ...f,
      params: f.params.flatMap((t, m) => (places[m] ? caps(m) : [t])),
      locals: [...f.params.flatMap((t, m) => (places[m] ? caps(m) : [t])), ...f.locals.slice(f.params.length)],
      body: mapLocals(redo(f.body), shift),
    };
  }
  return code.size;

  function hasPlaced(e: SExpr): boolean {
    let r = false;
    walk(e, (x) => { if (x.k === "call" && x.args.some((_, m) => at(x.fn, m))) r = true; });
    return r;
  }
}
