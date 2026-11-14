// ters as one file (cli/bundle.ts, I272): built, copied into a repository
// with no language-lab beside it, and run there with a cache folder of its
// own. It checks and runs a program, sets up git so `git diff` reads by
// node id through it, keeps nothing in the repository, and says that
// `ters compile` needs a checkout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { bundleTers } from "../cli/bundle.ts";

test("ters.mjs runs, checks and diffs in another repository, keeping nothing there", async () => {
  const away = mkdtempSync(join(tmpdir(), "ters-bundle-"));
  const top = join(away, "repo"), cache = join(away, "cache"), file = join(top, "tools", "ters.mjs");
  await bundleTers(file);
  const env = { ...process.env, XDG_CACHE_HOME: cache, LAB_NO_LIBRARY_STORE: "" };
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: top, encoding: "utf8", env });
  const ters = (...a: string[]) => spawnSync(process.execPath, [file, ...a], { cwd: top, encoding: "utf8", env });
  git("init", "-q");
  cpSync(join(import.meta.dirname, "../examples/algebra"), join(top, "algebra"), { recursive: true });

  const checked = ters("check", "algebra");
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /^expression : /m);
  const ran = ters("run", "algebra");
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, execFileSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "run", join(top, "algebra")], { encoding: "utf8" }));

  // git's drivers run the bundle, wherever the checkout isn't.
  const setup = ters("git-setup");
  assert.equal(setup.status, 0, setup.stderr);
  assert.ok(git("config", "merge.ters.driver").includes(JSON.stringify(file)));
  git("add", "-A"); git("commit", "-qm", "algebra");
  const names = join(top, "algebra/names.default.json");
  writeFileSync(names, readFileSync(names, "utf8").replace('"expression"', '"term"'));
  assert.match(git("diff"), /^ters diff a\/algebra\/names.default.json b\/algebra\/names.default.json\nrenamed `expression` to `term`\n$/);

  // What it keeps goes to the cache folder, not the repository.
  assert.ok(readdirSync(join(cache, "ters")).some((f) => f.startsWith("library-")));
  assert.equal(existsSync(join(top, ".lab")), false);
  assert.equal(git("status", "--porcelain", "--untracked-files=all").split("\n").filter((l) => l && !l.includes("tools/ters.mjs") && !l.includes(".gitattributes") && !l.includes("names.default.json")).join("\n"), "");

  const compiled = ters("compile", "algebra");
  assert.equal(compiled.status, 2);
  assert.match(compiled.stderr, /ters compile needs a language-lab checkout/);
});
