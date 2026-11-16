// Dragging a number literal (editor/scrub.ts, E272): the rate follows the
// value's size, integers stay whole, and floats land on clean decimals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scale, scrubRate, scrubStep, scrubbed } from "../../editor/scrub.ts";

test("the rate is a hundredth of the value's order of magnitude a pixel", () => {
  assert.equal(scrubRate(3.5, false), 0.01);
  assert.equal(scrubRate(250, false), 1);
  assert.equal(scrubRate(-0.5, false), 0.001);
  assert.equal(scrubRate(0, false), 0.01);
  // An integer moves at least a tenth of one a pixel: ten pixels a step.
  assert.equal(scrubRate(3, true), 0.1);
  assert.equal(scrubRate(5000, true), 10);
});

test("Shift is coarser, Alt finer", () => {
  assert.equal(scale({ shiftKey: true, altKey: false }), 10);
  assert.equal(scale({ shiftKey: false, altKey: true }), 0.1);
  assert.equal(scale({ shiftKey: false, altKey: false }), 1);
});

test("integers stay whole, floats land on clean decimals", () => {
  assert.equal(scrubbed(3, 25, 0.1, true), 6);
  assert.equal(scrubbed(3, -4, 0.1, true), 3);
  assert.ok(Number.isInteger(scrubbed(1000, 7.3, 10, true)));
  assert.equal(scrubbed(0.1, 20, 0.01, false), 0.3);
  assert.equal(scrubbed(9.81, -3, 0.01, false), 9.78);
  // Digits finer than the rate are kept, not rounded away.
  assert.equal(scrubbed(9.8123, 1, 0.01, false), 9.8223);
  assert.equal(scrubbed(0.5, 0, 0.001, false), 0.5);
});

test("a Float64 written whole steps by whole numbers until Alt", () => {
  const none = { shiftKey: false, altKey: false }, alt = { shiftKey: false, altKey: true }, shift = { shiftKey: true, altKey: false };
  assert.deepEqual(scrubStep(8, false, none), { rate: 0.1, int: true });
  assert.deepEqual(scrubStep(8, false, shift), { rate: 1, int: true });
  assert.deepEqual(scrubStep(8, false, alt), { rate: 0.01, int: false });
  assert.deepEqual(scrubStep(0.5, false, alt), { rate: 0.0001, int: false });
  assert.deepEqual(scrubStep(8, true, alt), { rate: 0.01, int: true });
  assert.deepEqual(scrubStep(0.5, false, none), { rate: 0.001, int: false });
});
