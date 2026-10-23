// One builtin is described in up to eleven places (REVIEW-2026-10-22b.md
// §4): its type in std.ts, how it runs forward (run.ts), backwards
// (relate.ts), compiled (compile.ts), and more. A table that misses one
// fails only when a program happens to use it that way, which is how
// compiled `tan` couldn't be compiled at all. So this goes through every
// builtin std.ts declares and asks each job for it: it either does it, or
// refuses with a reason of its own. A new builtin without an entry fails
// here, not in somebody's program.

import { test } from "node:test";
import assert from "node:assert/strict";
import { S, SET, SIGS, stdNames } from "../../projectional/src/lang/std.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { NotInvertible, relate } from "../../projectional/src/lang/relate.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import { Subst } from "../../projectional/src/lang/types.ts";
import type { Id } from "../../projectional/src/model.ts";
import { compile } from "../src/compile.ts";

// Builtins whose first input must be written in place, so a plain
// f(x, …) = builtin(x, …) can't use them; their own tests cover them.
const IN_PLACE: Record<Id, string> = { [SET]: "set takes the field it sets written in place (test/records.test.ts)" };

// f(x0, …) = builtin(x0, …), checked.
function calling(id: Id) {
  const t = SIGS[id](new Subst());
  const n = t.t === "fn" ? t.params.length : 0;
  const k = new Lang();
  const f = k.def("f");
  k.define(f, n ? k.fn(Array.from({ length: n }, (_, i) => `x${i}`), (...xs) => k.call(id, ...xs)) : k.thunk(() => k.call(id)));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), f };
}

const builtins = Object.keys(SIGS).filter((id) => !IN_PLACE[id]);
const name = (id: Id) => `${stdNames[id] ?? id} (${id})`;

test("std.ts declares the builtins this test goes through", () => {
  assert.ok(builtins.length > 60);
  for (const id of [S.equal, S.print, S.first]) assert.ok(SIGS[id], id);
});

test("every builtin type-checks when called, and the evaluator runs it", () => {
  for (const id of builtins) {
    const { code, info, f } = calling(id);
    assert.deepEqual(info.errors.map((e) => e.message), [], name(id));
    const r = makeRunner(code, info, { print: () => {} });
    assert.equal(typeof r.value(id), "function", `${name(id)} has no implementation in run.ts`);
    assert.ok(r.value(f) !== undefined);
  }
});

test("every builtin compiles to JavaScript", () => {
  for (const id of builtins) {
    const { code, info, names } = calling(id);
    assert.doesNotThrow(() => compile(code, info, names, { runtime: "./runtime.js", exports: ["f"] }), name(id));
  }
});

test("every builtin runs backwards, or says why it can't", () => {
  for (const id of builtins) {
    const { code, f } = calling(id);
    try {
      let steps = 0;
      for (const _ of relate(code, f, {}, { spend: () => ++steps < 200 })) break;
    } catch (e) {
      if (!(e instanceof NotInvertible)) throw e;
      // The fallback for an id relate.ts has no rule for isn't a reason.
      assert.doesNotMatch(e.message, /has no backwards reading/, `${name(id)}: relate.ts has neither a rule nor a reason`);
    }
  }
});
