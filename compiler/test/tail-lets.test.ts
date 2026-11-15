// C242: a call whose answer is let to a local and given back as it is, at
// the end of a function, is a tail call in C. scan's tree lookup going on
// into a branch was a call, its status checked after; now it is a round of
// the lookup's loop, and the program prints what `ters run` prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("scan's tree lookup is a loop in C, and scan prints what ters run prints (C242)", () => {
  const ex = join(import.meta.dirname, "../gaps/scan"), out = join(mkdtempSync(join(tmpdir(), "tail-lets-")), "scan");
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const c = readFileSync(`${out}.c`, "utf8");
  const at = c.search(/\nlab_int lab_tree_value_at(_\d+)?_b\(lab_cell \* p0, Tuple2 p1\) \{/);
  assert.ok(at > 0, "the lookup by pairs is lent its tree");
  const lookup = c.slice(at, c.indexOf("\n}\n", at));
  assert.match(lookup, /p0 = \w+;\n\s*continue;/);
  assert.doesNotMatch(lookup.slice(lookup.indexOf("{")), /lab_tree_value_at(_\d+)?_b\(/);
  const native = spawnSync(out, ["40"], { encoding: "utf8" }), run = spawnSync(process.execPath, [ters, "run", ex, "40"], { encoding: "utf8" });
  assert.equal(native.stdout, run.stdout);
});
