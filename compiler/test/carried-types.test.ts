// Carried types (I203) checked against the old rechecks (I207, REVIEW-2026-11-11
// §2): every example compiled as it is and with TERS_RECHECK=1, which checks
// the program again after hoisting, filling the uses with no body and
// staging instead of trusting the types those passes carry, gives the same
// module. Node ids are renumbered in the order they appear first, since a
// compile makes fresh ones (calculus and conjugate get different ones each
// run, carried or not), and comment lines are left out.
//
// Each compile takes 5 to 40 s, so it is a sweep: an eighth of the examples
// per change, all of them nightly (helpers.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sweep } from "../../ters/test/helpers.ts";

const ters = join(import.meta.dirname, "../../ters");
const lab = join(ters, "cli/ters.ts");
const examples = join(ters, "examples");
const dir = mkdtempSync(join(tmpdir(), "carried-"));

// Examples with no main compile to nothing to compare (pages of shaders,
// a library of algebra).
const NO_MAIN = new Set(["archive", "mandelbrot", "quadratic", "raymarch", "rmold", "shaders"]);
// Known to differ, with the same output (none since I207d: bounce's
// differed while its checks again lost what made `nth` end). When one is
// added, take it off once it comes out the same.
const KNOWN: Record<string, string> = {};

function compiled(name: string, recheck: boolean): string {
  const out = join(dir, `${name}${recheck ? ".re" : ""}.mjs`);
  const env = { ...process.env };
  if (recheck) env.TERS_RECHECK = "1"; else delete env.TERS_RECHECK;
  const r = spawnSync(process.execPath, [lab, "compile", join(examples, name), "-o", out], { encoding: "utf8", env, timeout: 300_000 });
  assert.equal(r.status, 0, `${name}${recheck ? " (TERS_RECHECK=1)" : ""}: ${r.stderr}`);
  return readFileSync(out, "utf8");
}

// Comment lines out, and each 26-character node id numbered by where it
// first appears.
export function canonical(js: string): string {
  const ids = new Map<string, string>();
  return js
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("// "))
    .join("\n")
    .replace(/\b[0-9a-v]{26}\b/g, (id) => {
      let n = ids.get(id);
      if (n === undefined) ids.set(id, (n = `id${ids.size}`));
      return n;
    });
}

const all = readdirSync(examples).filter((e) => existsSync(join(examples, e, "code.json")) && !NO_MAIN.has(e)).sort();
const only = process.env.CARRIED_ONLY?.split(",");

for (const name of only ?? sweep(all)) {
  test(`${name} compiles to the same module with its types carried as checked again`, () => {
    const carried = canonical(compiled(name, false)), rechecked = canonical(compiled(name, true));
    if (KNOWN[name]) {
      assert.notEqual(carried, rechecked, `${name} is the same both ways now: take it off KNOWN`);
      return;
    }
    if (carried === rechecked) return;
    // The first line that differs, to start from.
    const a = carried.split("\n"), b = rechecked.split("\n");
    const i = a.findIndex((l, k) => l !== b[k]);
    assert.fail(`${name} differs at line ${i + 1}:\n  carried:   ${a[i]?.slice(0, 200)}\n  rechecked: ${b[i]?.slice(0, 200)}`);
  });
}
