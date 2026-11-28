// The bake store on disk (G16d2): a file by its key, a weighing by its
// key and the compiler, either kept across stores of the same folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bakeStore } from "../cli/bake-store.ts";

test("a bake store keeps files and weighings by key (G16d2)", () => {
  const was = process.env.LAB_NO_LIBRARY_STORE;
  delete process.env.LAB_NO_LIBRARY_STORE;
  const dir = mkdtempSync(join(tmpdir(), "bakes-"));
  try {
    const s = bakeStore(dir);
    assert.equal(s.file("k1"), undefined);
    assert.equal(s.weighed("k1"), undefined);
    s.keepFile("k1", new Uint8Array([1, 2, 3]));
    s.keepWeighed("k1", { computeMs: 20, decodeMs: 9 });
    const again = bakeStore(dir);
    assert.deepEqual(again.file("k1"), new Uint8Array([1, 2, 3]));
    assert.deepEqual(again.weighed("k1"), { computeMs: 20, decodeMs: 9 });
    assert.equal(again.file("k2"), undefined);
    assert.equal(readdirSync(dir).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); if (was !== undefined) process.env.LAB_NO_LIBRARY_STORE = was; }
});
