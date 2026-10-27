// A program drawn as a picture: its `colour` of (x, y, time), giving a
// record of three Float64s, or its `red`, `green` and `blue` of (x, y, time),
// each giving one Float64 (red, green, blue each from 0 to 1). x and y run
// from −1 to 1 across the shorter side of the picture.
//
// The compiler lowers them to the scalar profile with records
// (compiler/src/scalar.ts) and prints WGSL (compiler/src/wgsl.ts); this
// wraps that in a fragment shader that calls them once per pixel and draws
// it with WebGPU. Without WebGPU, the same lowering printed as WebAssembly
// (compiler/src/wasm.ts) draws it on the CPU, smaller: a `colour` record is
// a WasmGC struct there, read through the module's own field readers. What
// WebAssembly can't take is printed as JavaScript instead
// (compiler/src/js-scalar.ts).
//
// shaders.html (editor/shaders.ts) and the editor's Run panel both draw
// through here.

import type { Code, Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import type { Info } from "../src/lang/infer.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { withFloat32 } from "../src/lang/float32.ts";
import { represent } from "../src/lang/represent.ts";
import { lowerScalar } from "../../compiler/src/scalar.ts";
import { emitWgsl } from "../../compiler/src/wgsl.ts";
import { emitWasm, instantiate } from "../../compiler/src/wasm.ts";
import { loadJs } from "../../compiler/src/js-scalar.ts";

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
  // Browsers also turn WebGPU off for a while for a page whose shader
  // stalled the GPU, and then this is what the page sees.
  if (!adapter) return "WebGPU found no GPU adapter; a browser also turns WebGPU off for a while for a page that froze the GPU, and restarting the browser brings it back";
  const d = await adapter.requestDevice();
  // A lost device is asked for again by the next picture.
  void d.lost.then(() => { device = null; });
  return d;
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
    if (typeof r === "string" || r.fields.length !== 3 || r.fields.some((g) => g.t !== "f64")) throw new Error("colour must give a record of three Float64s");
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

  // The canvas is drawn at `scale` of its size on screen (times the pixel
  // ratio), and the browser stretches it to fit.
  let scale = 1;
  const fit = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr * scale)), h = Math.max(1, Math.round(r.height * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };
  // The same program in Float32 (src/lang/float32.ts), as compiler/gpu.ts
  // checks it: the evaluator's check and the CPU's picture round as the GPU
  // does. The program as it is when that can't be made.
  const in32 = (() => {
    try {
      const w = withFloat32(code, names);
      const c = represent(w.code, keys.map((k) => entries[k]), w.rep), i = infer(c, w.names);
      return i.errors.length ? null : { code: c, info: i, names: w.names };
    } catch { return null; }
  })();
  const cpuSide = in32 ?? { code, info, names };
  const floats = in32 ? "in 32-bit floats, as the GPU" : "in 64-bit floats";
  const r = makeRunner(cpuSide.code, cpuSide.info, { print: () => {} });
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
  // A frame of a ray marcher is a lot of work for every pixel, and a GPU
  // given frames faster than it finishes them queues them up until the
  // whole browser, which draws with the same GPU, stops responding. So the
  // next frame waits for this one to finish, and the resolution follows
  // how long frames take: lower when slower than about 30 a second, higher
  // again when there's room. It starts small (256 pixels across at most)
  // so the first frame is quick on any GPU. A still is drawn once, whole.
  const r0 = canvas.getBoundingClientRect();
  scale = o.still == null ? Math.min(1, 256 / Math.max(1, Math.max(r0.width, r0.height) * Math.min(2, devicePixelRatio || 1))) : 1;
  // How long frames take, smoothed, since one slow frame can be the page
  // being busy rather than the GPU. Never below 128 pixels across.
  let took = 0;
  const least = Math.min(1, 128 / Math.max(1, Math.max(r0.width, r0.height) * Math.min(2, devicePixelRatio || 1)));
  const adapt = (ms: number) => {
    took = took ? 0.8 * took + 0.2 * ms : ms;
    if (took > 30) { scale = Math.max(least, scale * Math.max(0.5, Math.sqrt(16 / took))); took = 0; }
    else if (took < 10 && scale < 1) { scale = Math.min(1, scale * 1.2); took = 0; }
  };
  let frames = 0, since = performance.now();
  // The GPU can be lost while drawing (a driver reset, say): stop and say so.
  void d.lost.then((info) => {
    if (stopped) return;
    stop();
    status.textContent = `The GPU stopped drawing (${(info.message || info.reason).replace(/\.$/, "")}). Reload the page to draw it again.`;
  });
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
    const sent = performance.now();
    // A frame still not done after a second counts as a very slow one: the
    // next is drawn smaller, and the picture doesn't stop.
    void Promise.race([d.queue.onSubmittedWorkDone(), new Promise((go) => setTimeout(go, 1000))]).then(() => {
      adapt(performance.now() - sent);
      frames++;
      const t = performance.now();
      if (t - since > 1000) {
        status.textContent = `WebGPU · ${canvas.width}×${canvas.height} · ${Math.round((frames * 1000) / (t - since))} frames a second`;
        frames = 0;
        since = t;
      }
      if (o.still == null) requestAnimationFrame(draw);
    });
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
    // The points as f32, so only the computation differs. A picture can be
    // chaotic (the Mandelbrot set's edge): there the GPU's sin and cos, good
    // only to 2^-11, move a point to a different colour. So up to 1 in 20
    // points may differ; a wrong lowering moves far more than that.
    const diffs = points.map((p, i) => Math.max(...evaluate(Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])).map((want, k) => Math.abs(got[3 * i + k] - want)))).sort((a, b) => a - b);
    const apart = diffs.filter((x) => x >= 2e-3).length, skip = Math.min(apart, Math.floor(points.length / 20));
    const worst = diffs[diffs.length - 1 - skip];
    el.textContent = `Checked against the evaluator: ${points.length} points × 3 channels, largest difference ${worst.toExponential(1)}${skip ? ` leaving out ${skip} point${skip > 1 ? "s" : ""} where the picture is chaotic` : ""} (the evaluator ${in32 ? "rounds to 32-bit floats as the GPU does" : "in 64-bit floats, the GPU in 32"}).`;
    el.dataset.worst = String(worst);
  }

  // Without WebGPU: the same functions as WebAssembly on the CPU (a colour
  // record read field by field through the module's readers), or as
  // JavaScript where WebAssembly can't take them. Frame after frame, at a
  // size that keeps a frame near 25 ms.
  // The picture's channels at a point, from WebAssembly: red, green and
  // blue as three exports, or the colour record's fields by its readers
  // (`Colour.red`, or `Colour.red(key)` where two record types share a name).
  async function inWasm(lowered: ReturnType<typeof lowerScalar>): Promise<(x: number, y: number, t: number) => number[]> {
    const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...xs: unknown[]) => unknown>;
    if (keys.length === 3) return (x, y, t) => keys.map((e) => w[e](x, y, t) as number);
    const f = lowered.funcs.find((g) => g.def === entries.colour && g.params.every((p) => p === "f64"));
    const r = f && typeof f.result === "object" && "fields" in f.result ? f.result : null;
    if (!r || !w.colour) throw new Error("no colour record to read");
    const read = r.fields.map((x) => w[`${r.name}.${x.name}(${r.key})`] ?? w[`${r.name}.${x.name}`]);
    if (read.some((g) => !g)) throw new Error("a field without a reader");
    return (x, y, t) => { const c = w.colour(x, y, t); return read.map((g) => g(c) as number); };
  }

  async function cpu(why: string) {
    const lowered = lowerScalar(cpuSide.code, cpuSide.info, cpuSide.names, keys.map((k) => entries[k]), { records: true });
    const out = keys.find((k) => lowered.refused.has(entries[k]));
    if (out) { status.textContent = `No GPU here (${why}), and ${out} can't be drawn on the CPU either: it ${lowered.refused.get(entries[out])}.`; return; }
    const wasm = await inWasm(lowered).catch(() => null);
    const js = wasm ? null : loadJs(lowered);
    const colourAt = (x: number, y: number, t: number): number[] => wasm ? wasm(x, y, t)
      : keys.length === 3 ? keys.map((e) => js!.get(entries[e])!(x, y, t) as number) : js!.get(entries.colour)!(x, y, t) as number[];
    // A canvas the GPU drew on can't be drawn on any other way.
    const ctx = canvas.getContext("2d");
    if (!ctx) { status.textContent = `No GPU now (${why}), and this picture was on the GPU before: reload the page to draw it on the CPU.`; return; }
    // A moving picture is drawn small enough to keep a frame near 25 ms. A
    // still one, or a moving one paused (click it), is then drawn again at
    // the canvas's own size, a slice of rows a frame, over the small one.
    let size = 64;
    const how = wasm ? "WebAssembly" : "JavaScript";
    status.title = `No GPU here (${why}). The same program as ${how}, ${floats}.`;
    const probe = [-0.7, 0, 0.7].flatMap((x) => [-0.7, 0, 0.7].map((y) => [x, y]));
    const moving = o.still == null && probe.some(([x, y]) => String(colourAt(x, y, 0.3)) !== String(colourAt(x, y, 1.9)));
    let paused: number | null = null;
    const sharp = () => Math.min(512, Math.round((canvas.clientWidth || 256) * Math.min(2, devicePixelRatio || 1)));
    const pixel = (img: ImageData, n: number, px: number, py: number, t: number) => {
      const x = (2 * (px + 0.5) - n) / n, y = (n - 2 * (py + 0.5)) / n, at = 4 * (py * n + px);
      colourAt(x, y, t).forEach((v, k) => { img.data[at + k] = 255 * Math.min(1, Math.max(0, v)); });
      img.data[at + 3] = 255;
    };
    const say = (what: string) => { status.textContent = `Drawn as ${how} on the CPU (no GPU here), ${what}`; };
    const draw = () => {
      if (stopped || paused !== null) return;
      const t = now(), t0 = performance.now();
      if (canvas.width !== size) canvas.width = canvas.height = size;
      const img = ctx.createImageData(size, size);
      for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) pixel(img, size, px, py, t);
      ctx.putImageData(img, 0, 0);
      const ms = performance.now() - t0;
      if (ms > 40) size = Math.max(32, Math.round(size * 0.8));
      else if (ms < 15) size = Math.min(256, Math.round(size * 1.15));
      if (moving) { say(`${canvas.width}×${canvas.width}, ${Math.round(ms)} ms a frame. Click it to pause and sharpen.`); requestAnimationFrame(draw); }
      else refine(t);
    };
    // Sharper, without blanking: the small picture scaled up first.
    const refine = (t: number) => {
      const n = sharp();
      if (n <= canvas.width) { say(`${canvas.width}×${canvas.width}.`); return; }
      const old = document.createElement("canvas");
      old.width = old.height = canvas.width;
      old.getContext("2d")!.drawImage(canvas, 0, 0);
      canvas.width = canvas.height = n;
      ctx.drawImage(old, 0, 0, n, n);
      const img = ctx.createImageData(n, n);
      let row = 0;
      const slice = () => {
        if (stopped || (moving && paused === null)) return;
        const t0 = performance.now(), from = row;
        while (row < n && performance.now() - t0 < 25) { for (let px = 0; px < n; px++) pixel(img, n, px, row, t); row++; }
        ctx.putImageData(img, 0, 0, 0, from, n, row - from);
        say(row < n ? `sharpening: ${Math.round((100 * row) / n)}%` : `${n}×${n}.${moving ? " Paused: click it to play." : ""}`);
        if (row < n) requestAnimationFrame(slice);
      };
      slice();
    };
    canvas.onclick = moving ? () => {
      if (stopped) return;
      if (paused === null) { paused = now(); refine(paused); }
      else { paused = null; draw(); }
    } : null;
    canvas.style.cursor = moving ? "pointer" : "";
    say("…");
    if (o.check) o.check.textContent = "";
    draw();
  }
}
