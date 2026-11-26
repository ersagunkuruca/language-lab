// What gpu-frame.ts sends a frame (I380, GAPS game round 4 FR3, FR4), on
// a stand-in device that only counts: a list drawn by several draws whose
// sites read the same leaves goes once, and a list with the same items
// as the last frame's goes not at all, though compiled code hands each
// draw a list object of its own (array.items copies the array's items).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GpuFrames, pageDraws, type Site } from "../src/lang/gpu-frame.ts";
import { ItemsList } from "../src/lang/bytes.ts";
import { FRAME_V, FALSE } from "../src/lang/std-ids.ts";

const g = globalThis as Record<string, unknown>;
g.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
g.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

// A device whose every object does nothing; writes are counted.
function standIn() {
  const written: number[] = [];
  const nothing = () => ({});
  const pass = { setPipeline: nothing, setBindGroup: nothing, setIndexBuffer: nothing, drawIndexed: nothing, end: nothing };
  const device = {
    createBuffer: ({ size }: { size: number }) => ({ size, destroy: nothing }),
    createShaderModule: nothing,
    createRenderPipeline: () => ({ getBindGroupLayout: nothing }),
    createBindGroup: nothing,
    createTexture: ({ size }: { size: number[] }) => ({ width: size[0], height: size[1], createView: nothing, destroy: nothing }),
    createSampler: nothing,
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: nothing }),
    queue: { writeBuffer: (_b: unknown, _o: number, d: ArrayBuffer | ArrayBufferView) => written.push(d.byteLength), submit: nothing, writeTexture: nothing },
  };
  const context = { getCurrentTexture: () => ({ createView: nothing }) };
  const Make = GpuFrames as unknown as new (...a: unknown[]) => GpuFrames;
  return { gpu: new Make(device, context, "bgra8unorm", { width: 8, height: 8 }), written };
}

const rec = (...fields: unknown[]) => ({ tag: "rec", fields });
const list = (...xs: unknown[]) => xs.reduceRight((t, x) => ({ tag: "std.list.cons", fields: [x, t] }), { tag: "std.list.nil", fields: [] });
const f32 = (path: number[]) => ({ path, kind: "f32" as const });
// Two sites that read an instance's one field.
const site = (wgsl: string): Site => ({ wgsl, caps: [], instance: [f32([0])], corner: [f32([0])], colour: 4 });
const SITES: Record<string, Site> = { a: site("a"), b: site("b") };
pageDraws(SITES);
const mesh = { tag: FRAME_V.mesh, fields: [list(rec(0), rec(1), rec(2)), list(0, 1, 2)] };
const birds = [rec(1), rec(2), rec(3), rec(4)];
// Each draw given a list of its own over the same items, as array.items gives.
const draw = (key: string, items: unknown[]) => ({ tag: FRAME_V.draw, fields: [mesh, new ItemsList([...items], 0), null, null, key, []] });
const frame = (items: unknown[]) => ({ tag: FRAME_V.frame, fields: [list({ tag: FRAME_V.pass, fields: [{ tag: FRAME_V.screen, fields: [] }, "#000", { tag: FALSE, fields: [] }, list(draw("a", items), draw("b", items))] })] });

test("a list drawn twice with the same leaves is sent once, and again only when its items change", () => {
  const { gpu } = standIn();
  const sited = (d: { fields: unknown[] }) => ({ site: SITES[d.fields[4] as string], caps: [] });
  // The first frame: the birds' words once for a and b (4 birds, one word
  // each, 16 bytes), and each draw's 16 bytes of captures.
  const first = gpu.draw(frame(birds) as never, sited as never);
  assert.ok(first);
  assert.equal(first.draws, 2);
  assert.equal(first.bytes, 16 + 2 * 16);
  // The same items in new lists: nothing.
  assert.equal((gpu.draw(frame([...birds]) as never, sited as never) as { bytes: number }).bytes, 0);
  // A bird moved: the words again, once.
  assert.equal((gpu.draw(frame([rec(9), ...birds.slice(1)]) as never, sited as never) as { bytes: number }).bytes, 16);
});
