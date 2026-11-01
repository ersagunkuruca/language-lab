import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { replace, subtree, type Code } from "../src/model.ts";
import { loadProgram } from "../src/lang/load.ts";
import { unitProblems, UnitsBefore } from "../src/units.ts";

// The palette checks each filling's units against the program without it,
// solved once (BACKLOG E103). It must find a conflict exactly when solving
// the filled program from the start does.
test("units checked from the program before a filling agree with units checked from the start", () => {
  const p = loadProgram(join(root, "examples", "physics"));
  let tried = 0, conflicts = 0;
  for (const d of p.own.defs) {
    const nodes = subtree(p.code, d).filter((x) => ["ref", "lit", "call"].includes(p.code.nodes[x].kind)).filter((_, i) => i % 4 === 0);
    for (const x of nodes) {
      const holed = replace(p.code, x, () => ({ kind: "hole" }));
      const before = new UnitsBefore(holed);
      const binders = subtree(p.code, d).filter((b) => p.code.nodes[b].kind === "binder");
      const tries: Code[] = [replace(holed, x, () => ({ kind: "lit", value: 2 })), ...binders.map((b) => replace(holed, x, () => ({ kind: "ref", target: b })))];
      for (const c of tries) {
        const only = new Set([d]);
        const full = unitProblems(c, {}, only).length, fast = unitProblems(c, {}, only, before).length;
        assert.equal(fast > 0, full > 0, `${p.pres.names[d]}: ${x}`);
        tried++;
        if (full) conflicts++;
      }
    }
  }
  assert.ok(tried > 50 && conflicts > 5, `${tried} tried, ${conflicts} with conflicts`);
});
