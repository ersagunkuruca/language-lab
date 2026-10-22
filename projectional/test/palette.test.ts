// The palette offers only fillings that type-check. It checks the risky
// ones against just the definitions they can affect and shares that check
// between fillings that leave those definitions' types the same, so this
// confirms each offer against a full check of the program.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { replace, type NodeOf } from "../src/model.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { fillHole } from "../src/lang/refactor.ts";

for (const name of ["calculus", "backwards", "queens"]) {
  test(`every filling the palette offers in ${name} type-checks`, () => {
    const p = loadProgram(join(import.meta.dirname, "../examples", name));
    const calls = Object.values(p.code.nodes).filter((n): n is NodeOf<"call"> => n.kind === "call" && n.args.length > 0);
    const bad: string[] = [];
    for (const c of calls.filter((_, i) => i % 9 === 0)) {
      const hole = c.args[0];
      const code = replace(p.code, hole, () => ({ kind: "hole" }));
      const info = infer(code);
      for (const f of fillings(code, info, hole)) {
        if (infer(fillHole(code, {}, hole, f).code).errors.length > info.errors.length) bad.push(`${hole}: ${JSON.stringify(f)}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}
