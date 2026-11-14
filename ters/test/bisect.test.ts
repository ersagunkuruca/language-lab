// A red test finds its culprit (bisect.ts, T16d): in a repository of six
// commits where the fourth breaks a test, bisecting from the first to the
// last names the fourth, by running only that test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bisect } from "./bisect.ts";

test("bisecting names the commit that broke the test", () => {
  const top = mkdtempSync(join(tmpdir(), "ters-bisect-test-"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: top, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    mkdirSync(join(top, "pkg"));
    writeFileSync(join(top, "pkg", "package.json"), `{"type": "module"}\n`);
    writeFileSync(join(top, "pkg", "x.test.ts"), `import { test } from "node:test";\nimport { v } from "./lib.ts";\ntest("v", () => { if (v() !== 1) throw new Error("v is " + v()); });\n`);
    const commits: string[] = [];
    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(top, "pkg", "lib.ts"), `// version ${i}\nexport const v = () => ${i >= 4 ? 2 : 1};\n`);
      git("add", "-A");
      git("commit", "-qm", `change ${i}`);
      commits.push(git("rev-parse", "HEAD"));
    }
    const c = bisect("pkg/x.test.ts", commits[0], commits[5], 60, top);
    assert.ok(c);
    assert.equal(c.commit, commits[3]);
    assert.equal(c.subject, "change 4");
    // A test that passes at the bad end blames nothing.
    assert.equal(bisect("pkg/x.test.ts", commits[0], commits[2], 60, top), undefined);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
