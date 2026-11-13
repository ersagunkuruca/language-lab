// trek (GAPS.md round 16), a hiking track analyzer whose numbers carry
// units (metres, seconds, joules), in three ways in one process: the
// evaluator, the module printed from the core IR (`ters compile`) and the
// hand-written ideal (trek.ideal.js).
// Each gets the same arguments and a world whose files are in memory, and
// the comparison is what it printed and how it exited. Used by
// bench-trek.ts and test/trek.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { trek as ideal } from "./trek.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "trek");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("trek writes no files"); }, appendFile: () => { throw new Error("trek writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts). `asDefined` keeps maps, sets and lists
// as they are defined.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`trek has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "trek", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
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

// A made-up hike: n fixes 10 s apart over hills, the walker standing
// still now and then (GPS drift moves them a little), heights with up to
// 3 m of noise.
export function track(n: number, seed = 11): string {
  let s = seed;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const lines = ["# made-up hike: seconds, latitude, longitude, height"];
  let t = 0, lat = 46.5, lon = 7.9, along = 0;
  for (let i = 0; i < n; i++) {
    const h = 1500 + 400 * Math.sin(along / 2500) + 120 * Math.sin(along / 600) + (r() - 0.5) * 6;
    lines.push(`${t} ${lat.toFixed(6)} ${lon.toFixed(6)} ${h.toFixed(1)}`);
    const step = i % 97 > 90 ? r() * 1.5 : 9 + r() * 6;
    const dir = Math.sin(i / 50) * 1.2;
    lat += (step * Math.cos(dir)) / 111195;
    lon += (step * Math.sin(dir)) / (111195 * Math.cos((lat * Math.PI) / 180));
    along += step; t += 10;
  }
  return lines.join("\n") + "\n";
}
