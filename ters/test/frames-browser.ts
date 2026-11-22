// Frames drawn with WebGPU in a real browser (BACKLOG G9c/G9d,
// docs/design/targets/FRAMES.md): gpu-frame.ts draws a frame from a site
// written by hand to the Compiler lane's contract, and raster.ts draws the
// same frame on the CPU; the two must give the same pixels, but for the
// edges of triangles, where the two fill rules may differ. Then the same
// frame again sends nothing, and a frame whose captures changed sends only
// them.
//
//   node test/frames-browser.ts
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome,
// with WebGPU on SwiftShader as compiler/gpu.ts runs it.

import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const entry = `
import { GpuFrames, pageDraws, sitedOf } from "./src/lang/gpu-frame.ts";
import { rasterize } from "./src/lang/raster.ts";
import { FRAME_V, TRUE, FALSE, CONS, NIL } from "./src/lang/std-ids.ts";
const list = (...xs) => xs.reduceRight((t, x) => ({ tag: CONS, fields: [x, t] }), { tag: NIL, fields: [] });
const rec = (...fields) => ({ tag: "rec", fields });
// A square from (−1, −1) to (1, 1); instances: shift right, depth, colour.
const square = { tag: FRAME_V.mesh, fields: [list(rec(-1, -1), rec(1, -1), rec(1, 1), rec(-1, 1)), list(0, 1, 2, 0, 2, 3)] };
const birds = list(rec(-0.4, 0.6, rec(1, 0, 0)), rec(0.3, 0.3, rec(0, 0, 1)));
const vertex = (scale) => (it, c) => ({ tag: FRAME_V.placed, fields: [rec(c.fields[0] * scale + it.fields[0], c.fields[1] * scale, it.fields[1], 1), it.fields[2]] });
const fragment = (c) => c;
const f32 = (path) => ({ path, kind: "f32" });
pageDraws({ s0: {
  wgsl: \`
@group(0) @binding(0) var<uniform> lab_caps: array<vec4u, 1>;
@group(0) @binding(1) var<storage, read> lab_inst: array<u32>;
@group(0) @binding(2) var<storage, read> lab_corner: array<u32>;
struct Out { @builtin(position) p: vec4f, @location(0) c: vec3f }
fn w(x: u32) -> f32 { return bitcast<f32>(x); }
@vertex fn lab_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let s = w(lab_caps[0].x);
  var o: Out;
  o.p = vec4f(w(lab_corner[v * 2u]) * s + w(lab_inst[i * 5u]), w(lab_corner[v * 2u + 1u]) * s, w(lab_inst[i * 5u + 1u]), 1.0);
  o.c = vec3f(w(lab_inst[i * 5u + 2u]), w(lab_inst[i * 5u + 3u]), w(lab_inst[i * 5u + 4u]));
  return o;
}
@fragment fn lab_fs(o: Out) -> @location(0) vec4f { return vec4f(o.c, 1.0); }\`,
  caps: [[f32([])]], instance: [f32([0]), f32([1]), f32([2, 0]), f32([2, 1]), f32([2, 2])], corner: [f32([0]), f32([1])], colour: 3,
} });
const frameOf = (scale) => ({ tag: FRAME_V.frame, fields: [list({ tag: FRAME_V.pass, fields: [{ tag: FRAME_V.screen, fields: [] }, "#102030", { tag: TRUE, fields: [] },
  list({ tag: FRAME_V.draw, fields: [square, birds, vertex(scale), fragment, "s0", [scale]] })] })] });
window.run = async () => { let stage = 'open'; try {
  const W = 32, H = 32, canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  document.body.append(canvas);
  const gpu = await GpuFrames.open(canvas);
  if (!gpu) return { error: "no WebGPU" };
  stage = 'draw'; const first = gpu.draw(frameOf(0.5), sitedOf); stage = 'again';
  const again = gpu.draw(frameOf(0.5), sitedOf);
  const moved = gpu.draw(frameOf(0.25), sitedOf);
  gpu.draw(frameOf(0.5), sitedOf);
  // Read in the same task: once presented, a WebGPU canvas's texture is gone.
  const c2 = document.createElement("canvas"); c2.width = W; c2.height = H;
  const g = c2.getContext("2d"); g.drawImage(canvas, 0, 0);
  stage = "read";
  const got = Array.from(g.getImageData(0, 0, W, H).data);
  const want = Array.from(rasterize(frameOf(0.5), W, H, (f, ...xs) => f(...xs)).rgba);
  return { first, again, moved, got, want };
  } catch (e) { return { error: stage + ': ' + e }; }
};
`;
const dir = mkdtempSync(join(tmpdir(), "frames-"));
const out = await build({ stdin: { contents: entry, resolveDir: join(import.meta.dirname, ".."), loader: "ts" }, bundle: true, format: "iife", write: false, platform: "browser", logLevel: "silent" });
writeFileSync(join(dir, "page.html"), `<!doctype html><meta charset="utf-8"><script>${out.outputFiles[0].text}</script>`);

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" }),
  args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"],
});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
  await page.goto(`file://${join(dir, "page.html")}`);
  const r = await page.evaluate(() => (window as unknown as { run: () => Promise<Record<string, unknown>> }).run()) as { error?: string; first: { draws: number; bytes: number }; again: { bytes: number }; moved: { bytes: number }; got: number[]; want: number[] };
  assert.equal(r.error, undefined, `${r.error}\n${errors.join("\n")}`);
  assert.deepEqual(errors, []);
  assert.equal(r.first.draws, 1);
  assert.ok(r.first.bytes > 0);
  assert.equal(r.again.bytes, 0, "the same frame again sends nothing");
  assert.equal(r.moved.bytes, 16, "a changed capture sends only the captures");
  // Pixels: equal (within a step of rounding) but for a few on edges.
  let off = 0;
  for (let i = 0; i < r.got.length; i += 4) if ([0, 1, 2].some((k) => Math.abs(r.got[i + k] - r.want[i + k]) > 2)) off++;
  assert.ok(off <= 32 * 4, `${off} of ${32 * 32} pixels differ`);
  const at = (x: number, y: number) => r.got.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 3);
  assert.deepEqual(at(1, 1), [16, 32, 48], "the clear colour");
  console.log(`ok: GPU and CPU frames agree (${off} edge pixels differ), the same frame sends 0 bytes, a moved camera ${r.moved.bytes}`);
} finally { await browser.close(); }
