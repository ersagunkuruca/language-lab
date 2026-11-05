// Handler names (BACKLOG L213b1, RESOURCES-2026-11-03.md §2): a handler
// may have a name, bound where it is entered, and an operation given that
// name first is answered by that handler, so two of the same effect can be
// open at once. Operations given no name go to the innermost handler
// without one, as before. A name is not a value: an operation's first
// input is the one place it may go, and a function that uses it can't
// leave its handler (L213b2). Effekt's capabilities and Koka's named
// handlers are the prior art.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { compile } from "../../compiler/src/compile.ts";
import { lowerCore } from "../../compiler/src/core-js.ts";
import { INT_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

// Ask answers a number: `outer` 1 and `inner` 10, both named, and an
// unnamed handler around them 1000. `body` runs inside, given the names.
function program(body: (k: Lang, ask: (name?: Id) => Id, names: { outer: Id; inner: Id; tell: Id }) => Id) {
  const k = new Lang();
  const ask = k.effect("Ask", [["ask", [], () => k.tref("type.int")]]);
  const other = k.effect("Tell", [["tell", [], () => k.tref("type.int")]]);
  const main = k.def("main");
  const answer = (n: number) => [{ variant: ask.op.ask, names: [], body: () => k.int(n) }];
  const call = (name?: Id) => (name ? k.call(ask.op.ask, k.x(name)) : k.call(ask.op.ask));
  const handled = k.handle(
    k.handleNamed("outer", (outer) => k.handleNamed("inner", (inner) => body(k, call, { outer, inner, tell: other.op.tell }), answer(10)), answer(1)),
    answer(1000));
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, handled))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const printed: string[] = [];
  const run = () => runMain(code, info, main, { print: (l) => printed.push(l), names });
  return { k, code, info, names, main, run, printed };
}

test("an operation given a name is answered by that handler", () => {
  const p = program((k, ask, { outer, inner }) => k.call(INT_OPS.add, k.call(INT_OPS.add, ask(outer), ask(inner)), ask()));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  p.run();
  // outer 1, inner 10, and the unnamed one past both named handlers 1000.
  assert.deepEqual(p.printed, ["1011"]);
});

test("a name is not a value", () => {
  const p = program((k, ask, { outer }) => k.let("kept", k.x(outer), () => ask(outer)));
  assert.deepEqual(p.info.errors.map((e) => e.message), ["outer is a handler's name, not a value: give it to one of Ask's operations as its first input"]);
});

test("a name goes only to its own effect's operations", () => {
  const p = program((k, _ask, { inner, tell }) => k.call(tell, k.x(inner)));
  assert.ok(p.info.errors.some((e) => /inner names a handler of Ask, so only Ask's operations take it/.test(e.message)), p.info.errors.map((e) => e.message).join("\n"));
});

test("compiled code refuses a named handler, with the reason", () => {
  const p = program((_k, ask, { outer }) => ask(outer));
  assert.throws(() => compile(p.code, p.info, p.names, { runtime: "x", exports: ["main"] }), /a handler with a name isn't compiled yet/);
  const l = lowerCore(p.code, p.info, p.names, [p.main]);
  assert.match([...l.refused.values()].join("\n"), /under a name, which isn't lowered yet/);
});

test("a function that uses a name can't leave its handler", () => {
  // The handler gives back `() => ask(outer)`: called later, outer's
  // handler would be gone (L213b2).
  const k = new Lang();
  const ask = k.effect("Ask", [["ask", [], () => k.tref("type.int")]]);
  const main = k.def("main");
  const kept = k.handleNamed("outer", (outer) => k.thunk(() => k.call(ask.op.ask, k.x(outer))), [{ variant: ask.op.ask, names: [], body: () => k.int(1) }]);
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(kept)))));
  const info = infer(base(k.code), baseNames(k.names));
  assert.ok(info.errors.some((e) => e.message.startsWith("a function that uses outer leaves the handler it names")), info.errors.map((e) => e.message).join("\n"));
});
