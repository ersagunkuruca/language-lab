// Effects a program defines, Abort, Log, Optional and the world, compiled:
// every program here must do exactly what the evaluator does with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Id } from "../../projectional/src/model.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { Aborted, runMain, type World } from "../../projectional/src/lang/run.ts";
import { ABORT_OP, IO, LOG_OP, S, SHOW_ANY } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { $setPrint, $setWorld } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "effects-"));

function fakeWorld(files: Record<string, string>, input: string) {
  const out: string[] = [];
  const lines = input.split("\n");
  const world: World = {
    error: (l) => out.push(`error: ${l}`),
    log: (l) => out.push(`log: ${l}`),
    input: () => input,
    readLine: () => (lines.length ? lines.shift()! : null),
    readFile: (p) => { if (!(p in files)) throw new Error(`no such file: ${p}`); return files[p]; },
    writeFile: (p, t) => { files[p] = t; },
    appendFile: (p, t) => { files[p] = (files[p] ?? "") + t; },
    fileExists: (p) => p in files,
    listFolder: () => Object.keys(files).sort(),
  };
  return { world, out };
}

let n = 0;
// Run main both ways, each with its own copy of the same world, and return
// what each printed, logged and left in the files.
async function both(build: (k: Lang) => Id, files: Record<string, string> = {}, input = "") {
  const k = new Lang();
  const main = build(k);
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const path = join(dir, `p${n++}.js`);
  writeFileSync(path, compile(code, info, names, { runtime, exports: [names[main]] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  const run = (go: (print: (s: string) => void, world: World) => void) => {
    const w = fakeWorld({ ...files }, input);
    const lines: string[] = [];
    try { go((s) => lines.push(s), w.world); } catch (e) { if (!(e instanceof Aborted)) throw e; lines.push(`aborted: ${e.reason}`); }
    return { lines, out: w.out };
  };
  const want = run((print, world) => runMain(code, info, main, { print, names, world }));
  const got = run((print, world) => { $setPrint(print); $setWorld(world); defs[names[main]](); });
  assert.deepEqual(got, want);
  return want;
}

const show = (k: Lang, x: Id) => k.call(S.show, x);

test("abort, caught by a match and not caught at all", async () => {
  const r = await both((k) => {
    const check = k.def("check");
    k.define(check, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0)), k.call(ABORT_OP, k.lit("negative")), k.call(B.sqrt, n))));
    const safe = k.def("safe");
    k.define(safe, k.fn(["n"], (n) => k.handle(show(k, k.call(check, n)), [
      { variant: ABORT_OP, names: ["why"], body: ([why]) => k.text(k.lit("refused: "), why) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(safe, k.lit(9))), k.call(S.print, k.call(safe, k.lit(-1))), k.call(S.print, show(k, k.call(check, k.lit(-2)))))));
    return main;
  });
  assert.deepEqual(r.lines, ["3", "refused: negative", "aborted: negative"]);
});

test("answers, deep handlers, and Log to the runtime", async () => {
  const r = await both((k) => {
    const ask = k.effect("Ask", [["ask", [["question", () => k.tref("type.string")]], () => k.tref("type.number")]]);
    const sum = k.def("sum");
    k.define(sum, k.thunk(() => k.seq(k.call(LOG_OP, k.lit("asking")), k.call(B.add, k.call(ask.op.ask, k.lit("width")), k.call(ask.op.ask, k.lit("height"))))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, show(k, k.handle(k.handle(k.call(sum), [
      { variant: ask.op.ask, names: ["q"], body: ([q]) => k.seq(k.call(LOG_OP, q), k.if(k.equal(q, k.lit("width")), k.lit(30), k.lit(12))) },
    ]), [{ variant: LOG_OP, names: ["line"], body: ([line]) => k.call(LOG_OP, k.text(k.lit("sum: "), line)) }])))));
    return main;
  });
  assert.deepEqual(r.lines, ["42"]);
  assert.deepEqual(r.out, ["log: sum: asking", "log: sum: width", "log: sum: height"]);
});

test("an abort under Choice cuts the alternatives, compiled too", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() =>
      k.handle(k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) =>
        k.if(k.equal(x, k.lit(2)), k.call(ABORT_OP, k.lit("two")), x)),
      [{ variant: ABORT_OP, names: ["why"], body: () => k.lit(0) }])))))));
    return main;
  });
  assert.deepEqual(r.lines, ["[1, 0]"]);
});

test("optional and value of", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    const pick = (xs: Id) => k.call(S.optional, k.thunk(() => k.call(S.oneOf, xs)));
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, k.call(SHOW_ANY, pick(k.x("std.list.nil")))),
      k.call(S.print, k.call(SHOW_ANY, pick(k.list(k.lit(5), k.lit(6))))),
      k.call(S.print, k.call(S.first, k.thunk(() => show(k, k.call(S.valueOf, pick(k.list(k.lit(7)))))), k.thunk(() => k.lit("none")))),
    )));
    return main;
  });
  assert.deepEqual(r.lines, ["none", "some(5)", "7"]);
});

test("files and the console, a missing file caught", async () => {
  const r = await both((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      k.call(IO.appendFile, k.lit("notes.txt"), k.lit("two\n")),
      k.call(IO.writeFile, k.lit("copy.txt"), k.call(IO.readFile, k.lit("notes.txt"))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.listFolder, k.lit(".")))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.fileExists, k.lit("copy.txt")))),
      k.call(S.print, k.call(SHOW_ANY, k.call(IO.readLine))),
      k.call(IO.printError, k.call(IO.readFile, k.lit("copy.txt"))),
      k.call(S.print, k.handle(k.call(IO.readFile, k.lit("gone.txt")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])),
      k.call(IO.readFile, k.lit("gone too.txt")),
    )));
    return main;
  }, { "notes.txt": "one\n" }, "first line\nsecond");
  assert.deepEqual(r.lines, [`["copy.txt", "notes.txt"]`, "true", `some("first line")`, "no such file: gone.txt", "aborted: no such file: gone too.txt"]);
  assert.deepEqual(r.out, ["error: one\ntwo\n"]);
});
