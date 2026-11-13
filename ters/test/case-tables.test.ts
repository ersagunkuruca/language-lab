// The case tables (L214e1, case-tables.ts): read off the host and kept in
// library/case-tables.json, they map every code point as the host does,
// one at a time, in the root locale and in each tailored one. The
// library's case mapping (L214e2) is built over the kept ones, so a
// machine on another Unicode builds the same library (I244).

import { test } from "node:test";
import assert from "node:assert/strict";
import { caseTables, hostCaseTables, mapped, TAILORED } from "../src/lang/case-tables.ts";

// Unicode versions in order ("16.0" < "17.0").
const version = (v: string) => v.split(".").map(Number).reduce((a, x) => a * 1000 + x, 0);
const host = process.versions.unicode ?? "";
const kept = caseTables().unicode;
// As the grapheme tables: a host behind the kept tables' Unicode has no
// say on the characters it doesn't know yet, so there only the version is
// checked.
const skip = kept === host ? false : `the host's Unicode is ${host}, the kept tables' ${kept}`;

test("the case tables are no older than the host's Unicode version", () => {
  assert.ok(version(kept) >= version(host), `Node's Unicode moved on (${kept} → ${host}): run \`node library/case-tables.ts\`, then \`node library/build.ts\``);
});

test("the kept case tables are the host's, read now", { skip }, () => {
  assert.deepEqual(caseTables(), hostCaseTables(), "run `node library/case-tables.ts`, then `node library/build.ts`");
});

const each = function* () { for (let c = 0; c < 0x110000; c++) { if (c === 0xd800) c = 0xe000; yield c; } };

test("the case tables map every code point as the host does", { skip }, () => {
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

test("each tailored locale's differences map as the host does in it", { skip }, () => {
  const t = caseTables();
  for (const tag of TAILORED) for (const c of [0x49, 0x69, 0x130, 0x131, 0xcc, 0xcd, 0x128, 0x3a3, 0xdf]) {
    const s = String.fromCodePoint(c);
    assert.equal(String.fromCodePoint(...mapped(t.upper, c, t.locales[tag].upper)), s.toLocaleUpperCase(tag), `${tag} upper U+${c.toString(16)}`);
    assert.equal(String.fromCodePoint(...mapped(t.lower, c, t.locales[tag].lower)), s.toLocaleLowerCase(tag), `${tag} lower U+${c.toString(16)}`);
  }
  assert.deepEqual(t.locales.tr.upper, [[0x69, [0x130]]]);
});
