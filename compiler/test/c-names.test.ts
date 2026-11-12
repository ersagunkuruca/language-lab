// A program's own names never take one the C runtime or C itself has
// (I214, c.ts ident): a definition named `cell` once printed as lab_cell,
// the runtime's cell type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { C_OWN, C_OWN_PREFIXES } from "../src/c.ts";
import { RESERVED } from "../src/c-rt.ts";

const here = import.meta.dirname, ters = join(here, "../../ters/cli/ters.ts");

test("every lab_ name c.ts spells is one a program's names can't take", () => {
  const src = readFileSync(join(here, "../src/c.ts"), "utf8");
  const taken = (w: string) => RESERVED.includes(w) || C_OWN.includes(w) || C_OWN_PREFIXES.some(([p, any]) => w.startsWith(p) && (any || /^[0-9]/.test(w.slice(p.length))));
  // Spelled whole (lab_closure), or a prefix followed by what's worked out (lab_m${i}).
  const whole = [...src.matchAll(/\blab_([A-Za-z0-9]\w*)(?!\$\{|\w)/g)].map((m) => m[1]).filter((w) => !taken(w) && !/^print_Fish$|^m3$/.test(w));
  assert.deepEqual([...new Set(whole)], []);
  const prefixes = [...src.matchAll(/\blab_([A-Za-z0-9]\w*)\$\{/g)].map((m) => m[1]).filter((p) => !C_OWN_PREFIXES.some(([q]) => q === p) && !C_OWN.includes(p) && !RESERVED.includes(p) && !C_OWN_PREFIXES.some(([q, any]) => any && p.startsWith(q)));
  assert.deepEqual([...new Set(prefixes)], []);
});

test("divisors with its definitions named cell, closure and shared builds natively and prints what ters run prints", () => {
  const dir = mkdtempSync(join(tmpdir(), "c-names-")), ex = join(dir, "divisors");
  cpSync(join(here, "../../ters/examples/divisors"), ex, { recursive: true });
  const file = join(ex, "names.default.json"), names = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const ids = Object.keys(names), rename = (from: string, to: string) => { const id = ids.find((i) => names[i] === from); assert.ok(id, from); names[id] = to; };
  rename("divisors", "cell");
  rename("divisors of the triangle", "closure");
  rename("found", "shared");
  writeFileSync(file, JSON.stringify(names));
  const made = spawnSync(process.execPath, [ters, "native", ex, "-o", join(dir, "d")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const c = readFileSync(join(dir, "d.c"), "utf8");
  assert.doesNotMatch(c, /\blab_cell\s*\(/);
  const native = spawnSync(join(dir, "d"), ["100"], { encoding: "utf8" }), run = spawnSync(process.execPath, [ters, "run", ex, "100"], { encoding: "utf8" });
  assert.equal(native.stdout, run.stdout);
  assert.match(run.stdout, /divisors/);
});
