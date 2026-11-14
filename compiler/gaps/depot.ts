// depot (GAPS.md round 17), a day of a bike-share network simulated, in
// three ways in one process: the evaluator, the module printed from the
// core IR (`ters compile`) and the hand-written ideal (depot.ideal.js).
// Each gets the same arguments and a world whose files are in memory, and
// the comparison is what it printed and how it exited. Used by
// bench-depot.ts and test/depot.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { depot as ideal } from "./depot.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "depot");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("depot writes no files"); }, appendFile: () => { throw new Error("depot writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts). `asDefined` keeps maps, sets and lists
// as they are defined.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`depot has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "depot", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
  const r = asDefined ? plain : represented(plain, main, true);
  return { code: r.code, info: r.info, names: r.names, main, chosen: (r as { chosen?: string[] }).chosen ?? [] };
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

// A made-up city: n stations on a grid 600 m apart with some jitter, each
// with 10 to 20 docks half full, and from each station riders to three
// others, the town's centre the busiest, under the sample's profile.
export function city(n: number, seed = 7): string {
  let s = seed;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const side = Math.ceil(Math.sqrt(n));
  const lines = ["# made-up city: station name docks bikes x y (km)"];
  for (let i = 0; i < n; i++) {
    const docks = 10 + Math.floor(r() * 11);
    const x = (i % side) * 0.6 + r() * 0.2, y = Math.floor(i / side) * 0.6 + r() * 0.2;
    lines.push(`station s${i} ${docks} ${Math.floor(docks / 2)} ${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      let j = Math.floor(r() * n);
      if (j === i) j = (j + 1) % n;
      lines.push(`demand s${i} s${j} ${(1 + Math.floor(r() * 5)).toString()}`);
    }
  lines.push("profile 0.05 0.02 0.02 0.02 0.05 0.15 0.45 0.9 1.0 0.6 0.4 0.4 0.5 0.45 0.4 0.45 0.7 1.0 0.85 0.55 0.4 0.3 0.2 0.1");
  return lines.join("\n") + "\n";
}
