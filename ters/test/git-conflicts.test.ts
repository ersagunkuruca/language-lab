// A merge of program files in a real git repository, through the driver:
// its conflicts said by definition, and said again by `ters conflicts`
// from git's index until the file is added (I267, GIT-TRIAL-2026-11-14 §3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSaved, printSaved } from "../src/saved.ts";
import { subtree, type Code } from "../src/model.ts";

const ters = join(import.meta.dirname, "..", "cli", "ters.ts");

test("ters conflicts says a merge's conflicts again from git's index, by definition with both sides", () => {
  const repo = mkdtempSync(join(tmpdir(), "git-conflicts-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const run = (...a: string[]) => spawnSync(process.execPath, [ters, ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  cpSync(join(import.meta.dirname, "..", "examples", "dice"), join(repo, "dice"), { recursive: true });
  writeFileSync(join(repo, ".gitattributes"), "**/code.json diff=ters merge=ters\n");
  run("git-setup");
  git("add", "-A");
  git("commit", "-q", "-m", "dice");
  assert.equal(run("conflicts").stdout.trim(), "no program file has a conflict");
  // die's 6, set to 8 on one branch and to 9 on the other.
  const file = join(repo, "dice", "code.json");
  const names = parseSaved(readFileSync(join(repo, "dice", "names.default.json"), "utf8")) as Record<string, string>;
  const die = Object.keys(names).find((k) => names[k] === "die")!;
  const set = (v: number) => {
    const code = parseSaved(readFileSync(file, "utf8")) as Code;
    const six = subtree(code, die).find((x) => code.nodes[x].kind === "lit" && Number((code.nodes[x] as { value: unknown }).value) === 6)!;
    code.nodes[six] = { ...code.nodes[six], value: v } as Code["nodes"][string];
    writeFileSync(file, printSaved(code));
  };
  git("checkout", "-q", "-b", "eight");
  set(8);
  git("commit", "-q", "-am", "eight");
  git("checkout", "-q", "main");
  set(9);
  git("commit", "-q", "-am", "nine");
  const m = spawnSync("git", ["merge", "eight"], { cwd: repo, encoding: "utf8" });
  assert.notEqual(m.status, 0);
  assert.match(m.stderr + m.stdout, /`die`: node \w+: both changed its value \(ours 9, theirs 8\)/);
  assert.match(m.stderr + m.stdout, /`ters conflicts` says these again until the file is added/);
  const c = run("conflicts");
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^dice\/code\.json: 1 conflict, ours kept:\n {2}`die`: node \w+: both changed its value \(ours 9, theirs 8\)\n {4}ours:\n(.*\n)* {6}die\(\) = floor\(random\(\) · 9\) \+ 1\n {4}theirs:\n(.*\n)* {6}die\(\) = floor\(random\(\) · 8\) \+ 1/);
  assert.match(run("conflicts", "dice").stdout, /1 conflict/);
  git("add", "dice/code.json");
  assert.equal(run("conflicts").stdout.trim(), "no program file has a conflict");
});
