// C243 (HASH-KEYS-2026-11-15.md): in C, a hash table's key may be data.
// scan maps each set of NFA states, and each block's signature (a list),
// to an Int, so its maps were all trees; now they are C's hash tables, its
// DFA's moves read in a few dozen instructions, and it prints what
// `ters run` prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("scan's maps are C's hash tables, one keyed by data, and scan prints what ters run prints (C243)", () => {
  const ex = join(import.meta.dirname, "../gaps/scan"), out = join(mkdtempSync(join(tmpdir(), "data-keys-")), "scan");
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const c = readFileSync(`${out}.c`, "utf8");
  assert.match(c, /\n\/\/ Table \d+: data keys, lab_int values\./);
  assert.doesNotMatch(c, /\nlab_\w+ lab_tree_value_at(_\d+)?_b\(/);
  const native = spawnSync(out, ["40"], { encoding: "utf8" }), run = spawnSync(process.execPath, [ters, "run", ex, "40"], { encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, run.stdout);
});
