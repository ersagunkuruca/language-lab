// `lab test --compiled` (T7e): each accepted answer in examples.json is
// checked again on the core IR's JavaScript, called on the evaluator's
// values, and must print the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { CHECK_OP, INT_OPS, S } from "../../ters/src/lang/std.ts";
import { INT } from "../../ters/src/lang/types.ts";

test("lab test --compiled checks each accepted answer on the compiled program too (T7e)", () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  type Id = string;
  const P = k.type("Point", [], [["point", [["x", () => k.tref(INT)], ["y", () => k.tref(INT)]]]]);
  const next = def("next", ["n"], (n) => k.call(INT_OPS.add, n, k.int(1)));
  const pair = def("pair", ["n"], (n) => k.call(P.v.point, n, k.call(INT_OPS.add, n, k.int(1))));
  const small = def("small", ["n"], (n) => k.if(k.call(INT_OPS.less, n, k.int(3)), n, k.call(S.fail)));
  const dir = mkdtempSync(join(tmpdir(), "lab-test-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const examples = (wrong: boolean) => writeFileSync(join(dir, "examples.json"), JSON.stringify({
    [next]: [{ inputs: ["2"], answer: wrong ? "4" : "3" }, { inputs: ["100000000000000000000"], answer: "100000000000000000001" }],
    [pair]: [{ inputs: ["2"], answer: "point(2, 3)" }],
    [small]: [{ inputs: ["1"], answer: "1" }],
  }));
  const lab = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/lab.ts"), "test", dir, "--fresh", ...args], { encoding: "utf8" });
  examples(false);
  const ok = lab("--compiled");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  for (const n of ["next", "pair", "small"]) assert.match(ok.stdout, new RegExp(`^✓ ${n} compiled \\(\\d+ cases?\\)$`, "m"), ok.stdout);
  // Without the flag, only the evaluator's.
  assert.doesNotMatch(lab().stdout, /compiled/);
  // A wrong accepted answer fails both ways.
  examples(true);
  const bad = lab("--compiled");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^✗ next\(2\): gives 3, accepted 4$/m);
  assert.match(bad.stdout, /^✗ next compiled\(2\): gives 3, accepted 4$/m);
});

// T7e2: a test's Check runs compiled too, under a handler of its expects
// written in the language (tests.ts checkedTests), on the same inputs as
// the evaluator's run.
test("lab test --compiled runs each test's Check on the compiled program too (T7e2)", () => {
  type Id = string;
  const k = new Lang(LIBRARY.code);
  const def = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const expect = (holds: Id, what: string) => k.call(CHECK_OP, holds, k.lit(what));
  const double = def("double", ["n"], (n) => k.call(INT_OPS.add, n, n));
  def("double is even", ["n"], (n) => expect(k.call(S.equal, k.call(INT_OPS.sub, k.call(double, n), n), n), "double n - n = n"));
  def("double grows", ["n"], (n) => expect(k.call(INT_OPS.less, n, k.call(double, n)), "n < double n"));
  const dir = mkdtempSync(join(tmpdir(), "lab-test-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
  writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/lab.ts"), "test", dir, "--fresh", "--compiled"], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^✓ double is even compiled \(\d+ cases\)$/m, r.stdout);
  // n < 2n fails at 0 (and below) both ways, with the same text.
  assert.match(r.stdout, /^✗ double grows\(0\): n < double n$/m, r.stdout);
  assert.match(r.stdout, /^✗ double grows compiled\(0\): n < double n$/m, r.stdout);
});
