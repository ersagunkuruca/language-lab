// The signals module (L272, signals-source.ts): its FFT, correlation and
// peaks against the same sums written out in JavaScript, by the evaluator
// and as the core IR's JavaScript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPLEX_V } from "../src/lang/library.ts";
import { fromList, toList, type Data, type Value } from "../src/lang/run.ts";
import { both } from "./library-call.ts";

const complexes = (zs: [number, number][]) => toList(zs.map(([re, im]) => ({ tag: COMPLEX_V, fields: [re, im] }) as Data));
const parts = (v: Value): [number, number][] => (fromList(v) as Data[]).map((z) => [z.fields[0] as number, z.fields[1] as number]);
const near = (a: number[], b: number[], tol = 1e-9) => { assert.equal(a.length, b.length); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < tol, `${i}: ${x} vs ${b[i]}`)); };

function dft(xs: [number, number][]): [number, number][] {
  const n = xs.length;
  return xs.map((_, k) => xs.reduce(([sr, si], [re, im], j) => { const a = (-2 * Math.PI * j * k) / n; return [sr + re * Math.cos(a) - im * Math.sin(a), si + re * Math.sin(a) + im * Math.cos(a)]; }, [0, 0]));
}

const signal = (n: number) => Array.from({ length: n }, (_, i) => [Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1), 0.1 * i] as [number, number]);

for (const way of ["evaluator", "core"] as const) {
  test(`fft is the transform as defined, at a power of two and at other lengths (${way})`, () => {
    const fft = both("fft")[way], ifft = both("inverse fft")[way];
    for (const n of [1, 2, 8, 12, 15, 64]) {
      const xs = signal(n);
      const got = parts(fft(complexes(xs))), want = dft(xs);
      near(got.flat(), want.flat(), 1e-9 * n);
      near(parts(ifft(complexes(got))).flat(), xs.flat(), 1e-9 * n);
    }
  });

  test(`cross correlation finds a delayed copy, and autocorrelation a period (${way})`, () => {
    const x = both("cross correlation")[way], ac = both("autocorrelation")[way], peaks = both("peaks")[way];
    const chirp = Array.from({ length: 64 }, (_, i) => Math.sin(0.002 * i * i * 10));
    const heard = [...Array(37).fill(0), ...chirp.map((v) => 0.5 * v), ...Array(27).fill(0)];
    const r = fromList(x(toList(heard), toList(chirp))) as number[];
    const want = heard.map((_, lag) => chirp.reduce((s, b, i) => s + (heard[i + lag] ?? 0) * b, 0));
    near(r, want, 1e-9);
    assert.equal(r.indexOf(Math.max(...r)), 37);
    // A period of 20.5 samples: the first peak past 0 is between 20 and 21.
    const tone = Array.from({ length: 256 }, (_, i) => Math.sin((2 * Math.PI * i) / 20.5));
    const found = (fromList(peaks(ac(toList(tone)))) as Data[]).map((p) => [p.fields[0], p.fields[1]] as [number, number]);
    assert.ok(Math.abs(found[0][0] - 20.5) < 0.2, `first peak at ${found[0][0]}`);
  });

  test(`peaks are read between samples off a parabola (${way})`, () => {
    const peaks = both("peaks")[way];
    const ys = [0, 1, 3, 2, 0, 5, 5, 1];
    const got = (fromList(peaks(toList(ys))) as Data[]).map((p) => [p.fields[0], p.fields[1]] as [number, number]);
    // 1, 3, 2: the top is a sixth past 2. 0, 5, 5: a flat top counts once, at its first place, half past it.
    near(got.map((p) => p[0]), [2 + 1 / 6, 5.5]);
  });

  test(`a Hann window rises from 0 to 1 and back (${way})`, () => {
    const hann = both("hann window")[way];
    near(fromList(hann(5)) as number[], [0, 0.5, 1, 0.5, 0]);
    near(fromList(hann(1)) as number[], [1]);
  });
}
