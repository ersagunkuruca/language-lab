// The program's choices for main as `ters choices` writes them (L280a,
// CHOICES-2026-11-20.md), worked out in Run's worker (runWorker.ts) for
// the Choices tab (choicesPanel.ts, E292): how each type is stored, the
// ways and mode plans, where a page's or a command-line program's maps
// run, and which walks are one loop. JavaScript's, as the editor runs it;
// C's threads (`ters native`) are left to the command line.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { representationsIn } from "../ters/src/lang/represent.ts";
import { lowerCore } from "../compiler/src/core-js.ts";
import { gpuMaps } from "../compiler/src/gpu-maps.ts";
import { represented, type Program } from "../ters/cli/represented.ts";
import { choiceLines, placeLines, scheduleLines } from "../ters/cli/choices.ts";
import { infer, programOptions } from "./typed.ts";

export function choicesFor(code: Code, names: Names, main: Id): string[] {
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const info = infer(code, names);
  if (info.errors.length) return [];
  const given: Program = { title: "this program", code, own, names, info, reps: representationsIn(code, info, names, own), options: programOptions() };
  const p = represented<Program>(given, main, true);
  let places: string[] = [];
  try {
    const ir = lowerCore(p.code, p.info, p.names, [main]);
    places = placeLines(ir, new Set(Object.keys(ir.awayMaps ? gpuMaps(ir) : {}).map(Number)), p.names);
  } catch { /* main doesn't lower: it runs in the evaluator, on the main thread */ }
  return [...new Set([...choiceLines(given, main, p.picks ?? []), ...scheduleLines(p, main), ...places])].sort();
}
