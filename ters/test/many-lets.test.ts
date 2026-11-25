// One replace whose text holds several steps in a row, `v0 = x * 1.5 + n;
// v1 = …; □`, is read in time that grows with the steps, not exponentially
// (I365: each step's readings were read again for every reading of the
// steps before it; 8 steps took 22 s, 20 didn't finish in 100 s).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { root } from "../src/io.ts";
import { Session } from "../mcp/session.ts";

test("one replace of 20 steps in a row is read in a few seconds", () => {
  const dir = mkdtempSync(join(tmpdir(), "many-lets-"));
  cpSync(join(root, "examples", "bounce"), dir, { recursive: true });
  const s = new Session(dir);
  s.define("f", "function", ["x", "n"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("f"))![1];
  const text = Array.from({ length: 20 }, (_, i) => `v${i} = x * 1.5 + n`).join("; ") + "; v19";
  const t = performance.now();
  const said = s.replace(hole, text);
  const ms = performance.now() - t;
  const view = s.view("f");
  for (let i = 0; i < 20; i++) assert.match(view, new RegExp(`\\bv${i}#\\w+ = x · 1\\.5 \\+ n$`, "m"), `${said}\n${view}`);
  assert.ok(ms < 10_000, `20 steps took ${Math.round(ms)} ms`);
});
