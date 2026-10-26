// Private constructors (BACKLOG L79, REVIEW-2026-10-26.md §2): `set of`,
// `map of` and `ratio` build a value without its type's rule (sorted with
// no item twice, lowest terms with a bottom that isn't 0), so only the
// library that keeps the rule may call them. A program is refused with
// what to use instead, the palette doesn't offer them, and taking a value
// apart with a match stays open.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner } from "../src/lang/run.ts";
import { MAP_V, PAIR_V, RATIO, SET_V, SHOW_ANY } from "../src/lang/std.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function check(build: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const d = k.def("mine");
  k.define(d, build(k));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, d, info: infer(code, names, undefined, checkOptions) };
}

test("the library itself checks with its private constructors", () => {
  const code = base({ nodes: {}, defs: [] });
  assert.deepEqual(infer(code, LIBRARY.names, undefined, checkOptions).errors.map((e) => e.message), []);
});

test("a program calling set of, map of or ratio is refused, with what to use instead", () => {
  const cases: [string, (k: Lang) => Id, RegExp][] = [
    ["set of", (k) => k.call(SET_V, k.list(k.lit(3), k.lit(1), k.lit(3))), /set of is private to the library, which keeps Set's rule: .*as set/],
    ["map of", (k) => k.call(MAP_V, k.list(k.call(PAIR_V, k.lit(1), k.lit("a")))), /map of is private .*Map's rule: .*as map/],
    ["ratio", (k) => k.call(RATIO, k.int(2), k.int(4)), /ratio is private .*Rational's rule: .*fraction/],
    ["ratio as a value", (k) => k.x(RATIO), /ratio is private/],
  ];
  for (const [what, build, message] of cases) {
    const p = check(build);
    assert.equal(p.info.errors.length, 1, what);
    assert.match(p.info.errors[0].message, message, what);
  }
});

test("taking a set apart with a match is open to programs", () => {
  const p = check((k) => k.match(k.call(lib("as set"), k.list(k.lit(3), k.lit(1), k.lit(3))), [{ variant: SET_V, names: ["items"], body: ([xs]) => k.call(SHOW_ANY, xs) }]));
  assert.deepEqual(p.info.errors, []);
  assert.equal(makeRunner(p.code, p.info, { print: () => {}, names: p.names }).value(p.d), "[1, 3]");
});

test("the palette doesn't offer a private constructor to a program", () => {
  const k = new Lang(LIBRARY.code);
  const d = k.def("a set");
  const hole = k.hole();
  k.define(d, k.call(lib("set size"), hole));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.ok(info.holes.has(hole));
  const offered = fillings(code, info, hole).flatMap((f) => ("target" in f ? [f.target] : []));
  assert.ok(offered.includes(lib("as set")), "as set is offered");
  assert.ok(!offered.includes(SET_V), "set of isn't");
  // Without the library's options nothing is private, as with no pins.
  assert.ok(fillings(code, infer(code, names), hole).some((f) => "target" in f && f.target === SET_V));
});
