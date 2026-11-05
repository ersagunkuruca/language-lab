// Bytes (L189): whole numbers 0 to 255, checked when made, and UTF-8 written
// in the language (RFC 3629). The evaluator and compiled JavaScript agree
// with the host's TextEncoder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { Aborted, runMain } from "../src/lang/run.ts";
import { SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(SHOW_ANY, body(k))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}
const ran = (p: ReturnType<typeof program>) => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names });
async function both(body: (k: Lang) => Id) {
  const p = program(body);
  const v = ran(p);
  const path = join(mkdtempSync(join(tmpdir(), "bytes-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, v);
  return v;
}
const ints = (k: Lang, xs: number[]) => k.listOf(...xs.map((x) => k.int(x)));
const text = "hé€😀";

// Reading back what was written is a law in the prelude (T7e4,
// prelude-laws.test.ts and its compiled twin): `text of utf8 undoes utf8
// of`, `bytes of base64 undoes base64 of`, `bytes of hex undoes hex of`.
test("utf8 of gives the host's UTF-8 bytes, one to four a character, and text of utf8 reads them", async () => {
  const want = `[${[...new TextEncoder().encode(text)].join(", ")}]`;
  assert.equal(await both((k) => k.call(lib("byte items"), k.call(lib("utf8 of"), k.lit(text)))), want);
  assert.equal(await both((k) => k.call(lib("byte count"), k.call(lib("utf8 of"), k.lit(text)))), "10");
  assert.equal(await both((k) => k.call(lib("text of utf8"), k.call(lib("bytes of"), ints(k, [104, 105])))), '"hi"');
});

test("bytes of stops on an item that isn't a byte, and text of utf8 on bytes that aren't UTF-8", () => {
  const stops = (body: (k: Lang) => Id, why: RegExp) => assert.throws(() => ran(program(body)), (e: unknown) => e instanceof Aborted && why.test(String((e as Aborted).message ?? e)));
  stops((k) => k.call(lib("byte items"), k.call(lib("bytes of"), ints(k, [1, 300]))), /every item is a byte/);
  stops((k) => k.call(lib("text of utf8"), k.call(lib("bytes of"), ints(k, [0x80]))), /a following byte where a character starts/);
  stops((k) => k.call(lib("text of utf8"), k.call(lib("bytes of"), ints(k, [0xc3]))), /end inside a character/);
});

test("base64 of and hex of match Node's Buffer, and hex is read in capitals too (L189d)", async () => {
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const xs = Array.from({ length: n }, (_, i) => (i * 97 + 200) % 256);
    const bytes = (k: Lang) => k.call(lib("bytes of"), ints(k, xs));
    assert.equal(await both((k) => k.call(lib("base64 of"), bytes(k))), JSON.stringify(Buffer.from(xs).toString("base64")));
    assert.equal(await both((k) => k.call(lib("hex of"), bytes(k))), JSON.stringify(Buffer.from(xs).toString("hex")));
    assert.equal(await both((k) => k.call(lib("byte items"), k.call(lib("bytes of hex"), k.lit(Buffer.from(xs).toString("hex").toUpperCase())))), `[${xs.join(", ")}]`);
  }
  const p = program((k) => k.call(lib("byte items"), k.call(lib("bytes of hex"), k.lit("abc"))));
  assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), /bytes of hex/);
});
