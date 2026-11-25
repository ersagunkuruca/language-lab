// C330 (GAPS.md round 24 TG1): a map over a list numbered that gives one
// value at one position and the item elsewhere is read as `replace at`
// (replace-reads.ts). Here at a position inside, at 0, before the start,
// past the end and on an empty list, the test both ways round; a function
// that reads its pair beside the value is left a map. The same printed by
// `ters run` (which reads them too) and by `ters compile`, and as worked
// out by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { replaceReads } from "../src/replace-reads.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

function written(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "replace-reads-")), "reads");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "put", kind: "function", params: ["xs", "c", "v"] });
  ask("replace", { at: "put", find: "□", text: "map(numbered(xs), (p) => if p.first = c then v * 10 else p.second)" });
  ask("define", { name: "put back", kind: "function", params: ["xs", "c", "v"] });
  ask("replace", { at: "put back", find: "□", text: "map(numbered(xs), (p) => if c = p.first then v else p.second)" });
  ask("define", { name: "shifted", kind: "function", params: ["xs", "c"] });
  ask("replace", { at: "shifted", find: "□", text: "map(numbered(xs), (p) => if p.first = c then p.first else p.second)" });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 'xs = map(range(length(append(["a"], arguments)) + 3), (i) => i + 1); □' });
  ask("replace", { at: "main", find: "□", text: 'print(join all([show(put(xs, 2, 7)), show(put(xs, 0, 7)), show(put(xs, -1, 7)), show(put(xs, 4, 7)), show(put(nil, 0, 7)), show(put back(xs, 3, 9)), show(shifted(xs, 1))], " "))' });
  return dir;
}

test("a map over a list numbered that replaces one item is replace at, every position", () => {
  const dir = written();
  const p = loadProgram(dir), info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors, []);
  const r = replaceReads(p.code, info, p.pres.names, p.own.defs, p.options as Parameters<typeof infer>[3] ?? {});
  assert.equal(r?.read, 2, "put and put back, not shifted");
  assert.deepEqual(r!.info.errors, []);
  const want = "[1, 2, 70, 4] [70, 2, 3, 4] [1, 2, 3, 4] [1, 2, 3, 4] [] [1, 2, 3, 9] [1, 1, 3, 4]\n";
  const run = spawnSync(process.execPath, [lab, "run", dir], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, want);
  const out = mkdtempSync(join(tmpdir(), "replace-reads-out-"));
  const js = spawnSync(process.execPath, [lab, "compile", dir, "-o", join(out, "p.js")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(spawnSync(process.execPath, [join(out, "p.js")], { encoding: "utf8" }).stdout, want, "ters compile");
});
