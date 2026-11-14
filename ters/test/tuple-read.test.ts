// A tuple as the view prints it, (a, b), reads back, and so does the
// library's and LANGUAGE.md's (x) ↦ body (I280, GAPS round 17 D4): depot
// had to write tuple(1, 2) and (s) => s.bikes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";

test("(a, b) is a tuple and (x) ↦ body a function, as the view and the docs write them", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "tuple-read-")), "wc");
  cpSync(join(import.meta.dirname, "../examples/wc"), dir, { recursive: true });
  const s = new Session(dir);
  s.define("Stock", "type", [], "stock(bikes: Int, rentals: Int)");
  for (const [name, params, text] of [
    ["pair", ["n"], "(n, n + 1)"],
    ["nest", ["n"], "((n, 1), (2, n))"],
    ["twice", ["xs"], "map(xs, (x) ↦ x · 2)"],
    ["both", ["st"], "set((s) ↦ (s.bikes, s.rentals), st, (1, 2))"],
    ["grouped", ["n"], "(n + 1) · 2"],
  ] as const) {
    s.define(name, "function", [...params]);
    s.replace(/□#(\w+)/.exec(s.view(name))![1], text);
  }
  assert.match(s.view("pair"), /= \(n, n \+ 1\)/);
  assert.match(s.eval("pair(3)"), /^= \(3, 4\) :/m);
  assert.match(s.eval("nest(4)"), /^= \(\(4, 1\), \(2, 4\)\) :/m);
  assert.match(s.eval("twice([1, 2])"), /^= \[2, 4\] :/m);
  assert.match(s.eval("both(stock(5, 6))"), /^= stock\(1, 2\) : Stock$/m);
  assert.match(s.eval("grouped(1)"), /^= 4 :/m);
});
