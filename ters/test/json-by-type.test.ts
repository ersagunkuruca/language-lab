// A program's own values to and from Json by their type (L190d2,
// json-by-type.ts): records as objects, cases by name, lists, Optional
// fields left out, an Int read back whole; the evaluator and compiled
// JavaScript agree, and a type with no spelling is refused.
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
import { BOOL, JSON_OPS, LIST, OPTIONAL, S, SHOW_ANY, NONE, TRUE, FALSE } from "../src/lang/std.ts";
import { INT, NUMBER, STRING } from "../src/lang/types.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

// A shape: a circle with a radius, or a box with a width and a height; a
// drawing with a name, its shapes, a count, a note that may be missing and
// a flag.
function types(k: Lang) {
  const shape = k.type("Shape", [], [
    ["circle", [["radius", () => k.tref(NUMBER)]]],
    ["box", [["width", () => k.tref(NUMBER)], ["height", () => k.tref(NUMBER)]]],
    ["dot", []],
  ]);
  const drawing = k.type("Drawing", [], [["drawing", [
    ["name", () => k.tref(STRING)], ["shapes", () => k.tref(LIST, k.tref(shape.def))], ["count", () => k.tref(INT)],
    ["note", () => k.tref(OPTIONAL, k.tref(STRING))], ["shown", () => k.tref(BOOL)],
  ]]]);
  return { shape, drawing };
}

function program(build: (k: Lang, t: ReturnType<typeof types>) => Id, pin?: (k: Lang, t: ReturnType<typeof types>) => void) {
  const k = new Lang(LIBRARY.code);
  const t = types(k);
  pin?.(k, t);
  const main = k.def("main");
  k.define(main, k.thunk(() => build(k, t)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  return { code, names, info, main };
}
async function both(p: ReturnType<typeof program>) {
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const v = runMain(p.code, p.info, p.main, { print: () => {}, names: p.names });
  const path = join(mkdtempSync(join(tmpdir(), "json-type-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, v);
  return v as string;
}
const drawingOf = (k: Lang, t: ReturnType<typeof types>, note: Id) => k.call(t.drawing.v.drawing, k.lit("plan"),
  k.listOf(k.call(t.shape.v.circle, k.lit(1.5)), k.call(t.shape.v.box, k.lit(2), k.lit(3)), k.x(t.shape.v.dot)), k.int(3), note, k.x(TRUE));

test("json of writes a record as an object, its cases by name, Optional as null or the value", async () => {
  const shown = await both(program((k, t) => k.call(lib("json printed"), k.call(JSON_OPS.of, drawingOf(k, t, k.x(NONE))))));
  assert.deepEqual(JSON.parse(shown), { name: "plan", shapes: [{ circle: { radius: 1.5 } }, { box: { width: 2, height: 3 } }, "dot"], count: 3, note: null, shown: true });
});

test("from json reads it back where the type is known, a missing Optional field as none, and no answer for another shape", async () => {
  const text = JSON.stringify({ shapes: ["dot", { box: { height: 1, width: 4 } }], name: "back", count: 7, shown: false, extra: [1] });
  let read = "";
  const p = program((k) => {
    const again = (t: string) => k.call(S.first, k.thunk(() => k.call(lib("json printed"), k.call(JSON_OPS.of, k.call(read, k.call(lib("json read"), k.lit(t)))))), k.thunk(() => k.lit("no answer")));
    return k.call(SHOW_ANY, k.listOf(again(text), again("{\"name\": 1}"), again(text.replace("7", "7.5"))));
  }, (k, t) => {
    // A definition whose result is known to be a Drawing: it matches one.
    read = k.def("read drawing");
    k.define(read, k.fn(["json"], (j) => k.let("d", k.call(JSON_OPS.from, j), (d) => k.match(d, [{ variant: t.drawing.v.drawing, names: ["name", "shapes", "count", "note", "shown"], body: () => d }]))));
  });
  const out = JSON.parse(await both(p)) as string[];
  assert.deepEqual(JSON.parse(out[0]), { name: "back", shapes: ["dot", { box: { width: 4, height: 1 } }], count: 7, note: null, shown: false });
  assert.deepEqual(out.slice(1), ["no answer", "no answer"]);
});

test("a value whose type isn't known, or a function, has no Json spelling", () => {
  const p = program((k) => k.call(lib("json printed"), k.call(JSON_OPS.of, k.fn(["x"], (x) => x))));
  assert.match(p.info.errors.map((e) => e.message).join("\n"), /json of writes the value by its type, and .* is a function/);
  const q = program((k) => k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(JSON_OPS.from, k.call(lib("json read"), k.lit("1")))), k.thunk(() => k.int(0)))));
  assert.deepEqual(q.info.errors.map((e) => e.message), []);
});

test("a recursive type and a tuple go both ways: what json of writes, from json reads back the same", async () => {
  let back = "";
  const p = program((k) => k.call(lib("json printed"), k.call(JSON_OPS.of, k.call(S.first, k.thunk(() => k.call(back, k.call(JSON_OPS.of, k.x(k.code.defs.find((d) => k.names[d] === "a tree")!)))), k.thunk(() => k.x(k.code.defs.find((d) => k.names[d] === "a tree")!))))), (k) => {
    const tree = k.type("Tree", [], [["leaf", []], ["node", [["left", (self) => k.tref(self)], ["item", () => k.tref("std.tuple2", k.tref(INT), k.tref(STRING))], ["right", (self) => k.tref(self)]]]]);
    const leaf = () => k.x(tree.v.leaf);
    const item = (n: number, t: string) => k.call("std.tuple2.tuple", k.int(n), k.lit(t));
    const a = k.def("a tree");
    k.define(a, k.call(tree.v.node, k.call(tree.v.node, leaf(), item(1, "a"), leaf()), item(2, "b"), leaf()));
    back = k.def("tree back");
    k.define(back, k.fn(["json"], (j) => k.let("t", k.call(JSON_OPS.from, j), (t) => k.match(t, [{ variant: tree.v.leaf, names: [], body: () => t }], t))));
  });
  const shown = await both(p);
  assert.deepEqual(JSON.parse(shown), { node: { left: { node: { left: "leaf", item: [1, "a"], right: "leaf" } }, item: [2, "b"], right: "leaf" } });
});

test("a Map with Text keys is an object, one with other keys a list of [key, value], a Set a list, Bytes Base64", async () => {
  let back = "";
  const p = program((k) => {
    const value = k.call("std.tuple4.tuple",
      k.call(lib("as map"), k.listOf(k.call("std.tuple2.tuple", k.lit("b"), k.int(2)), k.call("std.tuple2.tuple", k.lit("a"), k.int(1)))),
      k.call(lib("as map"), k.listOf(k.call("std.tuple2.tuple", k.int(3), k.x(TRUE)))),
      k.call(lib("as set"), k.listOf(k.lit("y"), k.lit("x"))),
      k.call(lib("utf8 of"), k.lit("hi!")));
    const json = k.call(JSON_OPS.of, value);
    return k.call(SHOW_ANY, k.listOf(k.call(lib("json printed"), json), k.call(S.first, k.thunk(() => k.call(lib("json printed"), k.call(JSON_OPS.of, k.call(back, json)))), k.thunk(() => k.lit("no answer")))));
  }, (k) => {
    back = k.def("back");
    // Using the tuple's parts as a Map, a Map, a Set and Bytes gives from json its type.
    const typed = k.def("typed");
    k.define(typed, k.fn(["x"], (x) => k.match(x, [{ variant: "std.tuple4.tuple", names: ["a", "b", "c", "d"], body: ([a, b, c, d]) => k.call("std.tuple4.tuple", k.call(lib("put"), a, k.lit("z"), k.int(0)), k.call(lib("put"), b, k.int(0), k.x(FALSE)), k.call(lib("add item"), c, k.lit("w")), k.call(lib("utf8 of"), k.call(lib("text of utf8"), d))) }])));
    k.define(back, k.fn(["json"], (js) => k.let("v", k.call(JSON_OPS.from, js), (v) => k.let("same", k.call(typed, v), () => v))));
  });
  const out = JSON.parse(await both(p)) as string[];
  assert.deepEqual(JSON.parse(out[0]), [{ a: 1, b: 2 }, [[3, true]], ["x", "y"], "aGkh"]);
  assert.deepEqual(JSON.parse(out[1]), JSON.parse(out[0]));
});
