// A name is read as a name before as the start of an id. Ids are random,
// so now and then one starts with a definition's name ("top" is three of
// the 32 digits ids are written in), and the MCP took the id: Check main
// failed units-in-types now and then, filling a hole that wasn't there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

function session() {
  const dir = mkdtempSync(join(tmpdir(), "names-before-ids-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  return new Session(dir);
}

test("a definition named like the start of an id is found by its name; #id is the id", () => {
  const s = session();
  s.define("first", "function", ["x"]);
  const hole = /□#(\w+)/.exec(s.view("first"))![1];
  // A name made of the hole's id's first digits, so the two clash.
  const clash = hole.slice(0, 3);
  s.define(clash, "function", ["y"]);
  const def = s.resolve(clash);
  assert.equal(s.name(def), clash);
  assert.ok(s.resolve(`#${hole}`).startsWith(hole));
  assert.notEqual(s.resolve(`#${hole}`), def);
  // A short id, written without #, still finds its node.
  assert.ok(s.resolve(hole).startsWith(hole));
});
