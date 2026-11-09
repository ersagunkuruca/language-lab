// Works out steady's modes, forwards and with only its result known, and
// writes them to library/steady-modes.json without their plans: modes.ts
// starts from them (BACKLOG E103). Run it after steady or modes.ts
// changes; modes-seed.test.ts says when.
//   node library/steady-modes.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { steadyRows } from "./steady-rows.ts";

writeFileSync(join(import.meta.dirname, "steady-modes.json"), JSON.stringify(steadyRows()) + "\n");
