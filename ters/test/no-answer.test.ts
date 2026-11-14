// Division and its kin have no answer at bad inputs (FLOAT-VALUES-2026-11-01.md
// §2, BACKLOG L125b): x / 0, the square root of a negative, the log of 0 or
// less give no answer, a Choice, which is dropped where the inputs are
// shown fine; a page's view with no answer shows nothing there.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { merge } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { HTML_MODULE, LIBRARY } from "../src/lang/library.ts";
import { equal, makeRunner, runMain, type Value } from "../src/lang/run.ts";
import { CELL_OPS as C, HTML_V, INT_OPS, S } from "../src/lang/std.ts";
import { showType, NUMBER } from "../src/lang/types.ts";
import { Cells } from "../src/lang/cells.ts";
import { evaluatorCall, mountHtml } from "../src/lang/html.ts";
import { B } from "../src/prelude.ts";
import { fakeDoc, FakeEl } from "./fakedom.ts";

const f = (k: Lang, x: number) => k.at(NUMBER, x);

function program(build: (k: Lang) => [string, Id][]) {
  const k = new Lang();
  const defs = build(k).map(([name, body]) => { const d = k.def(name); k.define(d, body); return [name, d] as const; });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, d: Object.fromEntries(defs), type: (name: string) => showType(info.typeOf.get(Object.fromEntries(defs)[name])!, names) };
}

test("x / y, sqrt and log may have no answer, unless the inputs are shown fine", () => {
  const p = program((k) => [
    ["inverse", k.fn(["x"], (x) => k.call(B.div, f(k, 1), x))],
    ["half", k.fn(["x"], (x) => k.call(B.div, x, f(k, 2)))],
    ["safe inverse", k.fn(["x"], (x) => k.if(k.call(S.less, f(k, 0), x), k.call(B.div, f(k, 1), x), f(k, 0)))],
    ["root", k.fn(["x"], (x) => k.call(B.sqrt, x))],
    ["root of a square", k.fn(["x"], (x) => k.call(B.sqrt, k.call(B.mul, x, x)))],
  ]);
  assert.equal(p.type("inverse"), "(Float64) -[Choice]-> Float64");
  assert.equal(p.type("half"), "(Float64) -> Float64");
  assert.equal(p.type("safe inverse"), "(Float64) -> Float64");
  assert.equal(p.type("root"), "(Float64) -[Choice]-> Float64");
  assert.equal(p.type("root of a square"), "(Float64) -> Float64");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const answers = (name: string, x: number) => [...(r.call(r.value(p.d[name]), x) as Iterable<Value>)];
  assert.deepEqual(answers("inverse", 4), [0.25]);
  assert.deepEqual(answers("inverse", 0), []);
  assert.deepEqual(answers("root", -1), []);
  assert.deepEqual(answers("safe inverse", 0), [0]);
});

// FizzBuzz's remainder(n, 3) has no Choice: 3 isn't 0 (I234).
test("Int's quotient, remainder and power by a divisor or exponent shown fine have no Choice (I234)", () => {
  const p = program((k) => [
    ["by three", k.fn(["n"], (n) => k.call(INT_OPS.remainder, n, k.int(3)))],
    ["by any", k.fn(["n", "d"], (n, d) => k.call(INT_OPS.remainder, n, d))],
    ["halved", k.fn(["n"], (n) => k.call(INT_OPS.quotient, n, k.int(2)))],
    ["safe", k.fn(["n", "d"], (n, d) => k.if(k.call(S.equal, d, k.int(0)), k.int(0), k.call(INT_OPS.quotient, n, d)))],
    ["squared", k.fn(["n"], (n) => k.call(INT_OPS.power, n, k.int(2)))],
    ["by zero", k.fn(["n"], (n) => k.call(INT_OPS.remainder, n, k.int(0)))],
  ]);
  assert.equal(p.type("by three"), "(Int) -> Int");
  assert.equal(p.type("by any"), "(Int, Int) -[Choice]-> Int");
  assert.equal(p.type("halved"), "(Int) -> Int");
  assert.equal(p.type("safe"), "(Int, Int) -> Int");
  assert.equal(p.type("squared"), "(Int) -> Int");
  assert.equal(p.type("by zero"), "(Int) -[Choice]-> Int");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  assert.deepEqual([...(r.call(r.value(p.d["by three"]), 10) as Iterable<Value>)], [1]);
});

test("a page's view with no answer shows nothing there, and its answer when it has one again", () => {
  const lib = (name: string) => HTML_MODULE.exports.find((d) => HTML_MODULE.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("d", k.call(C.cell, f(k, 2)), (d) => {
    const tenth = () => k.thunk(() => k.call(S.show, k.call(B.div, f(k, 10), k.call(C.read, d))));
    return k.call(lib("div"), k.list(
      k.call(HTML_V.text, tenth()),
      k.call(lib("button"), k.lit("zero"), k.fn(["e"], () => k.call(C.write, d, f(k, 0)))),
      k.call(lib("button"), k.lit("four"), k.fn(["e"], () => k.call(C.write, d, f(k, 4)))),
    ));
  })));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const cells = new Cells(equal);
  const root = mountHtml(runMain(code, info, main, { print: () => {}, names, cells }), { cells, doc: fakeDoc(), call: evaluatorCall }) as FakeEl;
  const shown = () => root.kids.filter((c) => !(c instanceof FakeEl && c.tag === "button")).map((c) => c.textContent).join("");
  const click = (label: string) => (root.kids.find((e) => e instanceof FakeEl && e.tag === "button" && e.textContent === label) as FakeEl).fire("click");
  assert.equal(shown(), "5");
  click("zero");
  assert.equal(shown(), "");
  click("four");
  assert.equal(shown(), "2.5");
});

// A division guarded as a person writes it (L258, Ersagun 2026-11-14: Float64
// stays finite, so the checker reads the guard): `>` is a definition of the
// library's (`more than`, read through its body), and the divisor may be a
// field read (`l.took`), the same value as the one tested.
test("a division guarded by `if d > 0` or `if l.took > 0 s` has no Choice (L258)", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { Session } = await import("../mcp/session.ts");
  const dir = mkdtempSync(join(tmpdir(), "no-answer-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  s.define("Leg", "type", [], "leg(length: Float64 m, took: Float64 s)");
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); return s.typeOf(s.resolve(name)); };
  assert.equal(fill("over", ["x", "d"], "if d > 0.0 then x / d else 0.0"), "(Float64, Float64) -> Float64");
  assert.equal(fill("not under", ["x", "d"], "if d ≤ 0.0 then 0.0 else x / d"), "(Float64, Float64) -> Float64");
  assert.equal(fill("speed", ["l"], "if l.took > 0.0 s then l.length / l.took else 0.0 m/s"), "(Leg) -> Float64 m/s");
  // Tested on one field, divided by another: still a Choice.
  assert.equal(fill("wrong", ["l"], "if l.length > 0.0 m then l.length / l.took else 0.0 m/s"), "(Leg) -[Choice]-> Float64 m/s");
  // `and` works out both sides (run.ts), so its guard guards nothing.
  assert.equal(fill("both", ["l"], "l.took > 0.0 s and l.length / l.took > 1.0 m/s"), "(Leg) -[Choice]-> Bool");
  assert.equal(s.errors(), "ok");
  assert.equal(s.eval("over(1.0, 0.0)"), "= 0 : Float64");
});
