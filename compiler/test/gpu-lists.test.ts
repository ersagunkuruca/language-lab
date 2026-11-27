// A draw that captures an Array (G15a1, LIGHTS.md): the Array goes to the
// GPU as a storage buffer, its length read as the shader runs, so the
// module is the same whatever the length. rain-page's glass is drawn red
// by the sum of an Array's items, against the same glass with the sum
// written as a number. Run in headless Chromium (SwiftShader's WebGPU);
// the pixels part is skipped where there is none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../../ters/mcp/session.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "gpu-lists-"));
const chromiumPath = (): string | undefined => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const d = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
  return d ? ["chrome-linux64", "chrome-linux"].map((x) => join(root, d, x, "chrome")).find((x) => existsSync(x)) : undefined;
};
const exe = chromiumPath();

// rain-page's glass alone, its red `red` of the lamps `lamps` and a little
// more up the glass: an Array of Float64s, or a List of them (G15a2), made
// outside the draw so the draw captures it.
function glass(name: string, lamps: string, red: string, list = false): string {
  const program = join(dir, name), out = `${program}.html`;
  cpSync(join(import.meta.dirname, "../../ters/examples/rain-page"), program, { recursive: true });
  const s = new Session(program);
  const def = (n: string, params: string[], body: string) => { s.define(n, "function", params); s.replace(/□#(\w+)/.exec(s.view(n))![1], body); };
  def("glow from", ["a", "i", "acc"], "if i > 0 then glow from(a, i - 1, acc + first(item at(a, i - 1), else 0.0)) else acc");
  s.define("lamps lit", "function", ["c", "ls"]);
  s.replace(/□#(\w+)/.exec(s.view("lamps lit"))![1], "across(x, y) = c; □");
  s.replace(/□#(\w+)/.exec(s.view("lamps lit"))![1], `colour(${red} + 0.2 · y, 0.0, 0.0)`);
  def("lamps", [], list ? lamps : `array of(${lamps})`);
  def("see", ["ls"], 'frame([pass(screen, "#000000", false, [draw(screen quad, [0], (i, c) => glass corner(c, 1.0), (c) => lamps lit(c, ls))])])');
  s.remove("main");
  // Held in a cell, so the page reads them as it runs, not the compiler.
  s.define("main", "function", []);
  s.replace(/□#(\w+)/.exec(s.view("main"))![1], "ls = cell(lamps()); □");
  s.replace(/□#(\w+)/.exec(s.view("main"))![1], 'with([attribute("width", "320"), attribute("height", "240"), render(() => see(read(ls)))], tag("canvas", nil))');
  s.save();
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
}
const modules = (html: string) => [...html.matchAll(/lab_list0/g)].length;

test("a draw's captured Array is a storage buffer, one module for any length (G15a1)", () => {
  const two = readFileSync(glass("two", "[0.1, 0.05]", "glow from(ls, array length(ls), 0.0)"), "utf8");
  const three = readFileSync(glass("three", "[0.1, 0.05, 0.25]", "glow from(ls, array length(ls), 0.0)"), "utf8");
  assert.ok(modules(two) > 0, "the draw reads its Array on the GPU");
  assert.match(two, /var<storage, read> lab_list0: array<u32>;/);
  const site = (h: string) => /fn lab_list0_len[\s\S]*?@fragment/.exec(h)?.[0];
  assert.ok(site(two));
  assert.equal(site(two), site(three));
});

// The glass drawn on the GPU (null where there is none), its pixels.
async function pixels(outs: string[]): Promise<number[][] | null> {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  const picture = async (out: string) => {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("page:", e.message)); page.on("console", (m) => console.log("console:", m.text()));
    await page.addInitScript(() => {
      const w = window as unknown as { ctx?: unknown };
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
    await page.goto(`file://${out}`);
    if (!(await page.evaluate(() => !!(navigator as { gpu?: unknown }).gpu))) { await page.close(); return null; }
    await page.waitForFunction(() => !!(window as unknown as { ctx?: { tex: unknown } }).ctx?.tex, undefined, { timeout: 20000 });
    await page.waitForTimeout(1000);
    const pixels = await page.evaluate(async () => {
      type Buf = { mapAsync(m: number): Promise<void>; getMappedRange(): ArrayBuffer };
      const w = window as unknown as { ctx: { dev: { createBuffer(d: object): Buf; createCommandEncoder(): { copyTextureToBuffer(a: object, b: object, s: number[]): void; finish(): unknown }; queue: { submit(c: unknown[]): void; onSubmittedWorkDone(): Promise<void> } }; tex: { width: number; height: number } } };
      const { dev, tex } = w.ctx, row = Math.ceil(tex.width * 4 / 256) * 256;
      await dev.queue.onSubmittedWorkDone();
      const px = dev.createBuffer({ size: row * tex.height, usage: 0x01 | 0x08 }), enc = dev.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: px, bytesPerRow: row }, [tex.width, tex.height]);
      dev.queue.submit([enc.finish()]);
      await px.mapAsync(1);
      return Array.from(new Uint8Array(px.getMappedRange()));
    });
    await page.close();
    return pixels;
  };
  try {
    const out: number[][] = [];
    for (const o of outs) { const p = await picture(o); if (!p) return null; out.push(p); }
    return out;
  } finally { await browser.close(); }
}
// Within one step of 255 (the f32 sum against the number written), and
// red where the lamps add red.
function same(read: number[], written: number[]) {
  assert.equal(read.length, written.length);
  let far = 0, red = 0;
  for (let i = 0; i < read.length; i += 4) {
    if (Math.abs(read[i] - written[i]) > 1 || read[i + 1] !== written[i + 1]) far++;
    if (read[i] > 100) red++;
  }
  assert.equal(far, 0);
  assert.ok(red > read.length / 8, String(red));
}

test("a draw's captured Array is read on the GPU: its sum is the number written (G15a1)", { skip: !exe && "no Chromium" }, async () => {
  const got = await pixels([glass("read", "[0.1, 0.05, 0.25]", "glow from(ls, array length(ls), 0.0)"), glass("written", "[0.1, 0.05, 0.25]", "0.4 + 0.0 · first(item at(ls, 0), else 0.0)")]);
  if (got) same(got[0], got[1]);
});

// A List in a shader is held as an Array (G15a2): captured, it is sent as
// one, and a fold over it (sum) is a loop over its items, the last first.
test("a draw's captured List is a storage buffer and its sum a loop (G15a2)", () => {
  const html = readFileSync(glass("list", "[0.1, 0.05, 0.25]", "sum(ls)", true), "utf8");
  assert.match(html, /var<storage, read> lab_list0: array<u32>;/);
  assert.match(html, /fold_items/);
});

test("a draw's captured List is read on the GPU: its sum is the number written (G15a2)", { skip: !exe && "no Chromium" }, async () => {
  const got = await pixels([glass("list-read", "[0.1, 0.05, 0.25]", "sum(ls)", true), glass("list-written", "[0.1, 0.05, 0.25]", "0.4 + 0.0 · sum(ls)", true)]);
  if (got) same(got[0], got[1]);
});
