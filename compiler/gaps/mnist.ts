// mnist (GAPS.md round 22): a 784-32-10 network learning handwritten
// digits by Adam or by damped Newton steps, in two ways in one process:
// the module printed from the core IR (`ters compile`) and the
// hand-written ideal (mnist.ideal.js). The evaluator is left out: one
// Adam pass over 100 digits takes it minutes. Each gets the same
// arguments and a world whose files are in memory, and the comparison is
// what it printed and how it exited. Used by bench-mnist.ts and
// test/mnist.test.ts.
//
// The data: MNIST itself (LeCun, Cortes and Burges), fetched once into
// MNIST_DIR (default ~/.cache/mnist) by `mnistFolder`, never kept in the
// repository; `cut` writes the first n digits of it as files of their own;
// `madeUp` makes small made-up digits for the tests.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { type World } from "../../ters/src/lang/run.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented } from "../../ters/cli/represented.ts";
import { coreMain, lowerCore } from "../src/core-js.ts";
import { mnist as ideal } from "./mnist.ideal.js";

export interface Run { out: string[]; err: string[]; code: number }
export type Way = (args: string[], files: Record<string, Uint8Array>) => Run;
export type Name = "core" | "ideal";
export const folder = join(import.meta.dirname, "mnist");
export const FILES = ["train-images-idx3-ubyte", "train-labels-idx1-ubyte", "t10k-images-idx3-ubyte", "t10k-labels-idx1-ubyte"];

function reader(files: Record<string, Uint8Array>) {
  return (p: string) => {
    if (!(p in files)) throw new Error(`no such file or folder: ${p}`);
    return files[p];
  };
}
const world = (files: Record<string, Uint8Array>, err: string[]): World => ({
  error: (l) => err.push(l), log: (l) => err.push(l), input: () => "", readLine: () => null,
  readFile: () => { throw new Error("mnist reads bytes"); }, readBytes: reader(files),
  writeFile: () => { throw new Error("mnist writes no files"); }, appendFile: () => { throw new Error("mnist writes no files"); },
  fileExists: (p) => p in files, listFolder: () => [],
});

// The program with its types stored the way `ters run` and `ters compile`
// choose (ters/cli/represented.ts).
export function program() {
  const p = loadProgram(folder);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  if (info.errors.length) throw new Error(`mnist has errors: ${info.errors.map((e) => e.message).join("; ")}`);
  const own = p.own.defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const plain = { title: "mnist", code: p.code, own, names: p.pres.names, info, reps: representationsIn(p.code, info, p.pres.names, own), options: p.options };
  const r = represented(plain, main, true);
  return { code: r.code, info: r.info, names: r.names, main };
}

export async function ways(): Promise<Record<Name, Way>> {
  const p = program();
  const rt: { print: (s: string) => void; world?: World } = { print: () => {} };
  const fromCore = coreMain(lowerCore(p.code, p.info, p.names, [p.main]), "main", rt);
  return {
    core: (args, files) => {
      const out: string[] = [], err: string[] = [];
      rt.print = (s) => out.push(s);
      rt.world = world(files, err);
      return { out, err, code: fromCore(args) };
    },
    ideal: (args, files) => {
      const out: string[] = [], err: string[] = [];
      const code = ideal(args, { readBytes: reader(files), print: (s: string) => out.push(s), printError: (s: string) => err.push(s) });
      return { out, err, code };
    },
  };
}

// IDX files (the MNIST format): a big-endian magic number, the counts, the
// bytes.
const word = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const joined = (head: number[], body: Uint8Array) => { const b = new Uint8Array(head.length + body.length); b.set(head); b.set(body, head.length); return b; };
export const idxImages = (n: number, pixels: Uint8Array) => joined([...word(2051), ...word(n), ...word(28), ...word(28)], pixels);
export const idxLabels = (n: number, labels: Uint8Array) => joined([...word(2049), ...word(n)], labels);

// Made-up digits for the tests, in folder "d": each class a bar of ink
// across a band of rows of its own, at a slant of its own, with noise.
export function madeUp(n: number, tests: number, seed = 7): Record<string, Uint8Array> {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const make = (count: number) => {
    const px = new Uint8Array(count * 784), lb = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const c = Math.floor(r() * 10);
      lb[i] = c;
      for (let x = 2; x < 26; x++) {
        const y = 2 + 2 * c + Math.round(((x - 14) * (c % 3 - 1)) / 6 + r());
        for (const dy of [0, 1]) if (y + dy >= 0 && y + dy < 28) px[i * 784 + (y + dy) * 28 + x] = 160 + Math.floor(r() * 95);
      }
      for (let k = 0; k < 20; k++) px[i * 784 + Math.floor(r() * 784)] = Math.floor(r() * 255);
    }
    return [px, lb] as const;
  };
  const [tp, tl] = make(n), [sp, sl] = make(tests);
  return {
    "d/train-images-idx3-ubyte": idxImages(n, tp), "d/train-labels-idx1-ubyte": idxLabels(n, tl),
    "d/t10k-images-idx3-ubyte": idxImages(tests, sp), "d/t10k-labels-idx1-ubyte": idxLabels(tests, sl),
  };
}

// MNIST, fetched once (11 MB, gzipped) from the mirror torchvision uses.
// Yann LeCun, Corinna Cortes and Christopher J. C. Burges, "The MNIST
// database of handwritten digits"; Creative Commons Attribution-Share
// Alike 3.0.
export function mnistFolder(): string {
  const dir = process.env.MNIST_DIR ?? join(homedir(), ".cache", "mnist");
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    if (existsSync(join(dir, f))) continue;
    const gz = execFileSync("curl", ["-sfL", `https://ossci-datasets.s3.amazonaws.com/mnist/${f}.gz`], { maxBuffer: 1 << 26 });
    writeFileSync(join(dir, f), gunzipSync(gz));
  }
  return dir;
}

// The first n training digits and the first min(n, 10000) test digits, as
// files of their own in a fresh folder, and as in-memory files under "d".
export function cut(n: number): { dir: string; files: Record<string, Uint8Array> } {
  const from = mnistFolder(), dir = mkdtempSync(join(tmpdir(), `mnist-${n}-`)), files: Record<string, Uint8Array> = {};
  const read = (f: string) => readFileSync(join(from, f));
  const t = Math.min(n, 10000);
  const parts: [string, Uint8Array][] = [
    [FILES[0], idxImages(n, read(FILES[0]).subarray(16, 16 + 784 * n))], [FILES[1], idxLabels(n, read(FILES[1]).subarray(8, 8 + n))],
    [FILES[2], idxImages(t, read(FILES[2]).subarray(16, 16 + 784 * t))], [FILES[3], idxLabels(t, read(FILES[3]).subarray(8, 8 + t))],
  ];
  for (const [f, bytes] of parts) { writeFileSync(join(dir, f), bytes); files[`d/${f}`] = bytes; }
  return { dir, files };
}
