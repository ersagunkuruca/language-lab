// The program's choices for main as `ters choices` writes them (L280a,
// CHOICES-2026-11-20.md), worked out in Run's worker (runWorker.ts) for
// the Decisions section (choicesPanel.ts, E292): how each type is stored, the
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
import { choiceLines, HELD, placeLines, scheduleLines } from "../ters/cli/choices.ts";
import { infer, programOptions } from "./typed.ts";

// `held`: the types held in Decisions (E292, L280c): their entries written
// `held`, and for each, what the compiler would pick alone (`would`) when
// that's another row.
// `refused`: why what is held can't be, the choices then made with
// nothing held (a run says the same).
// A placement held (L280h): on the main thread, or a command-line
// program's on worker threads from its first items. And how many workers
// main starts (L280e), held as the count, 0 to 64.
export const isPool = (row: string) => /^\d+$/.test(row);
export const isPlace = (row: string) => row === "main thread" || row === "worker threads" || isPool(row);

export function choicesFor(code: Code, names: Names, main: Id, holds: readonly [Id, string][] = []): { choices: string[]; would: [Id, string][]; refused?: string } {
  const held = holds.filter(([, r]) => !isPlace(r)), placesHeld = new Map(holds.filter(([, r]) => isPlace(r)));
  const own = code.defs.filter((d) => !LIBRARY.code.nodes[d]);
  const info = infer(code, names);
  if (info.errors.length) return { choices: [], would: [] };
  const given: Program = { title: "this program", code, own, names, info, reps: representationsIn(code, info, names, own), options: programOptions(), ...(held.length ? { held: new Map(held) } : {}) };
  let p: Program;
  try { p = represented<Program>(given, main, true); } catch (e) {
    if (!held.length) throw e;
    return { ...choicesFor(code, names, main, [...placesHeld]), refused: (e as Error).message };
  }
  let places: string[] = [];
  try {
    const ir = lowerCore(p.code, p.info, p.names, [main]);
    places = placeLines(ir, new Set(Object.keys(ir.awayMaps ? gpuMaps(ir) : {}).map(Number)), p.names, undefined, main);
  } catch { /* main doesn't lower: it runs in the evaluator, on the main thread */ }
  const of = new Map(held), idOf = (l: string) => l.slice(0, l.indexOf(" "));
  // A held placement's entry is the compiler's with the held row in it;
  // what the compiler picks alone is said beside it.
  const pickOf = (l: string) => / place: .*: ([^:;]+); among /.exec(l)?.[1] ?? "";
  const wouldPlace: [Id, string][] = [];
  places = places.map((l) => {
    const row = placesHeld.get(idOf(l));
    if (!row) return l;
    if (pickOf(l) !== row) wouldPlace.push([idOf(l), pickOf(l)]);
    return HELD + l.replace(/: [^:;]+; among /, `: ${row}; among `);
  });
  const now = [...new Set([...choiceLines(given, main, p.picks ?? []), ...scheduleLines(p, main), ...places])];
  const byText = (x: string, y: string) => x.replace(HELD, "").localeCompare(y.replace(HELD, ""));
  if (!held.length) return { choices: now.sort(byText), would: wouldPlace };
  // A type held as the row it is written as has no pick of its own: its
  // entry is the compiler's, with the held row in it.
  const alonePicks = represented<Program>({ ...given, held: undefined }, main, true).picks ?? [];
  const alone = choiceLines({ ...given, held: undefined }, main, alonePicks);
  const isRep = (l: string) => / representation: /.test(l) && of.has(idOf(l));
  const heldLines = [...of].flatMap(([id, rep]) => {
    const l = now.find((x) => isRep(x) && idOf(x) === id) ?? alone.find((x) => isRep(x) && idOf(x) === id)?.replace(/ as [^;]+?; among /, ` as ${rep}; among `);
    return l ? [HELD + l] : [];
  });
  const choices = [...now.filter((l) => !isRep(l)), ...heldLines].sort(byText);
  return { choices, would: [...alonePicks.filter((a) => of.has(a.of) && of.get(a.of) !== a.rep).map((a): [Id, string] => [a.of, a.rep]), ...wouldPlace] };
}
