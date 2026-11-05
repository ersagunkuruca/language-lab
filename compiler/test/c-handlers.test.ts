// A program's own handlers on C (L213c4): operations answered at once,
// their cases on C's handler stack, the nearest answering, popped however
// the code ends. What it prints is the evaluator's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ABORT_OP, INT_OPS, LOG_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

test("C answers a program's own operations by the nearest handler, its release run as it ends", { skip }, () => {
  const k = new Lang();
  const ask = k.effect("Ask", [["ask", [["by", () => k.tref("type.int")]], () => k.tref("type.int")]]);
  // Asked from a function of its own, so the handler is found as the
  // code runs, not where it's written.
  const twice = k.def("twice");
  k.define(twice, k.thunk(() => k.call(INT_OPS.add, k.call(ask.op.ask, k.int(1)), k.call(ask.op.ask, k.int(2)))));
  const answering = (n: number, body: () => import("../../ters/src/model.ts").Id, release?: string) => k.handle(body(),
    [{ variant: ask.op.ask, names: ["by"], body: ([by]) => k.call(INT_OPS.mul, by, k.int(n)) }], undefined, release ? () => k.call(LOG_OP, k.lit(release)) : undefined);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, answering(10, () => k.call(INT_OPS.add, k.call(twice), answering(100, () => k.call(twice), "inner closed")), "outer closed"))),
    k.call(S.print, k.call(SHOW_ANY, answering(1000, () => k.call(twice)))),
    k.call(S.print, k.call(SHOW_ANY, k.handle(answering(5, () => k.seq(k.call(twice), k.call(ABORT_OP, k.lit("gave up")), k.int(1)), "closed on abort"),
      [{ variant: ABORT_OP, names: ["why"], body: () => k.int(0) }]))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want: string[] = [];
  runMain(code, info, main, { print: (l) => want.push(l), names, world: { log: (l: string) => want.push(`log ${l}`) } as never });
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main }).c), []);
  assert.equal(r.status, 0, r.stderr.toString());
  const printed = want.filter((x) => !x.startsWith("log "));
  assert.deepEqual(printed, ["330", "3000", "0"]);
  assert.deepEqual(want.filter((x) => x.startsWith("log ")), ["log inner closed", "log outer closed", "log closed on abort"]);
  assert.deepEqual(r.stdout.toString().split("\n").filter((x) => x), printed);
  assert.deepEqual(r.stderr.toString().split("\n").filter((x) => x).map((x) => `log ${x}`), want.filter((x) => x.startsWith("log ")));
});
