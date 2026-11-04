// A handler's release (BACKLOG L213a, RESOURCES-2026-11-03.md §1): a case
// run once when the handler ends, by any exit: its normal finish (after
// the finish's case), an Abort handled further out (before that handler's
// case), an Abort nothing caught, the stop. A release may only log, and a
// handler with one can't let a Choice through.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { Aborted, runMain } from "../src/lang/run.ts";
import { compile } from "../../compiler/src/compile.ts";
import { lowerCore } from "../../compiler/src/core-js.ts";
import { ABORT_OP, INT_OPS, LOG_OP, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

// Ask answers 41; the handler logs "opened" when asked and "closed" when
// it ends. `body` is what runs under it.
function program(body: (k: Lang, ask: () => Id) => Id, around?: (k: Lang, inner: Id) => Id) {
  const k = new Lang();
  const ask = k.effect("Ask", [["ask", [], () => k.tref("type.int")]]);
  const main = k.def("main");
  const log = (t: string) => k.call(LOG_OP, k.lit(t));
  const handled = () => k.handle(body(k, () => k.call(ask.op.ask)),
    [{ variant: ask.op.ask, names: [], body: () => k.seq(log("opened"), k.int(41)) }],
    ["x", (x) => k.seq(log("finished"), k.call(INT_OPS.add, x, k.int(1)))],
    () => log("closed"));
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, around ? around(k, handled()) : handled()))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const logged: string[] = [], printed: string[] = [];
  const run = () => runMain(code, info, main, { print: (l) => printed.push(l), names, world: { log: (l: string) => logged.push(l) } as never });
  return { code, info, names, main, run, logged, printed };
}

test("a release runs once after the normal finish", () => {
  const p = program((k, ask) => k.call(INT_OPS.add, ask(), ask()));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  p.run();
  assert.deepEqual(p.logged, ["opened", "opened", "finished", "closed"]);
  assert.deepEqual(p.printed, ["83"]);
});

test("an Abort handled further out runs the release first, once", () => {
  const p = program((k, ask) => k.seq(ask(), k.call(ABORT_OP, k.lit("gave up")), ask()),
    (k, inner) => k.handle(inner, [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.seq(k.call(LOG_OP, k.text(k.lit("caught "), why)), k.int(0)) }]));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  p.run();
  assert.deepEqual(p.logged, ["opened", "closed", "caught gave up"]);
  assert.deepEqual(p.printed, ["0"]);
});

test("an Abort nothing catches still runs the release, once", () => {
  const p = program((k, ask) => k.seq(ask(), k.call(ABORT_OP, k.lit("gave up"))));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.throws(() => p.run(), (e) => e instanceof Aborted && e.reason === "gave up");
  assert.deepEqual(p.logged, ["opened", "closed"]);
});

test("an Abort handled by the handler's own effect's case: the release runs after that case", () => {
  // Two handlers with releases, nested: the inner one ends with the
  // outer's Abort, before the outer's case; the outer's after it.
  const k = new Lang();
  const main = k.def("main");
  const log = (t: string) => k.call(LOG_OP, k.lit(t));
  k.define(main, k.thunk(() => k.call(S.print, k.handle(
    k.handle(k.seq(log("working"), k.call(ABORT_OP, k.lit("stop"))), [{ variant: LOG_OP, names: ["line"], body: ([l]) => k.call(LOG_OP, k.text(k.lit("inner: "), l)) }], undefined, () => log("inner closed")),
    [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.seq(log("outer case"), why) }], undefined, () => log("outer closed")))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const logged: string[] = [], printed: string[] = [];
  runMain(code, info, main, { print: (l) => printed.push(l), names, world: { log: (l: string) => logged.push(l) } as never });
  assert.deepEqual(logged, ["inner: working", "inner closed", "outer case", "outer closed"]);
  assert.deepEqual(printed, ["stop"]);
});

test("a release may only log, and a handler with one can't let a Choice through", () => {
  const k = new Lang();
  const ask = k.effect("Ask", [["ask", [], () => k.tref("type.int")]]);
  const prints = k.def("prints in its release");
  k.define(prints, k.thunk(() => k.handle(k.call(ask.op.ask), [{ variant: ask.op.ask, names: [], body: () => k.int(1) }], undefined, () => k.call(S.print, k.lit("bye")))));
  const searches = k.def("lets a Choice through");
  k.define(searches, k.thunk(() => k.handle(k.call(S.oneOf, k.list(k.call(ask.op.ask), k.int(2))), [{ variant: ask.op.ask, names: [], body: () => k.int(1) }], undefined, () => k.call(LOG_OP, k.lit("bye")))));
  const info = infer(base(k.code), baseNames(k.names));
  const errors = info.errors.map((e) => e.message);
  assert.equal(errors.length, 2, errors.join("\n"));
  assert.match(errors.join("\n"), /may only log: this one performs Console/);
  assert.match(errors.join("\n"), /can't let a Choice through/);
});

test("compiled code says a release isn't compiled yet", () => {
  const p = program((k, ask) => ask());
  assert.throws(() => compile(p.code, p.info, p.names, { runtime: "x", exports: ["main"] }), /release isn't compiled yet/);
  const l = lowerCore(p.code, p.info, p.names, [p.main]);
  assert.match([...l.refused.values()].join("\n"), /release, which isn't lowered yet/);
});
