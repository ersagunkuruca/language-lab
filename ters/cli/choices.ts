// The program's choices, kept beside it (L280a, CHOICES-2026-11-20.md):
// what the compiler picked for main, one entry per line sorted by the
// type's stable id, each with the facts the pick read. `ters choices`
// writes `<program>.choices`; `ters check` says which entries are stale
// (the facts or the pick came out otherwise) and which are new. Only the
// representation kind for now, on JavaScript's target; the code never
// selects (REPRESENTATIONS.md), and the compiler picks every entry again.

import type { Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CARRIED, HEAD, looped, uses, type Representation } from "../src/lang/represent.ts";
import { storedRows, type Pick } from "../src/lang/library-reps.ts";
import type { Program } from "./represented.ts";

export const choicesPath = (program: string) => `${program.replace(/[/\\]+$/, "")}.choices`;

// A job as a person reads it: the definition or case it names, `carried`
// or `head of` before it where the row costs that apart, a case's field
// by the case's name (represent.ts ontoField).
function jobText(j: string, names: Names): string {
  for (const [pre, as] of [[CARRIED, "carried "], [HEAD, "head of "]] as const) if (j.startsWith(pre)) return as + jobText(j.slice(pre.length), names);
  const onto = /^(.*) onto its field (\d+)$/.exec(j);
  if (onto) return `${jobText(onto[1], names)} onto its field ${onto[2]}`;
  return names[j] ?? LIBRARY.names[j] ?? j;
}

// The entries of `represented`'s picks for `main` of the program as
// written (`given`, before the rewrite): each pick with the jobs main
// uses on the type, those in a loop marked, which is what the chooser
// weighed (represent.ts choose), and the rows it chose among.
export function choiceLines(given: Program, main: Id, picks: readonly Pick[], target = "JavaScript"): string[] {
  const names = { ...LIBRARY.names, ...given.names };
  // The rows the chooser picked among: the program's and the library's
  // whole-type rows its definitions name (storedRows), or the library's
  // by type (library-reps.ts).
  const stored = storedRows(given.code, given.own, given.reps);
  const rowsOf = (of: Id): Representation[] => {
    const own = stored.filter((r) => r.of === of);
    return own.length ? own : LIBRARY.reps.filter((r) => r.of === of);
  };
  const lines = picks.map((p) => {
    const rows = rowsOf(p.of);
    const spec = rows.find((r) => r.canonical) ?? rows[0];
    const ordered = spec ? [spec, ...rows.filter((r) => r !== spec)] : rows;
    const jobs = ordered.length ? uses(given.code, main, ordered) : [];
    const inLoop = ordered.length ? looped(given.code, main, ordered) : new Set<string>();
    const jobList = jobs.map((j) => jobText(j, names) + (inLoop.has(j) ? " (in a loop)" : "")).sort();
    const from = p.from?.length ? ` from ${p.from.map((d) => names[d] ?? d).join(", ")}` : "";
    return `${p.of} representation: ${names[p.of] ?? p.of} as ${p.rep}${from}; among ${rows.map((r) => r.name).join(", ")}; jobs ${jobList.join(", ") || "none"}; target ${target}`;
  });
  return [...new Set(lines)].sort();
}

export function choicesText(main: string, lines: readonly string[]): string {
  return [`# The compiler's choices for ${main} (L280a): picked again whenever their facts change.`, ...lines].join("\n") + "\n";
}

// The entries of a choices file, its comments left out.
export const readChoices = (text: string): string[] => text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

// What a check says of a choices file against the picks made now.
export function staleChoices(written: readonly string[], now: readonly string[]): string[] {
  const was = new Set(written), is = new Set(now);
  return [...written.filter((l) => !is.has(l)).map((l) => `stale  ${l}`), ...now.filter((l) => !was.has(l)).map((l) => `new    ${l}`)];
}
