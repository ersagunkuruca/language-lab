// The effect ledger (REVIEW-2026-10-22b.md §1.2, BACKLOG.md L26): every
// place where an effect leaves a row without reaching the type around it.
// A function's effects normally show in the type of whatever calls it, up
// to main; each place below takes some away on purpose, and says why.
// Adding one (a new profile, a runtime handler, a builtin that runs a
// function it's given) means calling `discharge`, which puts a row in
// LANGUAGE.md's table ("Where effects go"); test/ledger.test.ts checks the
// table, and that the builtins' types drop exactly what their rows say.

import type { Id } from "../model.ts";

// Any effect a program (or std) declares as a type with operations:
// Abort, Log, Random, a program's own. Not one id: the handler is generic.
export const DECLARED = "effect.declared";

export interface Discharge {
  // Where it happens, in words, and the builtins when it's in their types.
  where: string;
  builtins: readonly Id[];
  effects: readonly Id[];
  why: string;
}

export const LEDGER: Discharge[] = [];

// Record that `where` takes `effects` out of a row, and why; returns the
// effects, so the place that filters uses the same list the ledger shows.
export function discharge<T extends readonly Id[]>(where: string, effects: T, why: string, builtins: readonly Id[] = []): T {
  if (LEDGER.some((d) => d.where === where)) throw new Error(`the ledger has ${where} twice`);
  LEDGER.push({ where, effects, why, builtins });
  return effects;
}
