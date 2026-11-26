// C348: an array of records held as columns (columns.ts) given whole to a
// host, the frame's draw given the flock page's birds: its rows made from
// the columns there (core-rt.ts rowsOf), the same rows again while the
// columns hold what they held, so a frame's three draws of the birds send
// them once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME } from "../src/core-rt.ts";

const items = (v: unknown) => { const a = v as { buf: { items: unknown[] }; start: number; n: number }; return a.buf.items.slice(a.start, a.start + a.n); };

test("rows from columns, the same while the columns are", () => {
  const c = { n: 2, c0: Float64Array.of(1, 2, 0), c1: ["a", "b", undefined] };
  const row = (c: { [k: string]: ArrayLike<unknown> }, k: number) => ({ f0: c.c0[k], f1: c.c1[k] });
  const a = RUNTIME.rowsOf(c, 2, row);
  assert.deepEqual(items(a), [{ f0: 1, f1: "a" }, { f0: 2, f1: "b" }]);
  assert.equal(RUNTIME.rowsOf(c, 2, row), a, "nothing changed");
  c.c0[1] = 3;
  const b = RUNTIME.rowsOf(c, 2, row);
  assert.notEqual(b, a);
  assert.deepEqual(items(b), [{ f0: 1, f1: "a" }, { f0: 3, f1: "b" }]);
  c.n = 3;
  c.c1[2] = "c";
  assert.deepEqual(items(RUNTIME.rowsOf(c, 2, row)).length, 3, "one more");
});

test("the flock page's birds are columns, drawn as rows", () => {
  const out = join(mkdtempSync(join(tmpdir(), "rows-host-")), "page.mjs");
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../ters/cli/ters.ts"), "compile", join(import.meta.dirname, "../../ters/examples/flock-frame-page"), "-o", out], { encoding: "utf8", env: { ...process.env, COLUMNS_WHY: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/Bird kept rows/.test(r.stderr), r.stderr);
  assert.match(readFileSync(out, "utf8"), /R\d*\.rowsOf\(/);
});
