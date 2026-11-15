// C242: a call whose answer is let to a local and given back as it is, at
// the end of a function, is a tail call in C. A tree lookup going on into
// a branch was a call, its status checked after; now it is a round of the
// lookup's loop. (scan's maps, where this was found, are hash tables since
// C243; crew's lookup by an Int is still a tree.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("crew's tree lookup is a loop in C (C242)", () => {
  const ex = join(import.meta.dirname, "../gaps/crew"), out = join(mkdtempSync(join(tmpdir(), "tail-lets-")), "crew");
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const c = readFileSync(`${out}.c`, "utf8");
  const at = c.search(/\nlab_int lab_tree_value_at(_\d+)?_b\(lab_cell \* p0, lab_int p1\) \{/);
  assert.ok(at > 0, "the lookup by an Int is lent its tree");
  const lookup = c.slice(at, c.indexOf("\n}\n", at));
  assert.match(lookup, /p0 = \w+;\n\s*continue;/);
  assert.doesNotMatch(lookup.slice(lookup.indexOf("{")), /lab_tree_value_at(_\d+)?_b\(/);
});
