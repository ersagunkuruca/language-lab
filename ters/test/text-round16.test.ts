// Round 16's smaller gaps in the MCP's text reader (I260, GAPS.md round 16
// M1): a match as a step with steps after it, `0.0 m` where m is a
// parameter, first given an Optional, and `not in order(ps)`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

function session() {
  const dir = mkdtempSync(join(tmpdir(), "round16-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  // A function's body from text: its view without ids, or why not.
  const fill = (name: string, params: string[], text: string) => {
    s.define(name, "function", params);
    try { s.replace(/□#(\w+)/.exec(s.view(name))![1], text); } catch (e) { return `refused: ${(e as Error).message}`; }
    // Without its signature, ids and the step ids in the left column.
    return s.view(name).replace(/#\w+/g, "").split("\n").filter((l) => !/ : /.test(l)).map((l) => l.replace(/^[0-9a-v]{4,5}\s+/, "").trim()).join("\n");
  };
  return { s, fill };
}

test("a match, and a print, as steps with steps after them", () => {
  const { fill } = session();
  assert.equal(fill("m", ["x"], "match x\n  true → print(\"yes\")\n  false → print(\"no\")\nprint(\"after\")\n7"),
    "m(x) =\nif x then print(\"yes\") else print(\"no\")\nprint(\"after\")\n7");
  assert.equal(fill("p", ["x"], "print(\"a\")\nprint(\"b\")\nx + 1"), "p(x) =\nprint(\"a\")\nprint(\"b\")\nx + 1");
});

test("0.0 m with a parameter m says m is that name, not a unit", () => {
  const { fill } = session();
  assert.match(fill("q", ["m"], "m + 0.0 m"), /in “0\.0 m”, m is the name m here, not a unit/);
  assert.equal(fill("r", ["x"], "x + 1.5 m"), "r(x) = x + 1.5 m");
});

test("first given an Optional says it takes a search, not that the default is wrong", () => {
  const { fill } = session();
  assert.match(fill("f", ["x"], "first(some(1.0), else 0.0)"), /first searches: it takes what gives answers .*this is an Optional\. value of/);
  // A search whose answers are Optionals is still one: its default is what's wrong.
  assert.match(fill("g", ["x"], "first(one of([some(1.0)]), else 0.0)"), /first needs/);
});

test("not before a call reads as not of the call", () => {
  const { fill } = session();
  fill("small", ["n"], "n < 3");
  assert.equal(fill("big", ["n"], "not small(n)"), "big(n) = not small(n)");
});
