// Runs only the tests a change can reach (TESTING.md, T2), the way Google's
// TAP picks "affected" targets from reverse dependencies (Memon et al.,
// ICSE-SEIP 2017; prior art).
//
//   npm run affected               changes since origin/main, plus uncommitted ones
//   npm run affected -- <base>     changes since <base>
//   npm run affected -- <a> <b>    changes from commit a to b (files as they are now)
//   npm run affected -- --all      everything, every sweep in full (the nightly run)
//   npm run affected -- --browser  the browser tests too, when the change reaches them
//   npm run affected -- --list     say what would run, run nothing (--why: and why)
//   npm run affected -- --no-map   select by imports, not by the test map
//   npm run affected -- --map <file>  a test map from a file, not the branch
//   npm run affected -- --since-map  each test against its own last run (Check main)
//   npm run affected -- --due      that, and the reviews due (the Nightly; T16c)
//   npm run affected -- --full     every test file it reaches, the slow ones too
//   npm run affected -- --time     time every test file, alone, with the per-change
//                                  sweep slice, and write the slow ones to test/slow.json
//   npm run affected -- --record <map.json>
//                                  run each chosen file alone, recording what it ran
//                                  and read into the test map (test-map.ts, T16)
//
// With the test map (branch test-map, test-map.ts and select.ts, T16b), a
// test runs when it ran a line the change makes different or read a file
// it changes, not whenever it imports a changed file; before a merge only
// a cheapest set of those that still runs every changed line (each file
// over a minute left to Check main unless the change edits it), and with
// --full all of them. `--list --why` says which lines put each file in;
// `--no-map` goes by imports, as below.
//
// Without the map, before a merge only the fast set runs (Ersagun 2026-11-03, T13): of the
// files a change reaches, those measured under SLOW_CAP seconds
// (test/slow.json), and any test file the change edits itself. The slow
// files it reaches run after the merge in Check main (`--full`) and in the
// nightly run (`--all`).
//
// A test file runs when it, or anything it imports (through any chain, in
// ters, compiler or invertible), changed. The examples are read at
// run time, which no import shows, so a changed example also runs the test
// files that name it or list the examples folder. The browser tests (the
// editor, shaders, sound, WGSL on a GPU) take about ten minutes, so they
// run only with --all, once a night, or with --browser, when anything they
// are made of changed (TESTING.md, T8). A change to a
// package's setup (package.json, the lockfile, tsconfig) runs everything,
// and prose and pictures run nothing.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { printMap, readMap, recordOne, type TestMap } from "./test-map.ts";
import { changeFrom, cover, haveCommit, reached, reachedTests, type Change } from "./select.ts";
import { intervalDays, isDue, streakAfter } from "./schedule.ts";

const top = resolve(import.meta.dirname, "../..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: top, encoding: "utf8" }).trim();
const argv = process.argv.slice(2);
const all = argv.includes("--all");
// The nightly run in parallel jobs (I208): `--all --shard 2/4` runs the
// second of four shares of the test files, balanced by how long each took
// with every sweep in full (nightly-times.json), and no browser test;
// `--all --browser-only` runs only the browser tests.
// Check main (T15) shares out the files a merge reaches the same way:
// `<base> HEAD --full --shard 2/6`.
const shardArg = argv.find((a) => a.startsWith("--shard="))?.slice(8) ?? (argv.includes("--shard") ? argv[argv.indexOf("--shard") + 1] : undefined);
const shard = shardArg ? shardArg.split("/").map(Number) as [number, number] : null;
const browserOnly = argv.includes("--browser-only");
const listOnly = argv.includes("--list");
const browser = all || argv.includes("--browser");
const timing = argv.includes("--time");
// After a merge (T16c): each test against its own last run in the map, not
// against a base: it runs when a line it ran or a file it read changed
// since, or when it failed then. `--due` (the Nightly) also runs the tests
// whose review is due (schedule.ts) and every test the map hasn't got.
const sinceMap = argv.includes("--since-map"), due = argv.includes("--due");
const full = all || timing || sinceMap || due || argv.includes("--full");
const recordTo = argv.includes("--record") ? argv[argv.indexOf("--record") + 1] : undefined;
const [base = "origin/main", head] = argv.filter((a, i) => !a.startsWith("--") && a !== shardArg && argv[i - 1] !== "--record" && argv[i - 1] !== "--map");

const PACKAGES = ["ters", "compiler", "invertible"];
// The editor has no tests or packages of its own, but its imports count.
const sources = git("ls-files", "--", ...[...PACKAGES, "editor"].flatMap((p) => [`${p}/**.ts`, `${p}/**.js`])).split("\n").filter(Boolean);

// What each file imports, by path from the repository's top.
const imports = new Map<string, string[]>();
for (const f of sources) {
  const text = readFileSync(join(top, f), "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
    if (!m[1].startsWith(".")) continue;
    const to = relative(top, resolve(top, dirname(f), m[1]));
    if (existsSync(join(top, to))) out.push(to);
  }
  imports.set(f, out);
}
const closure = (roots: string[]) => {
  const seen = new Set(roots);
  const todo = [...roots];
  while (todo.length) for (const d of imports.get(todo.pop()!) ?? []) if (!seen.has(d)) { seen.add(d); todo.push(d); }
  return seen;
};

const changed = all ? [] : [...new Set([
  ...git("diff", "--name-only", `${base}...${head ?? "HEAD"}`).split("\n"),
  // Uncommitted work counts too, unless a commit to stop at is given.
  ...(head ? [] : git("diff", "--name-only", "HEAD").split("\n")),
  ...(head ? [] : git("ls-files", "--others", "--exclude-standard").split("\n")),
].filter(Boolean))];
const code = changed.filter((f) => !/\.(md|png|jpg|gif)$/.test(f));
const setup = code.some((f) => /(^|\/)(package(-lock)?\.json|tsconfig\.json)$/.test(f));
const examples = new Set(code.flatMap((f) => f.match(/^ters\/examples\/([^/]+)\//)?.[1] ?? []));

const tests = sources.filter((f) => /\.test\.(ts|js)$/.test(f));
// A test that bundles the editor reaches what the editor imports, and its
// page, though it imports neither.
const editorPage = ["editor/main.ts", "editor/page.html"];
const bundles: Record<string, string[]> = { "ters/test/draws.test.ts": [...editorPage, "editor/smoke-saved.json"], "ters/test/editing.test.ts": editorPage, "ters/test/editing-2.test.ts": editorPage, "ters/test/editing-3.test.ts": editorPage };
// By imports and the data a test names: the rule when there is no test
// map, and for the tests the map hasn't recorded or can't see into.
const byImports = (t: string) => {
  const reach = closure([t, ...(bundles[t] ?? [])]);
  if (code.some((f) => reach.has(f))) return true;
  // Data the tests read at run time: the library and the examples.
  const text = [...reach].map((f) => readFileSync(join(top, f), "utf8")).join("\n");
  if (code.some((f) => f.startsWith("ters/library/")) && /library|prelude/.test(text)) return true;
  if (!examples.size) return false;
  if (/readdirSync\([^)]*examples/.test(text)) return true;
  return [...examples].some((e) => new RegExp(`["'/]${e}["'/]`).test(text));
};

// The test map (T16b): what each test ran and read, recorded by Check main
// and the Nightly on the branch test-map. Fetched each time (kept in .lab/
// for when there is no network); `--no-map` goes by imports alone.
// `--map <file>` reads a map from a file instead (a map recorded locally
// with --record).
const mapFile = argv.includes("--map") ? argv[argv.indexOf("--map") + 1] : undefined;
function loadMap(): TestMap | undefined {
  if (mapFile) { const m = readMap(mapFile); return Object.keys(m.tests).length ? m : undefined; }
  const kept = join(top, ".lab", "test-map.json");
  try {
    execFileSync("git", ["fetch", "-q", "--depth=1", "origin", "+refs/heads/test-map:refs/remotes/origin/test-map"], { cwd: top, stdio: "ignore", timeout: 60_000 });
    const text = execFileSync("git", ["show", "refs/remotes/origin/test-map:map.json"], { cwd: top, encoding: "utf8", maxBuffer: 1 << 30 });
    mkdirSync(dirname(kept), { recursive: true });
    writeFileSync(kept, text);
  } catch {}
  const map = readMap(kept);
  return Object.keys(map.tests).length ? map : undefined;
}
const map = all || setup || timing || argv.includes("--no-map") ? undefined : loadMap();

// A test's seconds, run alone: from the map, else the nightly's times.
const timesPath = join(top, "ters/test/nightly-times.json");
const times: Record<string, number> = existsSync(timesPath) ? (JSON.parse(readFileSync(timesPath, "utf8")) as { files: Record<string, number> }).files : {};
const secondsOf = (t: string) => map?.tests[t]?.seconds ?? times[t] ?? 10;

// Before a merge, a test over this many seconds stays out of the cover
// unless the change edits it: what only it runs is left to Check main.
const LONG = 60;
let chosen: string[];
let deferred: string[] = [];
let reasons = new Map<string, string[]>();
if (all || setup || timing) chosen = tests;
else if (map && (sinceMap || due)) {
  const now = new Date();
  const changes = new Map<string, Change | undefined>();
  const why = new Map<string, string[]>();
  for (const t of tests) {
    const e = map.tests[t];
    if (!e) { if (due || byImports(t)) why.set(t, ["not in the map"]); continue; }
    if (!e.passed) { why.set(t, ["failed when it last ran"]); continue; }
    if (!changes.has(e.at)) changes.set(e.at, haveCommit(top, e.at) ? changeFrom(top, e.at, head ?? "HEAD") : undefined);
    const ch = changes.get(e.at);
    if (!ch) { why.set(t, ["its last run's commit is gone"]); continue; }
    const units = reached(e, ch);
    if (t in bundles) {
      const inBundle = closure([t, ...bundles[t]]);
      units.push(...[...ch.lines.keys()].filter((p) => inBundle.has(p)), ...[...ch.data.keys()].filter((p) => bundles[t].includes(p) || p.startsWith("editor/")));
    }
    if (units.length) why.set(t, units);
    else if (due && isDue(e, now)) why.set(t, [`review: ${intervalDays(e.streak ?? 0)} days since it last ran`]);
  }
  chosen = [...why.keys()].sort();
  reasons = why;
}
else if (!map) chosen = tests.filter(byImports);
else {
  const from = git("merge-base", base, head ?? "HEAD");
  const change = changeFrom(top, from, head);
  const reach = reachedTests(top, map, change, tests);
  // The editor's tests run the editor bundled, which coverage doesn't map
  // back to its sources: by imports, every changed line of what they
  // bundle counts as run.
  for (const t of Object.keys(bundles)) {
    if (!tests.includes(t) || !byImports(t)) continue;
    const inBundle = closure([t, ...bundles[t]]);
    const units = [...change.lines].filter(([p]) => inBundle.has(p)).flatMap(([p, ls]) => (ls === "all" ? [`${p}:*`] : [...ls].map((l) => `${p}:${l}`)));
    reach.set(t, [...new Set([...(reach.get(t) ?? []), ...units, ...[...change.data.keys()].filter((p) => bundles[t].includes(p) || p.startsWith("editor/"))])]);
  }
  reasons = reach;
  // Tests the map has no entry for (new ones), and test files the change
  // edits, run as they always did.
  const own = tests.filter((t) => code.includes(t) || (!map.tests[t] && byImports(t)));
  const exact = [...new Set([...reach.keys(), ...own])].sort();
  if (full) chosen = exact;
  else {
    const candidates = new Map([...reach].filter(([t]) => secondsOf(t) <= LONG || own.includes(t)));
    chosen = [...new Set([...cover(candidates, secondsOf), ...own])].sort();
    deferred = exact.filter((t) => !chosen.includes(t));
  }
}

// The browser tests: the pages are built from editor/build.ts and what it
// imports, plus the editor's own html and css, the examples, the library
// and the styles.
const pageInputs = closure(["editor/build.ts", "editor/smoke.ts", "editor/shaders-smoke.ts"]);
const page = all || setup || code.some((f) => pageInputs.has(f) || /^(editor\/|ters\/(examples|library|styles)\/)/.test(f));
const gpu = all || setup || code.some((f) => closure(["compiler/gpu.ts"]).has(f));
// A page with sound (AUDIO.md): what builds it and what it runs on, and the pedal.
const soundInputs = closure(["ters/test/sound-browser.ts", "ters/cli/web.ts", "compiler/src/core-sound.ts", "compiler/src/core-page.ts"]);
const sound = all || setup || code.some((f) => soundInputs.has(f) || f.startsWith("ters/examples/pedal/"));

// The slow files (T13): left for Check main and the nightly run, unless
// the change edits the test file itself.
const SLOW_CAP = 5;
const slowPath = join(top, "ters/test/slow.json");
const slow: Record<string, number> = existsSync(slowPath) ? (JSON.parse(readFileSync(slowPath, "utf8")) as { files: Record<string, number> }).files : {};
const left = full || map ? [] : chosen.filter((t) => t in slow && !code.includes(t));
let fast = chosen.filter((t) => !left.includes(t));
if (browserOnly) fast = [];
if (shard) {
  // Longest first, each to the share with the least so far.
  const [i, n] = shard;
  const load = Array<number>(n).fill(0), mine = new Set<string>();
  for (const t of [...fast].sort((a, b) => (times[b] ?? 10) - (times[a] ?? 10) || a.localeCompare(b))) {
    const k = load.indexOf(Math.min(...load));
    load[k] += times[t] ?? 10;
    if (k === i - 1) mine.add(t);
  }
  fast = fast.filter((t) => mine.has(t));
}

if (timing) {
  // Each file alone, as many at once as there are cores; the wall time of
  // each is what a change waits for it.
  const times: Record<string, number> = {};
  const todo = [...chosen];
  let failedFiles = 0;
  const one = (): Promise<void> => {
    const t = todo.shift();
    if (!t) return Promise.resolve();
    const p = PACKAGES.find((q) => t.startsWith(q + "/"))!;
    const start = Date.now();
    return new Promise<void>((done) => {
      const c = spawn("node", ["--test", "--test-reporter=dot", relative(p, t)], { cwd: join(top, p), stdio: "ignore", env: process.env });
      c.on("close", (status) => {
        times[t] = Math.round((Date.now() - start) / 100) / 10;
        if (status !== 0) { failedFiles++; console.log(`  failed: ${t}`); }
        console.log(`  ${times[t]} s  ${t}`);
        done();
      });
    }).then(one);
  };
  await Promise.all(Array.from({ length: availableParallelism() }, one));
  const files = Object.fromEntries(Object.entries(times).filter(([, s]) => s >= SLOW_CAP).sort((a, b) => b[1] - a[1]));
  const kept = Object.fromEntries(Object.entries(slow).filter(([f]) => !(f in times) && tests.includes(f)));
  writeFileSync(slowPath, JSON.stringify({ cap: SLOW_CAP, measured: new Date().toISOString().slice(0, 10), files: { ...kept, ...files } }, null, 1) + "\n");
  console.log(`${Object.keys(files).length} of ${chosen.length} files take ${SLOW_CAP} s or more: written to test/slow.json`);
  process.exit(failedFiles ? 1 : 0);
}

if (recordTo) {
  // Each file alone, as many at once as there are cores, with coverage on
  // (test-map.ts); the entries go into the map at recordTo, beside the
  // ones already there. A failure prints what the file printed.
  const env = all || due ? { ...process.env, SWEEP: "all" } : process.env;
  const at = git("rev-parse", "HEAD");
  const parts = readMap(recordTo);
  // The last runs, to carry each test's streak on (schedule.ts).
  const before = map ?? loadMap();
  const todo = [...fast];
  let failedFiles = 0;
  console.log(`recording ${todo.length} test files into ${recordTo}`);
  const one = async (): Promise<void> => {
    const t = todo.shift();
    if (!t) return;
    const { entry, output } = await recordOne(top, t, at, env, !(t in bundles));
    const prev = before?.tests[t];
    const edited = !!prev && prev.at !== at && (!haveCommit(top, prev.at) || git("diff", "--name-only", prev.at, at, "--", t) !== "");
    entry.streak = streakAfter(prev, entry.passed, edited);
    parts.tests[t] = entry;
    console.log(`  ${entry.passed ? "ok" : "FAILED"}  ${entry.seconds} s  ${t}`);
    if (!entry.passed) { failedFiles++; console.log(output.split("\n").map((l) => `    ${l}`).join("\n")); }
    return one();
  };
  await Promise.all(Array.from({ length: availableParallelism() }, one));
  writeFileSync(recordTo, printMap(parts));
  console.log(`${fast.length - failedFiles} of ${fast.length} passed`);
  process.exit(failedFiles ? 1 : 0);
}

const runs: { what: string; cwd: string; cmd: string[] }[] = [];
for (const p of PACKAGES) {
  const mine = fast.filter((t) => t.startsWith(p + "/")).map((t) => relative(p, t));
  // Node runs (cores - 1) files at a time, one on a two-core runner.
  // As many test files at once as the machine has cores (it was 2, half
  // of a 4-core container's).
  if (mine.length) runs.push({ what: `${p}: ${mine.length} of ${tests.filter((t) => t.startsWith(p + "/")).length} test files`, cwd: p, cmd: ["node", "--test", `--test-concurrency=${availableParallelism()}`, "--test-reporter=dot", ...mine] });
}
if (page && browser && !shard) {
  runs.push({ what: "build the pages", cwd: "ters", cmd: ["node", "../editor/build.ts"] });
  runs.push({ what: "the editor in a browser", cwd: "ters", cmd: ["node", "../editor/smoke.ts"] });
  runs.push({ what: "shaders in a browser", cwd: "ters", cmd: ["node", "../editor/shaders-smoke.ts"] });
}
if (gpu && browser && !shard) runs.push({ what: "WGSL on a GPU", cwd: "compiler", cmd: ["node", "gpu.ts"] });
if (sound && browser && !shard) runs.push({ what: "sound in a browser", cwd: "ters", cmd: ["node", "test/sound-browser.ts"] });

console.log(all ? `everything, every sweep in full${shard ? `: share ${shard[0]} of ${shard[1]}` : browserOnly ? ": the browser tests" : ""}` : `${changed.length} files changed since ${base}${setup ? ", a package's setup among them: everything" : ""}${shard ? `: share ${shard[0]} of ${shard[1]}` : ""}`);
for (const r of runs) console.log(`  ${r.what}`);
if (!browser && (page || gpu || sound)) console.log("  (the browser tests it reaches run tonight, or now with --browser)");
if (left.length) console.log(`  (${left.length} slow file${left.length === 1 ? "" : "s"} it reaches run after the merge, in Check main, or now with --full)`);
if (map && !all && !setup) console.log(`  by the test map: ${chosen.length} file${chosen.length === 1 ? "" : "s"} run${chosen.length === 1 ? "s" : ""} every changed line${deferred.length ? `; ${deferred.length} more that ran them run after the merge, in Check main, or now with --full` : ""}`);
if (listOnly && argv.includes("--why")) for (const t of chosen) console.log(`    ${t} (${secondsOf(t)} s): ${(reasons.get(t) ?? ["new or edited"]).slice(0, 4).join(", ")}${(reasons.get(t)?.length ?? 0) > 4 ? ", …" : ""}`);
if (!runs.length) console.log("  nothing to test");
if (listOnly) process.exit(0);

const env = all || due ? { ...process.env, SWEEP: "all" } : process.env;
let failed = 0;
for (const r of runs) {
  console.log(`\n== ${r.what}`);
  const res = spawnSync(r.cmd[0], r.cmd.slice(1), { cwd: join(top, r.cwd), stdio: "inherit", env });
  if (res.status !== 0) { failed++; console.log(`== failed: ${r.what}`); }
}
process.exit(failed ? 1 : 0);
