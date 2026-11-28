// Culling (G14b, CULLING.md): rain-page's drops four times closer, most of
// them outside the picture. Its draw's site has a cull pass (gpu-draws.ts),
// and the frame draws the kept drops alone, indirectly (gpu-frame.ts). The
// picture is the one drawn without culling, pixel for pixel. Run in
// headless Chromium (SwiftShader's WebGPU); skipped where there is none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../../ters/mcp/session.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "gpu-cull-"));
const chromiumPath = (): string | undefined => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const d = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
  return d ? ["chrome-linux64", "chrome-linux"].map((x) => join(root, d, x, "chrome")).find((x) => existsSync(x)) : undefined;
};
const exe = chromiumPath();

// rain-page's first glass at a zoom, drawn once: no ticks, so both
// pages draw the same drops.
function still(zoom: number, held?: (lines: string[]) => void): string {
  const program = join(dir, `rain-${zoom}${held ? "-held" : ""}`), out = `${program}.html`;
  cpSync(join(import.meta.dirname, "../../ters/examples/rain-page"), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  s.define("main", "function", []);
  const hole = /□#(\w+)/.exec(s.view("main"))![1];
  s.replace(hole, `with([attribute("width", "640"), attribute("height", "480"), render(() => frame of(start pane, ${zoom.toFixed(1)}))], tag("canvas", nil))`);
  s.save();
  if (held) {
    assert.equal(spawnSync(process.execPath, [lab, "decisions", program], { encoding: "utf8" }).status, 0);
    const lines = readFileSync(`${program}.decisions`, "utf8").split("\n");
    held(lines);
    writeFileSync(`${program}.decisions`, lines.join("\n"));
  }
  const r = spawnSync(process.execPath, [lab, "build-web", program, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

test("rain-page's drop draw has a cull pass, its glass of one instance none (G14b)", () => {
  const html = readFileSync(still(4), "utf8");
  // The drops' and the hail's (G19a).
  assert.equal((html.match(/fn lab_cull_main\(/g) ?? []).length, 2);
  assert.match(html, /let lab_it = lab_ii; \/\/ drawn/);
});

// The cull is the compiler's choice, written in the program's decisions
// (G14b2): a person may hold the draw unculled, every instance drawn.
test("rain-page's drop draw's culling is a decisions entry, held to none it draws every drop (G14b2)", () => {
  const entries: string[] = [];
  const html = readFileSync(still(4, (lines) => {
    // The drops' draw and the hail's (G19a), each held.
    const at = lines.flatMap((l, k) => (/ place: frame of's draw culling: /.test(l) ? [k] : []));
    assert.equal(at.length, 2, lines.join("\n"));
    for (const k of at) {
      assert.match(lines[k], /^\S+ place: frame of's draw culling: GPU; among none, GPU; target JavaScript page$/);
      lines[k] = `held ${lines[k].replace(": GPU;", ": none;")}`;
      entries.push(lines[k]);
    }
  }), "utf8");
  assert.doesNotMatch(html, /fn lab_cull_main\(/);
  const said = spawnSync(process.execPath, [lab, "check", join(dir, "rain-4-held")], { encoding: "utf8" }).stdout.split("\n").filter((l) => /^(held   |stale  |new    )/.test(l));
  assert.deepEqual(said.sort(), entries.map((e) => `held   ${e.split(" ")[1]} (JavaScript page): every instance drawn, where the compiler would cull it on the GPU`).sort());
});

test("rain-page four times closer: culled, it draws only the drops in the picture, and the same picture (G14b)", { skip: !exe && "no Chromium" }, async () => {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  const out = still(4);
  const picture = async (off: boolean) => {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("page:", e.message)); page.on("console", (m) => console.log("console:", m.text()));
    await page.addInitScript((off: boolean) => {
      type W = { labCullOff?: true; ctx?: unknown; indirect: unknown[]; GPURenderPassEncoder?: { prototype: { drawIndexedIndirect(b: unknown, o: number): void } } };
      const w = window as unknown as W;
      if (off) w.labCullOff = true;
      w.indirect = [];
      const rp = w.GPURenderPassEncoder?.prototype;
      if (rp) { const draw = rp.drawIndexedIndirect; rp.drawIndexedIndirect = function (b: unknown, o: number) { w.indirect.push(b); return draw.call(this, b, o); }; }
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
    }, off);
    await page.goto(`file://${out}`);
    if (!(await page.evaluate(() => !!(navigator as { gpu?: unknown }).gpu))) { await page.close(); return null; }
    await page.waitForFunction(() => !!(window as unknown as { ctx?: { tex: unknown } }).ctx?.tex, undefined, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(async () => {
      type Buf = { mapAsync(m: number): Promise<void>; getMappedRange(): ArrayBuffer };
      const w = window as unknown as { indirect: unknown[]; ctx: { dev: { createBuffer(d: object): Buf; createCommandEncoder(): { copyTextureToBuffer(a: object, b: object, s: number[]): void; copyBufferToBuffer(a: unknown, ao: number, b: unknown, bo: number, n: number): void; finish(): unknown }; queue: { submit(c: unknown[]): void; onSubmittedWorkDone(): Promise<void> } }; tex: { width: number; height: number } } };
      const { dev, tex } = w.ctx, row = Math.ceil(tex.width * 4 / 256) * 256;
      await dev.queue.onSubmittedWorkDone();
      const px = dev.createBuffer({ size: row * tex.height, usage: 0x01 | 0x08 }), args = dev.createBuffer({ size: 32, usage: 0x01 | 0x08 }), enc = dev.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: px, bytesPerRow: row }, [tex.width, tex.height]);
      if (w.indirect.length) enc.copyBufferToBuffer(w.indirect[w.indirect.length - 1], 0, args, 0, 32);
      dev.queue.submit([enc.finish()]);
      await px.mapAsync(1); await args.mapAsync(1);
      return { pixels: Array.from(new Uint8Array(px.getMappedRange())), indirect: w.indirect.length, drawn: new Uint32Array(args.getMappedRange())[1] };
    });
    await page.close();
    return seen;
  };
  try {
    const culled = await picture(false), whole = await picture(true);
    if (!culled || !whole) return;
    // Culled: one indirect draw, of fewer drops than the 20,000, but some.
    assert.equal(whole.indirect, 0);
    assert.ok(culled.indirect >= 1);
    assert.ok(culled.drawn > 100 && culled.drawn < 20000 / 4, String(culled.drawn));
    // The same picture, pixel for pixel, and drops in it.
    assert.equal(culled.pixels.length, whole.pixels.length);
    let differ = 0, colours = new Set<number>();
    for (let i = 0; i < whole.pixels.length; i += 4) {
      if (culled.pixels[i] !== whole.pixels[i] || culled.pixels[i + 1] !== whole.pixels[i + 1] || culled.pixels[i + 2] !== whole.pixels[i + 2]) differ++;
      colours.add((whole.pixels[i] << 16) | (whole.pixels[i + 1] << 8) | whole.pixels[i + 2]);
    }
    assert.equal(differ, 0);
    assert.ok(colours.size > 3, String(colours.size));
  } finally { await browser.close(); }
});
