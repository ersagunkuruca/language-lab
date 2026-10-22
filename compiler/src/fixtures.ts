// Small programs written for the tests and the benchmark, in the DSL.

import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { B } from "../../projectional/src/prelude.ts";
import { S } from "../../projectional/src/lang/std.ts";

// The area under x·x·x − x − 1 from `from`, in `steps` strips of width
// `width`: a numeric loop written as tail recursion, the way the language
// writes loops. Nothing gets smaller, so its type carries Diverge.
export function area() {
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.fn(["x"], (x) => k.call(B.sub, k.call(B.sub, k.call(B.mul, k.call(B.mul, x, x), x), x), k.lit(1))));
  const area = k.def("area");
  k.define(area, k.fn(["x", "width", "steps", "total"], (x, w, n, acc) =>
    k.if(k.call(S.less, n, k.lit(1)), acc,
      k.call(area, k.call(B.add, x, w), w, k.call(B.sub, n, k.lit(1)), k.call(B.add, acc, k.call(B.mul, k.call(f, x), w))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), area, f };
}
