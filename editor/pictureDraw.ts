// Drawing a picture that is already compiled: its fragment shader on the GPU
// with WebGPU, or, without, its WebAssembly (or JavaScript) on the CPU; and
// the check of the GPU against the evaluator's answers at fixed points.
//
// editor/picture.ts compiles a program into a Drawable in the page, for the
// editor, where the program changes. shaders.html shows fixed programs, so
// editor/build.ts compiles them when the site is built (picture.ts
// buildPicture) and the page only draws them: nothing is checked or
// compiled in the browser.

// Only types from the compiler: the page that draws pictures built ahead
// carries no compiler and no library (they are megabytes).
import type { Module } from "../compiler/src/wasm.ts";

// A picture's module, started as compiler/src/wasm.ts instantiate does for
// one: Math from the host. A picture talks to no world (it has no effects),
// so any world import refuses; a stop or a Float64 past finite handed back
// ends the frame with an error, as there.
async function instantiate(m: { bytes: Uint8Array; floats?: Module["floats"] }): Promise<Record<string, (...xs: unknown[]) => unknown>> {
  const world = new Proxy({}, { get: (_, k) => () => { throw new Error(`a picture can't ${String(k)}`); } });
  const { instance } = await WebAssembly.instantiate(m.bytes, { Math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: Math.atan2, stop: () => { throw new Error("the picture stopped"); } }, world });
  const ex = instance.exports as unknown as Record<string, (...xs: unknown[]) => unknown>;
  if (!m.floats?.length) return ex;
  const out: Record<string, (...xs: unknown[]) => unknown> = { ...ex };
  const fin = (x: number) => { if (x - x !== 0) throw new Error("a Float64 too big"); return x; };
  for (const { name, partial } of m.floats) {
    const f = ex[name];
    out[name] = partial ? (...xs) => { const r = f(...xs) as [number, number]; if (r[1] === 0) fin(r[0]); return r; } : (...xs) => fin(f(...xs) as number);
  }
  return out;
}

export interface Picture {
  // The program's WGSL, and the fragment shader around it.
  wgsl: string;
  fragment: string;
  // Settles once the first frame is drawn and, with a check, the
  // evaluator has been compared with the GPU.
  ready: Promise<void>;
  stop: () => void;
}

// Back to the browser between the long steps, so that no single task holds
// the page for long enough that the browser offers to kill it.
export const pause = () => new Promise<void>((go) => setTimeout(go, 0));

// Where the GPU is checked against the evaluator: a grid of points at a
// few times.
export const POINTS: number[][] = [];
for (const t of [0, 1.5, 4]) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) POINTS.push([-1 + (2 * i + 1) / 6, -1 + (2 * j + 1) / 6, t]);
// The order the points are checked in, spread over the picture and the
// times (41 is prime to 108), so that the ones checked within a budget, a
// few seconds of the evaluator, stand for all of them.
export const checkOrder = (n: number) => (n * 41) % POINTS.length;

// The picture on the CPU, as data that can be built ahead: WebAssembly
// (red, green and blue as three exports, or the colour record's fields by
// its readers), JavaScript where WebAssembly can't take it, or why neither
// can.
// can. Both, when there's WebAssembly: a browser may not run it (WasmGC).
export type CpuProgram =
  | { wasm?: { bytes: string; floats?: Module["floats"]; rgb?: string[]; colour?: string; reads?: string[] }; js: { source: string; rgb: string[] } }
  | { refused: string };

// A compiled picture. `want` gives the evaluator's colour at POINTS[i]:
// worked out when asked, or read from answers built ahead (null for a
// point the build left out).
export interface Drawable {
  wgsl: string;
  fragment: string;
  kernel: string;
  want: (i: number) => number[] | null;
  in32: boolean;
  cpu: () => CpuProgram;
}

// A Drawable whose every part was built ahead, as JSON.
export interface Built {
  wgsl: string;
  fragment: string;
  kernel: string;
  want: (number[] | null)[];
  in32: boolean;
  cpu: CpuProgram;
}
export const drawableOf = (b: Built): Drawable => ({ ...b, want: (i) => b.want[i], cpu: () => b.cpu });

const toBase64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const wasmBytes = toBase64;

async function inWasm(p: CpuProgram): Promise<((x: number, y: number, t: number) => number[]) | null> {
  if ("wasm" in p && p.wasm) {
    const w = await instantiate({ bytes: fromBase64(p.wasm.bytes), floats: p.wasm.floats });
    if (p.wasm.rgb) { const fs = p.wasm.rgb.map((e) => w[e]); return (x, y, t) => fs.map((f) => f(x, y, t) as number); }
    const colour = w[p.wasm.colour!], read = p.wasm.reads!.map((r) => w[r]);
    return (x, y, t) => { const c = colour(x, y, t); return read.map((g) => g(c) as number); };
  }
  return null;
}
function inJs(p: CpuProgram): ((x: number, y: number, t: number) => number[]) | null {
  if ("js" in p) {
    const all = new Function(p.js.source)() as Record<string, (...xs: number[]) => unknown>;
    if (p.js.rgb.length === 3) { const fs = p.js.rgb.map((n) => all[n]); return (x, y, t) => fs.map((f) => f(x, y, t) as number); }
    const f = all[p.js.rgb[0]];
    return (x, y, t) => f(x, y, t) as number[];
  }
  return null;
}

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

export interface DrawOptions {
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  // Where to say how the GPU compares with the evaluator; no check without.
  check?: HTMLElement;
  // A fixed time instead of the clock (for screenshots and tests).
  still?: number | null;
}

export async function drawDrawable(p: Drawable, o: DrawOptions): Promise<Picture> {
  const { canvas, status } = o;
  const started = performance.now();
  const now = () => o.still ?? (performance.now() - started) / 1000;
  let stopped = false;
  const stop = () => { stopped = true; };
  const floats = p.in32 ? "in 32-bit floats, as the GPU" : "in 64-bit floats";
  const picture: Picture = { wgsl: p.wgsl, fragment: p.fragment.slice(p.wgsl.length).trim(), ready: Promise.resolve(), stop };

  // The canvas is drawn at `scale` of its size on screen (times the pixel
  // ratio), and the browser stretches it to fit.
  let scale = 1;
  const fit = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr * scale)), h = Math.max(1, Math.round(r.height * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };

  device ??= gpu();
  const d = await device;
  if (typeof d === "string") return { ...picture, ready: cpu(d) };

  // The GPU's side of the check first: on some drivers, reading a buffer
  // back after the canvas has started presenting fails. The evaluator's
  // side runs after the first frame, a little at a time: worked out in the
  // page it takes seconds (a minute for the ray marcher on a slow machine),
  // and the page stayed blank and frozen all that time.
  const compare = o.check ? await check(d, o.check) : null;
  const module = d.createShaderModule({ code: p.fragment });
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
  return compare ? { ...picture, ready: compare() } : picture;

  // The GPU against the evaluator at POINTS: the GPU's answers now, and a
  // function that compares the evaluator's with them, yielding to the page
  // every few milliseconds.
  async function check(d: GPUDevice, el: HTMLElement): Promise<() => Promise<void>> {
    const points = POINTS;
    const module = d.createShaderModule({ code: p.kernel });
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
    const got = new Float32Array(read.getMappedRange()).slice();
    read.unmap();
    return () => compareWith(el, got);
  }

  async function compareWith(el: HTMLElement, got: Float32Array) {
    const points = POINTS;
    el.textContent = "Checking against the evaluator…";
    // The points in checkOrder, within a budget of a few seconds of the
    // evaluator. (The GPU's sin and cos are good only to 2^-11, so a chaotic picture,
    // the Mandelbrot set's edge, can move a point to a different colour:
    // up to 1 in 20 points may differ; a wrong lowering moves far more.)
    const diffs: number[] = [];
    const start = performance.now();
    let since = start;
    for (let n = 0; n < points.length; n++) {
      const i = checkOrder(n), want = p.want(i);
      if (!want) break;
      diffs.push(Math.max(...want.map((w, k) => Math.abs(got[3 * i + k] - w))));
      if (performance.now() - since > 20) {
        if (performance.now() - start > 5000 && diffs.length >= 12) break;
        el.textContent = `Checking against the evaluator… ${n + 1} of ${points.length} points`;
        await pause();
        if (stopped) return;
        since = performance.now();
      }
    }
    diffs.sort((a, b) => a - b);
    const apart = diffs.filter((x) => x >= 2e-3).length, skip = Math.min(apart, Math.floor(diffs.length / 20));
    const worst = diffs[diffs.length - 1 - skip];
    const many = diffs.length === points.length ? `${points.length} points` : `${diffs.length} of ${points.length} points (the evaluator is slow here; the rest would take too long)`;
    el.textContent = `Checked against the evaluator: ${many} × 3 channels, largest difference ${worst.toExponential(1)}${skip ? ` leaving out ${skip} point${skip > 1 ? "s" : ""} where the picture is chaotic` : ""} (the evaluator ${p.in32 ? "rounds to 32-bit floats as the GPU does" : "in 64-bit floats, the GPU in 32"}).`;
    el.dataset.worst = String(worst);
  }

  // Without WebGPU: the same functions as WebAssembly on the CPU, or as
  // JavaScript where WebAssembly can't take them. Frame after frame, at a
  // size that keeps a frame near 25 ms.
  async function cpu(why: string) {
    const program = p.cpu();
    if ("refused" in program) { status.textContent = `No GPU here (${why}), and ${program.refused}.`; return; }
    const wasm = await inWasm(program).catch(() => null);
    const colourAt = wasm ?? inJs(program)!;
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
    // A frame is drawn a few rows at a time, at most ~10 ms at once, and a
    // slow one leaves the page as much time again before the next, so a
    // picture that costs 150 ms a frame doesn't hold the page (E194).
    let frame = 0;
    const draw = () => {
      if (stopped || paused !== null) return;
      const t = now(), n = size, mine = ++frame;
      const img = ctx.createImageData(n, n);
      let row = 0, busy = 0;
      const rows = () => {
        if (stopped || paused !== null || mine !== frame) return;
        const t0 = performance.now();
        while (row < n && performance.now() - t0 < 10) { for (let px = 0; px < n; px++) pixel(img, n, px, row, t); row++; }
        busy += performance.now() - t0;
        if (row < n) { setTimeout(rows, 0); return; }
        if (canvas.width !== n) canvas.width = canvas.height = n;
        ctx.putImageData(img, 0, 0);
        if (busy > 40) size = Math.max(32, Math.round(size * 0.8));
        else if (busy < 15) size = Math.min(256, Math.round(size * 1.15));
        if (!moving) return refine(t);
        say(`${n}×${n}, ${Math.round(busy)} ms a frame. Click it to pause and sharpen.`);
        if (busy > 40) setTimeout(() => requestAnimationFrame(draw), busy);
        else requestAnimationFrame(draw);
      };
      rows();
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
