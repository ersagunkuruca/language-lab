// chapters three ways, in one process: the evaluator, the compiler's
// output, and the hand-written ideal (chapters.ideal.js). Each gets the same
// arguments and a world of files kept in memory, and the comparison is what
// it printed and every file it left. So the measure is the program's own
// work, not the disk. Used by bench-chapters.ts and by
// test/chapters.test.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { compile } from "../src/compile.ts";
import { load } from "../src/program.ts";
import { $setPrint, $setWorld, $Aborted, $toList } from "../src/runtime.js";
import { chapters as ideal } from "./chapters.ideal.js";

export interface Run { out: string[]; err: string[]; code: number; files: Record<string, string> }
export type Way = (args: string[], files: Record<string, string>) => Run;

// Files in a Map; a read of a missing one fails the way Node's world says.
// Nothing can be written under ro/, so a write can fail too.
function disk(start: Record<string, string>) {
  const files = new Map(Object.entries(start));
  const writable = (p: string) => { if (p.startsWith("ro/")) throw new Error(`permission denied: ${p}`); };
  const io = {
    readFile: (p: string) => {
      const t = files.get(p);
      if (t === undefined) throw new Error(`no such file or folder: ${p}`);
      return t;
    },
    writeFile: (p: string, t: string) => (writable(p), void files.set(p, t)),
    appendFile: (p: string, t: string) => (writable(p), void files.set(p, (files.get(p) ?? "") + t)),
  };
  return { io, left: () => Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

const world = (io: ReturnType<typeof disk>["io"], err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  ...io, fileExists: () => false, listFolder: () => [],
});

export async function ways(): Promise<Record<"evaluator" | "compiled" | "ideal", Way>> {
  const p = load("chapters");
  const main = p.named("main");
  const path = join(mkdtempSync(join(tmpdir(), "chapters-")), "chapters.js");
  writeFileSync(path, compile(p.code, p.info, p.pres.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs.main as (args: unknown) => number;
  return {
    evaluator: (args, start) => {
      const out: string[] = [], err: string[] = [], d = disk(start);
      const code = runProgram(p.code, p.info, main, args, { print: (s) => out.push(s), names: p.pres.names, world: world(d.io, err) });
      return { out, err, code, files: d.left() };
    },
    compiled: (args, start) => {
      const out: string[] = [], err: string[] = [], d = disk(start);
      $setPrint((s: string) => out.push(s));
      $setWorld(world(d.io, err));
      let code: number;
      try { code = Number(compiled($toList(args))); } catch (e) { if (!(e instanceof $Aborted)) throw e; err.push(e.reason); code = 1; }
      return { out, err, code, files: d.left() };
    },
    ideal: (args, start) => {
      const out: string[] = [], err: string[] = [], d = disk(start);
      const code = ideal(args, { ...d.io, print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code, files: d.left() };
    },
  };
}

// A book of random chapters: a preface, then headings with punctuation,
// capitals, digits and letters outside A to Z, some titles used more than
// once (so file names get -2, -3), lines with runs of spaces, and empty
// lines.
export function book(chapters: number, linesPer = 20, seed = 1): string {
  let r = seed;
  const rnd = () => (r = (r * 48271) % 2147483647);
  const vocab = ["the", "night", "rain", "fell", "and", "they", "walked", "into", "woods", "café", "Ünïcode", "it's", "42", "a", "—", "light"];
  const titles = ["Notes", "Interlude", "The End?", "Chapter 1: Hello, World!", "Café at Dawn", "***", "Into the Woods", "A–Z"];
  const line = () => Array.from({ length: rnd() % 12 }, () => vocab[rnd() % vocab.length] + (rnd() % 7 === 0 ? "  " : "")).join(" ");
  const out = ["Some words before the first chapter.", ""];
  for (let c = 0; c < chapters; c++) {
    out.push(`# ${rnd() % 3 === 0 ? titles[rnd() % titles.length] : `${titles[rnd() % titles.length]} ${c}`}`);
    for (let l = 0; l < linesPer; l++) out.push(rnd() % 6 === 0 ? "" : line());
  }
  return out.join("\n") + "\n";
}
