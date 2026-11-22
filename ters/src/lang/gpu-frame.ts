// A frame drawn with WebGPU (BACKLOG G9c/G9d, docs/design/targets/FRAMES.md):
// the runtime's side. The compiler prints each `draw` call's vertex and
// fragment functions as one WGSL module, its site; a compiled draw carries
// its site and the values its functions captured. Here each site is a
// pipeline made once, each mesh two buffers made once, and each draw's
// instances and captures are written to buffers only when they changed:
// the same list as the last frame's at that place in the frame sends
// nothing.
//
// What a site is and how its data is laid out is the Compiler lane's
// contract (FRAMES.md, "What a compiled page hands the runtime"): one
// module with entries lab_vs and lab_fs; in group 0, binding 0 a uniform
// array<vec4u, N> of the captures' leaves, binding 1 a storage array<u32>
// of the instances' leaves, binding 2 of the corners'; each leaf one
// 4-byte word (f32, i32, or a Bool as 1 or 0), found by its path of field
// indices; drawIndexed by the mesh's triangles and the instances' count.

import type { Data, Value } from "./run.ts";
import { fromList } from "./run.ts";
import { FRAME_V, TRUE } from "./std-ids.ts";
import { cssColour } from "./raster.ts";

export type Word = "f32" | "i32" | "bool";
export interface Leaf { path: number[]; kind: Word }
export interface Site {
  wgsl: string;
  // The leaves of each capture, of one instance, of one corner.
  caps: Leaf[][];
  instance: Leaf[];
  corner: Leaf[];
  colour: 3 | 4;
}
// A compiled draw's site (its fields after the four: the site's key in
// the page's table, and the captured values).
export interface Sited { site: Site; caps: Value[] }

// The page's sites, by key (R.pageDraws).
const SITES: Record<string, Site> = {};
// A site's packing, printed by the compiler for its leaves (G8,
// gpu-draws.ts packsOf): item i's leaves written at i × leaves.length,
// as put writes them, without walking each leaf's path. A site without
// one (written by hand) is put's.
export type Pack = (items: Value[], f: Float32Array, n: Int32Array) => void;
export interface Packs { instance?: Pack; corner?: Pack }
const PACKS = new WeakMap<Site, Packs>();
export const pageDraws = (sites: Record<string, Site>, packs: Record<string, Packs> = {}) => {
  Object.assign(SITES, sites);
  for (const [k, p] of Object.entries(packs)) if (sites[k]) PACKS.set(sites[k], p);
};
export const sitedOf = (d: Data): Sited | null => {
  const key = d.fields[4], site = key === undefined ? undefined : SITES[String(key)];
  return site ? { site, caps: (d.fields[5] as unknown as Value[]) ?? [] } : null;
};

const part = (o: Value, i: number): Value => ((o as unknown as Record<string, Value>)[`f${i}`] ?? (o as Data).fields[i]);
const items = (v: Value): Value[] => (Array.isArray(v) ? v : fromList(v));
// Leaves written as words at `at` in a buffer seen as f32s and as i32s.
function put(v: Value, leaves: Leaf[], f: Float32Array, n: Int32Array, at: number): void {
  leaves.forEach((l, k) => {
    let x: Value = v;
    for (const i of l.path) x = part(x, i);
    if (l.kind === "f32") f[at + k] = Number(x);
    else if (l.kind === "i32") n[at + k] = Number(x);
    else n[at + k] = x === (true as unknown as Value) || (x as Data)?.tag === TRUE ? 1 : 0;
  });
}
const words = (count: number) => { const b = new ArrayBuffer(Math.max(16, Math.ceil(count / 4) * 16)); return { b, f: new Float32Array(b), n: new Int32Array(b) }; };

interface Slot { list: Value | null; items: GPUBuffer | null; caps: GPUBuffer | null; capsWere: string; group: GPUBindGroup | null; groupFor: [GPUBuffer | null, GPUBuffer | null, GPUBuffer | null] }

// What a frame drew: draw calls made and bytes sent, for tests and the round.
export interface Drawn { draws: number; bytes: number }

export class GpuFrames {
  private pipelines = new Map<string, GPURenderPipeline>();
  private meshes = new WeakMap<object, { corners: GPUBuffer; triangles: GPUBuffer; count: number }>();
  private slots = new Map<string, Slot>();
  private depthTex: GPUTexture | null = null;
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: { width: number; height: number };
  private constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, canvas: { width: number; height: number }) {
    this.device = device; this.context = context; this.format = format; this.canvas = canvas;
  }

  // The canvas's WebGPU context, or null where there is no WebGPU (then
  // the page draws with raster.ts, and the canvas keeps its 2D context).
  static async open(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<GpuFrames | null> {
    const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    // A shader or pipeline the device refused says why on the console.
    device.addEventListener("uncapturederror", (e) => console.error(`WebGPU: ${(e as GPUUncapturedErrorEvent).error.message}`));
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) return null;
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    return new GpuFrames(device, context, format, canvas);
  }

  private pipeline(site: Site, depth: boolean): GPURenderPipeline {
    const key = `${depth}\u0000${site.wgsl}`;
    let p = this.pipelines.get(key);
    if (p) return p;
    const module = this.device.createShaderModule({ code: site.wgsl });
    p = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "lab_vs" },
      fragment: { module, entryPoint: "lab_fs", targets: [{ format: this.format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
      primitive: { topology: "triangle-list" },
      ...(depth ? { depthStencil: { format: "depth24plus" as GPUTextureFormat, depthWriteEnabled: true, depthCompare: "less" as GPUCompareFunction } } : {}),
    });
    this.pipelines.set(key, p);
    return p;
  }

  private buffer(data: ArrayBuffer | Uint32Array, usage: number): GPUBuffer {
    const b = this.device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: usage | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, data);
    return b;
  }

  private mesh(m: Value, site: Site) {
    let got = this.meshes.get(m as object);
    if (got) return got;
    const cs = items(part(m, 0)), ts = items(part(m, 1)).map(Number);
    const w = words(cs.length * site.corner.length);
    const pack = PACKS.get(site)?.corner;
    if (pack) pack(cs, w.f, w.n); else cs.forEach((c, i) => put(c, site.corner, w.f, w.n, i * site.corner.length));
    got = { corners: this.buffer(w.b, GPUBufferUsage.STORAGE), triangles: this.buffer(new Uint32Array(ts), GPUBufferUsage.INDEX), count: ts.length };
    this.meshes.set(m as object, got);
    return got;
  }

  // Draws the frame. False, drawing nothing, when a draw has no site (it
  // was made where the compiler didn't print one): the page draws it with
  // raster.ts instead.
  draw(frame: Value, siteOf: (d: Data) => Sited | null): Drawn | false {
    const passes = items(part(frame, 0));
    const sited = passes.map((p) => items(part(p, 3)).map((d) => siteOf(d as Data)));
    if (sited.some((ds) => ds.some((s) => !s))) return false;
    const drawn: Drawn = { draws: 0, bytes: 0 };
    const enc = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    passes.forEach((pass, pi) => {
      if ((part(pass, 0) as Data).tag !== FRAME_V.screen) return;
      const depth = (part(pass, 2) as Data).tag === TRUE || (part(pass, 2) as unknown) === true;
      const [r, g, b, a] = cssColour(String(part(pass, 1)));
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view, clearValue: { r, g, b, a }, loadOp: "clear", storeOp: "store" }],
        ...(depth ? { depthStencilAttachment: { view: this.depth().createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } } : {}),
      });
      items(part(pass, 3)).forEach((d, di) => {
        const { site, caps } = sited[pi][di]!;
        const list = (d as Data).fields[1];
        const mesh = this.mesh((d as Data).fields[0], site);
        const slot = this.slot(`${pi}.${di}`);
        // Instances: sent again only when the list isn't the last frame's.
        const n = items(list).length;
        if (slot.list !== list || !slot.items) {
          const per = site.instance.length, w = words(n * per);
          const pack = PACKS.get(site)?.instance;
          if (pack) pack(items(list), w.f, w.n); else items(list).forEach((it, i) => put(it, site.instance, w.f, w.n, i * per));
          if (slot.items && slot.items.size >= w.b.byteLength) this.device.queue.writeBuffer(slot.items, 0, w.b);
          else { slot.items?.destroy(); slot.items = this.buffer(w.b, GPUBufferUsage.STORAGE); }
          slot.list = list;
          drawn.bytes += w.b.byteLength;
        }
        // Captures: the leaves of each in order, four words to a vec4u.
        const u = words(site.caps.reduce((t, ls) => t + ls.length, 0));
        let at = 0;
        site.caps.forEach((ls, i) => { put(caps[i], ls, u.f, u.n, at); at += ls.length; });
        const said = Array.from(u.n).join(",");
        if (said !== slot.capsWere || !slot.caps) {
          if (slot.caps && slot.caps.size >= u.b.byteLength) this.device.queue.writeBuffer(slot.caps, 0, u.b);
          else { slot.caps?.destroy(); slot.caps = this.buffer(u.b, GPUBufferUsage.UNIFORM); }
          slot.capsWere = said;
          drawn.bytes += u.b.byteLength;
        }
        const pipeline = this.pipeline(site, depth);
        const want: Slot["groupFor"] = [slot.caps, slot.items, mesh.corners];
        if (!slot.group || want.some((x, i) => x !== slot.groupFor[i])) {
          slot.group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: want.map((buffer, binding) => ({ binding, resource: { buffer: buffer! } })) });
          slot.groupFor = want;
        }
        rp.setPipeline(pipeline);
        rp.setBindGroup(0, slot.group);
        rp.setIndexBuffer(mesh.triangles, "uint32");
        if (n) rp.drawIndexed(mesh.count, n);
        drawn.draws++;
      });
      rp.end();
    });
    this.device.queue.submit([enc.finish()]);
    return drawn;
  }

  private slot(at: string): Slot {
    let s = this.slots.get(at);
    if (!s) this.slots.set(at, (s = { list: null, items: null, caps: null, capsWere: "", group: null, groupFor: [null, null, null] }));
    return s;
  }

  private depth(): GPUTexture {
    const { width, height } = this.canvas;
    if (this.depthTex && this.depthTex.width === width && this.depthTex.height === height) return this.depthTex;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    return this.depthTex;
  }
}
