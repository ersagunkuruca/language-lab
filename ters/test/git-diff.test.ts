// `git diff` on program files prints `ters diff` (DIFF.md "In git", E262):
// a scratch repository with git-setup run in it, a definition renamed in the
// names file, read by git diff, git diff --staged and git show --ext-diff.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { gitSetup } from "../cli/git-diff.ts";

test("a rename in names.default.json reads as a rename in git diff, --staged and git show", () => {
  const top = mkdtempSync(join(tmpdir(), "git-diff-"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: top, encoding: "utf8" });
  git("init", "-q");
  cpSync(join(import.meta.dirname, "../examples/algebra"), join(top, "algebra"), { recursive: true });
  writeFileSync(join(top, ".gitattributes"), ["code.json", "names.default.json", "comments.json", "signatures.json"].map((f) => `algebra/${f} diff=ters\n`).join(""));
  gitSetup(top);
  git("add", "-A"); git("commit", "-qm", "algebra");
  const names = join(top, "algebra/names.default.json");
  writeFileSync(names, readFileSync(names, "utf8").replace('"expression"', '"term"'));
  const renamed = "renamed `expression` to `term`";
  assert.match(git("diff"), new RegExp(`^ters diff a/algebra/names.default.json b/algebra/names.default.json\n${renamed}\n$`));
  git("add", "-A");
  assert.ok(git("diff", "--staged").includes(renamed));
  git("commit", "-qm", "rename");
  assert.ok(git("show", "--ext-diff", "--format=", "HEAD").includes(renamed));
  assert.ok(git("diff", "--no-ext-diff", "HEAD~1").includes('-"4c6a8fcf": "expression",'));
});

// I268 (GIT-TRIAL-2026-11-14 §4): a program folder moved, then edited, is
// diffed against itself at its old place, by ters diff --from and by the
// driver, which heads it with both paths.
test("a moved program folder is followed: ters diff --from and git's diff driver", () => {
  const top = mkdtempSync(join(tmpdir(), "git-move-"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: top, encoding: "utf8" });
  const ters = (...a: string[]) => execFileSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), ...a], { cwd: top, encoding: "utf8" });
  git("init", "-q");
  cpSync(join(import.meta.dirname, "../examples/algebra"), join(top, "programs/algebra"), { recursive: true });
  writeFileSync(join(top, ".gitattributes"), ["code.json", "names.default.json", "comments.json", "signatures.json"].map((f) => `**/${f} diff=ters\n`).join(""));
  gitSetup(top);
  git("add", "-A"); git("commit", "-qm", "algebra");
  const first = git("rev-parse", "HEAD").trim();
  git("mv", "programs/algebra", "games");
  git("commit", "-qm", "moved");
  // Only moved: no change to the program, said with both places.
  const shown = git("show", "--ext-diff", "-M", "--format=", "HEAD");
  assert.match(shown, /^ters diff a\/programs\/algebra\/code\.json b\/games\/code\.json\nmoved from programs\/algebra to games\nno changes to the program\n/m);
  const names = join(top, "games/names.default.json");
  writeFileSync(names, readFileSync(names, "utf8").replace('"expression"', '"term"'));
  git("commit", "-qam", "rename");
  const d = ters("diff", "--from", first);
  assert.match(d, /^moved from programs\/algebra\n/);
  assert.ok(d.includes("renamed `expression` to `term`"), d);
  assert.doesNotMatch(d, /^added /m);
  assert.match(ters("diff", "games", "--from", first), /^moved from programs\/algebra\n(.|\n)*renamed `expression` to `term`/);
});

// I269 (GIT-TRIAL-2026-11-14 §5): git-setup makes sure a program file
// anywhere has both drivers, adding `**/code.json` patterns where a
// folder-bound one (programs/**) would lose them once a program moves.
test("git-setup adds patterns for program files anywhere, once, and this repository has them", () => {
  const top = mkdtempSync(join(tmpdir(), "git-attrs-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: top, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(top, ".gitattributes"), "programs/**/code.json diff=ters merge=ters\n");
  assert.match(gitSetup(top), /added to \.gitattributes.*code\.json, names\.default\.json, comments\.json, signatures\.json/);
  const text = readFileSync(join(top, ".gitattributes"), "utf8");
  assert.ok(text.startsWith("programs/**/code.json diff=ters merge=ters\n\n# Ters program files"), text);
  for (const f of ["code.json", "names.default.json", "comments.json", "signatures.json"]) assert.ok(text.includes(`**/${f} diff=ters merge=ters\n`));
  assert.match(git("check-attr", "diff", "merge", "--", "games/dice/code.json"), /diff: ters\n.*merge: ters/);
  assert.match(gitSetup(top), /nothing to add/);
  assert.equal(readFileSync(join(top, ".gitattributes"), "utf8"), text);
  // This repository's own patterns name them anywhere too.
  const here = (...a: string[]) => execFileSync("git", a, { cwd: import.meta.dirname, encoding: "utf8" });
  for (const f of ["compiler/gaps/trek/code.json", "somewhere/new/names.default.json"]) assert.match(here("check-attr", "diff", "merge", "--", f), /diff: ters\n.*merge: ters/);
});
