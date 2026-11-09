// A program that waits, native through C (C44a): `wait` sleeps, a timer is
// a ticket at its deadline on the world's clock, and `await` of one sleeps
// until then, so the run prints what `ters run` prints, as long after.
// Waiting on several tickets at once (together, race) needs fibers (C44).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { AWAIT_OP, NOW_OP, S, SHOW_ANY, START_TIMER_OP, WAIT_OP } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { skip } from "./c-harness.ts";

test("a native program waits, starts a timer and awaits it, as ters run does (C44a)", { skip }, () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  // a, a 30 ms wait, b, a 20 ms timer awaited, c, then whether 50 ms passed.
  k.define(main, k.thunk(() => k.let("start", k.call(NOW_OP), (start) => k.seq(
    k.call(S.print, k.lit("a")),
    k.call(WAIT_OP, k.lit(30)),
    k.call(S.print, k.lit("b")),
    k.let("t", k.call(START_TIMER_OP, k.lit(20)), (t) => k.call(AWAIT_OP, t)),
    k.call(S.print, k.lit("c")),
    k.call(S.print, k.call(SHOW_ANY, k.call(S.less, k.lit(49), k.call(B.sub, k.call(NOW_OP), start))))))));
  const dir = mkdtempSync(join(tmpdir(), "waits-c-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const run = (file: string, args: string[]) => { const r = spawnSync(file, args, { cwd: dir, encoding: "utf8" }); return [r.stdout, r.stderr, r.status] as const; };
  const made = run(process.execPath, [lab, "native", dir, "-o", "p"]);
  assert.equal(made[2], 0, made[1]);
  const want = run(process.execPath, [lab, "run", dir]);
  assert.deepEqual(want, ["a\nb\nc\ntrue\n", "", 0]);
  assert.deepEqual(run(join(dir, "p"), []), want);
});
