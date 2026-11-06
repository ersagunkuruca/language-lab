// break (GAPS.md round 12), a pool break played out event by event, in
// three ways in one process: the evaluator, the module printed from the
// core IR (`lab compile`) and the hand-written ideal (break.ideal.js). Each
// prints main's lines; the comparison is what they print and how long main
// takes. Used by bench-break.ts and test/break.test.ts.

import { join } from "node:path";
import { runProgram } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { main as ideal } from "./break.ideal.js";

export type Name = "evaluator" | "core" | "ideal";
export const folder = join(import.meta.dirname, "break");

// The program with its types stored the way `lab run` and `lab compile`
// choose (ters/cli/represented.ts).
export function program() {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`break has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "break", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
  const r = represented(plain, main, true);
  return { code: r.code, info: r.info, names: r.names, main };
}

// Each way: main's lines, as printed (a print of several lines split).
export function ways(): Record<Name, () => string[]> {
  const p = program();
  let out: string[] = [];
  const rt = { print: (s: string) => out.push(...s.split("\n")) };
  const fromCore = coreMain(lowerCore(p.code, p.info, p.names, [p.main]), "main", rt);
  return {
    evaluator: () => { out = []; runProgram(p.code, p.info, p.main, [], { print: rt.print, names: p.names }); return out; },
    core: () => { out = []; fromCore([]); return out; },
    ideal: () => ideal(),
  };
}
