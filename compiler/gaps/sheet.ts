// sheet in five ways, in one process: the evaluator and the compiler's
// output on the program as defined (maps as their sorted lists), the same
// two on the program as `lab run` and `lab compile` store it (the chooser's
// representations, Map as a hash table where it may be one), and the
// hand-written ideal (sheet.ideal.js). Each gets the same arguments and a
// world whose files are kept in memory, and the comparison is what it
// printed, the report it wrote and how it exited. Used by bench-sheet.ts and
// by test/sheet.test.ts.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { compile } from "../src/compile.ts";
import { examples, load } from "../src/program.ts";
import { $setPrint, $setWorld, $Aborted, $toList } from "../src/runtime.js";
import { sheet as ideal } from "./sheet.ideal.js";

export interface Run { out: string[]; err: string[]; code: number; wrote: Record<string, string> }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "evaluator, chosen" | "compiled" | "compiled, chosen" | "ideal";

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[], wrote: Record<string, string>): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: (p, t) => { wrote[p] = t; }, appendFile: () => { throw new Error("sheet appends to no file"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

export function programs() {
  const p = load("sheet");
  const own: string[] = JSON.parse(readFileSync(join(examples, "sheet/code.json"), "utf8")).defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const options = p.options as Parameters<typeof infer>[3];
  const lib = withLibraryRepresentations(p.code, p.info, p.pres.names, main, own, [], { hostMaps: true });
  const info = infer(lib.code, lib.names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) throw new Error(`sheet on ${lib.chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
  return { main, plain: { code: p.code, info: p.info, names: p.pres.names, chosen: [] as string[] }, chosen: { code: lib.code, info, names: lib.names, chosen: lib.chosen } };
}

export async function ways(): Promise<Record<Name, Way> & { chosen: string[] }> {
  const { main, plain, chosen } = programs();
  const dir = mkdtempSync(join(tmpdir(), "sheet-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  const built = async (p: typeof plain, file: string) => {
    writeFileSync(join(dir, file), compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
    return (await import(pathToFileURL(join(dir, file)).href)).defs.main as (args: unknown) => number;
  };
  const evaluator = (p: typeof plain): Way => (args, files) => {
    const out: string[] = [], err: string[] = [], wrote: Record<string, string> = {};
    const code = runProgram(p.code, p.info, main, args, { print: (s) => out.push(s), names: p.names, world: world(files, err, wrote) });
    return { out, err, code, wrote };
  };
  const compiled = (f: (args: unknown) => number): Way => (args, files) => {
    const out: string[] = [], err: string[] = [], wrote: Record<string, string> = {};
    $setPrint((s: string) => out.push(s));
    $setWorld(world(files, err, wrote));
    let code: number;
    try { code = Number(f($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
    return { out, err, code, wrote };
  };
  return {
    chosen: chosen.chosen,
    evaluator: evaluator(plain),
    "evaluator, chosen": evaluator(chosen),
    compiled: compiled(await built(plain, "sheet.js")),
    "compiled, chosen": compiled(await built(chosen, "sheet-chosen.js")),
    ideal: (args, files) => {
      const out: string[] = [], err: string[] = [], wrote: Record<string, string> = {};
      const code = ideal(args, { readFile: reader(files), writeFile: (p: string, t: string) => { wrote[p] = t; }, print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code, wrote };
    },
  };
}

// A made-up sheet of `rows` rows and six columns, A to F, each row like a
// month of accounts: A an amount, B a running total, C a sum over the last
// few rows, D the largest of a window, E a share (sometimes divided by
// zero), F the count and average of a span. One row in `oddEvery` has a
// pair of cells that refer to each other (a cycle) and one a formula that
// can't be read.
export function sheetText(rows: number, oddEvery = 50, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const out = ["# a made-up sheet"];
  for (let i = 1; i <= rows; i++) {
    const back = Math.max(1, i - 4);
    out.push(`A${i} = ${(rnd() % 2000) - 500}`);
    out.push(i === 1 ? `B1 = A1` : `B${i} = B${i - 1} + A${i}`);
    out.push(`C${i} = sum(A${back}:A${i}) - A${back}`);
    out.push(`D${i} = max(A${back}:B${i})`);
    out.push(i % oddEvery === 7 ? `E${i} = (B${i} * 100) / (A${i} - A${i})` : `E${i} = (B${i} * 100) / (A${i} * A${i} + 1)`);
    out.push(i % oddEvery === 13 ? `F${i} = F${i} + 1` : i % oddEvery === 29 ? `F${i} = 2 + * A${i}` : `F${i} = average(C${back}:D${i}) + count(A${back}:A${i}) - -E${i}`);
  }
  return out.join("\n") + "\n";
}
