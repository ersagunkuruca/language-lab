// machine in its ways, in one process: the evaluator on the program as
// defined; the core IR's JavaScript on the program as `ters compile` stores
// it (the chooser's representations); the WebAssembly the program lowers
// to, run as a WASI command; and the hand-written ideal
// (machine.ideal.js). Each gets the same arguments and the same files,
// and the comparison is what it printed and how it exited. Used by
// bench-machine.ts and test/machine.test.ts. The C way (ters native) is in
// bench-machine.ts, since it builds with $CC.

import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WASI } from "node:wasi";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { load } from "../src/program.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm } from "../src/wasm.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { machine as ideal } from "./machine.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "wasm" | "ideal";
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

// The program with the representations the chooser picks: `hostMaps` where
// std's Table is (compiled JavaScript), not for WebAssembly and C, which
// take what `ters native` takes (C93): their own tables (C63h to C63k).
function chosenFor(p: ReturnType<typeof load>, own: string[], main: string, hostMaps: boolean) {
  const options = p.options as Parameters<typeof infer>[3];
  const lib = withLibraryRepresentations(p.code, p.info, p.pres.names, main, own, [], { hostMaps, tables: !hostMaps });
  const info = infer(lib.code, lib.names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) throw new Error(`machine on ${lib.chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { code: lib.code, info, names: lib.names, chosen: lib.chosen };
}

export function programs() {
  const p = load(NAME);
  const own: string[] = JSON.parse(readFileSync(join(folder, "code.json"), "utf8")).defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  return { p, own, main, plain: { code: p.code, info: p.info, names: p.pres.names }, chosen: chosenFor(p, own, main, true) };
}

// The program as a WASI command (compiler/wasi.ts), with the chooser's
// representations, or why it can't be one.
export async function wasmModule(): Promise<WebAssembly.Module | string> {
  const { p, own, main } = programs();
  try {
    const c = chosenFor(p, own, main, false);
    const m = emitWasm(lowerScalar(c.code, c.info, c.names, own, { data: true }), { wasi: true });
    return await WebAssembly.compile(m.bytes);
  } catch (e) { return (e as Error).message; }
}

export async function ways(): Promise<Record<Name, Way> & { chosen: string[]; wasmProblem?: string }> {
  const { main, plain, chosen } = programs();
  const dir = mkdtempSync(join(tmpdir(), "machine-"));
  const wasm = await wasmModule();
  // Printed from the core IR (C137d19).
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const coreRun = coreMain(lowerCore(chosen.code, chosen.info, chosen.names, [main]), "main", rt);
  return {
    chosen: chosen.chosen,
    wasmProblem: typeof wasm === "string" ? wasm : undefined,
    evaluator: (args, files) => {
      const printed: string[] = [], err: string[] = [];
      const code = runProgram(plain.code, plain.info, main, args, { print: (s) => printed.push(s + "\n"), names: plain.names, world: world(files, err) });
      return { out: lines(printed), err, code };
    },
    core: (args, files) => {
      const printed: string[] = [], err: string[] = [];
      rt.print = (s) => printed.push(s + "\n");
      rt.world = world(files, err);
      const code = coreRun(args);
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
