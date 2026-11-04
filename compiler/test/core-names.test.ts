// Compiled code names no definitions (C170a, DEBUG-AND-SPEED-2026-11-04
// §4): calc's functions are f0, f1, … with no comment carrying a
// definition's name; a stop still names its definition (C143b).

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { emitCoreJs, lowerCore } from "../src/core-js.ts";

test("the core IR's JavaScript has no comments naming definitions (C170a)", () => {
  const p = load("calc"), main = p.named("main");
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const { js } = emitCoreJs(ir);
  assert.doesNotMatch(js, /^\s*\/\//m);
  assert.doesNotMatch(js, /run lines|tokens/);
  assert.ok(ir.funcs.some((f) => f.name === "run lines"));
});
