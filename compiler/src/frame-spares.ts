// A deep loop's frames kept for the next (C327g part 2b, WebAssembly):
// deep-loops.ts's `$down` makes a frame a call, a case a call site
// holding the locals what comes after it reads and the frame under it,
// and `$up` reads one once, as the scrutinee of its case, and drops it.
// So a frame read is spare once its fields are: `$up` reads the locals
// and the frame under it first (`frame.take`, which puts the frame on
// its case's spare list, linked through its own `next`), and `$down`
// writes a spare one's fields again when there is one (`frame.new`), not
// making a struct a call. The frames a run holds at its deepest stay
// spare after it, as a fold stack's array does (C327d).
//
// Only where `$up`'s case is the one place a frame is read: any other
// read, or a frame still named after its fields are read, and the type's
// frames are made as before.

import { freeLocals, isData, kids, mapKids, type DType, type LType, type SExpr, type SFunc } from "./scalar.ts";

export const FRAME_FN = /^frame\.(new|take)\.(\d+)\.(\d+)$/;

export const deepFrames = (t: LType): t is DType => isData(t) && !!t.inner && /\$frames\.\d+$/.test(t.key);

// The frame types made spare, the functions rewritten in place: frames
// made by `frame.new.<data>.<case>`, read by `frame.take.<data>.<case>`.
export function frameSpares(funcs: SFunc[], data: DType[], skip: (d: DType) => boolean): DType[] {
  const out: DType[] = [];
  for (const d of data) {
    if (!deepFrames(d) || skip(d)) continue;
    const di = data.indexOf(d);
    // Every case on d and every field read of it.
    let cases = 0, fields = 0;
    const count = (e: SExpr) => { if (e.k === "case" && e.t.key === d.key) cases++; if (e.k === "field" && e.t.key === d.key) fields++; kids(e).forEach(count); };
    funcs.forEach((f) => count(f.body));
    const ui = funcs.findIndex((f) => f.body.k === "case" && f.body.t.key === d.key && f.body.scrut.k === "local");
    if (cases !== 1 || ui < 0) continue;
    const u = funcs[ui], top = u.body as SExpr & { k: "case" }, s = top.s;
    const nx = u.locals.length;
    let seen = 0, ok = true;
    const arms = top.arms.map((arm, c): SExpr | null => {
      if (!arm || c === 0 || !ok) return arm;
      const n = d.cases[c].fields.length;
      // The locals read first, then what comes after, its `next` the local.
      const lets: (SExpr & { k: "let" })[] = [];
      let e = arm;
      while (e.k === "let" && e.value.k === "field" && e.value.rec.k === "local" && e.value.rec.i === s && e.value.t.key === d.key && e.value.c === c && e.value.i < n - 1) { lets.push(e); e = e.body; }
      seen += lets.length;
      const swap = (x: SExpr): SExpr => {
        if (x.k === "field" && x.rec.k === "local" && x.rec.i === s && x.t.key === d.key && x.c === c && x.i === n - 1) { seen++; return { k: "local", i: nx }; }
        return mapKids(x, swap);
      };
      const rest = swap(e);
      if (freeLocals(rest).includes(s)) { ok = false; return arm; }
      const taken: SExpr = { k: "let", i: nx, value: { k: "rt", fn: `frame.take.${di}.${c}`, args: [{ k: "local", i: s }] }, body: rest };
      return lets.reduceRight<SExpr>((body, l) => ({ ...l, body }), taken);
    });
    if (!ok || seen !== fields) continue;
    funcs[ui] = { ...u, locals: [...u.locals, d], body: { ...top, arms } };
    const made = (e: SExpr): SExpr => {
      const x = mapKids(e, made);
      return x.k === "new" && x.t.key === d.key && x.c > 0 ? { k: "rt", fn: `frame.new.${di}.${x.c}`, args: x.args } : x;
    };
    funcs.forEach((f, i) => { funcs[i] = { ...f, body: made(f.body) }; });
    out.push(d);
  }
  return out;
}
