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
