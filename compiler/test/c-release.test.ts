// A handler's release on C (L213a6, release.test.ts for the others): run
// after the handler on a normal exit, and on an Abort handled further out
// or not, as the evaluator runs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ABORT_OP, INT_OPS, LOG_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

// Quit never returns, and its handler gives 7; the handler logs "closed"
// when it ends. `body` runs under it, `around` around it. (C has no
// handler yet of an operation that answers, unless it's fused away.)
function both(body: (k: Lang, quit: () => Id) => Id, around?: (k: Lang, inner: Id) => Id) {
  const k = new Lang();
  const quit = k.effect("Quit", [["quit", []]]);
  const main = k.def("main");
  const say = (t: string) => k.call(LOG_OP, k.lit(t));
  const handled = () => k.handle(body(k, () => k.call(quit.op.quit)),
    [{ variant: quit.op.quit, names: [], body: () => k.int(7) }], undefined, () => say("closed"));
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, around ? around(k, handled()) : handled()))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluator: string[] = [];
  try { runMain(code, info, main, { print: (l) => evaluator.push(l), names, world: { log: (l: string) => evaluator.push(`log ${l}`) } as never }); } catch (e) { evaluator.push(`aborted ${(e as { reason?: unknown }).reason}`); }
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main }).c), []);
  // Printed lines on standard output, logged ones on standard error:
  // each in its order, and an Abort's reason last on standard error.
  const c = r.stdout.toString().split("\n").filter((x) => x);
  const err = r.stderr.toString().split("\n").filter((x) => x);
  const logged = (r.status ? err.slice(0, -1) : err).map((x) => `log ${x}`);
  return { evaluator: { out: evaluator.filter((x) => !x.startsWith("log ")), log: evaluator.filter((x) => x.startsWith("log ")) }, c: { out: [...c, ...(r.status ? [`aborted ${err.at(-1)}`] : [])], log: logged } };
}

const work = (k: Lang) => k.call(LOG_OP, k.lit("working"));

test("C runs a release after the handler: on a normal exit, after its own case, and on an Abort handled further out or not", { skip }, () => {
  const normal = both((k) => k.seq(work(k), k.call(INT_OPS.add, k.int(40), k.int(42))));
  assert.deepEqual(normal.evaluator, { out: ["82"], log: ["log working", "log closed"] });
  assert.deepEqual(normal.c, normal.evaluator);
  const quit = both((k, q) => k.seq(work(k), q(), k.int(1)));
  assert.deepEqual(quit.evaluator, { out: ["7"], log: ["log working", "log closed"] });
  assert.deepEqual(quit.c, quit.evaluator);
  const caught = both((k) => k.seq(work(k), k.call(ABORT_OP, k.lit("gave up")), k.int(1)),
    (k, inner) => k.handle(inner, [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.seq(k.call(S.print, k.text(k.lit("caught "), why)), k.int(0)) }]));
  assert.deepEqual(caught.evaluator, { out: ["caught gave up", "0"], log: ["log working", "log closed"] });
  assert.deepEqual(caught.c, caught.evaluator);
  const uncaught = both((k) => k.seq(work(k), k.call(ABORT_OP, k.lit("gave up")), k.int(1)));
  assert.deepEqual(uncaught.evaluator, { out: ["aborted gave up"], log: ["log working", "log closed"] });
  assert.deepEqual(uncaught.c, uncaught.evaluator);
});
