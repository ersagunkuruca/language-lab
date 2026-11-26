// `neighbours` (L280g, docs/design/data/NEARBY-2026-11-22.md) on a
// uniform grid of cells a little wider than reach: each place compared
// only with the places in its own cell and the cells next to it (3, 9 or
// 27), by the definition's own sum (the parts' squared differences added
// left to right) and its own ≤, so the lists are the same; each list
// smallest first. Shared by the evaluator's host way (hosts.ts) and the
// compiled JavaScript's runtime (compiler/src/core-rt.ts), so it imports
// nothing.
//
// Null for what the grid can't take: places of no parts, of more than 3,
// or of different lengths; a reach that isn't positive and finite;
// places so far out that a cell's number rounds; more cells around each
// than 15625. `neighboursFound` then asks the k-d tree, which takes any
// number of parts, and the definition runs where that is null too.
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
  const cell = side * (1 + 2 ** -20), K = new Int32Array(n * dims), X = new Float64Array(n * dims);
  for (let i = 0; i < n; i++) {
    const a = ps[i];
    for (let p = 0; p < dims; p++) {
      const x = a[p], c = Math.floor(x / cell);
      X[i * dims + p] = x;
      if (!Number.isFinite(c) || Math.abs(c) > 2 ** 30) return null;
      K[i * dims + p] = c;
    }
  }
  // The places sorted by a hash of their cell (C348: a Map keyed by text
  // was 62% of the flock compiled to JavaScript, as c.ts gridC and wasm.ts
  // gridRt found): a bucket's places in order, so a cell's are found by
  // its bucket and their own cell checked, as buckets are shared.
  let size = 1;
  while (size < 2 * n) size *= 2;
  const mask = size - 1;
  const hash = (a: number, b: number, c: number) => {
    let h = (Math.imul(a, 0x9e3779b1) + Math.imul(b, 0x85ebca77) + Math.imul(c, 0xc2b2ae3d)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return (h ^ (h >>> 12)) & mask;
  };
  const at = (i: number, p: number) => (p < dims ? K[i * dims + p] : 0);
  const bucket = new Int32Array(n), start = new Int32Array(size + 1), order = new Int32Array(n);
  for (let i = 0; i < n; i++) { const b = hash(at(i, 0), at(i, 1), at(i, 2)); bucket[i] = b; start[b + 1]++; }
  for (let b = 0; b < size; b++) start[b + 1] += start[b];
  const fill = start.slice(0, size);
  for (let i = 0; i < n; i++) order[fill[bucket[i]]++] = i;
  const near = (i: number, j: number) => {
    const a = i * dims, b = j * dims;
    let s = (X[a] - X[b]) * (X[a] - X[b]);
    for (let p = 1; p < dims; p++) s = s + (X[a + p] - X[b + p]) * (X[a + p] - X[b + p]);
    return !(r2 < s);
  };
  // The cells around, as offsets on each part.
  const span = 2 * rings + 1, count = span ** dims, around = new Int32Array(count * 3);
  for (let o = 0; o < count; o++) for (let p = 0, r = o; p < dims; p++, r = Math.floor(r / span)) around[o * 3 + p] = (r % span) - rings;
  const lists: number[][] = [], found = new Int32Array(Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const x = at(i, 0), y = at(i, 1), z = at(i, 2);
    let m = 0;
    for (let o = 0; o < count; o++) {
      const qx = x + around[o * 3], qy = y + around[o * 3 + 1], qz = z + around[o * 3 + 2], b = hash(qx, qy, qz);
      for (let k = start[b], end = start[b + 1]; k < end; k++) {
        const j = order[k];
        if (j === i || at(j, 0) !== qx || at(j, 1) !== qy || at(j, 2) !== qz) continue;
        if (near(i, j)) found[m++] = j;
      }
    }
    // Smallest first: by insertion where a place has a handful of
    // neighbours, else the typed array's own numeric sort.
    if (m > 16) found.subarray(0, m).sort();
    else for (let a = 1; a < m; a++) { const v = found[a]; let b = a - 1; while (b >= 0 && found[b] > v) { found[b + 1] = found[b]; b--; } found[b + 1] = v; }
    const list = new Array<number>(m);
    for (let a = 0; a < m; a++) list[a] = found[a];
    lists.push(list);
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
  if ((n && !dims) || r2 === Infinity || ps.some((p) => p.length !== dims || p.some((x) => !Number.isFinite(x)))) return null;
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

// The grid where it takes the places, the tree where it doesn't (more
// than 3 parts, or cells held so narrow that too many are around each):
// the evaluator's way and the compiled code's unless the choices hold
// another.
export function neighboursFound(ps: readonly (readonly number[])[], reach: number, side?: number | "k-d tree"): number[][] | null {
  return side === "k-d tree" ? neighbourListsByTree(ps, reach) : neighbourLists(ps, reach, side ?? reach) ?? neighbourListsByTree(ps, reach);
}
