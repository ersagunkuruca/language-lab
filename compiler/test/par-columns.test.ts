// An in-place map over columns on C's threads (BACKLOG C201, compiler/src/
// par-columns.ts): drift's step shares its motes out in runs, and prints
// what it prints on one thread and what `ters run` prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("drift's step runs on the threads, and prints what it prints on one", () => {
  const ex = join(import.meta.dirname, "../../ters/examples/drift"), out = join(mkdtempSync(join(tmpdir(), "par-columns-")), "drift");
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  assert.match(readFileSync(`${out}.c`, "utf8"), /lab_range_\d+\(p1, p2\)/);
  const at = (workers: string, n: string) => spawnSync(out, [n], { encoding: "utf8", env: { ...process.env, TERS_WORKERS: workers, TERS_BRANCHES: "say" } });
  const one = at("0", "100000"), three = at("3", "100000");
  assert.equal(three.stdout, one.stdout);
  assert.match(three.stderr, /items on threads: [1-9]/);
  // Too few motes to wake the threads: as `ters run` prints.
  const run = spawnSync(process.execPath, [ters, "run", ex, "300"], { encoding: "utf8" });
  assert.equal(at("3", "300").stdout, run.stdout);
});
