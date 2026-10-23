// Runs only the tests a change can reach (TESTING.md, T2), the way Google's
// TAP picks "affected" targets from reverse dependencies (Memon et al.,
// ICSE-SEIP 2017; prior art).
//
//   npm run affected               changes since origin/main, plus uncommitted ones
//   npm run affected -- <base>     changes since <base>
//   npm run affected -- <a> <b>    changes from commit a to b (files as they are now)
//   npm run affected -- --all      everything, every sweep in full (the nightly run)
//   npm run affected -- --list     say what would run, run nothing
//
// A test file runs when it, or anything it imports (through any chain, in
// projectional, compiler or invertible), changed. The examples are read at
// run time, which no import shows, so a changed example also runs the test
// files that name it or list the examples folder. The browser tests run
// when anything the built pages are made of changed. A change to a
// package's setup (package.json, the lockfile, tsconfig) runs everything,
// and prose and pictures run nothing.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const top = resolve(import.meta.dirname, "../..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: top, encoding: "utf8" }).trim();
const argv = process.argv.slice(2);
const all = argv.includes("--all");
const listOnly = argv.includes("--list");
const [base = "origin/main", head] = argv.filter((a) => !a.startsWith("--"));

const PACKAGES = ["projectional", "compiler", "invertible"];
const sources = git("ls-files", "--", ...PACKAGES.map((p) => `${p}/**.ts`), ...PACKAGES.map((p) => `${p}/**.js`)).split("\n").filter(Boolean);

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
const examples = new Set(code.flatMap((f) => f.match(/^projectional\/examples\/([^/]+)\//)?.[1] ?? []));

const tests = sources.filter((f) => /\.test\.(ts|js)$/.test(f));
const chosen = tests.filter((t) => {
  if (all || setup) return true;
  const reach = closure([t]);
  if (code.some((f) => reach.has(f))) return true;
  // Data the tests read at run time: the library and the examples.
  const text = [...reach].map((f) => readFileSync(join(top, f), "utf8")).join("\n");
  if (code.some((f) => f.startsWith("projectional/library/")) && /library|prelude/.test(text)) return true;
  if (!examples.size) return false;
  if (/readdirSync\([^)]*examples/.test(text)) return true;
  return [...examples].some((e) => new RegExp(`["'/]${e}["'/]`).test(text));
});

// The browser tests: the pages are built from editor/build.ts and what it
// imports, plus the editor's own html and css, the examples, the library
// and the styles.
const pageInputs = closure(["projectional/editor/build.ts", "projectional/editor/smoke.ts", "projectional/editor/shaders-smoke.ts"]);
const page = all || setup || code.some((f) => pageInputs.has(f) || /^projectional\/(editor|examples|library|styles)\//.test(f));
const gpu = all || setup || code.some((f) => closure(["compiler/gpu.ts"]).has(f));

const runs: { what: string; cwd: string; cmd: string[] }[] = [];
for (const p of PACKAGES) {
  const mine = chosen.filter((t) => t.startsWith(p + "/")).map((t) => relative(p, t));
  // Node runs (cores - 1) files at a time, one on a two-core runner.
  if (mine.length) runs.push({ what: `${p}: ${mine.length} of ${tests.filter((t) => t.startsWith(p + "/")).length} test files`, cwd: p, cmd: ["node", "--test", "--test-concurrency=2", "--test-reporter=dot", ...mine] });
}
if (page) {
  runs.push({ what: "build the pages", cwd: "projectional", cmd: ["node", "editor/build.ts"] });
  runs.push({ what: "the editor in a browser", cwd: "projectional", cmd: ["node", "editor/smoke.ts"] });
  runs.push({ what: "shaders in a browser", cwd: "projectional", cmd: ["node", "editor/shaders-smoke.ts"] });
}
if (gpu) runs.push({ what: "WGSL on a GPU", cwd: "compiler", cmd: ["node", "gpu.ts"] });

console.log(all ? "everything, every sweep in full" : `${changed.length} files changed since ${base}${setup ? ", a package's setup among them: everything" : ""}`);
for (const r of runs) console.log(`  ${r.what}`);
if (!runs.length) console.log("  nothing to test");
if (listOnly) process.exit(0);

const env = all ? { ...process.env, SWEEP: "all" } : process.env;
let failed = 0;
for (const r of runs) {
  console.log(`\n== ${r.what}`);
  const res = spawnSync(r.cmd[0], r.cmd.slice(1), { cwd: join(top, r.cwd), stdio: "inherit", env });
  if (res.status !== 0) { failed++; console.log(`== failed: ${r.what}`); }
}
process.exit(failed ? 1 : 0);
