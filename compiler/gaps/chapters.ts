// chapters in its ways, in one process: the evaluator, the core IR's
// JavaScript (as defined and as stored), and the hand-written ideal (chapters.ideal.js). Each gets the same
// arguments and a world of files kept in memory, and the comparison is what
// it printed and every file it left. So the measure is the program's own
// work, not the disk. Used by bench-chapters.ts and by
// test/chapters.test.ts.

import { join } from "node:path";
import { runProgram, type World } from "../../ters/src/lang/run.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { load } from "../src/program.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
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

export async function ways(): Promise<Record<"evaluator" | "core" | "stored" | "ideal", Way>> {
  const p = load("chapters");
  const main = p.named("main");
  // Printed from the core IR (C137d13).
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const core = coreMain(lowerCore(p.code, p.info, p.pres.names, [main]), "main", rt);
  // The core IR of the program as `lab compile` stores it: its lists as
  // the chooser picks (arrays, C30), not as written.
  const prog = { title: "chapters", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options };
  const r = represented(prog, main, true);
  const rt2: { print: (s: string) => void; world?: World } = { print: () => {} };
  const stored = coreMain(lowerCore(r.code, r.info, r.names, [main]), "main", rt2);
  const run = (rt: { print: (s: string) => void; world?: World }, f: (args: string[]) => number): Way => (args, start) => {
    const out: string[] = [], err: string[] = [], d = disk(start);
    rt.print = (s) => out.push(s);
    rt.world = world(d.io, err);
    const code = f(args);
    return { out, err, code, files: d.left() };
  };
  return {
    core: run(rt, core),
    stored: run(rt2, stored),
    evaluator: (args, start) => {
      const out: string[] = [], err: string[] = [], d = disk(start);
      const code = runProgram(p.code, p.info, main, args, { print: (s) => out.push(s), names: p.pres.names, world: world(d.io, err) });
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
