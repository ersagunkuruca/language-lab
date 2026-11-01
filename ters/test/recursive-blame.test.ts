// A wrong recursive call is blamed where it is (BACKLOG I118): a call back
// into the group being checked has its inputs checked after the group's
// bodies, so the bodies' own uses fix the types first, and a right use
// that comes after the wrong call isn't blamed instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { CONS, NIL } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";

const sum = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "sum")!;

function check(build: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  build(k);
  const code = base(k.code), names = baseNames(k.names);
  return infer(code, names).errors.map((e) => [e.id, e.message]);
}

test("one definition: its wrong recursive call is blamed at the wrong input, not at the list's right use", () => {
  let wrong = "";
  const errors = check((k) => {
    const count = k.def("count");
    k.define(count, k.fn(["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: () => k.call(B.add, k.call(count, (wrong = k.list(k.lit("x")))), k.call(sum, xs)) },
    ])));
  });
  assert.deepEqual(errors, [[wrong, "count needs List Float64 here, got List Text"]]);
});

test("two definitions calling each other: the one whose call is wrong is blamed, whichever is checked first", () => {
  for (const order of [0, 1]) {
    let wrong = "";
    const errors = check((k) => {
      const a = k.def("a"), b = k.def("b");
      const defineA = () => k.define(a, k.fn(["xs"], (xs) => k.match(xs, [
        { variant: NIL, names: [], body: () => k.lit(0) },
        { variant: CONS, names: ["h", "t"], body: ([, t]) => k.call(B.add, k.call(sum, xs), k.call(b, t)) },
      ])));
      const defineB = () => k.define(b, k.fn(["ys"], (ys) => k.match(ys, [
        { variant: NIL, names: [], body: () => k.lit(0) },
        { variant: CONS, names: ["h", "t"], body: () => k.call(a, (wrong = k.list(k.lit("x")))) },
      ])));
      if (order) { defineB(); defineA(); } else { defineA(); defineB(); }
    });
    assert.deepEqual(errors, [[wrong, "a needs List Float64 here, got List Text"]], `order ${order}`);
  }
});
