// The first resource (BACKLOG L213c, RESOURCES-2026-11-03.md): the
// prelude's `with open file` keeps a file open while a body runs, answering
// next line and write line, and closes it once however the body ends. The
// file's number never reaches the program: the operations on it are
// private to the library, and outside the handler nothing answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { Aborted, runMain } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { ABORT_OP, ADD_BYTES_OP, FILE_OPS, LOG_OP, NEXT_BYTES_OP, NEXT_LINE_OP, S, SHOW_ANY, WRITE_LINE_OP } from "../src/lang/std.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, body(k)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  return { code, names, info, main };
}
function run(p: ReturnType<typeof program>) {
  const printed: string[] = [], closed: number[] = [];
  const world = nodeWorld();
  const close = world.closeFile!;
  world.closeFile = (f) => { closed.push(f); close(f); };
  const go = () => runMain(p.code, p.info, p.main, { print: (l) => printed.push(l), names: p.names, world: { ...world, log: () => {} } });
  return { printed, closed, go };
}

test("with open file reads a file's lines from its start and adds lines at its end, then closes it once", () => {
  const path = join(mkdtempSync(join(tmpdir(), "open-file-")), "notes.txt");
  writeFileSync(path, "first\r\nsecond\nthird");
  // Read two lines, add one, read the rest: the third line, then the added
  // one, then none.
  const p = program((k) => k.call(lib("with open file"), k.lit(path), k.thunk(() => k.listOf(
    k.call(NEXT_LINE_OP), k.call(NEXT_LINE_OP),
    k.seq(k.call(WRITE_LINE_OP, k.lit("added")), k.call(NEXT_LINE_OP)), k.call(NEXT_LINE_OP), k.call(NEXT_LINE_OP)))));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = run(p);
  r.go();
  assert.deepEqual(r.printed, ['[some("first"), some("second"), some("thirdadded"), none, none]']);
  assert.equal(readFileSync(path, "utf8"), "first\r\nsecond\nthirdadded\n");
  assert.equal(r.closed.length, 1);
});

test("an Abort inside the body still closes the file, once", () => {
  const path = join(mkdtempSync(join(tmpdir(), "open-file-")), "log.txt");
  const p = program((k) => k.call(lib("with open file"), k.lit(path), k.thunk(() => k.seq(k.call(WRITE_LINE_OP, k.lit("started")), k.call(ABORT_OP, k.lit("gave up")), k.int(1)))));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = run(p);
  assert.throws(() => r.go(), (e) => e instanceof Aborted && e.reason === "gave up");
  assert.equal(r.closed.length, 1);
  assert.equal(readFileSync(path, "utf8"), "started\n");
});

test("the file's number stays in the library, and next line outside it is answered by nothing", () => {
  const p = program((k) => k.call(FILE_OPS.open, k.lit("x.txt")));
  assert.match(p.info.errors.map((e) => e.message).join("\n"), /private to the library/);
  const q = program((k) => k.call(NEXT_LINE_OP));
  assert.throws(() => run(q).go(), /unhandled effect: Open file/);
  // A release of the program's own may still only log.
  const r = program((k) => k.handle(k.int(1), [{ variant: LOG_OP, names: ["line"], body: () => k.unitValue }], undefined, () => k.call(S.print, k.lit("bye"))));
  assert.match(r.info.errors.map((e) => e.message).join("\n"), /may only log/);
});

// Bytes (L213c2): next bytes reads from where next line left off, fewer at
// the end and none after it; add bytes adds them at the end, any byte.
test("with open file reads and adds bytes from the place lines are read from", () => {
  const path = join(mkdtempSync(join(tmpdir(), "open-file-")), "data.bin");
  writeFileSync(path, Uint8Array.from([...Buffer.from("head\n"), 0xff, 0x00, 0x80]));
  const items = (k: Lang, b: Id) => k.call(lib("byte items"), b);
  const p = program((k) => k.call(lib("with open file"), k.lit(path), k.thunk(() => k.listOf(
    k.call(SHOW_ANY, k.call(NEXT_LINE_OP)),
    k.call(SHOW_ANY, items(k, k.call(NEXT_BYTES_OP, k.int(2)))),
    k.seq(k.call(ADD_BYTES_OP, k.call(lib("bytes of"), k.list(k.int(7), k.int(255)))), k.call(SHOW_ANY, items(k, k.call(NEXT_BYTES_OP, k.int(10))))),
    k.call(SHOW_ANY, items(k, k.call(NEXT_BYTES_OP, k.int(4))))))));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = run(p);
  r.go();
  assert.deepEqual(r.printed, ['["some(\\"head\\")", "[255, 0]", "[128, 7, 255]", "[]"]']);
  assert.deepEqual([...readFileSync(path)].slice(-5), [0xff, 0x00, 0x80, 7, 255]);
  assert.equal(r.closed.length, 1);
});
