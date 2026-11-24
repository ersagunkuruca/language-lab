// Loops that read the arrays they keep from their buffers, and count in
// numbers (kept-arrays.ts, C303): mnist's `dot(xs, i, step, ys, j, step,
// n, acc)`, an array's view and buffer worked out once before the loop
// and its two positions and its count stepped with `+` and `-`. Where two
// of its arrays are versions of one buffer, or a position or step is a
// big Int, it goes on as written (`$s`). Where its first and last
// positions are in the arrays (C303c), its reads aren't checked; else it
// runs checking them (`$c`). Every answer is the definition's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { arrayOf, replaceIn } from "../../ters/src/lang/array-view.ts";
import { emitCoreJs, loadCoreJs, lowerCore } from "../src/core-js.ts";
import { program } from "../gaps/mnist.ts";

const p = program();
const core = lowerCore(p.code, p.info, p.names, [p.main]);
const { js, names } = emitCoreJs(core);
const fs = loadCoreJs(core);
const text = (i: number) => js.slice(js.indexOf(`function ${names[i]}(`), js.indexOf(`function ${names[i]}$s(`));
const dot = core.funcs.map((_, i) => i).find((i) => core.funcs[i].name.startsWith("dot at Float64") && js.includes(`function ${names[i]}$s(`));

// The definition, its positions and count as exact Ints.
type Int = number | bigint;
const at = (xs: number[], k: bigint) => (k >= 0n && k < BigInt(xs.length) ? xs[Number(k)] : 0);
function want(xs: number[], i: Int, di: Int, ys: number[], j: Int, dj: Int, n: Int, acc: number): number {
  let [a, b] = [BigInt(i), BigInt(j)];
  for (let c = BigInt(n); c > 0n; c--, a += BigInt(di), b += BigInt(dj)) acc += at(xs, a) * at(ys, b);
  return acc;
}

test("mnist's dot reads its two arrays from their buffers and steps its positions and count as numbers", () => {
  assert.ok(dot !== undefined, "dot is printed with its copy as written");
  const t = text(dot!);
  assert.match(t, /const w0\$ = l0 instanceof R\.ArrayView \? l0 : R\.arrayView\(l0\), w0\$b = w0\$\.buf\.items/);
  assert.match(t, /typeof l1 !== "number"/);
  assert.match(t, /= w0\$b\[w0\$s \+ l\d+\];/, "read unchecked");
  assert.match(t, /return f\d+\$c\(/, "with its checks where a read may fall outside");
  assert.match(js.slice(js.indexOf(`function ${names[dot!]}$c(`)), /Number\.isInteger\(t\d+\) && t\d+ >= 0 && t\d+ < w0\$n/);
  assert.match(t, /= \(l1 \+ l2\);/);
  assert.doesNotMatch(t, /\.buf\.items\[/, "no buffer looked up in the loop");
});

test("dot's answers are the definition's: in and out of range, two versions of one buffer, big Ints", () => {
  const f = fs[dot!] as (...xs: unknown[]) => number;
  const xs = Array.from({ length: 12 }, (_, k) => k * 1.5 - 4), ys = Array.from({ length: 12 }, (_, k) => 10 - k * k * 0.25);
  const ax = arrayOf(xs), ay = arrayOf(ys);
  const cases: [number[], Int, Int, number[], Int, Int, Int][] = [
    [xs, 0, 1, ys, 11, -1, 12],
    [xs, 5, -2, ys, 0, 3, 7],
    [xs, -3, 1, ys, 2, 1, 20],
    [xs, 0, 1, ys, 0, 1, 0],
    [xs, 0, 1, ys, 0, 1, -4],
  ];
  for (const [x, i, di, y, j, dj, n] of cases) assert.equal(f(x === xs ? ax : ay, i, di, y === ys ? ay : ax, j, dj, n, 0.5), want(x, i, di, y, j, dj, n, 0.5), JSON.stringify([i, di, j, dj, n]));
  // A version of xs with an item changed shares its buffer: reading it
  // turns the buffer away from xs.
  const changed = [...xs];
  changed[3] = 100;
  const ac = replaceIn(ax, 3, 100);
  assert.equal(f(ax, 0, 1, ac, 0, 1, 12, 0), want(xs, 0, 1, changed, 0, 1, 12, 0));
  assert.equal(f(ac, 2, 1, ax, 2, 1, 6, 0), want(changed, 2, 1, xs, 2, 1, 6, 0));
  // A big Int position and step that come back into range.
  const big = 2n ** 40n;
  assert.equal(f(ax, big + 2n, -big, ay, 0, 1, 3, 0), want(xs, big + 2n, -big, ys, 0, 1, 3, 0));
});

test("mnist's Dual arrays are columns, kept by dot's loop and read unchecked (C304b, C304c)", () => {
  const i = core.funcs.findIndex((f) => f.name === "dot at Dual, Int.loop");
  assert.ok(i >= 0);
  const s = js.indexOf(`function ${names[i]}(`), t = js.slice(s, js.indexOf(`function ${names[i]}$s(`));
  assert.match(t, /const w0\$ = l0, w0\$n = w0\$\.n, w0\$c0 = w0\$\.c0, w0\$c1 = w0\$\.c1;/);
  const loop = t.slice(t.indexOf("for (;;)"));
  assert.match(loop, /= w0\$c0\[l\d+\];/);
  assert.match(loop, /= w3\$c1\[l\d+\];/);
  assert.doesNotMatch(loop, /< w\d\$n|\.n\)|\.c\d\[/, "no position tested, no column looked up in the loop");
});
