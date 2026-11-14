// The test map's recording (test-map.ts, T16): a test's entry holds the
// lines it ran, and not the lines of a function it never called, so a
// change to that function doesn't reach it; and the data files it read and
// folders it listed, child processes included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromRanges, recordOne, toRanges } from "./test-map.ts";

test("ranges read back as the lines written", () => {
  assert.equal(toRanges([7, 1, 2, 3, 9, 10]), "1-3,7,9-10");
  assert.deepEqual(fromRanges("1-3,7,9-10"), [[1, 3], [7, 7], [9, 10]]);
  assert.deepEqual(fromRanges(""), []);
});

test("an entry has the lines a test ran and the files it read", async () => {
  const top = mkdtempSync(join(tmpdir(), "ters-map-test-"));
  try {
    mkdirSync(join(top, "pkg", "data"), { recursive: true });
    writeFileSync(join(top, "pkg", "package.json"), `{"type": "module"}\n`);
    writeFileSync(join(top, "pkg", "data", "a.json"), "1\n");
    writeFileSync(join(top, "pkg", "data", "b.json"), "2\n");
    writeFileSync(join(top, "pkg", "lib.ts"), [
      "export function used(x: number): number {", // 1
      "  return x + 1;", //                            2
      "}", //                                          3
      "export function unused(x: number): number {", // 4
      "  return x * 2;", //                            5
      "}", //                                          6
      "export function half(x: number): number {", //  7
      "  if (x > 0) return x / 2;", //                 8
      "  return 0 - x;", //                            9
      "}", //                                         10
    ].join("\n") + "\n");
    writeFileSync(join(top, "pkg", "x.test.ts"), [
      `import { test } from "node:test";`,
      `import { readdirSync, readFileSync } from "node:fs";`,
      `import { execFileSync } from "node:child_process";`,
      `import { half, used } from "./lib.ts";`,
      `test("x", () => {`,
      `  readdirSync("data");`,
      `  if (used(1) + half(4) !== 4) throw new Error("no");`,
      // A child process's reads count too.
      `  execFileSync(process.execPath, ["-e", "require('fs').readFileSync('data/b.json')"]);`,
      `});`,
    ].join("\n") + "\n");
    const { entry, output } = await recordOne(top, "pkg/x.test.ts", "abc");
    assert.ok(entry.passed, output);
    assert.equal(entry.at, "abc");
    const lib = fromRanges(entry.code["pkg/lib.ts"]).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
    for (const l of [1, 2, 7, 8]) assert.ok(lib.includes(l), `ran line ${l}: ${entry.code["pkg/lib.ts"]}`);
    // The body of a function never called, and a branch never taken.
    for (const l of [5, 9]) assert.ok(!lib.includes(l), `didn't run line ${l}: ${entry.code["pkg/lib.ts"]}`);
    assert.ok("pkg/x.test.ts" in entry.code);
    assert.deepEqual(entry.files, ["pkg/data/b.json"]);
    assert.deepEqual(entry.dirs, ["pkg/data"]);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
