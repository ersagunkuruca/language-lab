// A record a loop carries, as separate values (C68a): a function that
// calls itself only as its loop's next round, given a record it reads by
// field and builds afresh for each round (wc's counts, made for every
// character), takes the record's fields as values of their own instead,
// so no record is made per round, on any target (JavaScript's objects,
// WebAssembly's structs). The record is made only where it is used whole:
// given back at the end, or passed on to something else. The function
// keeps its name and inputs and calls the loop, a new inner function, at
// once; that call spends in its place where calls are counted.
// Prior art: scalar replacement of aggregates (LLVM's SROA), and GHC's
// worker/wrapper split with constructed product results.
import type { Id } from "../../ters/src/model.ts";
import type { CoreIR, RType, SExpr, SFunc } from "./scalar.ts";
import { isRecord, kids, mapKids, mapLocals } from "./scalar.ts";

export function loopRecords(ir: CoreIR): void {
  // A record some code changes in place (a search's box) stays one.
  const changed = new Set<string>();
  const walk = (e: SExpr) => { if (e.k === "set") changed.add(e.t.key); kids(e).forEach(walk); };
  ir.funcs.forEach((f) => walk(f.body));
  // Functions handed out as values, or called other than as a loop.
  const handed = new Set<number>();
  const calls = (e: SExpr, f: number) => {
    if (e.k === "closure") handed.add(e.fn);
    if (e.k === "call" && e.fn === f && (!e.tail || e.cps)) handed.add(f);
    kids(e).forEach((x) => calls(x, f));
  };
  ir.funcs.forEach((f, i) => calls(f.body, i));
  const count = ir.funcs.length;
  for (let fi = 0; fi < count; fi++) {
    const f = ir.funcs[fi];
    if (handed.has(fi) || f.multi || f.answer !== undefined || f.value) continue;
    const j = f.params.findIndex((t, p) => isRecord(t) && t.fields.length > 0 && !changed.has(t.key) && carried(f, fi, p, t));
    if (j < 0) continue;
    split(ir, fi, j, f.params[j] as RType);
  }
}

// Is the record in input p made afresh, or passed on as it is, for every
// next round, read by field somewhere, and never set as a local?
function carried(f: SFunc, fi: number, p: number, t: RType): boolean {
  let rounds = 0, reads = 0, ok = true;
  const walk = (e: SExpr) => {
    if (!ok) return;
    if (e.k === "call" && e.fn === fi) {
      rounds++;
      const a = made(e.args[p]).value;
      if (!((a.k === "make" && a.t.key === t.key) || (a.k === "local" && a.i === p))) ok = false;
      // The lets around a record made go before the call, after the
      // inputs before it, which must read nothing that could change.
      if (made(e.args[p]).lets.length && !e.args.slice(0, p).every(plain)) ok = false;
    }
    if (e.k === "get" && e.rec.k === "local" && e.rec.i === p && e.t.key === t.key) reads++;
    if ((e.k === "let" && e.i === p) || (e.k === "case" && e.s === p) || ((e.k === "attempt" || e.k === "search") && e.res === p)
      || (e.k === "apply" && e.tmp === p) || (e.k === "list" && (e.item === p || e.acc === p)) || (e.k === "handle" && (e.reason === p || e.save === p))
      || (e.k === "budget" && (e.save === p || e.res === p))) ok = false;
    kids(e).forEach(walk);
  };
  walk(f.body);
  return ok && rounds > 0 && reads > 0;
}

function split(ir: CoreIR, fi: number, p: number, t: RType): void {
  const f = ir.funcs[fi], n = t.fields.length;
  // A field's local, before the locals after p move up to make room.
  const FIELD = -1;
  const fieldAt = (i: number): SExpr => ({ k: "local", i: FIELD - i });
  const fields = () => t.fields.map((_, i) => fieldAt(i));
  const gi = ir.funcs.length;
  const rw = (e: SExpr): SExpr => {
    if (e.k === "get" && e.rec.k === "local" && e.rec.i === p && e.t.key === t.key) return fieldAt(e.i);
    if (e.k === "local" && e.i === p) return { k: "make", t, args: fields() };
    if (e.k === "call" && e.fn === fi) {
      const { lets, value: a } = made(e.args[p]);
      const args = e.args.flatMap((x, i) => (i !== p ? [rw(x)] : a.k === "make" ? a.args.map(rw) : fields()));
      return lets.reduceRight<SExpr>((body, l) => ({ ...l, value: rw(l.value), body }), { ...e, fn: gi, args });
    }
    return mapKids(e, rw);
  };
  const at = (i: number) => (i <= FIELD ? p + (FIELD - i) : i < p ? i : i + n - 1);
  const params = [...f.params.slice(0, p), ...t.fields.map((x) => x.t), ...f.params.slice(p + 1)];
  const g: SFunc = {
    def: f.def, name: `${f.name}.loop`, params, result: f.result,
    locals: [...params, ...f.locals.slice(f.params.length)],
    body: mapLocals(rw(f.body), at), spends: f.spends, budgeted: f.budgeted, inner: true,
    ...(f.partial ? { partial: f.partial } : {}),
    // The binder each local holds, where they moved to (C143d).
    ...(f.binders ? { binders: f.binders.reduce<Id[]>((b, id, i) => { if (id && i !== p) b[at(i)] = id; return b; }, []) } : {}),
  };
  ir.funcs.push(g);
  const rec: SExpr = { k: "local", i: p };
  f.body = { k: "call", fn: gi, args: f.params.flatMap((_, i): SExpr[] => (i !== p ? [{ k: "local", i }] : t.fields.map((_, x) => ({ k: "get", rec, t, i: x })))), tail: true };
  f.locals = [...f.params];
  // The loop spends for each round, this call included, as f did.
  f.spends = false;
}

// A value under the lets that name its parts: wc's next counts are
// `let blank = … in make(…)`.
type Let = Extract<SExpr, { k: "let" }>;
function made(e: SExpr): { lets: Let[]; value: SExpr } {
  const lets: Let[] = [];
  while (e.k === "let") { lets.push(e); e = e.body; }
  return { lets, value: e };
}
const plain = (e: SExpr) => e.k === "local" || e.k === "num" || e.k === "int" || e.k === "text" || e.k === "bool";
