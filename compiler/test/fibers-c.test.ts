// A program's own handlers whose cases keep the rest, native through C
// (C44b): the code handled runs on a fiber, a perform goes out to the
// handler's driver, and the rest goes back in. Each program is later.test's,
// and the native run prints what `lab run` prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ABORT_OP, AWAIT_OP, CONS, NIL, S, SHOW_ANY, START_TIMER_OP, UNIT, UNIT_V } from "../../ters/src/lang/std.ts";
import { CONSOLE, DIVERGE, NUMBER, STRING } from "../../ters/src/lang/types.ts";
import { B } from "../../ters/src/prelude.ts";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/lab.ts");
const lib = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
const say = (k: Lang, ...parts: Id[]) => k.call(S.print, parts.length === 1 ? parts[0] : k.text(...parts));

// main built, made native, and run beside lab run: both outputs.
function native(build: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  build(k);
  const dir = mkdtempSync(join(tmpdir(), "fibers-c-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const run = (file: string, args: string[]) => { const r = spawnSync(file, args, { cwd: dir, encoding: "utf8" }); return [r.stdout, r.stderr, r.status] as const; };
  const made = run(process.execPath, [lab, "native", dir, "-o", "p"]);
  assert.equal(made[2], 0, made[1]);
  return { want: run(process.execPath, [lab, "run", dir]), got: run(join(dir, "p"), []) };
}

test("a generator, a case that drops the rest, and nested handlers, native as lab run (C44b)", { skip }, () => {
  const programs: [string, (k: Lang) => void][] = [
    ["start\ngot 1\ngot 2\ngot 3\nend\n[1, 2, 3]\n", (k) => {
      const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
      const three = k.def("three");
      k.define(three, k.thunk(() => k.seq(say(k, k.lit("start")), k.call(Y.op.yield, k.lit(1)), k.call(Y.op.yield, k.lit(2)), k.call(Y.op.yield, k.lit(3)), say(k, k.lit("end")), k.x(NIL))));
      const collect = k.def("collect");
      k.define(collect, k.thunk(() => k.handle(k.call(three), [
        { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.seq(say(k, k.lit("got "), k.call(S.show, item)), k.call(CONS, item, k.call(rest, k.x(UNIT_V)))) },
      ])));
      k.define(k.def("main"), k.thunk(() => say(k, k.call(SHOW_ANY, k.call(collect)))));
    }],
    ["before\n0\n", (k) => {
      const A = k.effect("Ask", [["ask", [["question", () => k.tref(STRING)]], () => k.tref(NUMBER), "later"]]);
      k.define(k.def("main"), k.thunk(() => say(k, k.call(S.show, k.handle(k.seq(say(k, k.lit("before")), k.let("w", k.call(A.op.ask, k.lit("width")), (w) => k.seq(say(k, k.lit("after")), w))), [
        { variant: A.op.ask, names: ["question", "rest"], body: () => k.lit(0) },
      ])))));
    }],
    ["asked\nasked\n[10, 11]\n", (k) => {
      const A = k.effect("Ask", [["ask", [], () => k.tref(NUMBER), "later"]]);
      const Y = k.effect("Yield", [["yield", [["item", () => k.tref(NUMBER)]], () => k.tref(UNIT), "later"]]);
      k.define(k.def("main"), k.thunk(() => say(k, k.call(SHOW_ANY, k.handle(
        k.handle(k.seq(k.call(Y.op.yield, k.call(A.op.ask)), k.call(Y.op.yield, k.call(B.add, k.call(A.op.ask), k.lit(1))), k.x(NIL)), [
          { variant: Y.op.yield, names: ["item", "rest"], body: ([item, rest]) => k.call(CONS, item, k.call(rest, k.x(UNIT_V))) },
        ]),
        [{ variant: A.op.ask, names: ["rest"], body: ([rest]) => k.seq(say(k, k.lit("asked")), k.call(rest, k.lit(10))) }],
      )))));
    }],
  ];
  for (const [out, build] of programs) {
    const { want, got } = native(build);
    assert.deepEqual(want, [out, "", 0]);
    assert.deepEqual(got, want);
  }
});

test("a scheduler of two fibers, round robin: each rest kept in a list and resumed later, native as lab run (C44b)", { skip }, () => {
  const { want, got } = native((k) => {
    const Y = k.effect("Yield", [["yield", [], () => k.tref(UNIT), "later"]]);
    const Step = k.type("Step", [], [
      ["finished", []],
      ["parked", [["rest", (self) => k.tfun([k.tref(UNIT)], k.tref(self), [CONSOLE, DIVERGE])]]],
    ]);
    const fiber = k.def("fiber");
    k.define(fiber, k.fn(["name"], (name) => k.thunk(() => k.seq(say(k, name, k.lit("1")), k.call(Y.op.yield), say(k, name, k.lit("2")), k.call(Y.op.yield), say(k, name, k.lit("3"))))));
    const start = k.def("start");
    k.define(start, k.fn(["f"], (f) => k.fn(["go"], () => k.handle(k.seq(k.call(f), k.x(Step.v.finished)), [
      { variant: Y.op.yield, names: ["rest"], body: ([rest]) => k.call(Step.v.parked, rest) },
    ]))));
    const schedule = k.def("schedule");
    k.define(schedule, k.fn(["queue"], (q) => k.match(q, [
      { variant: NIL, names: [], body: () => k.x(UNIT_V) },
      { variant: CONS, names: ["next", "others"], body: ([next, others]) => k.match(k.call(next, k.x(UNIT_V)), [
        { variant: Step.v.finished, names: [], body: () => k.call(schedule, others) },
        { variant: Step.v.parked, names: ["rest"], body: ([rest]) => k.call(schedule, k.call(lib("append"), others, k.list(rest))) },
      ]) },
    ])));
    k.define(k.def("main"), k.thunk(() => k.call(schedule, k.list(k.call(start, k.call(fiber, k.lit("a"))), k.call(start, k.call(fiber, k.lit("b")))))));
  });
  assert.deepEqual(want, ["a1\nb1\na2\nb2\na3\nb3\n", "", 0]);
  assert.deepEqual(got, want);
});

// C44: together and race native, each action on a fiber of its own that an
// await parks till its ticket is ready (branch-effects.test's programs).
test("together, race, within, an aborting branch and together inside a branch, native as lab run (C44)", { skip }, () => {
  const chatty = (k: Lang, name: string, ms: number) => k.thunk(() => k.seq(
    k.call(S.print, k.lit(`${name} starts`)),
    k.let("t", k.call(START_TIMER_OP, k.lit(ms)), (t) => k.seq(k.call(AWAIT_OP, t), k.call(S.print, k.lit(`${name} ends`)), k.lit(name)))));
  const main = (body: (k: Lang) => Id) => (k: Lang) => k.define(k.def("main"), k.thunk(() => k.call(S.print, k.call(SHOW_ANY, body(k)))));
  const programs: [string, (k: Lang) => void][] = [
    ["slow starts\nquick starts\nquick ends\nslow ends\n[\"slow\", \"quick\"]\n", main((k) => k.call(lib("together"), k.list(chatty(k, "slow", 60), chatty(k, "quick", 30))))],
    ["slow starts\nquick starts\nquick ends\n\"quick\"\n", main((k) => k.call(lib("race"), k.list(chatty(k, "slow", 60), chatty(k, "quick", 30))))],
    ["slow starts\nnone\n", main((k) => k.call(lib("within"), k.lit(20), chatty(k, "slow", 60)))],
    ["slow starts\nrefused(\"no luck\")\n", main((k) => k.call(lib("attempt"), k.thunk(() => k.call(lib("together"), k.list(chatty(k, "slow", 60),
      k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(10)), (t) => k.seq(k.call(AWAIT_OP, t), k.call(ABORT_OP, k.lit("no luck"))))))))))],
    ['a starts\nb starts\nc starts\nb ends\nc ends\na ends\n["\\"a\\"", "[\\"b\\", \\"c\\"]"]\n', main((k) => k.call(lib("together"), k.list(
      k.thunk(() => k.call(SHOW_ANY, k.call(chatty(k, "a", 60)))),
      k.thunk(() => k.call(SHOW_ANY, k.call(lib("together"), k.list(chatty(k, "b", 20), chatty(k, "c", 40))))))))],
  ];
  for (const [out, build] of programs) {
    const { want, got } = native(build);
    assert.deepEqual(want, [out, "", 0]);
    assert.deepEqual(got, want);
  }
});
