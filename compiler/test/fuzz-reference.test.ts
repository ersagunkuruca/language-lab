// T18f: the reference run's parts (fuzz-reference.ts), without a worktree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { program } from "./fuzz-programs.ts";
import { answers, programOnly } from "./fuzz-answers.ts";
import { differences, INPUTS } from "./fuzz-reference.ts";

test("a generated program saved without the library runs on this tree's the same (T18f)", () => {
  const p = program(12, 20, INPUTS.map(([, , xs]) => xs.map(BigInt)));
  const own = programOnly(p.code, p.names);
  assert.ok(Object.keys(own.code.nodes).every((id) => !LIBRARY.code.nodes[id]) && own.code.defs.length >= 20);
  const defs = p.defs.map((d) => d.def);
  const a = answers({ ...own, defs, inputs: INPUTS }), whole = answers({ code: p.code, names: p.names, defs, inputs: INPUTS });
  assert.deepEqual(a.errors, []);
  assert.equal(a.answers.length, 20);
  assert.deepEqual(differences(a, whole), []);
});

test("differences name the definition, the input and both answers (T18f)", () => {
  assert.deepEqual(differences({ errors: [], answers: [["1", "2"], ["a", "b"]] }, { errors: [], answers: [["1", "2"], ["a", "c"]] }), ["g1(input 1): now b, then c"]);
});
