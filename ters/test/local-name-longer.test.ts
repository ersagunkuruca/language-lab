// A local name that is a word of a longer name doesn't hide it (I279,
// GAPS round 17 D3): in depot's `line of(line, n)`, the case `comment line`
// was "nothing is named comment line here", since the parameter `line`
// was found in it and the text was read as code that names a binder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

test("a case named comment line reads with a parameter named line in scope", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "longer-")), "wc");
  cpSync(join(import.meta.dirname, "../examples/wc"), dir, { recursive: true });
  const s = new Session(dir);
  s.define("Row", "type", [], "data(n: Int)");
  s.addCase("Row", "comment line");
  for (const [name, params, text] of [
    ["alone", ["line", "n"], "comment line"],
    ["both", ["line", "n"], `if line = "x" then data(n) else comment line`],
    ["binder", ["line"], "line"],
  ] as const) {
    s.define(name, "function", [...params]);
    s.replace(/□#(\w+)/.exec(s.view(name))![1], text);
  }
  assert.match(s.view("alone"), /= ‹comment line›/);
  assert.match(s.eval(`alone("a", 1)`), /^= comment line : Row$/m);
  assert.match(s.eval(`both("x", 2)`), /^= data\(2\) : Row$/m);
  assert.match(s.eval(`both("y", 2)`), /^= comment line : Row$/m);
  assert.match(s.eval(`binder("q")`), /^= "q" : Text$/m);
});
