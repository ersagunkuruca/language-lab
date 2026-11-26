// A function that only computes, works through a loop and is called
// again with the very inputs it was last called with: its last answer
// kept with those inputs, and given again (C352, compiled JavaScript).
// fit's damped Gauss-Newton works out `sse of(model, q, pts)` to judge a
// step, and the next `step(model, q, pts)` then works out the same sums
// at the same parameters, the same record and the same points: every
// measurement's model and slopes twice, where the hand-written ideal keeps
// the sums it judged by (51 million model evaluations to its 20).
//
// The same: a function that does nothing but compute (no world, no
// closure applied, no effect handled, no box set, nothing written in
// place), deterministic, gives the same answer for the same inputs, its
// failure included. Inputs are the same when each is the same value or
// object (Object.is: 0 and -0 differ). An object input stays the same
// only where nothing changes one in place: a record never written into,
// an array no owned replace or push writes; a list's cells may be (C279),
// so no list is an input. The answer is a number, text, a Bool or a
// record of those, never written into either, so handing it out again
// gives nothing two holders could tell apart. A function that spends from
// a budget spends each time, so is not one. A stop or an abort is thrown,
// never kept.
//
// Only a function whose work is a loop (it calls, in some depth, a
// function calling itself) and that isn't one: a check of its last inputs
// is little beside its work, and a loop's every round doesn't check.
// Prior art: memoisation (Michie, "Memo functions and machine learning",
// Nature 1968), here a cache of one entry, as a CPU's last-value
// predictors keep.

import { isArray, isData, isFn, isRecord, kids, type CoreIR, type LType, type SExpr } from "./scalar.ts";
import { SAFE_RT } from "./share-calls.ts";

// An array's reads by position, of rows or columns (columns.ts).
const READS = /^array\.(get|getb|at|atb|length|lengthb|cget\d+|clength|cin|has|slice|from|drop)\.a\d+$/;

export function memoFuncs(ir: CoreIR, deep: ReadonlySet<number>): Set<number> {
  const n = ir.funcs.length;
  // What is written in place anywhere: arrays by their index, records by key.
  const writtenArrays = new Set<number>(), writtenRecords = new Set<string>();
  const writes = (e: SExpr): void => {
    if (e.k === "rt") { const m = /^array\.(\w+)\.a(\d+)$/.exec(e.fn); if (m && /^(replaceOwned|pushFrontOwned|c(set[\d_]*|push|copy|front|build|new))$/.test(m[1])) writtenArrays.add(Number(m[2])); }
    if (e.k === "make" && e.into !== undefined) writtenRecords.add(e.t.key);
    kids(e).forEach(writes);
  };
  ir.funcs.forEach((f) => writes(f.body));
  const calls = ir.funcs.map(() => new Set<number>());
  const quiet = ir.funcs.map((f, i) => {
    let ok = !f.multi && !f.spends && !f.budgeted;
    const walk = (e: SExpr) => {
      if (!ok) return;
      switch (e.k) {
        case "world": case "apply": case "abort": case "handle": case "released": case "set": case "choose": case "search": case "budget": ok = false; return;
        case "rt": if (e.host || e.own || !(SAFE_RT(e.fn) || READS.test(e.fn))) { ok = false; return; } break;
        case "call": if (e.cps) { ok = false; return; } calls[i].add(e.fn); break;
        case "attempt": if (e.spent || e.resumes) { ok = false; return; } break;
        case "make": case "new": if (e.into !== undefined) { ok = false; return; } break;
      }
      kids(e).forEach(walk);
    };
    walk(f.body);
    return ok;
  });
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < n; i++) if (quiet[i] && [...calls[i]].some((j) => !quiet[j])) { quiet[i] = false; changed = true; }
  }
  // Whether a function calls itself, and whether one it reaches does.
  const loops = ir.funcs.map((_, i) => calls[i].has(i));
  const loopsBelow = ir.funcs.map((_, i) => {
    const seen = new Set<number>(), todo = [...calls[i]];
    for (let j; (j = todo.pop()) !== undefined;) { if (seen.has(j)) continue; seen.add(j); if (loops[j]) return true; todo.push(...calls[j]); }
    return false;
  });
  const plain = (t: LType, depth = 0): boolean => {
    if (t === "f64" || t === "int" || t === "i32" || t === "int32" || t === "text") return true;
    if (typeof t !== "object" || isFn(t) || isData(t) || depth > 4) return false;
    if (isRecord(t)) return !t.mutable && !writtenRecords.has(t.key) && t.fields.every((x) => plain(x.t, depth + 1));
    return false;
  };
  const input = (t: LType): boolean => plain(t) || (isArray(t) && !writtenArrays.has(t.index) && (plain(t.item) || t.item === "f64"));
  const out = new Set<number>();
  ir.funcs.forEach((f, i) => {
    if (!quiet[i] || loops[i] || !loopsBelow[i] || deep.has(i) || f.inner || !f.params.length) return;
    if (!plain(f.result) || !f.params.every(input)) return;
    out.add(i);
  });
  return out;
}
