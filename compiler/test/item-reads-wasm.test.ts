// C268 on WebAssembly: `item at` over an array put in place where it is
// called, its stand-in worked out only past the end (item-reads.ts, as
// natively). The greenhouse reads its moths and its stand-in Thing that
// way; `ters wasi` prints what `ters compile` does, with the pass and
// without it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const folder = join(import.meta.dirname, "../gaps/greenhouse");

test("the greenhouse on WebAssembly with item at in place prints as compiled JavaScript", () => {
  const dir = mkdtempSync(join(tmpdir(), "item-reads-wasm-"));
  const args = ["40", "300"];
  const js = spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "g.mjs")], { encoding: "utf8" });
  assert.equal(js.status, 0, js.stderr);
  const want = spawnSync(process.execPath, [join(dir, "g.mjs"), ...args], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  writeFileSync(join(dir, "w.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi"; ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["g", ...process.argv.slice(3)], returnOnExit: true });
w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(process.argv[2])), wasiImports(w)));`);
  for (const off of [false, true]) {
    const env = { ...process.env, ...(off ? { NO_ITEM_READS: "1" } : {}) };
    const out = join(dir, off ? "off.wasm" : "on.wasm");
    const b = spawnSync(process.execPath, [lab, "wasi", folder, "-o", out], { encoding: "utf8", env });
    assert.equal(b.status, 0, b.stderr);
    const r = spawnSync(process.execPath, ["--no-warnings", join(dir, "w.mjs"), out, ...args], { encoding: "utf8" });
    assert.equal(r.stdout, want.stdout, off ? "without the pass" : "with it");
  }
});
