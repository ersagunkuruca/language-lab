// The evaluator's direct runs (run.ts `enter`, L281a and L281b): a call
// made last runs in the same loop as its caller, not one JavaScript frame
// deeper, and so does one made last inside a constructor (`cons(x,
// again(rest))`). A function calling itself that way a hundred thousand
// times stays a direct run, at the same depth of the JavaScript stack
// each time; it used to run out of stack, start again step by step on the
// machine, and stay there (the looper's `copies onto`, 5.8 million calls).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, fromList, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CONS, INT_OPS, NIL } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

const N = 100_000;

test("a function calling itself last, or last inside a constructor, runs as a loop at one depth of the stack", () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: (self: Id) => Id) => { const d = k.def(name); k.define(d, body(d)); return d; };
  const less = (a: Id, b: Id) => k.call(INT_OPS.less, a, b), sub1 = (a: Id) => k.call(INT_OPS.sub, a, k.int(1));
  // Counting down by calling itself last.
  const down = def("down", (self) => k.fn(["n", "acc"], (n, acc) => k.if(less(k.int(0), n), k.call(self, sub1(n), k.call(INT_OPS.add, acc, k.int(1))), acc)));
  // A list made from the front, the call last inside cons.
  const upTo = def("up to", (self) => k.fn(["n"], (n) => k.if(less(k.int(0), n), k.call(CONS, n, k.call(self, sub1(n))), k.x(NIL))));
  // A list's items doubled, the same way.
  const doubled = def("doubled", (self) => k.fn(["list"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.call(CONS, k.call(INT_OPS.add, x, x), k.call(self, rest)) },
  ])));
  const counted = def("counted", () => k.call(down, k.int(N), k.int(0)));
  const made = def("made", () => k.call(doubled, k.call(upTo, k.int(N))));
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lambdas = new Set([down, upTo, doubled].map((d) => (code.nodes[d] as { body: Id }).body));
  const depths = new Map<Id, Set<number>>();
  const deep = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  try {
    const r = makeRunner(code, info, { print: () => {}, names: baseNames(k.names), entered: (lambda) => {
      if (!lambdas.has(lambda)) return;
      const stack = new Error().stack!;
      // Each call is in a direct run, not on the machine.
      assert.match(stack, /\benter\b/);
      let s = depths.get(lambda);
      if (!s) depths.set(lambda, (s = new Set()));
      s.add(stack.split("\n").length);
    } });
    assert.equal(Number(r.value(counted)), N);
    const xs = fromList(r.value(made) as never) as Value[];
    assert.equal(xs.length, N);
    assert.deepEqual([xs[0], xs[1], xs[N - 1]].map(Number), [2 * N, 2 * N - 2, 2]);
  } finally { Error.stackTraceLimit = deep; }
  for (const d of [down, upTo, doubled]) {
    const s = depths.get((code.nodes[d] as { body: Id }).body)!;
    assert.ok(s && s.size <= 2, `${k.names[d]} ran at ${s?.size} depths`);
  }
});
