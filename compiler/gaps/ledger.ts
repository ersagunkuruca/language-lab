// ledger three ways, in one process: the evaluator, the compiler's output,
// and the hand-written ideal (ledger.ideal.js). Each gets the same
// arguments and a world whose files are kept in memory, and the comparison
// is what it printed and how it exited. Used by bench-ledger.ts and by
// test/ledger.test.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProgram, type World } from "../../projectional/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { load } from "../src/program.ts";
import { $setPrint, $setWorld, $Aborted, $toList } from "../src/runtime.js";
import { ledger as ideal } from "./ledger.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("ledger writes no files"); }, appendFile: () => { throw new Error("ledger writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

export async function ways(): Promise<Record<"evaluator" | "compiled" | "ideal", Way>> {
  const p = load("ledger");
  const main = p.named("main");
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.js");
  writeFileSync(path, compile(p.code, p.info, p.pres.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs.main as (args: unknown) => number;
  return {
    evaluator: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = runProgram(p.code, p.info, main, args, { print: (s) => out.push(s), names: p.pres.names, world: world(files, err) });
      return { out, err, code };
    },
    compiled: (args, files) => {
      const out: string[] = [], err: string[] = [];
      $setPrint((s: string) => out.push(s));
      $setWorld(world(files, err));
      let code: number;
      try { code = Number(compiled($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
      return { out, err, code };
    },
    ideal: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = ideal(args, { readFile: reader(files), print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code };
    },
  };
}

// A year of made-up entries: `accounts` accounts, salaries in, everything
// else out, a comment line and some blank lines, amounts from 1 cent up.
export function book(entries: number, accounts = 40, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const names = Array.from({ length: accounts }, (_, i) => (i === 0 ? "salary" : `${["food", "café", "rent", "travel", "books", "gifts", "power", "phone"][i % 8]}-${i}`));
  const out = ["# date,account,cents,memo"];
  for (let i = 0; i < entries; i++) {
    if (rnd() % 50 === 0) out.push("");
    const a = names[rnd() % accounts], m = 1 + (rnd() % 12), d = 1 + (rnd() % 28);
    const cents = a === "salary" ? 300000 + (rnd() % 100000) : -(1 + (rnd() % 20000));
    out.push(`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")},${a},${cents},entry ${i}`);
  }
  return out.join("\n") + "\n";
}
