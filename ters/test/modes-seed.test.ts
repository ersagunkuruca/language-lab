// library/steady-modes.json is steady's modes as modes.ts works them out
// today (BACKLOG E103): after a change to steady or to the analysis, run
// `node library/steady-modes.ts` again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { steadyRows } from "../library/steady-rows.ts";

test("steady-modes.json is current", () => {
  const file = readFileSync(join(import.meta.dirname, "..", "library", "steady-modes.json"), "utf8");
  assert.ok(JSON.stringify(steadyRows()) + "\n" === file, "library/steady-modes.json is stale: run node library/steady-modes.ts");
});
