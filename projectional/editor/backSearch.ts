// The search behind Run, for a function run backwards (relate.ts): up to
// six answers, periodic ones that land on the same values counted once.
// The page runs it with a short time limit, so the first answer shows at
// once; if that cuts it short, the run worker (runWorker.ts) does the
// whole search and the page shows the rest when it ends (BACKLOG E127).

import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { relate, showTerm } from "../src/lang/relate.ts";

export interface Found { answers: { values: Record<string, string>; free: string[]; residual: string[] }[]; more: boolean; error?: string; cut?: boolean }
export type BackAsk = { backwards: true; code: Code; names: Names; def: Id; values: Record<string, unknown> };

const STEPS = 20000;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6));

// Searches until it has its answers, runs out of steps, or `stop` says so
// (then `cut` is set: there may be more to find).
export function searchBackwards(code: Code, def: Id, values: Record<string, unknown>, names: Names, stop: () => boolean = () => false): Found {
  const out: Found = { answers: [], more: false };
  let steps = 0;
  try {
    const seen = new Set<string>();
    let tries = 0;
    for (const a of relate(code, def, values, { spend: () => ++steps < STEPS && !(out.cut = stop()), names })) {
      // Cut short, the search fails what it hadn't time to try, so an
      // answer it gives then may be wrong: Countdown's solutions read []
      // until the full search found its 49 (I71).
      if (out.cut) break;
      const shown = Object.fromEntries(Object.entries(a.values).map(([k, v]) => [k, showTerm(v, names)]));
      const key = JSON.stringify(Object.values(shown).map((v) => (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/.test(v) ? fmt(Number(v)) : v)));
      if (seen.has(key)) { if (++tries > 64) break; continue; }
      seen.add(key);
      if (out.answers.length === 6) { out.more = true; break; }
      out.answers.push({ values: shown, free: a.free, residual: a.residual });
    }
    if (!out.cut && steps >= STEPS) out.error = "Stopped searching: this direction may go on forever. Give it more known ports.";
  } catch (e) { out.error = (e as Error).message; }
  if (!out.cut) delete out.cut;
  return out;
}
