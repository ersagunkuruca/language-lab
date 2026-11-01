import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { nodesWhere, replace, subtree, type NodeOf } from "../src/model.ts";
import { useDirections } from "../src/lang/directions.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer, fillings } from "../src/lang/infer.ts";
import { fillHole } from "../src/lang/refactor.ts";
import { derivedFrom, solveMode } from "../src/lang/modes.ts";

// BACKLOG E133b: the analyzer of a filled program starts from the slots of
// the program it was filled from. Its verdicts are the ones a program
// built afresh gets, for every offer of a hole in physics fall (run
// backwards, so each offer's plan is asked).
test("a filled program's solve verdicts are those of the same program built afresh", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  const fall = p.named("fall");
  const hole = subtree(p.code, fall).find((x) => p.code.nodes[x].kind === "call" && subtree(p.code, x).length > 3)!;
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  const info = infer(code, p.pres.names);
  const solves = Object.values(code.nodes).filter((n): n is NodeOf<"solve"> => n.kind === "solve");
  const offers = fillings(code, info, hole).slice(0, 40);
  assert.ok(offers.length > 10);
  const scratch = { ...code.nodes };
  let differ = 0;
  for (const o of offers) {
    const r = fillHole(code, {}, hole, o, {}, scratch);
    derivedFrom(r.code, code, subtree(r.code, hole));
    const fresh = { nodes: { ...r.code.nodes }, defs: r.code.defs };
    for (const s of solves) {
      const a = JSON.stringify(solveMode(r.code, s)), b = JSON.stringify(solveMode(fresh, s));
      assert.equal(a, b);
      if (a !== JSON.stringify(solveMode(code, s))) differ++;
    }
    r.undo();
  }
  // Some offers change a plan, so the check above saw the slots matter.
  assert.ok(differ > 0);
});

// BACKLOG E103d: a filled program's node lists start from the program's,
// and say what a scan of every node says.
test("a filled program's solves and calls are those a full scan finds", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  const fall = p.named("fall");
  const hole = subtree(p.code, fall).find((x) => p.code.nodes[x].kind === "call" && subtree(p.code, x).length > 3)!;
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  const info = infer(code, p.pres.names);
  const scratch = { ...code.nodes };
  const kinds = ["solve", "call"] as const;
  for (const o of fillings(code, info, hole).slice(0, 40)) {
    const r = fillHole(code, {}, hole, o, {}, scratch);
    derivedFrom(r.code, code, subtree(r.code, hole));
    for (const k of kinds) {
      const scan = Object.values(r.code.nodes).filter((n) => n.kind === k).map((n) => n.id).sort();
      assert.deepEqual([...nodesWhere(r.code, k, (n) => n.kind === k)].sort(), scan);
    }
    const fresh = { nodes: { ...r.code.nodes }, defs: r.code.defs };
    assert.deepEqual(useDirections(r.code).nodes, useDirections(fresh).nodes);
    r.undo();
  }
});
