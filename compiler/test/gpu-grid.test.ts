// The grid (G15b2, LIGHTS.md): rain-page's glass sums the glow of the
// fireflies within reach of each place on it. Its fragment reads only the
// fireflies filed in its place's cell of a grid over their places, which
// two compute passes build when the fireflies move (gpu-draws.ts,
// gpu-frame.ts). The picture is the one drawn reading every firefly,
// pixel for pixel. Run in headless Chromium (SwiftShader's WebGPU);
// skipped where there is none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../../ters/mcp/session.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "gpu-grid-"));
const chromiumPath = (): string | undefined => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const d = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
  return d ? ["chrome-linux64", "chrome-linux"].map((x) => join(root, d, x, "chrome")).find((x) => existsSync(x)) : undefined;
};
const exe = chromiumPath();

// rain-page's first glass, drawn once at the start: no ticks, so both
// pages draw the same fireflies.
function still(held?: (lines: string[]) => void): string {
  const program = join(dir, held ? "rain-held" : "rain"), out = `${program}.html`;
  cpSync(join(import.meta.dirname, "../../ters/examples/rain-page"), program, { recursive: true });
  const s = new Session(program);
  s.remove("main");
  s.define("main", "function", []);
  const hole = /□#(\w+)/.exec(s.view("main"))![1];
  s.replace(hole, `with([attribute("width", "320"), attribute("height", "240"), render(() => frame of(start pane, 1.0))], tag("canvas", nil))`);
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
const html = still();

test("rain-page's glass reads its fireflies by cell of a grid two passes build (G15b2)", () => {
  const page = readFileSync(html, "utf8");
  assert.equal((page.match(/fn lab_grid\d+_bounds\(/g) ?? []).length, 1);
  assert.equal((page.match(/fn lab_grid\d+_main\(/g) ?? []).length, 1);
  assert.match(page, /= lab_grid\d+_cell\([^)]*\);/);
  assert.match(page, /grids:\[\{list:\d+,dims:2,cap:32,call:"\w+"\}\]/);
});

// The grid is the compiler's choice, written in the program's decisions
// (G15b2b) by the within reach call as written: a person may hold it to
// every item, no grid.
test("rain-page's within reach is a decisions entry, held to every item it has no grid (G15b2b)", () => {
  let entry = "";
  const page = readFileSync(still((lines) => {
    const at = lines.findIndex((l) => / way: glass colour's items within reach: /.test(l));
    assert.ok(at >= 0, lines.join("\n"));
    assert.match(lines[at], /^\S+ way: glass colour's items within reach: grid; among every item, grid; target JavaScript page$/);
    assert.equal(lines.filter((l) => /items within reach/.test(l)).length, 1);
    const call = lines[at].split(" ")[0];
    // The call as written, not a copy lowering made.
    assert.equal(JSON.parse(readFileSync(join(dir, "rain-held", "code.json"), "utf8")).nodes[call]?.kind, "call");
    lines[at] = entry = `held ${lines[at].replace(": grid;", ": every item;")}`;
  }), "utf8");
  assert.doesNotMatch(page, /fn lab_grid\d+_main\(/);
  assert.doesNotMatch(page, /grids:\[/);
  const said = spawnSync(process.execPath, [lab, "check", join(dir, "rain-held")], { encoding: "utf8" }).stdout.split("\n").filter((l) => /^(held   |stale  |new    )/.test(l));
  assert.deepEqual(said, [`held   ${entry.split(" ")[1]} (JavaScript page): every item read, where the compiler would read them by a grid`]);
});

test("rain-page's glass by the grid is the picture drawn reading every firefly (G15b2)", { skip: !exe && "no Chromium" }, async () => {
  const { chromium } = await import("../../ters/node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({ executablePath: exe, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"] });
  const picture = async (off: boolean) => {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("page:", e.message)); page.on("console", (m) => console.log("console:", m.text()));
    await page.addInitScript((off: boolean) => {
      type W = { labGridOff?: true; ctx?: unknown; passes: string[]; GPUComputePassEncoder?: { prototype: { setPipeline(p: { label?: string }): void } }; GPUDevice?: { prototype: { createComputePipeline(d: { compute: { entryPoint: string } }): unknown } } };
      const w = window as unknown as W;
      if (off) w.labGridOff = true;
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
    }, off);
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
    const grid = await picture(false), whole = await picture(true);
    if (!grid || !whole) return;
    assert.ok(grid.passes.some((p) => /^lab_grid\d+_main$/.test(p)), grid.passes.join());
    assert.ok(!whole.passes.some((p) => /^lab_grid/.test(p)), whole.passes.join());
    assert.equal(grid.pixels.length, whole.pixels.length);
    let differ = 0;
    const colours = new Set<number>();
    for (let i = 0; i < whole.pixels.length; i += 4) {
      if (grid.pixels[i] !== whole.pixels[i] || grid.pixels[i + 1] !== whole.pixels[i + 1] || grid.pixels[i + 2] !== whole.pixels[i + 2]) differ++;
      colours.add((whole.pixels[i] << 16) | (whole.pixels[i + 1] << 8) | whole.pixels[i + 2]);
    }
    assert.equal(differ, 0);
    assert.ok(colours.size > 3, String(colours.size));
  } finally { await browser.close(); }
});

// A main of its own that ticks rain-page's hail, whose touches are found
// by `neighbours` on a grid, compiled to a module (not a page): the
// grid's runtime gives up where it can't take the places, so the checks
// of what may fail count it so, not by a runtime table it isn't in
// (G19e, which measured the hail so).
test("rain-page's hail compiles to a module and ticks as the evaluator does (G19e)", () => {
  const program = join(dir, "rain-hail");
  cpSync(join(import.meta.dirname, "../../ters/examples/rain-page"), program, { recursive: true });
  const s = new Session(program);
  s.define("hail after", "function", ["n"]);
  s.replace("hail after", "fold range(n); nil → no hail; cons(i, r) with h → hail ticked(h, 120 + n - 1 - i, wipe(false, half, half))", "□");
  // The stones' neighbours counted in a fold, as G19e's measure does: a
  // fold's arm is asked what may fail, the grid in it too.
  s.define("near sum", "function", ["ss", "k"]);
  s.replace("near sum", "fold range(k); nil → 0; cons(i, r) with c → c + length(neighbours(ss, stone place, 0.06))", "□");
  s.remove("main");
  s.define("main", "function", []);
  const hole = /□#(\w+)/.exec(s.view("main"))![1];
  s.replace(hole, "print(show((near sum(hail after(80).stones, 3), map(hail after(80).stones, (t) => t.x + t.y))))");
  s.save();
  const out = join(dir, "rain-hail.mjs");
  const c = spawnSync(process.execPath, [lab, "compile", program, "-o", out], { encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr);
  const compiled = spawnSync(process.execPath, [out], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  const evaluated = spawnSync(process.execPath, [lab, "run", program, "--evaluator"], { encoding: "utf8" });
  assert.equal(evaluated.status, 0, evaluated.stderr);
  assert.match(compiled.stdout, /^\(\d+, \[0\.\d/);
  assert.equal(compiled.stdout, evaluated.stdout);
});
