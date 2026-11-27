// Under `with fuel`, a call that only computes runs directly too, and so
// does an `all` or `count` of a search (run.ts underFuel, L281c): each call
// into a definition that may not end spends from the fuel as on the
// machine, and running out there is running out of the whole `with fuel`:
// the machine would run out at the same step, so it doesn't run the call
// again (L295: running it again from the fuel there was, at every call the
// machine made, cost a step each time). Before L281c, nothing under fuel
// ran directly: countdown's page was 14 s, all of it step by step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { S } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

test("with fuel: calls run directly, and calls and all-searches run out where the machine does", () => {
  const k = new Lang(LIBRARY.code);
  // down(n): n + 1 calls the checker can't see end.
  const down = k.def("down");
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0.5)), k.lit(0), k.call(B.add, k.lit(1), k.call(down, k.call(B.sub, n, k.lit(1)))))));
  const under = (fuel: number, body: () => Id) => k.call(S.fuel, k.lit(fuel), k.thunk(body));
  // One walk of 40 (41 calls), and an all of walks of 10, 20 and 30 (63).
  const one = (fuel: number) => { const d = k.def(`one ${fuel}`); k.define(d, k.fn(["u"], () => under(fuel, () => k.call(down, k.lit(40))))); return d; };
  const all = (fuel: number) => { const d = k.def(`all ${fuel}`); k.define(d, k.fn(["u"], () => under(fuel, () => k.call(LIBRARY_SUM, k.call(S.all, k.thunk(() => k.call(down, k.call(S.oneOf, k.list(k.lit(10), k.lit(20), k.lit(30)))))))))); return d; };
  const LIBRARY_SUM = LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === "sum")!;
  const cases = [[one(41), 40], [one(40), -1], [all(63), 60], [all(62), -1]] as const;
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const downLambda = (code.nodes[down] as { body: Id }).body;
  let direct = 0, calls = 0;
  const r = makeRunner(code, info, { print: () => {}, names, entered: (lambda) => { if (lambda !== downLambda) return; calls++; if (/\benter\b/.test(new Error().stack!)) direct++; } });
  const seen: [number, number][] = [];
  for (const [d, want] of cases) {
    direct = calls = 0;
    let got = -1;
    for (const v of r.call(r.value(d), 0)) { got = Number(v); break; }
    assert.equal(got, want, names[d]);
    seen.push([direct, calls]);
  }
  // A walk with fuel enough runs directly; one that runs out runs out
  // there, where the machine would, and isn't run again.
  assert.deepEqual(seen.slice(0, 2), [[41, 41], [40, 40]]);
});
