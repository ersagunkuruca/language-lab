// The prelude definitions found by name (prelude-ids.ts) are the
// prelude's own, by that name (C137d2), or the numbers or trees module's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NUMBERS, PRELUDE, TREES } from "../src/lang/library.ts";
import { PRELUDE_DEFS } from "../src/lang/prelude-ids.ts";

test("each prelude definition in the table is the prelude's of that name", () => {
  for (const [name, id] of Object.entries(PRELUDE_DEFS)) {
    // Fractions' pieces are the numbers module's (L207f4), array map the
    // trees module's (C42).
    const found = [PRELUDE, NUMBERS, TREES].flatMap((m) => Object.keys(m.names).filter((d) => m.names[d] === name && m.code.nodes[d]?.kind === "def"));
    assert.deepEqual(found, [id], name);
  }
});
