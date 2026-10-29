// Where things go on the graph, and how wires cross. Plain geometry: boxes,
// points and polylines in, positions and marks out. No DOM, so it's tested
// like the rest of the language (test/graphLayout.test.ts). The why is in
// NODE-EDITOR.md.
//
//   tidy         space out nodes (all of them, or only some): reorder each
//                column to cut crossings, no overlaps, a frame's contents
//                stay together, nodes move off wires that run through them
//                (unless that crosses others), inputs stay left of what
//                they feed
//   arrange      lay out afresh, the same every time: columns from the
//                inputs to the result, inputs in the order of their ports
//   crossings    where one wire passes over another (drawn as a bridge, a
//                small hop, as in Visio's line jumps) or under a node (a
//                tunnel)
//   route        a wire bent over or under the nodes in its way
//   labels       spots for value chips that cover no node and no other chip

export type Pos = { x: number; y: number };
// `reach`, for route: how far a wire may stray to get around it (a frame's
// whole height; a node's, the default).
export type Box = { x: number; y: number; w: number; h: number; reach?: number };

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

// A wire that would run under a node bends around it instead: over it or
// under it, whichever crosses fewer of the wires in `drawn` and strays
// less, as a chain of the same curves through a waypoint at each corner.
// Only a wire that runs left to right past the node bends, and only by a
// little (`reach`, or the box's own); otherwise it keeps its tunnel. `boxes` are the nodes it
// may not cross (not its own ends); a bend also keeps off `text` (titles).
// Returns the points to draw, and whether it bent.
export function route(a: Pos, b: Pos, boxes: Box[], drawn: Pos[][] = [], text: Box[] = [], n = 28, clear = 8, reach = 40): { pts: Pos[]; bent: boolean } {
  const inside = (q: Pos, box: Box) => q.x > box.x && q.x < box.x + box.w && q.y > box.y && q.y < box.y + box.h;
  const chain = (ps: Pos[]) => ps.slice(1).flatMap((q, i) => curvePoints(ps[i].x, ps[i].y, q.x, q.y, i === 0 ? n : Math.max(8, n >> 1)).slice(i === 0 ? 0 : 1));
  const under = (pts: Pos[]) => boxes.filter((box) => pts.some((q) => inside(q, box)));
  const crossings = (pts: Pos[]) => crossingsOf(pts, drawn).length;
  const straight = curvePoints(a.x, a.y, b.x, b.y, n);
  let pts = straight, way: Pos[] = [];
  for (let k = 0; k < 6; k++) {
    // A node is passed when the wire runs from its left to its right. A
    // frame (a box with its own reach) is also cut at a corner by a wire
    // with an end over or under it: that one goes round on the end's side.
    const before = (box: Box) => box.x - clear > a.x, after = (box: Box) => box.x + box.w + clear < b.x;
    // Frames first, the outermost first: going round it goes round all it holds.
    const hit = under(pts).filter((box) => (before(box) && after(box)) || (box.reach !== undefined && (before(box) || after(box))))
      .sort((p, q) => (q.reach !== undefined ? q.w * q.h : 0) - (p.reach !== undefined ? p.w * p.h : 0))[0];
    if (!hit) break;
    const ys = pts.filter((q) => inside(q, hit)).map((q) => q.y);
    const wy = ys.reduce((s, y) => s + y, 0) / ys.length;
    const side = (y: number, end: Pos) => (y < hit.y) === (end.y < hit.y);
    const ok = (y: number) => (before(hit) || side(y, a)) && (after(hit) || side(y, b));
    const tries = [hit.y - clear, hit.y + hit.h + clear].filter((y) => Math.abs(y - wy) <= (hit.reach ?? reach) && ok(y)).flatMap((y) => {
      // Corners in order along the wire; one that would fold back is no way.
      const corners = [...(before(hit) ? [{ x: hit.x - clear, y }] : []), ...(after(hit) ? [{ x: hit.x + hit.w + clear, y }] : [])];
      // Bends already made round what's inside a frame go: the wire passes it all.
      const kept = hit.reach === undefined ? way : way.filter((q) => q.x < hit.x - clear || q.x > hit.x + hit.w + clear);
      const next = [...kept, ...corners].sort((p, q) => p.x - q.x);
      if (next.some((q, i) => i > 0 && q.x - next[i - 1].x < 0.5)) return [];
      const p = chain([a, ...next, b]);
      const onText = text.filter((box) => p.some((q) => inside(q, box))).length;
      return [{ next, p, score: (under(p).length + onText) * 1000 + crossings(p) * 20 + Math.abs(y - wy) }];
    }).sort((x, z) => x.score - z.score);
    if (!tries.length) break;
    way = tries[0].next;
    pts = tries[0].p;
  }
  // Bent only if it hides under fewer nodes and crosses no more wires; or
  // if it runs through fewer frames and under no more nodes: a wire through
  // a frame reads as going into it, which is worth a crossing or two.
  const frames = (p: Pos[]) => under(p).filter((box) => box.reach !== undefined).length;
  const nodes = (p: Pos[]) => under(p).length - frames(p);
  const out = frames(pts) < frames(straight) && nodes(pts) <= nodes(straight);
  if (!way.length || (!out && (under(pts).length >= under(straight).length || crossings(pts) > crossings(straight)))) return { pts: straight, bent: false };
  return { pts, bent: true };
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

  uncross(ns, frames, wires, free);
  // Node and wire pairs where moving off the wire would cross others.
  const stay = new Set<string>();

  const settle = () => { for (let iter = 0; iter < 80; iter++) {
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
    for (const [wi, w] of wires.entries()) {
      const a = byId.get(w.from), b = byId.get(w.to);
      const fa = a ?? (fb.has(w.from) ? fb.get(w.from)! : null), tb = b ?? (fb.has(w.to) ? fb.get(w.to)! : null);
      if (!fa || !tb) continue;
      const pts = curvePoints(fa.x + w.fx, fa.y + w.fy, tb.x + w.tx, tb.y + w.ty, 16);
      for (const n of ns) {
        if (n === a || n === b || !free(n) || stay.has(`${n.id} ${wi}`)) continue;
        const box = { x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 };
        const hit = pts.filter((p) => p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h);
        if (!hit.length) continue;
        const wy = hit.reduce((s, p) => s + p.y, 0) / hit.length;
        const up = wy - box.y, down = box.y + box.h - wy;
        const dy = up < down ? Math.min(up, 30) + 1 : -(Math.min(down, 30) + 1);
        // Off one wire but across others is worse: the tunnel shows the
        // wire behind the node anyway.
        const own = wires.filter((v) => v.from === n.id || v.to === n.id);
        const before = own.length ? crossingCount(ns, frames, wires, own) : 0;
        n.y += dy;
        if (own.length && crossingCount(ns, frames, wires, own) > before) { n.y -= dy; stay.add(`${n.id} ${wi}`); continue; }
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
  } };
  settle();
  // Spacing out can cross wires again: one more reordering, and space out what it moved.
  if (uncross(ns, frames, wires, free)) settle();
  const out = new Map<string, Pos>();
  for (const n of ns) {
    const o = nodes.find((m) => m.id === n.id)!;
    const x = Math.round(n.x), y = Math.round(n.y);
    if (x !== Math.round(o.x) || y !== Math.round(o.y)) out.set(n.id, { x, y });
  }
  return out;
}

// Lay everything out afresh, whatever was where: the same picture every
// time for the same graph. Each container (the top, or a frame) is laid out
// on its own, innermost first, its frames as boxes of their contents, like
// nodes; then in columns by how far each is from the result (longest path,
// the layering of Sugiyama et al.; what nothing feeds goes just left of
// what it feeds), the result's column on the right. Each
// column is placed after the one it feeds: units in the order they plug in
// (by what they feed, top to bottom, then by port), so a call's inputs come
// in the order of its ports however tall each is; each goes level with the
// input it feeds, then they're stacked so nothing overlaps.
// `chains`: units that keep one column and this order, top to bottom (an
// action's steps, in the order they run).
export function arrange(nodes: TNode[], frames: TFrame[], wires: TWire[], chains: string[][] = [], gap = 18, colGap = 46): Map<string, Pos> {
  const parentOf = new Map(frames.map((f) => [f.id, f.parent]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map<string, number>();
  nodes.forEach((n, i) => order.set(n.id, i));
  frames.forEach((f, i) => order.set(f.id, nodes.length + i));
  const home = (x: string) => (nodeById.has(x) ? nodeById.get(x)!.frame : parentOf.get(x) ?? null);
  // What stands for x among the units of container c: x itself, or the
  // frame in c that holds it; null if c doesn't hold it.
  const unitIn = (x: string, c: string | null): string | null => {
    for (let u = x, p = home(x); ; u = p, p = parentOf.get(p) ?? null) {
      if (p === c) return u;
      if (p === null) return null;
    }
  };
  const depth = (f: string | null): number => (f ? 1 + depth(parentOf.get(f) ?? null) : 0);
  const size = new Map<string, { w: number; h: number }>();
  for (const n of nodes) size.set(n.id, { w: n.w, h: n.h });
  // Each unit's place within its container, from the container's corner.
  const rel = new Map<string, Pos>();
  const containers = [...frames.map((f) => f.id), null].sort((a, b) => depth(b) - depth(a));
  for (const c of containers) {
    const units = [...nodes.filter((n) => n.frame === c).map((n) => n.id), ...frames.filter((f) => f.parent === c).map((f) => f.id)]
      .sort((a, b) => order.get(a)! - order.get(b)!);
    if (!units.length) { if (c) size.set(c, { w: 0, h: 0 }); continue; }
    const outs = new Map<string, { to: string; at: number; from: number }[]>(units.map((u) => [u, []]));
    for (const w of wires) {
      const a = unitIn(w.from, c), b = unitIn(w.to, c);
      if (!a || !b || a === b) continue;
      // A frame's ends are taken at its middle: where it is now isn't asked.
      outs.get(a)!.push({ to: b, at: w.to === b && nodeById.has(b) ? w.ty : size.get(b)!.h / 2, from: w.from === a && nodeById.has(a) ? w.fy : size.get(a)!.h / 2 });
    }
    const rank = new Map<string, number>();
    const rankOf = (u: string, seen = new Set<string>()): number => {
      if (rank.has(u)) return rank.get(u)!;
      if (seen.has(u)) return 0;
      seen.add(u);
      const r = Math.max(-1, ...outs.get(u)!.map((e) => rankOf(e.to, seen))) + 1;
      rank.set(u, r);
      return r;
    };
    units.forEach((u) => rankOf(u));
    // Something nothing feeds (a constant, a cell) sits just left of the
    // nearest thing it feeds, not as far left as the longest path would put it.
    const fed = new Set(units.flatMap((u) => outs.get(u)!.map((e) => e.to)));
    for (const u of units) if (!fed.has(u) && outs.get(u)!.length) rank.set(u, 1 + Math.min(...outs.get(u)!.map((e) => rank.get(e.to)!)));
    // A chain's units share the column of the one furthest left.
    const chainsIn = chains.map((ch) => [...new Set(ch.map((x) => unitIn(x, c)).filter((u): u is string => !!u && rank.has(u)))]).filter((ch) => ch.length > 1);
    for (const ch of chainsIn) { const r = Math.max(...ch.map((u) => rank.get(u)!)); for (const u of ch) rank.set(u, r); }
    const keepOrder = (col: string[]) => {
      for (const ch of chainsIn) {
        const slots = col.map((u, i) => (ch.includes(u) ? i : -1)).filter((i) => i >= 0);
        const inCol = ch.filter((u) => col.includes(u));
        slots.forEach((i, k) => { col[i] = inCol[k]; });
      }
      return col;
    };
    const cols: string[][] = [];
    for (const u of units) (cols[rank.get(u)!] ??= []).push(u);
    const y = new Map<string, number>();
    cols.forEach((col, r) => {
      const want = (u: string) => {
        const es = outs.get(u)!.filter((e) => y.has(e.to));
        if (!es.length) return 0;
        return es.reduce((s, e) => s + y.get(e.to)! + e.at, 0) / es.length - es[0].from;
      };
      const ws = new Map(col.map((u) => [u, r ? want(u) : 0]));
      // The order is where each plugs in: under the highest thing it feeds,
      // at that input. Not where its top would like to be: a tall input (a
      // function's frame) would jump above the inputs before it, and one
      // parent's last input above the next parent's first.
      const plug = (u: string): [number, number] => {
        const es = outs.get(u)!.filter((e) => y.has(e.to));
        if (!es.length) return [Infinity, 0];
        const e = es.reduce((m, e) => (y.get(e.to)! < y.get(m.to)! || (y.get(e.to)! === y.get(m.to)! && e.at < m.at) ? e : m));
        return [y.get(e.to)!, e.at];
      };
      const ps = new Map(col.map((u) => [u, plug(u)]));
      const byPlug = (a: string, b: string) => ps.get(a)![0] - ps.get(b)![0] || ps.get(a)![1] - ps.get(b)![1] || ws.get(a)! - ws.get(b)! || order.get(a)! - order.get(b)!;
      const sorted = keepOrder(r ? [...col].sort(byPlug) : [...col]);
      let bottom = -Infinity;
      for (const u of sorted) { const t = r ? Math.max(ws.get(u)!, bottom + gap) : (bottom === -Infinity ? 0 : bottom + gap); y.set(u, t); bottom = t + size.get(u)!.h; }
      // Pushed down to make room: move the column back up, half way.
      if (r) { const d = sorted.reduce((s, u) => s + y.get(u)! - ws.get(u)!, 0) / sorted.length; for (const u of sorted) y.set(u, y.get(u)! - d / 2); }
    });
    // What a step leads to and nothing reads (a step's dot, an action's
    // result) was stacked before the steps had places: it goes level with
    // the step that feeds it.
    const stepUnits = new Set(chainsIn.flat());
    if (stepUnits.size && cols[0]) {
      const fedBy = (u: string) => units.flatMap((v) => (stepUnits.has(v) ? outs.get(v)!.filter((e) => e.to === u).map((e) => y.get(v)! + e.from - e.at) : []));
      const sinks = cols[0].filter((u) => !stepUnits.has(u) && fedBy(u).length);
      const want = new Map(sinks.map((u) => [u, fedBy(u).reduce((a, b) => a + b, 0) / fedBy(u).length]));
      let bottom = -Infinity;
      for (const u of [...sinks].sort((a, b) => want.get(a)! - want.get(b)!)) { const t = Math.max(want.get(u)!, bottom + gap / 3); y.set(u, t); bottom = t + size.get(u)!.h; }
    }
    // Columns right to left, each as wide as its widest; units meet the
    // column's right edge, nearer what they feed.
    const widths = cols.map((col) => Math.max(...col.map((u) => size.get(u)!.w)));
    let right = 0;
    const x = new Map<string, number>();
    for (let r = cols.length - 1; r >= 0; r--) { right += widths[r]; for (const u of cols[r]) x.set(u, right - size.get(u)!.w); right += colGap; }
    const x0 = Math.min(...units.map((u) => x.get(u)!)), y0 = Math.min(...units.map((u) => y.get(u)!));
    let w = 0, h = 0;
    for (const u of units) {
      // Whole numbers, so a frame drawn round them is where it was laid out.
      const p = { x: Math.round(x.get(u)! - x0), y: Math.round(y.get(u)! - y0) };
      rel.set(u, p);
      w = Math.max(w, p.x + size.get(u)!.w); h = Math.max(h, p.y + size.get(u)!.h);
    }
    if (c) { const f = frames.find((g) => g.id === c)!; const [l, t, r, b] = f.pad; size.set(c, { w: w + l + r, h: Math.max(h + t + b, f.minH ?? 0) }); }
  }
  // From the corner where the graph starts now, so laying out again moves nothing.
  const fb = frameBoxes(nodes, frames);
  const tops: Box[] = [...nodes.filter((n) => n.frame === null), ...frames.filter((f) => f.parent === null).map((f) => fb.get(f.id)!)];
  const start = { x: Math.round(Math.min(...tops.map((t) => t.x))), y: Math.round(Math.min(...tops.map((t) => t.y))) };
  const out = new Map<string, Pos>();
  const abs = (u: string): Pos => {
    const p = rel.get(u)!, c = home(u);
    if (!c) return { x: start.x + p.x, y: start.y + p.y };
    const f = frames.find((g) => g.id === c)!, at = abs(c);
    return { x: at.x + f.pad[0] + p.x, y: at.y + f.pad[1] + p.y };
  };
  for (const n of nodes) { const p = abs(n.id); out.set(n.id, { x: Math.round(p.x), y: Math.round(p.y) }); }
  return out;
}

// Cut crossings by reordering columns: the barycenter step of Sugiyama,
// Tagawa and Toda's layered layout (1981). Nodes whose spans overlap
// sideways, in the same frame, are a column; each is sorted by the mean
// height of what its wires reach, and takes the old column's places in that
// order; then neighbours trade places where that alone helps. A change is
// kept only if fewer wires cross, and the spacing pass after it fixes up
// any squeeze.
function uncross(ns: TNode[], frames: TFrame[], wires: TWire[], free: (n: TNode) => boolean): boolean {
  const crossings = (some: TWire[]) => crossingCount(ns, frames, wires, some);
  const columns: TNode[][] = [];
  for (const c of [null, ...frames.map((f) => f.id)]) {
    const here = ns.filter((n) => n.frame === c && free(n)).sort((a, b) => a.x - b.x);
    let col: TNode[] = [], right = -Infinity;
    for (const n of here) {
      if (n.x >= right - 8) { if (col.length > 1) columns.push(col); col = []; right = -Infinity; }
      col.push(n);
      right = Math.max(right, n.x + n.w);
    }
    if (col.length > 1) columns.push(col);
  }
  if (!columns.length) return false;
  let changed = false;
  const ends = (n: TNode) => wires.filter((w) => w.from === n.id || w.to === n.id);
  for (let sweep = 0; sweep < 4; sweep++) {
    let better = false;
    for (const col of columns) {
      const touching = [...new Set(col.flatMap(ends))];
      if (touching.length < 2) continue;
      const fb = frameBoxes(ns, frames);
      const box = (id: string): Box | undefined => ns.find((m) => m.id === id) ?? fb.get(id);
      const mean = (n: TNode) => {
        const ys = ends(n).map((w) => {
          const [id, dy] = w.from === n.id ? [w.to, w.ty] : [w.from, w.fy];
          const b = box(id);
          return b ? b.y + dy : null;
        }).filter((y): y is number => y !== null);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : n.y + n.h / 2;
      };
      const was = [...col].sort((a, b) => a.y - b.y);
      const order = was.map((n, i) => ({ n, k: mean(n), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((e) => e.n);
      if (order.every((n, i) => n === was[i])) continue;
      const before = crossings(touching);
      const old = was.map((n) => n.y);
      // The same top and the same gaps, the nodes in the new order.
      const gaps = was.slice(1).map((n, i) => n.y - (was[i].y + was[i].h));
      let y = was[0].y;
      order.forEach((n, i) => { n.y = y; y += n.h + (gaps[i] ?? 0); });
      if (crossings(touching) < before) { better = changed = true; col.sort((a, b) => a.y - b.y); continue; }
      was.forEach((n, i) => { n.y = old[i]; });
    }
    // Then neighbours in a column trade places where that alone helps.
    for (const col of columns) {
      col.sort((a, b) => a.y - b.y);
      for (let i = 0; i + 1 < col.length; i++) {
        const [a, b] = [col[i], col[i + 1]];
        const touching = [...ends(a), ...ends(b)];
        if (!touching.length) continue;
        const before = crossings(touching);
        const [ay, by] = [a.y, b.y];
        b.y = ay; a.y = ay + b.h + (by - (ay + a.h));
        if (crossings(touching) < before) { better = changed = true; col[i] = b; col[i + 1] = a; continue; }
        a.y = ay; b.y = by;
      }
    }
    if (!better) break;
  }
  return changed;
}

// How many times the wires in `some` cross any wire, as the graph draws
// them (not where wires meet at a port): what tidy weighs a move by.
function crossingCount(ns: TNode[], frames: TFrame[], wires: TWire[], some: TWire[]): number {
  const byId = new Map(ns.map((n) => [n.id, n]));
  const fb = frameBoxes(ns, frames);
  const line = (w: TWire): Pos[] | null => {
    const a = byId.get(w.from) ?? fb.get(w.from), b = byId.get(w.to) ?? fb.get(w.to);
    return a && b ? curvePoints(a.x + w.fx, a.y + w.fy, b.x + w.tx, b.y + w.ty, 28) : null;
  };
  const lines = new Map(wires.map((w) => [w, line(w)]));
  let n = 0;
  for (const w of some) {
    const p = lines.get(w);
    if (!p) continue;
    for (const v of wires) {
      const q = lines.get(v);
      if (v === w || !q) continue;
      n += crossingsOf(p, [q]).length;
    }
  }
  return n;
}
