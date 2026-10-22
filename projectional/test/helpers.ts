import { freshId, type Code, type Id } from "../src/model.ts";

// The same program with every one of its own ids replaced by a fresh one:
// what writing it again would give. Hashes must not tell the two apart.
export function reId(own: Code): { code: Code; ids: Map<Id, Id> } {
  const ids = new Map(Object.keys(own.nodes).map((id) => [id, freshId()]));
  let text = JSON.stringify(own);
  for (const [a, b] of ids) text = text.split(`"${a}"`).join(`"${b}"`);
  return { code: JSON.parse(text), ids };
}

// Number pairs where tolerance, wholeness or size made equal's old meanings
// differ (test/equality.test.ts, compiler/test/equality.test.ts).
export const PAIRS: [number, number][] = [
  [1e12, 1e12 + 1], [1e12, 1e12], [2 ** 53, 2 ** 53 + 2], [0.1 + 0.2, 0.3], [1, 1 + 1e-12], [1e-12, 0],
  [0, -0], [5, 5.000000001], [1e20, 1e20 + 1e5], [Math.PI, 3.141592653589793], [NaN, NaN], [Infinity, Infinity], [3, 4],
];
