// rota (GAPS.md round 14), a staff rota found by a Choice search, in
// three ways in one process: the evaluator, the module printed from the
// core IR (`ters compile`) and the hand-written ideal (rota.ideal.js).
// Each gets the same arguments and a world whose files are in memory, and
// the comparison is what it printed and how it exited. Used by
// bench-rota.ts and test/rota.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { rota as ideal } from "./rota.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "rota");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("rota writes no files"); }, appendFile: () => { throw new Error("rota writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts). `asDefined` keeps maps, sets and lists
// as they are defined.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`rota has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "rota", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
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

// A made-up plan: `days` days, three shifts (early 2, late 2, night 1),
// `people` people who can each work two or three of them and work at most
// five shifts a week (pro rata), a few days off each, and no early shift
// after a night.
export function plan(days: number, people: number, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const dayNames = Array.from({ length: days }, (_, i) => `d${i + 1}`);
  const out = ["# a made-up plan", `days ${dayNames.join(" ")}`, "shift early 2", "shift late 2", "shift night 1"];
  const kinds = [["early", "late"], ["early", "late", "night"], ["late", "night"], ["early", "night"], ["early", "late"]];
  const most = Math.max(1, Math.round((days * 5) / 7));
  for (let i = 0; i < people; i++) out.push(`person p${String(i + 1).padStart(2, "0")} ${most + (rnd() % 2)} ${kinds[rnd() % kinds.length].join(" ")}`);
  for (let i = 0; i < people; i++) if (rnd() % 3 === 0) out.push(`off p${String(i + 1).padStart(2, "0")} ${dayNames[rnd() % days]}`);
  out.push("rest night early");
  return out.join("\n") + "\n";
}
