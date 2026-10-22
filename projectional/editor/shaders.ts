// shaders.html: programs in the language, compiled to WGSL and drawn by the
// GPU with WebGPU, each next to its code and the WGSL it became.
//
// A shader here is a definition `colour` of (x, y, time) giving a record of
// three Numbers (red, green, blue, each from 0 to 1), or three definitions
// `red`, `green` and `blue` of (x, y, time) giving one Number each. x and y
// run from −1 to 1 across the shorter side of the picture. The compiler
// lowers them to the scalar profile with records (compiler/src/scalar.ts)
// and prints WGSL (compiler/src/wgsl.ts); the page wraps that in a fragment
// shader that calls them once per pixel.
//
// To show the GPU computes what the language means, a compute shader runs
// the same functions at sample points and the page compares them with the
// evaluator. Without WebGPU, the picture is drawn on the CPU from the same
// lowering printed as WebAssembly (compiler/src/wasm.ts), smaller; a
// `colour` that gives a record can't go that way yet (WebAssembly takes no
// records), so it's drawn by the evaluator itself, smaller still.

import type { Code, Id } from "../src/model.ts";
import type { Names, Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import ripplesCode from "../examples/shaders/code.json" with { type: "json" };
import ripplesNames from "../examples/shaders/names.default.json" with { type: "json" };
import ripplesComments from "../examples/shaders/comments.json" with { type: "json" };
import marchCode from "../examples/raymarch/code.json" with { type: "json" };
import marchNames from "../examples/raymarch/names.default.json" with { type: "json" };
import marchComments from "../examples/raymarch/comments.json" with { type: "json" };
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { merge } from "../src/model.ts";
import { layer } from "../src/presentation.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { emitWgsl } from "../../compiler/src/wgsl.ts";
import { emitWasm, instantiate } from "../../compiler/src/wasm.ts";

interface Program { code: unknown; names: unknown; comments: unknown }

const params = new URLSearchParams(location.search);
// ?time=2 holds the pictures still at that time (for screenshots and tests).
const still = params.has("time") ? Number(params.get("time")) : null;
const started = performance.now();
const now = () => still ?? (performance.now() - started) / 1000;
const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

let device: Promise<GPUDevice | string> | null = null;
async function gpu(): Promise<GPUDevice | string> {
  if (!navigator.gpu) return "this browser has no WebGPU";
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return "WebGPU found no GPU adapter";
  return adapter.requestDevice();
}

async function show(where: string, p: Program) {
  const box = document.getElementById(where)!;
  const $ = (c: string) => box.querySelector(`.${c}`) as HTMLElement;
  const own = p.code as Code;
  const code = merge(LIBRARY.code, own), names = layer<Names>(LIBRARY.names, p.names as Names);
  const info = infer(code, names, undefined, { pins: LIBRARY.pins, hidden: LIBRARY.hidden });
  if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("\n"));
  const pres: Presentation = { names, comments: p.comments as Record<Id, string>, hints: {}, style: blocksStyle as Style };
  const named = (name: string) => own.defs.find((d) => names[d] === name);
  // Either colour, or red, green and blue.
  const entries = named("colour") ? ["colour"] : ["red", "green", "blue"];

  const shader = emitWgsl(lowerScalar(code, info, names, entries.map((e) => named(e)!), { records: true }));
  const fn = (name: string) => {
    const f = shader.funcs.find((f) => f.name === name);
    if (!f) throw new Error(`${name} can't run on the GPU: it ${shader.refused.get(named(name)!) ?? "isn't in the scalar profile"}`);
    return f;
  };
  // For a colour record, a function from it to a vec3f.
  let helper = "", toVec = "";
  if (entries.length === 1) {
    const r = fn("colour").result;
    if (typeof r === "string" || r.fields.length !== 3 || r.fields.some((g) => g.t !== "f64")) throw new Error("colour must give a record of three Numbers");
    const { name, fields } = shader.structs.get(r.key)!;
    toVec = `${name}_rgb`;
    helper = `fn ${toVec}(c: ${name}) -> vec3f { return vec3f(${fields.map((f) => `c.${f}`).join(", ")}); }\n`;
  }
  // The WGSL for the colour at (x, y, t), as a vec3f.
  const rgb = (x: string, y: string, t: string) => entries.length === 3
    ? `vec3f(${entries.map((e) => `${fn(e).wgsl}(${x}, ${y}, ${t})`).join(", ")})`
    : `${toVec}(${fn("colour").wgsl}(${x}, ${y}, ${t}))`;

  $("program").textContent = own.defs.map((d) => renderBlocks(code, pres, info, d)).join("\n\n");
  $("wgsl").textContent = shader.wgsl;

  const fragment = `${shader.wgsl}
${helper}struct Frame { size: vec2f, time: f32 }
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
  return vec4f(clamp(${rgb("x", "y", "frame.time")}, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
  $("fragment").textContent = fragment.slice(shader.wgsl.length).trim();

  const canvas = $("picture") as HTMLCanvasElement;
  const status = $("status");
  const fit = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };
  const r = makeRunner(code, info, { print: () => {} });
  // The evaluator's colour at (x, y, t).
  const evaluate = (x: number, y: number, t: number): number[] => entries.length === 3
    ? entries.map((e) => first(r.call(r.value(named(e)!), x, y, t)) as number)
    : (first(r.call(r.value(named("colour")!), x, y, t)) as { fields: number[] }).fields;

  device ??= gpu();
  const d = await device;
  if (typeof d === "string") return cpu(d);

  // Check first: on some drivers, reading a buffer back after the canvas
  // has started presenting fails.
  await check(d);
  const module = d.createShaderModule({ code: fragment });
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
  if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
  fit();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: d, format, alphaMode: "opaque" });
  const pipeline = d.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vertex" },
    fragment: { module, entryPoint: "fragment", targets: [{ format }] },
  });
  const uniform = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const group = d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  let frames = 0, since = performance.now();
  const draw = () => {
    fit();
    d.queue.writeBuffer(uniform, 0, new Float32Array([canvas.width, canvas.height, now(), 0]));
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    d.queue.submit([enc.finish()]);
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

  // The GPU against the evaluator, at a grid of points and a few times.
  async function check(d: GPUDevice) {
    const points: number[][] = [];
    for (const t of [0, 1.5, 4]) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) points.push([-1 + (2 * i + 1) / 6, -1 + (2 * j + 1) / 6, t]);
    const kernel = `${shader.wgsl}
${helper}@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= ${points.length}u) { return; }
  let c = ${rgb("inp[3u * i]", "inp[3u * i + 1u]", "inp[3u * i + 2u]")};
  outp[3u * i] = c.x;
  outp[3u * i + 1u] = c.y;
  outp[3u * i + 2u] = c.z;
}`;
    const module = d.createShaderModule({ code: kernel });
    const buffer = (data: Float32Array, usage: number) => {
      const b = d.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
      new Float32Array(b.getMappedRange()).set(data);
      b.unmap();
      return b;
    };
    const inp = buffer(new Float32Array(points.flat()), GPUBufferUsage.STORAGE);
    const out = buffer(new Float32Array(points.length * 3), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const read = d.createBuffer({ size: points.length * 12, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const pipeline = d.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const group = d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inp } }, { binding: 1, resource: { buffer: out } }] });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(points.length / 64));
    pass.end();
    enc.copyBufferToBuffer(out, 0, read, 0, points.length * 12);
    d.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const got = new Float32Array(read.getMappedRange());
    // The points as f32, so only the computation differs.
    let worst = 0;
    points.forEach((p, i) => evaluate(Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])).forEach((want, k) => {
      worst = Math.max(worst, Math.abs(got[3 * i + k] - want));
    }));
    const el = $("check");
    el.textContent = `Checked against the evaluator: ${points.length} points × 3 channels, largest difference ${worst.toExponential(1)} (the GPU uses 32-bit floats, the evaluator 64-bit).`;
    el.dataset.worst = String(worst);
  }

  // Without WebGPU: the same functions as WebAssembly on the CPU, or, for
  // a colour record, the evaluator.
  async function cpu(why: string) {
    const plain = lowerScalar(code, info, names, entries.map((e) => named(e)!));
    const wasm = entries.length === 3 && !plain.refused.size ? await instantiate(emitWasm(plain)) : null;
    const size = wasm ? 160 : 64;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const row = (py: number, t: number) => {
      for (let px = 0; px < size; px++) {
        const x = (2 * (px + 0.5) - size) / size, y = (size - 2 * (py + 0.5)) / size;
        const o = 4 * (py * size + px);
        const c = wasm ? entries.map((e) => wasm[e](x, y, t)) : evaluate(x, y, t);
        c.forEach((v, k) => { img.data[o + k] = 255 * Math.min(1, Math.max(0, v)); });
        img.data[o + 3] = 255;
      }
    };
    const draw = async () => {
      const t = now(), t0 = performance.now();
      if (wasm) for (let py = 0; py < size; py++) row(py, t);
      else {
        // The evaluator is slow for this: one picture, a few rows at a time
        // so the page stays responsive.
        for (let py = 0; py < size; py++) {
          row(py, t);
          if (py % 4 === 3) { ctx.putImageData(img, 0, 0); await new Promise((done) => setTimeout(done)); }
        }
      }
      ctx.putImageData(img, 0, 0);
      status.textContent = wasm
        ? `No GPU here (${why}), so this is the same program as WebAssembly on the CPU, ${size}×${size}, ${Math.round(performance.now() - t0)} ms a frame`
        : `No GPU here (${why}), and WebAssembly takes no records yet, so this is one frame drawn by the evaluator on the CPU, ${size}×${size}, in ${(performance.now() - t0) / 1000 < 1 ? `${Math.round(performance.now() - t0)} ms` : `${((performance.now() - t0) / 1000).toFixed(1)} s`}`;
      if (wasm && still === null) requestAnimationFrame(draw);
    };
    status.textContent = `No GPU here (${why}); drawing on the CPU…`;
    await draw();
    $("check").textContent = "";
  }
}

Promise.all([
  show("ripples", { code: ripplesCode, names: ripplesNames, comments: ripplesComments }),
  show("raymarch", { code: marchCode, names: marchNames, comments: marchComments }),
]).then(() => { document.body.dataset.ready = "true"; }, (e) => {
  for (const s of document.querySelectorAll(".status")) if (s.textContent === "Starting…") s.textContent = `Error: ${e.message}`;
  document.body.dataset.ready = "error";
  throw e;
});
