// Costs worked out from the jobs' definitions (L247, job-cost.ts): the
// least a job always takes, which raises a declaration below it and
// leaves the rest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { LIBRARY, TREES } from "../src/lang/library.ts";
import { merge } from "../src/model.ts";
import { representationsIn } from "../src/lang/represent.ts";
import { workedOut, withWorkedOutCosts } from "../src/lang/job-cost.ts";

const example = (name: string) => {
  const p = loadProgram(join(import.meta.dirname, "../examples", name));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  return { p, info, reps: representationsIn(p.code, info, p.pres.names, p.own.defs) };
};

test("a job declared below what its definition always does is raised: front first's behind appends (L247)", () => {
  const { p, info, reps } = example("waiting");
  const [front, two] = withWorkedOutCosts(p.code, info, reps, LIBRARY.reps);
  const behind = Object.keys(p.pres.names).find((id) => p.pres.names[id] === "behind")!;
  // append(r, [p]) walks r as written and an array copies it; a tree, the
  // cheapest of List's ways, takes log n.
  assert.equal(front.cost[behind], "log n");
  assert.deepEqual(front.raised?.map((r) => [p.pres.names[r.job], r.declared, r.least, p.pres.names[r.calls!]]), [["behind", "1", "log n", "append"]]);
  // Two lists' jobs each have a constant path (the reverse is on the
  // other arm): their declarations stand.
  assert.equal(two.raised, undefined);
  assert.equal(two.cost[behind], "1");
});

test("a declaration a definition can't be shown to exceed stands: binary's succ carries, its amortized constant (L247)", () => {
  const { p, info, reps } = example("numbers");
  for (const r of withWorkedOutCosts(p.code, info, reps, LIBRARY.reps)) assert.equal(r.raised, undefined, r.name);
});

// The library's own declarations agree with their definitions: a tree's
// cons goes down one side, as deep as the tree is, which says nothing of
// its size, and a byte array's count reads its array's length.
test("no declaration of the library's representations is below what its definition always does (L247)", () => {
  const code = merge(LIBRARY.code, TREES.code), names = { ...LIBRARY.names, ...TREES.names };
  const info = infer(code, names);
  const raised = LIBRARY.reps.flatMap((r) => workedOut(code, info, r, LIBRARY.reps).raised.map((x) => `${r.name}: ${names[x.job] ?? x.job} ${x.declared} → ${x.least}`));
  assert.deepEqual(raised, []);
});
