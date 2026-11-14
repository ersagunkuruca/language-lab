// examples/trits (the example for L249b): balanced ternary from −13 to 13,
// read back, and an odometer that turns one digit step at a time, run by
// the evaluator and compiled alike. Its `walked` splits a step count by
// sign with a match on the Int (L249b's `from(k)` and `minus one
// minus(k)`), and its five steps are written `5`, a Nat literal (L249b).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const trits = join(import.meta.dirname, "../examples/trits");
const node = (args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };

test("trits: balanced ternary and its odometer, evaluated and compiled", () => {
  const run = node([lab, "run", trits]);
  assert.equal(run.code, 0, run.err);
  const lines = run.out.trimEnd().split("\n");
  assert.equal(lines.length, 1 + 27 + 2);
  assert.equal(lines[1], " -13   −−−  -13");
  assert.equal(lines[14], "   0     0  0");
  assert.equal(lines[27], "  13   +++  13");
  assert.equal(lines[28], "odometer agrees from −6 to 6: yes");
  assert.equal(lines[29], "13, five steps up: +−00");
  for (const l of lines.slice(1, 28)) { const [n, , back] = l.trim().split(/\s+/); assert.equal(back, n); }
  const compiled = join(mkdtempSync(join(tmpdir(), "trits-")), "trits.mjs");
  assert.equal(node([lab, "compile", trits, "-o", compiled]).code, 0);
  assert.deepEqual(node([compiled]), { code: 0, err: "", out: run.out });
  const check = node([lab, "check", trits]).out;
  assert.match(check, /^stepped : \(\(a\) -\[e\]-> a, a, Nat\) -\[e\]-> a$/m);
  assert.match(check, /^walked : \(List Trit, Int\) -> List Trit$/m);
});
