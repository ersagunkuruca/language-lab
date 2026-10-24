// Whole programs as processes: native (lab native, through C), compiled
// JavaScript (lab compile, under node) and WebAssembly (wasi.ts, under
// node:wasi), on the same files, timed from start to exit with the peak
// memory the process held. The numbers in NATIVE.md, N5, come from this.
// Run: node gaps/bench-native.ts   (needs $CC, default cc)
//
// Each run goes through a small C program that forks, execs and reads
// wall time and ru_maxrss from wait4, so start-up and memory count as a
// user sees them.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { book as ledgerBook } from "./ledger.ts";
import { book as chaptersBook } from "./chapters.ts";

const root = join(import.meta.dirname, "../.."), lab = join(root, "projectional/cli/lab.ts");
const dir = mkdtempSync(join(tmpdir(), "bench-native-"));
const cc = process.env.CC ?? "cc";

writeFileSync(join(dir, "rusage.c"), `#define _GNU_SOURCE
#include <stdio.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
int main(int argc, char **argv) {
  struct timespec a, b; struct rusage u; int st;
  clock_gettime(CLOCK_MONOTONIC, &a);
  pid_t p = fork();
  if (p == 0) { execvp(argv[2], argv + 2); _exit(127); }
  wait4(p, &st, 0, &u);
  clock_gettime(CLOCK_MONOTONIC, &b);
  FILE *f = fopen(argv[1], "w");
  fprintf(f, "%f %ld\\n", (b.tv_sec - a.tv_sec) * 1e3 + (b.tv_nsec - a.tv_nsec) / 1e6, u.ru_maxrss);
  fclose(f);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
`);
execFileSync(cc, ["-O2", "-o", join(dir, "rusage"), join(dir, "rusage.c")]);
writeFileSync(join(dir, "wasi.mjs"), `import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";
const [file, ...args] = process.argv.slice(2);
const wasi = new WASI({ version: "preview1", args: [file, ...args], preopens: { ".": "." }, returnOnExit: true });
const m = await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(file)), wasi.getImportObject());
process.exitCode = wasi.start(m);
`);

const quiet = { cwd: dir, stdio: ["ignore", "ignore", "ignore"] as ["ignore", "ignore", "ignore"] };
const commands = (name: string): Record<string, string[]> => {
  const example = join(root, "projectional/examples", name);
  execFileSync("node", [lab, "native", example, "-o", join(dir, name)], quiet);
  execFileSync("node", [lab, "compile", example, "-o", join(dir, `${name}.mjs`)], quiet);
  execFileSync("node", ["wasi.ts", name, join(dir, `${name}.wasm`)], { ...quiet, cwd: join(root, "compiler") });
  return {
    native: [`./${name}`],
    "compiled JS": ["node", "--stack-size=65500", `${name}.mjs`],
    "WASM (node:wasi)": ["node", "--no-warnings", "wasi.mjs", `${name}.wasm`],
  };
};

const run = (command: string[], args: string[]) => {
  const out = execFileSync(join(dir, "rusage"), [join(dir, "r"), ...command, ...args], { cwd: dir, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString();
  const [ms, kb] = readFileSync(join(dir, "r"), "utf8").trim().split(" ").map(Number);
  return { out, ms, kb };
};

const workloads: [string, string, string[], Record<string, string>][] = [
  ["countdown", "its main: 1 3 7 10 25 50 → 765, every answer", [], {}],
  ["queens", "its main: six queens (start-up)", [], {}],
  ["wc", "a book of 5000 chapters", ["w.md"], { "w.md": chaptersBook(5000) }],
  ["ledger", "50 000 entries", ["l.csv"], { "l.csv": ledgerBook(50000) }],
  ["ledger", "200 000 entries", ["l.csv"], { "l.csv": ledgerBook(200000) }],
  ["chapters", "1000 chapters into a folder", ["c.md", "out"], { "c.md": chaptersBook(1000) }],
];

const runs = Number(process.env.RUNS ?? 5);
const built = new Map<string, Record<string, string[]>>();
console.log(`whole programs as processes, median of ${runs}: wall time and peak memory (ru_maxrss)\n`);
for (const [name, what, args, files] of workloads) {
  if (!built.has(name)) built.set(name, commands(name));
  for (const [p, t] of Object.entries(files)) writeFileSync(join(dir, p), t);
  if (files["c.md"]) execFileSync("mkdir", ["-p", join(dir, "out")]);
  const size = Object.values(files).reduce((n, t) => n + t.length, 0);
  console.log(`${name}, ${what}${size ? ` (${(size / 1024 / 1024).toFixed(1)} MB)` : ""}`);
  let want: string | undefined;
  for (const [way, command] of Object.entries(built.get(name)!)) {
    const rs = Array.from({ length: runs }, () => run(command, args));
    for (const r of rs) { want ??= r.out; assert.equal(r.out, want, `${name} ${way} prints what native does`); }
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
    const ms = median(rs.map((r) => r.ms)), mb = median(rs.map((r) => r.kb)) / 1024;
    console.log(`  ${way.padEnd(18)} ${ms.toFixed(ms < 100 ? 1 : 0).padStart(7)} ms ${mb.toFixed(1).padStart(8)} MB`);
  }
  console.log();
}
rmSync(dir, { recursive: true });
