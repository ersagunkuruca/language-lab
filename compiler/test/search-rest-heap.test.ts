// A search's rest, in continuation passing, applied as deep as the search
// goes (L72e1d's blocker): compiled JavaScript applies a closure that may
// call back into its cycle on the heap past the depth a heap copy starts
// at, as it already calls a function of its cycle. first(json spelled)
// of 300 records ran out of stack; the evaluator printed them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { S } from "../../ters/src/lang/std.ts";
import { compiledMain } from "../src/core-js.ts";

const L = (name: string) => Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === name && ["def", "builtin"].includes(LIBRARY.code.nodes[d]?.kind ?? ""))!;

test("first(json spelled) of 2000 records, compiled, is json printed's text (L72e1d)", () => {
  const json = "[" + Array.from({ length: 2000 }, (_, i) => `{"id":${i},"name":"n${i}","ok":true}`).join(",") + "]";
  const k = new Lang(LIBRARY.code);
  const read = () => k.call(L("first"), k.thunk(() => k.call(L("json read"), k.lit(json))), k.thunk(() => k.call(L("json read"), k.lit("null"))));
  k.define(k.def("main"), k.thunk(() => k.seq(
    k.call(S.print, k.call(L("first"), k.thunk(() => k.call(L("json spelled"), read())), k.thunk(() => k.lit("none")))),
    k.call(S.print, k.call(L("json printed"), read())))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const out: string[] = [];
  compiledMain(code, info, names, { print: (s: string) => out.push(s) } as never);
  assert.equal(out.length, 2);
  assert.equal(out[0], json);
  assert.equal(out[0], out[1]);
});
