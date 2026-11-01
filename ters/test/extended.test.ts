// Extended a (FLOAT-VALUES-2026-11-01.md §3, BACKLOG L125d): ±∞ around any
// ordered number type, as ordinary data in the library.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { EXTENDED_V as X, SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function answers(build: (k: Lang) => [string, Id][]) {
  const k = new Lang(LIBRARY.code);
  const defs = build(k).map(([name, body]) => { const d = k.def(name); k.define(d, k.thunk(() => k.call(SHOW_ANY, body))); return [name, d] as const; });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  return Object.fromEntries(defs.map(([name, d]) => [name, [...(r.call(r.value(d)) as Iterable<Value>)]]));
}

test("Extended: the extended reals' + − ·, no answer for ∞ − ∞ and 0 · ∞, and a total order", () => {
  const plus = (k: Lang) => k.x(X.plus), minus = (k: Lang) => k.x(X.minus), fin = (k: Lang, x: number) => k.call(X.finite, k.at(NUMBER, x));
  const got = answers((k) => [
    ["∞ + 1", k.call(lib("extended add"), plus(k), fin(k, 1))],
    ["−∞ + −∞", k.call(lib("extended add"), minus(k), minus(k))],
    ["∞ + −∞", k.call(lib("extended add"), plus(k), minus(k))],
    ["∞ − ∞", k.call(lib("extended subtract"), plus(k), plus(k))],
    ["2 − 5", k.call(lib("extended subtract"), fin(k, 2), fin(k, 5))],
    ["−2 · ∞", k.call(lib("extended multiply"), fin(k, -2), plus(k))],
    ["−∞ · −∞", k.call(lib("extended multiply"), minus(k), minus(k))],
    ["0 · ∞", k.call(lib("extended multiply"), fin(k, 0), plus(k))],
    ["−(+∞)", k.call(lib("extended negate"), plus(k))],
    ["−∞ < 3", k.call(lib("extended less"), minus(k), fin(k, 3))],
    ["3 < ∞", k.call(lib("extended less"), fin(k, 3), plus(k))],
    ["∞ < ∞", k.call(lib("extended less"), plus(k), plus(k))],
    ["sorted", k.call(lib("sort"), k.list(plus(k), fin(k, 2), minus(k), fin(k, -7)))],
  ]);
  assert.deepEqual(got, {
    "∞ + 1": ["plus infinity"], "−∞ + −∞": ["minus infinity"], "∞ + −∞": [], "∞ − ∞": [],
    "2 − 5": ["finite(-3)"], "−2 · ∞": ["minus infinity"], "−∞ · −∞": ["plus infinity"], "0 · ∞": [],
    "−(+∞)": ["minus infinity"], "−∞ < 3": ["true"], "3 < ∞": ["true"], "∞ < ∞": ["false"],
    sorted: ["[minus infinity, finite(-7), finite(2), plus infinity]"],
  });
});

test("minimum and maximum: +∞ and −∞ for no numbers, at any ordered number type", () => {
  const got = answers((k) => [
    ["least", k.call(lib("minimum"), k.list(k.at(NUMBER, 3), k.at(NUMBER, -1.5), k.at(NUMBER, 2)))],
    ["least of none", k.call(lib("minimum"), k.list())],
    ["most of ints", k.call(lib("maximum"), k.list(k.int(4), k.int(9), k.int(-2)))],
    ["most of none", k.call(lib("maximum"), k.list())],
    ["smaller than any", k.call(lib("extended less"), k.call(lib("minimum"), k.list(k.at(NUMBER, 1e300))), k.call(lib("minimum"), k.list()))],
  ]);
  assert.deepEqual(got, {
    least: ["finite(-1.5)"], "least of none": ["plus infinity"], "most of ints": ["finite(9)"], "most of none": ["minus infinity"],
    "smaller than any": ["true"],
  });
});

// The editor's half (L125d): ±∞ typed into a port and read in the Run panel.
test("an Extended reads as its number or ±∞, and ±∞ can be typed", async () => {
  const { std: s, stdNames: n } = await import("../src/lang/std.ts");
  const { parseValue } = await import("../src/lang/values.ts");
  const { showValue: show } = await import("../src/lang/run.ts");
  const v = parseValue("[−∞, finite(2.5), +∞, ∞, -∞]", s, n);
  assert.ok("value" in v);
  assert.equal(show(v.value, s, n, true), "[−∞, 2.5, +∞, +∞, −∞]");
  assert.equal(show(v.value, s, n), "[minus infinity, finite(2.5), plus infinity, plus infinity, minus infinity]");
});
