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

import { fromList, type Data, type Value } from "./run-values.ts";
import { FRAME_V, TRUE } from "./std-ids.ts";
import { copied, cssColour } from "./raster.ts";
import { pageDevice } from "./gpu-device.ts";

export type Word = "f32" | "i32" | "bool";
export interface Leaf { path: number[]; kind: Word }
export interface Site {
  wgsl: string;
  // The leaves of each capture, of one instance, of one corner.
  caps: Leaf[][];
  instance: Leaf[];
  corner: Leaf[];
  colour: 3 | 4;
  // The captures that are textures the fragment samples (G10): indices
  // into caps, in binding order (binding 4 + k), with no words of their
  // own. Binding 3 is a linear sampler kept to the edges.
  textures?: number[];
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
// A list's items: a JavaScript array as it is, a list over one
// (bytes.ts ItemsList) or an array value (array-view.ts ArrayView) copied
// out of its buffer at once, any other list walked. Told apart by shape,
// so a page's drawing imports neither (I380: walking an array-held list
// as cells made a cell an item, twice a draw).
const items = (v: Value): Value[] => {
  if (Array.isArray(v)) return v;
  const o = v as unknown as { items?: () => Value[]; b?: unknown; i?: number; buf?: { items: Value[] }; start?: number; n?: number };
  // An ItemsList never changes its array, so the whole of one is read as it is.
  if (typeof o.items === "function") return o.i === 0 && Array.isArray(o.b) ? (o.b as Value[]) : o.items();
  if (o.buf && typeof o.n === "number") return o.buf.items.slice(o.start!, o.start! + o.n);
  return fromList(v);
};
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
// The same items, one by one: a list the program didn't change, though
// compiled code hands each draw a list of its own over the array it keeps
// (array.items copies), so its object is new every frame.
const sameItems = (a: Value[] | null, b: Value[]) => a !== null && a.length === b.length && a.every((x, i) => x === b[i]);
const words = (count: number) => { const b = new ArrayBuffer(Math.max(16, Math.ceil(count / 4) * 16)); return { b, f: new Float32Array(b), n: new Int32Array(b) }; };

interface Slot { list: Value[] | null; items: GPUBuffer | null; caps: GPUBuffer | null; capsWere: string; group: GPUBindGroup | null; groupFor: unknown[] }
// What a pass draws into: the canvas, or a texture of its own (G10),
// stored as rgba8unorm as raster.ts stores one, from 0 to 1.
const TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";

// What a frame drew: draw calls made and bytes sent, for tests and the round.
export interface Drawn { draws: number; bytes: number }

export class GpuFrames {
  private pipelines = new Map<string, GPURenderPipeline>();
  // By mesh, then by site: two sites may read different leaves of the
  // same corners (G8a), so each writes its own corner words.
  private meshes = new WeakMap<object, Map<Site, { corners: GPUBuffer; triangles: GPUBuffer; count: number }>>();
  private slots = new Map<string, Slot>();
  private depths = new Map<string, GPUTexture>();
  private textures = new Map<string, GPUTexture>();
  // The image a copy pass last wrote to a texture.
  private held = new WeakMap<GPUTexture, Value>();
  private sampler: GPUSampler | null = null;
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
    // The page's one device, its maps' too (G13).
    const device = await pageDevice<GPUDevice>();
    if (!device) return null;
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) return null;
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    return new GpuFrames(device, context, format, canvas);
  }

  private pipeline(site: Site, depth: boolean, format: GPUTextureFormat): GPURenderPipeline {
    const key = `${depth}\u0000${format}\u0000${site.wgsl}`;
    let p = this.pipelines.get(key);
    if (p) return p;
    const module = this.device.createShaderModule({ code: site.wgsl });
    p = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "lab_vs" },
      fragment: { module, entryPoint: "lab_fs", targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
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
    let bySite = this.meshes.get(m as object);
    if (!bySite) this.meshes.set(m as object, (bySite = new Map()));
    let got = bySite.get(site);
    if (got) return got;
    const cs = items(part(m, 0)), ts = items(part(m, 1)).map(Number);
    const w = words(cs.length * site.corner.length);
    const pack = PACKS.get(site)?.corner;
    if (pack) pack(cs, w.f, w.n); else cs.forEach((c, i) => put(c, site.corner, w.f, w.n, i * site.corner.length));
    got = { corners: this.buffer(w.b, GPUBufferUsage.STORAGE), triangles: this.buffer(new Uint32Array(ts), GPUBufferUsage.INDEX), count: ts.length };
    bySite.set(site, got);
    return got;
  }

  // Draws the frame, its passes in the order written. False, drawing
  // nothing, when a draw has no site (it was made where the compiler didn't
  // print one): the page draws it with raster.ts instead. A texture read
  // before a pass of the frame draws it is refused, as raster.ts refuses it.
  draw(frame: Value, siteOf: (d: Data) => Sited | null): Drawn | false {
    const passes = items(part(frame, 0));
    const isCopy = (p: Value) => (p as Data).tag === FRAME_V.copy;
    const sited = passes.map((p) => (isCopy(p) ? [] : items(part(p, 3)).map((d) => siteOf(d as Data))));
    if (sited.some((ds) => ds.some((s) => !s))) return false;
    const drawn: Drawn = { draws: 0, bytes: 0 };
    const enc = this.device.createCommandEncoder();
    const screen = this.context.getCurrentTexture().createView();
    const drawnNow = new Set<string>();
    // The instances this frame sent, by the leaves their site reads: a
    // later draw of the same list reading the same leaves (the flock's
    // shadows, birds and their distances) binds that buffer, sending
    // nothing (I380).
    const sentNow = new Map<string, { list: Value[]; buffer: GPUBuffer }>();
    passes.forEach((pass, pi) => {
      // A copy pass (G11): the image is written to its texture only when
      // it isn't the image that texture last held.
      if (isCopy(pass)) {
        const image = part(pass, 0), [name, t] = copied(pass);
        const tex = this.texture(name, [t.width, t.height]);
        if (this.held.get(tex) !== image) {
          const bytes = new Uint8Array(t.colour.length);
          for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(t.colour[i] * 255);
          this.device.queue.writeTexture({ texture: tex }, bytes, { bytesPerRow: t.width * 4 }, [t.width, t.height]);
          this.held.set(tex, image);
          drawn.bytes += bytes.length;
        }
        drawnNow.add(name);
        return;
      }
      const into = part(pass, 0) as Data;
      const name = into.tag === FRAME_V.texture ? String(part(into, 0)) : null;
      const size: [number, number] = name === null ? [this.canvas.width, this.canvas.height] : [Math.max(1, Number(part(into, 1))), Math.max(1, Number(part(into, 2)))];
      const format = name === null ? this.format : TEXTURE_FORMAT;
      const drawnInto = name === null ? null : this.texture(name, size);
      // A pass drawing into a texture a copy filled leaves it unlike the image.
      if (drawnInto) this.held.delete(drawnInto);
      const view = drawnInto ? drawnInto.createView() : screen;
      const depth = (part(pass, 2) as Data).tag === TRUE || (part(pass, 2) as unknown) === true;
      const [r, g, b, a] = cssColour(String(part(pass, 1)));
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view, clearValue: { r, g, b, a }, loadOp: "clear", storeOp: "store" }],
        ...(depth ? { depthStencilAttachment: { view: this.depth(size).createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } } : {}),
      });
      items(part(pass, 3)).forEach((d, di) => {
        const { site, caps } = sited[pi][di]!;
        const list = (d as Data).fields[1];
        const mesh = this.mesh((d as Data).fields[0], site);
        const slot = this.slot(`${pi}.${di}`);
        // Instances: sent again only when the list isn't the last frame's,
        // and not at all when an earlier draw of this frame sent it.
        const its = items(list), n = its.length, leaves = JSON.stringify(site.instance), sent = sentNow.get(leaves);
        let instances: GPUBuffer;
        if (sent && sameItems(sent.list, its)) instances = sent.buffer;
        else {
          if (!sameItems(slot.list, its) || !slot.items) {
            const per = site.instance.length, w = words(n * per);
            const pack = PACKS.get(site)?.instance;
            if (pack) pack(its, w.f, w.n); else its.forEach((it, i) => put(it, site.instance, w.f, w.n, i * per));
            if (slot.items && slot.items.size >= w.b.byteLength) this.device.queue.writeBuffer(slot.items, 0, w.b);
            else { slot.items?.destroy(); slot.items = this.buffer(w.b, GPUBufferUsage.STORAGE); }
            slot.list = its;
            drawn.bytes += w.b.byteLength;
          }
          instances = slot.items!;
          sentNow.set(leaves, { list: its, buffer: instances });
        }
        // Captures: the leaves of each in order, four words to a vec4u.
        const u = words(site.caps.reduce((t, ls) => t + ls.length, 0));
        let at = 0;
        site.caps.forEach((ls, i) => { if (site.textures?.includes(i)) return; put(caps[i], ls, u.f, u.n, at); at += ls.length; });
        const said = Array.from(u.n).join(",");
        if (said !== slot.capsWere || !slot.caps) {
          if (slot.caps && slot.caps.size >= u.b.byteLength) this.device.queue.writeBuffer(slot.caps, 0, u.b);
          else { slot.caps?.destroy(); slot.caps = this.buffer(u.b, GPUBufferUsage.UNIFORM); }
          slot.capsWere = said;
          drawn.bytes += u.b.byteLength;
        }
        const pipeline = this.pipeline(site, depth, format);
        // The textures sampled, by the names of the targets captured.
        const sampled = (site.textures ?? []).map((i) => {
          const t = String(part(caps[i], 0));
          if (!drawnNow.has(t)) throw new Error(`the texture "${t}" is read before a pass of this frame draws it`);
          return this.textures.get(t)!;
        });
        const want: unknown[] = [slot.caps, instances, mesh.corners, pipeline, ...sampled];
        if (!slot.group || want.length !== slot.groupFor.length || want.some((x, i) => x !== slot.groupFor[i])) {
          const entries: GPUBindGroupEntry[] = [slot.caps!, instances, mesh.corners].map((buffer, binding) => ({ binding, resource: { buffer } }));
          if (sampled.length) entries.push({ binding: 3, resource: this.linear() }, ...sampled.map((t, k) => ({ binding: 4 + k, resource: t.createView() })));
          slot.group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
          slot.groupFor = want;
        }
        rp.setPipeline(pipeline);
        rp.setBindGroup(0, slot.group);
        rp.setIndexBuffer(mesh.triangles, "uint32");
        if (n) rp.drawIndexed(mesh.count, n);
        drawn.draws++;
      });
      rp.end();
      if (name !== null) drawnNow.add(name);
    });
    this.device.queue.submit([enc.finish()]);
    return drawn;
  }

  private slot(at: string): Slot {
    let s = this.slots.get(at);
    if (!s) this.slots.set(at, (s = { list: null, items: null, caps: null, capsWere: "", group: null, groupFor: [] }));
    return s;
  }

  // A depth buffer of each size a pass draws at.
  private depth([width, height]: [number, number]): GPUTexture {
    const key = `${width}x${height}`;
    let d = this.depths.get(key);
    if (!d) this.depths.set(key, (d = this.device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT })));
    return d;
  }

  // A pass's texture by its name, made again when its size changes.
  private texture(name: string, [width, height]: [number, number]): GPUTexture {
    let t = this.textures.get(name);
    if (t && t.width === width && t.height === height) return t;
    t?.destroy();
    this.textures.set(name, (t = this.device.createTexture({ size: [width, height], format: TEXTURE_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })));
    return t;
  }

  private linear(): GPUSampler {
    return (this.sampler ??= this.device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }));
  }

}
