// The program's choices beside it (L280a, cli/choices.ts): an entry per
// pick, sorted by the type's id, with the facts the pick read; a check
// says which written entries the compiler would now pick otherwise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { represented, type Program } from "../cli/represented.ts";
import { choiceLines, choicesPath, choicesText, heldAndPicked, heldOf, heldWarnings, readChoices, staleChoices } from "../cli/choices.ts";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

const choices = (name: string, held?: Map<string, string>) => {
  const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const given: Program = { title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options, held };
  return choiceLines(given, main, represented(given, main, true).picks ?? []);
};

test("numbers' Nat is an int, with the jobs main uses on it, those in a loop marked", () => {
  const lines = choices("numbers");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ representation: Nat as int; among binary, unary, int; jobs .*succ \(in a loop\).*; target JavaScript$/);
});

test("greenhouse-page's Set is a hash table; the same each time", () => {
  const lines = choices("greenhouse-page");
  assert.deepEqual(lines.map((l) => l.split(";")[0]), ["std.set representation: Set as hash table"]);
  assert.deepEqual(choices("greenhouse-page"), lines);
});

test("a check says which entries are stale and which are new", () => {
  const now = choices("greenhouse-page");
  const text = choicesText("main", now);
  assert.deepEqual(readChoices(text), now);
  assert.deepEqual(staleChoices(readChoices(text), now), []);
  const held = now[0].replace("as hash table", "as weight-balanced tree");
  assert.deepEqual(staleChoices([held], now), [`stale  ${held}`, `new    ${now[0]}`]);
});

test("a program's choices are beside it", () => {
  assert.equal(choicesPath("examples/pond/"), "examples/pond.choices");
  assert.equal(choicesPath("ledger.ters"), "ledger.ters.choices");
});

// Held entries (L280c): a person writes `held` before an entry, and the
// compiler stores the type so, where the chooser could pick that row, and
// says when it would pick another; writing the choices again keeps it.
test("a held entry is stored as it says, kept, and said where the compiler would pick another", () => {
  const now = choices("greenhouse-page");
  const held = `held ${now[0].replace("as hash table", "as weight-balanced tree")}`;
  assert.deepEqual([...heldOf([held])], [["std.set", "weight-balanced tree"]]);
  const stored = choices("greenhouse-page", heldOf([held]));
  assert.match(stored[0], /^std\.set representation: Set as weight-balanced tree;/);
  assert.deepEqual(heldAndPicked([held], stored), [held]);
  assert.deepEqual(staleChoices([held], stored), []);
  assert.deepEqual(heldWarnings([held], now), ["held   std.set: weight-balanced tree, where the compiler would pick hash table"]);
  assert.deepEqual(heldWarnings([held], stored), []);
});

test("a held entry that isn't a way to store the type, or a list's split, is refused", () => {
  assert.throws(() => choices("greenhouse-page", new Map([["std.set", "linked list"]])), /Set can't be held as linked list here: it is stored as weight-balanced tree, sorted list, hash table/);
  assert.throws(() => heldOf(["held std.list representation: List as array of List from main; among array of List, List as written; jobs none; target JavaScript"]), /a list's split can't be held yet/);
});

// The algorithm kind (L280a part 2): the way each operation main uses is
// given by, among the field as written and its ways (WAYS.md), as the
// arithmetic's resolving picks it.
test("herd's trig: each operation it uses, as written among its ways; none it doesn't use", () => {
  const ways = choices("herd").filter((l) => l.includes(" way: "));
  assert.deepEqual(ways.map((l) => l.split(";")[0].replace(/^\S+ /, "")), ["way: trig at float64's cos: as written", "way: trig at float64's polar: as written", "way: trig at float64's sin: as written"]);
  assert.match(ways[0], /; among as written, cos by sin, cos by polar; target JavaScript$/);
  assert.deepEqual(choices("numbers").filter((l) => l.includes(" way: ")), []);
});
