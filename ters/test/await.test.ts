// Waiting for several things at once (BACKLOG L71b, ANSWERED-LATER.md
// "Typing await and together"): std's Await, Ticket and Branch, and the
// prelude's ticket id, any of and together. The world here is a handler
// written in the language, as L55's are: it answers a timer ticket with its
// value and says which of several is ready first by the least time. The
// tests after them use the real world's answers (L71c), on a fake clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { AWAIT_OP, START_TIMER_OP, CONS, INT_OPS, NIL, S, SHOW_ANY, TICKET_V } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program(actions: (k: Lang) => Id[]) {
  const k = new Lang(LIBRARY.code);
  const timer = (ms: number, v: Id) => k.call(AWAIT_OP, k.call(TICKET_V.timer, k.lit(ms), v));
  // The position of the soonest timer: (tickets, at, best, best time).
  const soonest = k.def("soonest");
  k.define(soonest, k.fn(["tickets", "at", "best", "best time"], (ts, at, best, bestT) => k.match(ts, [
    { variant: NIL, names: [], body: () => best },
    { variant: CONS, names: ["ticket", "others"], body: ([t, others]) => {
      const next = (b: Id, bt: Id) => k.call(soonest, others, k.call(INT_OPS.add, at, k.int(1)), b, bt);
      return k.match(t, [
        { variant: TICKET_V.timer, names: ["milliseconds", "value"], body: ([ms]) => k.if(k.call(S.less, ms, bestT), next(at, ms), next(best, bestT)) },
        { variant: TICKET_V.ticket, names: ["number"], body: () => next(best, bestT) },
        { variant: TICKET_V.firstReady, names: ["tickets", "which"], body: () => next(best, bestT) },
        { variant: TICKET_V.at, names: ["time", "value"], body: () => next(best, bestT) },
      ]);
    } },
  ])));
  const world = k.def("fake world");
  k.define(world, k.fn(["action"], (a) => k.handle(k.call(a), [
    { variant: AWAIT_OP, names: ["ticket", "rest"], body: ([t, rest]) => k.match(t, [
      { variant: TICKET_V.timer, names: ["milliseconds", "value"], body: ([ms, v]) => k.seq(k.call(S.print, k.text(k.lit("at "), k.call(S.show, ms))), k.call(rest, v)) },
      { variant: TICKET_V.firstReady, names: ["tickets", "which"], body: ([ts, which]) => k.call(rest, k.call(which, k.call(soonest, ts, k.int(0), k.int(0), k.lit(1e300)))) },
      // A world ticket: not this world's; nothing more runs.
      { variant: TICKET_V.ticket, names: ["number"], body: () => NIL },
      { variant: TICKET_V.at, names: ["time", "value"], body: () => NIL },
    ]) },
    // This world starts no timers of its own.
    { variant: START_TIMER_OP, names: ["milliseconds"], body: () => k.call(TICKET_V.ticket, k.int(0)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(world, k.thunk(() => k.call(lib("together"), k.list(...actions(k).map((body) => k.thunk(() => body))))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const printed: string[] = [];
  return { code, names, info, timer, k, run: () => { runMain(code, info, main, { print: (s) => printed.push(s), names }); return printed; } };
}

test("together: each action runs until it awaits, and the ticket ready first goes on; the values in the actions' order", () => {
  let timer!: (ms: number, v: Id) => Id;
  const p = program((k) => {
    timer = (ms, v) => k.call(AWAIT_OP, k.call(TICKET_V.timer, k.lit(ms), v));
    return [
      // await at Text and at Float64 in one action: await's a is its own (L71a).
      k.let("x", timer(30, k.lit("a")), (x) => k.text(x, k.call(S.show, timer(50, k.lit(2))))),
      timer(40, k.lit("b")),
    ];
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.deepEqual(p.run(), ["at 30", "at 40", "at 50", '["a2", "b"]']);
});

test("an action that never awaits is done at once, and together of none is []", () => {
  const p = program((k) => [k.lit("now"), k.call(AWAIT_OP, k.call(TICKET_V.timer, k.lit(5), k.lit("later")))]);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.deepEqual(p.run(), ["at 5", '["now", "later"]']);
  const none = program(() => []);
  assert.deepEqual(none.info.errors.map((e) => e.message), []);
  assert.deepEqual(none.run(), ["[]"]);
});

test("the types: one await for every ticket type, any of a Ticket Int, together's actions wait and nothing else", () => {
  const code = base(LIBRARY.code), names = baseNames(LIBRARY.names), info = infer(code, names);
  const type = (n: string) => showType(info.typeOf.get(lib(n))!, names);
  assert.equal(type("ticket id"), "(Ticket a) -> Ticket Unit");
  assert.equal(type("any of"), "(List (Ticket Unit)) -> Ticket Int");
  assert.equal(type("together"), "(List (() -[Await]-> a)) -[Diverge, Await]-> List a");
});

// The world answers await (L71c): a fake clock that only moves when waited on.
function worldProgram(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, body(k)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  let clock = 1000;
  const printed: string[] = [], waits: number[] = [];
  const world = { now: () => clock, wait: (ms: number) => { waits.push(ms); clock += ms; } };
  return { info, run: () => { runMain(code, info, main, { print: (s) => printed.push(s), names, world } as Parameters<typeof runMain>[3]); return { printed, waits, clock }; } };
}
const slow = (k: Lang, ms: number, v: string) => k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(ms)), (t) => k.seq(k.call(AWAIT_OP, t), k.lit(v))));

test("the world: together waits on its clock until the last ticket, and gives the values in order", () => {
  const p = worldProgram((k) => k.call(lib("together"), k.list(slow(k, 50, "slow"), slow(k, 20, "fast"))));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.deepEqual(p.run(), { printed: ['["slow", "fast"]'], waits: [20, 30], clock: 1050 });
});

test("the world: race gives the first to finish, and within gives none when its timer is first", () => {
  const race = worldProgram((k) => k.call(lib("race"), k.list(slow(k, 50, "slow"), slow(k, 20, "fast"))));
  assert.deepEqual(race.info.errors.map((e) => e.message), []);
  assert.deepEqual(race.run(), { printed: ['"fast"'], waits: [20], clock: 1020 });
  const late = worldProgram((k) => k.call(lib("within"), k.lit(10), slow(k, 50, "slow")));
  assert.deepEqual(late.info.errors.map((e) => e.message), []);
  assert.deepEqual(late.run(), { printed: ["none"], waits: [10], clock: 1010 });
  const soon = worldProgram((k) => k.call(lib("within"), k.lit(100), slow(k, 20, "fast")));
  assert.deepEqual(soon.run(), { printed: ['some("fast")'], waits: [20], clock: 1020 });
});

test("the types of race and within", () => {
  const code = base(LIBRARY.code), names = baseNames(LIBRARY.names), info = infer(code, names);
  const type = (n: string) => showType(info.typeOf.get(lib(n))!, names);
  assert.equal(type("race"), "(List (() -[Await]-> a)) -[Diverge, Await]-> a");
  assert.equal(type("within"), "(Float64, () -[Await]-> a) -[Diverge, Await]-> Optional a");
});
