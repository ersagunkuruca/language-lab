// Fixed bugs put back (T18d, EPHYRA-LESSONS-2026-11-27): each entry in
// ters/test/injections/<id>/ is a past fix reversed (injection.patch, on
// implementation files only) and meta.json naming the tests that should
// catch it. For each, on a copy of HEAD (a git worktree, so the checkout
// is never touched; changes not committed aren't in it):
//
//   1. the patch applies, and reverses back to HEAD exactly;
//   2. with it applied, at least one of the named tests fails (else that
//      kind of bug is unguarded: the test got weaker, or the code moved);
//   3. affected.ts, asked what to run before a merge of the injected tree,
//      picks a test that failed (else the selection has a hole: on
//      2026-11-27 main was red 7.5 of 14 hours from tests it left out).
//
// When a later change makes a patch stop applying, derive it again on the
// tree as it is: don't delete the entry, the bug can come back.
//
//   node ters/test/injections.ts [id…] [--check]   (--check: step 1 only)
//
// Influence: Ephyra's regressions/ (datadog-labs/ephyra), each fixed bug
// kept as its fix reversed and checked to be caught, after etna-workloads;
// mutation testing with real faults instead of made-up ones.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface Meta { bug: string; what: string; tests: string[] }
export interface Outcome { id: string; applies: boolean; failed: string[]; picked: string[]; problems: string[] }

const top = resolve(import.meta.dirname, "../..");
const here = join(import.meta.dirname, "injections");

// The tests affected.ts would run before a merge, from its `--list --why` lines.
export const pickedFrom = (listing: string): string[] => [...listing.matchAll(/^ {4}(\S+\.test\.ts) \(/gm)].map((m) => m[1]);

// What an outcome says is wrong, if anything.
export function problemsOf(o: Omit<Outcome, "problems">, meta: Meta, checkOnly: boolean): string[] {
  if (!o.applies) return ["the patch doesn't apply to HEAD, or doesn't reverse back to it: derive it again on the tree as it is"];
  if (checkOnly) return [];
  const out: string[] = [];
  if (!o.failed.length) out.push(`no test caught it (${meta.tests.join(", ")} all passed)`);
  else if (!o.failed.some((t) => o.picked.includes(t))) out.push(`affected.ts before a merge picks none of the tests that caught it (${o.failed.join(", ")})`);
  return out;
}

function run(id: string, checkOnly: boolean): Outcome {
  const dir = join(here, id), meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  const patch = join(dir, "injection.patch");
  const copy = mkdtempSync(join(tmpdir(), `injection-${id}-`));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: copy, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["worktree", "add", "-q", "--detach", copy, "HEAD"], { cwd: top, stdio: "ignore" });
  try {
    if (existsSync(join(top, "ters/node_modules"))) symlinkSync(join(top, "ters/node_modules"), join(copy, "ters/node_modules"), "dir");
    let applies = true;
    try { git("apply", "--check", patch); git("apply", patch); git("apply", "-R", "--check", patch); } catch { applies = false; }
    const failed: string[] = [], picked: string[] = [];
    if (applies && !checkOnly) {
      for (const t of meta.tests) {
        const [pkg, ...rest] = t.split("/");
        const r = spawnSync(process.execPath, ["--test", "--test-reporter=dot", rest.join("/")], { cwd: join(copy, pkg), encoding: "utf8", timeout: 15 * 60_000 });
        if (r.status !== 0) failed.push(t);
      }
      const listing = spawnSync(process.execPath, ["ters/test/affected.ts", "HEAD", "--list", "--why"], { cwd: copy, encoding: "utf8" }).stdout ?? "";
      picked.push(...pickedFrom(listing));
    }
    const o = { id, applies, failed, picked };
    return { ...o, problems: problemsOf(o, meta, checkOnly) };
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", copy], { cwd: top, stdio: "ignore" });
    rmSync(copy, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? "") === import.meta.filename) {
  const argv = process.argv.slice(2), checkOnly = argv.includes("--check");
  const asked = argv.filter((a) => !a.startsWith("--"));
  const ids = asked.length ? asked : readdirSync(here).filter((d) => existsSync(join(here, d, "meta.json"))).sort();
  let bad = 0;
  for (const id of ids) {
    const o = run(id, checkOnly);
    const line = o.problems.length ? `${id}: ${o.problems.join("; ")}` : checkOnly ? `${id}: applies` : `${id}: caught by ${o.failed.join(", ")}, picked before a merge`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
    if (o.problems.length) bad++;
  }
  console.log(`${ids.length - bad} of ${ids.length} injections ${checkOnly ? "apply" : "caught and picked"}`);
  process.exit(bad ? 1 : 0);
}
