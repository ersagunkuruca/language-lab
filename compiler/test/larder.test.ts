// larder (compiler/gaps/larder), GAPS.md round 20's program: recipes
// scaled with exact fractions, each line read by running its printer
// backwards (inverse), amounts spelled by a ranked search, and the packs
// to buy found by a search. The evaluator, the core IR's module and the
// hand-written ideal must print the same and exit the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { folder, book, ways } from "../gaps/larder.ts";

const w = await ways();
// The core IR's module answers `inverse` with a Rational answer with
// nothing (GAPS.md round 20's L1, BACKLOG I325), so its count of portions
// the larder makes is 0: that one line is left out of its comparison until
// I325 is fixed, when `apart` goes.
const LARDER = "the larder alone makes: ";
const apart = (r: { out: string[] }) => ({ ...r, out: r.out.filter((l) => !l.startsWith(LARDER)) });
const all = (args: string[], files: Record<string, string>, slow = false) => {
  const want = w.ideal(args, files);
  if (!slow) assert.deepEqual(w.evaluator(args, files), want, "evaluator");
  assert.deepEqual(apart(w.core(args, files)), apart(want), "core");
  return want;
};
const sample = readFileSync(join(folder, "book.txt"), "utf8");

test("larder: the sample book", () => {
  const r = all(["b.txt"], { "b.txt": sample });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(0, 3), ["3 recipes, 6 units, 7 things in the larder, 10 packs for sale", "pancakes for 6 (serves 4)", "  2 1/4 cup flour"]);
  assert.ok(r.out.includes("buy milk, short 2 cup: 2 × 1 cup (nothing over, 2 ways)"));
  assert.ok(r.out.includes("buy baking-powder, short 1 1/4 tbsp: not sold"));
  assert.equal(r.out.at(-2), "the larder alone makes: pancakes for 3, scones for 6, omelette for 1");
});

test("larder: spelling amounts, and a pack that fits", () => {
  const b = "unit tsp\nunit tbsp 3 tsp\nunit cup 16 tbsp\nrecipe a 2\n1/3 cup x\n1/2 tsp y\nsell 1/3 cup x\nsell 1 tsp y\nmake a 3\n";
  assert.deepEqual(all(["b"], { b }).out.slice(1, 6), ["a for 3 (serves 2)", "  1/2 cup x", "  1/4 tbsp y", "needed: 1/2 cup x, 1/4 tbsp y", "buy x, short 1/2 cup: 2 × 1/3 cup (2 2/3 tbsp over, 1 way)"]);
  const odd = "unit tsp\nrecipe a 7\n1 tsp x\nmake a 1\n";
  assert.equal(all(["b"], { b: odd }).out[2], "  about 1/8 tsp x");
});

test("larder: what goes wrong, and the exit codes", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: larder book.txt"], code: 2 });
  assert.deepEqual(all(["nope"], {}), { out: [], err: ["larder: no such file or folder: nope"], code: 1 });
  const err = (text: string) => all(["b"], { b: text }).err;
  const base = "unit tsp\nunit tbsp 3 tsp\nrecipe a 2\n1 tsp x\n";
  assert.deepEqual(err(base), ["larder: the book makes nothing: add a make line"]);
  assert.deepEqual(err("unit tsp\n"), ["larder: the book has no recipes"]);
  assert.deepEqual(err("1 tsp x\n"), ["larder: line 1: a food line comes before any recipe"]);
  assert.deepEqual(err(base + "make b 2\n"), ["larder: line 5: b isn't a recipe"]);
  assert.deepEqual(err(base + "make a 0\n"), ["larder: line 5: make at least one portion"]);
  assert.deepEqual(err(base + "unit tsp\n"), ["larder: line 5: unit tsp again (first on line 1)"]);
  assert.deepEqual(err(base + "unit cup 2 pint\n"), ["larder: line 5: pint isn't a unit"]);
  assert.deepEqual(err("unit tsp\nunit a 2 b\nunit b 3 a\n"), ["larder: line 2: unit a is measured by itself"]);
  assert.deepEqual(err(base + "recipe a 3\n1 tsp y\n"), ["larder: line 5: recipe a again (first on line 3)"]);
  assert.deepEqual(err(base + "recipe b 3\nmake a 1\n"), ["larder: line 5: b has no foods"]);
  assert.deepEqual(err(base + "2 pint y\nmake a 1\n"), ["larder: line 5: pint isn't a unit"]);
  assert.deepEqual(err(base + "unit g\nhave 5 g x\nmake a 1\n"), ["larder: line 6: x is in g here but in tsp on line 4"]);
  assert.deepEqual(err(base + "0 tsp y\nmake a 1\n"), ["larder: line 5: an amount is a whole number or a fraction above 0"]);
  assert.deepEqual(err(base + "1 3/2 tsp y\nmake a 1\n"), ["larder: line 5: an amount is a whole number or a fraction above 0"]);
  assert.deepEqual(err(base + "recipe b x\n"), ["larder: line 5: serves x isn't a whole number"]);
  for (const bad of ["2 cup brown sugar\n", "have tsp x\n", "one tsp x\n", "1/x tsp y\n"]) assert.deepEqual(err(base + bad), ["larder: line 5: expected an amount, a unit and a food, as in 1 1/2 cup flour"]);
  assert.deepEqual(err(base + "unit cup 16\n"), ["larder: line 5: expected a unit, or a unit, an amount and another unit, as in tbsp 3 tsp"]);
  assert.deepEqual(err(base + "make a\n"), ["larder: line 5: expected unit, recipe, have, sell, make, or an amount, a unit and a food"]);
});

test("larder: a made-up book of 16 recipes, from the core IR", () => {
  const r = all(["b"], { b: book(16, 3) }, true);
  assert.equal(r.out[0], "16 recipes, 6 units, 12 things in the larder, 72 packs for sale");
});

