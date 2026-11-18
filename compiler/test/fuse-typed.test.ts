// Fold-of-map fusion carries its nodes' types (fuse-steps.ts, the compiler
// redesign's stage 2): the verifier vouches for them, so the program isn't
// checked again, and what is compiled is what a check again would give.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import * as scalar from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

const c = (folder: string) => {
  const p = loadProgram(root + folder), names = p.pres.names, main = p.own.defs.find((x) => names[x] === "main")!;
  return emitC(scalar.lowerScalar(p.code, infer(p.code, names, undefined, p.options), names, [main], { data: true })).c;
};

for (const [name, folder, fused] of [["divisors", "ters/examples/divisors", 1], ["trek", "compiler/gaps/trek", 3]] as const) {
  test(`${name}'s fusions carry their types, and compile as a check again would`, () => {
    const carried = c(folder);
    assert.deepEqual(scalar.lastFused, { fused, carried: true });
    process.env.TERS_RECHECK = "1";
    try { assert.equal(c(folder), carried); } finally { delete process.env.TERS_RECHECK; }
  });
}
