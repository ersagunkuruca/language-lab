// notebook (ters/examples/notebook), GAPS.md round 6's program: the
// evaluator and the compiled code, on maps as defined and as the chooser
// stores them, and the hand-written ideal must print the same and exit the
// same way, failures included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { examples } from "../src/program.ts";
import { notes, ways, type Name } from "../gaps/notebook.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>, slow = false) => {
  const want = w.ideal(args, files);
  const others: Name[] = slow ? ["compiled", "compiled, trees", "compiled, table"] : ["evaluator", "evaluator, trees", "compiled", "compiled, trees", "compiled, table"];
  for (const way of others) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const example = readFileSync(join(examples, "notebook/notes.txt"), "utf8");

test("notebook: the example's notes", () => {
  const r = all(["n.txt"], { "n.txt": example });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.join("\n").split("\n"), [
    "6 notes, 58 terms, 48 different terms",
    "most common: tide 6, bay 2, harbour 2, make 2, moon 2",
    "longest: ferries, 12 terms",
    "find tide: lighthouse 3000, moon 3000, ferries 1500, harbour 1500",
    "find tide harbour: harbour 4500",
    "any moon bread: moon 12000, bakery 6000",
    "like harbour: bakery 3000, lighthouse 3000, moon 3000, ferries 1500",
    "seen tide: bay 2, make 2, moon 2, all 1, boat 1",
    "find whale: nothing",
  ]);
});

test("notebook: stems, capitals, punctuation, stop words, empty questions", () => {
  const r = all(["n.txt"], { "n.txt": "note a Cities, CITY's   cats; the Kiss!\nnote b city of glass\nfind cities\nfind the\nany\nseen City\nseen of\nlike b\nfind city glass city\n" });
  assert.deepEqual(r.out, [
    "2 notes, 6 terms, 5 different terms\nmost common: city 2, cat 1, city' 1, glass 1, kiss 1\nlongest: a, 4 terms",
    "find city: a 1000, b 1000",
    "find : nothing",
    "any : nothing",
    "seen city: cat 1, city' 1, glass 1, kiss 1",
    "seen of: nothing",
    "like b: a 1000",
    "find city glass city: b 4000",
  ]);
});

test("notebook: errors stop the run with the line", () => {
  const cases: [string, number, string][] = [
    ["note a x\nfetch a\n", 1, "notebook: line 2: expected note <name> <text>, find <words>, any <words>, like <name> or seen <word>"],
    ["note a x\nnote\n", 1, "notebook: line 2: expected note <name> <text>, find <words>, any <words>, like <name> or seen <word>"],
    ["note a x\n   \n", 1, "notebook: line 2: expected note <name> <text>, find <words>, any <words>, like <name> or seen <word>"],
    ["note a x\nlike a b\n", 1, "notebook: line 2: expected note <name> <text>, find <words>, any <words>, like <name> or seen <word>"],
    ["note a x\nnote a y\n", 1, "notebook: line 2: a second note named a"],
    ["# nothing\nfind x\n", 1, "notebook: n.txt has no notes"],
  ];
  for (const [text, code, err] of cases) {
    const r = all(["n.txt"], { "n.txt": text });
    assert.deepEqual([r.code, r.err, r.out], [code, [err], []], text);
  }
  // A like naming no note fails where it is asked, after what came before.
  const r = all(["n.txt"], { "n.txt": "note a x\nfind x\nlike b\nfind x\n" });
  assert.deepEqual([r.code, r.err, r.out.length], [1, ["notebook: line 3: no note named b"], 2]);
  assert.equal(all([], {}).code, 2);
  assert.equal(all(["missing.txt"], {}).code, 1);
});

test("notebook: 60 made-up notes", () => {
  const r = all(["n.txt"], { "n.txt": notes(60, 40) });
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 41);
});

test("notebook: 400 made-up notes, compiled", () => {
  all(["n.txt"], { "n.txt": notes(400, 40) }, true);
});
