// examples/waiting (the example for L247): an hour of an online waiting
// room, people joining at the back of a line each second and the one at
// the front let in. The line is a type of the program's own with two
// representations of its own: a list front first, whose `behind` is
// declared constant but appends at the end, walking the whole line, and
// two lists (Okasaki's queue), constant for every job. Declared alike, the
// compiler took the first: native, sixteen hours took 19 s, where two
// lists take 0.006 s. Worked out from its definition (L247, job-cost.ts),
// front first's behind takes at least log n (an append, a tree's at best),
// so two lists is taken.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const waiting = join(import.meta.dirname, "../examples/waiting");
const node = (args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };

test("waiting: an hour of a waiting room, evaluated and compiled", () => {
  const run = node([lab, "run", waiting]);
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(run.out.trimEnd().split("\n"), ["Let in: 3598", "Waited on average: 576 s", "Longest line: 1787", "Still waiting: 1785"]);
  assert.equal(node([lab, "run", "--evaluator", waiting]).out, run.out);
  const compiled = join(mkdtempSync(join(tmpdir(), "waiting-")), "waiting.mjs");
  assert.equal(node([lab, "compile", waiting, "-o", compiled]).code, 0);
  assert.deepEqual(node([compiled]), { code: 0, err: "", out: run.out });
});

test("waiting: the line's representations, front first's behind worked out (L247)", () => {
  const check = node([lab, "check", waiting]).out;
  assert.match(check, /^seconds : \(Line, Int, Int, Tally, Nat\) -> Tally$/m);
  assert.match(check, /^front first : Representation Line \(List Int\)$/m);
  assert.match(check, /^two lists line : Representation Line Two lists$/m);
  // Declared alike; worked out, front first's behind is more (L247).
  assert.match(check, /^front first declares behind constant, but list behind always takes at least log n \(it calls append\): counted at log n$/m);
  assert.match(check, /^Line is stored as two lists line, the cheapest for the jobs main uses$/m);
});
