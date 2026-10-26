import { freshId, type Code, type Id } from "../src/model.ts";

// The same program with every one of its own ids replaced by a fresh one:
// what writing it again would give. Hashes must not tell the two apart.
export function reId(own: Code): { code: Code; ids: Map<Id, Id> } {
  const ids = new Map(Object.keys(own.nodes).map((id) => [id, freshId()]));
  let text = JSON.stringify(own);
  for (const [a, b] of ids) text = text.split(`"${a}"`).join(`"${b}"`);
  return { code: JSON.parse(text), ids };
}

// Float64 pairs where tolerance, wholeness or size made equal's old meanings
// differ (test/equality.test.ts, compiler/test/equality.test.ts).
export const PAIRS: [number, number][] = [
  [1e12, 1e12 + 1], [1e12, 1e12], [2 ** 53, 2 ** 53 + 2], [0.1 + 0.2, 0.3], [1, 1 + 1e-12], [1e-12, 0],
  [0, -0], [5, 5.000000001], [1e20, 1e20 + 1e5], [Math.PI, 3.141592653589793], [NaN, NaN], [Infinity, Infinity], [3, 4],
];

// The big sweeps ("for every part of an example, a law holds") check a
// slice per change and all of it in the nightly run (TESTING.md, T3).
// SWEEP=all checks everything; otherwise every SWEEP-th item (8 when
// unset), starting at SWEEP_AT. CI passes its run number as SWEEP_AT, so
// eight runs in a row cover the whole sweep.
const SLICES = process.env.SWEEP === "all" ? 1 : Math.max(1, Number(process.env.SWEEP) || 8);
const AT = Number(process.env.SWEEP_AT) || 0;
export const sweepShare = 1 / SLICES;
export const inSweep = (i: number) => (i + AT) % SLICES === 0;
export const sweep = <T,>(items: T[]): T[] => items.filter((_, i) => inSweep(i));
