// examples/turtle (L290b): commands as the cases of one match, words in
// patterns, read back as rows; it runs as written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

const session = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-turtle-")), "turtle");
  cpSync("examples/turtle", dir, { recursive: true });
  return new Session(dir);
};

test("obey's commands read as rows of word patterns", () => {
  const view = session().view("obey").replace(/#\w+/g, "");
  for (const row of ['["forward", n] → moved(t, steps(n))', '["turn", "right"] → turned(t, 1)', '["turn", way] → abort(', '["pen", "up"] → inked(t, false)', 'otherwise → abort("not a command: " ++ line)']) assert.ok(view.includes(row), `${row}\n${view}`);
});

test("the turtle follows its commands and says which lines aren't any", () => {
  const out = session().run("main", [], "forward 3\nturn right\npen up\nforward 2\nturn sideways\nfly\npen down\nback 4\nforward x\n");
  assert.match(out, /^at 0, 3 facing north, 3 drawn\nat 0, 3 facing east, 3 drawn\n/);
  assert.match(out, /turtle: line 5: turn right, left or around, not sideways/);
  assert.match(out, /turtle: line 6: not a command: fly/);
  assert.match(out, /at -2, 3 facing east, 7 drawn/);
  assert.match(out, /turtle: line 9: not a number of steps: x/);
});
