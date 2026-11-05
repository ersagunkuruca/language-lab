// JSON (L190, RFC 8259): a Json value printed as JSON text, written in the
// language. The evaluator and compiled JavaScript agree, and the host's
// JSON.parse reads back what was written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { JSON_V, NIL as NIL_ID, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";

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
  // The core IR's JavaScript, as the editor and `lab build` run it: it
  // reads JSON through json read's written reader where compile.ts would
  // search (L72f).
  const core = lowerCore(p.code, p.info, p.names, [p.main]);
  assert.deepEqual([...core.refused.values()], []);
  const main = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === p.main && !g.inner)];
  assert.equal(main(), v);
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

// json read's written reader on the core IR read a text's characters
// through json character spelled's Choice, which nested the rest of the
// reading in each character's: 300 bytes ran out of stack (L72e1d).
test("json read reads a long text compiled, without running out of stack", async () => {
  const text = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item ${i} "q"`, tags: ["a", "b"], price: i * 1.25, ok: i % 2 === 0 })));
  assert.equal(await both((k) => k.call(lib("json printed"), k.call(lib("json read"), k.lit(text)))), JSON.stringify(text));
});

test("json read stops on text that isn't JSON", () => {
  const stops = (text: string, why: RegExp) => {
    const p = program((k) => k.call(lib("json read"), k.lit(text)));
    assert.throws(() => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), (e: unknown) => why.test(String((e as Error).message ?? e)));
  };
  // json spelled run backwards (L72f) has no reading for them; where it
  // stopped isn't in the message yet (L70c's route).
  for (const text of ["[1, 2", "{\"a\" 1}", "nul", "1 2", "\"open", "[1,]", "\"\\x\""]) stops(text, /json read: not JSON/);
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

test("csv of records writes records under a header, and csv records reads them back (L190h)", async () => {
  const text = 'name,age\nAda,36\n"Lovelace, A",\nBob,';
  const cols = (k: Lang) => k.listOf(k.lit("name"), k.lit("age"));
  assert.equal(await both((k) => k.call(lib("csv of records"), cols(k), k.call(lib("csv records"), k.lit('name,age\nAda,36\n"Lovelace, A",\nBob')))), JSON.stringify(text));
  assert.equal(await both((k) => k.call(lib("csv of records"), cols(k), k.x(NIL_ID))), JSON.stringify("name,age"));
});

test("json read joins a \\u surrogate pair into the one character it spells, as JSON.parse does (L190)", async () => {
  const text = JSON.stringify(["😀 a𝄞", "😀"]).replace("😀", "\\ud83d\\ude00").replace("𝄞", "\\uD834\\uDD1E");
  const shown = await both((k) => k.call(lib("json printed"), k.call(lib("json read"), k.lit(text))));
  assert.equal(JSON.parse(shown as string), JSON.stringify(JSON.parse(text)));
  const p = program((k) => k.call(lib("json read"), k.lit("\"\\ud83d x\"")));
  assert.throws(() => ran(p), (e: unknown) => /not JSON/.test(String((e as Error).message ?? e)));
});
