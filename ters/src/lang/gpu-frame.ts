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
import { isGpuItems, pageDevice } from "./gpu-device.ts";

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
  // A draw whose instances may be a list kept on the GPU (G13c): that
  // list's layout (every leaf of an instance, as the kernel answers) and
  // where in it each leaf of `instance` sits. Such a list is bound as it
  // is, the vertex reading those places; an ordinary one sends only
  // `instance`'s leaves.
  kept?: { leaves: Leaf[]; places: number[] };
  // The module has a compute entry `lab_cull_main` too (G14b,
  // gpu-draws.ts): each instance's flag, 1 where some of it may be drawn.
  cull?: true;
  // The captured Arrays (G15a1, LIGHTS.md): capture `cap`'s items, each
  // as `leaves`, in a storage buffer at binding 16 + r after its length.
  // Such a capture has no words in the uniform.
  lists?: { cap: number; leaves: Leaf[] }[];
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

interface Slot { list: Value[] | null; items: GPUBuffer | null; caps: GPUBuffer | null; capsWere: string; group: GPUBindGroup | null; groupFor: unknown[]; cull?: Culling; lists?: { was: Value[] | null; buffer: GPUBuffer | null }[] }
// A culled draw's buffers (G14b): each instance's flag, the kept
// instances' indices in order, drawIndexedIndirect's five words, and the
// two passes' counts; with the bind groups made of them.
interface Culling { n: number; flags: GPUBuffer; ids: GPUBuffer; args: GPUBuffer; job: GPUBuffer; scan: GPUBuffer; groups: Map<string, GPUBindGroup>; groupFor: unknown[] }

// Culling (G14b, CULLING.md): a draw of at least this many instances
// whose site can be culled is: a compute pass flags the instances some of
// which may land in the picture, a second keeps their indices in order,
// and the draw is indirect, of those alone. Fewer aren't worth two passes.
const CULL_FROM = 256;
// Off where a test says so, to compare the pictures.
const culling = () => !(globalThis as { labCullOff?: true }).labCullOff;
// The kept instances' indices in order: one workgroup, each of its 256
// threads counting a run of the flags, the counts summed (Hillis and
// Steele's scan), then each run's kept indices written from where its
// sum starts; and the indirect draw's arguments, the kept as instances.
const KEPT_IN_ORDER = `@group(0) @binding(0) var<storage, read> lab_kept: array<u32>;
@group(0) @binding(1) var<storage, read_write> lab_ids: array<u32>;
@group(0) @binding(2) var<storage, read_write> lab_args: array<u32, 5>;
struct LabScan { n: u32, indices: u32 }
@group(0) @binding(3) var<uniform> lab_scan: LabScan;
var<workgroup> lab_sums: array<u32, 256>;
@compute @workgroup_size(256) fn lab_main(@builtin(local_invocation_index) t: u32) {
  let n = lab_scan.n;
  let per = (n + 255u) / 256u;
  let lo = min(t * per, n);
  let hi = min(lo + per, n);
  var s = 0u;
  for (var i = lo; i < hi; i++) { s += lab_kept[i]; }
  lab_sums[t] = s;
  workgroupBarrier();
  for (var d = 1u; d < 256u; d = d << 1u) {
    var v = 0u;
    if (t >= d) { v = lab_sums[t - d]; }
    workgroupBarrier();
    lab_sums[t] += v;
    workgroupBarrier();
  }
  var at = lab_sums[t] - s;
  for (var i = lo; i < hi; i++) { if (lab_kept[i] != 0u) { lab_ids[at] = i; at++; } }
  if (t == 255u) { lab_args[0] = lab_scan.indices; lab_args[1] = lab_sums[255]; lab_args[2] = 0u; lab_args[3] = 0u; lab_args[4] = 0u; }
}
`;
// What a pass draws into: the canvas, or a texture of its own (G10),
// stored as rgba8unorm as raster.ts stores one, from 0 to 1.
const TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";

// What a frame drew: draw calls made and bytes sent, for tests and the round.
export interface Drawn { draws: number; bytes: number }

export class GpuFrames {
  private pipelines = new Map<string, GPURenderPipeline>();
  // By mesh, then by site: two sites may read different leaves of the
  // same corners (G8a), so each writes its own corner words.
  private meshes = new WeakMap<object, Map<Site, { corners: GPUBuffer; triangles: GPUBuffer; count: number; n: number }>>();
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

  // The pipeline constants for a list kept on the GPU (G13c): where in it
  // each leaf the vertex reads sits.
  private placesOf(site: Site, kept: boolean) {
    return kept && site.kept ? { constants: { lab_iw: site.kept.leaves.length, ...Object.fromEntries(site.kept.places.map((at, j) => [`lab_i${j}`, at])) } } : {};
  }

  private pipeline(site: Site, depth: boolean, format: GPUTextureFormat, kept = false, culled = false): GPURenderPipeline {
    const key = `${depth}\u0000${format}\u0000${kept}\u0000${culled}\u0000${site.wgsl}`;
    let p = this.pipelines.get(key);
    if (p) return p;
    // Culled, the vertex takes its instance from the kept indices.
    const code = culled ? `${site.wgsl.replace("let lab_it = lab_ii; // drawn", "let lab_it = lab_ids[lab_ii];")}\n@group(1) @binding(0) var<storage, read> lab_ids: array<u32>;\n` : site.wgsl;
    const module = this.device.createShaderModule({ code });
    p = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "lab_vs", ...this.placesOf(site, kept) },
      fragment: { module, entryPoint: "lab_fs", targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
      primitive: { topology: "triangle-list" },
      ...(depth ? { depthStencil: { format: "depth24plus" as GPUTextureFormat, depthWriteEnabled: true, depthCompare: "less" as GPUCompareFunction } } : {}),
    });
    this.pipelines.set(key, p);
    return p;
  }

  // The cull pass of a site (its module's lab_cull_main), and the pass
  // keeping the indices, one for every site.
  private computes = new Map<string, GPUComputePipeline>();
  private compute(key: string, code: string, entryPoint: string, more: object = {}): GPUComputePipeline {
    let p = this.computes.get(key);
    if (!p) this.computes.set(key, (p = this.device.createComputePipeline({ layout: "auto", compute: { module: this.device.createShaderModule({ code }), entryPoint, ...more } })));
    return p;
  }

  // Encodes the cull of a draw's n instances (G14b), before its pass.
  private cull(enc: GPUCommandEncoder, slot: Slot, site: Site, kept: boolean, buffers: GPUBuffer[], n: number, corners: number, indices: number, drawn: Drawn, lists: GPUBuffer[] = []): Culling {
    const D = this.device, U = GPUBufferUsage;
    let c = slot.cull;
    if (!c || c.n < n) {
      if (c) for (const b of [c.flags, c.ids, c.args, c.job, c.scan]) b.destroy();
      const size = Math.max(16, n * 4);
      c = slot.cull = { n, flags: D.createBuffer({ size, usage: U.STORAGE }), ids: D.createBuffer({ size, usage: U.STORAGE }), args: D.createBuffer({ size: 32, usage: U.STORAGE | U.INDIRECT | U.COPY_SRC }), job: D.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }), scan: D.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }), groups: new Map(), groupFor: [] };
    }
    D.queue.writeBuffer(c.job, 0, new Uint32Array([n, corners, 0, 0]));
    D.queue.writeBuffer(c.scan, 0, new Uint32Array([n, indices, 0, 0]));
    drawn.bytes += 32;
    const flag = this.compute(`cull\u0000${kept}\u0000${site.wgsl}`, site.wgsl, "lab_cull_main", this.placesOf(site, kept));
    const scan = this.compute("scan", KEPT_IN_ORDER, "lab_main");
    // The flagging pass's group, made again when what it binds changes.
    const bound = [...buffers, ...lists];
    if (bound.length !== c.groupFor.length || bound.some((b, i) => b !== c!.groupFor[i]) || !c.groups.has("flag")) {
      c.groups.set("flag", D.createBindGroup({ layout: flag.getBindGroupLayout(0), entries: [...[...buffers, c.flags, c.job].map((buffer, binding) => ({ binding, resource: { buffer } })), ...lists.map((buffer, r) => ({ binding: 16 + r, resource: { buffer } }))] }));
      c.groupFor = bound;
    }
    if (!c.groups.has("scan")) c.groups.set("scan", D.createBindGroup({ layout: scan.getBindGroupLayout(0), entries: [c.flags, c.ids, c.args, c.scan].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
    const p = enc.beginComputePass(), groups = Math.ceil(n / 64);
    p.setPipeline(flag); p.setBindGroup(0, c.groups.get("flag")!); p.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
    p.setPipeline(scan); p.setBindGroup(0, c.groups.get("scan")!); p.dispatchWorkgroups(1);
    p.end();
    return c;
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
    got = { corners: this.buffer(w.b, GPUBufferUsage.STORAGE), triangles: this.buffer(new Uint32Array(ts), GPUBufferUsage.INDEX), count: ts.length, n: cs.length };
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
      // Each draw made ready (its buffers, and its cull's passes encoded
      // before the render pass), then drawn in the render pass.
      const draws = items(part(pass, 3)).map((d, di) => {
        const { site, caps } = sited[pi][di]!;
        const list = (d as Data).fields[1];
        const mesh = this.mesh((d as Data).fields[0], site);
        const slot = this.slot(`${pi}.${di}`);
        // Instances: sent again only when the list isn't the last frame's,
        // and not at all when an earlier draw of this frame sent it.
        // A list kept on the GPU (G13b): the kernel's buffer, laid out as
        // the site's `kept` says (gpu-resident.ts keptOnGpu), bound as it is.
        const kept = isGpuItems(list) ? list : null;
        if (kept && kept.words !== site.kept?.leaves.length) throw new Error("a list kept on the GPU isn't laid out as this draw's instances");
        const its = kept ? [] : items(list), n = kept ? kept.n : its.length, leaves = JSON.stringify(site.instance), sent = sentNow.get(leaves);
        let instances: GPUBuffer;
        if (kept) instances = kept.buffer as GPUBuffer;
        else if (sent && sameItems(sent.list, its)) instances = sent.buffer;
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
        // Each captured Array: sent again only when its items changed.
        const lists = (site.lists ?? []).map((l, r) => {
          const held = ((slot.lists ??= [])[r] ??= { was: null, buffer: null }), its = items(caps[l.cap]);
          if (!held.buffer || !sameItems(held.was, its)) {
            const per = l.leaves.length, w = words(1 + its.length * per);
            w.n[0] = its.length;
            its.forEach((it, i) => put(it, l.leaves, w.f, w.n, 1 + i * per));
            if (held.buffer && held.buffer.size >= w.b.byteLength) this.device.queue.writeBuffer(held.buffer, 0, w.b);
            else { held.buffer?.destroy(); held.buffer = this.buffer(w.b, GPUBufferUsage.STORAGE); }
            held.was = its;
            drawn.bytes += w.b.byteLength;
          }
          return held.buffer;
        });
        const culled = culling() && !!site.cull && n >= CULL_FROM ? this.cull(enc, slot, site, !!kept, [slot.caps!, instances, mesh.corners], n, mesh.n, mesh.count, drawn, lists) : null;
        const pipeline = this.pipeline(site, depth, format, !!kept, !!culled);
        // The textures sampled, by the names of the targets captured.
        const sampled = (site.textures ?? []).map((i) => {
          const t = String(part(caps[i], 0));
          if (!drawnNow.has(t)) throw new Error(`the texture "${t}" is read before a pass of this frame draws it`);
          return this.textures.get(t)!;
        });
        const want: unknown[] = [slot.caps, instances, mesh.corners, pipeline, ...sampled, ...lists];
        if (!slot.group || want.length !== slot.groupFor.length || want.some((x, i) => x !== slot.groupFor[i])) {
          const entries: GPUBindGroupEntry[] = [slot.caps!, instances, mesh.corners].map((buffer, binding) => ({ binding, resource: { buffer } }));
          if (sampled.length) entries.push({ binding: 3, resource: this.linear() }, ...sampled.map((t, k) => ({ binding: 4 + k, resource: t.createView() })));
          entries.push(...lists.map((buffer, r) => ({ binding: 16 + r, resource: { buffer } })));
          slot.group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
          slot.groupFor = want;
        }
        let ids: GPUBindGroup | null = null;
        if (culled) {
          const key = `ids\u0000${depth}\u0000${format}\u0000${!!kept}`;
          if (!culled.groups.has(key)) culled.groups.set(key, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: culled.ids } }] }));
          ids = culled.groups.get(key)!;
        }
        const group = slot.group;
        drawn.draws++;
        return (rp: GPURenderPassEncoder) => {
          rp.setPipeline(pipeline);
          rp.setBindGroup(0, group);
          if (ids) rp.setBindGroup(1, ids);
          rp.setIndexBuffer(mesh.triangles, "uint32");
          if (culled) rp.drawIndexedIndirect(culled.args, 0);
          else if (n) rp.drawIndexed(mesh.count, n);
        };
      });
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view, clearValue: { r, g, b, a }, loadOp: "clear", storeOp: "store" }],
        ...(depth ? { depthStencilAttachment: { view: this.depth(size).createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } } : {}),
      });
      for (const d of draws) d(rp);
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
