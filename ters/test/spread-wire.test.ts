// A tuple wired onto a node with every input empty fills them all (BACKLOG
// E167d, PORTS-2026-11-01.md §5): f(p) for f(x, y), as the checker reads it
// (L128a).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { ARITH, tupleVariant } from "../src/lang/std.ts";
import type { NodeOf } from "../src/model.ts";
import { useVar } from "../../editor/typed.ts";

test("a tuple wired onto a node whose inputs are empty fills them all, in order", () => {
  const k = new Lang();
  const sub = k.def("sub");
  k.define(sub, k.fn(["a", "b"], (a, b) => k.call(ARITH.sub, a, b)));
  const main = k.def("main");
  let p = "", holes: string[] = [], use = "";
  k.define(main, k.fn([], () => k.let("p", k.call(tupleVariant(2), k.lit(5), k.lit(3)), (b) => { p = b; holes = [k.hole(), k.hole()]; use = k.call(sub, ...holes); return use; })));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  const r = useVar(code, names, info, main, p, holes[1]);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const call = r.code.nodes[use] as NodeOf<"call">;
  assert.equal(call.args.length, 1);
  assert.deepEqual(r.code.nodes[call.args[0]], { id: call.args[0], kind: "ref", target: p });
  assert.deepEqual(infer(r.code, r.names).errors, []);
  // With an input already filled, it isn't all of them.
  const one = useVar(r.code, r.names, infer(r.code, r.names), main, p, call.args[0]);
  assert.equal(one.ok, false);
});
