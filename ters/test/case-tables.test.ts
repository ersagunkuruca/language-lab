// The case tables (L214e1, case-tables.ts): read off the host, they map
// every code point as the host does, one at a time, in the root locale and
// in each tailored one. The library's case mapping (L214e2) reads them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { caseTables, mapped, TAILORED } from "../src/lang/case-tables.ts";

const each = function* () { for (let c = 0; c < 0x110000; c++) { if (c === 0xd800) c = 0xe000; yield c; } };

test("the case tables map every code point as the host does", () => {
  const t = caseTables();
  const wrong: string[] = [];
  for (const c of each()) {
    const s = String.fromCodePoint(c);
    if (String.fromCodePoint(...mapped(t.upper, c)) !== s.toUpperCase()) wrong.push(`upper U+${c.toString(16)}`);
    if (String.fromCodePoint(...mapped(t.lower, c)) !== s.toLowerCase()) wrong.push(`lower U+${c.toString(16)}`);
  }
  assert.deepEqual(wrong.slice(0, 5), []);
  // ß is SS, and Latin Extended-A's alternating cases are runs a step of 2.
  assert.deepEqual(mapped(t.upper, 0xdf), [0x53, 0x53]);
  assert.ok(t.upper.runs.some((r) => r.step === 2 && r.from <= 0x101 && 0x101 < r.from + r.count * 2));
});

test("each tailored locale's differences map as the host does in it", () => {
  const t = caseTables();
  for (const tag of TAILORED) for (const c of [0x49, 0x69, 0x130, 0x131, 0xcc, 0xcd, 0x128, 0x3a3, 0xdf]) {
    const s = String.fromCodePoint(c);
    assert.equal(String.fromCodePoint(...mapped(t.upper, c, t.locales[tag].upper)), s.toLocaleUpperCase(tag), `${tag} upper U+${c.toString(16)}`);
    assert.equal(String.fromCodePoint(...mapped(t.lower, c, t.locales[tag].lower)), s.toLocaleLowerCase(tag), `${tag} lower U+${c.toString(16)}`);
  }
  assert.deepEqual(t.locales.tr.upper, [[0x69, [0x130]]]);
});
