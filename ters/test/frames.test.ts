// Frames drawn on the CPU (BACKLOG G9b, docs/design/targets/FRAMES.md): a
// canvas's `render` gives a Frame of passes and draws, each draw a mesh,
// its instances and a vertex and a fragment function, and raster.ts fills
// the triangles the vertex functions place. Small frames, checked pixel by
// pixel against answers worked out by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { B } from "../src/prelude.ts";
import { FRAME_OPS, FRAME_V } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { evaluatorCall } from "../src/lang/html.ts";
import { cssColour, rasterize, type Image } from "../src/lang/raster.ts";
import { merge, type Id } from "../src/model.ts";

// A program with a corner (x, y), a clip-space point and a colour of its
// own, and the frame `main` builds from `draws`.
function program(build: (k: Lang, t: Types) => { main: Id }) {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const corner = k.type("Corner2", [], [["corner2", [["x", num], ["y", num]]]]);
  const point = k.type("Point4", [], [["point4", [["x", num], ["y", num], ["z", num], ["w", num]]]]);
  const colour = k.type("Colour", [], [["colour", [["red", num], ["green", num], ["blue", num]]]]);
  const t: Types = {
    corner: (x, y) => k.call(corner.v.corner2, k.lit(x), k.lit(y)),
    cx: (c) => k.call(corner.f["corner2.x"], c),
    cy: (c) => k.call(corner.f["corner2.y"], c),
    point: (x, y, z) => k.call(point.v.point4, x, y, z, k.lit(1)),
    colour: (r, g, b) => k.call(colour.v.colour, r, g, b),
    corner2: (x, y) => k.call(corner.v.corner2, x, y),
    // Two triangles over the square from (−1, −1) to (1, 1).
    square: () => k.call(FRAME_V.mesh, k.list(t.corner(-1, -1), t.corner(1, -1), t.corner(1, 1), t.corner(-1, 1)), k.list(...[0, 1, 2, 0, 2, 3].map((i) => k.int(i)))),
    pass: (clear, depth, ...draws) => k.call(FRAME_V.pass, k.x(FRAME_V.screen), k.lit(clear), depth ? k.true : k.false, k.list(...draws)),
  };
  const { main } = build(k, t);
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  const r = makeRunner(code, info, { print: () => {} });
  return { info, names, frame: () => [...r.call(r.value(main))][0] as Value };
}
interface Types {
  corner: (x: number, y: number) => Id; cx: (c: Id) => Id; cy: (c: Id) => Id;
  point: (x: Id, y: Id, z: Id) => Id; colour: (r: Id, g: Id, b: Id) => Id; corner2: (x: Id, y: Id) => Id;
  square: () => Id; pass: (clear: string, depth: boolean, ...draws: Id[]) => Id;
}
const px = (img: Image, x: number, y: number) => [...img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test("a square of one colour fills the canvas, and the clear colour shows where nothing is drawn", () => {
  const { info, frame } = program((k, t) => {
    // Instances: how far right each copy is, in clip units; half the
    // square's width, so the first fills the canvas and the second only
    // its right half.
    const vertex = k.fn(["shift", "c"], (s, c) => k.call(FRAME_V.placed, t.point(k.call(B.add, t.cx(c), s), t.cy(c), k.lit(0.5)), k.lit(0)));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(1)), vertex, k.fn(["_"], () => t.colour(k.lit(1), k.lit(0), k.lit(0)))))))));
    return { main };
  });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const img = rasterize(frame(), 8, 4, evaluatorCall);
  // Shifted right by 1 (half the canvas): the left half is the clear colour.
  assert.deepEqual(px(img, 1, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 3, 2), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 4, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(img, 7, 3), [255, 0, 0, 255]);
});

test("with depth the nearer draw shows, whichever is drawn last; without, the last one", () => {
  const two = (depth: boolean) => program((k, t) => {
    const at = (z: number) => k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(z)), k.lit(0)));
    const paint = (r: number, b: number) => k.fn(["_"], () => t.colour(k.lit(r), k.lit(0), k.lit(b)));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", depth,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.unitValue), at(0.2), paint(1, 0)),
      k.call(FRAME_OPS.draw, t.square(), k.list(k.unitValue), at(0.6), paint(0, 1)))))));
    return { main };
  });
  assert.deepEqual(px(rasterize(two(true).frame(), 4, 4, evaluatorCall), 2, 2), [255, 0, 0, 255], "the red one is nearer");
  assert.deepEqual(px(rasterize(two(false).frame(), 4, 4, evaluatorCall), 2, 2), [0, 0, 255, 255], "drawn last, the blue one");
});

test("what the vertex carries is put between the corners: a ramp from left to right", () => {
  const { info, frame } = program((k, t) => {
    // Carried: how far across, 0 at the left edge and 1 at the right.
    const vertex = k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(0.5)), k.call(B.div, k.call(B.add, t.cx(c), k.lit(1)), k.lit(2))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.unitValue), vertex, k.fn(["across"], (a) => t.colour(a, a, a))))))));
    return { main };
  });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const img = rasterize(frame(), 4, 1, evaluatorCall);
  // Pixel centres at 1/8, 3/8, 5/8 and 7/8 of the way across.
  assert.deepEqual([0, 1, 2, 3].map((x) => px(img, x, 0)[0]), [1, 3, 5, 7].map((n) => Math.round(n / 8 * 255)));
});

test("draws of different instance types go in one list, and a fragment must give a record of Float64s", () => {
  const ok = program((k, t) => {
    const flat = (z: number) => k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(z)), k.lit(0)));
    const red = k.fn(["_"], () => t.colour(k.lit(1), k.lit(0), k.lit(0)));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", true,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(1), k.lit(2)), flat(0.2), red),
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit("a text")), flat(0.4), red))))));
    return { main };
  });
  assert.deepEqual(ok.info.errors.map((e) => e.message), []);
  const bad = program((k, t) => {
    const flat = k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(0)), k.lit(0)));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(1)), flat, k.fn(["_"], () => k.lit("red"))))))));
    return { main };
  });
  assert.ok(bad.info.errors.some((e) => /Float64/.test(e.message)), bad.info.errors.map((e) => e.message).join("; "));
});

// G10: a pass into a texture, and a later pass's fragment reading it.
// The texture is 2 by 1: red, then green where the square shifted right
// by 1 covers its right half. The screen, 4 by 2, is one square whose
// fragment samples the texture across, at its height's middle: kept to
// the edge at the ends, a mix between.
const sampling = (order: "written" | "read first") => program((k, t) => {
  const glow = () => k.call(FRAME_V.texture, k.lit("glow"), k.int(2), k.int(1));
  const shifted = k.fn(["shift", "c"], (s, c) => k.call(FRAME_V.placed, t.point(k.call(B.add, t.cx(c), s), t.cy(c), k.lit(0.5)), k.lit(0)));
  const into = k.call(FRAME_V.pass, glow(), k.lit("#ff0000"), k.false, k.list(k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(1)), shifted, k.fn(["_"], () => t.colour(k.lit(0), k.lit(1), k.lit(0))))));
  const across = k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(0.5)), k.call(B.add, k.call(B.mul, t.cx(c), k.lit(0.5)), k.lit(0.5))));
  const read = k.fn(["u"], (u) => k.call(FRAME_OPS.sampled, glow(), t.corner2(u, k.lit(0.5))));
  const onto = t.pass("#000", false, k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(0)), across, read));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(FRAME_V.frame, order === "written" ? k.list(into, onto) : k.list(onto, into))));
  return { main };
});
test("a pass draws into a texture and a later pass samples it, between texels and kept to its edges", () => {
  const { info, frame } = sampling("written");
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const img = rasterize(frame(), 4, 2, evaluatorCall);
  assert.deepEqual(px(img, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(img, 1, 1), [191, 64, 0, 255]);
  assert.deepEqual(px(img, 2, 0), [64, 191, 0, 255]);
  assert.deepEqual(px(img, 3, 1), [0, 255, 0, 255]);
});
test("a texture read before a pass of the frame draws it is refused with its name", () => {
  const { frame } = sampling("read first");
  assert.throws(() => rasterize(frame(), 4, 2, evaluatorCall), /"glow" is read before a pass of this frame draws it/);
});

test("CSS colours as a clear colour", () => {
  assert.deepEqual(cssColour("#f00"), [1, 0, 0, 1]);
  assert.deepEqual(cssColour("#0b1220").map((x) => Math.round(x * 255)), [11, 18, 32, 255]);
  assert.deepEqual(cssColour("rgba(0, 0, 0, 0.35)"), [0, 0, 0, 0.35]);
});

// G9d: the flock drawn with data (examples/flock-frame-page). Its first
// frame, interpreted: the night sky round the box, the floor under it,
// and birds over the floor.
test("the flock page's first frame: sky, floor and birds", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { join } = await import("node:path");
  const p = loadProgram(join(import.meta.dirname, "../examples/flock-frame-page"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const named = (n: string) => p.own.defs.find((d) => p.pres.names[d] === n)!;
  const r = makeRunner(p.code, info, { print: () => {} });
  const sky = r.value(named("start sky"));
  // Its bird, from the OBJ file beside it (G11).
  const { readFileSync } = await import("node:fs");
  const bird = [...r.call(r.value(named("obj mesh")), readFileSync(join(import.meta.dirname, "../examples/flock-frame-page/bird.obj"), "utf8"))][0] as Value;
  const frame = [...r.call(r.value(named("frame of")), sky, bird)][0] as Value;
  const img = rasterize(frame, 64, 60, evaluatorCall);
  const colours = new Set<string>();
  for (let i = 0; i < img.rgba.length; i += 4) colours.add(img.rgba.slice(i, i + 3).join(","));
  assert.deepEqual(px(img, 0, 0), [11, 18, 32, 255], "the clear colour");
  assert.ok(colours.has([0.07, 0.11, 0.18].map((x) => Math.round(x * 255)).join(",")), "the floor");
  // Birds: something pale (red above 150) in the picture.
  assert.ok([...colours].some((c) => Number(c.split(",")[0]) > 150), "birds");
});
