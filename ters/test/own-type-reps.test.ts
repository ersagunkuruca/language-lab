// A representation rewrites inside the program's own types too
// (NUMBERS.md, L251): numbers stores Nat as an Int, and a record of its
// own with a Nat field (Tally's count) holds an Int then, made and read
// by the definitions the chooser rewrites. 7 × 10¹² as Peano succs would
// never finish, so an answer at all says the field was rewritten; the
// evaluator and the compiled program give the same one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const top = mkdtempSync(join(tmpdir(), "own-type-reps-"));
const dir = join(top, "numbers");
cpSync(join(import.meta.dirname, "../examples/numbers"), dir, { recursive: true });
const s = new Session(dir);
s.define("Tally", "type", [], "tally(count: Nat, label: Text)");
s.define("scaled", "function", ["t"]);
s.replace(/□#(\w+)/.exec(s.view("scaled"))![1], 'tally(multiply(t.count, power(nat(10), nat(12))), t.label ++ " trillion")');
s.replace("50f5", 'print(show(number(scaled(tally(nat(7), "seven")).count)) ++ ", " ++ scaled(tally(nat(7), "seven")).label)');
assert.equal(s.errors(), "ok");
s.save();
const node = (...args: string[]) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }); return { code: r.status, out: r.stdout, err: r.stderr }; };

test("a record with a Nat field runs on Int, evaluated and compiled, with the same answers", () => {
  assert.match(node(lab, "check", dir).out, /^Nat is stored as int, the cheapest for the jobs main uses$/m);
  const want = { code: 0, out: "7000000000000, seven trillion\n", err: "" };
  assert.deepEqual(node(lab, "run", dir, "--evaluator"), want);
  const compiled = join(top, "numbers.mjs");
  assert.equal(node(lab, "compile", dir, "-o", compiled).code, 0);
  assert.deepEqual(node(compiled), want);
});
