// Run main from the core IR, lowered once (E245c). Lowering takes one to
// four seconds per run (countdown 1 s, bounce 2.5 s), on top of the check,
// so what it printed is plain data (core-js.ts Printed) that is kept for
// running the same code again (runPanel.ts) and is built with the site for
// each shipped example (prebuild.ts). Then a run loads it and goes, with
// no checking or lowering. The worker (runWorker.ts) and the build lower
// the same way, here.
import type { Code, Id } from "../ters/src/model.ts";
import { isUse, subtree, type Use } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../ters/src/lang/library-reps.ts";
import { mainProblem } from "../ters/src/lang/run.ts";
import { planSolve } from "../ters/src/lang/solve.ts";
import { lowerCore, printed, type Printed } from "../compiler/src/core-js.ts";
import { infer, programOptions } from "./typed.ts";
import { represented, type Program } from "../ters/cli/represented.ts";
import { representationsIn } from "../ters/src/lang/represent.ts";

// main as printed, where it is among the functions, whether it takes the
// command line's words, and what it gives (an exit code when it does).
export type CoreMain = { printed: Printed; at: number; args: boolean; result: "int" | "f64" | "other" };

// The program checked for running main, stored as `ters run` stores it
// (C197): the program's own representations and the library's (std's Map,
// lists) chosen by their costs, Map and Set as hash tables where they can
// be (hostMaps: the evaluator and JavaScript have std's Table), in the
// program's own types' fields too (GAPS.md M2). A choice the rewrite
// can't make, which `ters run` refuses, runs as written.
export function checkedForRun(code: Code, names: Names, def: Id): { code: Code; names: Names; info: Info; chosen: string[] } {
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const first = infer(code, names);
  try {
    const p: Program = represented<Program>({ title: "this program", code, own, names, info: first, reps: representationsIn(code, first, names, own), options: programOptions() }, def, true);
    return { code: p.code, names: p.names, info: p.info, chosen: p.chosen ?? [] };
  } catch {
    const lib = withLibraryRepresentations(code, first, names, def, own);
    return { code: lib.code, names: lib.names, info: lib.chosen.length ? infer(lib.code, lib.names) : first, chosen: lib.chosen };
  }
}

// main lowered to the core IR and printed, or null where it runs another
// way: a function run backwards inside it (it says where a reading stopped
// only in the evaluator), a main that gives something to show, one that
// doesn't lower, that waits, or that takes other inputs than `args` says.
export function coreMain(code: Code, info: Info, names: Names, def: Id, args: boolean): CoreMain | null {
  if (runsBackwards(code, def) || !(args || unitAction(info, def))) return null;
  if (mainProblem(info, def, names) || !names[def]) return null;
  let ir;
  try { ir = lowerCore(code, info, names, [def]); } catch { return null; }
  if (ir.refused.has(def)) return null;
  const f = ir.funcs.find((g) => g.name === names[def] && !g.inner && !g.budgeted);
  if (!f || f.multi || f.params.length !== (args ? 1 : 0)) return null;
  return { printed: printed(ir), at: ir.funcs.indexOf(f), args, result: f.result === "int" ? "int" : f.result === "f64" ? "f64" : "other" };
}

// Whether anything main reaches, the library's definitions included, runs
// a function backwards by the relational interpreter, the one that says
// where a reading stopped. A solve the equation solver plans (impact's and
// break's first touch, given a gap function) lowers as `ters run` lowers it
// (I191: break's Run main took 30 s in the evaluator, 10 compiled).
export function runsBackwards(code: Code, main: Id): boolean {
  const seen = new Set<Id>([main]), todo = [main];
  while (todo.length) {
    const n = code.nodes[todo.pop()!];
    if (n?.kind !== "def" || !n.body) continue;
    for (const x of subtree(code, n.body)) {
      const m = code.nodes[x];
      if (isUse(m) && relational(code, m)) return true;
      if (m?.kind === "ref" && code.nodes[m.target]?.kind === "def" && !seen.has(m.target)) { seen.add(m.target); todo.push(m.target); }
    }
  }
  return false;
}

// An action whose result is Unit: what it gives shows as nothing, so the
// compiled run needs no showing of a value the evaluator's way (E238).
export function unitAction(info: Info, def: Id): boolean {
  const t = info.typeOf.get(def);
  if (!t || t.t !== "fn" || t.params.length) return false;
  const r = info.subst.zonk(t.ret);
  return r.t === "con" && r.id === "std.unit";
}
const relational = (code: Code, n: Use): boolean => { try { return planSolve(code, n).mode === "relational"; } catch { return false; } };
