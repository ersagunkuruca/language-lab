// A right operand at the same level as its operator keeps its parentheses
// unless it is the same operator (I273): a · (b / c) printed as a · b / c
// reads back as (a · b) / c, another Float64. Both text views (the MCP's and
// the editor's) print it so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../mcp/session.ts";
import { root } from "../src/io.ts";
import { Lang } from "../src/lang/dsl.ts";
import { base } from "../src/lang/load.ts";
import { loadProgram } from "../src/lang/load.ts";
import { B } from "../src/prelude.ts";
import { renderNested } from "../src/render/nested.ts";

test("a · (b / c) keeps its parentheses, and reads back as it was (I273)", () => {
  const dir = mkdtempSync(join(tmpdir(), "parens-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  const fill = (name: string, text: string) => { s.define(name, "function", ["a", "b", "c"]); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); return s.view(name).split("\n").pop()!.replace(/#\w+/g, ""); };
  assert.equal(fill("p", "a · (b / c)"), "      p(a, b, c) = a · (b / c)");
  assert.equal(fill("q", "(a · b) / c"), "      q(a, b, c) = a · b / c");
  assert.equal(fill("r", "a + (b − c)"), "      r(a, b, c) = a + (b − c)");
  assert.equal(fill("u", "a · b · c"), "      u(a, b, c) = a · b · c");
});

test("the Nested view keeps them too (I273)", () => {
  const k = new Lang();
  const d = k.def("p");
  k.define(d, k.fn(["a", "b", "c"], (a, b, c) => k.call(B.mul, a, k.call(B.div, b, c))));
  const pres = loadProgram(join(root, "examples", "queens")).pres;
  assert.match(renderNested(base(k.code), pres, d), / · \(\S+ \/ \S+\)$/);
});

// I274: + and · don't associate on Float64, so a + (b + c) isn't printed as
// a + b + c, which reads back as (a + b) + c. Only the left-nested pairs are
// one chain; ++, and, or are still one chain whichever way they nest.
test("a + (b + c) keeps its brackets and reads back right-nested; a + b + c stays one chain (I274)", () => {
  const dir = mkdtempSync(join(tmpdir(), "chain-"));
  writeFileSync(join(dir, "code.json"), JSON.stringify({ defs: [], nodes: {} }));
  writeFileSync(join(dir, "names.default.json"), "{}");
  const s = new Session(dir);
  const fill = (name: string, params: string[], text: string) => { s.define(name, "function", params); s.replace(/□#(\w+)/.exec(s.view(name))![1], text); return s.view(name).split("\n").pop()!.replace(/#\w+/g, "").trim(); };
  assert.equal(fill("r", ["a", "b", "c"], "a + (b + c)"), "r(a, b, c) = a + (b + c)");
  assert.equal(fill("l", ["a", "b", "c"], "a + b + c"), "l(a, b, c) = a + b + c");
  assert.equal(fill("m", ["a", "b", "c", "d"], "a · (b · c) · d"), "m(a, b, c, d) = a · (b · c) · d");
  assert.equal(fill("t", ["a", "b", "c"], "a ++ (b ++ c)"), "t(a, b, c) = a ++ b ++ c");
  // What r reads back as is r: the same tree printed again the same way.
  assert.equal(fill("r2", ["a", "b", "c"], s.view("r").split("= ").pop()!.replace(/#\w+/g, "").trim()), "r2(a, b, c) = a + (b + c)");
});
