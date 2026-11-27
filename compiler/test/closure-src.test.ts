// A closure carries its lambda's and captures' ids (C137c13) only where
// something can look inside it (C169): dice makes closures and runs no
// solver, so its printed closures carry nothing; nor do calculus's,
// whose functions carry their derivatives instead (I245). A second
// derivative of a function value still looks inside one
// (core-derive.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { emitCoreJs, lowerCore } from "../src/core-js.ts";

const printed = (name: string) => {
  const p = load(name), main = p.named("main");
  return emitCoreJs(lowerCore(p.code, p.info, p.pres.names, [main])).js;
};

test("closures carry their nodes only where a solver can be given them (C169)", () => {
  const dice = printed("dice");
  assert.match(dice, /R\.closure\(/);
  assert.doesNotMatch(dice, /"lambda":/);
  assert.doesNotMatch(printed("calculus"), /"lambda":/);
});

// A capture holding a Bool inside (rain-page's hand, captured by the map
// of its drops, G12) carries its type's Bool paths, and is turned to the
// evaluator's along them only when something looks inside.
test("a closure's capture holding a Bool is turned along its Bool paths when looked inside (G12)", async () => {
  const { RUNTIME } = await import("../src/core-rt.ts");
  const { META } = await import("../../ters/src/lang/run-values.ts");
  const { TRUE } = await import("../../ters/src/lang/std-ids.ts");
  // A record "wipe" of a Bool and a number: its field 0 a Bool.
  const turn = encodeURIComponent(JSON.stringify({ n: [{ t: { wipe: [1, -1] } }, "b"], r: [0] }));
  const hand = { tag: "wipe", fields: [true, 0.5] };
  const c = RUNTIME.closure(() => 0, [hand], { lambda: "λ", binders: ["w"], bools: [], turn }) as unknown as Record<symbol, { env: Map<string, { tag: string; fields: unknown[] }> }>;
  const w = c[META].env.get("w")!;
  assert.deepEqual(w.fields[0], { tag: TRUE, fields: [] });
  assert.equal(w.fields[1], 0.5);
  assert.equal(hand.fields[0], true, "the capture itself as it was");
});

// So rain-page's map of its drops, whose function captures the hand, can go
// away from the page's thread (G12a): before, a capture holding a Bool kept it.
test("rain-page's map of its drops goes away, its capture with it (G12a)", () => {
  const p = load("rain-page"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]) as { awayMaps?: { how: string; caps: unknown[] }[] };
  const maps = (ir.awayMaps ?? []).filter(m => m.how === "map");
  assert.equal(maps.length, 1);
  assert.equal(maps[0].caps.length, 1);
});
