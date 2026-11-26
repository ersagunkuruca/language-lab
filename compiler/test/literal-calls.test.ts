// A pure builtin called on literals alone is made once (literal-calls.ts,
// C346): `characters("aeiou")` inside a function called for every
// character becomes a definition of no inputs, kept once worked out, and
// the program prints what the evaluator prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

test("a builtin on literals inside a function is worked out once, as a definition of no inputs", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ters-literal-calls-")), "lit");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.equal(r.error, false, `${name}: ${r.text}`); return r.text; };
  const def = (name: string, params: string[], body: string) => {
    ask("define", { name, kind: "function", params });
    const r = call("replace", { at: name, find: "□", text: body }), as = r.error ? /Give `as` \("([^"]+)"/.exec(r.text)?.[1] : undefined;
    if (r.error) ask("replace", { at: name, find: "□", text: body, as });
  };
  ask("open", { path: dir });
  def("vowel at", ["c"], 'length(keep(characters("aeiou"), (v) => v = c))');
  def("main", ["arguments"], 'print(show(sum(map(characters(item at(arguments, 0, "the quick brown fox jumps over the lazy dog")), vowel at))))');
  const ters = join(import.meta.dirname, "../../ters/cli/ters.ts");
  const run = (...args: string[]) => { const r = spawnSync(process.execPath, ["--no-warnings", ...args], { encoding: "utf8", env: { ...process.env, TERS_NO_KEPT_OUTPUT: "1" } }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const want = run(ters, "run", dir);
  assert.equal(want, "11\n");
  const js = join(dir, "lit.js");
  run(ters, "compile", dir, "-o", js);
  // The call is the whole body of a function kept once worked out.
  assert.match(readFileSync(js, "utf8"), /return (\w+)\$v \?\?= \1\$w\(\);\n  \}\n  function \1\$w\(\) \{\n    return rt\d+\("aeiou"\);/);
  assert.equal(run(js), want);
});
