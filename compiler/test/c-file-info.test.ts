// A file's info in C (C310): lstat's kind, size and time last changed, as
// the evaluator with Node's world answers file info (L282), a link told as
// a link; a missing file aborts with the reason; the log is JavaScript's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { FILE_INFO_V, FILE_KIND_V, INSTANT_V, INT_OPS, IO, S } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

function program() {
  const k = new Lang();
  const kindName = (x: Id) => k.match(x, [
    { variant: FILE_KIND_V.file, names: [], body: () => k.lit("file") },
    { variant: FILE_KIND_V.folder, names: [], body: () => k.lit("folder") },
    { variant: FILE_KIND_V.link, names: [], body: () => k.lit("link") },
    { variant: FILE_KIND_V.special, names: [], body: () => k.lit("special") },
  ]);
  const show = (p: string) => k.match(k.call(IO.fileInfo, k.lit(p)), [
    { variant: FILE_INFO_V, names: ["kind", "size", "modified"], body: ([kd, sz, md]) => k.seq(
      k.call(S.print, k.call(S.concat, k.lit(`${p} `), k.call(S.concat, kindName(kd), k.call(S.concat, k.lit(" "), k.call(INT_OPS.show, sz))))),
      k.match(md, [{ variant: INSTANT_V, names: ["s"], body: ([s]) => k.call(S.print, k.call(S.show, s)) }])) },
  ]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(show("a.txt"), show("dir"), show("ln"), show("nope"), k.int(0))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}

test("file info in C answers as the evaluator does: a file, a folder, a link, and a missing file's reason (C310)", { skip }, () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true, releases: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const exe = compile(emitC(l, { main: p.main }).c);
  const dir = mkdtempSync(join(tmpdir(), "file-info-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  mkdirSync(join(dir, "dir"));
  symlinkSync("a.txt", join(dir, "ln"));
  const r = spawnSync(exe, [], { cwd: dir, env: { ...process.env, TERS_LOG: join(dir, "log.json") } });
  // The evaluator with Node's world, in the same folder.
  const printed: string[] = [];
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    runProgram(p.code, p.info, p.main, [], { print: (x) => printed.push(x), names: p.names, world: nodeWorld() });
  } finally { process.chdir(cwd); }
  assert.equal(r.stdout.toString(), printed.map((x) => `${x}\n`).join(""));
  assert.match(printed.join("\n"), /^a\.txt file 5\n[\d.]+\ndir folder \d+\n[\d.]+\nln link 5\n/);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr.toString(), /no such file or folder: nope/);
  // Logged as JavaScript logs it.
  const log = JSON.parse(readFileSync(join(dir, "log.json"), "utf8")) as { op: string; args: unknown[]; answer?: { kind: string; size: number; modified: number }; threw?: string }[];
  assert.deepEqual(log.map((x) => [x.op, x.args[0], x.answer?.kind ?? x.threw]), [["fileInfo", "a.txt", "file"], ["fileInfo", "dir", "folder"], ["fileInfo", "ln", "link"], ["fileInfo", "nope", "no such file or folder: nope"]]);
  assert.equal(log[0].answer!.size, 5);
});
