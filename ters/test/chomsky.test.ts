// examples/chomsky (L293a, L293b): grammars as data, one at each level of
// Chomsky's hierarchy, each classed and its words listed; deciding a word
// is total where no rule shrinks a form, and searched under fuel above.
// A regular grammar's automaton, its deterministic one and the grammar
// read back from it give the same words. A context-free grammar's pushdown
// automaton accepts its words, as many ways as it has parse trees (L293c).

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
  const g = (name: string) => `item at(keep(grammars, (x) => x.name = "${name}"), 0, grammar("", "", nil))`;
  assert.match(s.eval(`shown answer(in language(${g("aⁿbⁿcⁿ")}, form of("aabbcc"), 40.0))`), /"yes"/);
  assert.match(s.eval(`shown answer(in language(${g("aⁿbⁿcⁿ")}, form of("aabbc"), 40.0))`), /"no"/);
  assert.match(s.eval(`shown answer(in language(${g("a^(2^n)")}, form of("aaaa"), 40.0))`), /"yes"/);
  assert.match(s.eval(`shown answer(in language(${g("a^(2^n)")}, form of("aaa"), 12.0))`), /"not found in 12 rounds"/);
});

test("chomsky: a regular grammar's automaton, its deterministic one and the grammar read back agree", () => {
  const out = session().run("main", ["6"]);
  assert.match(out, /third from last is a: regular\n/);
  assert.match(out, /  automaton: 4 states, at most 1 way\(s\) through a word; deterministic: 8 states\n/);
  const agree = out.match(/the grammar read back from the automaton: .*/g)!;
  assert.equal(agree.length, 2);
  for (const line of agree) assert.match(line, /: the same, the same, the same$/);
});

test("chomsky: an automaton's run is a Choice, its ways through a word counted", () => {
  const s = session();
  const g = `item at(keep(grammars, (x) => x.name = "third from last is a"), 0, grammar("", "", nil))`;
  assert.match(s.eval(`accepting paths(automaton of(${g}), form of("babb"))`), /= 1 /);
  assert.match(s.eval(`accepting paths(automaton of(${g}), form of("bbab"))`), /= 0 /);
  assert.match(s.eval(`accepting paths(deterministic(automaton of(${g})), form of("babb"))`), /= 1 /);
});

test("chomsky: a context-free grammar's pushdown automaton accepts its words, once for each parse tree", () => {
  const out = session().run("main", ["6"]);
  assert.match(out, /sums: context free\n(  .*\n)*  most parse trees of a word up to 6: 2 \(a\+a\+a\)\n/);
  assert.match(out, /sums by precedence: context free\n(  .*\n)*  most parse trees of a word up to 6: 1 /);
  const accepts = out.match(/moves; words up to 6 it accepts: .*/g)!;
  assert.equal(accepts.length, 3);
  for (const line of accepts) assert.match(line, /: the same$/);
  const s = session();
  const g = (name: string) => `item at(keep(grammars, (x) => x.name = "${name}"), 0, grammar("", "", nil))`;
  const trees = (name: string, w: string) => s.eval(`ways to accept(pushdown of(${g(name)}), ${g(name)}, form of("${w}"))`);
  assert.match(trees("sums", "a+a+a+a"), /= 5 /);
  assert.match(trees("sums by precedence", "a+a+a+a"), /= 1 /);
  assert.match(trees("sums", "a+a+"), /= 0 /);
});
