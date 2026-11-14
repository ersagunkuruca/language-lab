// The test map (T16, TESTING.md §9): for each test file, the lines of code
// it ran and the data files it read, recorded on one commit. A change then
// reaches the tests that ran a line it changed or read a file it changed,
// instead of every test that imports a changed file: 270 of 372 test files
// import infer.ts directly, so by imports any change to the core reached
// nearly all of them.
//
// Recording runs each test file alone with V8's coverage on
// (NODE_V8_COVERAGE, block coverage, child processes included; about 2%
// slower) and test/reads.mjs preloaded, which notes the files read. Dynamic
// selection by what a test ran is prior art: Ekstazi (Gligoric, Eloussi and
// Marinov, ISSTA 2015) at the level of files; this keeps lines.
//
// The map is JSON: { tests: { "<test file>": Entry } }, each entry with the
// commit it was recorded at, so entries recorded on different nights can
// sit together.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface Entry {
  // The commit the lines are numbered at.
  at: string;
  // When it ran (ISO 8601), and whether it passed.
  ran: string;
  passed: boolean;
  // Clean runs in a row (schedule.ts): how long until it is reviewed again.
  streak?: number;
  // Wall seconds, run alone.
  seconds: number;
  // Source file -> the lines it ran, as "a-b,c,d-e" (1-based).
  code: Record<string, string>;
  // Data files read, folders listed, and files or folders copied whole
  // (a change anywhere under one reaches it), inside the repository.
  files: string[];
  dirs: string[];
  trees: string[];
}
export interface TestMap { tests: Record<string, Entry> }

const CODE = /\.(ts|js|mjs|cjs)$/;

// Lines as ranges: [1,2,3,7] -> "1-3,7".
export function toRanges(lines: Iterable<number>): string {
  const xs = [...new Set(lines)].sort((a, b) => a - b), out: string[] = [];
  for (let i = 0; i < xs.length; ) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    out.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`);
    i = j + 1;
  }
  return out.join(",");
}
export function fromRanges(s: string): [number, number][] {
  if (!s) return [];
  return s.split(",").map((r) => { const [a, b = a] = r.split("-").map(Number); return [a, b]; });
}

interface V8Range { startOffset: number; endOffset: number; count: number }
interface V8Script { url: string; functions: { ranges: V8Range[] }[] }

// The lines of one file a script ran. V8's ranges nest: a function's first
// range is the function, the rest are blocks in it, and an inner range's
// count overrides the outer's. Painted outer first, a byte keeps the count
// of the innermost range around it; a line ran when any of its bytes did.
export function linesRan(text: string, scripts: V8Script[]): Set<number> {
  const ran = new Set<number>();
  const lineStart: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStart.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  for (const s of scripts) {
    const ranges = s.functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const painted = new Uint8Array(text.length);
    for (const r of ranges) painted.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, text.length));
    for (let i = 0; i < text.length; i++) if (painted[i] && text.charCodeAt(i) > 32) ran.add(lineOf(i));
  }
  return ran;
}

// What a coverage folder and a reads folder say, as an entry's code, files
// and dirs (paths from the repository's top).
export function readRecording(top: string, coverage: string, reads: string): Pick<Entry, "code" | "files" | "dirs" | "trees"> {
  const byFile = new Map<string, V8Script[]>();
  if (existsSync(coverage)) for (const f of readdirSync(coverage)) {
    if (!f.endsWith(".json")) continue;
    let json: { result: V8Script[] };
    try { json = JSON.parse(readFileSync(join(coverage, f), "utf8")); } catch { continue; }
    for (const s of json.result) {
      if (!s.url.startsWith("file:")) continue;
      const path = relative(top, fileURLToPath(s.url));
      if (path.startsWith("..") || path.includes("node_modules/") || !CODE.test(path)) continue;
      byFile.set(path, [...(byFile.get(path) ?? []), s]);
    }
  }
  const code: Record<string, string> = {};
  for (const [path, scripts] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    if (!existsSync(join(top, path))) continue;
    const r = toRanges(linesRan(readFileSync(join(top, path), "utf8"), scripts));
    if (r) code[path] = r;
  }
  const files = new Set<string>(), dirs = new Set<string>(), trees = new Set<string>();
  if (existsSync(reads)) for (const f of readdirSync(reads)) for (const line of readFileSync(join(reads, f), "utf8").split("\n")) {
    const p = line.slice(2);
    if (line.startsWith("f ") && !CODE.test(p)) files.add(p);
    if (line.startsWith("d ")) dirs.add(p);
    if (line.startsWith("t ")) trees.add(p);
  }
  return { code, files: [...files].sort(), dirs: [...dirs].sort(), trees: [...trees].sort() };
}

// Runs one test file (a path from the top) in its package with coverage and
// the reads recorder on, and gives its entry, with what the run printed
// (kept to say why it failed).
// Without coverage (`coverage: false`) only the reads: the editor's tests
// evaluate the bundled editor anew on every page, and V8 keeps every such
// script's counters until the process runs out of memory (editing-3.test,
// 42 s plain, out of memory at 61 s with coverage). They are found by
// imports instead (affected.ts `bundles`).
export function recordOne(top: string, test: string, at: string, env: NodeJS.ProcessEnv = process.env, coverage = true): Promise<{ entry: Entry; output: string }> {
  const pkg = test.split("/")[0];
  const scratch = mkdtempSync(join(tmpdir(), "ters-map-"));
  const covDir = join(scratch, "coverage"), reads = join(scratch, "reads");
  const preload = `--import=${join(import.meta.dirname, "reads.mjs")}`;
  const start = Date.now();
  // Started from inside a test (test-map.test.ts), node --test would report
  // to that one instead of running the file.
  const { NODE_TEST_CONTEXT: _, ...rest } = env;
  return new Promise((done) => {
    const c = spawn("node", ["--test", "--test-reporter=dot", relative(pkg, test)], {
      cwd: join(top, pkg), stdio: ["ignore", "pipe", "pipe"],
      env: { ...rest, ...(coverage ? { NODE_V8_COVERAGE: covDir } : {}), TERS_READS: reads, TERS_TOP: top, NODE_OPTIONS: [env.NODE_OPTIONS, preload].filter(Boolean).join(" ") },
    });
    let output = "";
    c.stdout.on("data", (d) => { output += d; });
    c.stderr.on("data", (d) => { output += d; });
    c.on("close", (status) => {
      const seconds = Math.round((Date.now() - start) / 100) / 10;
      const entry: Entry = { at, ran: new Date(start).toISOString(), passed: status === 0, seconds, ...readRecording(top, covDir, reads) };
      rmSync(scratch, { recursive: true, force: true });
      done({ entry, output });
    });
  });
}

export function readMap(path: string): TestMap {
  try { return JSON.parse(readFileSync(path, "utf8")) as TestMap; } catch { return { tests: {} }; }
}

// Two maps as one: for each test, the entry that ran last.
export function mergeMaps(...maps: TestMap[]): TestMap {
  const tests: Record<string, Entry> = {};
  for (const m of maps) for (const [t, e] of Object.entries(m.tests)) if (!tests[t] || tests[t].ran < e.ran) tests[t] = e;
  return { tests };
}

// One line a test, sorted, so the map's history diffs by test.
export function printMap(map: TestMap): string {
  const names = Object.keys(map.tests).sort();
  return `{"tests": {\n${names.map((n) => `${JSON.stringify(n)}: ${JSON.stringify(map.tests[n])}`).join(",\n")}\n}}\n`;
}
