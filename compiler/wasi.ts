// An example program as a WASI command: WebAssembly with GC that needs no
// JavaScript, its console and files over wasi_snapshot_preview1
// (src/wasm-rt.ts), so wasmtime runs it as it is.
//
//   node wasi.ts wc out/wc.wasm   (or npm run wasi -- wc out/wc.wasm)
//   wasmtime -W gc=y,function-references=y,tail-call=y --dir . out/wc.wasm a.txt
//
// It also writes the text version next to it (out/wc.wat). Paths the
// program uses are relative to the folder it's given (--dir).

import { writeFileSync } from "node:fs";
import { load } from "./src/program.ts";
import { lowerScalar } from "./src/scalar.ts";
import { emitWasm } from "./src/wasm.ts";

const [name, out = `out/${process.argv[2]}.wasm`] = process.argv.slice(2);
if (!name) throw new Error("usage: node wasi.ts <example> [out.wasm]");
const p = load(name);
const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true });
const main = p.named("main");
if (!lowered.funcs.some((f) => f.def === main)) throw new Error(`${name}'s main doesn't compile: ${lowered.refused.get(main)}`);
const m = emitWasm(lowered, { wasi: true });
writeFileSync(out, m.bytes);
writeFileSync(out.replace(/\.wasm$/, ".wat"), m.wat);
console.log(`wrote ${out} (${m.bytes.length} bytes)`);
