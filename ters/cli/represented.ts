// A program with each type it uses stored as the chooser picks (lab.ts's
// `ters compile`, `ters run`, and a sound's `ters render`, C137 s1).

import { dependencies, type Code, type Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { choose, jobProblem, represent, type Representation } from "../src/lang/represent.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { ownLibraryHolders } from "../src/lang/own-holders.ts";

export interface Program { title: string; code: Code; own: Id[]; names: Names; info: Info; reps: Representation[]; options?: unknown; chosen?: string[] }

function fail(message: string): never { throw new Error(message); }

// The program from `main`, with each type it uses stored the way the
// chooser picks from the declared costs (the definition itself is one of
// the choices). Library types (std's Map) are chosen for too, unless the
// table has a row for them (library-reps.ts, C47). The rewrite is checked
// again, like any program.
// `sound`: main is a sound played in blocks (library-reps.ts).
export function represented<P extends Program>(p0: P, main: Id, hostMaps: boolean, tables = false, sound = false): P {
  const reached = reachedFrom(p0, main);
  // A library type holding lists (std's Pool) the program's own, so its
  // lists are stored as the program's are (own-holders.ts, C58d).
  const held = ownLibraryHolders(reached.code, reached.info, reached.names, main, reached.own);
  const p = held ? { ...reached, code: held.code, names: held.names, own: held.own, info: held.info } : reached;
  // Every definition the program has, so the ones main shares with others
  // change together; types stay as they are for its own representations.
  // The library's are chosen over the types too, so a field typed Map
  // becomes the tree its code builds (GAPS.md M2).
  // A representation's own definition says which definitions do the jobs:
  // it is read, not rewritten or run, so the represented program leaves it out.
  const reps = new Set(p.reps.map((r) => r.def));
  const defs = p.own.filter((d) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return (!b || p.code.nodes[b]?.kind !== "typedef") && !reps.has(d); });
  const lib = withLibraryRepresentations(p.code, p.info, p.names, main, p.own, p.reps, { hostMaps, tables, sound });
  let code = lib.code;
  const names = lib.names, chosen = [...lib.chosen];
  for (const of of new Set(p.reps.map((r) => r.of))) {
    const rep = choose(code, main, p.reps.filter((r) => r.of === of)).rep;
    if (rep.type === rep.of) continue;
    const problem = jobProblem(p.info, rep, p.names);
    if (problem) fail(`${p.title} can't be stored as ${rep.name}: ${problem}`);
    code = represent(code, defs, rep);
    chosen.push(`${p.names[of] ?? of} as ${rep.name}`);
  }
  if (!chosen.length) return held ? p : p0;
  code = { ...code, defs: code.defs.filter((d) => !reps.has(d)) };
  // The library's representations may call the constructors they stand for.
  const options = p.options as Parameters<typeof infer>[3];
  const info = infer(code, names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) fail(`${p.title} doesn't check on ${chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  // A rewrite changes no answer, so a definition that ended as written
  // ends stored too: a walk over an array (first and rest of a list made
  // an array) isn't one the checker sees getting smaller, and would spend
  // a step a call (C184: the pedal's following, matching and bands).
  for (const d of [...info.divergent]) if (p.info.typeOf.has(d) && !p.info.divergent.has(d)) info.divergent.delete(d);
  return { ...p, code, names, info, chosen };
}


// The program cut to what `main` reaches, with its types and its own
// representations (whose jobs main reaches only once they're chosen): a
// definition main never runs (a page's style sheet, beside the sound
// `ters render` plays) doesn't hold the choice back (C196), nor is
// rewritten.
function reachedFrom<P extends Program>(p: P, main: Id): P {
  const isType = (d: Id) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return !!b && p.code.nodes[b]?.kind === "typedef"; };
  const roots = [main, ...p.reps.flatMap((r) => [r.def, ...Object.values(r.impl), ...(r.meaning ? [r.meaning] : []), ...(r.store ? [r.store] : [])].filter((d): d is Id => !!d))];
  const keep = new Set(roots.flatMap((d) => (p.code.nodes[d] ? [d, ...dependencies(p.code, d)] : [])));
  const own = p.own.filter((d) => keep.has(d) || isType(d));
  if (own.length === p.own.length) return p;
  const gone = new Set(p.own.filter((d) => !own.includes(d)));
  const code = { ...p.code, defs: p.code.defs.filter((d) => !gone.has(d)) };
  const info = infer(code, p.names, undefined, p.options as Parameters<typeof infer>[3]);
  // A cut that doesn't check (it shouldn't: nothing kept names what went)
  // is no cut.
  if (info.errors.length > p.info.errors.length) return p;
  return { ...p, code, own, info };
}
