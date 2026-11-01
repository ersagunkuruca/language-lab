// The parts builtins (map parts, zip parts, total) and the vectors module
// written on them, compiled: to JavaScript, which must give the
// evaluator's values, and to WGSL, where each module definition is the
// vector operation it describes. That the GPU agrees is gpu.ts's job.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { parts } from "../src/fixtures.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("vectors module: compiled JavaScript gives the evaluator's values", async () => {
  const p = parts();
  assert.deepEqual(p.info.errors, []);
  const names = Object.keys(p.defs);
  const path = join(mkdtempSync(join(tmpdir(), "parts-")), "parts.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: names }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const run = (name: string, ...xs: Value[]) => { for (const v of r.call(r.value(p.defs[name as keyof typeof p.defs]), ...xs)) return v; return undefined; };
  const inputs: Record<string, number[]> = { along: [1, 2, 3, 2], facing: [0.3, 2, -1], far: [4, 6, 3], bounce: [1, -1, 0], fade: [0.2, 0.4, 0.6, 0.25], light: [0.5, 0.8, 1, 1.5], halfway: [4], size: [-3] };
  for (const name of names) {
    // facing and bounce go through unit, which has no answer for the zero
    // vector (a Choice, L125b): their copies give their answers as a stream.
    const out = compiled[name](...inputs[name]) as { next?: unknown } & Iterable<unknown>;
    const want = run(name, ...inputs[name]), got = typeof out?.next === "function" ? [...out][0] : out;
    assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)), name);
  }
  // A few by hand: (1,2,3) + 2·(0.3,−0.5,1); |(4,6,3) − (1,2,3)| = 5; light clamps.
  assert.deepEqual((run("along", 1, 2, 3, 2) as { fields: number[] }).fields.map((x) => +x.toFixed(9)), [1.6, 1, 5]);
  assert.equal(run("far", 4, 6, 3), 5);
  assert.deepEqual((run("light", 0.5, 0.8, 1, 1.5) as { fields: number[] }).fields.map((x) => +x.toFixed(9)), [0.75, 1, 1]);
  assert.equal(run("halfway", 4), 7);
});

test("vectors module: on a GPU, each definition is the vector operation it describes", () => {
  const p = parts();
  const s = emitWgsl(lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { records: true }));
  assert.deepEqual([...s.refused.keys()], []);
  // plus, minus and times are the one + − ·, so their copies are named by type: plus at Vec.
  const body = (name: string, params: string) => new RegExp(`fn ${name}(?:_at_[A-Za-z]+)?_\\d+\\(${params.replace(/[()]/g, "\\$&")}\\) -> [a-z0-9]+ \\{\\n {2}`);
  const one = (name: string, params: string, ret: string) => assert.match(s.wgsl, new RegExp(body(name, params).source + ret.replace(/[()*+./]/g, "\\$&") + ";"), name);
  one("plus", "p0: vec3f, p1: vec3f", "return p0 + p1");
  // − on two points, inside distance, is the GPU's − on vec3f.
  assert.match(s.wgsl, /fn distance(?:_at_Vec)?_\d+\(p0: vec3f, p1: vec3f\) -> f32 \{\n {2}return magnitude_\d+\(p0 - p1\);/);
  one("times", "p0: vec3f, p1: vec3f", "return p0 * p1");
  one("scale", "p0: f32, p1: vec3f", "return p0 * p1");
  one("dot", "p0: vec3f, p1: vec3f", "return dot(p0, p1)");
  one("magnitude", "p0: vec3f", "return length(p0)");
  one("mix", "p0: vec3f, p1: vec3f, p2: f32", "return mix(p0, p1, p2)");
  one("clamp", "p0: vec3f, p1: f32, p2: f32", "return clamp(p0, vec3f(p1), vec3f(p2))");
  // unit scales by 1 / length, which has no answer for the zero vector (L125b).
  assert.match(s.wgsl, /fn unit_\d+\(p0: vec3f\) -> vec3f \{\n {2}let l\d+ = 1\.0 \/ magnitude_\d+\(p0\);\n {2}return p0 \* l\d+;/);
  // One copy per type it's used at: scale for Vec and for Colour (both
  // vec3f), mix for Colour and for Float64.
  assert.equal(s.funcs.filter((f) => f.name === "scale").length, 2);
  const mixes = s.funcs.filter((f) => f.name === "mix").map((f) => f.result);
  assert.equal(mixes.length, 2);
  assert.ok(mixes.includes("f64"));
});
