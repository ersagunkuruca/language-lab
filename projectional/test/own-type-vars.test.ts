// An operation's own type variables (BACKLOG L71a, ANSWERED-LATER.md
// "Typing await and together"): a variable in an operation's types that
// isn't its effect's is the operation's, fresh at each call and rigid in
// the case that handles it. So one handler answers `pick` at a number and
// at a text in the same scope, and a case can't pretend the answer is a
// text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { LIST, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

// effect Pick = pick(first: a, others: List a) → a, with its own a.
function program(answer: (k: Lang, first: Id) => Id, own = true) {
  const k = new Lang();
  const pick = own
    ? k.effect("Pick", [["pick", [["first", (ps) => k.tref(ps[0])], ["others", (ps) => k.tref(LIST, k.tref(ps[0]))]], (ps) => k.tref(ps[0]), undefined, ["a"]]])
    : k.effect("Pick", [["pick", [["first", (ps) => k.tref(ps[0])], ["others", (ps) => k.tref(LIST, k.tref(ps[0]))]], (ps) => k.tref(ps[0])]], ["a"]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.handle(k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(pick.op.pick, k.int(1), k.list(k.int(2))))),
    k.call(S.print, k.call(pick.op.pick, k.lit("x"), k.list(k.lit("y")))),
  ), [{ variant: pick.op.pick, names: ["first", "others"], body: ([first]) => answer(k, first) }])));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, info: infer(code, names) };
}

test("an operation's own type variable is fresh at each call: one handler answers it at Int and at Text", () => {
  const p = program((_, first) => first);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const out: string[] = [];
  runMain(p.code, p.info, p.main, { print: (s) => out.push(s), names: p.names });
  assert.deepEqual(out, ["1", "x"]);
});

test("in its case it is rigid: an answer of one particular type is refused", () => {
  const p = program((k) => k.lit("always text"));
  assert.ok(p.info.errors.length > 0, "a case answered pick with a Text for every a");
});

test("as the effect's parameter instead, it is one type for the whole scope", () => {
  const p = program((_, first) => first, false);
  assert.ok(p.info.errors.length > 0, "Pick a was used at Int and at Text in one handler");
});
