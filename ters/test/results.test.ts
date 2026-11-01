// Several named results (BACKLOG L95, RESULTS.md): a predicate whose
// result ports are named reads as a function with several results. A use
// is the solve node, read as `a, b = f(x, y)`; the declared direction is
// checked at the definition.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Code, NodeOf } from "../src/model.ts";
import type { Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { runMain } from "../src/lang/run.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

// sum and difference(s, d, a, b): s = a + b and d = a − b, with results
// given as names; main uses it in the declared direction.
function program(results: string[], use = true) {
  const k = new Lang();
  const sd = k.def("sum and difference");
  k.define(sd, k.fn(["s", "d", "a", "b"], (s, d, a, b) => k.and(k.equal(s, k.call(B.add, a, b)), k.equal(d, k.call(B.sub, a, b)))));
  k.results(sd, ...results);
  const main = use ? k.def("main") : "";
  if (use) k.define(main, k.thunk(() => k.use(sd, [k.lit(5), k.lit(1)], ["half sum", "half difference"], (a, b) => k.text(k.call(SHOW_ANY, a), k.lit(" "), k.call(SHOW_ANY, b)))));
  const code: Code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const pres: Presentation = { names, comments: {}, hints: {}, style: blocksStyle as unknown as Style };
  return { k, code, names, info, sd, main, text: (d: string) => renderBlocks(code, pres, info, d) };
}

test("a definition with results reads as inputs → results, and a use binds them side by side", () => {
  const p = program(["a", "b"]);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.match(p.text(p.sd), /‹sum and difference›\(s, d\) → a, b = s = a \+ b and d = a − b/);
  assert.match(p.text(p.main), /‹half sum›, ‹half difference› = ‹sum and difference›\(5, 1\)/);
  // Still the predicate it was: its type is over all four ports.
  assert.equal(showType(p.info.typeOf.get(p.sd)!, p.names), "(Float64, Float64, Float64, Float64) -> Bool");
});

test("the use runs: one solution for both results, pure when the direction has one answer", () => {
  const p = program(["a", "b"]);
  const out: string[] = [];
  const v = runMain(p.code, p.info, p.main, { print: (s) => out.push(s), names: p.names });
  assert.equal(v, "3 2");
  assert.equal(showType(p.info.typeOf.get(p.main)!, p.names), "() -> Text");
});

test("results the other ports don't pin down are an error at the definition", () => {
  const p = program(["s", "a", "b"], false);
  const errs = p.info.errors.filter((e) => e.id === p.sd).map((e) => e.message);
  assert.equal(errs.length, 1, String(errs));
  assert.match(errs[0], /sum and difference's results can't all be found from d: it needs 1 more known port$/);
});

test("results are its own ports, each once, and it is a predicate", () => {
  const k = new Lang();
  const twice = k.def("twice");
  k.define(twice, k.fn(["x"], (x) => k.call(B.add, x, x)));
  (k.code.nodes[twice] as NodeOf<"def">).results = (k.code.nodes[(k.code.nodes[twice] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const info = infer(base(k.code), baseNames(k.names));
  assert.ok(info.errors.some((e) => /twice has results, so it is a predicate over its ports/.test(e.message)), String(info.errors.map((e) => e.message)));
  const p = program(["a", "a"], false);
  assert.ok(p.info.errors.some((e) => /results are some of its own ports, each once: a isn't/.test(e.message)));
});

test("the signature reads as the declared direction, with its effects", () => {
  const p = program(["a", "b"]);
  assert.match(p.text(p.sd), /^‹sum and difference› : \(Float64, Float64\) -> a: Float64, b: Float64\n/);
});

test("results each given by an expression of the inputs read as = e1, e2", () => {
  const k = new Lang();
  const hd = k.def("half and double");
  k.define(hd, k.fn(["x", "h", "d"], (x, h, d) => k.and(k.equal(h, k.call(B.div, x, k.lit(2))), k.equal(d, k.call(B.mul, x, k.lit(2))))));
  k.results(hd, "h", "d");
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const pres: Presentation = { names, comments: {}, hints: {}, style: blocksStyle as unknown as Style };
  const text = renderBlocks(code, pres, info, hd);
  assert.match(text, /‹half and double›\(x\) → h, d = x \/ 2, x · 2$/m, text);
});

test("another direction names what it's given, and binds the ports left, in order", () => {
  const p = program(["a", "b"], false);
  const sd = p.k.code.nodes[p.sd] as NodeOf<"def">;
  const [s, d, a, b] = (p.k.code.nodes[sd.body!] as NodeOf<"lambda">).params;
  const main = p.k.def("other way");
  p.k.define(main, p.k.thunk(() => p.k.solve(p.sd, { [s]: p.k.lit(10), [a]: p.k.lit(3), out: p.k.true }, { [b]: "b", [d]: "d" }, ({ [b]: bv, [d]: dv }) => p.k.text(p.k.call(SHOW_ANY, dv), p.k.lit(" "), p.k.call(SHOW_ANY, bv)))));
  const code = base(p.k.code), names = baseNames(p.k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const pres: Presentation = { names, comments: {}, hints: {}, style: blocksStyle as unknown as Style };
  assert.match(renderBlocks(code, pres, info, main), /d, b = ‹sum and difference›\(s = 10, a = 3\)/);
  assert.equal(runMain(code, info, main, { print: () => {}, names }), "-4 7");
});

// The palette writes a use (I65): where a value goes, `a, b = sum and
// difference(□, □)` is offered, and filling it gives a use whose results
// are named after them, inputs and body still to fill.
test("the palette offers a use of a definition with results, and fills it in", async () => {
  const { fillings } = await import("../src/lang/infer.ts");
  const { fillHole } = await import("../src/lang/refactor.ts");
  const k = new Lang();
  const sd = k.def("sum and difference");
  k.define(sd, k.fn(["s", "d", "a", "b"], (s, d, a, b) => k.and(k.equal(s, k.call(B.add, a, b)), k.equal(d, k.call(B.sub, a, b)))));
  k.results(sd, "a", "b");
  const main = k.def("main");
  const hole = k.hole();
  k.define(main, k.thunk(() => hole));
  const code: Code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const use = fillings(code, info, hole).find((f) => f.kind === "use" && f.target === sd);
  assert.ok(use, "no use of sum and difference offered");
  const e = fillHole(code, names, hole, use);
  const filled = infer(e.code, e.names);
  assert.deepEqual(filled.errors.map((x) => x.message), []);
  const pres: Presentation = { names: e.names, comments: {}, hints: {}, style: blocksStyle as unknown as Style };
  assert.match(renderBlocks(e.code, pres, filled, main), /a, b = ‹sum and difference›\(□, □\)/);
});
