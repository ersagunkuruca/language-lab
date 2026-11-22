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
import { choiceLines, choicesPath, choicesText, readChoices, staleChoices } from "../cli/choices.ts";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

const choices = (name: string) => {
  const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const given: Program = { title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options };
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
