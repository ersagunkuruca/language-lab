// A compiled run keeps L186's log of the world's answers (C172a): with
// TERS_LOG set, a module from `lab compile` writes what the world answered
// it, and `lab run --replay` gives those answers to the evaluator, which
// then does what the compiled run did, whatever the world says now.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a compiled run's log of the world's answers replays on the evaluator (C172a)", () => {
  const lab = join(import.meta.dirname, "../../ters/cli/lab.ts"), wc = join(import.meta.dirname, "../../ters/examples/wc");
  const dir = mkdtempSync(join(tmpdir(), "log-"));
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    return [r.stdout, r.stderr, r.status] as const;
  };
  assert.equal(run([lab, "compile", wc, "--core", "-o", "wc.mjs"])[2], 0);
  writeFileSync(join(dir, "a.txt"), "two words\nand three more\n");
  const compiled = run(["wc.mjs", "-l", "a.txt", "nope"], { TERS_LOG: "run.json" });
  const log = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { op: string }[];
  assert.ok(log.some((e) => e.op === "readFile"), JSON.stringify(log));
  // The file has changed since; the replay answers as the world did then.
  writeFileSync(join(dir, "a.txt"), "one\n");
  assert.deepEqual(run([lab, "run", wc, "--replay", "run.json", "-l", "a.txt", "nope"]), compiled);
  assert.notDeepEqual(run([lab, "run", wc, "-l", "a.txt", "nope"]), compiled);
});
