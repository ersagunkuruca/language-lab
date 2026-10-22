// shaders.html: a program in the language, compiled to WGSL and drawn by the
// GPU with WebGPU, next to its code and the WGSL it became.
//
// A shader here is three definitions, `red`, `green` and `blue`, each of
// (x, y, time) giving a Number from 0 to 1. x and y run from −1 to 1 across
// the shorter side of the picture. The compiler lowers them to the scalar
// profile (compiler/src/scalar.ts) and prints WGSL (compiler/src/wgsl.ts);
// the page wraps that in a fragment shader that calls them once per pixel.
//
// To show the GPU computes what the language means, a compute shader runs
// the same functions at sample points and the page compares them with the
// evaluator. Without WebGPU, the picture is drawn on the CPU by the same
// lowering printed as WebAssembly (compiler/src/wasm.ts), smaller.

import type { Code, Id } from "../src/model.ts";
import type { Names, Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import shaderCode from "../examples/shaders/code.json" with { type: "json" };
import shaderNames from "../examples/shaders/names.default.json" with { type: "json" };
import shaderComments from "../examples/shaders/comments.json" with { type: "json" };
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { merge } from "../src/model.ts";
import { layer } from "../src/presentation.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { emitWgsl } from "../../compiler/src/wgsl.ts";
import { emitWasm, instantiate } from "../../compiler/src/wasm.ts";

const own = shaderCode as Code;
const code = merge(LIBRARY.code, own), names = layer<Names>(LIBRARY.names, shaderNames as Names);
const info = infer(code, names, undefined, { pins: LIBRARY.pins, hidden: LIBRARY.hidden });
if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("\n"));
const pres: Presentation = { names, comments: shaderComments as Record<Id, string>, hints: {}, style: blocksStyle as Style };
const named = (name: string) => own.defs.find((d) => names[d] === name)!;
const CHANNELS = ["red", "green", "blue"] as const;

const lowered = lowerScalar(code, info, names, CHANNELS.map(named));
const shader = emitWgsl(lowered);
const entry = (name: string) => {
  const f = shader.funcs.find((f) => f.name === name);
  if (!f) throw new Error(`${name} can't run on the GPU: it ${shader.refused.get(named(name)) ?? "isn't in the scalar profile"}`);
  return f.wgsl;
};

const $ = (id: string) => document.getElementById(id)!;
$("program").textContent = own.defs.map((d) => renderBlocks(code, pres, info, d)).join("\n\n");
$("wgsl").textContent = shader.wgsl;

const canvas = $("picture") as HTMLCanvasElement;
const status = $("status");
const started = performance.now();
const params = new URLSearchParams(location.search);
// ?time=2 holds the picture still at that time (for screenshots and tests).
const still = params.has("time") ? Number(params.get("time")) : null;
const now = () => still ?? (performance.now() - started) / 1000;

const fragment = `${shader.wgsl}
struct Frame { size: vec2f, time: f32 }
@group(0) @binding(0) var<uniform> frame: Frame;

@vertex
fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  // One triangle that covers the screen.
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fragment(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let s = min(frame.size.x, frame.size.y);
  let x = (2.0 * at.x - frame.size.x) / s;
  let y = (frame.size.y - 2.0 * at.y) / s;
  let c = vec3f(${CHANNELS.map((c) => `${entry(c)}(x, y, frame.time)`).join(", ")});
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
($("fragment") as HTMLElement).textContent = fragment.slice(shader.wgsl.length).trim();

async function gpu(): Promise<string | null> {
  if (!navigator.gpu) return "this browser has no WebGPU";
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return "WebGPU found no GPU adapter";
  const device = await adapter.requestDevice();
  (globalThis as { gpuDevice?: GPUDevice }).gpuDevice = device;
  const module = device.createShaderModule({ code: fragment });
  // Check first: on some drivers reading a buffer back after the canvas has
  // started presenting fails.
  await check(device);
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
  if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
  fit();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vertex" },
    fragment: { module, entryPoint: "fragment", targets: [{ format }] },
  });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  let frames = 0, since = performance.now();
  const draw = () => {
    fit();
    device.queue.writeBuffer(uniform, 0, new Float32Array([canvas.width, canvas.height, now(), 0]));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
    frames++;
    const t = performance.now();
    if (t - since > 1000) {
      status.textContent = `WebGPU · ${canvas.width}×${canvas.height} · ${Math.round((frames * 1000) / (t - since))} frames a second`;
      frames = 0;
      since = t;
    }
    if (still === null) requestAnimationFrame(draw);
  };
  draw();
  status.textContent = `WebGPU · ${canvas.width}×${canvas.height}`;
  return null;
}

// The GPU against the evaluator, at a grid of points and a few times.
async function check(device: GPUDevice) {
  const points: number[][] = [];
  for (const t of [0, 1.5, 4]) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) points.push([-1 + (2 * i + 1) / 6, -1 + (2 * j + 1) / 6, t]);
  const kernel = `${shader.wgsl}
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= ${points.length}u) { return; }
  let x = inp[3u * i];
  let y = inp[3u * i + 1u];
  let t = inp[3u * i + 2u];
${CHANNELS.map((c, k) => `  outp[3u * i + ${k}u] = ${entry(c)}(x, y, t);`).join("\n")}
}`;
  const module = device.createShaderModule({ code: kernel });
  const buffer = (data: Float32Array, usage: number) => {
    const b = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
    new Float32Array(b.getMappedRange()).set(data);
    b.unmap();
    return b;
  };
  const inp = buffer(new Float32Array(points.flat()), GPUBufferUsage.STORAGE);
  const out = buffer(new Float32Array(points.length * 3), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const read = device.createBuffer({ size: points.length * 12, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inp } }, { binding: 1, resource: { buffer: out } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(points.length / 64));
  pass.end();
  enc.copyBufferToBuffer(out, 0, read, 0, points.length * 12);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const got = new Float32Array(read.getMappedRange());
  // The points as f32, so only the computation differs.
  const r = makeRunner(code, info, { print: () => {} });
  const f32 = (x: number) => Math.fround(x);
  let worst = 0;
  points.forEach((p, i) => CHANNELS.forEach((c, k) => {
    const want = first(r.call(r.value(named(c)), ...p.map(f32))) as number;
    worst = Math.max(worst, Math.abs(got[3 * i + k] - want));
  }));
  const el = $("check");
  el.textContent = `Checked against the evaluator: ${points.length} points × 3 channels, largest difference ${worst.toExponential(1)} (the GPU uses 32-bit floats, the evaluator 64-bit).`;
  el.dataset.worst = String(worst);
}

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

// Without WebGPU: the same functions as WebAssembly, on the CPU.
async function cpu(why: string) {
  const w = await instantiate(emitWasm(lowered));
  const size = 160;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const draw = () => {
    const t = now(), t0 = performance.now();
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = (2 * (px + 0.5) - size) / size, y = (size - 2 * (py + 0.5)) / size;
      const o = 4 * (py * size + px);
      CHANNELS.forEach((c, k) => { img.data[o + k] = 255 * Math.min(1, Math.max(0, w[c](x, y, t))); });
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    status.textContent = `No GPU here (${why}), so this is the same program as WebAssembly on the CPU, ${size}×${size}, ${Math.round(performance.now() - t0)} ms a frame`;
    if (still === null) requestAnimationFrame(draw);
  };
  draw();
  $("check").textContent = "";
}

function fit() {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

gpu().then((why) => (why ? cpu(why) : undefined)).then(() => { document.body.dataset.ready = "true"; }, (e) => {
  status.textContent = `Error: ${e.message}`;
  document.body.dataset.ready = "error";
  throw e;
});

