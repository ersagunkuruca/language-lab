// The scalar profile compiled to WGSL, run on a real GPU (WebGPU in
// headless Chromium) and compared with the evaluator. Node has no WebGPU,
// so this is a script rather than a unit test; CI runs it after the
// projectional folder's `npm ci`, whose playwright-core it borrows (the
// compiler has no dependencies of its own).
//
//   node gpu.ts   (or npm run gpu)
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome.
// Each compiled function gets a compute shader that applies it to a grid
// of inputs. GPUs compute in f32, and WGSL only promises sin and cos to
// within 2⁻¹¹ (https://www.w3.org/TR/WGSL/#floating-point-accuracy), so
// the check is "close", not "equal": within 2e-3 of the evaluator,
// relative to the size of the answer, and Bool results exactly.
// A function made only of + − × (and negate, abs, floor, comparisons,
// choices, calls of such functions), which WGSL rounds correctly, is
// checked exactly against the evaluator running the program in Float32
// (projectional/src/lang/float32.ts): f32 in the program, not just on the
// GPU (NUMBERS.md).

import { chromium } from "../projectional/node_modules/playwright-core/index.mjs";
import { makeRunner, type Value } from "../projectional/src/lang/run.ts";
import type { Code } from "../projectional/src/model.ts";
import type { Info } from "../projectional/src/lang/infer.ts";
import type { Names } from "../projectional/src/presentation.ts";
import type { Id } from "../projectional/src/model.ts";
import { lowerScalar, type LType, type SExpr, type SFunc, type SType } from "./src/scalar.ts";
import { withFloat32 } from "../projectional/src/lang/float32.ts";
import { represent } from "../projectional/src/lang/represent.ts";
import { infer } from "../projectional/src/lang/infer.ts";
import { emitWgsl, type ShaderFunc } from "./src/wgsl.ts";
import { load } from "./src/program.ts";
import { area, corners, parts, pga, vectors } from "./src/fixtures.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
const TRUE = "std.bool.true", FALSE = "std.bool.false";
const size = (t: LType): number => (typeof t === "string" ? 1 : t.fields.reduce((n, f) => n + size(f.t), 0));
const scalars = (ts: LType[]): SType[] => ts.flatMap((t) => (typeof t === "string" ? [t] : scalars(t.fields.map((f) => f.t))));
// The evaluator's value as numbers and booleans, in field order.
const flatten = (t: LType, v: Value): (number | boolean)[] =>
  t === "f64" ? [v as number] : t === "i32" ? [(v as { tag: string }).tag === TRUE]
    : t.fields.flatMap((f, j) => flatten(f.t, (v as { fields: Value[] }).fields[j]));

// Inputs that f32 holds exactly, so only the computation differs.
const GRID = [-2.5, -1.75, -1, -0.5, -0.125, 0, 0.25, 0.5, 1, 1.5, 2, 3.75];

interface Case { label: string; code: Code; info: Info; names: Names; roots: Id[]; inputs?: (f: ShaderFunc) => number[][] | undefined }
const cases: Case[] = [
  ...["calculus", "physics", "shaders", "raymarch"].map((name) => { const p = load(name); return { label: name, code: p.code, info: p.info, names: p.pres.names, roots: p.own.defs }; }),
  (() => {
    const a = area();
    // A loop under a budget: ∫ from x in `steps` strips of width w. capped
    // allows ten calls, so from ten strips on it gives its fallback, -1.
    const strips = [[0, 0.01, 200], [-1, 0.125, 16], [1, 0.5, 4]], near = [[0, 0.25, 8], [0, 0.25, 9], [0, 0.25, 10], [1, 0.5, 11], [0, 0.25, 1e9]];
    return { label: "area (tail recursion as a loop, under budgets)", code: a.code, info: a.info, names: a.names, roots: [a.integral, a.capped], inputs: (f) => (f.name === "integral" ? strips : f.name === "capped" ? near : undefined) };
  })(),
  (() => {
    const c = corners();
    // gcd by subtraction only ends for positive whole numbers; under a
    // budget of 1000 it gives 0 when it takes longer, or never ends.
    return { label: "corners", code: c.code, info: c.info, names: c.names, roots: Object.values(c.defs), inputs: (f) => (f.name === "gcd of" ? [[12, 18], [7, 3], [5, 5], [1, 100], [1, 5000], [0.5, 1]] : undefined) };
  })(),
  (() => {
    const v = parts();
    return { label: "vectors module", code: v.code, info: v.info, names: v.names, roots: Object.values(v.defs) };
  })(),
  (() => {
    const g = pga();
    return { label: "projective geometric algebra (staged, C65)", code: g.code, info: g.info, names: g.names, roots: Object.values(g.defs) };
  })(),
  (() => {
    const v = vectors();
    // walk stops once 4 away, so its step must move it away.
    return { label: "records", code: v.code, info: v.info, names: v.names, roots: Object.values(v.defs), inputs: (f) => (f.name === "walk" ? [[0, 1, 0, 0.5, 0], [2, 0, 1, 0.25, 3]] : f.name === "steps" ? [[0, 0.5], [-1, 0.125], [3, 2]] : undefined) };
  })(),
];

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" }),
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"],
});
const page = await browser.newPage();
// WebGPU needs a secure context; a data: page isn't one, file: is.
await page.goto(new URL("./README.md", import.meta.url).href);
if (!(await page.evaluate(() => !!navigator.gpu))) throw new Error("this browser has no WebGPU");

// Operations WGSL does exactly as binary32 does: correctly rounded.
const EXACT = new Set(["add", "sub", "mul", "neg", "abs", "floor", "float32", "less", "equal", "beq", "and", "or", "not"]);
// A linear map printed as a matrix (C30c) sums in its own order, and a
// call worked out when compiled (C65) may hold a number rounded once in
// Float64: close, not exact.
function exact(funcs: SFunc[], i: number, matrices: Set<number>, rounded: Set<string>, seen = new Set<number>()): boolean {
  if (matrices.has(i) || rounded.has(funcs[i].def)) return false;
  if (seen.has(i)) return true;
  seen.add(i);
  const ok = (e: SExpr): boolean => {
    switch (e.k) {
      case "num": case "bool": case "local": return true;
      case "op": return EXACT.has(e.op) && e.args.every(ok);
      case "if": return ok(e.cond) && ok(e.then) && ok(e.else);
      case "let": return ok(e.value) && ok(e.body);
      case "call": return e.args.every(ok) && exact(funcs, e.fn, matrices, rounded, seen);
      case "make": return e.args.every(ok);
      case "get": return ok(e.rec);
      // A budget counts its calls in f32 on the GPU: whole numbers, exact.
      case "budget": return ok(e.body) && ok(e.otherwise);
    }
  };
  return ok(funcs[i].body);
}

let failures = 0, compared = 0, exactly = 0;
for (const c of cases) {
  const lowered = lowerScalar(c.code, c.info, c.names, c.roots, { records: true });
  const shader = emitWgsl(lowered);
  // The lowered program: generated derivatives (∂blend/∂a …) are in it.
  const r = makeRunner(lowered.code, lowered.info, { print: () => {} });
  // The same program in Float32.
  const w = withFloat32(lowered.code, c.names);
  const in32 = represent(w.code, lowered.funcs.map((f) => f.def), w.rep);
  const r32 = makeRunner(in32, infer(in32, w.names), { print: () => {} });
  for (const f of shader.funcs) {
    const i = lowered.funcs.findIndex((g) => g.def === f.def);
    const isExact = exact(lowered.funcs, i, shader.matrices, lowered.rounded);
    // Records go in and out as their numbers, in field order.
    const width = f.params.reduce((n, t) => n + size(t), 0), outWidth = size(f.result);
    const inputs = c.inputs?.(f) ?? GRID.map((_, k) => Array.from({ length: width }, (_, j) => (scalars(f.params)[j] === "i32" ? (k + j) % 2 : GRID[(k + 3 * j) % GRID.length])));
    let at = 0;
    const arg = (t: LType): string => {
      if (t === "i32") return `(inp[b + ${at++}u] > 0.5)`;
      if (t === "f64") return `inp[b + ${at++}u]`;
      return `${shader.structs.get(t.key)!.name}(${t.fields.map((x) => arg(x.t)).join(", ")})`;
    };
    const outs: string[] = [];
    const out = (t: LType, x: string) => {
      if (t === "i32") outs.push(`select(0.0, 1.0, ${x})`);
      else if (t === "f64") outs.push(x);
      else t.fields.forEach((y, j) => out(y.t, `${x}.${shader.structs.get(t.key)!.fields[j]}`));
    };
    out(f.result, "r");
    const kernel = `${shader.wgsl}
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= ${inputs.length}u) { return; }
  let b = i * ${width}u;
  let r = ${f.wgsl}(${f.params.map(arg).join(", ")});
${outs.map((x, j) => `  outp[i * ${outWidth}u + ${j}u] = ${x};`).join("\n")}
}`;
    // A GPU that never answers is a failure, not a hang.
    const got = await Promise.race([
      page.evaluate(run, { wgsl: kernel, inputs: inputs.flat(), count: inputs.length * outWidth }),
      new Promise<string>((done) => setTimeout(() => done("no answer from the GPU in 60 s"), 60_000).unref()),
    ]);
    if (typeof got === "string") { console.log(`✗ ${c.label}: ${f.name}: ${got}`); failures++; continue; }
    let bad = 0;
    inputs.forEach((xs, k) => {
      let j = 0;
      // The GPU is given f32 inputs, so Float32 is too.
      const value = (t: LType, round: boolean): Value => {
        if (t === "i32") return { tag: xs[j++] ? TRUE : FALSE, fields: [] };
        if (t === "f64") return round ? Math.fround(xs[j++]) : xs[j++];
        return { tag: t.variant, fields: t.fields.map((x) => value(x.t, round)) };
      };
      const runner = isExact ? r32 : r;
      const want = flatten(f.result, first(runner.call(runner.value(f.def), ...f.params.map((t) => value(t, isExact))))!);
      const ok = want.every((w, o) => {
        const g = got[k * outWidth + o];
        if (typeof w === "boolean") return (g === 1) === w;
        if (Number.isNaN(w)) return Number.isNaN(g);
        return isExact ? g === w : Math.abs(g - w) <= 2e-3 * Math.max(1, Math.abs(w));
      });
      compared++;
      if (isExact) exactly++;
      if (!ok) { bad++; console.log(`✗ ${c.label}: ${f.name}(${xs.join(", ")}) = ${got.slice(k * outWidth, (k + 1) * outWidth).join(", ")} on the GPU, ${want.join(", ")} in the evaluator`); }
    });
    failures += bad;
    if (!bad) console.log(`✓ ${c.label}: ${f.name} (${inputs.length} inputs${isExact ? ", exactly, in Float32" : ""})`);
  }
  for (const [def, why] of shader.refused) console.log(`  ${c.label}: ${c.names[def] ?? def} is refused: it ${why}`);
}
await browser.close();
console.log(`${compared} values compared (${exactly} exactly, in Float32), ${failures} wrong`);
if (failures || !compared) process.exit(1);

// In the page: compile the kernel, run it once per input, read the results.
async function run({ wgsl, inputs, count }: { wgsl: string; inputs: number[]; count: number }): Promise<number[] | string> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return "no GPU adapter";
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: wgsl });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length) return errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("; ");
  const buffer = (data: Float32Array, usage: number) => {
    const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage, mappedAtCreation: true });
    new Float32Array(b.getMappedRange()).set(data);
    b.unmap();
    return b;
  };
  const inp = buffer(new Float32Array(inputs), GPUBufferUsage.STORAGE);
  const out = buffer(new Float32Array(count), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const read = device.createBuffer({ size: Math.max(16, count * 4), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inp } }, { binding: 1, resource: { buffer: out } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  enc.copyBufferToBuffer(out, 0, read, 0, count * 4);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  return [...new Float32Array(read.getMappedRange())].slice(0, count);
}
