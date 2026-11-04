// JSON (L190, RFC 8259): a Json value printed as JSON text, written in the
// language. The evaluator and compiled JavaScript agree, and the host's
// JSON.parse reads back what was written.
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
import { runMain } from "../src/lang/run.ts";
import { JSON_V, NIL as NIL_ID, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";

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
  const path = join(mkdtempSync(join(tmpdir(), "json-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, v);
  return v;
}
test("json printed writes null, Bools, numbers, quoted text, lists and objects, as JSON.parse reads them", async () => {
  const value = { name: "a \"b\"\\\n\u0001é", n: -2.5, big: 1e21, ok: true, none: null, items: [1, [], {}] };
  const json = (k: Lang, v: unknown): Id => {
    if (v === null) return k.x(JSON_V.null);
    if (typeof v === "boolean") return k.call(JSON_V.bool, v ? k.true : k.false);
    if (typeof v === "number") return k.call(JSON_V.number, k.lit(v));
    if (typeof v === "string") return k.call(JSON_V.text, k.lit(v));
    if (Array.isArray(v)) return k.call(JSON_V.list, k.listOf(...v.map((x) => json(k, x))));
    return k.call(JSON_V.object, k.listOf(...Object.entries(v as object).map(([n, x]) => k.call(PAIR_V, k.lit(n), json(k, x)))));
  };
  const shown = await both((k) => k.call(lib("json printed"), json(k, value)));
  const printed = JSON.parse(shown as string) as string;
  assert.deepEqual(JSON.parse(printed), value);
  assert.equal(printed, JSON.stringify(value));
});

test("json read reads what JSON.stringify writes, and json printed gives it back", async () => {
  const value = { name: "a \"b\"\\\n\u0001éé", n: -2.5, big: 1e21, small: 1e-7, ok: true, no: false, none: null, items: [1, [], {}, [2, { x: "y" }]] };
  const spaced = JSON.stringify(value, null, 2).replace("é", "\\u00e9");
  const shown = await both((k) => k.call(lib("json printed"), k.call(lib("json read"), k.lit(spaced))));
  assert.equal(JSON.parse(shown as string), JSON.stringify(value));
});

test("json read stops on text that isn't JSON, saying where", () => {
  const stops = (text: string, why: RegExp) => {
    const p = program((k) => k.call(lib("json read"), k.lit(text)));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), (e: unknown) => why.test(String((e as Error).message ?? e)));
  };
  stops("[1, 2", /ends inside a list/);
  stops("{\"a\" 1}", /expected : after a field's name/);
  stops("nul", /expected null/);
  stops("1 2", /text after the value/);
  stops("\"open", /ends inside a string/);
});

test("a record read from JSON through json field and json as …, with a default where a part is missing", async () => {
  const read = (k: Lang, text: string) => k.call(lib("json read"), k.lit(text));
  const orElse = (k: Lang, body: () => Id, otherwise: () => Id) => k.call(S.first, k.thunk(body), k.thunk(otherwise));
  const person = '{"name": "Ada", "born": 1815, "tags": ["maths", "engines"], "alive": false}';
  assert.equal(await both((k) => orElse(k, () => k.call(lib("json as text"), k.call(lib("json field"), read(k, person), k.lit("name"))), () => k.lit("?"))), '"Ada"');
  assert.equal(await both((k) => orElse(k, () => k.call(lib("json as number"), k.call(lib("json field"), read(k, person), k.lit("born"))), () => k.lit(0))), "1815");
  assert.equal(await both((k) => k.call(lib("length"), orElse(k, () => k.call(lib("json as list"), k.call(lib("json field"), read(k, person), k.lit("tags"))), () => k.x(NIL_ID)))), "2");
  assert.equal(await both((k) => orElse(k, () => k.call(lib("json as bool"), k.call(lib("json field"), read(k, person), k.lit("alive"))), () => k.true)), "false");
  // Missing, or the wrong kind: the default.
  assert.equal(await both((k) => orElse(k, () => k.call(lib("json as text"), k.call(lib("json field"), read(k, person), k.lit("died"))), () => k.lit("?"))), '"?"');
  assert.equal(await both((k) => orElse(k, () => k.call(lib("json as text"), k.call(lib("json field"), read(k, person), k.lit("born"))), () => k.lit("?"))), '"?"');
});

test("csv printed quotes only where it must, and csv rows reads it back, CRLF too (L190e)", async () => {
  const rows = [["name", "note"], ["Ada", "said \"hi\", twice"], ["Bob", "two\nlines"], ["", "x"]];
  const lit = (k: Lang) => k.listOf(...rows.map((r) => k.listOf(...r.map((c) => k.lit(c)))));
  const text = 'name,note\nAda,"said ""hi"", twice"\nBob,"two\nlines"\n,x';
  assert.equal(await both((k) => k.call(lib("csv printed"), lit(k))), JSON.stringify(text));
  const back = await both((k) => k.call(lib("csv rows"), k.call(lib("csv printed"), lit(k))));
  assert.equal(back, await both(lit));
  assert.equal(await both((k) => k.call(lib("csv rows"), k.lit("a,b\r\nc,d\r\n"))), '[["a", "b"], ["c", "d"]]');
});

test("json printed indented is JSON.stringify(value, null, step) (L190f)", async () => {
  const value = { name: "Ada", tags: ["a", "b"], empty: [], none: {}, nested: { deep: [1, { x: null }] }, ok: true };
  for (const step of [2, 4, 0]) {
    const shown = await both((k) => k.call(lib("json printed indented"), k.call(lib("json read"), k.lit(JSON.stringify(value))), k.int(step)));
    assert.equal(JSON.parse(shown as string), JSON.stringify(value, null, step));
  }
  assert.equal(JSON.parse((await both((k) => k.call(lib("json printed indented"), k.call(lib("json read"), k.lit("[]")), k.int(2)))) as string), "[]");
});

test("csv records reads a CSV with a header line as maps from the header's names (L190g)", async () => {
  const text = 'name,age\nAda,36\n"Lovelace, A",\nBob';
  const got = await both((k) => k.call(lib("csv records"), k.lit(text)));
  assert.equal(got, '[map of([("age", "36"), ("name", "Ada")]), map of([("age", ""), ("name", "Lovelace, A")]), map of([("name", "Bob")])]');
  assert.equal(await both((k) => k.call(lib("csv records"), k.lit(""))), "[]");
});
