// examples/chomsky (L293a): grammars as data, one at each level of
// Chomsky's hierarchy, each classed and its words listed; deciding a word
// is total where no rule shrinks a form, and searched under fuel above.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

const session = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-chomsky-")), "chomsky");
  cpSync("examples/chomsky", dir, { recursive: true });
  return new Session(dir);
};

test("chomsky: each grammar's level and its words up to 6", () => {
  const out = session().run("main", ["6"]);
  assert.match(out, /^a⁺b\*: regular\n/);
  assert.match(out, /aⁿbⁿ: context free\n/);
  assert.match(out, /aⁿbⁿcⁿ: context sensitive\n/);
  assert.match(out, /a\^\(2\^n\): unrestricted\n/);
  assert.match(out, /  words up to 6: ab aabb aaabbb\n/);
  assert.match(out, /  words up to 6: abc aabbcc\n/);
  assert.match(out, /  words up to 6 found in 40 rounds each: aa aaaa\n/);
  assert.match(out, /exit 0/);
});

test("chomsky: deciding is total up to context sensitive; the unrestricted search is Diverge, under fuel it isn't", () => {
  const defs = session().defs();
  const typeOf = (name: string) => new RegExp(`^\\w+  ${name} : (.*)$`, "m").exec(defs)?.[1];
  assert.equal(typeOf("words up to"), "(Grammar, Int) -> List (List Symbol)");
  assert.match(typeOf("searched")!, /-\[Diverge\]->/);
  assert.equal(typeOf("found within"), "(Grammar, List Symbol, Float64) -> Answer");
  assert.equal(typeOf("main"), "(List Text) -[Console]-> Unit");
});

test("chomsky: a word not derived is decided no below, and not found within the rounds above", () => {
  const s = session();
  const g = (i: number) => `item at(grammars, ${i}, grammar("", "", nil))`;
  assert.match(s.eval(`shown answer(in language(${g(2)}, form of("aabbcc"), 40.0))`), /"yes"/);
  assert.match(s.eval(`shown answer(in language(${g(2)}, form of("aabbc"), 40.0))`), /"no"/);
  assert.match(s.eval(`shown answer(in language(${g(3)}, form of("aaaa"), 40.0))`), /"yes"/);
  assert.match(s.eval(`shown answer(in language(${g(3)}, form of("aaa"), 12.0))`), /"not found in 12 rounds"/);
});
