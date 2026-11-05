// The steps of an effect (BACKLOG L229b, ANSWERED-LATER.md "The steps of
// an effect"): `steps of E(c)` gives c's first operation of E back as
// data with its rest, a case of `Steps of E` per operation plus done. The
// scheduler of later.test.ts written on it, with no Step type of its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { stepsOf } from "../src/lang/steps.ts";
import { CONS, NIL, S, UNIT, UNIT_V } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

const lib = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

function program(build: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const printed: string[] = [];
  const run = () => { runMain(code, info, main, { print: (s) => printed.push(s), names }); return printed; };
  return { errors: info.errors.map((e) => e.message), run, type: (d: Id) => showType(info.typeOf.get(d)!, names) };
}
const say = (k: Lang, ...parts: Id[]) => k.call(S.print, parts.length === 1 ? parts[0] : k.text(...parts));

test("a scheduler of two fibers on the steps of Yield: no Step type of its own", () => {
  let steps = "", first = "";
  const p = program((k) => {
    const Y = k.effect("Yield", [["yield", [], () => k.tref(UNIT), "later"]]);
    const St = stepsOf(k, Y.def);
    steps = St.steps;
    const fiber = k.def("fiber");
    k.define(fiber, k.fn(["name"], (name) => k.thunk(() => k.seq(say(k, name, k.lit("1")), k.call(Y.op.yield), say(k, name, k.lit("2")), k.call(Y.op.yield), say(k, name, k.lit("3"))))));
    // The queue holds what runs a fiber to its next step: at first its
    // steps, then the rest it parked with.
    const schedule = k.def("schedule");
    k.define(schedule, k.fn(["queue"], (q) => k.match(q, [
      { variant: NIL, names: [], body: () => k.x(UNIT_V) },
      { variant: CONS, names: ["next", "others"], body: ([next, others]) => k.match(k.call(next, k.x(UNIT_V)), [
        { variant: St.done, names: ["value"], body: () => k.call(schedule, others) },
        { variant: St.v[Y.op.yield], names: ["rest"], body: ([rest]) => k.call(schedule, k.call(lib("append"), others, k.list(rest))) },
      ]) },
    ])));
    const begin = (name: string) => k.fn(["go"], () => k.call(St.steps, k.call(fiber, k.lit(name))));
    first = k.def("first step");
    k.define(first, k.thunk(() => k.call(St.steps, k.call(fiber, k.lit("a")))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(schedule, k.list(begin("a"), begin("b")))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["a1", "b1", "a2", "b2", "a3", "b3"]);
  assert.equal(p.type(steps), "(() -[Yield, e]-> a) -[e]-> Steps of Yield a [e]");
  // A rest's row is the computation's less Yield: Console, no Diverge.
  assert.equal(p.type(first), "() -[Console, e]-> Steps of Yield Unit [Console, e]");
});

test("an effect whose operations are answered now has no steps yet", () => {
  const k = new Lang(LIBRARY.code);
  const A = k.effect("Ask", [["ask", [], () => k.tref(UNIT)]]);
  assert.throws(() => stepsOf(k, A.def), /can't take the steps of Ask: its operation .* isn't answered later/);
});
