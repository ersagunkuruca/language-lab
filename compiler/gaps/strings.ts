// strings (GAPS.md round 20), six plucked strings heard by three pitch finders and
// looped, in three ways in one process: the evaluator, the module printed from the
// core IR (`ters compile`) and the hand-written ideal (strings.ideal.js).
// Each gets the same arguments and a world whose files are in memory, and
// the comparison is what it printed and how it exited. Used by
// bench-strings.ts and test/strings.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { strings } from "./strings.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "strings");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("strings writes no files"); }, appendFile: () => { throw new Error("strings writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts). `asDefined` keeps maps, sets and lists
// as they are defined.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`strings has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "strings", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
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
      out.push(...strings(blocksOf(args)));
      return { out, err, code: 0 };
    },
  };
}


// What `main` reads from its arguments: the first one when it is a whole
// number (read whole number), or 8 blocks.
export function blocksOf(args: string[]): number {
  return args.length && /^-?(0|[1-9][0-9]*)$/.test(args[0]) && args[0] !== "-0" ? Number(args[0]) : 8;
}
