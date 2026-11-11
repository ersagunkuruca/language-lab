// A row's id names one row (REVIEW-2026-11-11 §5): I205 named three, an
// open one and two in DONE.md, when lanes took the same next number at the
// same time. An id open in BACKLOG.md isn't in DONE.md too, and BACKLOG.md
// names each row once. (DONE.md keeps its history as written: a row
// closed in stages repeats its id there.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dirname, "../..");
const ids = (file: string) => [...readFileSync(join(repo, file), "utf8").matchAll(/^\| ([A-Z]+\d+[0-9a-z′']*) \|/gm)].map((m) => m[1]);

test("each open row's id is its own: once in BACKLOG.md, and not in DONE.md", () => {
  const open = ids("BACKLOG.md"), done = new Set(ids("docs/process/DONE.md"));
  assert.deepEqual(open.filter((id, i) => open.indexOf(id) !== i), [], "named twice in BACKLOG.md");
  assert.deepEqual(open.filter((id) => done.has(id)), [], "open in BACKLOG.md and done in DONE.md");
});
