// bazaar (GAPS.md round 23), a small relational database whose questions
// are data, planned (filters pushed below joins, hash joins filing the
// smaller side) and run, in three ways in one process: the evaluator, the
// module printed from the core IR and the hand-written ideal
// (bazaar.ideal.js). Each gets the same arguments, and the comparison is
// what it printed, on standard output and standard error, and how it
// exited. Used by bench-bazaar.ts and test/bazaar.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { bazaar } from "./bazaar.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[]) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "bazaar");

const world = (err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: () => { throw new Error("bazaar reads no files"); }, writeFile: () => { throw new Error("bazaar writes no files"); }, appendFile: () => { throw new Error("bazaar writes no files"); },
  fileExists: () => false, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts).
export function program() {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`bazaar has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const r = represented({ title: "bazaar", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options }, main, true);
  return { code: r.code, info: r.info, names: r.names, main };
}

export async function ways(): Promise<Record<Name, Way>> {
  const p = program();
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const fromCore = coreMain(lowerCore(p.code, p.info, p.names, [p.main]), "main", rt);
  return {
    evaluator: (args) => {
      const out: string[] = [], err: string[] = [];
      const code = runProgram(p.code, p.info, p.main, args, { print: (s) => out.push(s), names: p.names, world: world(err) });
      return { out, err, code };
    },
    core: (args) => {
      const out: string[] = [], err: string[] = [];
      rt.print = (s) => out.push(s);
      rt.world = world(err);
      return { out, err, code: fromCore(args) };
    },
    ideal: (args) => {
      const out: string[] = [], err: string[] = [];
      const code = bazaar(args, (s) => out.push(s), (s) => err.push(s));
      return { out, err, code };
    },
  };
}
