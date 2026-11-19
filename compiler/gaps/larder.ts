// larder (GAPS.md round 20), recipes scaled with exact fractions, their
// lines read by running printers backwards, in three ways in one process: the evaluator, the module printed from the
// core IR (`ters compile`) and the hand-written ideal (larder.ideal.js).
// Each gets the same arguments and a world whose files are in memory, and
// the comparison is what it printed and how it exited. Used by
// bench-larder.ts and test/larder.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { larder as ideal } from "./larder.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "larder");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("larder writes no files"); }, appendFile: () => { throw new Error("larder writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts). `asDefined` keeps maps, sets and lists
// as they are defined.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`larder has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "larder", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
  const r = asDefined ? plain : represented(plain, main, true);
  return { code: r.code, info: r.info, names: r.names, main };
}

export async function ways(): Promise<Record<Name, Way>> {
  const p = program();
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const fromCore = coreMain(lowerCore(p.code, p.info, p.names, [p.main]), "main", rt);
  return {
    evaluator: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = runProgram(p.code, p.info, p.main, args, { print: (s) => out.push(s), names: p.names, world: world(files, err) });
      return { out, err, code };
    },
    core: (args, files) => {
      const out: string[] = [], err: string[] = [];
      rt.print = (s) => out.push(s);
      rt.world = world(files, err);
      return { out, err, code: fromCore(args) };
    },
    ideal: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = ideal(args, { readFile: reader(files), print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code };
    },
  };
}

// A made-up book: `recipes` recipes of 4 to 7 foods each from 3 · recipes /
// 2 foods (measured by volume, by weight or by count), the units of a
// kitchen, half the foods in the larder, `packs` pack sizes for sale of
// each food, and every recipe made for 1 to 12.
export function book(recipes: number, packs = 3, seed = 1): string {
  let r = seed;
  const rnd = (n: number) => (r = (r * 48271) % 2147483647) % n;
  const out = ["# a made-up book", "unit tsp", "unit tbsp 3 tsp", "unit cup 16 tbsp", "unit g", "unit kg 1000 g", "unit each"];
  const foods = Math.max(4, Math.floor((3 * recipes) / 2));
  const kind = (f: number) => f % 3; // 0 volume, 1 weight, 2 count
  const amounts = [["1/4 tsp", "1/2 tsp", "1 tsp", "1 1/2 tsp", "1 tbsp", "2 tbsp", "1/3 cup", "1/2 cup", "3/4 cup", "1 cup", "1 1/2 cup", "2 cup"], ["25 g", "50 g", "100 g", "125 g", "200 g", "250 g", "1/2 kg", "1 kg"], ["1 each", "2 each", "3 each", "4 each"]];
  const packSizes = [["1/2 cup", "1 cup", "2 cup", "4 cup", "10 cup", "1/4 cup"], ["100 g", "250 g", "1/2 kg", "1 kg", "2 kg", "50 g"], ["1 each", "6 each", "12 each", "4 each", "10 each", "30 each"]];
  for (let i = 0; i < recipes; i++) {
    out.push("", `recipe dish${i} ${1 + rnd(8)}`);
    const used = new Set<number>();
    const n = Math.min(foods, 4 + rnd(4));
    while (used.size < n) used.add(rnd(foods));
    for (const f of used) out.push(`${amounts[kind(f)][rnd(amounts[kind(f)].length)]} food${f}`);
  }
  out.push("");
  for (let f = 0; f < foods; f += 2) out.push(`have ${amounts[kind(f)][rnd(amounts[kind(f)].length)]} food${f}`);
  out.push("");
  for (let f = 0; f < foods; f++) for (let k = 0; k < packs; k++) out.push(`sell ${packSizes[kind(f)][k % 6]} food${f}`);
  out.push("");
  for (let i = 0; i < recipes; i++) out.push(`make dish${i} ${1 + rnd(12)}`);
  return out.join("\n") + "\n";
}
