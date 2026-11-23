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
// fixed-radius near neighbors" (1977); the k-d tree, Bentley,
// "Multidimensional binary search trees used for associative searching"
// (1975). CREDITS.md.

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

// The same lists from a k-d tree (Bentley 1975): the places split at the
// median along each part in turn, leaves of up to 8; each place's ball
// asked of the tree, a box passed by when it is more than reach away
// along some part (with the grid's slack, so rounding never drops one),
// every place left compared by the definition's own sum and ≤.
export function neighbourListsByTree(ps: readonly (readonly number[])[], reach: number): number[][] | null {
  if (!(reach > 0) || reach === Infinity) return null;
  const n = ps.length, r2 = reach * reach, dims = n ? ps[0].length : 0, far = reach * (1 + 2 ** -20);
  if ((n && !dims) || dims > 3 || r2 === Infinity || ps.some((p) => p.length !== dims || p.some((x) => !Number.isFinite(x)))) return null;
  const order = Array.from({ length: n }, (_, i) => i);
  // Each node: its places order[lo..hi), its box, its two halves.
  type Node = { lo: number; hi: number; min: number[]; max: number[]; left?: Node; right?: Node };
  const build = (lo: number, hi: number, depth: number): Node => {
    const min = Array(dims).fill(Infinity), max = Array(dims).fill(-Infinity);
    for (let i = lo; i < hi; i++) for (let p = 0; p < dims; p++) { const x = ps[order[i]][p]; if (x < min[p]) min[p] = x; if (x > max[p]) max[p] = x; }
    if (hi - lo <= 8) return { lo, hi, min, max };
    const axis = depth % dims, mid = (lo + hi) >> 1;
    const part = order.slice(lo, hi).sort((a, b) => ps[a][axis] - ps[b][axis]);
    for (let i = lo; i < hi; i++) order[i] = part[i - lo];
    return { lo, hi, min, max, left: build(lo, mid, depth + 1), right: build(mid, hi, depth + 1) };
  };
  const root = n ? build(0, n, 0) : undefined;
  const near = (a: readonly number[], b: readonly number[]) => {
    let s = (a[0] - b[0]) * (a[0] - b[0]);
    for (let p = 1; p < dims; p++) s = s + (a[p] - b[p]) * (a[p] - b[p]);
    return !(r2 < s);
  };
  const lists: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = ps[i], found: number[] = [], stack = root ? [root] : [];
    while (stack.length) {
      const t = stack.pop()!;
      let out = false;
      for (let p = 0; p < dims && !out; p++) out = t.min[p] - a[p] > far || a[p] - t.max[p] > far;
      if (out) continue;
      if (t.left) { stack.push(t.left, t.right!); continue; }
      for (let k = t.lo; k < t.hi; k++) { const j = order[k]; if (j !== i && near(a, ps[j])) found.push(j); }
    }
    lists.push(found.sort((x, y) => x - y));
  }
  return lists;
}
