// file info (L282): a file's kind, size and modified time, from lstat, so a
// link is a link; a missing file aborts with the reason, as read file does.
// The evaluator and compiled JavaScript agree, and so does the store of a
// page, where every file is a plain one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compiledMain } from "../../compiler/src/core-js.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { browserWorld } from "../src/lang/browser.ts";
import { ABORT_OP, FILE_INFO_V, INSTANT_V, IO, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

// main: for each path, its kind, size and modified seconds, or why not.
function program(paths: string[]) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const told = (p: string) => k.handle(k.match(k.call(IO.fileInfo, k.lit(p)), [{ variant: FILE_INFO_V, names: ["kind", "size", "modified"], body: ([kind, size, m]) =>
    k.text(k.call(SHOW_ANY, kind), k.lit(" "), k.call(SHOW_ANY, size), k.lit(" "), k.call(SHOW_ANY, k.match(m, [{ variant: INSTANT_V, names: ["seconds"], body: ([s]) => s }]))) }]),
  [{ variant: ABORT_OP, names: ["why"], body: () => k.lit("not there") }]);
  k.define(main, k.thunk(() => k.seq(...paths.map((p) => k.call(S.print, told(p))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

test("file info: a file, a folder, a link and a missing one, evaluated and compiled", () => {
  const dir = mkdtempSync(join(tmpdir(), "file-info-"));
  writeFileSync(join(dir, "a.txt"), "héllo");
  utimesSync(join(dir, "a.txt"), 1700000000, 1700000000.5);
  mkdirSync(join(dir, "sub"));
  utimesSync(join(dir, "sub"), 1600000000, 1600000000);
  symlinkSync("a.txt", join(dir, "ln"));
  const { code, names, info, main } = program(["a.txt", "sub", "ln", "missing"].map((p) => join(dir, p)));
  const ran: string[] = [];
  runMain(code, info, main, { print: (l) => ran.push(l), names, world: nodeWorld() });
  // A folder's size is the file system's own (4096 on ext4).
  assert.equal(ran[0], "plain file 6 1700000000.5");
  assert.match(ran[1], /^folder \d+ 1600000000$/);
  assert.match(ran[2], /^link 5 /);
  assert.equal(ran[3], "not there");
  const compiled: string[] = [];
  compiledMain(code, info, names, { print: (l: string) => compiled.push(l), world: nodeWorld() } as never);
  assert.deepEqual(compiled, ran);
});

test("file info on a page: a stored file is a plain file, with its size in bytes and when it was written", () => {
  const m = new Map<string, string>();
  const store = { getItem: (key: string) => m.get(key) ?? null, setItem: (key: string, v: string) => void m.set(key, v), removeItem: (key: string) => void m.delete(key), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null };
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(IO.writeFile, k.lit("note.txt"), k.lit("é!")),
    k.call(S.print, k.match(k.call(IO.fileInfo, k.lit("note.txt")), [{ variant: FILE_INFO_V, names: ["kind", "size", "modified"], body: ([kind, size]: Id[]) => k.text(k.call(SHOW_ANY, kind), k.lit(" "), k.call(SHOW_ANY, size)) }])),
    k.call(S.print, k.call(SHOW_ANY, k.call(IO.listFolder, k.lit("")))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const out: string[] = [];
  const before = Date.now() / 1000;
  runMain(code, info, main, { print: (l) => out.push(l), names, world: browserWorld(store, "t") });
  assert.deepEqual(out, ["plain file 3", '["note.txt"]']);
  assert.ok(Number(m.get("modified lab:t:note.txt")) >= Math.floor(before));
});
