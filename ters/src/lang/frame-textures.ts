// The textures a frame's passes drew (BACKLOG G10, FRAMES.md), while
// raster.ts draws the frame: what `sampled` reads. A pass into a texture
// draws it; a later pass's fragment samples it, between its four nearest
// texels and kept to its edges, as a GPU's linear sampler with
// clamp-to-edge does. A texture read before a pass of this frame drew it
// is a mistake, said with its name.

import type { Data, Value } from "./run.ts";
import { FRAME_V } from "./std-ids.ts";

export interface Texture { width: number; height: number; colour: Float64Array }

let drawn: Map<string, Texture> | null = null;
// Runs f with `textures` as the frame's, so `sampled` reads them.
export function withTextures<T>(textures: Map<string, Texture>, f: () => T): T {
  const was = drawn;
  drawn = textures;
  try { return f(); } finally { drawn = was; }
}

const part = (o: Value, i: number): Value => ((o as unknown as Record<string, Value>)[`f${i}`] ?? (o as Data).fields[i]);

export function sampled(target: Value, across: Value): Value {
  if ((target as Data).tag !== FRAME_V.texture) throw new Error("sampled reads a texture, not the screen");
  const name = String(part(target, 0)), t = drawn?.get(name);
  if (!t) throw new Error(`the texture "${name}" is read before a pass of this frame draws it`);
  const u = Number(part(across, 0)), v = Number(part(across, 1));
  // Texel centres at half steps; the four around the point, kept inside.
  const x = u * t.width - 0.5, y = v * t.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number, k: number) => t.colour[((Math.min(t.height - 1, Math.max(0, j)) * t.width) + Math.min(t.width - 1, Math.max(0, i))) * 4 + k];
  const fields = [0, 1, 2, 3].map((k) => (at(x0, y0, k) * (1 - fx) + at(x0 + 1, y0, k) * fx) * (1 - fy) + (at(x0, y0 + 1, k) * (1 - fx) + at(x0 + 1, y0 + 1, k) * fx) * fy);
  return { tag: FRAME_V.texel, fields } as unknown as Value;
}
