// examples/buffer (the example for L248): an editor buffer of characters,
// 200 edits drawn from a seed (typing, erasing, a span cut and pasted
// elsewhere), each a split and a join of the list. Run by the evaluator and
// compiled alike. On a list of cells each edit walks to its place, so the
// time grows with the buffer's length times the edits: what L248's ropes,
// split and join in log n, take away.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const buffer = join(import.meta.dirname, "../examples/buffer");
const node = (args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };

test("buffer: two hundred edits split and join a list, evaluated and compiled", () => {
  const run = node([lab, "run", buffer]);
  assert.equal(run.code, 0, run.err);
  const lines = run.out.trimEnd().split("\n");
  assert.equal(lines[0], "start: 4400 characters, 100 lines");
  assert.equal(lines[1], "after 200 edits: 4515 characters, 94 lines, 385 o's");
  const compiled = join(mkdtempSync(join(tmpdir(), "buffer-")), "buffer.mjs");
  assert.equal(node([lab, "compile", buffer, "-o", compiled]).code, 0);
  assert.deepEqual(node([compiled]), { code: 0, err: "", out: run.out });
  const check = node([lab, "check", buffer]).out;
  assert.match(check, /^edited : \(List Text, Int, Nat\) -> List Text$/m);
});
