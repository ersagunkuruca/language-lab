// Int's own definition as data (L249b): from(n) is the natural number n
// and minus one minus(n) is −1 − n, so a match on an Int splits it by sign
// and hands over a Nat, as examples/trits's odometer does. int-cases.ts
// writes the match and the cases out on Int; evaluated, compiled, as
// defined (Nat as data) and on Nat stored as an Int they agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

const trits = join(import.meta.dirname, "../examples/trits");
const lab = join(import.meta.dirname, "../cli/ters.ts");
const node = (args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout, err: r.stderr, code: r.status }; };
const session = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "int-cases-")), "t");
  cpSync(trits, dir, { recursive: true });
  return new Session(dir);
};

test("from and minus one minus are Ints, made and given as functions", () => {
  const s = session();
  assert.match(s.eval("from(3)"), /^= 3 : Int$/m);
  assert.match(s.eval("minus one minus(2)"), /^= -3 : Int$/m);
  assert.match(s.eval("from(3) + 1"), /^= 4 : Int$/m);
  assert.match(s.eval("map([0, 2], minus one minus)"), /^= \[-1, -3\] : List Int$/m);
});

test("a match on an Int splits it by sign, with a Nat in each case", () => {
  const s = session();
  s.define("sign word", "function", ["n"]);
  s.replace(/□#(\w+)/.exec(s.view("sign word"))![1], 'match n\n  from(k) → "from " ++ show(integer(k))\n  minus one minus(k) → "below by " ++ show(integer(k) + 1)');
  assert.equal(s.errors(), "ok");
  assert.match(s.eval("sign word(0)"), /^= "from 0" : Text$/m);
  assert.match(s.eval("sign word(7)"), /^= "from 7" : Text$/m);
  assert.match(s.eval("sign word(-1)"), /^= "below by 1" : Text$/m);
  assert.match(s.eval("sign word(-12)"), /^= "below by 12" : Text$/m);
  // trits's odometer walks by the match.
  assert.match(s.view("walked"), /match d\n.*from\(k#\w+\) → stepped\(incremented, ts, k\)/);
  assert.match(s.eval("shown(walked(trits of(4), -7))"), /^= "−0" : Text$/m);
});

test("trits's match on an Int runs alike evaluated, compiled and as defined", () => {
  const run = node([lab, "run", trits]);
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(node([lab, "run", "--evaluator", trits]).out, run.out);
  assert.deepEqual(node([lab, "run", "--as-defined", trits]).out, run.out);
  const compiled = join(mkdtempSync(join(tmpdir(), "int-cases-")), "trits.mjs");
  assert.equal(node([lab, "compile", trits, "-o", compiled]).code, 0);
  assert.deepEqual(node([compiled]).out, run.out);
  assert.doesNotMatch(readFileSync(join(trits, "code.json"), "utf8"), /"natural"/);
});
