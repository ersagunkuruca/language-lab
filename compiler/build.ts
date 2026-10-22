// Compiles the example programs of projectional/examples to out/*.js.
// Run: node build.ts   (or npm run build)

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileProgram, load } from "./src/program.ts";
import { lowerScalar } from "./src/scalar.ts";
import { emitWasm } from "./src/wasm.ts";
import { emitWgsl } from "./src/wgsl.ts";

const programs: Record<string, string[]> = {
  queens: ["main", "queens"],
  algebra: ["main"],
  relations: ["main", "split", "to polar", "square roots"],
  backwards: ["main"],
  calculus: ["main"],
  calc: ["main"],
  countdown: ["main", "solutions"],
  chapters: ["main"],
};

for (const [name, exports] of Object.entries(programs)) {
  const source = compileProgram(name, exports, "../src/runtime.js");
  writeFileSync(join(import.meta.dirname, "out", `${name}.js`), source);
  console.log(`out/${name}.js: ${source.split("\n").length} lines`);
}

// The scalar part of calculus, as WebAssembly text, for reading.
const calculus = load("calculus");
const scalar = lowerScalar(calculus.code, calculus.info, calculus.pres.names, calculus.own.defs);
const wasm = emitWasm(scalar);
writeFileSync(join(import.meta.dirname, "out", "calculus.wat"), wasm.wat);
console.log(`out/calculus.wat: ${wasm.exports.join(", ")}`);

// And as WGSL, for the GPU.
const wgsl = emitWgsl(scalar);
writeFileSync(join(import.meta.dirname, "out", "calculus.wgsl"), wgsl.wgsl);
console.log(`out/calculus.wgsl: ${wgsl.funcs.map((f) => f.name).join(", ")}`);
