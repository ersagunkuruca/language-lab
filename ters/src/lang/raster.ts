// A frame drawn on the CPU (BACKLOG G9b, docs/design/targets/FRAMES.md):
// the reference a GPU's drawing is checked against, and what draws a frame
// where there is no WebGPU. Each draw's vertex function places each corner
// of its mesh for each instance, in clip space (x, y from −1 to 1, y up; z
// from 0 to 1, near to far; w for perspective), and each triangle is filled
// pixel by pixel, at pixel centres: what the vertex functions carried is
// put between the corners in perspective, and the fragment function gives
// the pixel's colour. A pass with depth keeps the nearest pixel. This is
// the triangle setup of every rasterizer (Pineda's edge functions, 1988),
// with WebGPU's conventions, so the two draw the same frame.
//
// Kept simple on purpose: a triangle with a corner behind the eye (w ≤ 0)
// isn't drawn rather than clipped.
// A corner or a pixel with no answer (a fragment's Choice that gave none)
// is left out, as a shader's `discard` leaves one out.

import { fromList, type Data, type Value } from "./run-values.ts";
import { NoValue } from "./cells.ts";
import { FRAME_V, TRUE } from "./std-ids.ts";
import { withTextures, type Texture } from "./frame-textures.ts";

export interface Image { width: number; height: number; rgba: Uint8ClampedArray }

type Call = (f: Value, ...args: Value[]) => Value;

// A field of a record, the evaluator's (fields) or compiled code's (f0, f1, …).
const part = (o: Value, i: number): Value => {
  const r = o as unknown as Record<string, Value>;
  return r[`f${i}`] ?? (o as Data).fields[i];
};
// The items of a list, the evaluator's or compiled code's, or an array.
const items = (v: Value): Value[] => (Array.isArray(v) ? v : fromList(v));
// The Float64s of a record of Float64s (a Vec3, a Colour), in order.
function floats(v: Value, out: number[] = []): number[] {
  if (typeof v === "number") { out.push(v); return out; }
  if (typeof v !== "object" || v === null) return out;
  const d = v as Data;
  if (Array.isArray(d.fields)) { for (const f of d.fields) floats(f, out); return out; }
  for (let i = 0; `f${i}` in (v as object); i++) floats(part(v, i), out);
  return out;
}
// What a vertex function carried, with its Float64s replaced by xs in
// order (the corners' put between); anything else as the first corner's.
function rebuilt(v: Value, xs: number[], at = { i: 0 }): Value {
  if (typeof v === "number") return xs[at.i++];
  if (typeof v !== "object" || v === null) return v;
  const d = v as Data;
  if (Array.isArray(d.fields)) return { tag: d.tag, fields: d.fields.map((f) => rebuilt(f, xs, at)) } as unknown as Value;
  const o = Object.assign(Object.create(Object.getPrototypeOf(v)), v) as Record<string, Value>;
  for (let i = 0; `f${i}` in o; i++) o[`f${i}`] = rebuilt(o[`f${i}`], xs, at);
  return o as unknown as Value;
}

// A CSS colour as red, green, blue and alpha from 0 to 1: #rgb, #rrggbb,
// #rrggbbaa, rgb() and rgba(). Anything else is black.
export function cssColour(t: string): [number, number, number, number] {
  const s = t.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const f = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (f) {
    const p = f[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return [p[0] / 255, p[1] / 255, p[2] / 255, Number.isFinite(p[3]) ? p[3] : 1];
  }
  return [0, 0, 0, 1];
}

// A call's answer, or undefined when it has none (html.ts's NoAnswer, a
// formula's NoValue).
const answer = (call: Call, f: Value, ...xs: Value[]): Value | undefined => {
  try { return call(f, ...xs); } catch (e) { if (e instanceof NoValue || (e instanceof Error && e.message === "no value")) return undefined; throw e; }
};

// The frame's passes drawn in order: each into the screen's image or into
// a texture of its own size, which a later pass's fragment reads with
// `sampled` (frame-textures.ts, G10).
export function rasterize(frame: Value, width: number, height: number, call: Call): Image {
  const screen = { width, height, colour: new Float64Array(width * height * 4) };
  const textures = new Map<string, Texture>();
  withTextures(textures, () => {
    for (const pass of items(part(frame, 0))) {
      const into = part(pass, 0) as Data;
      const t = into.tag === FRAME_V.texture ? { width: Math.max(1, Number(part(into, 1))), height: Math.max(1, Number(part(into, 2))) } : null;
      const target = t ? { ...t, colour: new Float64Array(t.width * t.height * 4) } : screen;
      const [r, g, b, a] = cssColour(String(part(pass, 1)));
      for (let p = 0; p < target.width * target.height; p++) target.colour.set([r, g, b, a], p * 4);
      const tested = (part(pass, 2) as Data).tag === TRUE || (part(pass, 2) as unknown) === true;
      const depth = tested ? new Float64Array(target.width * target.height).fill(1) : null;
      for (const d of items(part(pass, 3))) drawOne(d as Data, target.width, target.height, call, target.colour, depth);
      // Kept as a texture is stored: each part from 0 to 1.
      if (t) { for (let i = 0; i < target.colour.length; i++) target.colour[i] = Math.min(1, Math.max(0, target.colour[i])); textures.set(String(part(into, 0)), target); }
    }
  });
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < screen.colour.length; i++) rgba[i] = Math.round(Math.min(1, Math.max(0, screen.colour[i])) * 255);
  return { width, height, rgba };
}

interface Placed { x: number; y: number; z: number; w: number; carried: Value; leaves: number[] }

function drawOne(d: Data, width: number, height: number, call: Call, colour: Float64Array, depth: Float64Array | null): void {
  const [mesh, instances, vertex, fragment] = d.fields;
  const corners = items(part(mesh, 0)), tris = items(part(mesh, 1)).map(Number);
  for (const it of items(instances)) {
    // Each corner placed once for this instance.
    const placed: (Placed | null)[] = corners.map((c) => {
      const pl = answer(call, vertex, it, c);
      if (pl === undefined) return null;
      const pos = floats(part(pl, 0));
      const carried = part(pl, 1);
      const w = pos.length >= 4 ? pos[3] : 1;
      return { x: pos[0], y: pos[1], z: pos[2] ?? 0, w, carried, leaves: floats(carried) };
    });
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const [a, b, c] = [placed[tris[t]], placed[tris[t + 1]], placed[tris[t + 2]]];
      if (a && b && c && a.w > 0 && b.w > 0 && c.w > 0) triangle(a, b, c, width, height, call, fragment, colour, depth);
    }
  }
}

function triangle(a: Placed, b: Placed, c: Placed, width: number, height: number, call: Call, fragment: Value, colour: Float64Array, depth: Float64Array | null): void {
  // In pixels, y down, with z and 1/w kept for depth and perspective.
  const screen = (p: Placed) => ({ x: (p.x / p.w + 1) / 2 * width, y: (1 - p.y / p.w) / 2 * height, z: p.z / p.w, q: 1 / p.w });
  const A = screen(a), B = screen(b), C = screen(c);
  const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
  if (area === 0 || !Number.isFinite(area)) return;
  const x0 = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x))), x1 = Math.min(width - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
  const y0 = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y))), y1 = Math.min(height - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
  const n = a.leaves.length;
  const leaves = new Array<number>(n);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    // How much of each corner is at the pixel's centre.
    const wa = ((B.x - px) * (C.y - py) - (B.y - py) * (C.x - px)) / area;
    const wb = ((C.x - px) * (A.y - py) - (C.y - py) * (A.x - px)) / area;
    const wc = 1 - wa - wb;
    if (wa < 0 || wb < 0 || wc < 0) continue;
    const z = wa * A.z + wb * B.z + wc * C.z;
    if (z < 0 || z > 1) continue;
    const at = y * width + x;
    if (depth && !(z < depth[at])) continue;
    // In perspective: each corner's share over its w, then over their sum.
    const qa = wa * A.q, qb = wb * B.q, qc = wc * C.q, q = qa + qb + qc;
    for (let i = 0; i < n; i++) leaves[i] = (qa * a.leaves[i] + qb * (b.leaves[i] ?? 0) + qc * (c.leaves[i] ?? 0)) / q;
    const shade = answer(call, fragment, n ? rebuilt(a.carried, leaves) : a.carried);
    if (shade === undefined) continue;
    const k = floats(shade);
    const alpha = k.length >= 4 ? Math.min(1, Math.max(0, k[3])) : 1;
    for (let i = 0; i < 3; i++) colour[at * 4 + i] = alpha * (k[i] ?? 0) + (1 - alpha) * colour[at * 4 + i];
    colour[at * 4 + 3] = alpha + (1 - alpha) * colour[at * 4 + 3];
    if (depth) depth[at] = z;
  }
}
