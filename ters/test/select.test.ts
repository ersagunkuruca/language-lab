// Selecting tests by the test map (select.ts, T16b): a change reaches a
// test only through a line it ran or a file it read; comments and types
// reach nothing; lines changed since the map was recorded are found at
// the map's numbering; and the cover before a merge is the cheapest set
// that still runs every changed line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asRun, changeAt, changeFrom, cover, hunkLines, reached, translate } from "./select.ts";
import type { Entry } from "./test-map.ts";

test("comments and types are blanked, line for line", () => {
  const src = "// a\nconst a: number = 1; /* b */ const r = /x\\/'y/g;\nconst t = `${ {k: 1}.k } // kept`; // gone\n";
  const out = asRun("x.ts", src);
  assert.equal(out.length, src.length);
  assert.equal(out.split("\n")[0].trim(), "");
  assert.equal(out.split("\n")[1].replace(/ +/g, " "), "const a = 1; const r = /x\\/'y/g;");
  assert.equal(out.split("\n")[2].trimEnd(), "const t = `${ {k: 1}.k } // kept`;");
});

test("old lines of a diff, and newer lines read at the older numbering", () => {
  // Two lines added after 3, line 7 taken out, line 9 changed.
  const diff = "@@ -3,0 +4,2 @@\n@@ -7 +8,0 @@\n@@ -9 +10 @@\n";
  assert.deepEqual([...hunkLines(diff)].sort((a, b) => a - b), [3, 4, 7, 9]);
  assert.deepEqual([...translate(diff, [1])], [1]);
  assert.deepEqual([...translate(diff, [5])].sort(), [3, 4]);
  assert.deepEqual([...translate(diff, [6, 9, 10, 11])], [4, 8, 9, 10]);
});

const entry = (code: Record<string, string>, files: string[] = [], dirs: string[] = []): Entry => ({ at: "x", ran: "", passed: true, seconds: 1, code, files, dirs, trees: [] });

test("a change reaches a test through a line it ran or a file it read", () => {
  const change = { from: "x", lines: new Map<string, Set<number> | "all">([["a.ts", new Set([5])], ["gone.ts", "all"]]), data: new Map([["ex/one.json", "M"], ["ex/new.json", "A"]]) };
  assert.deepEqual(reached(entry({ "a.ts": "1-4,6-9" }), change), []);
  assert.deepEqual(reached(entry({ "a.ts": "1-9" }), change), ["a.ts:5"]);
  assert.deepEqual(reached(entry({ "gone.ts": "1" }), change), ["gone.ts:*"]);
  assert.deepEqual(reached(entry({}, ["ex/one.json"]), change), ["ex/one.json"]);
  // A folder listed sees a file added to it, not one changed in it.
  assert.deepEqual(reached(entry({}, [], ["ex"]), change), ["ex/new.json"]);
});

test("the cover is the cheapest set running every unit", () => {
  const reach = new Map([["big", ["a", "b", "c"]], ["one", ["a"]], ["two", ["b", "c"]], ["other", ["c"]]]);
  const seconds = (t: string) => ({ big: 100, one: 1, two: 2, other: 1 })[t]!;
  assert.deepEqual(cover(reach, seconds), ["one", "two"]);
  assert.deepEqual(cover(new Map(), seconds), []);
});

test("a change in a real repository, measured at an older commit", () => {
  const top = mkdtempSync(join(tmpdir(), "ters-select-test-"));
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: top, encoding: "utf8" });
  try {
    git("init", "-q");
    const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";
    writeFileSync(join(top, "m.ts"), lines(6, (i) => `export const v${i} = ${i};`));
    git("add", "-A"); git("commit", "-qm", "one");
    const old = git("rev-parse", "HEAD").trim();
    // Since then (merged into main): a line put at the top.
    writeFileSync(join(top, "m.ts"), "export const v0 = 0;\n" + lines(6, (i) => `export const v${i} = ${i};`));
    git("commit", "-qam", "two");
    const base = git("rev-parse", "HEAD").trim();
    // The work: line 5 at base (v4) changed, a comment on 3 and a type on 6.
    writeFileSync(join(top, "m.ts"), "export const v0 = 0;\n" + lines(6, (i) => (i === 4 ? "export const v4 = 40;" : i === 2 ? "export const v2 = 2; // two" : i === 5 ? "export const v5: number = 5;" : `export const v${i} = ${i};`)));
    const change = changeFrom(top, base);
    assert.deepEqual([...(change.lines.get("m.ts") as Set<number>)], [5]);
    assert.deepEqual([...(changeAt(top, change, old).lines.get("m.ts") as Set<number>)], [4]);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
