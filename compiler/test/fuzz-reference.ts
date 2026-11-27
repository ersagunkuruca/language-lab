// The last good evaluator as a reference (T18f, EPHYRA-LESSONS-2026-11-27):
// the generated programs of fuzz.test.ts, run on today's evaluator and on
// the evaluator of an older commit (the `good` tag, the last fully checked
// tree), each definition on each input. fuzz.test.ts holds the engines to
// today's evaluator; this holds today's evaluator to the one before it.
// A difference may be a meaning changed on purpose: look it up in DONE.md
// before calling it a bug, and where it was meant, move on (the next green
// Nightly moves the tag).
//
// The program is today's generator's, the same code on both sides, each
// on its own tree's library: saved here without the library, read and run
// in a copy of the older tree (a git worktree) by fuzz-answers.ts, copied in. Where the older checker can't read it (a part
// added since), that seed is skipped, not counted.
//
//   node compiler/test/fuzz-reference.ts [--ref good] [seed…]   (default: seed 1 and the night's)
//
// Influence: Ephyra's OCaml and rustc harnesses (datadog-labs/ephyra,
// case-studies), each case run on the release and on trunk; differential
// testing across versions (McKeeman, "Differential testing for software",
// 1998).

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { program } from "./fuzz-programs.ts";
import { answers, programOnly, type Answers, type Saved } from "./fuzz-answers.ts";
import { printSaved } from "../../ters/src/saved.ts";

const top = resolve(import.meta.dirname, "../..");
// fuzz.test.ts's inputs, as text so they survive JSON.
export const INPUTS: Saved["inputs"] = [[0, "0", []], [2.5, "3", ["1", "2", "3"]], [-1, "-2", ["5", "-4"]], [1e300, String(2n ** 64n + 1n), [String(2n ** 62n), String(-(2n ** 63n)), "7"]]];

// Where the two evaluators answer differently: "g<i>(input j): now …, then …".
export function differences(now: Answers, then: Answers): string[] {
  const out: string[] = [];
  now.answers.forEach((row, i) => row.forEach((a, j) => { const b = then.answers[i]?.[j]; if (b !== a) out.push(`g${i}(input ${j}): now ${a}, then ${b}`); }));
  return out;
}

if (resolve(process.argv[1] ?? "") === import.meta.filename) {
  const argv = process.argv.slice(2), at = argv.indexOf("--ref");
  const ref = at >= 0 ? argv[at + 1] : "good";
  if (!ref) { console.log("--ref names no commit (a shallow clone has none a day old)"); process.exit(1); }
  const asked = argv.filter((a, i) => /^\d+$/.test(a) && !(at >= 0 && i === at + 1)).map(Number);
  const seeds = asked.length ? asked : [1, Math.floor(Date.now() / 86_400_000)];
  const copy = mkdtempSync(join(tmpdir(), "fuzz-reference-"));
  execFileSync("git", ["worktree", "add", "-q", "--detach", copy, ref], { cwd: top, stdio: "ignore" });
  const sha = execFileSync("git", ["rev-parse", "--short", ref], { cwd: top, encoding: "utf8" }).trim();
  let bad = 0;
  const say = (line: string) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`); };
  try {
    if (existsSync(join(top, "ters/node_modules"))) symlinkSync(join(top, "ters/node_modules"), join(copy, "ters/node_modules"), "dir");
    copyFileSync(join(import.meta.dirname, "fuzz-answers.ts"), join(copy, "compiler/test/fuzz-answers.ts"));
    for (const seed of seeds) {
      const p = program(seed, 40, INPUTS.map(([, , xs]) => xs.map(BigInt)));
      const saved: Saved = { ...programOnly(p.code, p.names), defs: p.defs.map((d) => d.def), inputs: INPUTS };
      const file = join(copy, `program-${seed}.json`);
      writeFileSync(file, printSaved(saved));
      const now = answers(saved);
      const r = spawnSync(process.execPath, ["compiler/test/fuzz-answers.ts", file], { cwd: copy, encoding: "utf8", maxBuffer: 1 << 28, timeout: 10 * 60_000 });
      let then: Answers;
      try { then = JSON.parse(r.stdout) as Answers; } catch { say(`seed ${seed}: the evaluator at ${ref} (${sha}) didn't run: ${(r.stderr || "").split("\n").find((l) => /Error/.test(l)) ?? `exit ${r.status}`}`); continue; }
      if (then.errors.length) { say(`seed ${seed}: skipped, the checker at ${ref} (${sha}) can't read it: ${then.errors[0]}`); continue; }
      const ds = differences(now, then);
      say(ds.length ? `seed ${seed}: ${ds.length} answers differ from ${ref} (${sha}); a meaning changed on purpose is in DONE.md:\n${ds.map((d) => `  ${d}`).join("\n")}` : `seed ${seed}: ${now.answers.length * INPUTS.length} answers the same as ${ref} (${sha})`);
      if (ds.length) bad++;
    }
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", copy], { cwd: top, stdio: "ignore" });
    rmSync(copy, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}
