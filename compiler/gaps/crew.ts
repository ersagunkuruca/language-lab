// crew (GAPS.md round 11), a crew of workers scheduling a plan of tasks,
// in four ways, in one process: the evaluator, the compiled module
// (compile.ts, `lab compile --compile-ts`), the one printed from the core
// IR (`lab compile --core`) and the hand-written ideal (crew.ideal.js).
// Each gets the same arguments and a world whose files are kept in memory,
// and the comparison is what it printed and how it exited. Used by
// bench-crew.ts and test/crew.test.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { compile } from "../src/compile.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { $setPrint, $setWorld, $Aborted, $toList } from "../src/runtime.js";
import { crew as ideal } from "./crew.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "compiled" | "core" | "ideal";
export const folder = join(import.meta.dirname, "crew");

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("crew writes no files"); }, appendFile: () => { throw new Error("crew writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `lab run` and `lab compile`
// choose: on JavaScript a Map is a hash table changed in place where it
// has one holder (C63b), else a tree. `asDefined` keeps maps and sets as
// the sorted lists they are defined as.
export function program(asDefined = false) {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`crew has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "crew", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
  const r = asDefined ? plain : represented(plain, main, true);
  return { code: r.code, info: r.info, names: r.names, main };
}

export async function ways(): Promise<Record<Name, Way>> {
  const p = program();
  const dir = mkdtempSync(join(tmpdir(), "crew-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  writeFileSync(join(dir, "crew.js"), compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const built = (await import(pathToFileURL(join(dir, "crew.js")).href)).defs.main as (args: unknown) => number;
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const fromCore = coreMain(lowerCore(p.code, p.info, p.names, [p.main]), "main", rt);
  return {
    evaluator: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = runProgram(p.code, p.info, p.main, args, { print: (s) => out.push(s), names: p.names, world: world(files, err) });
      return { out, err, code };
    },
    compiled: (args, files) => {
      const out: string[] = [], err: string[] = [];
      $setPrint((s: string) => out.push(s));
      $setWorld(world(files, err));
      let code: number;
      try { code = Number(built($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
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

// A made-up plan of `tasks` tasks in `stages` stages: each task waits for
// one to three tasks of earlier stages (so there is no cycle), takes 1 to
// 30 minutes, and the crew has `workers` workers.
export function plan(tasks: number, workers = 4, stages = 12, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const name = (i: number) => `t${i}`;
  const out = ["# a made-up plan", `workers ${workers}`];
  const per = Math.max(1, Math.ceil(tasks / stages));
  for (let i = 0; i < tasks; i++) {
    const stage = Math.floor(i / per);
    const minutes = 1 + (rnd() % 30);
    if (stage === 0) { out.push(`${name(i)} ${minutes}`); continue; }
    const needs = new Set<number>();
    const n = 1 + (rnd() % 3);
    for (let j = 0; j < n; j++) needs.add(rnd() % (stage * per));
    out.push(`${name(i)} ${minutes} after ${[...needs].map(name).join(" ")}`);
  }
  return out.join("\n") + "\n";
}
