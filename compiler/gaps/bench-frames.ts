// FRAMES.md's stage 2 round: `node compiler/gaps/bench-frames.ts [birds…]`
// (2000 and 20000 by default; SECONDS=6). The Ters page that draws the
// flock with data (ters/examples/flock-frame-page, built with
// `ters build-web`, its bird count set) beside the same flock written by
// hand for WebGPU (flock.ideal-gpu.js), each in headless Chromium with
// WebGPU on SwiftShader. A frame's figures, after 2 s to warm up:
// - main: main-thread milliseconds, from a CPU profile (idle left out);
// - draw: from the frame's first GPU call (writing a buffer, making an
//   encoder) to its submit, which is gpu-frame.ts's draw for the page:
//   writing what changed and encoding the passes;
// - sent: bytes written to buffers and textures;
// - draws: draw calls.
// SwiftShader fills the triangles on the CPU in another process, so the
// frames a second say little about a real GPU; main and draw do.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../../ters/node_modules/esbuild/lib/main.js";
import { chromium } from "../../ters/node_modules/playwright-core/index.mjs";
import { Session } from "../../ters/mcp/session.ts";

const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ["2000", "20000"]).map(Number);
const seconds = Number(process.env.SECONDS ?? 6);
const example = join(import.meta.dirname, "../../ters/examples/flock-frame-page");
const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "bench-frames-"));

// Counting what crosses to the GPU, and timing each frame's drawing.
const COUNT = `(() => {
  const c = (globalThis.__frames = { frames: 0, bytes: 0, draws: 0, drawMs: 0, first: -1 });
  const wrap = (proto, name, f) => { const was = proto[name]; proto[name] = function (...a) { f.apply(this, a); return was.apply(this, a); }; };
  const begin = () => { if (c.first < 0) c.first = performance.now(); };
  if (!globalThis.GPUQueue) return;
  wrap(GPUQueue.prototype, "writeBuffer", (b, off, data, dOff, size) => { begin(); c.bytes += size !== undefined ? size * (data.BYTES_PER_ELEMENT ?? 1) : data.byteLength - (dOff ?? 0) * (data.BYTES_PER_ELEMENT ?? 1); });
  wrap(GPUQueue.prototype, "writeTexture", (t, data) => { begin(); c.bytes += data.byteLength; });
  wrap(GPUDevice.prototype, "createCommandEncoder", begin);
  wrap(GPURenderPassEncoder.prototype, "drawIndexed", () => c.draws++);
  wrap(GPURenderPassEncoder.prototype, "draw", () => c.draws++);
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (...a) { const r = submit.apply(this, a); if (c.first >= 0) c.drawMs += performance.now() - c.first; c.first = -1; c.frames++; return r; };
})();`;

// The Ters page with n birds.
function tersPage(n: number): string {
  const d = mkdtempSync(join(dir, "ters-"));
  cpSync(example, d, { recursive: true });
  new Session(d).replace("birds on page", String(n), "2000");
  const r = spawnSync(process.execPath, [lab, "build-web", d], { cwd: d, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return join(d, `${d.split("/").pop()}.html`);
}

// The page by hand with n birds.
async function idealPage(n: number): Promise<string> {
  const floor = readFileSync(join(example, "floor.ppm"), "utf8");
  const out = await build({
    stdin: { contents: `import { startFlock } from "./flock.ideal-gpu.js"; const c = document.createElement("canvas"); c.width = 640; c.height = 600; document.body.append(c); startFlock(c, ${n}, ${JSON.stringify(floor)});`, resolveDir: import.meta.dirname, loader: "js" },
    bundle: true, format: "iife", write: false, logLevel: "warning", minify: true,
  });
  const f = join(dir, `ideal-${n}.html`);
  writeFileSync(f, `<!doctype html><meta charset="utf-8"><body><script>${out.outputFiles[0].text}</script>`);
  return f;
}

interface Measured { frames: number; main: number; draw: number; sent: number; draws: number; fps: number }
async function measure(page: string): Promise<Measured> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
    args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"],
  });
  try {
    const p = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.addInitScript(COUNT);
    await p.goto(`file://${page}`);
    await p.waitForTimeout(2000);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    const before = await p.evaluate(() => ({ ...(globalThis as unknown as { __frames: Record<string, number> }).__frames }));
    await cdp.send("Profiler.start");
    await p.waitForTimeout(seconds * 1000);
    const { profile } = await cdp.send("Profiler.stop") as { profile: { nodes: { id: number; callFrame: { functionName: string } }[]; samples: number[]; timeDeltas: number[] } };
    const after = await p.evaluate(() => ({ ...(globalThis as unknown as { __frames: Record<string, number> }).__frames }));
    if (errors.length) throw new Error(errors.join("\n"));
    const name = new Map(profile.nodes.map((n) => [n.id, n.callFrame.functionName]));
    if (process.env.PROFILE_OUT) writeFileSync(`${process.env.PROFILE_OUT}-${page.split("/").pop()}.json`, JSON.stringify(profile));
    if (process.env.PROFILE) {
      const self = new Map<string, number>(), parent = new Map<number, number>();
      const full = profile.nodes as unknown as { id: number; children?: number[]; callFrame: { functionName: string; lineNumber: number } }[];
      for (const nd of full) for (const c of nd.children ?? []) parent.set(c, nd.id);
      const label = new Map(full.map((nd) => [nd.id, `${nd.callFrame.functionName || "(anon)"}:${nd.callFrame.lineNumber}`]));
      const total = new Map<string, number>();
      profile.samples.forEach((s, i) => {
        const ms = profile.timeDeltas[i] / 1000;
        self.set(label.get(s)!, (self.get(label.get(s)!) ?? 0) + ms);
        const seen = new Set<string>();
        for (let at: number | undefined = s; at !== undefined; at = parent.get(at)) { const l = label.get(at)!; if (!seen.has(l)) { seen.add(l); total.set(l, (total.get(l) ?? 0) + ms); } }
      });
      const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `  ${v.toFixed(0).padStart(6)} ms ${k}`).join("\n");
      console.error(`${page}\nself:\n${top(self)}\ntotal:\n${top(total)}`);
    }
    let busy = 0;
    profile.samples.forEach((s, i) => { if (name.get(s) !== "(idle)") busy += profile.timeDeltas[i] / 1000; });
    const frames = after.frames - before.frames;
    if (!frames) throw new Error("no frame was drawn with WebGPU");
    return { frames, main: busy / frames, draw: (after.drawMs - before.drawMs) / frames, sent: (after.bytes - before.bytes) / frames, draws: (after.draws - before.draws) / frames, fps: frames / seconds };
  } finally { await browser.close(); }
}

const row = (way: string, m: Measured) => `| ${way} | ${m.main.toFixed(2)} | ${m.draw.toFixed(2)} | ${Math.round(m.sent).toLocaleString("en")} | ${m.draws.toFixed(0)} | ${m.fps.toFixed(1)} |`;
console.log("| birds, way | main ms | draw ms | bytes sent | draw calls | frames a second |\n|---|---|---|---|---|---|");
for (const n of sizes) {
  const ideal = await measure(await idealPage(n)), ters = await measure(tersPage(n));
  console.log(row(`${n.toLocaleString("en")}, by hand`, ideal));
  console.log(row(`${n.toLocaleString("en")}, Ters`, ters));
}
