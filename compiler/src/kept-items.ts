// The answers of a choice over an array's items, gathered into an array,
// as a loop pushing them (G1b1). `keep` over a List kept as an array
// (the greenhouse's moths, `keep(things, is moth)`) lowers as every `all`
// of a `choose` does: a list of the array's items taken apart a cell at a
// time, each answer consed onto a list in a box, the list reversed and an
// array made of it. Here it is what a C programmer writes: a loop over
// the positions, each answer pushed onto the array it makes, an item
// with no answer (the test failed, or said no) left out. Nothing reads
// the array by its list, so its items can be columns (columns.ts).
//
// The shape, as scalar.ts lowers it:
//   F(a, …) = array.of(let box = Box(nil); [let h = split.hold()];
//               let r = attempt C(choose.split?(array.items(a)), box, …)
//                       ok reverse(box.0, nil) else reverse(box.0, nil);
//               [split.give(h)]; r)
//   C(l, box, …) = case l: nil → fail
//                  | cons(x, rest) → attempt (box.0 := cons(V, box.0); fail)
//                                    else C(rest, box, …)
// becomes F(a, …) = L(a, 0, empty, …) with
//   L(a, i, out, …) = if i < length(a) then let x = a[i];
//                     L(a, i + 1, attempt V ok push(out, V) else out, …) else out
// V reads only x and the inputs after the box.

import { kids, mapKids, type CoreIR, type DType, type LType, type SExpr, type SFunc } from "./scalar.ts";

const OF = /^array\.of\.a(\d+)$/, ITEMS = /^array\.items\.a(\d+)$/;
type Call = Extract<SExpr, { k: "call" }>;
const isLocal = (e: SExpr | undefined, i: number) => e?.k === "local" && e.i === i;
const reads = (e: SExpr, i: number): boolean => isLocal(e, i) || kids(e).some((x) => reads(x, i));

export function keptItems(ir: CoreIR, opts: { ints?: boolean } = {}): number {
  // The position: a Float64 on JavaScript, an Int on C and WebAssembly
  // (as array-offsets.ts has it).
  const ints = !!opts.ints, pos: LType = ints ? "int" : "f64";
  let made = 0;
  const n0 = ir.funcs.length;
  for (let fi = 0; fi < n0; fi++) {
    const f = ir.funcs[fi], b = f.body;
    const of = b.k === "rt" ? OF.exec(b.fn) : null;
    if (!of || b.k !== "rt" || b.args.length !== 1) continue;
    const n = of[1];
    // The lets before the attempt: the box, and a thread's split held.
    let e = b.args[0];
    const box = e.k === "let" && e.value.k === "make" && e.value.args.length === 1 && e.value.args[0].k === "new" ? e.i : -1;
    if (box < 0 || e.k !== "let") continue;
    e = e.body;
    let held = -1;
    if (e.k === "let" && e.value.k === "rt" && e.value.fn === "split.hold") { held = e.i; e = e.body; }
    if (e.k !== "let" || e.value.k !== "attempt") continue;
    const r = e.i, at = e.value;
    let tail = e.body;
    if (held >= 0) {
      if (tail.k !== "let" || tail.value.k !== "rt" || tail.value.fn !== "split.give" || !isLocal(tail.value.args[0], held)) continue;
      tail = tail.body;
    }
    if (!isLocal(tail, r)) continue;
    // The answers reversed, whichever way the choice ends.
    const reversed = (x: SExpr) => x.k === "call" && x.args.length === 2 && x.args[0].k === "get" && isLocal(x.args[0].rec, box) && x.args[0].i === 0 && x.args[1].k === "new";
    if (!reversed(at.ok) || !reversed(at.otherwise) || at.body.k !== "call" || at.body.cps) continue;
    const call = at.body as Call;
    let given = call.args[0];
    if (given.k === "rt" && given.fn === "choose.split") given = given.args[0];
    const items = given.k === "rt" ? ITEMS.exec(given.fn) : null;
    if (!items || items[1] !== n || given.k !== "rt" || !isLocal(call.args[1], box)) continue;
    const ci = call.fn, c = ir.funcs[ci];
    const v = chooser(c, ci);
    if (!v || c.params.length !== call.args.length) continue;
    // The inputs after the box: worked out once, before the loop.
    const rest = call.args.slice(2);
    if (!rest.every((x) => x.k === "local" || x.k === "num" || x.k === "int" || x.k === "bool" || x.k === "text")) continue;
    const at0 = ir.arrays[Number(n)];
    const arrayT = at0 as unknown as LType;
    // The loop: a, i, out, then C's inputs after the box; C's other locals
    // one further up (C's l0, the list, and l1, the box, no longer read).
    const np = c.params.length;
    const shift = (i: number) => (i < 2 ? -1 : i + 1);
    const g: SFunc = {
      def: c.def, name: `${f.name}.kept`, params: [arrayT, pos, arrayT, ...c.params.slice(2)], result: arrayT,
      locals: [arrayT, pos, arrayT, ...c.locals.slice(2, np), ...c.locals.slice(np)], body: { k: "fail" },
      spends: c.spends, budgeted: c.budgeted, inner: true,
    };
    const xi = g.locals.push(at0.item) - 1, pushed = g.locals.push(arrayT) - 1, res = g.locals.push(at0.item) - 1;
    const moved = (e: SExpr): SExpr => {
      const y = mapKids(e, moved);
      const m = (i: number) => (i === v.x ? xi : shift(i));
      switch (y.k) {
        case "local": return { k: "local", i: m(y.i) };
        case "let": return { ...y, i: m(y.i) };
        case "case": return { ...y, s: m(y.s) };
        case "attempt": case "search": return { ...y, res: m(y.res) };
        case "apply": return { ...y, tmp: m(y.tmp) };
        default: return y;
      }
    };
    const gi = ir.funcs.length;
    const loc = (i: number): SExpr => ({ k: "local", i });
    g.body = {
      k: "if",
      cond: { k: "rt", fn: "int.less", args: [{ k: "int", v: 0n }, ints ? { k: "rt", fn: "int.sub", args: [{ k: "rt", fn: `array.length.a${n}`, args: [loc(0)] }, loc(1)] } : { k: "op", op: "sub", args: [{ k: "rt", fn: `array.length.a${n}`, args: [loc(0)] }, loc(1)] }] },
      then: {
        k: "let", i: xi, value: { k: "rt", fn: `array.get.a${n}`, args: [loc(0), loc(1)] },
        body: {
          k: "let", i: pushed,
          // The answer worked out, then pushed: the array is used once
          // on either way (on C, pushed onto in place).
          value: { k: "attempt", body: moved(v.value), res, ok: { k: "rt", fn: `array.push.a${n}`, args: [loc(2), loc(res)] }, otherwise: loc(2), t: arrayT },
          body: { k: "call", fn: gi, args: [loc(0), ints ? { k: "rt", fn: "int.add", args: [loc(1), { k: "int", v: 1n }] } : { k: "op", op: "add", args: [loc(1), { k: "num", v: 1 }] }, loc(pushed), ...rest.map((_, j) => loc(3 + j))], tail: true },
        },
      },
      else: loc(2),
      t: arrayT,
    };
    ir.funcs.push(g);
    f.body = { k: "call", fn: gi, args: [given.args[0], ints ? { k: "int", v: 0n } : { k: "num", v: 0 }, { k: "rt", fn: `array.empty.a${n}`, args: [] }, ...rest], tail: true };
    made++;
  }
  return made;
}

// C's answer V, and the local holding the item, when C is the chooser
// above: V reads neither the list, nor the box, nor the list's rest.
function chooser(c: SFunc, ci: number): { value: SExpr; x: number } | null {
  const b = c.body;
  if (b.k !== "case" || !isLocal(b.scrut, 0) || c.params.length < 2) return null;
  const t = b.t as DType, cons = t.cases?.findIndex((x) => x.fields.length === 2);
  if (cons === undefined || cons < 0 || t.cases.length !== 2 || b.arms.length !== 2) return null;
  const nil = b.arms[1 - cons], arm = b.arms[cons];
  if (nil?.k !== "fail" || arm?.k !== "let") return null;
  const head = t.cases[cons].fields.findIndex((x) => x.t !== t), restAt = 1 - head;
  if (head < 0 || t.cases[cons].fields[restAt].t !== t) return null;
  // let x = l.head; let rest = l.rest (in either order).
  const lets: Record<number, number> = {};
  let e: SExpr = arm;
  while (e.k === "let" && e.value.k === "field" && isLocal(e.value.rec, 0) && e.value.c === cons) { lets[e.value.i] = e.i; e = e.body; }
  const x = lets[head], rest = lets[restAt];
  if (x === undefined || rest === undefined || e.k !== "attempt") return null;
  const s = e.body;
  if (s.k !== "set" || !isLocal(s.rec, 1) || s.i !== 0 || s.then.k !== "fail") return null;
  const cell = s.value;
  if (cell.k !== "new" || cell.c !== cons || cell.args.length !== 2) return null;
  const tailOf = cell.args[restAt];
  if (tailOf.k !== "get" || !isLocal(tailOf.rec, 1) || tailOf.i !== 0) return null;
  if (!isLocal(e.ok, e.res)) return null;
  const again = e.otherwise;
  if (again.k !== "call" || again.fn !== ci || !again.tail || again.cps || !isLocal(again.args[0], rest) || !isLocal(again.args[1], 1)) return null;
  if (!again.args.slice(2).every((a, j) => isLocal(a, j + 2))) return null;
  const value = cell.args[head];
  const binds = (e: SExpr): boolean => e.k === "list" || e.k === "handle" || e.k === "budget" || kids(e).some(binds);
  if (binds(value)) return null;
  if (reads(value, 0) || reads(value, 1) || reads(value, rest)) return null;
  return { value, x };
}

// A loop going up an array's positions and putting what it keeps in
// front of an array it builds (`pool items`: the pool's slots, newest
// first, each item put in front of those after it) builds the same array
// going down the positions and pushing each at the end (G1b2), which
// columns can grow (columns.ts `grow`). The loop counts its rounds as it
// did; round i reads the item at length − 1 − i. Only a loop that does
// nothing else, so that the order it reads its items in can't tell:
//   L(a, out, i) = if 0 < length(a) − i then let s = a[i]; … L(a, out′, i + 1) … else out
// with out′ the array it built, or one item put in front of it, and its
// other inputs as they were. JavaScript (positions are Float64s).
const QUIET = new Set(["if", "let", "case", "field", "get", "local", "num", "int", "bool", "op", "make", "new"]);
// A function that only reads: quiet kinds, an array's items and length,
// arithmetic, and calls of functions that only read; a read past the
// end tried, giving another value instead (`item at`'s).
const READ_RT = /^(array\.(get|at|length)\.a\d+|int\.[a-zA-Z]+|f64\.[a-zA-Z]+)$/;
const quietMemo = new WeakMap<CoreIR, Map<number, boolean>>();
function quiet(ir: CoreIR, g: number, seen: Set<number>): boolean {
  let memo = quietMemo.get(ir);
  if (!memo) quietMemo.set(ir, (memo = new Map()));
  if (memo.has(g)) return memo.get(g)!;
  if (seen.has(g)) return false;
  seen.add(g);
  const f = ir.funcs[g];
  const ok = !f.multi && !f.inner && (function check(e: SExpr): boolean {
    if (e.k === "call") return !e.cps && (e.fn === g || quiet(ir, e.fn, seen)) && e.args.every(check);
    if (e.k === "rt") return READ_RT.test(e.fn) && e.args.every(check);
    return (QUIET.has(e.k) || e.k === "attempt") && kids(e).every(check);
  })(f.body);
  memo.set(g, ok);
  return ok;
}
export function pushedInOrder(ir: CoreIR): number {
  let made = 0;
  ir.funcs.forEach((f, fi) => {
    const b = f.body;
    if (b.k !== "if") return;
    const c = b.cond;
    // 0 < length(a) − i, i an input, a an input.
    if (c.k !== "rt" || c.fn !== "int.less" || c.args[0].k !== "int" || c.args[0].v !== 0n) return;
    const d = c.args[1];
    if (d.k !== "op" || d.op !== "sub" || d.args[0].k !== "rt" || !/^array\.length\.a\d+$/.test(d.args[0].fn) || d.args[1].k !== "local") return;
    const len = d.args[0], a = len.args[0], i = d.args[1].i;
    if (a.k !== "local" || a.i >= f.params.length || i >= f.params.length) return;
    // The array built: the input given back where the loop ends.
    if (b.else.k !== "local" || b.else.i >= f.params.length) return;
    const out = b.else.i, n = (len as Extract<SExpr, { k: "rt" }>).fn.split(".").pop()!;
    let ok = true, fronts = 0;
    const PUT = /^array\.pushFront\.a\d+$/;
    // A call that only reads, and not by i (a pool's slots read at an
    // item's slot, L280f), can't tell the order either.
    const readsOnly = (g: number): boolean => quiet(ir, g, new Set([fi]));
    const look = (e: SExpr): void => {
      if (!ok) return;
      if (e.k === "call" && e.fn === fi && !e.cps) {
        if (!e.tail) { ok = false; return; }
        e.args.forEach((x, k) => {
          if (k === i) { if (!(x.k === "op" && x.op === "add" && isLocal(x.args[0], i) && x.args[1].k === "num" && x.args[1].v === 1)) ok = false; return; }
          if (k === out) {
            if (isLocal(x, out)) return;
            if (x.k === "rt" && PUT.test(x.fn) && isLocal(x.args[0], out) && !reads(x.args[1], out)) { fronts++; look(x.args[1]); return; }
            ok = false; return;
          }
          if (!isLocal(x, k)) ok = false;
        });
        return;
      }
      if (e.k === "call" && e.fn !== fi && !e.cps && readsOnly(e.fn) && !e.args.some((x) => reads(x, out) || reads(x, a.i) || reads(x, i))) { e.args.forEach(look); return; }
      if (e.k === "rt") {
        // The item at i read, and nothing else of the array.
        if (/^array\.get\.a\d+$/.test(e.fn) && isLocal(e.args[0], a.i) && isLocal(e.args[1], i)) return;
        // Arithmetic, and other arrays read.
        if (READ_RT.test(e.fn) && !e.args.some((x) => reads(x, out) || reads(x, a.i) || reads(x, i))) { e.args.forEach(look); return; }
        ok = false; return;
      }
      if (isLocal(e, out) || isLocal(e, a.i) || isLocal(e, i)) { ok = false; return; }
      if (!QUIET.has(e.k)) { ok = false; return; }
      kids(e).forEach(look);
    };
    look(b.then);
    if (!ok || !fronts) return;
    // Round i reads the item at length − 1 − i, and pushes it at the end.
    const at = (): SExpr => ({ k: "op", op: "sub", args: [{ k: "op", op: "sub", args: [{ k: "rt", fn: `array.length.${n}`, args: [{ k: "local", i: a.i }] }, { k: "num", v: 1 }] }, { k: "local", i }] });
    const k = f.locals.push("f64") - 1;
    const go = (e: SExpr): SExpr => {
      const x = mapKids(e, go);
      if (x.k === "rt" && /^array\.get\.a\d+$/.test(x.fn) && isLocal(x.args[1], i)) return { ...x, args: [x.args[0], { k: "local", i: k }] };
      if (x.k === "rt" && PUT.test(x.fn)) return { ...x, fn: x.fn.replace("pushFront", "push") };
      return x;
    };
    // (The position a local, as columns.ts reads an item at.)
    f.body = { ...b, then: { k: "let", i: k, value: at(), body: go(b.then) } };
    made++;
  });
  return made;
}
