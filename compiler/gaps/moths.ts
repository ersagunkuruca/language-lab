// moths (GAPS.md game round 1, BACKLOG G3), boids on a grid hash, in
// three ways in one process: the evaluator, the module printed from the
// core IR (`ters compile`) and the hand-written ideal (moths.ideal.js).
// Each gets the same arguments and a world whose files are in memory, and
// the comparison is what it printed and how it exited. Used by
// bench-moths.ts and test/moths.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { moths } from "./moths.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "moths");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("moths writes no files"); }, appendFile: () => { throw new Error("moths writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts). `asDefined` keeps maps, sets and lists
// as they are defined.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`moths has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "moths", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
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
      // main prints the log as one text and then the credits.
      const lines = moths(...sizesOf(args));
      out.push(lines.slice(0, -1).join("\n"), lines[lines.length - 1]);
      return { out, err, code: 0 };
    },
  };
}


// What `main` reads from its arguments: ticks (100) and moths (10,000),
// each when it is a whole number.
export function sizesOf(args: string[]): [number, number] {
  const whole = (t: string | undefined, d: number) => t !== undefined && /^-?(0|[1-9][0-9]*)$/.test(t) && t !== "-0" ? Number(t) : d;
  return [whole(args[0], 100), whole(args[1], 10000)];
}
