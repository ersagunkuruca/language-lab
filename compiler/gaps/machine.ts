// machine in its ways, in one process: the evaluator on the program as
// defined; the compiler's output on the program as `lab compile` stores
// it (the chooser's representations); the WebAssembly the program lowers
// to, run as a WASI command; and the hand-written ideal
// (machine.ideal.js). Each gets the same arguments and the same files,
// and the comparison is what it printed and how it exited. Used by
// bench-machine.ts and test/machine.test.ts. The C way (lab native) is in
// bench-machine.ts, since it builds with $CC.

import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { WASI } from "node:wasi";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { compile } from "../src/compile.ts";
import { load } from "../src/program.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm } from "../src/wasm.ts";
import { $setPrint, $setWorld, $Aborted, $toList } from "../src/runtime.js";
import { machine as ideal } from "./machine.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "compiled" | "wasm" | "ideal";
export const NAME = "../../compiler/gaps/machine";
export const folder = join(import.meta.dirname, "machine");

// The five programs in the folder, and the four that take a size made
// bigger or smaller: the sieve's n, the number of items sorted, which
// Fibonacci number, the starts below which Collatz chains are counted.
export const source = (name: string) => readFileSync(join(folder, `${name}.asm`), "utf8");
export function sized(name: "primes" | "sort" | "fib" | "collatz", n: number): string {
  const t = source(name);
  return name === "fib" ? t.replace("set r1 20", `set r1 ${n}`) : t.replaceAll({ primes: "5000", sort: "400", collatz: "3000" }[name], String(n));
}

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("machine writes no file"); }, appendFile: () => { throw new Error("machine writes no file"); },
  fileExists: (p) => p in files, listFolder: () => [],
});
const lines = (printed: string[]) => printed.join("").split("\n").filter((l, i, all) => l !== "" || i < all.length - 1);

export function programs() {
  const p = load(NAME);
  const own: string[] = JSON.parse(readFileSync(join(folder, "code.json"), "utf8")).defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const options = p.options as Parameters<typeof infer>[3];
  const lib = withLibraryRepresentations(p.code, p.info, p.pres.names, main, own, [], { hostMaps: true });
  const info = infer(lib.code, lib.names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) throw new Error(`machine on ${lib.chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { p, main, plain: { code: p.code, info: p.info, names: p.pres.names }, chosen: { code: lib.code, info, names: lib.names, chosen: lib.chosen } };
}

// The program as a WASI command (compiler/wasi.ts), or why it can't be one.
export async function wasmModule(): Promise<WebAssembly.Module | string> {
  const p = load(NAME);
  try {
    const m = emitWasm(lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true }), { wasi: true });
    return await WebAssembly.compile(m.bytes);
  } catch (e) { return (e as Error).message; }
}

export async function ways(): Promise<Record<Name, Way> & { chosen: string[]; wasmProblem?: string }> {
  const { main, plain, chosen } = programs();
  const dir = mkdtempSync(join(tmpdir(), "machine-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  writeFileSync(join(dir, "machine.js"), compile(chosen.code, chosen.info, chosen.names, { runtime, exports: ["main"] }));
  const compiledMain = (await import(pathToFileURL(join(dir, "machine.js")).href)).defs.main as (args: unknown) => number;
  const wasm = await wasmModule();
  return {
    chosen: chosen.chosen,
    wasmProblem: typeof wasm === "string" ? wasm : undefined,
    evaluator: (args, files) => {
      const printed: string[] = [], err: string[] = [];
      const code = runProgram(plain.code, plain.info, main, args, { print: (s) => printed.push(s + "\n"), names: plain.names, world: world(files, err) });
      return { out: lines(printed), err, code };
    },
    compiled: (args, files) => {
      const printed: string[] = [], err: string[] = [];
      $setPrint((s: string) => printed.push(s + "\n"));
      $setWorld(world(files, err));
      let code: number;
      try { code = Number(compiledMain($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
      return { out: lines(printed), err, code };
    },
    wasm: (args, files) => {
      if (typeof wasm === "string") throw new Error(`machine's WebAssembly doesn't load: ${wasm}`);
      const run = mkdtempSync(join(dir, "wasi-"));
      for (const [name, text] of Object.entries(files)) writeFileSync(join(run, name), text);
      const out = openSync(join(run, ".out"), "w"), errOut = openSync(join(run, ".err"), "w");
      const wasi = new WASI({ version: "preview1", args: ["machine", ...args], preopens: { ".": run }, stdout: out, stderr: errOut, returnOnExit: true });
      const code = wasi.start(new WebAssembly.Instance(wasm, wasi.getImportObject() as WebAssembly.Imports));
      closeSync(out); closeSync(errOut);
      const text = (f: string) => readFileSync(join(run, f), "utf8").split("\n").filter((l, i, all) => l !== "" || i < all.length - 1);
      return { out: text(".out"), err: text(".err"), code };
    },
    ideal: (args, files) => {
      const printed: string[] = [], err: string[] = [];
      const code = ideal(args, { readFile: reader(files), print: (s: string) => printed.push(s + "\n"), printError: (s: string) => err.push(s) });
      return { out: lines(printed), err, code };
    },
  };
}
