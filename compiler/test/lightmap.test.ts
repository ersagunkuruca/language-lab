// Baked lightmaps (G17, LIGHTMAPS.md): rain-page's back wall is lit by its
// lamps, soft shadows and occlusion traced for each texel, about 2.4 s of
// work compiled. The compiler weighs it (bake-file.ts bakedPage) and bakes
// it to a file the page carries; held at start, the page traces it as it
// loads. Either way the picture is the same, pixel for pixel. The picture
// is read in headless Chromium (SwiftShader's WebGPU); skipped where there
// is none. The drops' probes (G18a) and the leaves' distance (G18d) too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../../ters/mcp/session.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "lightmap-"));
const chromiumPath = (): string | undefined => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const d = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
  return d ? ["chrome-linux64", "chrome-linux"].map((x) => join(root, d, x, "chrome")).find((x) => existsSync(x)) : undefined;
};
const exe = chromiumPath();

// rain-page's first picture, drawn once at the start, its wall and probes
// baked or, every answer held at start, traced as the page loads.
function still(held: boolean): { html: string; decisions: string[] } {
  const program = join(dir, held ? "rain-held" : "rain"), out = `${program}.html`;
  cpSync(join(import.meta.dirname, "../../ters/examples/rain-page"), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  s.define("main", "function", []);
  const hole = /□#(\w+)/.exec(s.view("main"))![1];
  s.replace(hole, `with([attribute("width", "320"), attribute("height", "240"), render(() => frame of(start pane, 1.0))], tag("canvas", nil))`);
  s.save();
  assert.equal(spawnSync(process.execPath, [lab, "decisions", program], { encoding: "utf8" }).status, 0);
  const decisions = readFileSync(`${program}.decisions`, "utf8").split("\n");
  if (held) writeFileSync(`${program}.decisions`, decisions.map((l) => / way: .*'s answer: /.test(l) ? `held ${l.replace(": baked to a file;", ": at start;")}` : l).join("\n"));
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { html: out, decisions };
}
const baked = still(false), traced = still(true);

test("rain-page's back wall is baked to a file its page carries, the compiler's choice (G17)", () => {
  assert.deepEqual(baked.decisions.filter((l) => / way: back wall's answer: /.test(l)).map((l) => l.replace(/^\S+ /, "")), ["way: back wall's answer: baked to a file; among at start, baked to a file; target JavaScript page"]);
  // And the drops' probes (G18a, PROBES.md): 85 ms of work against a
  // few to read back.
  assert.deepEqual(baked.decisions.filter((l) => / way: probe light's answer: /.test(l)).map((l) => l.replace(/^\S+ /, "")), ["way: probe light's answer: baked to a file; among at start, baked to a file; target JavaScript page"]);
  assert.match(readFileSync(baked.html, "utf8"), /baked\/[0-9a-f]{24}\.bin/);
  assert.doesNotMatch(readFileSync(traced.html, "utf8"), /baked\/[0-9a-f]{24}\.bin/);
  // Both draws stay on the GPU: the fireflies' within reach is one loop
  // over a list kept as written (library-reps.ts), not an array of List.
  for (const p of [baked.html, traced.html]) assert.equal((readFileSync(p, "utf8").match(/@fragment/g) ?? []).length, 2);
});

// The fireflies' soft shadows (G18c, G18d, PROBES.md): the glass marches
// the leaves' distance, read from a field of 256 × 192 samples of it. The
// distance is exact: less than 0 inside a leaf, the way to the nearest
// edge outside. The field is computed (or baked) as the weighing says, and
// the glass stays on the GPU (above: two fragments).
test("rain-page's fireflies' shadows march the leaves' distance, kept as samples (G18c, G18d)", () => {
  const s = new Session(join(import.meta.dirname, "../../ters/examples/rain-page"));
  const value = (e: string) => /= (.+) : (Float64|Int)$/m.exec(s.eval(e))![1];
  assert.equal(value("leaf distance(leaves, 0.27, 0.42)"), "-0.035");
  assert.equal(value("leaf distance(leaves, 0.27, 0.5)"), "0.045");
  assert.equal(value("length(leaf field.texels)"), String(256 * 192));
  assert.equal(baked.decisions.filter((l) => / way: leaf field's answer: /.test(l)).length, 1);
});

test("rain-page's picture is the same with its wall baked or traced at start (G17)", { skip: !exe && "no Chromium" }, async () => {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  const picture = async (html: string) => {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("page:", e.message)); page.on("console", (m) => console.log("console:", m.text()));
    await page.addInitScript(() => {
      type W = { ctx?: unknown; passes: string[]; GPUComputePassEncoder?: { prototype: { setPipeline(p: { label?: string }): void } }; GPUDevice?: { prototype: { createComputePipeline(d: { compute: { entryPoint: string } }): unknown } } };
      const w = window as unknown as W;
      w.passes = [];
      const dev = w.GPUDevice?.prototype;
      if (dev) { const make = dev.createComputePipeline; dev.createComputePipeline = function (d) { w.passes.push(d.compute.entryPoint); return make.call(this, d); }; }
      // The canvas a texture of the page's device (headless SwiftShader
      // loses the device once a canvas presents), read back below.
      const ctx = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, t: string, ...x: unknown[]) => unknown;
      (HTMLCanvasElement.prototype as unknown as { getContext: typeof ctx }).getContext = function (t, ...x) {
        if (t !== "webgpu") return ctx.call(this, t, ...x);
        const canvas = this;
        const c = { dev: null as unknown, tex: null as unknown, configure(cfg: { device: { createTexture(d: object): unknown }; format: string }) { c.dev = cfg.device; c.tex = cfg.device.createTexture({ size: [canvas.width, canvas.height], format: cfg.format, usage: 0x10 | 0x01 }); }, getCurrentTexture: () => c.tex, unconfigure() {} };
        w.ctx = c;
        return c;
      };
    });
    await page.goto(`file://${html}`);
    if (!(await page.evaluate(() => !!(navigator as { gpu?: unknown }).gpu))) { await page.close(); return null; }
    await page.waitForFunction(() => !!(window as unknown as { ctx?: { tex: unknown } }).ctx?.tex, undefined, { timeout: 20000 });
    await page.waitForTimeout(3000);
    const seen = await page.evaluate(async () => {
      type Buf = { mapAsync(m: number): Promise<void>; getMappedRange(): ArrayBuffer };
      const w = window as unknown as { passes: string[]; ctx: { dev: { createBuffer(d: object): Buf; createCommandEncoder(): { copyTextureToBuffer(a: object, b: object, s: number[]): void; finish(): unknown }; queue: { submit(c: unknown[]): void; onSubmittedWorkDone(): Promise<void> } }; tex: { width: number; height: number } } };
      const { dev, tex } = w.ctx, row = Math.ceil(tex.width * 4 / 256) * 256;
      await dev.queue.onSubmittedWorkDone();
      const px = dev.createBuffer({ size: row * tex.height, usage: 0x01 | 0x08 }), enc = dev.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: px, bytesPerRow: row }, [tex.width, tex.height]);
      dev.queue.submit([enc.finish()]);
      await px.mapAsync(1);
      return { pixels: Array.from(new Uint8Array(px.getMappedRange())), passes: w.passes };
    });
    await page.close();
    return seen;
  };
  try {
    const a = await picture(baked.html), b = await picture(traced.html);
    if (!a || !b) return;
    assert.equal(a.pixels.length, b.pixels.length);
    let differ = 0, lit = 0;
    for (let i = 0; i < a.pixels.length; i += 4) {
      if (a.pixels[i] !== b.pixels[i] || a.pixels[i + 1] !== b.pixels[i + 1] || a.pixels[i + 2] !== b.pixels[i + 2]) differ++;
      if (a.pixels[i] > 120) lit++;
    }
    assert.equal(differ, 0);
    // The lamps light the wall: a warm part of the picture.
    assert.ok(lit > 100, String(lit));
  } finally { await browser.close(); }
});
