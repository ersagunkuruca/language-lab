// P10 made mechanical (T17, REVIEW-2026-11-23 §1): a pull request's check
// fails while Check main has been red for more than an hour, unless its
// title names a file that fails (a lane's own fix merges). A rule every lane
// had to remember failed twice in two weeks; a red check needs no one to.
//
// `node test/main-red.ts "<pull request title>"` in CI (main-green.yml),
// with GITHUB_TOKEN and GITHUB_REPOSITORY. What fails comes from the test
// map (test-map.ts): an entry that didn't pass is a file that failed when
// it last ran, and Check main runs it again every run until it passes.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { TestMap } from "./test-map.ts";

export type Run = { conclusion: string | null; updatedAt: string; url?: string };
export const HOUR_MS = 60 * 60 * 1000;

// Whether a pull request may merge now. `runs`: Check main's runs on main,
// newest first; `failing`: the files that failed when they last ran.
export function verdict(runs: Run[], failing: string[], title: string, now: Date): { ok: boolean; say: string } {
  const done = runs.filter((r) => r.conclusion === "success" || r.conclusion === "failure");
  if (!done.length || done[0].conclusion === "success") return { ok: true, say: "Check main is green." };
  // Red since the first failure after the last green run finished.
  const green = done.findIndex((r) => r.conclusion === "success");
  const first = done[(green === -1 ? done.length : green) - 1];
  const since = new Date(first.updatedAt);
  const minutes = Math.round((now.getTime() - since.getTime()) / 60000);
  const files = failing.length ? failing.join(", ") : "none in the test map";
  if (now.getTime() - since.getTime() <= HOUR_MS) return { ok: true, say: `Check main has been red for ${minutes} min (under P10's hour). Failing: ${files}.` };
  const named = failing.filter((f) => title.includes(f) || title.includes(f.split("/").at(-1)!));
  if (named.length) return { ok: true, say: `Check main has been red for ${minutes} min; this pull request names ${named.join(", ")}, so it may merge (P10: a lane's own fix).` };
  if (!failing.length) return { ok: true, say: `Check main has been red for ${minutes} min, but no test file failed (a cancelled or broken run, not a test): look at ${done[0].url ?? "Check main"}.` };
  return { ok: false, say: `Check main has been red for ${minutes} min (since ${since.toISOString().slice(0, 16)} UTC). P10: nothing merges but a fix for a failing file, named in the title. Failing: ${files}. Once Check main is green, run this check again.` };
}

// The files whose last run failed.
export const failingIn = (map: TestMap): string[] => Object.entries(map.tests).filter(([, e]) => !e.passed).map(([t]) => t).sort();

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const title = process.argv[2] ?? "";
  const repo = process.env.GITHUB_REPOSITORY!, token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/check-main.yml/runs?branch=main&status=completed&per_page=100`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) { console.log(`couldn't read Check main's runs (${res.status}); not stopping the merge`); process.exit(0); }
  const runs = ((await res.json()) as { workflow_runs: { conclusion: string | null; updated_at: string; html_url: string }[] }).workflow_runs
    .map((r) => ({ conclusion: r.conclusion, updatedAt: r.updated_at, url: r.html_url }));
  const top = resolve(import.meta.dirname, "../..");
  let failing: string[] = [];
  try {
    execFileSync("git", ["fetch", "-q", "--depth=1", "origin", "+refs/heads/test-map:refs/remotes/origin/test-map"], { cwd: top });
    failing = failingIn(JSON.parse(execFileSync("git", ["show", "refs/remotes/origin/test-map:map.json"], { cwd: top, encoding: "utf8", maxBuffer: 1 << 30 })) as TestMap);
  } catch { console.log("no test map to read"); }
  const v = verdict(runs, failing, title, new Date());
  console.log(v.say);
  if (!v.ok) { console.log(`::error::${v.say}`); process.exit(1); }
}
