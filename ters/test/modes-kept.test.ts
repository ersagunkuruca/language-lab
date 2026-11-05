// T14: a published function's mode, worked out while another published
// one is (steady pow's helpers under pow), is kept as one worked out on
// its own is (E248), and is the same verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/lang/library.ts";
import { analyzer } from "../src/lang/modes.ts";

const steady = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === `steady ${name}`)!;

test("a published helper's mode worked out under another is kept, and is its own", () => {
  const pow = steady("pow"), twoTo = steady("two to"), scaled = steady("scaled");
  assert.ok(pow && twoTo && scaled);
  // Kept modes are kept by the names the messages use: these two are
  // fresh, so nothing another test worked out is read.
  const under = { [pow]: "pow under" }, alone = { [pow]: "pow alone" };
  analyzer(LIBRARY.code, under).ofMode(pow, ["out"]);
  let t = performance.now();
  const kept = [analyzer(LIBRARY.code, under).ofMode(twoTo, ["out"]), analyzer(LIBRARY.code, under).ofMode(scaled, ["0"])];
  const keptMs = performance.now() - t;
  t = performance.now();
  const own = [analyzer(LIBRARY.code, alone).ofMode(twoTo, ["out"]), analyzer(LIBRARY.code, alone).ofMode(scaled, ["0"])];
  const ownMs = performance.now() - t;
  assert.deepEqual(kept, own);
  assert.ok(keptMs * 5 < ownMs, `kept ${keptMs.toFixed(0)} ms, worked out ${ownMs.toFixed(0)} ms`);
});
