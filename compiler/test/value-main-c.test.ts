// A main that is a value, native (ters native): it prints it as ters run
// does, a Text as it is and anything else shown. lockstep's main is a
// Text; native printed nothing before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const run = (dir: string, file: string, args: string[]) => { const r = spawnSync(file, args, { cwd: dir, encoding: "utf8" }); return [r.stdout, r.stderr, r.status] as const; };

test("lockstep's main, a Text, prints natively as ters run prints it", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "value-main-"));
  const ex = join(import.meta.dirname, "../../ters/examples/lockstep");
  const made = run(dir, process.execPath, [lab, "native", ex, "-o", join(dir, "p")]);
  assert.equal(made[2], 0, made[1]);
  const want = run(dir, process.execPath, [lab, "run", ex]);
  assert.match(want[0], /^position -0\.34/);
  assert.deepEqual(run(dir, join(dir, "p"), []), want);
});

test("a main that is a list prints it shown, natively as ters run", { skip }, () => {
  const k = new Lang(LIBRARY.code);
  k.define(k.def("main"), k.list(k.lit(1), k.lit(2.5), k.lit(3)));
  const dir = mkdtempSync(join(tmpdir(), "value-main-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const made = run(dir, process.execPath, [lab, "native", dir, "-o", "p"]);
  assert.equal(made[2], 0, made[1]);
  const want = run(dir, process.execPath, [lab, "run", dir]);
  assert.deepEqual(want, ["[1, 2.5, 3]\n", "", 0]);
  assert.deepEqual(run(dir, join(dir, "p"), []), want);
});
