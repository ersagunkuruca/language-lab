// C337 part 1: Int quotient and remainder of two small ones are worked
// out where they're used natively (c-rt.ts), the rest a call. Floored, as
// the evaluator: negatives either side, −1, and the 63-bit edges, where
// −2⁶² ÷ −1 isn't small and 2⁶³ − 1 is big. `ters native` prints what
// `ters run` prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

test("Int quotient and remainder natively, as the evaluator", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "int-divide-")), "divs");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 'k = length(append(["a"], arguments)); □' });
  ask("replace", { at: "main", find: "□", text: "xs = [7 * k, -7 * k, 0, 4611686018427387903 * k, -4611686018427387904 * k, 9223372036854775807 * k, 1]; □" });
  ask("replace", { at: "main", find: "□", text: "ys = [2 * k, -2 * k, 1, -1 * k, 3, -3, 4611686018427387903 * k, -4611686018427387904 * k, 0]; □" });
  ask("replace", { at: "main", find: "□", text: 'print(join all(map(xs, (x) => join all(map(ys, (y) => show(first(quotient(x, y), else 99)) ++ "," ++ show(first(remainder(x, y), else 99))), " ")), "\\n"))' });
  const exe = join(mkdtempSync(join(tmpdir(), "int-divide-n-")), "divs");
  const b = spawnSync(process.execPath, [lab, "native", dir, "-o", exe], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stderr);
  for (const args of [[], ["p"]]) {
    const run = spawnSync(process.execPath, [lab, "run", dir, ...args], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const r = spawnSync(exe, args, { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, run.stdout);
    assert.match(run.stdout, args.length ? /^3,2 -4,-2 / : /^3,1 -4,-1 /);
  }
});
