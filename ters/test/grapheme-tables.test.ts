// The grapheme tables (L214e3, grapheme-tables.ts): saved for the host's
// Unicode version, and UAX #29's rules over them break text where the
// host's Intl.Segmenter does: every pair and triple of the classes'
// letters, and random text from every class.

import { test } from "node:test";
import assert from "node:assert/strict";
import saved from "../library/graphemes.json" with { type: "json" };
import { graphemeBreaks, graphemeOf, loadGraphemes, type SavedGraphemes } from "../src/lang/grapheme-tables.ts";

const runs = loadGraphemes(saved as SavedGraphemes);
const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
// The host's breaks, as code point positions.
const hostBreaks = (cps: number[]): number[] => {
  const s = String.fromCodePoint(...cps), at: number[] = [];
  let unit = 0, i = 0;
  const starts = new Set([...seg.segment(s)].map((x) => x.index));
  for (const c of cps) { if (i > 0 && starts.has(unit)) at.push(i); unit += c > 0xffff ? 2 : 1; i++; }
  return at;
};

test("the grapheme tables are for the host's Unicode version", () => {
  assert.equal(saved.unicode, process.versions.unicode, "Node's Unicode moved on: run `node library/graphemes.ts`");
});

test("the tables' rules break text where the host does", () => {
  // A letter of each kind the tables hold, and a plain one.
  const letters = [0x61, ...saved.kinds.map((_, k) => runs.find((r) => saved.runs.find(([f]) => f === r.from)![2] === k)!.from)];
  const wrong: string[] = [];
  const check = (cps: number[]) => {
    const want = hostBreaks(cps), got = graphemeBreaks(runs, cps);
    if (want.join() !== got.join()) wrong.push(`${cps.map((c) => c.toString(16)).join(" ")}: host ${want.join()} tables ${got.join()}`);
  };
  // The rules that look further, each at work.
  for (const t of ["\u{1f1e6}\u{1f1e8}\u{1f1e6}", "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}", "\u{1f468}\u0301\u200d\u{1f469}", "a\u200d\u{1f600}",
    "\u0915\u094d\u200d\u0915", "\u0915\u094d\u0915", "\u0915\u093c\u094d\u0915", "\u0915\u093c\u0915", "\r\n", "\u1100\u1161\u11a8", "e\u0301\u0600a"]) check([...t].map((x) => x.codePointAt(0)!));
  for (const a of letters) for (const b of letters) { check([a, b]); for (const c of letters) check([a, b, c]); }
  // Random text from every run, the longer rules' letters among it.
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const pool = [...letters, 0x1f600, 0x200d, 0x1f1e6, 0x1f1e8, 0x915, 0x94d, 0x93c, 0xd, 0xa];
  for (let i = 0; i < 4000; i++) {
    const cps = Array.from({ length: 2 + rnd(8) }, () => {
      if (rnd(3) === 0) return pool[rnd(pool.length)];
      const r = runs[rnd(runs.length)];
      return r.from + rnd(r.to - r.from + 1);
    });
    check(cps);
  }
  assert.deepEqual(wrong.slice(0, 10), []);
  assert.equal(graphemeOf(runs, 0x1f600).pictographic, true);
});
