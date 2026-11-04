// Files as bytes (BACKLOG L189c, bytes.ts): `write bytes` writes a Bytes
// as it is and `read bytes` reads a file's bytes with no decoding, bytes
// that aren't UTF-8 included. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $main, $setPrint, $setWorld } from "../../compiler/src/runtime.js";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { ABORT_OP, IO, S, SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("write bytes and read bytes keep every byte; a missing file aborts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bytes-files-"));
  const given = join(dir, "given.bin");
  // Not UTF-8: 0xff and a lone continuation byte.
  writeFileSync(given, Uint8Array.from([0xff, 0x80, 0x41]));
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const out = (name: string) => k.lit(join(dir, name));
  const items = (b: string) => k.call(SHOW_ANY, k.call(lib("byte items"), b));
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, items(k.call(IO.readBytes, k.lit(given)))),
    k.call(IO.writeBytes, out("made.bin"), k.call(lib("bytes of"), k.list(k.int(0), k.int(255), k.int(10), k.int(200)))),
    k.call(S.print, items(k.call(IO.readBytes, out("made.bin")))),
    k.call(IO.writeBytes, out("text.bin"), k.call(lib("utf8 of"), k.lit("é!"))),
    k.call(S.print, k.call(lib("text of utf8"), k.call(IO.readBytes, out("text.bin")))),
    k.call(S.print, k.handle(k.call(SHOW_ANY, k.call(lib("byte count"), k.call(IO.readBytes, out("missing.bin")))), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit("no such file") }])))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (l) => ran.push(l), names, world: nodeWorld() });
  assert.deepEqual(ran, ["[255, 128, 65]", "[0, 255, 10, 200]", "é!", "no such file"]);
  assert.deepEqual([...readFileSync(join(dir, "made.bin"))], [0, 255, 10, 200]);

  const file = join(dir, "main.mjs");
  writeFileSync(file, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((l: string) => compiled.push(l));
  $setWorld(nodeWorld());
  try { await $main((await import(pathToFileURL(file).href)).defs.main()); } finally { $setPrint((l: string) => console.log(l)); $setWorld({}); }
  assert.deepEqual(compiled, ran);
});
