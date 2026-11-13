// Refusals of a call to a name several definitions share (I230,
// OUTSIDER-WRITE-2026-11-13 §2.4): the version whose input count fits leads
// the message, and says what doesn't fit in it; MCP `defs` lists each
// version with its id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

const countdown = () => {
  const dir = mkdtempSync(join(tmpdir(), "refusals-"));
  cpSync(join(import.meta.dirname, "../examples/countdown"), dir, { recursive: true });
  return new Session(dir);
};
const loop = "‹for each›(solutions(items, 765), (‹input 1›) => print(‹show expr›(‹input 1›)))";
const refused = (text: string): string => {
  const s = countdown();
  const at = s.view("main", 99).split("\n").find((l) => /^\S+ +items#/.test(l))!;
  try { s.replace(at.trim().split(/\s+/)[0], text, loop); } catch (e) { return (e as Error).message; }
  return "";
};

test("a 2-input for each refused for another reason leads with that reason, not the 3-input version's count", () => {
  const why = refused("‹for each›([1, 2, 3], (n) => print(n))");
  assert.match(why, /for each gives this numbers, and it takes Text; or for each takes 3 inputs, given 2$/);
  // A divisor that may be 0 (I234: by 3 it has no Choice).
  assert.match(refused("‹for each›([1, 2, 3], (n) => print(show(remainder(3, n))))"), /: main does Console while a Choice is open[^;]*; or for each takes 3 inputs, given 2$/);
  // What fits still does.
  assert.equal(refused("‹for each›([1, 2, 3], (n) => print(show(n)))"), "");
});

test("defs lists each library version of a shared name with its id", () => {
  const lines = countdown().defs("for each", true).split("\n").filter((l) => /\bfor each : /.test(l));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.match(l, /^\S+ {2}for each : /);
  assert.notEqual(lines[0].split(" ")[0], lines[1].split(" ")[0]);
});
