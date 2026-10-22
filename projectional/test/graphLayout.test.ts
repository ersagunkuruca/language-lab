// The graph's geometry (editor/graphLayout.ts): crossings, hops, tunnels,
// value chips that don't overlap, and tidy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossingsOf, curvePoints, frameBoxes, hopPath, overlaps, placeLabels, tidy, tunnels, type TNode } from "../editor/graphLayout.ts";

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
