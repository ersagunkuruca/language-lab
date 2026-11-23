// A cell's function is a plain one (C314, scalar.ts cellBox): conjugate-
// page has a waiting function of the type its list cell holds, `() ->
// List Float64`, and the cell took that several type, its giver keeping
// the list as the status's i32. GCC 14 and later refuse the C (an
// integer from a pointer); older ones truncated the pointer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CFLAGS } from "../src/c.ts";
import { cc, skip } from "./c-harness.ts";

test("a cell of a type some waiting function has builds natively, its value a pointer (C314)", { skip }, () => {
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), dir = mkdtempSync(join(tmpdir(), "cell-plain-")), out = join(dir, "conjugate-page");
  const made = spawnSync(process.execPath, [ters, "native", join(import.meta.dirname, "../../ters/examples/conjugate-page"), "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const strict = spawnSync(cc, [...CFLAGS, "-pthread", "-Werror=int-conversion", "-c", "-o", join(dir, "p.o"), `${out}.c`], { encoding: "utf8" });
  assert.equal(strict.status, 0, strict.stderr);
});
