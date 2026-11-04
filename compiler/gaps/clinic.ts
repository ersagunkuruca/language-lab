// clinic (GAPS.md round 10), a walk-in clinic simulation written in the
// editor, in four ways: the evaluator (`lab run`), the compiled module
// (`lab compile --compile-ts`), the one printed from the core IR (`lab
// compile --core`, C137d19) and the hand-written ideal (clinic.ideal.js). Each runs in
// a folder holding a clinic.txt that sets the hours the clinic is open (the
// rest is the program's default config), and the comparison is what it
// printed and the clinic.csv it wrote (the ideal writes no file). Used by
// bench-clinic.ts and test/clinic.test.ts.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clinic, defaultConfig } from "./clinic.ideal.js";

export type Name = "evaluator" | "compiled" | "core" | "ideal";
export interface Run { out: string[]; csv: string | null; ms: number }
export const folder = join(import.meta.dirname, "clinic");
const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
const dir = mkdtempSync(join(tmpdir(), "clinic-"));
const modules: Record<string, string> = {};

function at(hours: number) {
  const d = mkdtempSync(join(dir, "run-"));
  writeFileSync(join(d, "clinic.txt"), `# round 10\nhours ${hours}\n`);
  return d;
}
function node(args: string[], cwd: string): Run {
  const t = performance.now();
  const out = execFileSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  const ms = performance.now() - t;
  const csv = existsSync(join(cwd, "clinic.csv")) ? readFileSync(join(cwd, "clinic.csv"), "utf8") : null;
  return { out: out.replace(/\n$/, "").split("\n"), csv, ms };
}
export function compiledModule(way: "--compile-ts" | "--core" = "--compile-ts"): string {
  if (!modules[way]) { modules[way] = join(dir, `clinic${way}.mjs`); execFileSync(process.execPath, [lab, "compile", folder, way, "-o", modules[way]], { stdio: "ignore" }); }
  return modules[way];
}
export const ways: Record<Name, (hours: number) => Run> = {
  evaluator: (hours) => node([lab, "run", folder], at(hours)),
  compiled: (hours) => node([compiledModule()], at(hours)),
  core: (hours) => node([compiledModule("--core")], at(hours)),
  ideal: (hours) => { const t = performance.now(); const out = clinic({ ...defaultConfig, hours }); return { out, csv: null, ms: performance.now() - t }; },
};
