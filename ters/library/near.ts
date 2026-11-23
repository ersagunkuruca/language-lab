// `neighbours` (L280g, docs/design/data/NEARBY-2026-11-22.md) on a
// uniform grid of cells a little wider than reach: each place compared
// only with the places in its own cell and the cells next to it (3, 9 or
// 27), by the definition's own sum (the parts' squared differences added
// left to right) and its own ≤, so the lists are the same; each list
// smallest first. Shared by the evaluator's host way (hosts.ts) and the
// compiled JavaScript's runtime (compiler/src/core-rt.ts), so it imports
// nothing.
//
// Null for what the grid can't take, where the definition runs: places
// of no parts, of more than 3, or of different lengths; a reach that
// isn't positive and finite; places so far out that a cell's number
// rounds.
//
// Prior art: Bentley, Stanat and Williams, "The complexity of finding
// fixed-radius near neighbors" (1977). CREDITS.md.

// `side`: the cells' side where the program's choices hold it (L280e,
// `grid of 5 cells`), reach where they don't. Cells narrower than reach
// are looked through as many rings out as reach takes.
export function neighbourLists(ps: readonly (readonly number[])[], reach: number, side = reach): number[][] | null {
  if (!(reach > 0) || reach === Infinity || !(side > 0) || side === Infinity) return null;
  const n = ps.length, r2 = reach * reach, dims = n ? ps[0].length : 0, rings = Math.max(1, Math.ceil(reach / side));
  if ((n && !dims) || dims > 3 || r2 === Infinity || (2 * rings + 1) ** dims > 15625 || ps.some((p) => p.length !== dims)) return null;
  // Cells a little wider than their side, so two places within reach are
  // that many rings apart at most however the division rounds.
  const cell = side * (1 + 2 ** -20), keys: number[][] = [], grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = ps[i].map((x) => Math.floor(x / cell));
    if (k.some((c) => !Number.isFinite(c) || Math.abs(c) > 2 ** 30)) return null;
    keys.push(k);
    const key = k.join(",");
    const at = grid.get(key);
    if (at) at.push(i); else grid.set(key, [i]);
  }
  const near = (i: number, j: number) => {
    const a = ps[i], b = ps[j];
    let s = (a[0] - b[0]) * (a[0] - b[0]);
    for (let p = 1; p < dims; p++) s = s + (a[p] - b[p]) * (a[p] - b[p]);
    return !(r2 < s);
  };
  let around: number[][] = [[]];
  const ring = Array.from({ length: 2 * rings + 1 }, (_, i) => i - rings);
  for (let p = 0; p < dims; p++) around = around.flatMap((o) => ring.map((c) => [...o, c]));
  const lists: number[][] = [];
  for (let i = 0; i < n; i++) {
    const found: number[] = [];
    for (const o of around) for (const j of grid.get(keys[i].map((c, p) => c + o[p]).join(",")) ?? []) if (j !== i && near(i, j)) found.push(j);
    lists.push(found.sort((x, y) => x - y));
  }
  return lists;
}
