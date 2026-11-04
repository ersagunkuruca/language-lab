// The prelude definitions found by name (prelude-ids.ts) are the
// prelude's own, by that name (C137d2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRELUDE } from "../src/lang/library.ts";
import { PRELUDE_DEFS } from "../src/lang/prelude-ids.ts";

test("each prelude definition in the table is the prelude's of that name", () => {
  for (const [name, id] of Object.entries(PRELUDE_DEFS)) {
    const found = Object.keys(PRELUDE.names).filter((d) => PRELUDE.names[d] === name && PRELUDE.code.nodes[d]?.kind === "def");
    assert.deepEqual(found, [id], name);
  }
});
