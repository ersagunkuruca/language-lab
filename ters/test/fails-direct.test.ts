// A function whose type says it may fail, but never gives two values,
// runs directly (run.ts failsAtMost, L281d): a failure in the run fails
// the call where it began, or the branch of a search it is in. Before, a
// function that may fail always ran step by step on the machine: pond's
// `lookup entry` and `value at`, 2.3 million calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { S, SOME } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

test("a function that may fail runs directly, and its failure fails where the machine's does", () => {
  const k = new Lang(LIBRARY.code);
  // below(n, limit): n counted down to limit, failing under 0; it calls itself last.
  const below = k.def("below");
  k.define(below, k.fn(["n", "limit"], (n, lim) => k.if(k.call(S.less, n, k.lit(0)), k.call(S.fail), k.if(k.call(S.less, n, lim), n, k.call(below, k.call(B.sub, n, k.lit(1)), lim)))));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, k.fn(["u"], body)); return d; };
  // Found, not found (under optional), and inside an all: 3 of the 4 starts have one.
  const found = def("found", () => k.call(S.optional, k.thunk(() => k.call(below, k.lit(5000), k.lit(3)))));
  const missing = def("missing", () => k.call(S.optional, k.thunk(() => k.call(below, k.lit(5000), k.lit(-3)))));
  const some = def("some", () => k.call(S.all, k.thunk(() => k.call(below, k.call(S.oneOf, k.list(k.lit(10), k.lit(20), k.lit(30), k.lit(40))), k.call(S.oneOf, k.list(k.lit(5), k.lit(-1)))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lambda = (code.nodes[below] as { body: Id }).body;
  let direct = 0, calls = 0;
  const r = makeRunner(code, info, { print: () => {}, names, entered: (l) => { if (l !== lambda) return; calls++; if (/\benter\b/.test(new Error().stack!)) direct++; } });
  const one = (d: Id) => { for (const v of r.call(r.value(d), 0)) return v; return "no value"; };
  const f = one(found) as { tag: Id; fields: unknown[] };
  assert.equal(f.tag, SOME);
  assert.equal(Number(f.fields[0]), 2);
  assert.equal((one(missing) as { tag: Id }).tag !== SOME, true);
  const xs: number[] = [];
  for (let l = one(some) as { tag: Id; fields: unknown[] }; l.fields.length; l = l.fields[1] as never) xs.push(Number(l.fields[0]));
  assert.deepEqual(xs, [4, 4, 4, 4]);
  // The first two, 10,003 calls, ran directly (the all's run as a search).
  assert.ok(direct >= 10003, `${direct} of ${calls} calls direct`);
});
