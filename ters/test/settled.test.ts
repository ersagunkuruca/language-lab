// settled and settled by (L239, FIXPOINT.md): a fixed point of a step that
// shrinks, reached in rounds counted before they run (Banach's bound), so
// the type is Choice and never Diverge. PageRank on ten pages, x = cos x,
// and two steps with no answer: one that grows, and a chain that flips
// between two states forever. Evaluated and compiled give the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledDefs } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

test("settled's and settled by's types are Choice, not Diverge", () => {
  const info = infer(base({ nodes: {}, defs: [] }), baseNames({}), undefined, checkOptions);
  const t = (n: string) => showType(info.subst.zonk(info.typeOf.get(L(n))!), baseNames({}));
  assert.equal(t("settled"), "(List Float64, (List Float64) -[Choice, e]-> List Float64, Float64) -[Choice, e]-> List Float64");
  assert.equal(t("settled by"), "(List Float64, (List Float64) -[Choice, e]-> List Float64, Float64, Float64) -[Choice, e]-> List Float64");
});

// Ten pages; each links to the pages listed.
const LINKS = [[1, 2], [2], [0, 3], [4], [5, 0], [6], [7, 8], [8], [9, 0], [0]];

function program() {
  const k = new Lang(LIBRARY.code);
  const n = { add: (a: Id, b: Id) => k.call(B.add, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b) };
  // One step of the surfer: 0.15 / 10 + 0.85 · the rank flowing in.
  const rankStep = k.def("rank step");
  k.define(rankStep, k.fn(["ranks"], (r) => {
    const at = (q: number) => k.call(L("item at"), r, k.int(q), k.lit(0));
    return k.list(...LINKS.map((_, p) => {
      const ins = LINKS.flatMap((out, q) => (out.includes(p) ? [n.mul(at(q), k.lit(1 / out.length))] : []));
      return n.add(k.lit(0.015), n.mul(k.lit(0.85), ins.reduce((a, b) => n.add(a, b))));
    }));
  }));
  const evenly = () => k.list(...LINKS.map(() => k.lit(0.1)));
  const shown = (v: Id) => k.call(L("show numbers"), k.call(L("map"), v, k.fn(["x"], (x) => n.mul(k.call(S.floor, n.add(n.mul(x, k.lit(1e6)), k.lit(0.5))), k.lit(1e-6)))));
  const orNone = (v: () => Id) => k.call(S.first, k.thunk(() => shown(v())), k.thunk(() => k.lit("no answer")));
  const main = k.def("main");
  const lines = [
    orNone(() => k.call(L("settled"), evenly(), k.x(rankStep), k.lit(1e-9))),
    orNone(() => k.call(L("settled by"), evenly(), k.x(rankStep), k.lit(0.85), k.lit(1e-9))),
    orNone(() => k.call(L("settled"), k.list(k.lit(1)), k.fn(["x"], (x) => k.call(L("map"), x, k.fn(["v"], (v) => k.call(B.cos, v)))), k.lit(1e-9))),
    orNone(() => k.call(L("settled"), k.list(k.lit(1)), k.fn(["x"], (x) => k.call(L("map"), x, k.fn(["v"], (v) => n.add(n.mul(k.lit(2), v), k.lit(1))))), k.lit(1e-9))),
    orNone(() => k.call(L("settled"), k.list(k.lit(1), k.lit(0)), k.fn(["x"], (x) => k.call(L("reverse"), x)), k.lit(1e-9))),
  ];
  k.define(main, k.thunk(() => k.seq(...lines.map((v) => k.call(S.print, v)))));
  return { code: base(k.code), names: baseNames(k.names), main };
}

// The ranks by power iteration in plain JS, to 1e-12.
function ranks(): number[] {
  let r = LINKS.map(() => 0.1);
  for (let i = 0; i < 1000; i++) r = LINKS.map((_, p) => 0.015 + 0.85 * LINKS.reduce((s, out, q) => s + (out.includes(p) ? r[q] / out.length : 0), 0));
  return r;
}

test("PageRank, x = cos x, and steps with no fixed point", () => {
  const { code, names, main } = program();
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const compiled: string[] = [];
  compiledDefs(code, info, names, ["main"], { print: (s: string) => compiled.push(s) })["main"]();
  const want = ranks().map((x) => Math.floor(x * 1e6 + 0.5) * 1e-6);
  const read = (line: string) => line.split(" ").map(Number);
  for (const line of ran.slice(0, 2)) read(line).forEach((x, i) => assert.ok(Math.abs(x - want[i]) < 2e-6, `${line} vs ${want}`));
  assert.ok(Math.abs(read(ran[2])[0] - 0.739085) < 2e-6, ran[2]);
  assert.deepEqual(ran.slice(3), ["no answer", "no answer"]);
  assert.deepEqual(compiled, ran);
});
