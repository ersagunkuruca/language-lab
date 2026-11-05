// `with open file` on C (L213c5, open-file.test.ts for the others): the
// file kept open while the body runs, its lines read from the start and
// added at the end, closed once however the body ends.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { ABORT_OP, NEXT_LINE_OP, S, SHOW_ANY, WRITE_LINE_OP } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("C keeps a file open with open file: lines from its start, lines added at its end, as the evaluator does", { skip }, () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("with open file"), k.lit("notes.txt"), k.thunk(() => k.listOf(
    k.call(NEXT_LINE_OP), k.call(NEXT_LINE_OP),
    k.seq(k.call(WRITE_LINE_OP, k.lit("added")), k.call(NEXT_LINE_OP)), k.call(NEXT_LINE_OP), k.call(NEXT_LINE_OP))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main }).c);
  const text = "first\r\nsecond\nthird";
  // The evaluator in one folder, C in another.
  const ev = mkdtempSync(join(tmpdir(), "open-file-")), cd = mkdtempSync(join(tmpdir(), "open-file-c-"));
  writeFileSync(join(ev, "notes.txt"), text);
  writeFileSync(join(cd, "notes.txt"), text);
  const printed: string[] = [], cwd = process.cwd();
  process.chdir(ev);
  try { runMain(code, info, main, { print: (x) => printed.push(x), names, world: { ...nodeWorld(), log: () => {} } }); } finally { process.chdir(cwd); }
  assert.deepEqual(printed, ['[some("first"), some("second"), some("thirdadded"), none, none]']);
  const r = spawnSync(exe, [], { cwd: cd });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(r.stdout.toString().split("\n").filter((x) => x), printed);
  assert.equal(readFileSync(join(cd, "notes.txt"), "utf8"), readFileSync(join(ev, "notes.txt"), "utf8"));
});

test("an Abort inside the body still closes the file on C, after its lines are written", { skip }, () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("with open file"), k.lit("log.txt"), k.thunk(() => k.seq(k.call(WRITE_LINE_OP, k.lit("started")), k.call(ABORT_OP, k.lit("gave up")), k.int(1))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const cd = mkdtempSync(join(tmpdir(), "open-file-c-"));
  const r = spawnSync(compile(emitC(l, { main }).c), [], { cwd: cd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr.toString(), /gave up/);
  assert.equal(readFileSync(join(cd, "log.txt"), "utf8"), "started\n");
});
