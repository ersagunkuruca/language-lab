// A program with each type it uses stored as the chooser picks (lab.ts's
// `lab compile`, `lab run`, and a sound's `lab render`, C137 s1).

import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { choose, jobProblem, represent, type Representation } from "../src/lang/represent.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";

export interface Program { title: string; code: Code; own: Id[]; names: Names; info: Info; reps: Representation[]; options?: unknown }

function fail(message: string): never { throw new Error(message); }

// The program from `main`, with each type it uses stored the way the
// chooser picks from the declared costs (the definition itself is one of
// the choices). Library types (std's Map) are chosen for too, unless the
// table has a row for them (library-reps.ts, C47). The rewrite is checked
// again, like any program.
export function represented<P extends Program>(p: P, main: Id, hostMaps: boolean, tables = false): P {
  // Every definition the program has, so the ones main shares with others
  // change together; types stay as they are for its own representations.
  // The library's are chosen over the types too, so a field typed Map
  // becomes the tree its code builds (GAPS.md M2).
  // A representation's own definition says which definitions do the jobs:
  // it is read, not rewritten or run, so the represented program leaves it out.
  const reps = new Set(p.reps.map((r) => r.def));
  const defs = p.own.filter((d) => { const b = (p.code.nodes[d] as { body?: Id | null }).body; return (!b || p.code.nodes[b]?.kind !== "typedef") && !reps.has(d); });
  const lib = withLibraryRepresentations(p.code, p.info, p.names, main, p.own, p.reps, { hostMaps, tables });
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
  if (!chosen.length) return p;
  code = { ...code, defs: code.defs.filter((d) => !reps.has(d)) };
  // The library's representations may call the constructors they stand for.
  const options = p.options as Parameters<typeof infer>[3];
  const info = infer(code, names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) fail(`${p.title} doesn't check on ${chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { ...p, code, names, info };
}

