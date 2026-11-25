// C336 (checked-once.ts): an array walk, `dot` reading `at(x, xo)` with xo
// stepping by xs for n rounds as mnist's does, gets a copy reading without
// the bounds check, taken when the whole walk is in range as it starts. A
// walk past the end (its `at` 0 there) runs as written. `ters native`
// prints what `ters run` prints, with the copy and without.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

function written(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "checked-once-")), "walks");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "at", kind: "function", params: ["xs", "i"] });
  ask("replace", { at: "at", find: "□", text: "first(item at(xs, i), else 0)" });
  ask("define", { name: "row dot", kind: "function", params: ["x", "xo", "xs", "w", "wo", "ws", "n", "acc"] });
  ask("replace", { at: "row dot", find: "□", text: "if n ≤ 0 then acc else row dot(x, xo + xs, xs, w, wo + ws, ws, n − 1, acc + at(x, xo) · at(w, wo))" });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 'k = length(append(["a"], arguments)) * 4; □' });
  ask("replace", { at: "main", find: "□", text: "x = array of(map(range(k * k), (i) => i * 0.5)); □" });
  // A row times a column (in range), and a column walked past the end.
  ask("replace", { at: "main", find: "□", text: 'print(join all([show(row dot(x, 0, 1, x, 0, k, k, 0)), show(row dot(x, k, 1, x, 1, k, k, 0)), show(row dot(x, 2, k, x, 3, k, k + 3, 0)), show(row dot(x, -2, 1, x, 0, 1, 4, 0))], " "))' });
  return dir;
}

test("an array walk checked once: the same answers, in range and past the end", () => {
  const dir = written(), args = ["p", "q"];
  const run = spawnSync(process.execPath, [lab, "run", dir, ...args], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const outs: string[] = [];
  for (const env of [{ NO_CHECKED_ONCE: "1" }, {}]) {
    const exe = join(mkdtempSync(join(tmpdir(), "checked-once-n-")), "walks");
    const b = spawnSync(process.execPath, [lab, "native", dir, "-o", exe], { encoding: "utf8", env: { ...process.env, ...env } });
    assert.equal(b.status, 0, b.stderr);
    assert.equal(readFileSync(exe + ".c", "utf8").includes("lab__walk_in(("), !("NO_CHECKED_ONCE" in env), JSON.stringify(env));
    const r = spawnSync(exe, args, { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    outs.push(r.stdout);
  }
  assert.equal(outs[0], run.stdout);
  assert.equal(outs[1], run.stdout);
});
