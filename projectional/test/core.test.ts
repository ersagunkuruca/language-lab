import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Builder } from "../src/builder.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { hashDef } from "../src/hash.ts";
import { loadCode, loadPresentation, root } from "../src/io.ts";
import { get, merge, replace, type Code, type Id } from "../src/model.ts";
import { rename, type Presentation } from "../src/presentation.ts";
import { B, prelude, preludeNames } from "../src/prelude.ts";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";
import mathStyle from "../styles/math.json" with { type: "json" };
import plainStyle from "../styles/plain.json" with { type: "json" };

const pres = (names: Record<Id, string>, style: unknown, comments = {}): Presentation =>
  ({ names: { ...preludeNames, ...names }, comments, hints: {}, style: style as Presentation["style"] });

// A definition as a plain JS function: its first result. There is one
// evaluator (src/lang/run.ts); this is just a way to call it.
const evaluate = (code: Code, def: Id) => {
  const r = makeRunner(code, infer(code), { print: () => {} });
  return (...args: number[]) => { for (const v of r.call(r.value(def), ...args)) return v; throw new Error("no result"); };
};

const discriminant = (names: string[]) => {
  const k = new Builder(prelude);
  const d = k.def("Δ");
  k.define(d, k.lambda(names, (a, b, c) => k.call(B.sub, k.call(B.mul, b, b), k.call(B.mul, k.call(B.mul, k.lit(4), a), c))));
  return { code: merge(prelude, k.code), names: k.names, def: d };
};

test("the compose example renders both ways from the same tree", () => {
  const dir = join(root, "examples/compose");
  const code = loadCode(dir);
  const a = code.defs.at(-1)!;
  assert.equal(renderNested(code, loadPresentation(dir, { names: ["default"], style: "math" }), a),
    "a = ((d) => b(c(d, e(f, d))))(g(h))");
  assert.equal(renderLet(code, loadPresentation(dir, { names: ["default"], style: "plain" }), a),
    ["d = g(h)", "t1 = e(f, d)", "t2 = c(d, t1)", "a = b(t2)"].join("\n"));
});

test("renaming changes the rendering and nothing else", () => {
  const { code, names, def } = discriminant(["a", "b", "c"]);
  const before = structuredClone(code);
  const b = get(code, get(code, def, "def").body!, "lambda").params[1];
  const renamed = rename(names, b, "linear coefficient");
  assert.match(renderNested(code, pres(renamed, mathStyle), def), /linear coefficient · linear coefficient/);
  assert.deepEqual(code, before);
  assert.equal(hashDef(code, def), hashDef(before, def));
  assert.equal(evaluate(code, def)(1, -3, 2), 1);
});

test("independently written, differently named copies hash the same", () => {
  const x = discriminant(["a", "b", "c"]);
  const y = discriminant(["leading", "linear", "constant"]);
  assert.notEqual(x.def, y.def);
  assert.equal(hashDef(x.code, x.def), hashDef(y.code, y.def));
});

test("a real change changes the hash", () => {
  const { code, def } = discriminant(["a", "b", "c"]);
  const four = Object.values(code.nodes).find((n) => n.kind === "lit" && n.value === 4)!;
  const edited = replace(code, four.id, () => ({ kind: "lit", value: 5 }));
  assert.notEqual(hashDef(code, def), hashDef(edited, def));
});

test("same display name on different binders is disambiguated, not captured", () => {
  const { code, names, def } = discriminant(["k", "k", "k"]);
  assert.equal(renderNested(code, pres(names, mathStyle), def), "Δ = (k₁, k₂, k₃) => k₂ · k₂ − 4 · k₁ · k₃");
  assert.equal(evaluate(code, def)(1, -3, 2), 1);
});

test("parentheses come from precedence at render time", () => {
  const k = new Builder(prelude);
  const f = k.def("f");
  k.define(f, k.lambda(["a", "b", "c"], (a, b, c) =>
    k.call(B.mul, k.call(B.sub, k.call(B.sub, a, b), k.call(B.sub, b, c)), k.call(B.add, a, k.call(B.add, b, c)))));
  const code = merge(prelude, k.code);
  assert.equal(renderNested(code, pres(k.names, mathStyle), f), "f = (a, b, c) => (a − b − (b − c)) · (a + b + c)");
});

test("comments and step names are keyed by node, so they survive an edit", () => {
  const dir = join(root, "examples/quadratic");
  const code = loadCode(dir);
  const p = loadPresentation(dir, { names: ["short", "descriptive"], style: "plain" });
  const x = code.defs[1];
  const two = Object.values(code.nodes).find((n) => n.kind === "lit" && n.value === 2)!;
  const edited = replace(code, two.id, () => ({ kind: "lit", value: 3 }));
  const out = renderLet(edited, p, x);
  assert.match(out, /denominator = 3 \* ‹leading coefficient›/);
  assert.match(out, /sqrt\(t2\)   -- NaN when discriminant is negative/);
});

test("comment references follow renames", () => {
  const { code, names, def } = discriminant(["a", "b", "c"]);
  const b = get(code, get(code, def, "def").body!, "lambda").params[1];
  const comments = { [def]: `uses {${b}} twice` };
  assert.match(renderLet(code, pres(rename(names, b, "slope"), plainStyle, comments), def), /^-- uses slope twice/);
});
