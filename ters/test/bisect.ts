// A red test finds the commit that broke it (T16d): `node test/bisect.ts
// <test file> <last good commit> [bad commit]` runs that one file, alone,
// on the commits between, halving each time (git bisect), in a worktree of
// its own, and says the first bad commit, whose subject names the PR.
// Check main and the Nightly call it for each file that fails where its
// map entry passed before, so catching a break a day late costs a few
// runs of one file, not an afternoon of reading logs.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const TOP = resolve(import.meta.dirname, "../..");
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export interface Culprit { commit: string; subject: string; steps: number }

// The first commit after `good` up to `bad` where `test` fails, or
// undefined when it can't tell (good fails too, or bad passes).
export function bisect(test: string, good: string, bad = "HEAD", timeoutSeconds = 600, top = TOP): Culprit | undefined {
  const pkg = test.split("/")[0];
  const dir = mkdtempSync(join(tmpdir(), "ters-bisect-"));
  const wt = join(dir, "wt");
  const { NODE_TEST_CONTEXT: _, ...rest } = process.env;
  const run = (): boolean => {
    const r = spawnSync("node", ["--test", "--test-reporter=dot", relative(pkg, test)], { cwd: join(wt, pkg), stdio: "ignore", timeout: Math.round(timeoutSeconds * 1000), env: rest });
    return r.status === 0;
  };
  try {
    git(top, "worktree", "add", "-q", "--detach", wt, bad);
    // The packages' modules from this checkout: a lockfile that changed in
    // between is rare enough to read as a failure.
    for (const p of ["ters", "compiler", "invertible"]) if (existsSync(join(top, p, "node_modules")) && !existsSync(join(wt, p, "node_modules"))) symlinkSync(join(top, p, "node_modules"), join(wt, p, "node_modules"));
    if (!existsSync(join(wt, test)) || run()) return undefined;
    git(wt, "checkout", "-q", "--detach", good);
    if (!existsSync(join(wt, test)) || !run()) return undefined;
    let steps = 2;
    const between = git(top, "rev-list", "--first-parent", "--reverse", `${good}..${bad}`).split("\n").filter(Boolean);
    if (!between.length) return undefined;
    let a = 0, b = between.length - 1; // between[b] fails; between[a - 1] (or good) passes
    while (a < b) {
      const mid = (a + b) >> 1;
      git(wt, "checkout", "-q", "--detach", between[mid]);
      steps++;
      if (existsSync(join(wt, test)) && run()) a = mid + 1; else b = mid;
    }
    const commit = between[b];
    return { commit, subject: git(top, "log", "-1", "--format=%s", commit), steps };
  } finally {
    try { git(top, "worktree", "remove", "--force", wt); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [test, good, bad] = process.argv.slice(2);
  if (!test || !good) { console.error("usage: node test/bisect.ts <test file from the top> <good commit> [bad commit]"); process.exit(2); }
  const c = bisect(test, good, bad);
  console.log(c ? `${test} first fails at ${c.commit.slice(0, 10)} ${c.subject} (${c.steps} runs)` : `${test}: no single commit to blame between ${good.slice(0, 10)} and ${bad ?? "HEAD"}`);
}
