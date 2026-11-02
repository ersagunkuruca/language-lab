// Compass (examples/compass): a circle round a corner through a point where
// two lines cross passes through that point, wherever the lines are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { fromList, makeRunner, toList, type Data, type Value } from "../src/lang/run.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

test("a circle through a point where two lines cross goes through it", () => {
  const p = loadProgram("examples/compass");
  const info = infer(p.code, p.pres.names);
  const r = makeRunner(p.code, info, { print: () => {}, names: p.pres.names });
  const fn = (name: string) => (...xs: Value[]) => first(r.call(r.value(p.named(name)), ...xs) as Iterable<Value>)!;
  // The page's opening construction lends the steps' tags: free, free,
  // circle, circle, cut, cut, through, ...
  const start = fromList(r.value(p.named("equilateral"))) as Data[];
  const [free, , circle, , cut, , through] = start.map((s) => s.tag);
  const step = (tag: string, ...xs: number[]): Data => ({ tag, fields: xs });
  for (const [cx, cy] of [[0.5, 2], [3, 4], [-4, 3.5]]) {
    const steps = toList([
      step(free, -2, -1.5), step(free, 2, -1.5), step(free, cx, cy), step(free, 4, 4), // 0 A, 1 B, 2 C, 3 D
      step(through, 0, 2), step(through, 1, 3), // 4 AC, 5 BD
      step(cut, 4, 5, 1), // 6 X, where they cross
      step(circle, 0, 6), // 7 round A through X
      step(circle, 6, 0), // 8 round X through A
    ]);
    const shapes = fromList(fn("build")(steps, toList([]))) as Data[];
    const x = (shapes[6] as Data).fields[0], a = (shapes[0] as Data).fields[0];
    const X = [fn("x of")(x), fn("y of")(x)] as number[];
    const d2 = (X[0] + 2) ** 2 + (X[1] + 1.5) ** 2;
    for (const i of [7, 8]) {
      const r2 = fn("radius squared")((shapes[i] as Data).fields[0]) as number;
      assert.ok(Math.abs(r2 - d2) < 1e-9, `C=(${cx}, ${cy}) circle ${i}: radius² ${r2}, |AX|² ${d2}`);
    }
    // The crossing is a point: it squares to 0, like A.
    assert.ok(Math.abs(fn("dot")(x, x) as number) < 1e-9, `X·X = ${fn("dot")(x, x)}`);
    assert.equal(fn("dot")(a, a), 0);
  }
});
