// A page's draws on the GPU (G9c, gpu-draws.ts): each draw's vertex and
// fragment functions printed as one WGSL module, what they read of the
// place they were written given to the compiled draw after its site, and
// the frame drawn on headless WebGPU (SwiftShader) the same as raster.ts
// draws it on the CPU, within a step of 255 for Float32. Skipped where
// there is no Chromium with WebGPU.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner, fromList, type Data, type Value } from "../../ters/src/lang/run.ts";
import { B } from "../../ters/src/prelude.ts";
import { FRAME_OPS, FRAME_V, HTML_V, TEXT_OPS } from "../../ters/src/lang/std.ts";
import { NUMBER } from "../../ters/src/lang/types.ts";
import { evaluatorCall } from "../../ters/src/lang/html.ts";
import { cssColour, rasterize } from "../../ters/src/lang/raster.ts";
import { merge, type Id } from "../../ters/src/model.ts";
import { compiledDefs, corePageScript, lowerCore } from "../src/core-js.ts";
import { gpuDraws, type DrawSite, type Leaf } from "../src/gpu-draws.ts";

// A program with a corner (x, y), a clip-space point and a colour of its
// own, and the frame `main` builds (as frames.test.ts).
function program(build: (k: Lang, t: Kit) => Id) {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const corner = k.type("Corner2", [], [["corner2", [["x", num], ["y", num]]]]);
  const point = k.type("Point4", [], [["point4", [["x", num], ["y", num], ["z", num], ["w", num]]]]);
  const colour = k.type("Colour", [], [["colour", [["red", num], ["green", num], ["blue", num]]]]);
  const t: Kit = {
    corner: (x, y) => k.call(corner.v.corner2, k.lit(x), k.lit(y)),
    cx: (c) => k.call(corner.f["corner2.x"], c),
    cy: (c) => k.call(corner.f["corner2.y"], c),
    point: (x, y, z) => k.call(point.v.point4, x, y, z, k.lit(1)),
    colour: (r, g, b) => k.call(colour.v.colour, r, g, b),
    square: () => k.call(FRAME_V.mesh, k.list(t.corner(-1, -1), t.corner(1, -1), t.corner(1, 1), t.corner(-1, 1)), k.list(...[0, 1, 2, 0, 2, 3].map((i) => k.int(i)))),
    pass: (clear, depth, ...draws) => k.call(FRAME_V.pass, k.x(FRAME_V.screen), k.lit(clear), depth ? k.true : k.false, k.list(...draws)),
  };
  const main = build(k, t);
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ir = lowerCore(code, info, names, [main]);
  const r = makeRunner(code, info, { print: () => {} });
  const name = names[main];
  return {
    ir, name,
    draws: gpuDraws(ir),
    evaluated: () => [...r.call(r.value(main))][0] as Value,
    compiled: () => compiledDefs(code, info, names, [name])[name]() as Value,
  };
}
interface Kit {
  corner: (x: number, y: number) => Id; cx: (c: Id) => Id; cy: (c: Id) => Id;
  point: (x: Id, y: Id, z: Id) => Id; colour: (r: Id, g: Id, b: Id) => Id;
  square: () => Id; pass: (clear: string, depth: boolean, ...draws: Id[]) => Id;
}
const part = (o: Value, i: number): Value => (o as unknown as Record<string, Value>)[`f${i}`] ?? (o as Data).fields[i];

// A draw's values as the words its site reads, as gpu-frame.ts writes
// them: each leaf one word, a buffer at least one vec4u.
function words(values: Value[], leaves: Leaf[]): number[] {
  const out: number[] = [], f = new Float32Array(1), n = new Uint32Array(f.buffer), i = new Int32Array(f.buffer);
  for (const v of values) for (const l of leaves) {
    const x = l.path.reduce((o, p) => part(o, p), v) as unknown;
    if (l.kind === "f32") f[0] = x as number; else i[0] = l.kind === "i32" ? Number(x) : x === true ? 1 : 0;
    out.push(n[0]);
  }
  while (out.length < 4 || out.length % 4) out.push(0);
  return out;
}
function drawWords(site: DrawSite, draw: { fields: Value[] }) {
  const [mesh, instances] = draw.fields, caps = draw.fields[5] as unknown as Value[];
  const its = fromList(instances);
  return {
    caps: caps.flatMap((c, j) => words([c], site.caps[j])).concat([0, 0, 0, 0]).slice(0, Math.max(4, Math.ceil(site.caps.reduce((s, l) => s + l.length, 0) / 4) * 4)),
    instances: words(its, site.instance), corners: words(fromList(part(mesh, 0)), site.corner),
    triangles: fromList(part(mesh, 1)).map(Number), count: its.length,
  };
}

// Two copies of the square, the second moved right by `shift` (read from
// main's let) and both scaled by it, carrying how far across they are; the
// fragment reads `shift` too.
const ramp = () => program((k, t) => {
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("shift", k.lit(0.5), (s) => k.call(FRAME_V.frame, k.list(t.pass("#102030", false,
    k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(0), k.lit(1)),
      k.fn(["i", "c"], (i, c) => k.call(FRAME_V.placed, t.point(k.call(B.mul, k.call(B.add, t.cx(c), i), s), t.cy(c), k.lit(0.5)), k.call(B.div, k.call(B.add, t.cx(c), k.lit(1)), k.lit(2)))),
      k.fn(["a"], (a) => t.colour(a, s, k.call(B.sub, k.lit(1), a))))))))));
  return main;
});

// Depth: a near red square drawn after a far blue one, its vertex function
// given by a call (`at(z)` gives the function), with and without depth.
const nearFar = (depth: boolean) => program((k, t) => {
  const at = k.def("at");
  k.define(at, k.fn(["z"], (z) => k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(k.call(B.mul, t.cx(c), k.lit(0.75)), t.cy(c), z), k.lit(0)))));
  const paint = (r: number, b: number) => k.fn(["_"], () => t.colour(k.lit(r), k.lit(0), k.lit(b)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", depth,
    k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(0)), k.call(at, k.lit(0.2)), paint(1, 0)),
    k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(0)), k.call(at, k.lit(0.6)), paint(0, 1)))))));
  return main;
});

test("a draw's two functions are one WGSL module, and the compiled draw is given its site and what they read (G9c)", () => {
  const p = ramp();
  assert.deepEqual([...p.draws.refused], []);
  const site = p.draws.sites[0];
  assert.ok(site, "the draw has a GPU site");
  assert.match(site.wgsl, /@vertex fn lab_vs\(/);
  assert.match(site.wgsl, /@fragment fn lab_fs\(/);
  // shift, one f32 in the uniform; the instance one f32; a corner two.
  assert.deepEqual(site.caps, [[{ path: [], kind: "f32" }]]);
  assert.deepEqual(site.instance, [{ path: [], kind: "f32" }]);
  assert.deepEqual(site.corner, [{ path: [0], kind: "f32" }, { path: [1], kind: "f32" }]);
  assert.equal(site.colour, 3);
  const frame = p.compiled();
  const draw = fromList(part(fromList(part(frame, 0))[0], 3))[0] as unknown as { fields: Value[] };
  assert.equal(draw.fields[4], 0);
  assert.deepEqual(draw.fields[5], [0.5]);
  const w = drawWords(site, draw), floats = (ws: number[]) => [...new Float32Array(Uint32Array.from(ws).buffer)];
  assert.deepEqual(floats(w.caps), [0.5, 0, 0, 0]);
  assert.deepEqual(floats(w.instances), [0, 1, 0, 0]);
  assert.deepEqual(floats(w.corners), [-1, -1, 1, -1, 1, 1, -1, 1]);
  assert.deepEqual(w.triangles, [0, 1, 2, 0, 2, 3]);
});

test("a vertex function given by a call is lifted with what the call read; a draw of Text instances has no GPU site, with the reason", () => {
  const p = nearFar(true);
  assert.deepEqual([...p.draws.refused], []);
  assert.deepEqual(Object.keys(p.draws.sites), ["0", "1"]);
  const text = program((k, t) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit("a")), k.fn(["s", "c"], (s, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.call(B.div, k.call(TEXT_OPS.length, s), k.lit(2))), k.lit(0))), k.fn(["_"], () => t.colour(k.lit(1), k.lit(0), k.lit(0)))))))));
    return main;
  });
  assert.deepEqual(Object.keys(text.draws.sites), []);
  assert.match(text.draws.refused.get(0) ?? "", /./);
  // The same draw whose vertex function doesn't read its instance (the
  // floor drawn once for the whole state): the instance crosses as nothing.
  const unread = program((k, t) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit("a")), k.fn(["_", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(0.5)), k.lit(0))), k.fn(["_"], () => t.colour(k.lit(1), k.lit(0), k.lit(0)))))))));
    return main;
  });
  assert.deepEqual([...unread.draws.refused], []);
  assert.deepEqual(unread.draws.sites[0].instance, []);
});

test("a page whose canvas renders a frame hands its draws' sites to the runtime before it starts", () => {
  const p = program((k, t) => {
    const frame = k.def("frame of");
    k.define(frame, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
      k.call(FRAME_OPS.draw, t.square(), k.list(k.lit(0)), k.fn(["s", "c"], (_, c) => k.call(FRAME_V.placed, t.point(t.cx(c), t.cy(c), k.lit(0.5)), k.lit(0))), k.fn(["_"], () => t.colour(k.lit(1), k.lit(0), k.lit(0)))))))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("canvas"), k.list(k.call(HTML_V.render, k.thunk(() => k.call(frame)))), k.list())));
    return main;
  });
  assert.deepEqual(Object.keys(p.draws.sites), ["0"]);
  const js = corePageScript(p.ir, p.name, "$core", "frames");
  assert.match(js, /const \{ pageDraws \} = \$core;\npageDraws\(\{"0":\{"wgsl":/);
  assert.ok(js.indexOf("pageDraws(") < js.indexOf("startCorePage("), "the sites are known before the page starts");
});

// Instances of three fields of which the vertex function reads one, in a
// function it calls (G8): only that one crosses, the rest is 0 there.
const spread = () => program((k, t) => {
  const num = () => k.tref(NUMBER);
  const bird = k.type("Bird", [], [["bird", [["x", num], ["speed", num], ["hue", num]]]]);
  const across = k.def("across");
  k.define(across, k.fn(["b", "c"], (b, c) => k.call(B.add, k.call(B.mul, t.cx(c), k.lit(0.25)), k.call(bird.f["bird.x"], b))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(FRAME_V.frame, k.list(t.pass("#000", false,
    k.call(FRAME_OPS.draw, t.square(), k.list(k.call(bird.v.bird, k.lit(-0.5), k.lit(3), k.lit(9)), k.call(bird.v.bird, k.lit(0.5), k.lit(4), k.lit(8))),
      k.fn(["b", "c"], (b, c) => k.call(FRAME_V.placed, t.point(k.call(across, b, c), k.call(B.mul, t.cy(c), k.lit(0.5)), k.lit(0.5)), t.cx(c))),
      k.fn(["a"], (a) => t.colour(a, k.lit(1), k.lit(0)))))))));
  return main;
});

test("only the fields of an instance its vertex function reads cross, through the functions it calls (G8)", () => {
  const p = spread();
  assert.deepEqual([...p.draws.refused], []);
  assert.deepEqual(p.draws.sites[0].instance, [{ path: [0], kind: "f32" }]);
  // The corner's two fields are both read.
  assert.equal(p.draws.sites[0].corner.length, 2);
  const w = drawWords(p.draws.sites[0], fromList(part(fromList(part(p.compiled(), 0))[0], 3))[0] as unknown as { fields: Value[] });
  assert.deepEqual([...new Float32Array(Uint32Array.from(w.instances).buffer)], [-0.5, 0.5, 0, 0]);
});

// Chromium: CHROMIUM, or Playwright's own in /opt/pw-browsers.
const chromiumPath = (): string | undefined => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const d = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
  return d ? ["chrome-linux64", "chrome-linux"].map((x) => join(root, d, x, "chrome")).find((x) => existsSync(x)) : undefined;
};

// A frame of screen passes drawn with WebGPU, each draw its site's
// pipeline over the words drawWords gives, read back as RGBA bytes. The
// blend and depth are the ones raster.ts draws with.
const RENDER = `async ({ width, height, passes }) => {
  const adapter = await navigator.gpu.requestAdapter(), device = await adapter.requestDevice();
  const errors = [];
  device.pushErrorScope("validation");
  const format = "rgba8unorm";
  const target = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depthTex = device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const buffer = (words, usage) => { const b = device.createBuffer({ size: words.length * 4, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, new Uint32Array(words)); return b; };
  const enc = device.createCommandEncoder();
  for (const p of passes) {
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), clearValue: p.clear, loadOp: "clear", storeOp: "store" }], ...(p.depth ? { depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } } : {}) });
    for (const d of p.draws) {
      const module = device.createShaderModule({ code: d.wgsl });
      const info = await module.getCompilationInfo();
      for (const m of info.messages) if (m.type === "error") errors.push(m.message + " at " + m.lineNum);
      const pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "lab_vs" }, fragment: { module, entryPoint: "lab_fs", targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] }, primitive: { topology: "triangle-list" }, ...(p.depth ? { depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" } } : {}) });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: buffer(d.caps, GPUBufferUsage.UNIFORM) } },
        { binding: 1, resource: { buffer: buffer(d.instances, GPUBufferUsage.STORAGE) } },
        { binding: 2, resource: { buffer: buffer(d.corners, GPUBufferUsage.STORAGE) } }] });
      rp.setPipeline(pipeline);
      rp.setBindGroup(0, group);
      rp.setIndexBuffer(buffer(d.triangles, GPUBufferUsage.INDEX), "uint32");
      rp.drawIndexed(d.triangles.length, d.count);
    }
    rp.end();
  }
  const row = Math.ceil(width * 4 / 256) * 256;
  const out = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyTextureToBuffer({ texture: target }, { buffer: out, bytesPerRow: row }, [width, height]);
  device.queue.submit([enc.finish()]);
  const e = await device.popErrorScope();
  if (e) errors.push(e.message);
  await out.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(out.getMappedRange()), rgba = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) rgba.push(bytes[y * row + x]);
  return { errors, rgba };
}`;

// The GPU's side of a frame: each pass's draws with their sites' words.
function onGpu(frame: Value, sites: Record<number, DrawSite>) {
  return fromList(part(frame, 0)).map((pass) => {
    const [r, g, b, a] = cssColour(String(part(pass, 1)));
    const depth = (part(pass, 2) as unknown) === true || (part(pass, 2) as Data)?.tag === "std.bool.true";
    const draws = fromList(part(pass, 3)).map((d) => {
      const draw = d as unknown as { fields: Value[] }, site = sites[draw.fields[4] as unknown as number];
      const w = drawWords(site, draw);
      return { wgsl: site.wgsl, ...w };
    });
    return { clear: { r, g, b, a }, depth, draws };
  });
}

const exe = chromiumPath();
test("the frame drawn on WebGPU is raster.ts's, within Float32's rounding: a ramp read from the place it was written, and depth", { skip: !exe && "no Chromium" }, async () => {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  try {
    const page = await browser.newPage();
    // A file page: WebGPU is only in a secure context.
    const blank = join(mkdtempSync(join(tmpdir(), "gpu-draws-")), "blank.html");
    writeFileSync(blank, "<!doctype html><title>draws</title>");
    await page.goto(`file://${blank}`);
    assert.ok(await page.evaluate(() => !!(navigator as { gpu?: unknown }).gpu), "Chromium has WebGPU");
    const width = 16, height = 8;
    for (const [name, p] of [["ramp", ramp()], ["near and far, depth", nearFar(true)], ["near and far, no depth", nearFar(false)], ["only the read field", spread()]] as const) {
      const want = rasterize(p.evaluated(), width, height, evaluatorCall).rgba;
      const got = await page.evaluate(`(${RENDER})(${JSON.stringify({ width, height, passes: onGpu(p.compiled(), p.draws.sites) })})`) as { errors: string[]; rgba: number[] };
      assert.deepEqual(got.errors, [], name);
      const far = [...want].flatMap((x, i) => (Math.abs(x - got.rgba[i]) > 1 ? [i] : []));
      assert.deepEqual(far.slice(0, 8).map((i) => [i, want[i], got.rgba[i]]), [], `${name}: ${far.length} bytes differ`);
    }
  } finally { await browser.close(); }
});
