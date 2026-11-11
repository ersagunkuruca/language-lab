// grow (L237): the least set holding start and closed under a step, kept
// inside a finite universe. It ends within the universe's size in rounds,
// so its type has no Diverge (counting.ts counts its rounds down), and
// reachability over a graph's edges is a call of it. Evaluated and
// compiled give the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledDefs } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SHOW_ANY, tupleVariant } from "../src/lang/std.ts";
const TUPLE_V = tupleVariant;
import { showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

test("grow's type has no Diverge", () => {
  const info = infer(base({ nodes: {}, defs: [] }), baseNames({}), undefined, checkOptions);
  const t = showType(info.subst.zonk(info.typeOf.get(L("grow"))!), baseNames({}));
  // What more does is all it does: e, and no Diverge of its own.
  assert.equal(t, "(Set a, Set a, (a) -[e]-> List a) -[e]-> Set a");
});

// The nodes reached from 1 over the edges 1 → 2, 2 → 3, 3 → 1, 4 → 5 and
// 2 → 9 (9 isn't one of the nodes, so it's left out), and from 4.
test("the nodes reached from one, over a graph's edges", () => {
  const k = new Lang(LIBRARY.code);
  const edges = k.def("edges");
  k.define(edges, k.list(...[[1, 2], [2, 3], [3, 1], [4, 5], [2, 9]].map(([a, b]) => k.call(TUPLE_V(2), k.int(a), k.int(b)))));
  const nodes = k.def("nodes");
  k.define(nodes, k.call(L("as set"), k.list(...[1, 2, 3, 4, 5, 6].map((n) => k.int(n)))));
  const after = k.def("after");
  k.define(after, k.fn(["node"], (n) => k.call(L("flat map"), k.x(edges), k.fn(["edge"], (e) => k.match(e, [{ variant: TUPLE_V(2), names: ["from", "to"], body: ([a, b]) => k.if(k.equal(a, n), k.list(b), k.list()) }])))));
  const reached = k.def("reached from");
  k.define(reached, k.fn(["start"], (s) => k.call(L("grow"), k.x(nodes), k.call(L("as set"), k.list(s)), k.x(after))));
  const main = k.def("main");
  const lines = [k.call(L("items of"), k.call(reached, k.int(1))), k.call(L("items of"), k.call(reached, k.int(4))), k.call(L("items of"), k.call(reached, k.int(6)))];
  k.define(main, k.thunk(() => k.seq(...lines.map((v) => k.call(S.print, k.call(SHOW_ANY, v))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.subst.zonk(info.typeOf.get(reached)!), names), "(Int) -> Set Int");
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const compiled: string[] = [];
  compiledDefs(code, info, names, ["main"], { print: (s: string) => compiled.push(s) })["main"]();
  const want = ["[1, 2, 3]", "[4, 5]", "[6]"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});
