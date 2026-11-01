// notebook in six ways, in one process: the evaluator and the compiler's
// output on the program as defined (maps as their sorted lists), the
// evaluator and the compiled code on the weight-balanced trees the chooser
// picks, the compiled code with Map as a hash table where it may be one
// (C63b), and the hand-written ideal (notebook.ideal.js). Each gets the same
// arguments and a world whose files are kept in memory, and the comparison
// is what it printed and how it exited. Used by bench-notebook.ts and by
// test/notebook.test.ts.

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
import { notebook as ideal } from "./notebook.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "evaluator, trees" | "compiled" | "compiled, trees" | "compiled, table" | "ideal";

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("notebook writes no files"); }, appendFile: () => { throw new Error("notebook writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

export function programs() {
  const p = load("notebook");
  const own: string[] = JSON.parse(readFileSync(join(examples, "notebook/code.json"), "utf8")).defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const options = p.options as Parameters<typeof infer>[3];
  const chosen = (hostMaps: boolean) => {
    const lib = withLibraryRepresentations(p.code, p.info, p.pres.names, main, own, [], { hostMaps });
    const info = infer(lib.code, lib.names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
    if (info.errors.length) throw new Error(`notebook on ${lib.chosen.join(", ")}: ${info.errors.map((e) => e.message).join("; ")}`);
    return { code: lib.code, info, names: lib.names, chosen: lib.chosen };
  };
  return { main, plain: { code: p.code, info: p.info, names: p.pres.names, chosen: [] as string[] }, trees: chosen(false), table: chosen(true) };
}

export async function ways(): Promise<Record<Name, Way> & { chosen: Record<string, string[]> }> {
  const { main, plain, trees, table } = programs();
  const dir = mkdtempSync(join(tmpdir(), "notebook-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  const built = async (p: typeof plain, file: string) => {
    writeFileSync(join(dir, file), compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
    return (await import(pathToFileURL(join(dir, file)).href)).defs.main as (args: unknown) => number;
  };
  const evaluator = (p: typeof plain): Way => (args, files) => {
    const out: string[] = [], err: string[] = [];
    const code = runProgram(p.code, p.info, main, args, { print: (s) => out.push(s), names: p.names, world: world(files, err) });
    return { out, err, code };
  };
  const compiled = (f: (args: unknown) => number): Way => (args, files) => {
    const out: string[] = [], err: string[] = [];
    $setPrint((s: string) => out.push(s));
    $setWorld(world(files, err));
    let code: number;
    try { code = Number(f($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
    return { out, err, code };
  };
  return {
    chosen: { trees: trees.chosen, table: table.chosen },
    evaluator: evaluator(plain),
    "evaluator, trees": evaluator(trees),
    compiled: compiled(await built(plain, "notebook.js")),
    "compiled, trees": compiled(await built(trees, "notebook-trees.js")),
    "compiled, table": compiled(await built(table, "notebook-table.js")),
    ideal: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = ideal(args, { readFile: reader(files), print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code };
    },
  };
}

// Made-up notes: `notes` notes of 10 to 40 words each, drawn from a
// vocabulary of `words` made-up words with a few very common ones (Zipf-like:
// word r is drawn about 1/r as often), some capitalised or ending in
// punctuation or a plural s; then `questions` questions, a fifth each of
// find (one to three words), any, like and seen.
export function notes(count: number, questions = 100, words = 2000, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const letters = "bcdfghklmnprstvz", vowels = "aeiou";
  const word = (i: number) => {
    let s = "", x = i;
    for (let j = 0; j < 3; j++) { s += letters[x % 16] + vowels[(x >> 4) % 5]; x = Math.floor(x / 80); if (!x && j) break; }
    return s;
  };
  // A Zipf-like draw: r = floor(words^u) for u uniform in [0, 1).
  const draw = () => Math.floor(Math.pow(words, (rnd() % 100000) / 100000));
  const stops = ["the", "of", "and", "a", "to", "in", "is"];
  const name = (i: number) => `n${i}`;
  const out = ["# made-up notes"];
  for (let i = 0; i < count; i++) {
    const n = 10 + (rnd() % 31), ws: string[] = [];
    for (let j = 0; j < n; j++) {
      if (rnd() % 5 === 0) { ws.push(stops[rnd() % stops.length]); continue; }
      let w = word(draw());
      const k = rnd() % 20;
      if (k === 0) w = w[0].toUpperCase() + w.slice(1);
      else if (k === 1) w += ",";
      else if (k === 2) w += ".";
      else if (k === 3) w += "s";
      ws.push(w);
    }
    out.push(`note ${name(i)} ${ws.join(" ")}`);
  }
  out.push("");
  for (let i = 0; i < questions; i++) {
    const kind = i % 4;
    if (kind === 0) out.push(`find ${Array.from({ length: 1 + (rnd() % 3) }, () => word(draw())).join(" ")}`);
    else if (kind === 1) out.push(`any ${Array.from({ length: 1 + (rnd() % 3) }, () => word(draw())).join(" ")}`);
    else if (kind === 2) out.push(`like ${name(rnd() % count)}`);
    else out.push(`seen ${word(draw())}`);
  }
  return out.join("\n") + "\n";
}
