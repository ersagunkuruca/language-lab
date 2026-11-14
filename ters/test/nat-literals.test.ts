// A Nat is written as a number (L249b): `stepped(f, x, 5)` where a Nat goes,
// spelled through Nat's Literal (natural(5)), and stored as an Int it is 5.
// Only a whole number from 0 is one; a literal anything does arithmetic on
// is a Number as before, since Nat has no + − ·.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

const session = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "nat-lit-")), "t");
  cpSync(join(import.meta.dirname, "../examples/trits"), dir, { recursive: true });
  return new Session(dir);
};

test("a whole number from 0 is a Nat where one goes", () => {
  const s = session();
  assert.match(s.eval("integer(5)"), /^= 5 : Int$/m);
  assert.match(s.eval("integer(0)"), /^= 0 : Int$/m);
  assert.match(s.eval("integer(add(2, 3)) + 1"), /^= 6 : Int$/m);
  assert.match(s.eval("shown(stepped(incremented, trits of(13), 5))"), /^= "\+−00" : Text$/m);
  // Anything that does arithmetic on a literal still wants a Number.
  assert.throws(() => s.eval("integer(2 + 3)"), /Nat isn't a Number/);
});

test("a negative or fractional number isn't a Nat", () => {
  const s = session();
  assert.throws(() => s.eval("integer(2.5)"), /Nat is a whole number from 0: 2\.5 isn't one/);
  s.define("below", "function", []);
  assert.throws(() => s.replace(/□#(\w+)/.exec(s.view("below"))![1], "integer(-1)"), /Nat is a whole number from 0: -1 isn't one/);
});
