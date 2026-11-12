// firstArms (L72e1d) takes a first's thunk at its first ways only where
// every choice is in what it copies. A thunk that calls a function it was
// given, one that chooses, keeps its first (I224): markov's
// `shown(chances) = first(() => …chances()…, () => "no answer")` lost its
// first on WebAssembly and C, so a chain that never settles ended the run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { isCall } from "../../ters/src/model.ts";
import { S } from "../../ters/src/lang/std.ts";
import { firstArms } from "../../ters/src/lang/first-arms.ts";

function firsts(code: ReturnType<typeof base>, under: string) {
  const def = code.nodes[under] as { body: string }, lam = code.nodes[def.body] as { body: string };
  const n = code.nodes[lam.body];
  return isCall(n) && code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as { target: string }).target === S.first;
}

test("a first over a function it was given keeps its first; one over its own choice is taken (I224)", () => {
  const k = new Lang();
  const given = k.def("given"), own = k.def("own");
  k.define(given, k.fn(["chances"], (c) => k.call(S.first, k.thunk(() => k.call(c)), k.thunk(() => k.lit(-1)))));
  k.define(own, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(S.oneOf, k.call(S.listOf, x, k.lit(2)))), k.thunk(() => k.lit(-1)))));
  const main = k.def("main");
  k.define(main, k.list(k.call(given, k.thunk(() => k.call(S.fail))), k.call(own, k.lit(1))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const out = firstArms(code, info, names);
  assert.equal(firsts(out.code, given), true, "given's first is kept");
  assert.equal(firsts(out.code, own), false, "own's first is its first way");
});
