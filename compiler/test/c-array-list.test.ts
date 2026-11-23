// An array's list type (scalar.ts, `a.list`): the List of its items a job
// takes or gives, never an item that is data. countdown-page's array of
// Ops, its `first` an Op (an enum), took Op for the array's list, and C
// had no case with fields to name (C294's sweep, with clinic-page and
// moths-page: a Mark's array spelled its items as cons cells).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("pages whose arrays hold an enum's or a data type's values build natively", () => {
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "array-list-"));
  for (const name of ["countdown-page", "moths-page"]) {
    const made = spawnSync(process.execPath, [ters, "native", join(import.meta.dirname, "../../ters/examples", name), "-o", join(dir, name)], { encoding: "utf8" });
    assert.equal(made.status, 0, `${name}: ${made.stderr}`);
  }
});
