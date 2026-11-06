// What leaving the main thread costs (C61a, docs/design/targets/
// WHERE-IT-RUNS.md): a worker's start, round trip and copies or
// transfers, and a WebGPU compute pass there and back, against the same
// loop on the main thread, at 1,000 to 4,000,000 items and two amounts of
// work per item. The numbers become the price list the chooser reads (C61b).
// Run: node gaps/bench-places.ts   (CHROMIUM=path for a browser of your own;
// on a machine with a GPU, GPU=1 drops SwiftShader for the real adapter)

import { Worker } from "node:worker_threads";
import { chromium } from "../../ters/node_modules/playwright-core/index.mjs";

// Each item: x ← √(x² + 1), `work` times.
const loop = (a: Float32Array | Float64Array, work: number) => { for (let i = 0; i < a.length; i++) { let x = a[i]; for (let k = 0; k < work; k++) x = Math.sqrt(x * x + 1); a[i] = x; } };
const SIZES = [1e3, 1e5, 1e6, 4e6], WORK = [1, 100];
const ms = (x: number) => `${x.toFixed(2)} ms`.padStart(11);

console.log("A worker (Node's worker_threads), Float64Array");
{
  const t0 = performance.now();
  const w = new Worker(`const { parentPort } = require("node:worker_threads");
parentPort.on("message", (m) => { const a = m.a; for (let i = 0; i < a.length; i++) { let x = a[i]; for (let k = 0; k < m.work; k++) x = Math.sqrt(x * x + 1); a[i] = x; } parentPort.postMessage(a, m.t ? [a.buffer] : []); });`, { eval: true });
  const trip = (a: Float64Array, work: number, t: boolean) => new Promise<void>((r) => { w.once("message", () => r()); w.postMessage({ a, work, t }, t ? [a.buffer] : []); });
  await trip(new Float64Array(1), 1, false);
  console.log(`  started, first round trip ${ms(performance.now() - t0)}`);
  console.log(`  ${"work".padEnd(5)} ${"items".padStart(9)} ${"copied".padStart(11)} ${"transferred".padStart(11)} ${"main thread".padStart(11)}`);
  for (const work of WORK) for (const n of SIZES) {
    const at = (t: boolean) => { const a = new Float64Array(n).fill(2), s = performance.now(); return trip(a, work, t).then(() => performance.now() - s); };
    const c = await at(false), tr = await at(true);
    const b = new Float64Array(n).fill(2), s = performance.now(); loop(b, work);
    console.log(`  ${String(work).padEnd(5)} ${String(n).padStart(9)} ${ms(c)} ${ms(tr)} ${ms(performance.now() - s)}`);
  }
  await w.terminate();
}

console.log("WebGPU compute (Float32), written there, run, read back");
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" }),
  args: ["--enable-unsafe-webgpu", ...(process.env.GPU ? [] : ["--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"])],
});
const page = await browser.newPage();
// WebGPU needs a secure context; a file: page is one.
await page.goto(new URL("../README.md", import.meta.url).href);
const lines = await page.evaluate(`(async () => {
  const lines = [], SIZES = ${JSON.stringify(SIZES)}, WORK = ${JSON.stringify(WORK)};
  if (!navigator.gpu) return ["  this browser has no WebGPU"];
  const ad = await navigator.gpu.requestAdapter();
  if (!ad) return ["  no adapter"];
  lines.push("  adapter: " + [ad.info?.vendor, ad.info?.architecture, ad.info?.description].filter(Boolean).join(" "));
  const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
  const ms = (x) => (x.toFixed(2) + " ms").padStart(11);
  lines.push("  work  " + "items".padStart(9) + " " + "GPU".padStart(11) + " " + "main thread".padStart(11));
  for (const work of WORK) {
    const code = "@group(0) @binding(0) var<storage, read_write> a: array<f32>;\\n@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) { let i = g.x + g.y * 65535u * 64u; if (i < arrayLength(&a)) { var x = a[i]; for (var k = 0u; k < " + work + "u; k++) { x = sqrt(x * x + 1.0); } a[i] = x; } }";
    const pipe = dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code }), entryPoint: "main" } });
    for (const n of SIZES) {
      const a = new Float32Array(n).fill(2);
      const run = async () => {
        const t = performance.now();
        const buf = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const back = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        dev.queue.writeBuffer(buf, 0, a);
        const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
        const enc = dev.createCommandEncoder(), p = enc.beginComputePass(), groups = Math.ceil(n / 64);
        p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535)); p.end();
        enc.copyBufferToBuffer(buf, 0, back, 0, n * 4); dev.queue.submit([enc.finish()]);
        await back.mapAsync(GPUMapMode.READ); new Float32Array(back.getMappedRange().slice(0)); back.unmap(); buf.destroy(); back.destroy();
        return performance.now() - t;
      };
      await run(); const g = await run();
      const b = new Float32Array(n).fill(2), s = performance.now();
      for (let i = 0; i < n; i++) { let x = b[i]; for (let k = 0; k < work; k++) x = Math.sqrt(x * x + 1); b[i] = x; }
      lines.push("  " + String(work).padEnd(5) + " " + String(n).padStart(9) + " " + ms(g) + " " + ms(performance.now() - s));
    }
  }
  return lines;
})()`) as string[];
console.log(lines.join("\n"));
await browser.close();
