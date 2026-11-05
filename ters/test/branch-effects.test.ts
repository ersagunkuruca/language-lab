// together, race and within take actions with other effects (BACKLOG L149,
// REVIEW-2026-11-02 §1): a Branch has a row parameter, `Branch r e`, whose
// `resume : () -[Await, e]-> Branch r e` carries what the action does
// besides waiting (Koka's effect-polymorphic data, Leijen 2014), so a
// branch may print, abort, fetch or draw, and together's type says so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { ABORT_OP, AWAIT_OP, START_TIMER_OP, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { compiledMain } from "../../compiler/src/core-js.ts";


const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function run(build: (k: Lang) => string) {
  const k = new Lang(LIBRARY.code);
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const printed: string[] = [];
  if (main && !info.errors.length) runMain(code, info, main, { print: (s) => printed.push(s), names, world: { now: () => 0, wait: () => assert.fail("waited for real") } } as Parameters<typeof runMain>[3]);
  // main compiled through the core IR, the same world (C180).
  const compiled = () => { const out: string[] = []; compiledMain(code, info, names, { print: (s: string) => out.push(s), world: { now: () => 0, wait: () => assert.fail("waited for real") } } as never); return out; };
  return { errors: info.errors.map((e) => e.message), printed, info, names, code, main, compiled };
}

// Each branch prints, waits on a timer, and prints again.
const chatty = (k: Lang, name: string, ms: number) => k.thunk(() => k.seq(
  k.call(S.print, k.lit(`${name} starts`)),
  k.let("t", k.call(START_TIMER_OP, k.lit(ms)), (t) => k.seq(k.call(AWAIT_OP, t), k.call(S.print, k.lit(`${name} ends`)), k.lit(name)))));

test("two printing branches under simulated: their lines in the clock's order, evaluated and compiled", async () => {
  const r = run((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("simulated"), k.lit(1), k.thunk(() => k.call(lib("together"), k.list(chatty(k, "slow", 2000), chatty(k, "quick", 1000)))))))));
    return main;
  });
  assert.deepEqual(r.errors, []);
  const want = ["slow starts", "quick starts", "quick ends", "slow ends", '["slow", "quick"]'];
  assert.deepEqual(r.printed, want);
  // A core IR gap: the simulated world keeps the rest for later (C180).
  assert.throws(() => r.compiled(), /keeping the rest for later/);
});

test("together's type carries its actions' effects besides Await", () => {
  const r = run(() => "");
  const t = showType(r.info.typeOf.get(lib("together"))!, r.names);
  assert.equal(t, "(List (() -[Diverge, Await, e]-> a)) -[Diverge, Await, e]-> List a");
  assert.equal(showType(r.info.typeOf.get(lib("start branch"))!, r.names), "(() -[Await, e]-> a) -[Await, e]-> Branch a [e]");
});

test("an aborting branch under attempt: together stops, and attempt has the reason", () => {
  const r = run((k) => {
    const main = k.def("main");
    const failing = k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(10)), (t) => k.seq(k.call(AWAIT_OP, t), k.call(ABORT_OP, k.lit("no luck")))));
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("simulated"), k.lit(1), k.thunk(() => k.call(lib("attempt"), k.thunk(() => k.call(lib("together"), k.list(chatty(k, "slow", 2000), failing))))))))));
    return main;
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.printed, ["slow starts", 'refused("no luck")']);
});
