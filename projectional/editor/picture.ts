// A program drawn as a picture: its `colour` of (x, y, time), giving a
// record of three Numbers, or its `red`, `green` and `blue` of (x, y, time),
// each giving one Number (red, green, blue each from 0 to 1). x and y run
// from −1 to 1 across the shorter side of the picture.
//
// The compiler lowers them to the scalar profile with records
// (compiler/src/scalar.ts) and prints WGSL (compiler/src/wgsl.ts); this
// wraps that in a fragment shader that calls them once per pixel and draws
// it with WebGPU. Without WebGPU, the same lowering printed as WebAssembly
// (compiler/src/wasm.ts) draws it on the CPU, smaller; a `colour` that gives
// a record can't go that way yet (WebAssembly takes no records), so the
// evaluator draws it, smaller still.
//
// shaders.html (editor/shaders.ts) and the editor's Run panel both draw
// through here.

import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { emitWgsl } from "../../compiler/src/wgsl.ts";
import { emitWasm, instantiate } from "../../compiler/src/wasm.ts";

// The definitions a picture is made of, by name: colour, or red, green and
// blue. Null when the program has neither.
export function pictureEntries(defs: Id[], names: Names): Record<string, Id> | null {
  const named = (name: string) => defs.find((d) => names[d] === name);
  const colour = named("colour");
  if (colour) return { colour };
  const rgb = ["red", "green", "blue"].map(named);
  return rgb.every(Boolean) ? { red: rgb[0]!, green: rgb[1]!, blue: rgb[2]! } : null;
}

export interface PictureOptions {
  code: Code;
  info: Info;
  names: Names;
  entries: Record<string, Id>;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  // Where to say how the GPU compares with the evaluator; no check without.
  check?: HTMLElement;
  // A fixed time instead of the clock (for screenshots and tests).
  still?: number | null;
}

export interface Picture {
  // The program's WGSL, and the fragment shader around it.
  wgsl: string;
  fragment: string;
  // Settles once the first frame is drawn.
  ready: Promise<void>;
  stop: () => void;
}

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

let device: Promise<GPUDevice | string> | null = null;
async function gpu(): Promise<GPUDevice | string> {
  if (!navigator.gpu) return "this browser has no WebGPU";
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return "WebGPU found no GPU adapter";
  return adapter.requestDevice();
}

// Throws, with the compiler's reason, when the entries can't be drawn.
export async function drawPicture(o: PictureOptions): Promise<Picture> {
  const { code, info, names, entries, canvas, status } = o;
  const keys = Object.keys(entries);
  const started = performance.now();
  const now = () => o.still ?? (performance.now() - started) / 1000;
  let stopped = false;
  const stop = () => { stopped = true; };

  const shader = emitWgsl(lowerScalar(code, info, names, keys.map((k) => entries[k]), { records: true }));
  const fn = (name: string) => {
    const f = shader.funcs.find((f) => f.name === name);
    if (!f) throw new Error(`${name} can't run on the GPU: it ${shader.refused.get(entries[name]) ?? "isn't in the scalar profile"}`);
    return f;
  };
  // For a colour record, a function from it to a vec3f.
  let helper = "", toVec = "";
  if (keys.length === 1) {
    const r = fn("colour").result;
    if (typeof r === "string" || r.fields.length !== 3 || r.fields.some((g) => g.t !== "f64")) throw new Error("colour must give a record of three Numbers");
    const { name, fields } = shader.structs.get(r.key)!;
    toVec = `${name}_rgb`;
    helper = `fn ${toVec}(c: ${name}) -> vec3f { return vec3f(${fields.map((f) => `c.${f}`).join(", ")}); }\n`;
  }
  // The WGSL for the colour at (x, y, t), as a vec3f.
  const rgb = (x: string, y: string, t: string) => keys.length === 3
    ? `vec3f(${keys.map((e) => `${fn(e).wgsl}(${x}, ${y}, ${t})`).join(", ")})`
    : `${toVec}(${fn("colour").wgsl}(${x}, ${y}, ${t}))`;

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
  const picture: Picture = { wgsl: shader.wgsl, fragment: fragment.slice(shader.wgsl.length).trim(), ready: Promise.resolve(), stop };

  const fit = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };
  const r = makeRunner(code, info, { print: () => {} });
  // The evaluator's colour at (x, y, t).
  const evaluate = (x: number, y: number, t: number): number[] => keys.length === 3
    ? keys.map((e) => first(r.call(r.value(entries[e]), x, y, t)) as number)
    : (first(r.call(r.value(entries.colour), x, y, t)) as { fields: number[] }).fields;

  device ??= gpu();
  const d = await device;
  if (typeof d === "string") return { ...picture, ready: cpu(d) };

  // Check first: on some drivers, reading a buffer back after the canvas
  // has started presenting fails.
  if (o.check) await check(d, o.check);
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
    if (stopped) return;
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
    if (o.still == null) requestAnimationFrame(draw);
  };
  draw();
  status.textContent = `WebGPU · ${canvas.width}×${canvas.height}`;
  return picture;

  // The GPU against the evaluator, at a grid of points and a few times.
  async function check(d: GPUDevice, el: HTMLElement) {
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
    el.textContent = `Checked against the evaluator: ${points.length} points × 3 channels, largest difference ${worst.toExponential(1)} (the GPU uses 32-bit floats, the evaluator 64-bit).`;
    el.dataset.worst = String(worst);
  }

  // Without WebGPU: the same functions as WebAssembly on the CPU, or, for
  // a colour record, the evaluator.
  async function cpu(why: string) {
    const plain = lowerScalar(code, info, names, keys.map((k) => entries[k]));
    const wasm = keys.length === 3 && !plain.refused.size ? await instantiate(emitWasm(plain)) : null;
    const size = wasm ? 160 : 64;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const row = (py: number, t: number) => {
      for (let px = 0; px < size; px++) {
        const x = (2 * (px + 0.5) - size) / size, y = (size - 2 * (py + 0.5)) / size;
        const at = 4 * (py * size + px);
        const c = wasm ? keys.map((e) => wasm[e](x, y, t)) : evaluate(x, y, t);
        c.forEach((v, k) => { img.data[at + k] = 255 * Math.min(1, Math.max(0, v)); });
        img.data[at + 3] = 255;
      }
    };
    const draw = async () => {
      if (stopped) return;
      const t = now(), t0 = performance.now();
      if (wasm) for (let py = 0; py < size; py++) row(py, t);
      else {
        // The evaluator is slow for this: one picture, a few rows at a time
        // so the page stays responsive.
        for (let py = 0; py < size && !stopped; py++) {
          row(py, t);
          if (py % 4 === 3) { ctx.putImageData(img, 0, 0); await new Promise((done) => setTimeout(done)); }
        }
      }
      ctx.putImageData(img, 0, 0);
      status.textContent = wasm
        ? `No GPU here (${why}), so this is the same program as WebAssembly on the CPU, ${size}×${size}, ${Math.round(performance.now() - t0)} ms a frame`
        : `No GPU here (${why}), and WebAssembly takes no records yet, so this is one frame drawn by the evaluator on the CPU, ${size}×${size}, in ${(performance.now() - t0) / 1000 < 1 ? `${Math.round(performance.now() - t0)} ms` : `${((performance.now() - t0) / 1000).toFixed(1)} s`}`;
      if (wasm && o.still == null) requestAnimationFrame(draw);
    };
    status.textContent = `No GPU here (${why}); drawing on the CPU…`;
    if (o.check) o.check.textContent = "";
    await draw();
  }
}
