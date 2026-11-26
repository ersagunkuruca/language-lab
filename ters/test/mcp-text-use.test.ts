// MCP text as the view prints it (I377, GAPS round 25 L5): a use of a
// definition run another way, its ports named, greet(result = greeting),
// is read back to the same use; and a name in scope compared with `=` is
// still a comparison; solve f(…) for … reads as LANGUAGE.md writes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { root } from "../src/io.ts";
import { Session } from "../mcp/session.ts";

const session = (example = "backwards") => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-use-"));
  cpSync(join(root, "examples", example), dir, { recursive: true });
  return new Session(dir);
};

test("greet(result = greeting) is read as the view prints it, and runs greet backwards", () => {
  const s = session();
  s.define("again", "function", ["greeting"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("again"))![1];
  const said = s.replace(hole, 'first(greet(result = greeting), else "nobody")');
  assert.match(s.view("again"), /again#\w+\(greeting#\w+\) = first\(greet\(result = greeting\), else "nobody"\)$/m, said);
  assert.match(s.eval('again("hello, Ada")'), /"Ada"/);
});

test("a name in scope = a value, inside a call, is still a comparison", () => {
  const s = session();
  s.define("same", "function", ["name"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("same"))![1];
  const said = s.replace(hole, 'not(name = "x")');
  assert.match(s.view("same"), /= not \(name = "x"\)$/m, said);
});

test("++ between lists says that lists join with append", () => {
  const s = session();
  s.define("both", "function", ["a", "b"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("both"))![1];
  assert.throws(() => s.replace(hole, "[1, 2] ++ [3]"), /two lists join with append\(a, b\)/);
});

// solve f(…) for … as LANGUAGE.md writes it, inline with → and as a step
// whose body is the steps after it.
test("solve square(result = y) for x → x is read as the view prints it", () => {
  const s = session("relations");
  s.define("roots", "function", ["y"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("roots"))![1];
  const said = s.replace(hole, "all(() => solve square(result = y) for x → x)");
  assert.match(s.view("roots"), /solve square\(result = y\) for x#\w+\n\s+x\n/, said);
  assert.match(s.eval("roots(9)"), /\[3, -3\]/);
});

test("solve polar(x = x, y = y) for length, angle as a step binds both for the steps after it", () => {
  const s = session("relations");
  s.define("far", "function", ["x", "y"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("far"))![1];
  const said = s.replace(hole, "solve polar(x = x, y = y) for length, angle; length + angle");
  assert.match(s.view("far"), /solve polar\(x = x, y = y\) for length#\w+, angle#\w+\n\s+length \+ angle/, said);
  assert.match(s.eval("first(far(3, 4), else 0)"), /= 5\.927/);
});

test("solve with a port the function hasn't names its ports", () => {
  const s = session("relations");
  s.define("wrong", "function", ["y"]);
  const hole = /□#([a-z0-9]+)/.exec(s.view("wrong"))![1];
  assert.throws(() => s.replace(hole, "solve square(z = y) for x → x"), /square has no port z: its ports are x, result/);
});
