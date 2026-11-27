// larder (compiler/gaps/larder), GAPS.md round 25's program: recipes
// scaled with exact fractions, each line read by running its printer
// backwards (inverse), amounts spelled by a ranked search, and the packs
// to buy found by a search. The evaluator, the core IR's module and the
// hand-written ideal must print the same and exit the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { WASI } from "node:wasi";
import { join } from "node:path";
import { folder, book, ways } from "../gaps/larder.ts";
import { skip } from "./c-harness.ts";
import { wasiImports } from "../src/wasi-imports.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>, slow = false) => {
  const want = w.ideal(args, files);
  if (!slow) assert.deepEqual(w.evaluator(args, files), want, "evaluator");
  assert.deepEqual(w.core(args, files), want, "core");
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


// ters native and ters wasi (I374): each line's printer run backwards is
// written out, not left to the relational interpreter, and prints what the
// ideal prints, on the sample book, a made-up one, and lines that fail.
test("larder: native and WebAssembly print what the ideal prints", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "larder-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, ["--no-warnings", ters, ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  run("native", folder, "-o", join(dir, "larder"));
  run("wasi", folder, "-o", join(dir, "larder.wasm"));
  const wasm = new WebAssembly.Module(readFileSync(join(dir, "larder.wasm")));
  const bad = "unit tsp\nunit tbsp 3 tsp\nrecipe a 2\n1 tsp x\n1 3/2 tsp y\nmake a 1\n";
  for (const [name, text] of [["sample", sample], ["made up", book(8, 3)], ["bad", bad]]) {
    const f = join(dir, "b.txt");
    writeFileSync(f, text);
    const want = w.ideal(["b.txt"], { "b.txt": text }), lines = (s: string) => (s ? s.replace(/\n$/, "").split("\n") : []);
    const c = spawnSync(join(dir, "larder"), ["b.txt"], { cwd: dir, encoding: "utf8" });
    assert.deepEqual({ out: lines(c.stdout), err: lines(c.stderr), code: c.status }, want, `native, ${name}`);
    const out = join(dir, "out.txt"), err = join(dir, "err.txt"), fo = openSync(out, "w"), fe = openSync(err, "w");
    const wa = new WASI({ version: "preview1", args: ["larder", "b.txt"], preopens: { ".": dir }, stdout: fo, stderr: fe, returnOnExit: true });
    const code = wa.start(new WebAssembly.Instance(wasm, wasiImports(wa)));
    closeSync(fo); closeSync(fe);
    assert.deepEqual({ out: lines(readFileSync(out, "utf8")), err: lines(readFileSync(err, "utf8")), code }, want, `wasi, ${name}`);
  }
});

// ters compile's module as a process: before the fix every "" in it was
// the number of the frames' empty record tag (moduleTags), so `words`
// kept empty words, no blank line was blank, and the sample book stopped
// at its first one ("line 9: expected an amount…").
test("larder: ters compile's module prints what the ideal prints", () => {
  const dir = mkdtempSync(join(tmpdir(), "larder-js-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const made = spawnSync(process.execPath, ["--no-warnings", ters, "compile", folder, "-o", join(dir, "larder.mjs")], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } });
  assert.equal(made.status, 0, made.stderr);
  const lines = (s: string) => (s ? s.replace(/\n$/, "").split("\n") : []);
  for (const [name, text] of [["sample", sample], ["made up", book(8, 3)]]) {
    writeFileSync(join(dir, "b.txt"), text);
    const r = spawnSync(process.execPath, [join(dir, "larder.mjs"), "b.txt"], { cwd: dir, encoding: "utf8", env: { ...process.env, TERS_WORKERS: "0" } });
    assert.deepEqual({ out: lines(r.stdout), err: lines(r.stderr), code: r.status }, w.ideal(["b.txt"], { "b.txt": text }), name);
  }
});
