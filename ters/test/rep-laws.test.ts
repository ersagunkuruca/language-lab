// A representation's laws (REPRESENTATIONS.md step 4, BACKLOG L108d): each
// job done at R agrees with T's own through meaning, on small values built
// by T's own jobs. Numbers' binary and int Nats, and the library's trees
// and array of List, hold; a job swapped for another is caught.

import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY, TREES } from "../src/lang/library.ts";
import { base, baseNames, checkOptions, loadProgram } from "../src/lang/load.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { representationLaws } from "../src/lang/rep-laws.ts";

const numbers = () => {
  const p = loadProgram("examples/numbers");
  const info = infer(p.code, p.pres.names);
  return { p, info, reps: representationsIn(p.code, info, p.pres.names) };
};

test("Numbers' binary and int Nats agree with Nat through their meaning", () => {
  const { p, info, reps } = numbers();
  const laws = representationLaws(p.code, info, p.pres.names, reps);
  assert.deepEqual(laws.filter((l) => l.failures.length), []);
  assert.deepEqual(laws.filter((l) => l.rep === "int").map((l) => l.job), ["add", "zero", "succ", "multiply", "number", "match", "fold"]);
  assert.ok(laws.every((l) => l.cases > 0));
  assert.ok(laws.find((l) => l.rep === "binary" && l.job === "add")!.cases >= 20);
});

test("a job that doesn't agree is caught, with its inputs", () => {
  const { p, info, reps } = numbers();
  const int = reps.find((r) => r.name === "int")!;
  const add = Object.keys(int.impl).find((k) => p.pres.names[k] === "add")!, mul = Object.keys(int.impl).find((k) => p.pres.names[k] === "multiply")!;
  const wrong = { ...int, impl: { ...int.impl, [add]: int.impl[mul] } };
  const [law] = representationLaws(p.code, info, p.pres.names, [wrong]).filter((l) => l.job === "add");
  assert.ok(law.failures.length > 0);
  assert.match(law.failures[0].what, /^at int gives .+, Nat's own .+$/);
  assert.equal(law.failures[0].inputs.length, 2);
});

test("the library's Map and Set trees and array of List agree through their meaning", () => {
  const code = base(TREES.code), names = { ...baseNames({}), ...TREES.names, ...LIBRARY.names };
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...(checkOptions.insiders ?? []), ...TREES.code.defs] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const laws = representationLaws(code, info, names, LIBRARY.reps);
  assert.deepEqual(laws.filter((l) => l.failures.length).map((l) => [l.rep, l.job, l.failures[0]]), []);
  const jobs = (rep: string) => laws.filter((l) => l.rep === rep && l.cases > 0).map((l) => l.job);
  assert.deepEqual(jobs("array of List"), ["nil", "cons", "length", "append", "item at", "match", "fold"]);
  assert.ok(jobs("weight-balanced tree").includes("put") && jobs("weight-balanced tree").includes("set union"));
});

// match and fold (L108d2): given cases that report what they get, the
// representation's must call the same case with the same values as T's own.
test("match and fold agree too, and a match that calls the wrong case is caught", () => {
  const { p, info, reps } = numbers();
  const laws = representationLaws(p.code, info, p.pres.names, reps);
  for (const rep of ["int", "binary"]) for (const job of ["match", "fold"]) {
    const law = laws.find((l) => l.rep === rep && l.job === job);
    assert.ok(law && law.cases >= 5 && !law.failures.length, `${rep} ${job}`);
  }
  // fold where match goes: the cases get one more input each.
  const int = reps.find((r) => r.name === "int")!;
  const wrong = { ...int, impl: { ...int.impl, match: int.impl.fold } };
  const law = representationLaws(p.code, info, p.pres.names, [wrong]).find((l) => l.job === "match")!;
  assert.ok(law.failures.length > 0);
  assert.match(law.failures[0].what, /^at int match (calls case|stops)/);
});
