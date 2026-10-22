// The scalar profile compiled to WGSL, run on a real GPU (WebGPU in
// headless Chromium) and compared with the evaluator. Node has no WebGPU,
// so this is a script rather than a unit test; CI runs it after the
// projectional folder's `npm ci`, whose playwright-core it borrows (the
// compiler has no dependencies of its own).
//
//   node gpu.ts   (or npm run gpu)
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome.
// Each compiled function gets a compute shader that applies it to a grid
// of inputs. GPUs compute in f32, and WGSL only promises sin and cos to
// within 2⁻¹¹ (https://www.w3.org/TR/WGSL/#floating-point-accuracy), so
// the check is "close", not "equal": within 2e-3 of the evaluator,
// relative to the size of the answer, and Bool results exactly.

import { chromium } from "../projectional/node_modules/playwright-core/index.mjs";
import { makeRunner, type Value } from "../projectional/src/lang/run.ts";
import type { Code } from "../projectional/src/model.ts";
import type { Info } from "../projectional/src/lang/infer.ts";
import type { Names } from "../projectional/src/presentation.ts";
import type { Id } from "../projectional/src/model.ts";
import { lowerScalar } from "./src/scalar.ts";
import { emitWgsl, type ShaderFunc } from "./src/wgsl.ts";
import { load } from "./src/program.ts";
import { area, corners } from "./src/fixtures.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
const TRUE = "std.bool.true";

// Inputs that f32 holds exactly, so only the computation differs.
const GRID = [-2.5, -1.75, -1, -0.5, -0.125, 0, 0.25, 0.5, 1, 1.5, 2, 3.75];

interface Case { label: string; code: Code; info: Info; names: Names; roots: Id[]; inputs?: (f: ShaderFunc) => number[][] | undefined }
const cases: Case[] = [
  ...["calculus", "physics", "shaders"].map((name) => { const p = load(name); return { label: name, code: p.code, info: p.info, names: p.pres.names, roots: p.own.defs }; }),
  (() => {
    const a = area();
    // A loop: ∫ from x in `steps` strips of width w.
    return { label: "area (tail recursion as a loop)", code: a.code, info: a.info, names: a.names, roots: [a.area], inputs: (f) => (f.name === "area" ? [[0, 0.01, 200, 0], [-1, 0.125, 16, 0], [1, 0.5, 4, 2]] : undefined) };
  })(),
  (() => {
    const c = corners();
    // gcd by subtraction only ends for positive whole numbers.
    return { label: "corners", code: c.code, info: c.info, names: c.names, roots: Object.values(c.defs), inputs: (f) => (f.name === "gcd" ? [[12, 18], [7, 3], [5, 5], [1, 100]] : undefined) };
  })(),
];

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" }),
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"],
});
const page = await browser.newPage();
// WebGPU needs a secure context; a data: page isn't one, file: is.
await page.goto(new URL("./README.md", import.meta.url).href);
if (!(await page.evaluate(() => !!navigator.gpu))) throw new Error("this browser has no WebGPU");

let failures = 0, compared = 0;
for (const c of cases) {
  const shader = emitWgsl(lowerScalar(c.code, c.info, c.names, c.roots));
  const r = makeRunner(c.code, c.info, { print: () => {} });
  for (const f of shader.funcs) {
    const inputs = c.inputs?.(f) ?? GRID.map((x, k) => f.params.map((t, j) => (t === "i32" ? (k + j) % 2 : GRID[(k + 3 * j) % GRID.length])));
    const arg = (t: string, j: number) => (t === "i32" ? `(inp[b + ${j}u] > 0.5)` : `inp[b + ${j}u]`);
    const kernel = `${shader.wgsl}
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= ${inputs.length}u) { return; }
  let b = i * ${f.params.length}u;
  let r = ${f.wgsl}(${f.params.map(arg).join(", ")});
  outp[i] = ${f.result === "i32" ? "select(0.0, 1.0, r)" : "r"};
}`;
    // A GPU that never answers is a failure, not a hang.
    const got = await Promise.race([
      page.evaluate(run, { wgsl: kernel, inputs: inputs.flat(), count: inputs.length }),
      new Promise<string>((done) => setTimeout(() => done("no answer from the GPU in 60 s"), 60_000).unref()),
    ]);
    if (typeof got === "string") { console.log(`✗ ${c.label}: ${f.name}: ${got}`); failures++; continue; }
    let bad = 0;
    inputs.forEach((args, k) => {
      const want = first(r.call(r.value(f.def), ...args.map((x, j) => (f.params[j] === "i32" ? { tag: x ? TRUE : "std.bool.false", fields: [] } : x))));
      const ok = f.result === "i32"
        ? (got[k] === 1) === ((want as { tag: string }).tag === TRUE)
        : typeof want === "number" && (Number.isNaN(want) ? Number.isNaN(got[k]) : Math.abs(got[k] - want) <= 2e-3 * Math.max(1, Math.abs(want)));
      compared++;
      if (!ok) { bad++; console.log(`✗ ${c.label}: ${f.name}(${args.join(", ")}) = ${got[k]} on the GPU, ${String(want)} in the evaluator`); }
    });
    failures += bad;
    if (!bad) console.log(`✓ ${c.label}: ${f.name} (${inputs.length} inputs)`);
  }
  for (const [def, why] of shader.refused) console.log(`  ${c.label}: ${c.names[def] ?? def} is refused: it ${why}`);
}
await browser.close();
console.log(`${compared} values compared, ${failures} wrong`);
if (failures || !compared) process.exit(1);

// In the page: compile the kernel, run it once per input, read the results.
async function run({ wgsl, inputs, count }: { wgsl: string; inputs: number[]; count: number }): Promise<number[] | string> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return "no GPU adapter";
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: wgsl });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length) return errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("; ");
  const buffer = (data: Float32Array, usage: number) => {
    const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage, mappedAtCreation: true });
    new Float32Array(b.getMappedRange()).set(data);
    b.unmap();
    return b;
  };
  const inp = buffer(new Float32Array(inputs), GPUBufferUsage.STORAGE);
  const out = buffer(new Float32Array(count), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const read = device.createBuffer({ size: Math.max(16, count * 4), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inp } }, { binding: 1, resource: { buffer: out } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  enc.copyBufferToBuffer(out, 0, read, 0, count * 4);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  return [...new Float32Array(read.getMappedRange())].slice(0, count);
}
