// A field whose name ends in a word operator reads as one name (I258):
// `b.anchor + x` was split at "or" (anch|or), so it didn't read at all;
// "band" and "colour" broke the same way. A word operator is a word.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

test("a field ending in or, and or mod reads as a name, and the word operators still read", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "word-ops-")), "wc");
  cpSync(join(import.meta.dirname, "../examples/wc"), dir, { recursive: true });
  const s = new Session(dir);
  s.define("Spot", "type", [], "spot(anchor: Float64, band: Float64, colour: Float64, upturned: Bool)");
  for (const [name, text] of [
    ["sum", "b.anchor + b.band + b.colour"],
    ["both", "b.upturned and b.anchor > b.band"],
    ["either", "b.upturned or b.colour < b.anchor"],
  ]) {
    s.define(name, "function", ["b"]);
    s.replace(/□#(\w+)/.exec(s.view(name))![1], text);
    assert.match(s.view(name), new RegExp(text.replace(/[.+*?^$()[\]{}|\\]/g, "\\$&")), name);
  }
  assert.equal(s.errors(), "ok");
  assert.match(s.eval("sum(spot(1, 2, 3, false))"), /^= 6 : Float64$/m);
  assert.match(s.eval("both(spot(3, 2, 1, true))"), /^= true : Bool$/m);
  assert.match(s.eval("either(spot(1, 2, 3, false))"), /^= false : Bool$/m);
});
