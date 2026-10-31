// The world's effects declared in std (HOSTS.md, BACKLOG L55): Console,
// Files and Network have operations, so a match handles what a program
// prints or reads, and the world answers what nothing handles. Evaluated
// and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { CONSOLE, FILES } from "../src/lang/types.ts";
import { IO, NONE, S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";

const op = (effect: string, name: string) => `${effect}.${name}`;
// A handler has a case for every operation of its effect; the ones a
// program doesn't change are passed on to the world, as a case's own
// call goes past its match.
const passOn = (k: Lang, effect: string, cases: [string, string[], Id][]) =>
  cases.map(([name, ps, b]) => ({ variant: op(effect, name), names: ps, body: (xs: Id[]) => k.call(b, ...xs) }));
const otherConsole = (k: Lang) => passOn(k, CONSOLE, [["print error", ["line"], IO.printError], ["read input", [], IO.readInput], ["read line", [], IO.readLine]]);
const otherFiles = (k: Lang) => passOn(k, FILES, [["write file", ["path", "text"], IO.writeFile], ["add to file", ["path", "text"], IO.appendFile], ["file exists", ["path"], IO.fileExists], ["list folder", ["path"], IO.listFolder]]);

function program() {
  const k = new Lang();
  // Lines printed inside are printed again with "> " in front: the case's
  // own print goes to the world, since a case runs outside its match.
  const quoted = k.def("quoted");
  k.define(quoted, k.thunk(() => k.handle(k.seq(k.call(S.print, k.lit("a")), k.call(S.print, k.lit("b"))),
    [{ variant: op(CONSOLE, "print"), names: ["line"], body: ([line]) => k.call(S.print, k.text(k.lit("> "), line)) }, ...otherConsole(k)])));
  // Printing nothing: the match answers print, and Console leaves the row.
  const quiet = k.def("quiet");
  k.define(quiet, k.thunk(() => k.handle(k.seq(k.call(S.print, k.lit("hidden")), k.lit("done")),
    [{ variant: op(CONSOLE, "print"), names: ["line"], body: () => k.unitValue },
      { variant: op(CONSOLE, "print error"), names: ["line"], body: () => k.unitValue },
      { variant: op(CONSOLE, "read input"), names: [], body: () => k.lit("") },
      { variant: op(CONSOLE, "read line"), names: [], body: () => k.x(NONE) }])));
  // A file of the program's own.
  const fake = k.def("fake file");
  k.define(fake, k.thunk(() => k.handle(k.call(IO.readFile, k.lit("notes.txt")),
    [{ variant: op(FILES, "read file"), names: ["path"], body: ([p]) => k.text(k.lit("the text of "), p) }, ...otherFiles(k)])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(k.call(quoted), k.call(S.print, k.call(quiet)), k.call(S.print, k.call(fake)), k.call(S.print, k.lit("after")))));
  return { code: base(k.code), names: baseNames(k.names), quiet, main };
}

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const EXPECTED = ["> a", "> b", "done", "the text of notes.txt", "after"];

test("a match handles print and read file; what nothing handles goes to the world", () => {
  const { code, names, quiet, main } = program();
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(quiet)!, names), "() -> Text");
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names });
  assert.deepEqual(out, EXPECTED);
});

test("compiled, the same", async () => {
  const { code, names } = program();
  const info = infer(code, names);
  const path = join(mkdtempSync(join(tmpdir(), "world-")), "world.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const out: string[] = [];
  $setPrint((s: string) => out.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  assert.deepEqual(out, EXPECTED);
});

test("WebAssembly and C refuse a match on the world's effects, rather than skip it", async () => {
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { code, names, quiet } = program();
  const info = infer(code, names);
  const lowered = lowerScalar(code, info, names, [quiet], { data: true });
  assert.ok(lowered.refused.has(quiet), "quiet is lowered");
});
