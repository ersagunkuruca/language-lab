// The structs a WASI command makes, by the place that makes them (C327g):
// a program built with TERS_COUNT_MAKES=1 (`ters wasi`, which writes
// <out>.made.json beside it naming each place) run under Node's WASI in
// this folder, its output passed through, then the total and the places
// that made the most on stderr.
//
//   TERS_COUNT_MAKES=1 node ters/cli/ters.ts wasi compiler/gaps/strings -o s.wasm
//   node compiler/gaps/made.ts s.wasm 8          (TOP=n places, 20 by default)

import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { wasiImports } from "../src/wasi-imports.ts";

export function made(wasm: string, args: string[], dir = ".", stdout?: number): { code: number; total: number; places: [string, number][] } {
  const names = JSON.parse(readFileSync(`${wasm}.made.json`, "utf8")) as string[];
  const w = new WASI({ version: "preview1", args: ["p", ...args], preopens: { ".": dir }, ...(stdout !== undefined ? { stdout } : {}), returnOnExit: true });
  const i = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasm)), wasiImports(w));
  const code = w.start(i);
  const places = names.map((n, k): [string, number] => [n, Number((i.exports[`made.${k}`] as WebAssembly.Global).value)]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  return { code, total: places.reduce((n, [, c]) => n + c, 0), places };
}

if (import.meta.main) {
  const [wasm, ...args] = process.argv.slice(2);
  if (!wasm) { console.error("usage: node compiler/gaps/made.ts <program.wasm> [arguments…]"); process.exit(2); }
  const r = made(wasm, args);
  console.error(`structs made: ${r.total}`);
  for (const [n, c] of r.places.slice(0, Number(process.env.TOP ?? 20))) console.error(`${String(c).padStart(14)}  ${n}`);
  process.exitCode = r.code;
}
