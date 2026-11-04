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

import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { infer } from "../ters/src/lang/infer.ts";
import { makeRunner, type Value } from "../ters/src/lang/run.ts";
import { withFloat32 } from "../ters/src/lang/float32.ts";
import { represent } from "../ters/src/lang/represent.ts";
import { lowerScalar } from "../compiler/src/scalar.ts";
import { emitWgsl } from "../compiler/src/wgsl.ts";
import { emitWasm } from "../compiler/src/wasm.ts";
import { emitJs } from "../compiler/src/js-scalar.ts";
import { checkOrder, drawDrawable, pause, POINTS, wasmBytes, type Built, type CpuProgram, type Drawable, type Picture } from "./pictureDraw.ts";
export { pause, type Picture } from "./pictureDraw.ts";

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

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

// A picture's definitions lowered as a shader has them (C66c): an Int is
// an i32 and std's Array an array<T, N>, on the GPU and on the CPU alike
// (WebAssembly takes the Ints, C66e; JavaScript draws a picture with
// arrays when WebAssembly refuses them).
// Once per version of the code (C90): the GPU try and the CPU side lower
// the same picture, and so does opening the program again.
// The names are compared by what they say: opening the program again
// builds the same names anew.
const lowered = new WeakMap<Code, Map<string, { info: Info; names: string; out: ReturnType<typeof lowerScalar> }>>();
const said = new WeakMap<Names, string>();
const saidOf = (names: Names) => { let s = said.get(names); if (s === undefined) said.set(names, (s = JSON.stringify(names))); return s; };
function once<T>(cache: WeakMap<Code, Map<string, { info: Info; names: string; out: T }>>, code: Code, info: Info, names: Names, entries: Record<string, Id>, make: () => T): T {
  const m = cache.get(code) ?? new Map();
  cache.set(code, m);
  const key = JSON.stringify(entries), hit = m.get(key), sig = saidOf(names);
  if (hit && hit.info === info && hit.names === sig) return hit.out;
  const out = make();
  m.set(key, { info, names: sig, out });
  return out;
}
export function lowerPicture(code: Code, info: Info, names: Names, entries: Record<string, Id>) {
  return once(lowered, code, info, names, entries, () => lowerScalar(code, info, names, Object.values(entries), { records: true, shader: true }));
}
type Side = { code: Code; info: Info; names: Names } | null;
const float32 = new WeakMap<Code, Map<string, { info: Info; names: string; out: Side }>>();

// Throws, with the compiler's reason, when the entries can't be drawn.
export async function drawPicture(o: PictureOptions): Promise<Picture> {
  return drawDrawable(await prepare(o.code, o.info, o.names, o.entries), o);
}

// The picture compiled once, ahead (shaders.html, from editor/build.ts):
// the evaluator's answers at every check point and the CPU's program made
// now, so the page only draws.
export async function buildPicture(code: Code, info: Info, names: Names, entries: Record<string, Id>): Promise<Built> {
  const p = await prepare(code, info, names, entries);
  // The evaluator's answers in the order the page checks them, for a few
  // seconds of the evaluator (at least 12 points): all 108 of the ray
  // marcher's take two minutes, too long for every build of the site.
  const want: (number[] | null)[] = POINTS.map(() => null);
  const start = performance.now();
  for (let n = 0; n < POINTS.length && (n < 12 || performance.now() - start < 5000); n++) { const i = checkOrder(n); want[i] = p.want(i); }
  return { wgsl: p.wgsl, fragment: p.fragment, kernel: p.kernel, in32: p.in32, want, cpu: p.cpu() };
}

// The shaders for the GPU, the evaluator for the check, and the CPU's
// program when there's no GPU, each made when first asked.
async function prepare(code: Code, info: Info, names: Names, entries: Record<string, Id>): Promise<Drawable> {
  const keys = Object.keys(entries);
  await pause();
  const shader = emitWgsl(lowerPicture(code, info, names, entries));
  await pause();
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
  const kernel = `${shader.wgsl}
${helper}@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= ${POINTS.length}u) { return; }
  let c = ${rgb("inp[3u * i]", "inp[3u * i + 1u]", "inp[3u * i + 2u]")};
  outp[3u * i] = c.x;
  outp[3u * i + 1u] = c.y;
  outp[3u * i + 2u] = c.z;
}`;
  // The same program in Float32 (src/lang/float32.ts), as compiler/gpu.ts
  // checks it: the evaluator's check and the CPU's picture round as the GPU
  // does. The program as it is when that can't be made.
  const in32 = once(float32, code, info, names, entries, (): Side => {
    try {
      const w = withFloat32(code, names);
      const c = represent(w.code, keys.map((k) => entries[k]), w.rep), i = infer(c, w.names);
      return i.errors.length ? null : { code: c, info: i, names: w.names };
    } catch { return null; }
  });
  await pause();
  const cpuSide = in32 ?? { code, info, names };
  let r: ReturnType<typeof makeRunner> | null = null;
  // The evaluator's colour at (x, y, t).
  const evaluate = (x: number, y: number, t: number): number[] => {
    r ??= makeRunner(cpuSide.code, cpuSide.info, { print: () => {} });
    return keys.length === 3
      ? keys.map((e) => first(r!.call(r!.value(entries[e]), x, y, t)) as number)
      : (first(r.call(r.value(entries.colour), x, y, t)) as { fields: number[] }).fields;
  };
  const want = (i: number) => evaluate(Math.fround(POINTS[i][0]), Math.fround(POINTS[i][1]), Math.fround(POINTS[i][2]));
  return { wgsl: shader.wgsl, fragment, kernel, want, in32: !!in32, cpu: () => cpuProgram(lowerPicture(cpuSide.code, cpuSide.info, cpuSide.names, entries), entries) };
}

// The CPU's program for a picture: WebAssembly, red, green and blue as
// three exports, or the colour record's fields by its readers (`Colour.red`,
// or `Colour.red(key)` where two record types share a name); and
// JavaScript, for where WebAssembly can't take them or doesn't run.
function cpuProgram(lowered: ReturnType<typeof lowerScalar>, entries: Record<string, Id>): CpuProgram {
  const keys = Object.keys(entries);
  const out = keys.find((k) => lowered.refused.has(entries[k]));
  if (out) return { refused: `${out} can't be drawn on the CPU either: it ${lowered.refused.get(entries[out])}` };
  const { js, names } = emitJs(lowered);
  const fnOf = (def: Id) => names.get(lowered.funcs.findIndex((f) => f.def === def))!;
  const program: CpuProgram = { js: { source: js, rgb: keys.map((k) => fnOf(entries[k])) } };
  try {
    const m = emitWasm(lowered);
    if (keys.length === 3) return { ...program, wasm: { bytes: wasmBytes(m.bytes), floats: m.floats, rgb: keys } };
    const f = lowered.funcs.find((g) => g.def === entries.colour && g.params.every((p) => p === "f64"));
    const rec = f && typeof f.result === "object" && "fields" in f.result ? f.result : null;
    if (!rec || !m.exports.includes("colour")) return program;
    const reads = rec.fields.map((x) => [`${rec.name}.${x.name}(${rec.key})`, `${rec.name}.${x.name}`].find((n) => m.exports.includes(n)));
    if (reads.some((n) => !n)) return program;
    return { ...program, wasm: { bytes: wasmBytes(m.bytes), floats: m.floats, colour: "colour", reads: reads as string[] } };
  } catch { return program; }
}
