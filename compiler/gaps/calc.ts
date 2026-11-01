// calc three ways, in one process: the evaluator, the compiler's output, and
// the hand-written ideal (calc.ideal.js). Each gets the same input as a
// text and collects what it prints, so the comparison is the program's own
// work, not Node's start-up or the console. Used by bench.ts and by
// test/calc.test.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { load } from "../src/program.ts";
import { $setPrint, $setWorld, $Aborted } from "../src/runtime.js";
import { calc as ideal } from "./calc.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (input: string) => Run;

const world = (input: string, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => input, readLine: () => null,
  readFile: () => { throw new Error("no files"); }, writeFile: () => {}, appendFile: () => {}, fileExists: () => false, listFolder: () => [],
});

export async function ways(): Promise<Record<"evaluator" | "compiled" | "ideal", Way>> {
  const p = load("calc");
  const main = p.named("main");
  const path = join(mkdtempSync(join(tmpdir(), "calc-")), "calc.js");
  writeFileSync(path, compile(p.code, p.info, p.pres.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs.main as () => number;
  return {
    evaluator: (input) => {
      const out: string[] = [], err: string[] = [];
      const code = runProgram(p.code, p.info, main, [], { print: (s) => out.push(s), names: p.pres.names, world: world(input, err) });
      return { out, err, code };
    },
    compiled: (input) => {
      const out: string[] = [], err: string[] = [];
      $setPrint((s: string) => out.push(s));
      $setWorld(world(input, err));
      let code: number;
      try { code = Number(compiled()); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
      return { out, err, code };
    },
    ideal: (input) => {
      const out: string[] = [], err: string[] = [];
      const code = ideal(input, (s: string) => out.push(s), (s: string) => err.push(s));
      return { out, err, code };
    },
  };
}

// A session of random lines: a few names defined, then expressions up to
// five levels deep with every operator, some of them redefining a name.
// Some divide by zero, so the error path runs too.
export function session(lines: number, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const ex = (d: number): string => {
    if (d === 0 || rnd() % 3 === 0) return rnd() % 5 === 0 ? `v${rnd() % 20}` : String(rnd() % 1000);
    const o = ["+", "-", "*", "/", "%"][rnd() % 5];
    const a = ex(d - 1), b = ex(d - 1);
    return rnd() % 2 ? `(${a} ${o} ${b})` : `${a} ${o} ${o === "/" || o === "%" ? `(${b} + 1001)` : b}`;
  };
  const out: string[] = [];
  for (let i = 0; i < 20; i++) out.push(`let v${i} = ${i + 1}`);
  for (let i = 0; i < lines; i++) out.push(rnd() % 10 === 0 ? `let v${rnd() % 20} = ${ex(4)}` : ex(5));
  return out.join("\n") + "\n";
}

// Inputs that find each way's limits.
export const deep = (depth: number) => "(".repeat(depth) + "1" + ")".repeat(depth);
export const long = (terms: number) => Array(terms).fill("1").join(" + ");
