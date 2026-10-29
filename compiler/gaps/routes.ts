// routes in five ways, in one process: the evaluator and the compiler's
// output, each on the program as defined (maps and sets as their sorted
// lists) and on the tree representation, and the hand-written ideal
// (routes.ideal.js). Each gets the same arguments and a world whose files
// are kept in memory, and the comparison is what it printed and how it
// exited. Used by bench-routes.ts and by test/routes.test.ts.
//
// `lab run` and the editor's Run refuse routes today (GAPS.md R1): the
// chooser picks the trees, but the program's own record types keep fields
// typed Map and Set. The "tree" ways here do what R1 proposes, rewriting
// those types too, so the trees can be measured before R1 is fixed.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProgram, type World } from "../../projectional/src/lang/run.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { withLibraryRepresentations } from "../../projectional/src/lang/library-reps.ts";
import { compile } from "../src/compile.ts";
import { examples, load } from "../src/program.ts";
import { $setPrint, $setWorld, $Aborted, $toList } from "../src/runtime.js";
import { routes as ideal } from "./routes.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, string>) => Run;
export type Name = "evaluator" | "evaluator, trees" | "compiled" | "compiled, trees" | "ideal";

function reader(files: Record<string, string>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, string>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: reader(files), writeFile: () => { throw new Error("routes writes no files"); }, appendFile: () => { throw new Error("routes writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program as defined, and with the trees the chooser picks, its own
// types included (R1's fix, done here and not in lab).
export function programs() {
  const p = load("routes");
  const own: string[] = JSON.parse(readFileSync(join(examples, "routes/code.json"), "utf8")).defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const lib = withLibraryRepresentations(p.code, p.info, p.pres.names, main, own);
  if (lib.chosen.length !== 2) throw new Error(`routes: expected trees for Map and Set, got ${lib.chosen.join(", ")}`);
  const options = p.options as Parameters<typeof infer>[3];
  const info = infer(lib.code, lib.names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  if (info.errors.length) throw new Error(`routes on trees: ${info.errors.map((e) => e.message).join("; ")}`);
  return { main, plain: { code: p.code, info: p.info, names: p.pres.names }, trees: { code: lib.code, info, names: lib.names } };
}

// The compiled program on trees, as JS that imports the runtime.
export function treesSource(): string {
  const { trees } = programs();
  return compile(trees.code, trees.info, trees.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main"] });
}

export async function ways(): Promise<Record<Name, Way>> {
  const { main, plain, trees } = programs();
  const dir = mkdtempSync(join(tmpdir(), "routes-"));
  const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
  const built = async (p: typeof plain, file: string) => {
    writeFileSync(join(dir, file), compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
    return (await import(pathToFileURL(join(dir, file)).href)).defs.main as (args: unknown) => number;
  };
  const evaluator = (p: typeof plain): Way => (args, files) => {
    const out: string[] = [], err: string[] = [];
    const code = runProgram(p.code, p.info, main, args, { print: (s) => out.push(s), names: p.names, world: world(files, err) });
    return { out, err, code };
  };
  const compiled = (f: (args: unknown) => number): Way => (args, files) => {
    const out: string[] = [], err: string[] = [];
    $setPrint((s: string) => out.push(s));
    $setWorld(world(files, err));
    let code: number;
    try { code = Number(f($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
    return { out, err, code };
  };
  return {
    evaluator: evaluator(plain),
    "evaluator, trees": evaluator(trees),
    compiled: compiled(await built(plain, "routes.js")),
    "compiled, trees": compiled(await built(trees, "routes-trees.js")),
    ideal: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = ideal(args, { readFile: reader(files), print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code };
    },
  };
}

// A made-up country: `towns` towns with five-letter names, each joined to
// one town made before it (so most of the country is one part), more
// roads between random towns, a few towns off on their own pair, and
// `trips` trips and nears at the end.
export function country(towns: number, extra = 2, trips = 10, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const letters = "bcdfghklmnprstvz", vowels = "aeiou";
  const name = (i: number) => {
    let s = "", x = i;
    for (let j = 0; j < 2; j++) { s += letters[x % 16] + vowels[(x >> 4) % 5]; x = Math.floor(x / 80); }
    return s[0].toUpperCase() + s.slice(1) + letters[x % 16];
  };
  const out = ["# made-up roads, in km"];
  for (let i = 1; i < towns; i++) {
    if (i % 97 === 0) { out.push(`road ${name(i)} ${name(i)}x ${1 + (rnd() % 50)}`); continue; }
    out.push(`road ${name(rnd() % i)} ${name(i)} ${5 + (rnd() % 300)}`);
  }
  for (let i = 0; i < extra * towns; i++) out.push(`road ${name(rnd() % towns)} ${name(rnd() % towns)} ${5 + (rnd() % 600)}`);
  out.push("");
  for (let i = 0; i < trips; i++) {
    if (i % 4 === 3) out.push(`near ${name(rnd() % towns)} ${50 + (rnd() % 150)}`);
    else out.push(`trip ${name(rnd() % towns)} ${name(rnd() % towns)}`);
  }
  return out.join("\n") + "\n";
}
