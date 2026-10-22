// Where things go on the graph, and how wires cross. Plain geometry: boxes,
// points and polylines in, positions and marks out. No DOM, so it's tested
// like the rest of the language (test/graphLayout.test.ts). The why is in
// NODE-EDITOR.md.
//
//   tidy         space out nodes (all of them, or only some): no overlaps,
//                a frame's contents stay together, nodes move off wires that
//                run through them, inputs stay left of what they feed
//   crossings    where one wire passes over another (drawn as a bridge, a
//                small hop, as in Visio's line jumps) or under a node (a
//                tunnel)
//   labels       spots for value chips that cover no node and no other chip

export type Pos = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export const overlaps = (a: Box, b: Box, m = 0) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

export const union = (bs: Box[]): Box | null => {
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// ---------------------------------------------------------------- wires

// The wire shape: a cubic from an output (left) to an input (right).
export const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(16, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

// The same curve as points, for measuring crossings.
export function curvePoints(x1: number, y1: number, x2: number, y2: number, n = 32): Pos[] {
  const dx = Math.max(16, Math.abs(x2 - x1) / 2);
  const c1 = { x: x1 + dx, y: y1 }, c2 = { x: x2 - dx, y: y2 };
  const out: Pos[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * x1 + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * y2,
    });
  }
  return out;
}

const segHit = (a: Pos, b: Pos, c: Pos, d: Pos): { t: number; u: number } | null => {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  // Half-open, so a crossing exactly on a shared point counts once.
  return t >= 0 && t < 1 && u >= 0 && u < 1 ? { t, u } : null;
};

// Distance along a polyline to each of its points.
const lengths = (p: Pos[]) => {
  const out = [0];
  for (let i = 1; i < p.length; i++) out.push(out[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  return out;
};

// Where wire `over` crosses each of `under`, as distances along `over`.
// Crossings near either wire's ends don't count: wires leaving the same
// output, or arriving at neighbouring inputs, touch there by design.
export function crossingsOf(over: Pos[], unders: Pos[][], end = 16): number[] {
  const L = lengths(over), total = L[L.length - 1];
  const out: number[] = [];
  for (const under of unders) {
    const M = lengths(under), mt = M[M.length - 1];
    for (let i = 1; i < over.length; i++) {
      for (let j = 1; j < under.length; j++) {
        const h = segHit(over[i - 1], over[i], under[j - 1], under[j]);
        if (!h) continue;
        const s = L[i - 1] + h.t * (L[i] - L[i - 1]), v = M[j - 1] + h.u * (M[j] - M[j - 1]);
        if (s < end || s > total - end || v < end || v > mt - end) continue;
        out.push(s);
      }
    }
  }
  return out.sort((a, b) => a - b).filter((s, i, all) => i === 0 || s - all[i - 1] > 1);
}

// A polyline drawn with a hop (a half circle of radius r) at each distance
// in `at`. Hops closer than 2r merge into one.
export function hopPath(p: Pos[], at: number[], r = 5): string {
  const L = lengths(p);
  const pointAt = (s: number): { p: Pos; dir: Pos } => {
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const seg = L[i] - L[i - 1] || 1, f = Math.min(1, Math.max(0, (s - L[i - 1]) / seg));
    const dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y, n = Math.hypot(dx, dy) || 1;
    return { p: { x: p[i - 1].x + dx * f, y: p[i - 1].y + dy * f }, dir: { x: dx / n, y: dy / n } };
  };
  const spans: [number, number][] = [];
  for (const s of at) {
    const last = spans[spans.length - 1];
    if (last && s - r <= last[1] + 2) last[1] = s + r;
    else spans.push([s - r, s + r]);
  }
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  let k = 0;
  for (let i = 1; i < p.length; i++) {
    while (k < spans.length && spans[k][0] < L[i]) {
      const [a, b] = spans[k++];
      const A = pointAt(a), B = pointAt(b);
      // The hop bulges to the left of the way the wire runs: up, for a wire going right.
      const rad = f((b - a) / 2);
      d += ` L${f(A.p.x)},${f(A.p.y)} A${rad},${rad} 0 0 1 ${f(B.p.x)},${f(B.p.y)}`;
    }
    if (!spans.some(([a, b]) => L[i] > a && L[i] < b)) d += ` L${f(p[i].x)},${f(p[i].y)}`;
  }
  return d;
}

// The stretches of a wire that run under a box: pairs of points where it
// goes in and comes out. A wire that starts or ends inside doesn't count.
export function tunnels(p: Pos[], boxes: Box[]): [Pos, Pos][] {
  const out: [Pos, Pos][] = [];
  const inside = (q: Pos, b: Box) => q.x > b.x && q.x < b.x + b.w && q.y > b.y && q.y < b.y + b.h;
  for (const b of boxes) {
    if (inside(p[0], b) || inside(p[p.length - 1], b)) continue;
    let from: Pos | null = null;
    for (const q of p) {
      if (inside(q, b)) { if (!from) from = q; }
      else if (from) { out.push([from, q]); from = null; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- labels

// Value chips: each sits near its anchor (the output it labels). Candidates
// are tried in order; the first that covers no obstacle and no chip already
// placed wins. null: no room, so the caller draws it collapsed.
// `left`: try left of the anchor first (a frame's parameters, whose names
// sit to their right).
export function placeLabels(labels: { at: Pos; w: number; h: number; left?: boolean }[], obstacles: Box[]): (Pos | null)[] {
  const placed: Box[] = [];
  return labels.map(({ at, w, h, left }) => {
    const spots: Pos[] = [
      ...(left ? [{ x: at.x - w - 9, y: at.y - h / 2 }, { x: at.x - w - 9, y: at.y - h - 2 }] : []),
      { x: at.x + 6, y: at.y - h - 3 },
      { x: at.x + 6, y: at.y + 3 },
      { x: at.x + 26, y: at.y - h - 3 },
      { x: at.x + 26, y: at.y + 3 },
      { x: at.x - w / 2, y: at.y - h - 10 },
      { x: at.x - w / 2, y: at.y + 10 },
      { x: at.x + 6, y: at.y - 2 * h - 6 },
      { x: at.x + 6, y: at.y + h + 6 },
    ];
    for (const s of spots) {
      const b = { x: s.x, y: s.y, w, h };
      if (obstacles.some((o) => overlaps(b, o, 1)) || placed.some((o) => overlaps(b, o, 2))) continue;
      placed.push(b);
      return s;
    }
    return null;
  });
}

// ---------------------------------------------------------------- tidy

// A node to space out. `frame` is the innermost frame it sits in; frames are
// boxes around their contents with `pad` around (left, top, right, bottom).
export interface TNode { id: string; x: number; y: number; w: number; h: number; frame: string | null; fixed?: boolean }
export interface TFrame { id: string; parent: string | null; pad: [number, number, number, number]; minH?: number }
// A wire from one node to another, by where it leaves and arrives relative
// to each (a frame's port: the frame's left edge). `flow`: the value is an
// input of what it feeds, so the source should sit to its left.
export interface TWire { from: string; fx: number; fy: number; to: string; tx: number; ty: number; flow?: boolean }

// Frame boxes from their contents, innermost first.
export function frameBoxes(nodes: TNode[], frames: TFrame[]): Map<string, Box> {
  const out = new Map<string, Box>();
  const depth = (f: TFrame): number => (f.parent ? 1 + depth(frames.find((g) => g.id === f.parent)!) : 0);
  for (const f of [...frames].sort((a, b) => depth(b) - depth(a))) {
    const inner = [
      ...nodes.filter((n) => n.frame === f.id),
      ...frames.filter((g) => g.parent === f.id).map((g) => out.get(g.id)).filter((b): b is Box => !!b),
    ];
    const u = union(inner) ?? { x: 0, y: 0, w: 0, h: 0 };
    const [l, t, r, b] = f.pad;
    out.set(f.id, { x: u.x - l, y: u.y - t, w: u.w + l + r, h: Math.max(u.h + t + b, f.minH ?? 0) });
  }
  return out;
}

// Space out: start from where everything is and move only what has to
// move, and only the nodes in `only` (all when null). Returns new positions
// for the nodes that moved.
export function tidy(nodes: TNode[], frames: TFrame[], wires: TWire[], only: Set<string> | null = null, gap = 18): Map<string, Pos> {
  const ns = nodes.map((n) => ({ ...n }));
  const byId = new Map(ns.map((n) => [n.id, n]));
  const free = (n: TNode) => !n.fixed && (!only || only.has(n.id));
  const parentOf = new Map(frames.map((f) => [f.id, f.parent]));
  // Every node inside frame f, at any depth.
  const within = (f: string) => ns.filter((n) => { for (let p = n.frame; p; p = parentOf.get(p) ?? null) if (p === f) return true; return false; });
  // The units side by side in a container: its own nodes, and each frame
  // in it as one block that moves as a whole.
  const containers = [null, ...frames.map((f) => f.id)];
  const shift = (ids: TNode[], dx: number, dy: number) => { for (const n of ids) if (free(n)) { n.x += dx; n.y += dy; } };

  for (let iter = 0; iter < 80; iter++) {
    let moved = 0;
    const fb = frameBoxes(ns, frames);
    // 1. Overlaps between units in the same container.
    for (const c of containers) {
      const units: { box: Box; members: TNode[] }[] = [
        ...ns.filter((n) => n.frame === c).map((n) => ({ box: n as Box, members: [n] })),
        ...frames.filter((f) => f.parent === c).map((f) => ({ box: fb.get(f.id)!, members: within(f.id) })),
      ];
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
          const a = units[i], b = units[j];
          if (!overlaps(a.box, b.box, gap - 0.5)) continue;
          const ma = a.members.some(free), mb = b.members.some(free);
          if (!ma && !mb) continue;
          // Push apart along the axis that needs less.
          const px = Math.min(a.box.x + a.box.w + gap - b.box.x, b.box.x + b.box.w + gap - a.box.x);
          const py = Math.min(a.box.y + a.box.h + gap - b.box.y, b.box.y + b.box.h + gap - a.box.y);
          const ac = { x: a.box.x + a.box.w / 2, y: a.box.y + a.box.h / 2 }, bc = { x: b.box.x + b.box.w / 2, y: b.box.y + b.box.h / 2 };
          // Columns are the natural grain of a left-to-right graph: prefer
          // stacking (moving vertically) unless sideways is much shorter.
          const vertical = py <= px * 1.5;
          const d = vertical ? py : px;
          const sign = vertical ? (bc.y >= ac.y ? 1 : -1) : (bc.x >= ac.x ? 1 : -1);
          const share = ma && mb ? 0.5 : 1;
          const step = Math.min(d, 40) * share + 0.5;
          const [dx, dy] = vertical ? [0, sign * step] : [sign * step, 0];
          if (mb) shift(b.members, dx, dy);
          if (ma) shift(a.members, -dx, -dy);
          moved++;
        }
      }
    }
    // 2. Nodes off wires that run through them.
    for (const w of wires) {
      const a = byId.get(w.from), b = byId.get(w.to);
      const fa = a ?? (fb.has(w.from) ? fb.get(w.from)! : null), tb = b ?? (fb.has(w.to) ? fb.get(w.to)! : null);
      if (!fa || !tb) continue;
      const pts = curvePoints(fa.x + w.fx, fa.y + w.fy, tb.x + w.tx, tb.y + w.ty, 16);
      for (const n of ns) {
        if (n === a || n === b || !free(n)) continue;
        const box = { x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 };
        const hit = pts.filter((p) => p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h);
        if (!hit.length) continue;
        const wy = hit.reduce((s, p) => s + p.y, 0) / hit.length;
        const up = wy - box.y, down = box.y + box.h - wy;
        const dy = up < down ? Math.min(up, 30) + 1 : -(Math.min(down, 30) + 1);
        n.y += dy;
        moved++;
      }
    }
    // 3. A value sits left of what it feeds.
    for (const w of wires) {
      if (!w.flow) continue;
      const a = byId.get(w.from), b = byId.get(w.to);
      if (!a || !b) continue;
      const need = a.x + a.w + 28 - b.x;
      if (need <= 0.5) continue;
      const fa = free(a), fbb = free(b);
      if (!fa && !fbb) continue;
      const step = Math.min(need, 40);
      if (fa && fbb) { a.x -= step / 2; b.x += step / 2; } else if (fa) a.x -= step; else b.x += step;
      moved++;
    }
    if (!moved) break;
  }
  const out = new Map<string, Pos>();
  for (const n of ns) {
    const o = nodes.find((m) => m.id === n.id)!;
    const x = Math.round(n.x), y = Math.round(n.y);
    if (x !== Math.round(o.x) || y !== Math.round(o.y)) out.set(n.id, { x, y });
  }
  return out;
}
