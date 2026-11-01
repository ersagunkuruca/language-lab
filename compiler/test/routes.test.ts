// routes (ters/examples/routes), GAPS.md round 5's program: the
// evaluator and the compiled code, on maps and sets as defined and as
// trees, and the hand-written ideal must print the same and exit the same
// way, failures included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { examples, load } from "../src/program.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { country, ways, type Name } from "../gaps/routes.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>, slow = false) => {
  const want = w.ideal(args, files);
  const others: Name[] = slow ? ["compiled", "compiled, trees"] : ["evaluator", "evaluator, trees", "compiled", "compiled, trees"];
  for (const way of others) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const roads = readFileSync(join(examples, "routes/roads.txt"), "utf8");

test("routes: the example's roads", () => {
  const r = all(["r.txt"], { "r.txt": roads });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.join("\n").split("\n"), [
    "7 towns, 8 roads, 2 parts",
    "cheapest network: 570 km in 5 roads",
    "farthest from Arden: Eskar, 460 km",
    "Arden → Brisk → Dunmore → Eskar: 460 km",
    "Eskar → Dunmore → Brisk → Arden: 460 km",
    "Arden → Gant: no route",
    "within 250 km of Brisk: Arden 120, Colm 150, Dunmore 200",
    "Gant → Fallow: 70 km",
  ]);
});

const ties = (gap: string) => `road A B 5\nroad A C 5\nroad B D 5\nroad C D 5\nroad D D 3\nroad E${gap}F 1\ntrip A D\ntrip D D\nnear E 0\nnear A 5\n`;
test("routes: ties, a road to itself, a trip that goes nowhere, a near with nothing", () => {
  const r = all(["r.txt"], { "r.txt": ties(" ") });
  assert.deepEqual(r.out.join("\n").split("\n"), [
    "6 towns, 6 roads, 2 parts",
    "cheapest network: 16 km in 4 roads",
    "farthest from A: D, 10 km",
    "A → B → D: 10 km",
    "D: 0 km",
    "within 0 km of E: nothing",
    "within 5 km of A: B 5, C 5",
  ]);
});

// GAPS.md M1: `words` is keep(split(line, " "), …); the compiled keep
// straight over split had given the list unchanged.
test("routes: more than one space between words", () => {
  const r = all(["r.txt"], { "r.txt": ties("   ") });
  assert.deepEqual(r.out.join("\n").split("\n"), [
    "6 towns, 6 roads, 2 parts",
    "cheapest network: 16 km in 4 roads",
    "farthest from A: D, 10 km",
    "A → B → D: 10 km",
    "D: 0 km",
    "within 0 km of E: nothing",
    "within 5 km of A: B 5, C 5",
  ]);
});

test("routes: a generated country of 60 towns", () => {
  const r = all(["c.txt"], { "c.txt": country(60, 2, 8) });
  assert.equal(r.code, 0);
  assert.match(r.out[0], /^60 towns, /);
});

test("routes: a generated country of 300 towns, compiled", () => {
  const r = all(["c.txt"], { "c.txt": country(300) }, true);
  assert.equal(r.out.length, 11);
});

test("routes: what goes wrong, and the exit codes", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: routes roads.txt"], code: 2 });
  assert.deepEqual(all(["nope.txt"], {}), { out: [], err: ["routes: no such file or folder: nope.txt"], code: 1 });
  assert.deepEqual(all(["r.txt"], { "r.txt": "\n# only a comment\n" }).err, ["routes: r.txt has no roads"]);
  assert.deepEqual(all(["r.txt"], { "r.txt": "trip A B\n" }).err, ["routes: r.txt has no roads"]);
  const bad = "routes: line 2: expected road <town> <town> <km>, trip <town> <town> or near <town> <km>";
  assert.deepEqual(all(["r.txt"], { "r.txt": "road A B 1\nroad A B\n" }).err, [bad]);
  assert.deepEqual(all(["r.txt"], { "r.txt": "road A B 1\n   \n" }).err, [bad]);
  assert.deepEqual(all(["r.txt"], { "r.txt": "road A B 1\ntrip A B C\n" }).err, [bad]);
  assert.deepEqual(all(["r.txt"], { "r.txt": "# x\nroad A B 1.5\n" }).err, ["routes: line 2: 1.5 isn't a whole number of km"]);
  assert.deepEqual(all(["r.txt"], { "r.txt": "road A B 1\nnear A far\n" }).err, ["routes: line 2: far isn't a whole number of km"]);
  // The summary is printed before the trips are answered.
  const r = all(["r.txt"], { "r.txt": "road A B 1\ntrip A B\ntrip A Z\n" });
  assert.deepEqual(r, { out: ["2 towns, 1 road, 1 part\ncheapest network: 1 km in 1 road\nfarthest from A: B, 1 km", "A → B: 1 km"], err: ["routes: line 3: no road goes to Z"], code: 1 });
});

// GAPS.md M2: the chooser is handed the program's types too, so the
// records' Map and Set fields hold the trees the code builds.
test("routes: the trees chosen the way lab chooses them check", () => {
  const p = load("routes");
  const own: string[] = JSON.parse(readFileSync(join(examples, "routes/code.json"), "utf8")).defs;
  const main = own.find((d) => p.pres.names[d] === "main")!;
  const lib = withLibraryRepresentations(p.code, p.info, p.pres.names, main, own);
  const options = p.options as Parameters<typeof infer>[3];
  const info = infer(lib.code, lib.names, undefined, { ...options, insiders: [...(options?.insiders ?? []), ...lib.insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
});
