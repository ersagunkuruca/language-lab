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
