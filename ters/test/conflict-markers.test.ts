// A program file git left with conflict markers is said so, with the line
// of the first, wherever it is read: the command line, the MCP and a saved
// editor file (I270, GIT-TRIAL-2026-11-14 §6). It was Node's JSON error and
// a stack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { conflictMarkersAt, ProgramFileError } from "../src/saved.ts";
import { fromFile } from "../src/files.ts";
import { Session } from "../mcp/session.ts";
import { LIBRARY } from "../src/lang/library.ts";

const marked = (text: string, at: number) => { const ls = text.split("\n"); ls.splice(at - 1, 1, "<<<<<<< HEAD", ls[at - 1], "=======", ls[at - 1], ">>>>>>> theirs"); return ls.join("\n"); };

test("the first conflict marker's line is found, and only a marker at a line's start counts", () => {
  assert.equal(conflictMarkersAt('{\n"a": 1,\n<<<<<<< HEAD\n"b": 2\n=======\n"b": 3\n>>>>>>> x\n}'), 3);
  assert.equal(conflictMarkersAt('{"text": "<<<<<<< not one"}'), null);
  assert.equal(conflictMarkersAt("{}"), null);
});

test("ters check on a program with conflict markers says so, without a stack", () => {
  const d = join(mkdtempSync(join(tmpdir(), "markers-")), "dice");
  cpSync(join(import.meta.dirname, "..", "examples", "dice"), d, { recursive: true });
  writeFileSync(join(d, "code.json"), marked(readFileSync(join(d, "code.json"), "utf8"), 6));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "cli", "ters.ts"), "check", d], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^ters: .*code\.json has git conflict markers \(the first at line 6\): .*ters git-setup/);
  assert.doesNotMatch(r.stderr, /SyntaxError|    at /);
  assert.throws(() => new Session(d), (e) => e instanceof ProgramFileError && /line 6/.test(e.message));
});

test("a saved editor file with conflict markers says so", () => {
  const r = fromFile(marked('{\n"format": "x",\n"code": {}\n}', 2), () => LIBRARY.code);
  assert.ok("error" in r && /git conflict markers \(the first at line 2\)/.test(r.error));
});
