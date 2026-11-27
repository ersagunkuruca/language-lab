// T18a: how far one test reaches (reach.ts), from a small made-up map.

import { test } from "node:test";
import assert from "node:assert/strict";
import { printReach, reach } from "./reach.ts";
import type { TestMap } from "./test-map.ts";

const entry = (code: Record<string, string>) => ({ at: "x", ran: "", passed: true, seconds: 1, code });
const map = {
  tests: {
    "t/fuzz.test.ts": entry({ "src/a.ts": "1-4", "other/x.ts": "1-9" }),
    "t/examples.test.ts": entry({ "src/a.ts": "3-8", "src/b.ts": "1-5", "src/gone.ts": "1-2" }),
  },
} as unknown as TestMap;
const lengths: Record<string, number> = { "src/a.ts": 10, "src/b.ts": 6 };

test("a test's reach: lines run by any test and by this one, only in the folders asked, files gone left out", () => {
  const [r] = reach(map, "t/fuzz.test.ts", ["src/"], (f) => lengths[f] ?? null);
  assert.deepEqual(r, {
    folder: "src/", lines: 16, any: 13, mine: 4,
    // b.ts first: 5 lines only other tests reach, against a.ts's 4
    files: [{ file: "src/b.ts", lines: 6, any: 5, mine: 0 }, { file: "src/a.ts", lines: 10, any: 8, mine: 4 }],
  });
  const text = printReach("t/fuzz.test.ts", [r]);
  assert.match(text, /^src\/: t\/fuzz\.test\.ts runs 4 of 16 lines \(25%\); all tests 13 \(81%\); never enters 1 of 2 files$/m);
  assert.match(text, /never entered: b\.ts$/m);
});
