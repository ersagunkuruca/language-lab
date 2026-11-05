// The collation tables (L214e4, collation-tables.ts): read off the host's
// Intl.Collator, and UTS #10's comparison over them orders text as the
// host's root order does: random text from many scripts, with accents,
// cases and the letters that sort as two.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollationTables, collationCompare } from "../src/lang/collation-tables.ts";

const tables = buildCollationTables();
const host = new Intl.Collator("und", { sensitivity: "variant", usage: "sort" });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).filter((c) => /\P{Cn}/u.test(c));

const POOLS: Record<string, string[]> = {
  latin: [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  "Latin-1 and Extended": range(0xc0, 0x24f),
  greek: range(0x391, 0x3c9),
  cyrillic: range(0x410, 0x44f),
  "digits and punctuation": [..."0123456789 .,;:-_!?'\"()[]{}@#$%&*/\\+<=>"],
  "other scripts": [..."אבגִּابتًلآ一二字あアァＡ가각가कख्िกเั\u{1f600}\u{1f468}‍\u{1f1e6}️"],
  "sorting as two": [..."aesfi12/ßæÆﬁ½ĳǆẞ①øØo"],
};
const MARKS = [..."̧̀́̂̈̊"];

test("the tables order text as the host's root order does", () => {
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const wrong: string[] = [];
  for (const [name, pool] of Object.entries(POOLS)) {
    const text = () => {
      let s = "";
      for (let n = 1 + rnd(4); n > 0; n--) { s += pool[rnd(pool.length)]; if (rnd(5) === 0) s += MARKS[rnd(MARKS.length)]; }
      return s.normalize("NFC");
    };
    for (let i = 0; i < 5000; i++) {
      const x = text(), y = text(), want = Math.sign(host.compare(x, y)), got = collationCompare(tables, x, y);
      if (want !== got) wrong.push(`${name}: ${JSON.stringify(x)} ${JSON.stringify(y)} host ${want} tables ${got}`);
    }
  }
  assert.deepEqual(wrong.slice(0, 10), []);
});

test("the letters that sort as two sort among their two", () => {
  const pairs = [["ßa", "ssb"], ["ßb", "ssa"], ["æa", "aeb"], ["æb", "aea"], ["ﬁx", "fiy"], ["½", "1⁄2"], ["ǆ", "dž"], ["æ", "ae"], ["ø", "o"], ["ø", "ǫ"]];
  for (const [x, y] of pairs) assert.equal(collationCompare(tables, x, y), Math.sign(host.compare(x, y)), `${x} against ${y}`);
});
