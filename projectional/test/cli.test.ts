// The lab command line, on the word count in examples/wc: run by the
// evaluator and compiled, the two must print, exit and fail alike, and
// agree with what Unix wc counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lab = join(import.meta.dirname, "../cli/lab.ts");
const wc = join(import.meta.dirname, "../examples/wc");
const dir = mkdtempSync(join(tmpdir(), "lab-"));
writeFileSync(join(dir, "a.txt"), "hello world\nsecond  line here\n");
writeFileSync(join(dir, "b.txt"), "one\ttwo");

const node = (args: string[], input = "") => {
  const r = spawnSync(process.execPath, args, { cwd: dir, input, encoding: "utf8" });
  return { out: r.stdout, err: r.stderr, code: r.status };
};

test("lab check lists the definitions and their types", () => {
  const r = node([lab, "check", wc]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^main : \(List Text\) -\[Console, Files, Abort\]-> Int$/m);
  assert.match(r.out, /^count : \(Text\) -> Tally$/m);
});

test("wc, run and compiled: counts, totals, options, a missing file, standard input", () => {
  const compiled = join(dir, "wc.mjs");
  const c = node([lab, "compile", wc, "-o", compiled]);
  assert.equal(c.code, 0, c.err);
  const ways = { run: (args: string[], input?: string) => node([lab, "run", wc, ...args], input), compiled: (args: string[], input?: string) => node([compiled, ...args], input) };
  for (const [way, wcOf] of Object.entries(ways)) {
    const two = wcOf(["a.txt", "b.txt"]);
    assert.deepEqual(two, { code: 0, err: "", out: "       2       5      30 a.txt\n       0       2       7 b.txt\n       2       7      37 total\n" }, way);
    const missing = wcOf(["-l", "-w", "a.txt", "missing.txt"]);
    assert.deepEqual(missing, { code: 1, err: "wc: no such file or folder: missing.txt\n", out: "       2       5 a.txt\n       2       5 total\n" }, way);
    assert.deepEqual(wcOf([], "x y\nz"), { code: 0, err: "", out: "       1       3       5\n" }, way);
  }
});

test("lab refuses a program it can't run, and says why", () => {
  const r = node([lab, "run", join(import.meta.dirname, "../examples/queens"), "--main", "queens"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /queens can't be run from the command line: main takes the arguments|unhandled effect: Choice/);
  assert.equal(node([lab, "run", join(dir, "nothing.json")]).code, 2);
});
