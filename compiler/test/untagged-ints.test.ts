// A loop's counting Ints untagged on C (BACKLOG C207e, compiler/src/
// untagged-ints.ts): divisors' and nicomachus's folds count with int64_ts
// in a copy the loop goes to when its counts are small, and print what
// `ters run` prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");

for (const [name, args] of [["divisors", ["2000", "100"]], ["nicomachus", []]] as const) {
  test(`${name}'s loop counts with int64_ts on C, and prints what ters run prints`, () => {
    const ex = join(import.meta.dirname, "../../ters/examples", name), out = join(mkdtempSync(join(tmpdir(), "untagged-")), name);
    const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const c = readFileSync(`${out}.c`, "utf8");
    assert.match(c, /_counted\(int64_t p\d/);
    assert.match(c, /lab__i64_sub\(/);
    const native = spawnSync(out, [...args], { encoding: "utf8", env: { ...process.env, TERS_WORKERS: "0" } }), run = spawnSync(process.execPath, [ters, "run", ex, ...args], { encoding: "utf8" });
    assert.equal(native.stdout, run.stdout);
  });
}

// C207i: collatz's `steps to one` multiplies its value, so every Int of the
// loop is an int64_t, and a round whose value would leave the small range
// starts again as written (`goto lab_bail`).
test("collatz's loop keeps its values as int64_ts on C, and prints what ters run prints", () => {
  const ex = join(import.meta.dirname, "../../ters/examples/collatz"), out = join(mkdtempSync(join(tmpdir(), "untagged-")), "collatz");
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const c = readFileSync(`${out}.c`, "utf8");
  assert.match(c, /steps_to_one_counted\(int64_t p0, int64_t p1\)/);
  assert.match(c, /lab__i64_mulv\(p0, INT64_C\(3\), &\w+\)\) goto lab_bail;/);
  assert.match(c, /lab_bail:\n  return lab_steps_to_one_as_written\(LAB_SMALL\(p0\), LAB_SMALL\(p1\)\);/);
  const args = ["3000", "100"];
  const native = spawnSync(out, args, { encoding: "utf8", env: { ...process.env, TERS_WORKERS: "0" } }), run = spawnSync(process.execPath, [ters, "run", ex, ...args], { encoding: "utf8" });
  assert.equal(native.stdout, run.stdout);
});
