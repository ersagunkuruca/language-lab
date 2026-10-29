// The graph's geometry (editor/graphLayout.ts): crossings, hops, tunnels,
// value chips that don't overlap, and tidy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, crossingsOf, curvePoints, frameBoxes, hopPath, overlaps, placeLabels, route, tidy, tunnels, type TNode } from "../editor/graphLayout.ts";

test("two crossing wires cross once, in the middle", () => {
  const a = curvePoints(0, 0, 200, 100), b = curvePoints(0, 100, 200, 0);
  const at = crossingsOf(a, [b]);
  assert.equal(at.length, 1);
  assert.ok(Math.abs(at[0] - 112) < 15, `at ${at[0]}`);
  // Wires that only meet at a shared end don't cross.
  assert.deepEqual(crossingsOf(curvePoints(0, 0, 200, 0), [curvePoints(0, 0, 200, 100)]), []);
});

test("a wire with a crossing is drawn with a hop, without one as a plain line", () => {
  const a = curvePoints(0, 0, 200, 100);
  assert.ok(hopPath(a, [100]).includes(" A"));
  assert.ok(!hopPath(a, []).includes(" A"));
});

test("a wire under a box goes in and comes out; one ending in it doesn't count", () => {
  const p = curvePoints(0, 50, 300, 50);
  assert.equal(tunnels(p, [{ x: 100, y: 30, w: 60, h: 40 }]).length, 1);
  assert.equal(tunnels(p, [{ x: 280, y: 30, w: 60, h: 40 }]).length, 0);
  assert.equal(tunnels(p, [{ x: 100, y: 80, w: 60, h: 40 }]).length, 0);
});

test("value chips cover no node and no other chip", () => {
  const nodes = [{ x: 0, y: 0, w: 60, h: 30 }, { x: 70, y: -40, w: 60, h: 30 }];
  const labels = [{ at: { x: 60, y: 15 }, w: 50, h: 15 }, { at: { x: 60, y: 15 }, w: 50, h: 15 }, { at: { x: 60, y: 15 }, w: 50, h: 15 }];
  const spots = placeLabels(labels, nodes);
  const boxes = spots.map((s, i) => (s ? { ...s, w: labels[i].w, h: labels[i].h } : null)).filter((b) => !!b);
  assert.ok(boxes.length >= 2);
  for (const b of boxes) for (const n of nodes) assert.ok(!overlaps(b, n), "a chip covers a node");
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), "two chips overlap");
});

test("tidy leaves nothing overlapping, moves only what it's allowed to, and keeps flow left to right", () => {
  const nodes: TNode[] = [
    { id: "a", x: 0, y: 0, w: 60, h: 30, frame: null },
    { id: "b", x: 20, y: 10, w: 60, h: 30, frame: null },
    { id: "c", x: 30, y: 5, w: 60, h: 30, frame: null },
  ];
  const moved = tidy(nodes, [], [{ from: "a", fx: 60, fy: 15, to: "c", tx: 0, ty: 15, flow: true }]);
  const at = (n: TNode) => ({ ...n, ...(moved.get(n.id) ?? {}) });
  const after = nodes.map(at);
  for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) assert.ok(!overlaps(after[i], after[j]), `${after[i].id} and ${after[j].id} overlap`);
  const a = after[0], c = after[2];
  assert.ok(a.x + a.w <= c.x, "a feeds c, so it sits to its left");

  const only = tidy(nodes, [], [], new Set(["b"]));
  assert.deepEqual([...only.keys()], ["b"]);
});

test("tidy keeps a frame's contents together and the frame clear of its neighbours", () => {
  const nodes: TNode[] = [
    { id: "in1", x: 0, y: 0, w: 40, h: 20, frame: "f" },
    { id: "in2", x: 0, y: 40, w: 40, h: 20, frame: "f" },
    { id: "out", x: 10, y: 10, w: 40, h: 20, frame: null },
  ];
  const frames = [{ id: "f", parent: null, pad: [10, 20, 10, 10] as [number, number, number, number] }];
  const moved = tidy(nodes, frames, []);
  const after = nodes.map((n) => ({ ...n, ...(moved.get(n.id) ?? {}) }));
  const fb = frameBoxes(after, frames).get("f")!;
  assert.ok(!overlaps(fb, after[2]), "the outside node overlaps the frame");
  assert.equal(after[1].y - after[0].y, 40, "the frame's contents moved together");
});

test("tidy reorders a column to cut crossings, and leaves an order with none alone", () => {
  // a feeds d and b feeds c: the wires cross until c and d swap places.
  const nodes: TNode[] = [
    { id: "a", x: 0, y: 0, w: 60, h: 30, frame: null },
    { id: "b", x: 0, y: 80, w: 60, h: 30, frame: null },
    { id: "c", x: 200, y: 0, w: 60, h: 50, frame: null },
    { id: "d", x: 200, y: 90, w: 60, h: 30, frame: null },
  ];
  const wires = [
    { from: "a", fx: 60, fy: 15, to: "d", tx: 0, ty: 15, flow: true },
    { from: "b", fx: 60, fy: 15, to: "c", tx: 0, ty: 15, flow: true },
  ];
  const line = (w: (typeof wires)[number], at: (id: string) => TNode) =>
    curvePoints(at(w.from).x + w.fx, at(w.from).y + w.fy, at(w.to).x + w.tx, at(w.to).y + w.ty);
  const cross = (at: (id: string) => TNode) => crossingsOf(line(wires[0], at), [line(wires[1], at)], 0).length;
  const was = (id: string) => nodes.find((n) => n.id === id)!;
  assert.ok(cross(was) > 0);
  const moved = tidy(nodes, [], wires);
  const now = (id: string) => ({ ...was(id), ...(moved.get(id) ?? {}) });
  assert.equal(cross(now), 0, "the wires still cross");
  const after = nodes.map((n) => now(n.id));
  for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) assert.ok(!overlaps(after[i], after[j]), `${after[i].id} and ${after[j].id} overlap`);
  // Already uncrossed: nothing moves.
  const settled = after.map((n) => ({ ...n }));
  assert.equal(tidy(settled, [], wires).size, 0);
});

test("a wire bends around a node in its way, and keeps its tunnel where it can't", () => {
  const box = { x: 100, y: 40, w: 60, h: 40 };
  const inside = (q: { x: number; y: number }) => q.x > box.x && q.x < box.x + box.w && q.y > box.y && q.y < box.y + box.h;
  const around = route({ x: 0, y: 55 }, { x: 260, y: 65 }, [box]);
  assert.ok(around.bent);
  assert.ok(!around.pts.some(inside), "the wire still runs under the node");
  assert.deepEqual(around.pts[0], { x: 0, y: 55 });
  assert.deepEqual(around.pts.at(-1), { x: 260, y: 65 });
  // Past the node and back again: nothing to go around by.
  assert.equal(route({ x: 260, y: 60 }, { x: 0, y: 60 }, [box]).bent, false);
  // Far off its line: it would stray too far, so it stays straight.
  assert.equal(route({ x: 0, y: 60 }, { x: 260, y: 60 }, [{ x: 100, y: -100, w: 60, h: 400 }]).bent, false);
});

test("a wire goes round a frame it doesn't start or end in, however tall, even cutting a corner", () => {
  const frame = { x: 100, y: 0, w: 300, h: 200, reach: 200 };
  const inside = (q: { x: number; y: number }) => q.x > frame.x && q.x < frame.x + frame.w && q.y > frame.y && q.y < frame.y + frame.h;
  const through = route({ x: 0, y: 120 }, { x: 500, y: 100 }, [frame]);
  assert.ok(through.bent && !through.pts.some(inside), "a wire across a frame goes round it");
  // Its end is over the frame: round the top, on that end's side.
  const corner = route({ x: 0, y: 150 }, { x: 300, y: -60 }, [frame]);
  assert.ok(corner.bent && !corner.pts.some(inside), "a wire cutting a frame's corner goes round it");
  assert.ok(corner.pts.every((q) => q.x <= frame.x || q.y <= frame.y + 1), "over the top, not under");
});

test("arrange lays out afresh: the same from anywhere, again moves nothing, inputs in port order", () => {
  // f(a, b) inside a frame g, whose result feeds h; a and b start swapped and piled up.
  const nodes: TNode[] = [
    { id: "h", x: 0, y: 0, w: 60, h: 40, frame: null },
    { id: "f", x: 0, y: 0, w: 60, h: 50, frame: "g" },
    { id: "b", x: 5, y: 0, w: 40, h: 20, frame: "g" },
    { id: "a", x: 5, y: 100, w: 40, h: 20, frame: "g" },
  ];
  const frames = [{ id: "g", parent: null, pad: [10, 20, 10, 10] as [number, number, number, number] }];
  const wires = [
    { from: "a", fx: 40, fy: 10, to: "f", tx: 0, ty: 15, flow: true },
    { from: "b", fx: 40, fy: 10, to: "f", tx: 0, ty: 35, flow: true },
    { from: "g", fx: 80, fy: 30, to: "h", tx: 0, ty: 20, flow: true },
  ];
  const at = arrange(nodes, frames, wires);
  const placed = nodes.map((n) => ({ ...n, ...at.get(n.id)! }));
  const p = (id: string) => at.get(id)!;
  assert.ok(p("a").y < p("b").y, "a feeds the first port, so it's above b");
  assert.ok(p("a").x + 40 < p("f").x && p("f").x + 60 < p("h").x, "inputs left of what they feed");
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++)
    if (placed[i].frame === placed[j].frame) assert.ok(!overlaps(placed[i], placed[j]), `${placed[i].id} and ${placed[j].id} overlap`);
  const again = arrange(placed, frames, wires);
  for (const n of placed) assert.deepEqual(again.get(n.id), { x: n.x, y: n.y }, `${n.id} moved again`);
  // From somewhere else entirely, the same picture, moved as a whole.
  const elsewhere = arrange(nodes.map((n, i) => ({ ...n, x: n.x + 300 - i * 50, y: n.y + i * 70 })), frames, wires);
  const d = { x: elsewhere.get("h")!.x - p("h").x, y: elsewhere.get("h")!.y - p("h").y };
  for (const n of nodes) assert.deepEqual(elsewhere.get(n.id), { x: p(n.id).x + d.x, y: p(n.id).y + d.y });
});

test("arrange keeps inputs in the order they plug in, however tall each is", () => {
  // f(p, q); p(a, b, c); q(d, e). b and e are tall (a function's frame,
  // say): ordered by where their tops would like to be, b went above a and
  // e above d.
  const ids = ["f", "p", "q", "a", "b", "c", "d", "e"];
  const tall = (id: string) => id === "b" || id === "e";
  const nodes: TNode[] = ids.map((id) => ({ id, x: 0, y: 0, w: 60, h: tall(id) ? 120 : id === "p" ? 50 : 30, frame: null }));
  const w = (from: string, to: string, k: number) => ({ from, fx: 60, fy: tall(from) ? 60 : 15, to, tx: 0, ty: 10 + 15 * k, flow: true });
  const wires = [w("p", "f", 0), w("q", "f", 1), w("a", "p", 0), w("b", "p", 1), w("c", "p", 2), w("d", "q", 0), w("e", "q", 1)];
  const at = arrange(nodes, [], wires);
  assert.equal(["a", "b", "c", "d", "e"].sort((x, y) => at.get(x)!.y - at.get(y)!.y).join(""), "abcde");
});

test("an action's steps keep one column in the order they run, each step's dot level with it", () => {
  // Three steps; the first two lead to a dot each, the last is the result.
  // Without the chain, s1 and s2 would sit left of s3 (they feed the dots,
  // which share s3's column), and the dots would stack at the top.
  const nodes = [
    { id: "s1", x: 0, y: 0, w: 60, h: 30, frame: null },
    { id: "s2", x: 0, y: 0, w: 60, h: 30, frame: null },
    { id: "s3", x: 0, y: 0, w: 60, h: 30, frame: null },
    { id: "d1", x: 0, y: 0, w: 16, h: 16, frame: null },
    { id: "d2", x: 0, y: 0, w: 16, h: 16, frame: null },
    { id: "x", x: 0, y: 0, w: 40, h: 120, frame: null },
  ];
  const wires = [
    { from: "s1", fx: 60, fy: 15, to: "d1", tx: 0, ty: 8, flow: true },
    { from: "s2", fx: 60, fy: 15, to: "d2", tx: 0, ty: 8, flow: true },
    { from: "x", fx: 40, fy: 60, to: "s2", tx: 0, ty: 15, flow: true },
  ];
  const at = arrange(nodes, [], wires, [["s1", "s2", "s3"]]);
  const p = (id: string) => at.get(id)!;
  assert.ok(p("s1").x === p("s2").x && p("s2").x === p("s3").x, "one column");
  assert.ok(p("s1").y < p("s2").y && p("s2").y < p("s3").y, "in the order they run");
  for (const [d, s] of [["d1", "s1"], ["d2", "s2"]]) assert.equal(p(d).y + 8, p(s).y + 15, `${d} is level with ${s}`);
});
