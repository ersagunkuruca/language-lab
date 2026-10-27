// Polynomials with Int coefficients (src/lang/poly.ts, EXACT-REALS.md step
// 1): what algebraic numbers will be held by.

import { test } from "node:test";
import assert from "node:assert/strict";
import { degree, divExact, gcd, isolate, mul, poly, productPoly, rootsIn, signAt, squareFree, sturm, sumPoly, type Poly, type Q } from "../src/lang/poly.ts";

const show = (p: Poly) => p.map(String).join(" ");
const num = ([n, d]: Q) => Number(n) / Number(d);

test("multiplying, dividing exactly, gcd and the square-free part", () => {
  const a = poly(-1, 1), b = poly(1, 1); // x − 1, x + 1
  assert.equal(show(mul(a, b)), "-1 0 1");
  assert.equal(show(divExact(poly(-1, 0, 1), a)), "1 1");
  assert.throws(() => divExact(poly(-2, 0, 1), a));
  assert.equal(show(gcd(mul(a, a), mul(a, b))), "-1 1");
  // (x − 1)²(x + 1) has the roots of (x − 1)(x + 1), each once.
  assert.equal(show(squareFree(mul(mul(a, a), b))), "-1 0 1");
});

test("Sturm counts real roots, and isolate puts each in its own interval", () => {
  const p = poly(-2, 0, 1); // x² − 2
  const seq = sturm(p);
  assert.equal(rootsIn(seq, null, null), 2);
  assert.equal(rootsIn(seq, [1n, 1n], [2n, 1n]), 1);
  assert.equal(rootsIn(seq, [0n, 1n], [1n, 1n]), 0);
  const roots = isolate(p);
  assert.equal(roots.length, 2);
  for (const [[lo, hi], want] of roots.map((r, i) => [r, i ? Math.SQRT2 : -Math.SQRT2] as const)) {
    assert.ok(num(lo) < want && want < num(hi), `${num(lo)} < ${want} < ${num(hi)}`);
    assert.notEqual(signAt(p, lo), signAt(p, hi));
  }
  // No real roots, and rational roots strictly inside their intervals.
  assert.deepEqual(isolate(poly(1, 0, 1)), []);
  const r = isolate(poly(0, -1, 0, 1)); // x³ − x: −1, 0, 1
  assert.equal(r.length, 3);
  r.forEach(([lo, hi], i) => assert.ok(num(lo) < i - 1 && i - 1 < num(hi)));
});

test("the polynomials of a sum and a product by resultants: √2 + √3 and √2 · √2", () => {
  const two = poly(-2, 0, 1), three = poly(-3, 0, 1);
  // √2 + √3 is a root of x⁴ − 10x² + 1.
  const s = sumPoly(two, three);
  assert.equal(show(s), "1 0 -10 0 1");
  assert.ok(isolate(s).some(([lo, hi]) => num(lo) < Math.SQRT2 + Math.sqrt(3) && Math.SQRT2 + Math.sqrt(3) < num(hi)));
  // √2 · √2 is a root of (x² − 4)²: x = 2 is among its roots, exactly.
  const p = productPoly(two, two);
  assert.equal(signAt(p, [2n, 1n]), 0);
  assert.equal(show(squareFree(p)), "-4 0 1");
  // Degrees multiply: two cubics give degree 9.
  assert.equal(degree(sumPoly(poly(-2, 0, 0, 1), poly(-3, 0, 0, 1))), 9);
});
