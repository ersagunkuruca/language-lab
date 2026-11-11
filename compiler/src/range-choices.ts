// A choice over a range's items made with no list (BACKLOG C207, on C).
// queens' `choose column from range n` lowers to a loop over a list
// (scalar.ts's "choose"): each placement fills an array with 0 … n − 1
// (`range`), makes a list of its items (`items of`), and the loop takes
// it apart a cell at a time. Hand-written C counts a column from 0 to n.
// Here a loop given `items of range x` (or that kept to one item by a
// thread's split, C43) gets a copy taking the range as one int64: its
// next item in the low 31 bits and its end in the 31 above; a range's
// list it stands for of 2^31 items or more would take tens of gigabytes,
// so such a range stops as out of memory. Both stay below 2^62, as
// i64.add needs. The list's end is the two being equal, its head
// the low half as a Float64, its rest the int64 plus one. The copy is
// made only where the loop takes the list apart and nothing else: its
// rest only goes round again.
import { kids, mapKids, type CoreIR, type DType, type SExpr } from "./scalar.ts";

const LOW = (1n << 31n) - 1n;
const ITEMS = /^array\.items\.a(\d+)$/, RANGE = /^array\.rangeF\.a(\d+)$/, OF = /^array\.of\.a(\d+)$/;

export function rangeChoices(ir: CoreIR): number {
  let made = 0;
  const n0 = ir.funcs.length;
  for (let i = 0; i < n0; i++) {
    const f = ir.funcs[i], b = f.body;
    if (b.k !== "case" || b.scrut.k !== "local" || b.scrut.i !== 0 || b.s !== 0 || typeof f.params[0] !== "object" || (f.params[0] as DType).key !== (b.t as DType).key) continue;
    const t = b.t as DType, c = t.cases.findIndex((x) => x.fields.length > 0);
    if (t.cases.length !== 2 || t.cases[1 - c].fields.length || t.cases[c].fields.length !== 2) continue;
    const hi = t.cases[c].fields.findIndex((x) => x.t === "f64"), ri = 1 - hi;
    if (hi < 0 || t.cases[c].fields[ri].t !== t) continue;
    // The calls giving it a range's items.
    const sites: { h: number; e: SExpr & { k: "call" } }[] = [];
    const given = (e: SExpr): SExpr | null => {
      const inner = e.k === "rt" && e.fn === "choose.split" ? e.args[0] : e;
      if (inner.k !== "rt" || !ITEMS.test(inner.fn)) return null;
      const r = inner.args[0];
      if (r.k === "rt" && RANGE.test(r.fn)) return r.args[0];
      // `array of range x`, as c.ts fills it (C207b).
      const n = r.k === "rt" && OF.test(r.fn) ? r.args[0] : null;
      return n && n.k === "rt" && n.fn === "number.range" ? n.args[0] : null;
    };
    ir.funcs.forEach((h, k) => {
      if (k === i) return;
      (function walk(e: SExpr) { if (e.k === "call" && e.fn === i && !e.cps && given(e.args[0])) sites.push({ h: k, e }); kids(e).forEach(walk); })(h.body);
    });
    if (!sites.length) continue;
    // The list only taken apart, its rest only going round again.
    const rests = new Set<number>();
    let ok = true;
    const look = (e: SExpr, top: boolean) => {
      if (!ok) return;
      if (e.k === "local" && e.i === 0 && !top) { ok = false; return; }
      if (e.k === "field" && e.rec.k === "local" && e.rec.i === 0) return;
      if (e.k === "let" && e.value.k === "field" && e.value.rec.k === "local" && e.value.rec.i === 0 && e.value.i === ri) { rests.add(e.i); look(e.body, false); return; }
      if (e.k === "local" && rests.has(e.i)) { ok = false; return; }
      if (e.k === "call" && e.fn === i && e.tail && !e.cps) {
        const a = e.args[0];
        if (!(a.k === "local" && rests.has(a.i))) { ok = false; return; }
        e.args.slice(1).forEach((x) => look(x, false));
        return;
      }
      if (e.k === "call" && e.fn === i) { ok = false; return; }
      kids(e).forEach((x) => look(x, false));
    };
    b.arms.forEach((a) => a && look(a, false));
    if (!ok || !rests.size) continue;
    // The copy.
    const g = ir.funcs.length;
    const locals = [...f.locals];
    locals[0] = "i64";
    for (const r of rests) locals[r] = "i64";
    const fresh = (): number => locals.push("i64") - 1;
    const lit = (v: bigint): SExpr => ({ k: "rt", fn: "i64.lit", args: [{ k: "int", v }] });
    const p: SExpr = { k: "local", i: 0 };
    const rw = (e: SExpr): SExpr => {
      if (e.k === "field" && e.rec.k === "local" && e.rec.i === 0) {
        if (e.i === ri) return { k: "rt", fn: "i64.add", args: [p, lit(1n)] };
        const low = fresh();
        return { k: "let", i: low, value: { k: "rt", fn: "i64.and", args: [p, lit(LOW)] }, body: { k: "rt", fn: "i64.toNumber", args: [{ k: "local", i: low }] } };
      }
      if (e.k === "call" && e.fn === i && e.tail) return { ...e, fn: g, args: e.args.map(rw) };
      return mapKids(e, rw);
    };
    const low = fresh(), high = fresh();
    const body: SExpr = {
      k: "let", i: low, value: { k: "rt", fn: "i64.and", args: [p, lit(LOW)] },
      body: { k: "let", i: high, value: { k: "rt", fn: "i64.shr", args: [p, lit(31n)] },
        body: { k: "if", cond: { k: "rt", fn: "i64.eq", args: [{ k: "local", i: low }, { k: "local", i: high }] }, then: rw(b.arms[1 - c]!), else: rw(b.arms[c]!), t: f.result } },
    };
    ir.funcs.push({ ...f, name: `${f.name} range`, inner: true, params: ["i64", ...f.params.slice(1)], locals, body });
    for (const { e } of sites) {
      const split = e.args[0].k === "rt" && e.args[0].fn === "choose.split";
      e.fn = g;
      e.args[0] = { k: "rt", fn: split ? "i64.rangeSplit" : "i64.range", args: [given(e.args[0])!] };
    }
    made++;
  }
  return made;
}
