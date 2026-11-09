// ters native and a program's own effect it handles itself (examples/effects'
// Ask): the handler is on C's handler stack (L213c4); only an effect the
// program never handles is the host's (hosts/c.c, L69b1). effects was
// refused natively before: its handler was taken for a host's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const run = (dir: string, file: string, args: string[]) => { const r = spawnSync(file, args, { cwd: dir, encoding: "utf8" }); return [r.stdout, r.stderr, r.status] as const; };

test("examples/effects, which handles its own Ask, runs natively as ters run runs it", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "handled-own-"));
  const ex = join(import.meta.dirname, "../../ters/examples/effects");
  const made = run(dir, process.execPath, [lab, "native", ex, "-o", join(dir, "p")]);
  assert.equal(made[2], 0, made[1]);
  const want = run(dir, process.execPath, [lab, "run", ex]);
  assert.deepEqual(want, ["360 · can't: nobody to share with\n", "", 0]);
  assert.deepEqual(run(dir, join(dir, "p"), []), want);
});
