// Run main from the core IR, lowered once (E245c). Lowering takes one to
// four seconds per run (countdown 1 s, bounce 2.5 s), on top of the check,
// so what it printed is plain data (core-js.ts Printed) that is kept for
// running the same code again (runPanel.ts) and is built with the site for
// each shipped example (prebuild.ts). Then a run loads it and goes, with
// no checking or lowering. The worker (runWorker.ts) and the build lower
// the same way, here.
import type { Code, Id } from "../ters/src/model.ts";
import { isUse, subtree } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../ters/src/lang/library-reps.ts";
import { mainProblem } from "../ters/src/lang/run.ts";
import { lowerCore, printed, type Printed } from "../compiler/src/core-js.ts";
import { infer } from "./typed.ts";

// main as printed, where it is among the functions, whether it takes the
// command line's words, and what it gives (an exit code when it does).
export type CoreMain = { printed: Printed; at: number; args: boolean; result: "int" | "f64" | "other" };

// The program checked for running main: std's Map stored the way the
// chooser picks (library-reps.ts, C47), in the program's own types' fields
// too (GAPS.md M2).
export function checkedForRun(code: Code, names: Names, def: Id): { code: Code; names: Names; info: Info } {
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const first = infer(code, names), lib = withLibraryRepresentations(code, first, names, def, own);
  return { code: lib.code, names: lib.names, info: lib.chosen.length ? infer(lib.code, lib.names) : first };
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
// a function backwards.
export function runsBackwards(code: Code, main: Id): boolean {
  const seen = new Set<Id>([main]), todo = [main];
  while (todo.length) {
    const n = code.nodes[todo.pop()!];
    if (n?.kind !== "def" || !n.body) continue;
    for (const x of subtree(code, n.body)) {
      const m = code.nodes[x];
      if (isUse(m)) return true;
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
