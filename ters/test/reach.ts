// How far one test reaches into the code (T18a, EPHYRA-LESSONS-2026-11-27):
// from the test map, for each source file under the folders asked, its
// lines, the lines some test ran, and the lines this test ran; sorted by
// what only other tests reach, with the files the test never enters. Made
// for the generated programs (compiler/test/fuzz.test.ts, C101): a file
// the examples reach and the generator doesn't is where the generator
// should grow next, round by round, as Ephyra's agents steer theirs by
// what coverage never reached (influence: Ephyra, datadog-labs/ephyra).
//
// The map keeps functions that ran, not blocks (test-map.ts), so a line
// counts as run when the function around it ran.
//
//   node ters/test/reach.ts [test file] [--in compiler/src,ters/src/lang] [--map map.json] [--top n]

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fetchMap, fromRanges, readMap, type TestMap } from "./test-map.ts";

export interface FileReach { file: string; lines: number; any: number; mine: number }
export interface Reach { folder: string; lines: number; any: number; mine: number; files: FileReach[] }

const count = (ranges: string | undefined, into?: Set<number>): number => {
  let n = 0;
  for (const [a, b] of ranges ? fromRanges(ranges) : []) for (let i = a; i <= b; i++) if (!into || !into.has(i)) { into?.add(i); n++; }
  return n;
};

// Each folder's reach by `test`, from the map; `linesOf` gives a file's
// length (null: gone since the map was recorded, left out).
export function reach(map: TestMap, test: string, folders: string[], linesOf: (file: string) => number | null): Reach[] {
  const ran = new Map<string, Set<number>>();
  for (const entry of Object.values(map.tests))
    for (const [file, ranges] of Object.entries(entry.code ?? {}))
      if (folders.some((f) => file.startsWith(f))) { if (!ran.has(file)) ran.set(file, new Set()); count(ranges, ran.get(file)); }
  const mine = map.tests[test]?.code ?? {};
  return folders.map((folder) => {
    const files: FileReach[] = [];
    for (const [file, lines] of ran) {
      if (!file.startsWith(folder)) continue;
      const total = linesOf(file);
      if (total === null) continue;
      files.push({ file, lines: total, any: lines.size, mine: count(mine[file]) });
    }
    files.sort((x, y) => y.any - y.mine - (x.any - x.mine) || x.file.localeCompare(y.file));
    const sum = (k: "lines" | "any" | "mine") => files.reduce((n, f) => n + f[k], 0);
    return { folder, lines: sum("lines"), any: sum("any"), mine: sum("mine"), files };
  });
}

const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;

export function printReach(test: string, reaches: Reach[], top = 15): string {
  const out: string[] = [];
  for (const r of reaches) {
    const never = r.files.filter((f) => !f.mine);
    out.push(`${r.folder}: ${test} runs ${r.mine} of ${r.lines} lines (${pct(r.mine, r.lines)}); all tests ${r.any} (${pct(r.any, r.lines)}); never enters ${never.length} of ${r.files.length} files`);
    out.push(`  lines  any test  this test  file`);
    for (const f of r.files.slice(0, top)) out.push(`  ${String(f.lines).padStart(5)}  ${String(f.any).padStart(8)}  ${String(f.mine).padStart(9)}  ${f.file}`);
    if (never.length) out.push(`  never entered: ${never.map((f) => f.file.slice(r.folder.length)).join(", ")}`);
  }
  return out.join("\n");
}

if (resolve(process.argv[1] ?? "") === import.meta.filename) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const flagged = new Set(["--in", "--map", "--top"].flatMap((n) => (argv.includes(n) ? [argv.indexOf(n), argv.indexOf(n) + 1] : [])));
  const test = argv.find((a, i) => !flagged.has(i) && !a.startsWith("--")) ?? "compiler/test/fuzz.test.ts";
  const top = resolve(import.meta.dirname, "../..");
  const map = opt("--map") ? readMap(opt("--map")!) : fetchMap(top);
  if (!map.tests[test]) { console.error(`reach: ${test} isn't in the test map`); process.exit(1); }
  const folders = (opt("--in") ?? "compiler/src/,ters/src/lang/").split(",").map((f) => (f.endsWith("/") ? f : f + "/"));
  const linesOf = (file: string) => { try { return readFileSync(join(top, file), "utf8").split("\n").length; } catch { return null; } };
  console.log(printReach(test, reach(map, test, folders, linesOf), Number(opt("--top") ?? 15)));
}
