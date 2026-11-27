import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { plainNodes, nodesWhere, replace, subtree, type NodeOf, isCall, isUse, copyNodes, nodeValues } from "../src/model.ts";
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
  const hole = subtree(p.code, fall).find((x) => isCall(p.code.nodes[x]) && subtree(p.code, x).length > 3)!;
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  const info = infer(code, p.pres.names);
  const solves = nodeValues(code.nodes).filter(isUse);
  const offers = fillings(code, info, hole).slice(0, 40);
  assert.ok(offers.length > 10);
  const scratch = copyNodes(code.nodes);
  let differ = 0;
  for (const o of offers) {
    const r = fillHole(code, {}, hole, o, {}, scratch);
    derivedFrom(r.code, code, subtree(r.code, hole));
    const fresh = { nodes: copyNodes(r.code.nodes), defs: r.code.defs };
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
  const hole = subtree(p.code, fall).find((x) => isCall(p.code.nodes[x]) && subtree(p.code, x).length > 3)!;
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  const info = infer(code, p.pres.names);
  const scratch = copyNodes(code.nodes);
  const kinds = [["use", isUse], ["call", isCall]] as const;
  for (const o of fillings(code, info, hole).slice(0, 40)) {
    const r = fillHole(code, {}, hole, o, {}, scratch);
    derivedFrom(r.code, code, subtree(r.code, hole));
    for (const [k, is] of kinds) {
      const scan = nodeValues(r.code.nodes).filter((n) => is(n)).map((n) => n.id).sort();
      assert.deepEqual([...nodesWhere(r.code, k, (n) => is(n))].sort(), scan);
    }
    const fresh = { nodes: copyNodes(r.code.nodes), defs: r.code.defs };
    assert.deepEqual(plainNodes(useDirections(r.code).nodes), plainNodes(useDirections(fresh).nodes));
    r.undo();
  }
});

// I387: a node the edit changes keeps its id (buffer's `match k` made
// `match 0`: the scrutinee, a ref to k, became a literal). The base's
// slots had it as k; the derived program's verdict must be a fresh one's,
// where edited calls itself on something that isn't smaller.
test("a derived program whose ref became a literal under the same id gets a fresh program's verdict (I387)", async () => {
  const { analyzer } = await import("../src/lang/modes.ts");
  const p = loadProgram(join(root, "examples", "buffer"));
  const edited = p.named("edited"), doc = p.named("doc");
  const m = subtree(p.code, edited).map((x) => p.code.nodes[x]).find((n): n is NodeOf<"match"> => n?.kind === "match")!;
  const spec = new Map([[0, { k: "def" as const, id: doc }]]);
  // The base asked first, so its slots are kept.
  assert.equal(analyzer(p.code, p.pres.names).ofMode(edited, ["0", "1", "2"], spec)?.ends, true);
  const code = replace(p.code, m.scrutinee, () => ({ kind: "lit", value: 0 } as never));
  derivedFrom(code, p.code, [m.scrutinee]);
  const fresh = { nodes: copyNodes(code.nodes), defs: code.defs };
  const verdict = (c: typeof code) => analyzer(c, p.pres.names).ofMode(edited, ["0", "1", "2"], spec)?.ends;
  assert.equal(verdict(fresh), false);
  assert.equal(verdict(code), false);
});
